import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FloorplanElement, LayoutVariant } from "@hi/shared";
import {
  DEFAULT_LOCATION_ID,
  EMPTY_HISTORY,
  createSingleFlight,
  defaultLocationDoc,
  deleteBlockers,
  duplicateLayoutAsDraft,
  elementTypeLabel,
  enumLabel,
  findResourceIdConflict,
  generateResourceId,
  makeDraftLayout,
  nextLayoutName,
  placeElement,
  pushHistory,
  redoHistory,
  resourceIndexForLayout,
  rotatedCenter,
  screenToCanvas,
  stripUndefined,
  undoHistory,
} from "../../apps/web/src/lib/floorplanBuilder";
import { createSaveQueue } from "../../apps/web/src/lib/designerSaveQueue";
import { createDesignerElement, makeEmptyShell, makeFloor } from "../../apps/web/src/lib/designerElements";
import {
  DEFAULT_SNAP_SETTINGS,
  effectiveSnap,
  feetLabel,
  gridStepPx,
  parseDimensions,
  parseFeet,
  parseSnapSettings,
  snapBoxToObjects,
  snapMove,
  snapPointToAngle,
  snapRotation,
  visibleGridLines,
} from "../../apps/web/src/lib/designerSnap";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function hasUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value && typeof value === "object") return Object.values(value).some(hasUndefined);
  return false;
}

const el = (over: Partial<FloorplanElement> = {}): FloorplanElement =>
  ({ id: "e1", type: "SEAT", x: 0, y: 0, width: 60, height: 60, rotation: 0, ...over }) as FloorplanElement;

describe("persistence: Firestore never receives undefined", () => {
  it("stripUndefined removes undefined keys deeply and keeps everything else", () => {
    const input = { a: 1, b: undefined, meta: { c: undefined, d: 0, e: null }, list: [{ f: undefined, g: "x" }] };
    expect(stripUndefined(input)).toEqual({ a: 1, meta: { d: 0, e: null }, list: [{ g: "x" }] });
  });

  it("new elements, floors and shells contain no undefined values", () => {
    for (const type of ["WALL", "DOOR", "WINDOW", "BATHROOM", "SEAT", "DESK", "MODE_ZONE", "PLANT"] as const) {
      expect(hasUndefined(createDesignerElement(type))).toBe(false);
      expect(hasUndefined(createDesignerElement(type, "loc-seat-1"))).toBe(false);
    }
    expect("resourceId" in createDesignerElement("SEAT")).toBe(false);
    expect(hasUndefined(makeFloor("loc", 0))).toBe(false);
    expect(hasUndefined(makeEmptyShell("floor"))).toBe(false);
    expect(makeEmptyShell("floor").elements).toEqual([]);
  });

  it("firestore save helpers strip undefined before writing", () => {
    const src = read("apps/web/src/lib/firestore.ts");
    for (const fn of ["saveFloor", "saveShell", "saveLayout"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`)).split("\n}\n")[0];
      expect(body).toContain("stripUndefined(");
    }
  });
});

describe("save queue", () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it("writes only the latest snapshot, in order, one write per document at a time", async () => {
    const writes: string[] = [];
    const gates: Array<ReturnType<typeof deferred>> = [];
    const queue = createSaveQueue<string>({
      debounceMs: 0,
      save: (_key, doc) => {
        writes.push(doc);
        const gate = deferred();
        gates.push(gate);
        return gate.promise;
      },
    });
    queue.enqueue("layout:a", "v1");
    queue.enqueue("layout:a", "v2");
    queue.enqueue("layout:a", "v3");
    expect(writes).toEqual(["v1"]);
    expect(queue.hasUnsaved()).toBe(true);
    gates[0].resolve();
    await vi.waitFor(() => expect(writes).toEqual(["v1", "v3"]));
    gates[1].resolve();
    const state = await queue.flush();
    expect(state.status).toBe("saved");
    expect(queue.hasUnsaved()).toBe(false);
  });

  it("reports errors, keeps the failed snapshot, and retry saves it", async () => {
    let fail = true;
    const saved: string[] = [];
    const states: string[] = [];
    const queue = createSaveQueue<string>({
      debounceMs: 0,
      onChange: (s) => states.push(s.status),
      save: async (_key, doc) => {
        if (fail) throw new Error("permission-denied");
        saved.push(doc);
      },
    });
    queue.enqueue("shell:a", "edit");
    const failed = await queue.flush();
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("permission-denied");
    expect(queue.hasUnsaved()).toBe(true);
    fail = false;
    const retried = await queue.retry();
    expect(retried.status).toBe("saved");
    expect(saved).toEqual(["edit"]);
    expect(states).toContain("saving");
  });

  it("debounces typing into one write", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn(async () => {});
      const queue = createSaveQueue<string>({ debounceMs: 400, save });
      queue.enqueue("layout:a", "T");
      queue.enqueue("layout:a", "TE");
      queue.enqueue("layout:a", "TEST");
      expect(queue.getState().status).toBe("pending");
      await vi.advanceTimersByTimeAsync(400);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith("layout:a", "TEST");
    } finally {
      vi.useRealTimers();
    }
  });

  it("discard drops pending writes for deleted documents", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn(async () => {});
      const queue = createSaveQueue<string>({ debounceMs: 400, save });
      queue.enqueue("layout:loc/floor/l1", "x");
      queue.enqueue("layout:other/floor/l2", "y");
      queue.discard((key) => key.includes(":loc/"));
      await vi.advanceTimersByTimeAsync(400);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith("layout:other/floor/l2", "y");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("layouts: draft by default, duplicate", () => {
  it("new layouts are drafts", () => {
    const layout = makeDraftLayout("floor-1", "Layout 1", "admin-uid");
    expect(layout.status).toBe("DRAFT");
    expect(layout.elements).toEqual([]);
    expect(hasUndefined(makeDraftLayout("floor-1", "Layout 1"))).toBe(false);
  });

  it("names the next layout without clashing", () => {
    expect(nextLayoutName([])).toBe("Layout 1");
    expect(nextLayoutName([{ name: "Layout 1" }, { name: "Layout 2" }])).toBe("Layout 3");
    expect(nextLayoutName([{ name: "Layout 2" }])).toBe("Layout 3");
  });

  it("duplicate makes a draft copy with new element ids and kept resource ids", () => {
    const source: LayoutVariant = {
      id: "layout-a",
      floorId: "floor-1",
      name: "Default",
      status: "PUBLISHED",
      updatedAt: 1,
      elements: [el({ id: "seat-el", resourceId: "carrollton-seat-1", meta: { capacity: 1 } })],
    } as LayoutVariant;
    const copy = duplicateLayoutAsDraft(source, [source]);
    expect(copy.status).toBe("DRAFT");
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Default copy");
    expect(copy.elements[0].id).not.toBe("seat-el");
    expect(copy.elements[0].resourceId).toBe("carrollton-seat-1");
    copy.elements[0].meta!.capacity = 9;
    expect(source.elements[0].meta!.capacity).toBe(1);
    expect(duplicateLayoutAsDraft(source, [source, copy]).name).toBe("Default copy 2");
  });

  it("the page publishes only through an explicit confirm, and Unpublish exists", () => {
    const page = read("apps/web/src/app/admin/builder/page.tsx");
    expect(page).toContain("Unpublish");
    expect(page).toContain('setLayoutStatus(layout, "PUBLISHED")');
    expect(page).not.toMatch(/status:\s*"PUBLISHED"/);
  });
});

describe("resource ids are unique", () => {
  it("generates location-scoped ids past anything taken", () => {
    expect(generateResourceId("SEAT", "Hi Coworking Carrollton", [])).toBe("hi-coworking-carrollton-seat-1");
    expect(generateResourceId("SEAT", "carrollton", ["carrollton-seat-1", "carrollton-seat-2"])).toBe("carrollton-seat-3");
    expect(generateResourceId("MODE_ZONE", "carrollton", [])).toBe("carrollton-room-1");
  });

  it("finds conflicts in the same layout and across locations, but allows layout variants", () => {
    const layout = { id: "l1", name: "A", elements: [el({ id: "a", resourceId: "x-seat-1" })] } as LayoutVariant;
    const index = [
      ...resourceIndexForLayout(layout, { locationId: "loc1", floorId: "f1" }),
      { resourceId: "y-seat-1", locationId: "loc2", locationName: "Downtown", floorId: "f9", layoutId: "l9", elementId: "z" },
    ];
    expect(findResourceIdConflict("x-seat-1", { elementId: "b", layoutId: "l1", locationId: "loc1" }, index)).toMatch(/this layout/);
    expect(findResourceIdConflict("x-seat-1", { elementId: "a", layoutId: "l1", locationId: "loc1" }, index)).toBeNull();
    expect(findResourceIdConflict("x-seat-1", { elementId: "c", layoutId: "l2", locationId: "loc1" }, index)).toBeNull();
    expect(findResourceIdConflict("y-seat-1", { elementId: "c", layoutId: "l2", locationId: "loc1" }, index)).toMatch(/Downtown/);
    expect(findResourceIdConflict("bad id!", { elementId: "c", layoutId: "l2", locationId: "loc1" }, index)).toMatch(/letters/);
  });
});

describe("placement and labels", () => {
  it("centers new items on the anchor and offsets repeats", () => {
    const first = placeElement({ x: 0, y: 0, width: 60, height: 60 }, { x: 500, y: 300 }, []);
    expect(first).toMatchObject({ x: 480, y: 280 });
    const second = placeElement({ x: 0, y: 0, width: 60, height: 60 }, { x: 500, y: 300 }, [first]);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("maps the viewport center through pan and zoom", () => {
    expect(screenToCanvas({ x: 400, y: 300 }, { x: 100, y: 50, scale: 2 })).toEqual({ x: 150, y: 125 });
  });

  it("labels are human readable and follow rotation", () => {
    expect(elementTypeLabel("MODE_ZONE")).toBe("Meeting room");
    expect(elementTypeLabel("FIRE_EXTINGUISHER")).toBe("Fire extinguisher");
    expect(enumLabel("SCAN_TO_ENTER")).toBe("Scan to enter");
    const c = rotatedCenter({ x: 0, y: 0, width: 100, height: 40, rotation: 90 });
    expect(c.x).toBeCloseTo(-20);
    expect(c.y).toBeCloseTo(50);
  });
});

describe("history", () => {
  it("undo and redo round-trip", () => {
    const a = [el({ id: "a" })];
    const b = [...a, el({ id: "b" })];
    const stacks = pushHistory(EMPTY_HISTORY, a);
    const undone = undoHistory(stacks, b)!;
    expect(undone.elements.map((e) => e.id)).toEqual(["a"]);
    const redone = redoHistory(undone.stacks, undone.elements)!;
    expect(redone.elements.map((e) => e.id)).toEqual(["a", "b"]);
    expect(undoHistory(EMPTY_HISTORY, a)).toBeNull();
  });
});

describe("delete guards", () => {
  it("blocks deletes with published layouts or upcoming bookings and says why", () => {
    expect(deleteBlockers({ kind: "floor", publishedLayoutNames: [], upcomingBookingCount: 0 })).toEqual([]);
    expect(deleteBlockers({ kind: "location", publishedLayoutNames: ["Default"], upcomingBookingCount: 2 })).toEqual([
      "Published layout “Default” must be unpublished first.",
      "2 upcoming bookings use a space on this location.",
    ]);
    expect(deleteBlockers({ kind: "layout", publishedLayoutNames: ["A"], upcomingBookingCount: 0 })[0]).toMatch(/Unpublish it first/);
  });
});

describe("default location is created once", () => {
  it("uses a fixed id", () => {
    expect(defaultLocationDoc(1).id).toBe(DEFAULT_LOCATION_ID);
    expect(defaultLocationDoc(1).id).toBe(defaultLocationDoc(2).id);
  });

  it("single flight runs a doubled effect once", async () => {
    const once = createSingleFlight();
    const task = vi.fn(async () => "created");
    const [a, b] = await Promise.all([once("default", task), once("default", task)]);
    expect(task).toHaveBeenCalledTimes(1);
    expect(a).toBe("created");
    expect(b).toBe("created");
  });

  it("creation is a create-if-absent transaction, wired into the page", () => {
    const fs = read("apps/web/src/lib/firestore.ts");
    const body = fs.slice(fs.indexOf("export async function ensureDefaultLocation"));
    expect(body.slice(0, 600)).toContain("runTransaction");
    expect(body.slice(0, 600)).toContain("snap.exists()");
    const page = read("apps/web/src/app/admin/builder/page.tsx");
    expect(page).toContain("defaultLocationOnce(");
    expect(page).toContain("ensureDefaultLocation");
    expect(page).not.toContain('uid("location");\n      await saveLocation({\n        id: locationId,\n        name: "Hi Coworking Carrollton"');
  });
});

describe("grid and snapping math", () => {
  it("parses stored settings defensively", () => {
    expect(parseSnapSettings(null)).toEqual(DEFAULT_SNAP_SETTINGS);
    expect(parseSnapSettings("not json")).toEqual(DEFAULT_SNAP_SETTINGS);
    const parsed = parseSnapSettings(JSON.stringify({ showGrid: false, gridFeet: 999, snap: "yes" }));
    expect(parsed.showGrid).toBe(false);
    expect(parsed.gridFeet).toBe(50);
    expect(parsed.snap).toBe(DEFAULT_SNAP_SETTINGS.snap);
    expect(gridStepPx({ gridFeet: 0.5 })).toBe(10);
  });

  it("Alt/Option bypasses every snap; the master toggle gates the rest", () => {
    expect(effectiveSnap(DEFAULT_SNAP_SETTINGS, true)).toEqual({ grid: false, angle: false, vertices: false, objects: false });
    expect(effectiveSnap({ ...DEFAULT_SNAP_SETTINGS, snap: false }).grid).toBe(false);
    expect(effectiveSnap({ ...DEFAULT_SNAP_SETTINGS, snapObjects: false }).objects).toBe(false);
    expect(effectiveSnap(DEFAULT_SNAP_SETTINGS).grid).toBe(true);
  });

  it("rotation snaps to 15° steps when on", () => {
    expect(snapRotation(22, true)).toBe(15);
    expect(snapRotation(23, true)).toBe(30);
    expect(snapRotation(359, true)).toBe(0);
    expect(snapRotation(-10, true)).toBe(345);
    expect(snapRotation(22.44, false)).toBe(22.4);
  });

  it("wall drawing snaps to 0/45/90°", () => {
    expect(snapPointToAngle({ x: 0, y: 0 }, { x: 100, y: 8 })).toEqual({ x: 100, y: 0 });
    const diag = snapPointToAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    expect(diag.x).toBeCloseTo(diag.y);
    const vert = snapPointToAngle({ x: 10, y: 10 }, { x: 14, y: 200 });
    expect(vert.x).toBeCloseTo(10);
    expect(vert.y).toBeCloseTo(200);
  });

  it("snaps edges and centers to nearby objects with guides", () => {
    const other = { x: 100, y: 100, width: 100, height: 100 };
    const res = snapBoxToObjects({ x: 205, y: 152, width: 50, height: 50 }, [other], 8);
    expect(res.dx).toBe(-5);
    expect(res.dy).toBe(-2);
    expect(res.guides).toEqual([
      { orientation: "vertical", position: 200 },
      { orientation: "horizontal", position: 150 },
    ]);
    expect(snapBoxToObjects({ x: 400, y: 400, width: 10, height: 10 }, [other], 8)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snapMove uses the grid, lets objects win, and does nothing when bypassed", () => {
    const on = effectiveSnap(DEFAULT_SNAP_SETTINGS);
    expect(snapMove({ x: 27, y: 33, width: 10, height: 10 }, [], on, 20, 8)).toMatchObject({ x: 20, y: 40 });
    const near = snapMove({ x: 205, y: 500, width: 50, height: 50 }, [{ x: 100, y: 100, width: 100, height: 100 }], on, 20, 8);
    expect(near.x).toBe(200);
    expect(near.y).toBe(500);
    const off = effectiveSnap(DEFAULT_SNAP_SETTINGS, true);
    expect(snapMove({ x: 27, y: 33, width: 10, height: 10 }, [], off, 20, 8)).toMatchObject({ x: 27, y: 33 });
  });

  it("grid lines mark majors and thin out when zoomed far out", () => {
    const lines = visibleGridLines({ view: { x: 0, y: 0, scale: 1 }, stage: { width: 200, height: 100 }, step: 20 });
    const vertical = lines.filter((l) => l.points[0] === l.points[2]);
    expect(vertical).toHaveLength(11);
    expect(vertical.filter((l) => l.major).map((l) => l.points[0])).toEqual([0, 100, 200]);
    const far = visibleGridLines({ view: { x: 0, y: 0, scale: 0.1 }, stage: { width: 1000, height: 1000 }, step: 10 });
    expect(far.length).toBeLessThan(400);
    expect(far.every((l) => l.major)).toBe(true);
  });

  it("reads and writes feet", () => {
    expect(feetLabel(250)).toBe("12 ft 6 in");
    expect(feetLabel(10)).toBe("6 in");
    expect(parseFeet("40")).toBe(40);
    expect(parseFeet("12' 6\"")).toBe(12.5);
    expect(parseFeet("6 in")).toBe(0.5);
    expect(parseFeet("abc")).toBeNull();
    expect(parseDimensions("40 x 60 ft")).toEqual([40, 60]);
    expect(parseDimensions("40' × 60'")).toEqual([40, 60]);
    expect(parseDimensions("40")).toBeNull();
  });
});

describe("designer UI contracts", () => {
  const page = read("apps/web/src/app/admin/builder/page.tsx");
  it("has an aria-live save status with retry and a leave warning", () => {
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain("Couldn’t save");
    expect(page).toContain("beforeunload");
  });
  it("uses accessible dialogs, not window.prompt", () => {
    expect(page).not.toContain("window.prompt");
    expect(page).not.toContain("prompt(");
    expect(page).toContain("DesignerDialog");
  });
  it("keeps grid and snapping in one View menu with G and S shortcuts", () => {
    expect(page).toContain('aria-label="Grid and snapping"');
    expect(page).toContain('key === "g"');
    expect(page).toContain('key === "s"');
    expect(page).toContain("isTypingTarget(e.target)");
  });
  it("canvas drags do not pan the stage", () => {
    const canvas = read("apps/web/src/components/floorplan/FloorplanCanvas.tsx");
    expect(canvas).toContain("e.target.getStage()");
    expect(canvas).toContain("cancelBubble");
  });
});
