import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURAL_SEAT_POINTS,
  BOOKABLE_SEAT_RESOURCE_IDS,
  CONFERENCE_ROOM_CONFIG,
  FALLBACK_SEAT_POSITIONS,
  RESOURCE_CATALOG,
  SEAT_CATALOG,
  SEAT_DISPLAY_ORDER,
  SEAT_MAP_VIEWBOX,
  SEAT_TIERS,
  STAFF_ONLY_SEAT_RESOURCE_ID,
  accessibleSeatName,
  buildSeatMapSpots,
  displayIdForResource,
  formatUsdCents,
  isBookableSeatResource,
  resourceIdFromDisplayId,
  seatMapPercentToPoint,
  seatMapPointToPercent,
  visibleGuestRates,
  visibleMemberOverage,
} from "../../packages/shared/src/index.ts";
import { resolveSeatMapPickerFlag } from "../../apps/web/src/lib/seatMapPickerFlag";
import {
  MIN_TOUCH_TARGET_PX,
  SEAT_MAP_MIN_WIDTH_PX,
  overlappingSeatTargets,
  renderedPlanWidthPx,
  seatBadgeDiameterPx,
  seatHitTargetPx,
} from "../../apps/web/src/lib/seatMapGeometry";

const read = (path: string) => readFileSync(path, "utf8");

describe("seat map picker flag", () => {
  it("defaults off when the env is unset", () => {
    expect(resolveSeatMapPickerFlag({})).toBe(false);
    expect(resolveSeatMapPickerFlag({ NEXT_PUBLIC_SEAT_MAP_PICKER: "false" })).toBe(false);
  });

  it("turns on only for explicit true or 1", () => {
    expect(resolveSeatMapPickerFlag({ NEXT_PUBLIC_SEAT_MAP_PICKER: "true" })).toBe(true);
    expect(resolveSeatMapPickerFlag({ NEXT_PUBLIC_SEAT_MAP_PICKER: "1" })).toBe(true);
  });

  it("is not enabled in committed env files", () => {
    for (const file of readdirSync("apps/web").filter((name) => name.startsWith(".env"))) {
      expect(read(join("apps/web", file))).not.toMatch(/NEXT_PUBLIC_SEAT_MAP_PICKER\s*=\s*(true|1)/i);
    }
  });
});

describe("seat catalog", () => {
  it("maps seat-1 through seat-6 to D1 through D6", () => {
    expect(BOOKABLE_SEAT_RESOURCE_IDS).toEqual([
      "seat-1",
      "seat-2",
      "seat-3",
      "seat-4",
      "seat-5",
      "seat-6",
    ]);
    for (const id of BOOKABLE_SEAT_RESOURCE_IDS) {
      expect(displayIdForResource(id)).toBe(`D${id.slice(-1)}`);
      expect(resourceIdFromDisplayId(`D${id.slice(-1)}`)).toBe(id);
      expect(isBookableSeatResource(id)).toBe(true);
    }
  });

  it("keeps D7 staff-only and not bookable", () => {
    expect(SEAT_CATALOG[STAFF_ONLY_SEAT_RESOURCE_ID].displayId).toBe("D7");
    expect(SEAT_CATALOG[STAFF_ONLY_SEAT_RESOURCE_ID].staffOnly).toBe(true);
    expect(SEAT_CATALOG[STAFF_ONLY_SEAT_RESOURCE_ID].bookable).toBe(false);
    expect(SEAT_CATALOG[STAFF_ONLY_SEAT_RESOURCE_ID].tierId).toBe("equipped");
    expect(isBookableSeatResource("seat-7")).toBe(false);
    expect(accessibleSeatName("seat-7")).toMatch(/staff only/i);
  });

  it("keeps the private office out of the desk catalog and fallback seat map", () => {
    const spots = buildSeatMapSpots(null);
    expect(spots.map((spot) => spot.displayId)).toEqual(["D3", "D4", "D5", "D6", "D1", "D2", "D7"]);
    expect(spots.some((spot) => /office/i.test(spot.name))).toBe(false);
    expect(Object.keys(SEAT_CATALOG)).not.toEqual(expect.arrayContaining(["private-office", "office"]));
  });

  it("uses the decided guest tier rates and the confirmed member and plus overage", () => {
    expect(visibleGuestRates("seat-1")).toEqual({ hourly: "$17.50", halfDay: "$29", day: "$49" });
    expect(visibleGuestRates("seat-3")).toEqual({ hourly: "$19", halfDay: "$39", day: "$65" });
    expect(visibleGuestRates("seat-5")).toEqual({ hourly: "$22", halfDay: "$49", day: "$79" });
    expect(visibleGuestRates("seat-6")).toEqual(visibleGuestRates("seat-5"));
    expect(visibleGuestRates("seat-7")).toEqual(visibleGuestRates("seat-5"));
    expect(SEAT_TIERS.basic).toMatchObject({ memberOverageHourlyCents: 1400, plusOverageHourlyCents: 1225 });
    expect(SEAT_TIERS.window).toMatchObject({ memberOverageHourlyCents: 1520, plusOverageHourlyCents: 1330 });
    expect(SEAT_TIERS.equipped).toMatchObject({ memberOverageHourlyCents: 1760, plusOverageHourlyCents: 1540 });
    expect(visibleMemberOverage("seat-5")).toBe("$17.60");
    expect(visibleMemberOverage("seat-1")).toBe("$14");
    expect(visibleMemberOverage("unknown")).toBeNull();
    expect(formatUsdCents(undefined)).toBeNull();
  });

  it("lets a published Admin layout override fallback positions by resourceId or D-label", () => {
    const fallback = buildSeatMapSpots(null);
    const published = buildSeatMapSpots({
      canvasWidth: 1000,
      canvasHeight: 500,
      elements: [
        { type: "SEAT", resourceId: "seat-5", x: 100, y: 50, width: 100, height: 50 },
        { type: "SEAT", label: "D1 window", x: 0, y: 0, width: 100, height: 100 },
      ],
    });
    const d5 = published.find((spot) => spot.resourceId === "seat-5");
    const d1 = published.find((spot) => spot.resourceId === "seat-1");
    const d3 = published.find((spot) => spot.resourceId === "seat-3");
    expect(d5).toMatchObject({ source: "published", cx: 15, cy: 15 });
    expect(d1).toMatchObject({ source: "published", cx: 5, cy: 10 });
    expect(d3?.source).toBe("fallback");
    expect(d3?.cx).toBe(FALLBACK_SEAT_POSITIONS["seat-3"].cx);
    expect(fallback.find((spot) => spot.resourceId === "seat-5")?.source).toBe("fallback");
  });

  it("keeps D5 and D6 on the equipped (premium) tier", () => {
    expect(SEAT_CATALOG["seat-5"].tierId).toBe("equipped");
    expect(SEAT_CATALOG["seat-6"].tierId).toBe("equipped");
    expect(SEAT_CATALOG["seat-5"].amenities).toEqual(["sit-stand", "monitor-dock", "window"]);
    expect(SEAT_DISPLAY_ORDER).toContain("seat-5");
  });
});

describe("conference capacity", () => {
  it("is 6 in the canonical config and pricing constant", () => {
    expect(CONFERENCE_ROOM_CONFIG.maxCapacity).toBe(6);
    expect(RESOURCE_CATALOG["mode-conference"]?.capacity).toBe(6);
  });

  it("is 6 in the mirrored function configs and the catalog form default", () => {
    expect(read("apps/functions/src/payments/stripeConfig.ts")).toMatch(
      /CONFERENCE_ROOM_MAX_CAPACITY = 6/,
    );
    expect(read("apps/functions/src/config.ts")).toMatch(/mode-conference[\s\S]{0,200}capacity: 6/);
    expect(read("apps/functions/src/index.ts")).toMatch(/mode-conference[\s\S]{0,200}capacity: 6/);
    expect(read("apps/web/src/app/admin/spaces/catalog/page.tsx")).toMatch(
      /useState\(6\)/,
    );
    expect(read("apps/web/src/app/pricing/page.tsx")).toMatch(
      /CONFERENCE_ROOM_CONFIG\.maxCapacity/,
    );
  });
});

describe("booking UI wiring", () => {
  const booking = read("apps/web/src/components/BookingExperienceWithDeskChange.tsx");
  const picker = read("apps/web/src/components/booking/SeatMapPicker.tsx");
  const list = read("apps/web/src/components/booking/DeskOptionList.tsx");

  it("keeps the current card flow when the flag is off and only mounts the map when it is on", () => {
    expect(booking).toMatch(/SEAT_MAP_PICKER \? \(/);
    expect(booking).toMatch(/<SeatMapPicker/);
    expect(booking).toMatch(/<DeskOptionList/);
    expect(booking).not.toMatch(/from "react-konva"/);
    expect(picker).not.toMatch(/react-konva|FloorplanCanvas/);
  });

  it("marks selected desks with aria-pressed and a visible focus ring", () => {
    expect(list).toMatch(/aria-pressed=\{selected\}/);
    expect(list).toMatch(/focus-visible:outline-\[#101D4B\]/);
    expect(picker).toMatch(/aria-pressed=\{state === "selected"\}/);
    expect(picker).toMatch(/min-h-11 min-w-11/);
    expect(picker).toMatch(/data-seat-hit-target/);
    expect(picker).toMatch(/focus-visible:outline-\[#101D4B\]/);
    expect(picker).toMatch(/role="tablist"/);
    expect(booking).toMatch(/aria-pressed=\{selected\}/);
  });

  it("explains membership coverage per desk tier from the catalog, not hardcoded rates", () => {
    expect(picker).toMatch(/data-testid="seat-membership-coverage"/);
    expect(picker).toMatch(/Included in Coworking Plus hours/);
    expect(picker).not.toMatch(/checkout still uses the current hourly rate/i);
    expect(picker).not.toMatch(/Member average/);
    expect(list + picker).not.toMatch(/memberOverageHourlyCents:\s*[0-9]/);
  });
});

describe("architectural seat map", () => {
  const picker = read("apps/web/src/components/booking/SeatMapPicker.tsx");
  const plan = read("apps/web/src/components/booking/ArchitecturalFloorPlan.tsx");

  it("uses the reference viewBox and seat coordinates", () => {
    expect(SEAT_MAP_VIEWBOX).toEqual({ x: -55, y: -55, width: 950, height: 595 });
    expect(ARCHITECTURAL_SEAT_POINTS).toEqual({
      "seat-1": { x: 132, y: 189 },
      "seat-2": { x: 403, y: 189 },
      "seat-3": { x: 199, y: 455 },
      "seat-4": { x: 291, y: 455 },
      "seat-5": { x: 383, y: 455 },
      "seat-6": { x: 475, y: 455 },
      "seat-7": { x: 44, y: 398 },
    });
    for (const [id, point] of Object.entries(ARCHITECTURAL_SEAT_POINTS)) {
      const percent = FALLBACK_SEAT_POSITIONS[id as keyof typeof FALLBACK_SEAT_POSITIONS];
      expect(percent).toEqual(seatMapPointToPercent(point));
      const back = seatMapPercentToPoint(percent);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it("draws the architectural plan as the built-in default", () => {
    expect(picker).toMatch(/<ArchitecturalFloorPlan/);
    expect(picker).not.toMatch(/FloorPlanSchematic/);
    for (const feature of [
      "hic-wall-hatch",
      "CONF TABLE",
      "PRIVATE OFFICE",
      "PRINT",
      "Accessible restroom 5' turning circle",
      "Acoustic dividers",
      "Storefront door",
      "ArchitecturalChair",
      "16,288 110,288 110,418 74,418 74,324 16,324",
      "528,10 830,10 830,410 670,410 670,490 528,490",
    ]) {
      expect(plan).toContain(feature);
    }
    expect(plan).toMatch(/r=\{SEAT_BADGE_RADIUS\}/);
    expect(read("apps/web/src/lib/seatMapGeometry.ts")).toMatch(/SEAT_BADGE_RADIUS = 17\.5/);
  });

  it("keeps the published Admin background path", () => {
    expect(picker).toMatch(/backgroundUrl \? \(/);
    expect(read("apps/web/src/lib/seatMapLayout.ts")).toMatch(/resolvePublishedLayout/);
  });

  it("makes the private office a labeled room target and keeps the lounge unselectable", () => {
    expect(picker + plan).not.toMatch(/STAFF-PO|Staff only suite/);
    expect(plan).not.toMatch(/<button|role="button"|onClick/);
    expect(plan).toMatch(/data-plan-zone="private-office"/);
    expect(plan).toMatch(/data-plan-zone="lounge"/);
    expect(plan).not.toMatch(/>\s*LOUNGE\s*</);
    expect(plan).not.toMatch(/Not bookable/);
    expect(picker).toMatch(/data-office-hit-target/);
    expect(picker).toMatch(/PRIVATE_OFFICE_RESOURCE_ID/);
    expect(picker).toMatch(/officeOffered\s*\?\s*"Swipe the plan sideways to see the lounge and the bookable private office."/);
    expect(picker).toContain("Swipe the plan sideways to see the rest of the floor.");
    expect(buildSeatMapSpots(null).every((spot) => /^seat-[1-7]$/.test(spot.resourceId))).toBe(true);
  });

  it("does not copy the reference sample data, modal, or off-brand colors", () => {
    const ui = picker + plan + read("apps/web/src/components/booking/DeskOptionList.tsx");
    expect(ui).not.toMatch(/#0F172A|#FCFCFD/i);
    expect(ui).not.toMatch(/Confirm seat|reserved|Reception Desk|\$25|\$55|\$89/);
    expect(ui).toMatch(/#101D4B/);
    expect(picker).toMatch(/font-display/);
  });

  it("gives every seat at least a 44 px hit area with no overlap on phones and desktops", () => {
    for (const viewport of [320, 390, 430, 640, 768, 1024, 1280, 1440, 1920]) {
      const width = renderedPlanWidthPx(viewport);
      expect(width).toBeGreaterThanOrEqual(SEAT_MAP_MIN_WIDTH_PX);
      const hit = seatHitTargetPx(width);
      expect(hit).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(hit).toBeGreaterThan(seatBadgeDiameterPx(width));
      expect(overlappingSeatTargets(width)).toEqual([]);
    }
    expect(renderedPlanWidthPx(390)).toBe(SEAT_MAP_MIN_WIDTH_PX);
    expect(Math.round(seatHitTargetPx(renderedPlanWidthPx(390)))).toBe(44);
    expect(Math.round(seatHitTargetPx(renderedPlanWidthPx(1440)))).toBe(54);
  });
});

describe("staff-only D7 copy", () => {
  it("never shows D7 with a price in the picker or list", () => {
    expect(read("apps/web/src/components/booking/SeatMapPicker.tsx")).toMatch(/state === "staff" \? ""/);
    expect(read("apps/web/src/components/booking/DeskOptionList.tsx")).toMatch(/option\.staffOnly \? \(\s*<p[^>]*>Reception desk\. Not bookable\./);
  });
});
