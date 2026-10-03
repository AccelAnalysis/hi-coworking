import { describe, expect, it } from "vitest";
import {
  ANNUAL_MONTHS_BILLED,
  MEMBERSHIP_TIERS,
  annualSavingsCents,
  defaultCoworkingFloor,
  findSeatChangePlans,
  freeBlocksForSeat,
  membershipChargeCents,
  resolveBookingSelection,
  seatsAvailableForWindow,
  seatsFromLayoutElements,
  withConferenceArrangement,
} from "@hi/shared";
import {
  ANNUAL_MONTHS_BILLED as FUNCTION_ANNUAL_MONTHS,
  MEMBERSHIP_TIERS as FUNCTION_TIERS,
  membershipAmountCents,
  resolveMembershipCheckout,
} from "../../apps/functions/src/payments/stripeConfig";

const HOUR = 60 * 60 * 1000;
const start = Date.UTC(2030, 0, 2, 14, 0, 0, 0);
const end = start + 6 * HOUR;

const floorSeats = defaultCoworkingFloor().seats.map((seat) => ({
  resourceId: seat.resourceId,
  name: seat.label,
}));

function fragmentedBusy() {
  return [
    { resourceId: "seat-1", start: start + 3 * HOUR, end },
    { resourceId: "seat-2", start, end: start + 3 * HOUR },
    ...["seat-3", "seat-4", "seat-5", "seat-6"].map((resourceId) => ({
      resourceId,
      start,
      end,
    })),
  ];
}

describe("floor layout seats", () => {
  it("reads seat positions from a saved layout and ignores furniture", () => {
    const seats = seatsFromLayoutElements([
      { type: "WALL", x: 0, y: 0, width: 10, height: 10 },
      { type: "SEAT", resourceId: "seat-2", label: "Window desk", x: 40, y: 80, width: 90, height: 70 },
      { type: "DESK", resourceId: "seat-2", label: "Duplicate", x: 1, y: 1 },
      { type: "PLANT", x: 10, y: 10 },
      { type: "SEAT", resourceId: "seat-4", x: 200, y: 80, visible: false },
      { type: "SEAT", label: "Unassigned", x: 300, y: 80 },
    ]);

    expect(seats).toEqual([
      {
        resourceId: "seat-2",
        label: "Window desk",
        x: 40,
        y: 80,
        width: 90,
        height: 70,
        rotation: undefined,
      },
    ]);
  });

  it("starts from the 1,050 sq. ft. office plan with four storefront desks", () => {
    const floor = defaultCoworkingFloor();
    expect(floor.planId).toBe("carrollton-1050");
    expect(floor.seats.map((seat) => seat.label)).toEqual(["Desk 4", "Desk 3", "Desk 2", "Desk 1"]);
    expect(floor.seats.map((seat) => seat.resourceId)).toEqual(["seat-4", "seat-3", "seat-2", "seat-1"]);
    const xs = floor.seats.map((seat) => seat.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(floor.shell.some((shape) => shape.label === "Office")).toBe(true);
    expect(floor.shell.some((shape) => shape.label === "Customers")).toBe(true);
    expect(floor.shell.some((shape) => shape.label === "To Storage")).toBe(true);
    expect(floor.furniture.some((piece) => piece.label === "Reception Station")).toBe(true);
    expect(floor.furniture.some((piece) => piece.label === "Print Station")).toBe(true);
    expect(floor.furniture.some((piece) => piece.label === "Ref")).toBe(true);
    expect(floor.furniture.some((piece) => /5' radius/.test(piece.label || ""))).toBe(true);

    const openTable = floor.furniture.find((piece) => piece.role === "conference-table");
    const conference = withConferenceArrangement(floor.furniture);
    const movedTable = conference.find((piece) => piece.role === "conference-table");
    expect(openTable && movedTable).toBeTruthy();
    expect(movedTable!.y).toBeGreaterThan(openTable!.y + 40);
    expect(movedTable!.x + movedTable!.width / 2).toBeLessThan(floor.shell.find((shape) => shape.id === "wall-partition")!.x);
    const chairs = conference.filter((piece) => piece.role === "conference-chair");
    expect(chairs.length).toBeGreaterThanOrEqual(8);
    const north = chairs.filter((chair) => chair.y + chair.height < movedTable!.y);
    const south = chairs.filter((chair) => chair.y > movedTable!.y + movedTable!.height);
    expect(north.length).toBeGreaterThan(0);
    expect(south.length).toBeGreaterThan(0);
  });
});

describe("seat and time selection", () => {
  const open = [{ start, end }];

  it("shows the open times for a seat chosen first", () => {
    const busy = [{ resourceId: "seat-1", start: start + 2 * HOUR, end: start + 4 * HOUR }];
    const blocks = freeBlocksForSeat("seat-1", open, busy);

    expect(blocks).toEqual([
      { start, end: start + 2 * HOUR },
      { start: start + 4 * HOUR, end },
    ]);
    expect(freeBlocksForSeat("seat-2", open, busy)).toEqual([{ start, end }]);
  });

  it("shows which seats are free after the time is chosen", () => {
    const windowStart = start + HOUR;
    const windowEnd = start + 3 * HOUR;
    const available = seatsAvailableForWindow(
      ["seat-1", "seat-2"],
      windowStart,
      windowEnd,
      [{ resourceId: "seat-1", start: windowStart, end: windowEnd }],
    );

    expect(available).toEqual([
      { resourceId: "seat-1", available: false },
      { resourceId: "seat-2", available: true },
    ]);
  });

  it("offers a two-seat combination when no single seat covers the stay", () => {
    const plans = findSeatChangePlans(floorSeats, start, end, fragmentedBusy());

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      planId: `seat-1:${start + 3 * HOUR}:seat-2`,
      kind: "desk_change",
      changeAt: start + 3 * HOUR,
      segments: [
        { resourceId: "seat-1", start, end: start + 3 * HOUR },
        { resourceId: "seat-2", start: start + 3 * HOUR, end },
      ],
    });

    const resolved = resolveBookingSelection({
      seats: floorSeats,
      preferredSeatIds: ["seat-1"],
      start,
      end,
      busy: fragmentedBusy(),
    });
    expect(resolved.kind).toBe("desk_change");
    if (resolved.kind === "desk_change") {
      expect(resolved.plan.segments.map((segment) => segment.resourceId)).toEqual(["seat-1", "seat-2"]);
    }
  });

  it("keeps a continuous seat when one selected seat covers the whole stay", () => {
    const busy = fragmentedBusy().filter((record) => record.resourceId !== "seat-3");
    const resolved = resolveBookingSelection({
      seats: floorSeats,
      preferredSeatIds: ["seat-3", "seat-1"],
      start,
      end,
      busy,
    });

    expect(resolved).toEqual({
      kind: "single",
      resourceId: "seat-3",
      resourceName: "Desk 3",
    });
    expect(findSeatChangePlans(floorSeats, start, end, busy)).toEqual([]);
  });

  it("does not invent a combination the checkout cannot book", () => {
    const shortEnd = start + 90 * 60 * 1000;
    const busy = floorSeats.map((seat) => ({ resourceId: seat.resourceId, start, end: shortEnd }));
    expect(findSeatChangePlans(floorSeats, start, shortEnd, busy)).toEqual([]);
    expect(resolveBookingSelection({
      seats: floorSeats,
      start,
      end: shortEnd,
      busy,
    })).toEqual({ kind: "unavailable" });
  });
});

describe("membership pricing", () => {
  it("keeps monthly prices and bills annual as ten months", () => {
    expect(ANNUAL_MONTHS_BILLED).toBe(10);
    expect(FUNCTION_ANNUAL_MONTHS).toBe(ANNUAL_MONTHS_BILLED);

    for (const tier of MEMBERSHIP_TIERS) {
      expect(membershipChargeCents(tier.amountCents, "month")).toBe(tier.amountCents);
      expect(membershipChargeCents(tier.amountCents, "year")).toBe(tier.amountCents * 10);
      expect(annualSavingsCents(tier.amountCents)).toBe(tier.amountCents * 2);

      const functionTier = FUNCTION_TIERS.find((candidate) => candidate.id === tier.id);
      expect(functionTier?.amountCents).toBe(tier.amountCents);
      expect(membershipAmountCents(functionTier!, "month")).toBe(tier.amountCents);
      expect(membershipAmountCents(functionTier!, "year")).toBe(tier.amountCents * 10);
    }
  });

  it("uses the live monthly Stripe price and an annual price only when one is configured", () => {
    const coworking = FUNCTION_TIERS.find((tier) => tier.id === "coworking")!;
    expect(resolveMembershipCheckout(coworking, "month")).toMatchObject({
      interval: "month",
      amountCents: 12900,
      pricingMode: "price",
      stripePriceId: coworking.stripePriceId,
    });
    expect(resolveMembershipCheckout(coworking, "year")).toMatchObject({
      interval: "year",
      amountCents: 129000,
      pricingMode: "price_data",
      stripePriceId: "",
    });

    const withAnnual = { ...coworking, stripeAnnualPriceId: "price_annual_test" };
    expect(resolveMembershipCheckout(withAnnual, "year").stripePriceId).toBe("price_annual_test");
    expect(resolveMembershipCheckout(withAnnual, "year").pricingMode).toBe("price");
  });
});
