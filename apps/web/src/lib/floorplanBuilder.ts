/**
 * Pure helpers for the Admin Visual Designer (/admin/builder).
 *
 * Nothing in this module talks to Firebase, so it can be unit tested in
 * plain Node (see tests/web/visual-designer.test.ts).
 */
import type { FloorplanElement, FloorplanElementType, LayoutVariant } from "@hi/shared";

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* ------------------------------------------------------------------ */
/* Firestore-safe payloads                                             */
/* ------------------------------------------------------------------ */

/**
 * Firestore rejects any document that contains an `undefined` value
 * ("Unsupported field value: undefined"). The designer produced such values
 * on paste/undo/redo (`meta: undefined`) and when a field was cleared
 * (`resourceId: undefined`, `fill: undefined`), so every later save of that
 * layout failed silently. Strip them deeply before every write.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = stripUndefined(item);
    }
    return out as T;
  }
  return value;
}

export function cloneElement(el: FloorplanElement): FloorplanElement {
  const copy: FloorplanElement = { ...el };
  if (el.meta) copy.meta = { ...el.meta };
  else delete copy.meta;
  if (el.points) copy.points = [...el.points];
  return copy;
}

export function cloneElements(elements: FloorplanElement[]) {
  return elements.map(cloneElement);
}

/* ------------------------------------------------------------------ */
/* Layout drafts                                                       */
/* ------------------------------------------------------------------ */

/** Every layout the designer creates starts as a DRAFT. Publishing is explicit. */
export function makeDraftLayout(floorId: string, name: string, updatedBy?: string, id = uid("layout")): LayoutVariant {
  return stripUndefined({
    id,
    floorId,
    name,
    status: "DRAFT",
    updatedAt: Date.now(),
    updatedBy,
    elements: [],
  });
}

export function nextLayoutName(existing: Array<{ name: string }>, base = "Layout") {
  const names = new Set(existing.map((layout) => layout.name));
  let n = existing.length + 1;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/**
 * Duplicate a layout as a new DRAFT. Element ids are new; resource ids are
 * kept, because a copy is another arrangement of the same bookable spaces
 * on the same floor.
 */
export function duplicateLayoutAsDraft(
  layout: LayoutVariant,
  existing: Array<{ name: string }>,
  updatedBy?: string,
): LayoutVariant {
  const names = new Set(existing.map((item) => item.name));
  let name = `${layout.name} copy`;
  let n = 2;
  while (names.has(name)) {
    name = `${layout.name} copy ${n}`;
    n += 1;
  }
  return stripUndefined({
    ...layout,
    id: uid("layout"),
    name,
    status: "DRAFT" as const,
    updatedAt: Date.now(),
    updatedBy,
    elements: layout.elements.map((el) => ({ ...cloneElement(el), id: uid(el.type.toLowerCase()) })),
  });
}

/* ------------------------------------------------------------------ */
/* Resource ids                                                        */
/* ------------------------------------------------------------------ */

export type ResourceIndexEntry = {
  resourceId: string;
  locationId: string;
  locationName?: string;
  floorId: string;
  layoutId: string;
  layoutName?: string;
  elementId: string;
};

export function resourcePrefixForType(type: FloorplanElementType) {
  if (type === "SEAT") return "seat";
  if (type === "DESK") return "desk";
  if (type === "MODE_ZONE") return "room";
  return slugify(type);
}

export function needsResourceId(type: FloorplanElementType) {
  return type === "SEAT" || type === "MODE_ZONE" || type === "DESK";
}

/**
 * A resource id that is unique across every location: it is scoped by the
 * location slug, then numbered past anything already taken. New ids never
 * reuse a live booking resource id such as "seat-1"; linking an element to a
 * real bookable resource is a deliberate edit in the Properties panel.
 */
export function generateResourceId(type: FloorplanElementType, locationSlug: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const scope = slugify(locationSlug) || "location";
  const prefix = `${scope}-${resourcePrefixForType(type)}`;
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/**
 * Explains why `resourceId` cannot be used by `elementId`, or returns null.
 * The same id may appear in several layouts of one location (layout
 * variants of the same space). It may not be used by another element in the
 * same layout, or by any other location.
 */
export function findResourceIdConflict(
  resourceId: string,
  target: { elementId: string; layoutId: string; locationId: string },
  index: ResourceIndexEntry[],
): string | null {
  const value = resourceId.trim();
  if (!value) return null;
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(value)) {
    return "Use letters, numbers, dashes or underscores only.";
  }
  for (const entry of index) {
    if (entry.resourceId !== value || entry.elementId === target.elementId) continue;
    if (entry.layoutId === target.layoutId) {
      return `Another item in this layout already uses “${value}”.`;
    }
    if (entry.locationId !== target.locationId) {
      return `“${value}” is already used at ${entry.locationName ?? "another location"}.`;
    }
  }
  return null;
}

export function resourceIndexForLayout(
  layout: LayoutVariant,
  ctx: { locationId: string; locationName?: string; floorId: string },
): ResourceIndexEntry[] {
  return layout.elements
    .filter((el) => typeof el.resourceId === "string" && el.resourceId.length > 0)
    .map((el) => ({
      resourceId: el.resourceId as string,
      locationId: ctx.locationId,
      locationName: ctx.locationName,
      floorId: ctx.floorId,
      layoutId: layout.id,
      layoutName: layout.name,
      elementId: el.id,
    }));
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

export const PLACEMENT_STEP = 24;

/**
 * Center a new element on `anchor` (a click point or the visible viewport
 * center), then step it diagonally until it no longer sits on top of an
 * element that was placed the same way.
 */
export function placeElement<T extends { x: number; y: number; width?: number; height?: number }>(
  el: T,
  anchor: { x: number; y: number },
  existing: Array<{ x: number; y: number }>,
  grid = 20,
): T {
  const width = el.width ?? 120;
  const height = el.height ?? 100;
  const snapTo = (n: number) => Math.round(n / grid) * grid;
  let x = snapTo(anchor.x - width / 2);
  let y = snapTo(anchor.y - height / 2);
  const occupied = (cx: number, cy: number) =>
    existing.some((other) => Math.abs(other.x - cx) < PLACEMENT_STEP / 2 && Math.abs(other.y - cy) < PLACEMENT_STEP / 2);
  for (let i = 0; i < 50 && occupied(x, y); i += 1) {
    x += PLACEMENT_STEP;
    y += PLACEMENT_STEP;
  }
  return { ...el, x, y };
}

/** Converts a screen point inside the stage to canvas coordinates. */
export function screenToCanvas(point: { x: number; y: number }, view: { x: number; y: number; scale: number }) {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const TYPE_LABELS: Partial<Record<FloorplanElementType, string>> = {
  WALL: "Wall",
  ROOM: "Room",
  DOOR: "Door",
  WINDOW: "Window",
  STAIRS: "Stairs",
  ELEVATOR: "Elevator",
  BATHROOM: "Restroom",
  COLUMN: "Column",
  RECEPTION: "Reception",
  ENTRANCE: "Entrance",
  EXIT: "Exit",
  FIRE_EXIT: "Fire exit",
  UTILITY: "Utility room",
  DESK: "Desk",
  SEAT: "Seat",
  MODE_ZONE: "Meeting room",
  AMENITY: "Amenity",
  FURNITURE: "Furniture",
  SIGNAGE: "Sign",
  POWER: "Power outlet",
  ACCESS_READER: "Access reader",
  CAMERA: "Camera",
  FIRE_EXTINGUISHER: "Fire extinguisher",
  TRASH: "Trash can",
  PLANT: "Plant",
};

export function elementTypeLabel(type: string) {
  const known = TYPE_LABELS[type as FloorplanElementType];
  if (known) return known;
  const words = type.toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (!words.length) return type;
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ENUM_LABELS: Record<string, string> = {
  OPENING: "Opening",
  STANDARD: "Standard",
  KEY_ENTRY: "Key entry",
  SCAN_TO_ENTER: "Scan to enter",
  PIN_CODE: "PIN code",
  PUSH_BAR: "Push bar",
  EMERGENCY_EXIT: "Emergency exit",
  M: "Men",
  F: "Women",
  ALL_GENDER: "All gender",
};

export function enumLabel(value: string) {
  return ENUM_LABELS[value] ?? elementTypeLabel(value);
}

/** Rotated center of a rectangle-like element; labels anchor here and stay upright. */
export function rotatedCenter(el: { x: number; y: number; width?: number; height?: number; rotation?: number }) {
  const w = el.width ?? 120;
  const h = el.height ?? 100;
  const rad = ((el.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: el.x + (w / 2) * cos - (h / 2) * sin,
    y: el.y + (w / 2) * sin + (h / 2) * cos,
  };
}

/* ------------------------------------------------------------------ */
/* History (per document)                                             */
/* ------------------------------------------------------------------ */

export type HistoryStacks = { past: FloorplanElement[][]; future: FloorplanElement[][] };
export const EMPTY_HISTORY: HistoryStacks = { past: [], future: [] };
export const HISTORY_LIMIT = 50;

export function pushHistory(stacks: HistoryStacks, snapshot: FloorplanElement[]): HistoryStacks {
  return { past: [...stacks.past.slice(-(HISTORY_LIMIT - 1)), cloneElements(snapshot)], future: [] };
}

export function undoHistory(stacks: HistoryStacks, current: FloorplanElement[]) {
  if (!stacks.past.length) return null;
  const previous = stacks.past[stacks.past.length - 1];
  return {
    elements: cloneElements(previous),
    stacks: { past: stacks.past.slice(0, -1), future: [cloneElements(current), ...stacks.future] },
  };
}

export function redoHistory(stacks: HistoryStacks, current: FloorplanElement[]) {
  if (!stacks.future.length) return null;
  const next = stacks.future[0];
  return {
    elements: cloneElements(next),
    stacks: { past: [...stacks.past, cloneElements(current)], future: stacks.future.slice(1) },
  };
}

/* ------------------------------------------------------------------ */
/* Delete guards                                                       */
/* ------------------------------------------------------------------ */

export function deleteBlockers(input: {
  kind: "location" | "floor" | "layout";
  publishedLayoutNames: string[];
  upcomingBookingCount: number;
}): string[] {
  const reasons: string[] = [];
  if (input.publishedLayoutNames.length) {
    const names = input.publishedLayoutNames.map((name) => `“${name}”`).join(", ");
    reasons.push(
      input.kind === "layout"
        ? "This layout is published. Unpublish it first."
        : `Published layout${input.publishedLayoutNames.length > 1 ? "s" : ""} ${names} must be unpublished first.`,
    );
  }
  if (input.upcomingBookingCount > 0) {
    reasons.push(
      `${input.upcomingBookingCount} upcoming booking${input.upcomingBookingCount > 1 ? "s use" : " uses"} a space on this ${input.kind}.`,
    );
  }
  return reasons;
}

/* ------------------------------------------------------------------ */
/* Default location                                                    */
/* ------------------------------------------------------------------ */

/**
 * The designer used to create "Hi Coworking Carrollton" with a random id
 * whenever the locations list came back empty. Two overlapping page loads
 * did that twice (two docs, 3 ms apart). The default location now has a
 * fixed id and is created with create-if-absent semantics, and the page
 * guards against running the step twice.
 */
export const DEFAULT_LOCATION_ID = "location_hi-coworking-carrollton";

export function defaultLocationDoc(now = Date.now()) {
  return {
    id: DEFAULT_LOCATION_ID,
    name: "Hi Coworking Carrollton",
    slug: "hi-coworking-carrollton",
    address: "Carrollton, VA",
    timezone: "America/New_York",
    createdAt: now,
  };
}

/** Runs `task` once per key even if called concurrently (e.g. a doubled effect). */
export function createSingleFlight() {
  const inflight = new Map<string, Promise<unknown>>();
  return function once<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;
    const run = task();
    inflight.set(key, run);
    return run;
  };
}
