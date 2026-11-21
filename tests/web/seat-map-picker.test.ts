import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOKABLE_SEAT_RESOURCE_IDS,
  CONFERENCE_ROOM_CONFIG,
  FALLBACK_SEAT_POSITIONS,
  RESOURCE_CATALOG,
  SEAT_CATALOG,
  SEAT_DISPLAY_ORDER,
  SEAT_TIERS,
  STAFF_ONLY_SEAT_RESOURCE_ID,
  accessibleSeatName,
  buildSeatMapSpots,
  displayIdForResource,
  formatUsdCents,
  isBookableSeatResource,
  resourceIdFromDisplayId,
  visibleGuestRates,
  visibleMemberOverage,
} from "../../packages/shared/src/index.ts";
import { resolveSeatMapPickerFlag } from "../../apps/web/src/lib/seatMapPickerFlag";

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

  it("omits the private office from the catalog and fallback map", () => {
    const spots = buildSeatMapSpots(null);
    expect(spots.map((spot) => spot.displayId)).toEqual(["D3", "D4", "D5", "D6", "D1", "D2", "D7"]);
    expect(spots.some((spot) => /office/i.test(spot.name))).toBe(false);
    expect(Object.keys(SEAT_CATALOG)).not.toEqual(expect.arrayContaining(["private-office", "office"]));
  });

  it("uses the decided guest tier rates and leaves Member equipped overage unset", () => {
    expect(visibleGuestRates("seat-1")).toEqual({ hourly: "$17.50", halfDay: "$29", day: "$49" });
    expect(visibleGuestRates("seat-3")).toEqual({ hourly: "$19", halfDay: "$39", day: "$65" });
    expect(visibleGuestRates("seat-5")).toEqual({ hourly: "$22", halfDay: "$49", day: "$79" });
    expect(visibleGuestRates("seat-6")).toEqual(visibleGuestRates("seat-5"));
    expect(visibleGuestRates("seat-7")).toEqual(visibleGuestRates("seat-5"));
    expect(SEAT_TIERS.equipped.memberOverageHourlyCents).toBeUndefined();
    expect(visibleMemberOverage("seat-5")).toBeNull();
    expect(visibleMemberOverage("seat-6")).toBeNull();
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
    expect(picker).toMatch(/min-h-11/);
    expect(picker).toMatch(/role="tablist"/);
    expect(booking).toMatch(/aria-pressed=\{selected\}/);
  });

  it("does not invent a Member equipped overage rate in the picker UI", () => {
    expect(picker).toMatch(/Member overage for Equipped desks is not set yet/);
    expect(list + picker).not.toMatch(/memberOverageHourlyCents:\s*[0-9]/);
  });
});
