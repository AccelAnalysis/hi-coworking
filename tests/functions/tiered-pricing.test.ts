import { describe, expect, it } from "vitest";
import {
  capDeskCharge,
  conferenceSlotFor,
  deskPricingPlanFor,
  priceDeskSegments,
  type DeskPricingPlan,
} from "../../apps/functions/src/payments/deskPricing";
import {
  CONFERENCE_ROOM_MAX_CAPACITY,
  CONFERENCE_ROOM_SLOT_PRICE_CENTS,
  CONFERENCE_SLOT_MESSAGE,
  DESK_SEAT_TIERS,
  MEMBERSHIP_TIERS as FUNCTIONS_TIERS,
  getDeskMembershipTierById,
  getTierById,
  getTierByPriceId,
  isLegacyStripePriceId,
} from "../../apps/functions/src/payments/stripeConfig";
import { MEMBERSHIP_TIERS as CONFIG_TIERS } from "../../apps/functions/src/config";
import {
  RESOURCE_CONFIG,
  checkoutLineLabel,
  priceChoice,
  resourceConflicts,
  type BookingChoice,
  type BookingQuote,
} from "../../apps/functions/src/bookingFlexShared";
import * as shared from "../../packages/shared/src";

const HOUR = 3_600_000;
// Wednesday 2 January 2030; Eastern Standard Time (UTC-5).
const at = (hour: number, minute = 0) => Date.UTC(2030, 0, 2, hour + 5, minute, 0, 0);

const desk = (resourceId: string): BookingChoice => ({
  kind: "single",
  resourceId,
  resourceName: RESOURCE_CONFIG[resourceId].name,
  resourceType: "SEAT",
});
const conference: BookingChoice = {
  kind: "single",
  resourceId: "mode-conference",
  resourceName: "Meeting setup",
  resourceType: "MODE",
};
const member = getDeskMembershipTierById("coworking")!;
const plus = getDeskMembershipTierById("coworking_plus")!;

const LIVE = {
  virtual: "price_1UfCfpAHu8lEXCs8Xw0ruygi",
  coworking: "price_1UfCfvAHu8lEXCs85BgcHiJy",
  coworking_plus: "price_1UfCfxAHu8lEXCs8ueNs9jAk",
} as const;
const LEGACY = {
  virtual: "price_1U9J0xAHu8lEXCs8UHv7AAiz",
  coworking: "price_1U9J1CAHu8lEXCs8X1o0O5hG",
  coworking_plus: "price_1U9J1KAHu8lEXCs8xZETzk7F",
} as const;

const price = (plan: DeskPricingPlan, resourceId: string, hours: number, included = 0) =>
  priceDeskSegments({ plan, segments: [{ resourceId, hours }], includedHoursRemaining: included });

describe("membership plans and live Stripe prices", () => {
  it("defines SayHi Connect $69, Coworking Member $159, Coworking Plus $289 with live price ids", () => {
    for (const tiers of [FUNCTIONS_TIERS, shared.MEMBERSHIP_TIERS]) {
      const byId = Object.fromEntries(tiers.map((tier) => [tier.id, tier]));
      expect(byId.virtual).toMatchObject({ name: "SayHi Connect", amountCents: 6900, includedHoursPerMonth: 0, bookingWindowDays: 14, stripePriceId: LIVE.virtual, stripeLookupKey: "hic_sayhi_connect_monthly", overageDiscountPercent: 0 });
      expect(byId.coworking).toMatchObject({ name: "Coworking Member", amountCents: 15900, includedHoursPerMonth: 36, bookingWindowDays: 90, stripePriceId: LIVE.coworking, stripeLookupKey: "hic_coworking_member_monthly", overageDiscountPercent: 20, includedSeatTiers: ["basic", "window"] });
      expect(byId.coworking_plus).toMatchObject({ name: "Coworking Plus", amountCents: 28900, includedHoursPerMonth: 54, bookingWindowDays: 90, stripePriceId: LIVE.coworking_plus, stripeLookupKey: "hic_coworking_plus_monthly", overageDiscountPercent: 30, includedSeatTiers: ["basic", "window", "equipped"] });
      for (const id of Object.keys(LEGACY) as Array<keyof typeof LEGACY>) {
        expect(byId[id].legacyStripePriceIds).toEqual([LEGACY[id]]);
      }
    }
  });

  it("keeps the credits/limits config mirror on the same prices and hours", () => {
    for (const tier of CONFIG_TIERS) {
      const billing = getTierById(tier.id)!;
      expect(tier).toMatchObject({
        name: billing.name,
        amountCents: billing.amountCents,
        stripePriceId: billing.stripePriceId,
        includedHoursPerMonth: billing.includedHoursPerMonth,
      });
      expect(tier.legacyStripePriceIds).toEqual(billing.legacyStripePriceIds);
    }
  });

  it("resolves both live and legacy price ids so webhooks and history never break", () => {
    for (const id of Object.keys(LIVE) as Array<keyof typeof LIVE>) {
      expect(getTierByPriceId(LIVE[id])?.id).toBe(id);
      expect(getTierByPriceId(LEGACY[id])?.id).toBe(id);
      expect(shared.getMembershipTierByPriceId(LIVE[id])?.id).toBe(id);
      expect(shared.getMembershipTierByPriceId(LEGACY[id])?.id).toBe(id);
      expect(isLegacyStripePriceId(LEGACY[id])).toBe(true);
      expect(isLegacyStripePriceId(LIVE[id])).toBe(false);
    }
    expect(getTierByPriceId("price_unknown")).toBeUndefined();
    expect(getTierByPriceId("")).toBeUndefined();
  });

  it("retires Virtual Office / Virtual Plus wording and mentions bundled Founders access", () => {
    for (const tier of [...FUNCTIONS_TIERS, ...shared.MEMBERSHIP_TIERS]) {
      expect(`${tier.name} ${tier.features.join(" ")}`).not.toMatch(/Virtual Office|Virtual Plus/);
    }
    expect(getTierById("virtual")!.features.join(" ")).toMatch(/Accel Procurement Founders access/);
    expect(getTierById("virtual")!.features.join(" ")).toMatch(/No mail service/);
  });

  it("gives only Member and Plus desk-plan pricing; SayHi Connect books at guest rates", () => {
    expect(getDeskMembershipTierById("virtual")).toBeUndefined();
    expect(deskPricingPlanFor("virtual")).toBe("guest");
    expect(deskPricingPlanFor(undefined)).toBe("guest");
    expect(deskPricingPlanFor("coworking")).toBe("member");
    expect(deskPricingPlanFor("coworking_plus")).toBe("plus");
  });
});

describe("desk tier rates (D1–D6)", () => {
  it("mirrors the shared seat catalog exactly", () => {
    for (const id of ["basic", "window", "equipped"] as const) {
      const { id: _a, name: _b, shortLabel: _c, ...sharedRates } = shared.SEAT_TIERS[id];
      const { id: _d, name: _e, ...functionRates } = DESK_SEAT_TIERS[id];
      expect(functionRates).toEqual(sharedRates);
    }
    expect(DESK_SEAT_TIERS.basic).toMatchObject({ guestHourlyCents: 1750, guestHalfDayCents: 2900, guestDayCents: 4900, memberOverageHourlyCents: 1400, plusOverageHourlyCents: 1225 });
    expect(DESK_SEAT_TIERS.window).toMatchObject({ guestHourlyCents: 1900, guestHalfDayCents: 3900, guestDayCents: 6500, memberOverageHourlyCents: 1520, plusOverageHourlyCents: 1330 });
    expect(DESK_SEAT_TIERS.equipped).toMatchObject({ guestHourlyCents: 2200, guestHalfDayCents: 4900, guestDayCents: 7900, memberOverageHourlyCents: 1760, plusOverageHourlyCents: 1540 });
  });

  it("uses per-seat guest rates in the booking resource config", () => {
    expect(["seat-1", "seat-2"].map((id) => RESOURCE_CONFIG[id].guestRateHourlyCents)).toEqual([1750, 1750]);
    expect(["seat-3", "seat-4"].map((id) => RESOURCE_CONFIG[id].guestRateHourlyCents)).toEqual([1900, 1900]);
    expect(["seat-5", "seat-6"].map((id) => RESOURCE_CONFIG[id].guestRateHourlyCents)).toEqual([2200, 2200]);
    expect(RESOURCE_CONFIG["seat-7"]).toBeUndefined();
  });

  it("caps at the half-day price up to 4 billable hours and the day price beyond", () => {
    const basic = DESK_SEAT_TIERS.basic;
    expect(capDeskCharge(1, 1750, basic)).toEqual({ subtotalCents: 1750, capApplied: null });
    expect(capDeskCharge(1.5, 1750, basic)).toEqual({ subtotalCents: 2625, capApplied: null });
    expect(capDeskCharge(2, 1750, basic)).toEqual({ subtotalCents: 2900, capApplied: "half_day" });
    expect(capDeskCharge(4, 1750, basic)).toEqual({ subtotalCents: 2900, capApplied: "half_day" });
    expect(capDeskCharge(4.5, 1750, basic)).toEqual({ subtotalCents: 4900, capApplied: "day" });
    expect(capDeskCharge(9, 1750, basic)).toEqual({ subtotalCents: 4900, capApplied: "day" });
    expect(capDeskCharge(0, 1750, basic)).toEqual({ subtotalCents: 0, capApplied: null });
  });
});

type Row = [plan: DeskPricingPlan, resourceId: string, hours: number, included: number, subtotal: number, includedApplied: number, cap: "half_day" | "day" | null];

const MATRIX: Row[] = [
  // Guest (and SayHi Connect) — hourly, half-day, full day, cap boundaries per tier.
  ["guest", "seat-1", 1, 0, 1750, 0, null],
  ["guest", "seat-1", 1.5, 0, 2625, 0, null],
  ["guest", "seat-1", 2, 0, 2900, 0, "half_day"],
  ["guest", "seat-1", 4, 0, 2900, 0, "half_day"],
  ["guest", "seat-1", 5, 0, 4900, 0, "day"],
  ["guest", "seat-1", 9, 0, 4900, 0, "day"],
  ["guest", "seat-3", 1, 0, 1900, 0, null],
  ["guest", "seat-3", 2, 0, 3800, 0, null],
  ["guest", "seat-3", 2.5, 0, 3900, 0, "half_day"],
  ["guest", "seat-3", 4, 0, 3900, 0, "half_day"],
  ["guest", "seat-3", 4.5, 0, 6500, 0, "day"],
  ["guest", "seat-3", 9, 0, 6500, 0, "day"],
  ["guest", "seat-5", 1, 0, 2200, 0, null],
  ["guest", "seat-5", 2, 0, 4400, 0, null],
  ["guest", "seat-5", 2.5, 0, 4900, 0, "half_day"],
  ["guest", "seat-5", 4, 0, 4900, 0, "half_day"],
  ["guest", "seat-5", 4.5, 0, 7900, 0, "day"],
  ["guest", "seat-6", 9, 0, 7900, 0, "day"],
  // Member: D1–D4 included.
  ["member", "seat-1", 4, 36, 0, 4, null],
  ["member", "seat-2", 9, 36, 0, 9, null],
  ["member", "seat-4", 9, 36, 0, 9, null],
  // Member: over 36 hours → 20% off, capped.
  ["member", "seat-1", 1, 0, 1400, 0, null],
  ["member", "seat-1", 4, 0, 2900, 0, "half_day"],
  ["member", "seat-1", 9, 0, 4900, 0, "day"],
  ["member", "seat-3", 2, 0, 3040, 0, null],
  ["member", "seat-3", 4, 0, 3900, 0, "half_day"],
  ["member", "seat-3", 9, 0, 6500, 0, "day"],
  ["member", "seat-1", 9, 6, 2900, 6, "half_day"],
  ["member", "seat-3", 4, 3, 1520, 3, null],
  ["member", "seat-3", 9, 4, 6500, 4, "day"],
  // Member on Equipped D5–D6: never included, 20% off, capped.
  ["member", "seat-5", 1, 36, 1760, 0, null],
  ["member", "seat-5", 2, 36, 3520, 0, null],
  ["member", "seat-6", 4, 36, 4900, 0, "half_day"],
  ["member", "seat-5", 9, 36, 7900, 0, "day"],
  // Plus: D1–D6 included.
  ["plus", "seat-1", 9, 54, 0, 9, null],
  ["plus", "seat-3", 4, 54, 0, 4, null],
  ["plus", "seat-5", 9, 54, 0, 9, null],
  // Plus: over 54 hours → 30% off, capped.
  ["plus", "seat-1", 1, 0, 1225, 0, null],
  ["plus", "seat-1", 2, 0, 2450, 0, null],
  ["plus", "seat-1", 4, 0, 2900, 0, "half_day"],
  ["plus", "seat-3", 2, 0, 2660, 0, null],
  ["plus", "seat-3", 4, 0, 3900, 0, "half_day"],
  ["plus", "seat-5", 3, 0, 4620, 0, null],
  ["plus", "seat-5", 4, 0, 4900, 0, "half_day"],
  ["plus", "seat-6", 9, 0, 7900, 0, "day"],
  ["plus", "seat-5", 9, 2, 7900, 2, "day"],
  ["plus", "seat-5", 3, 1, 3080, 1, null],
];

describe("desk pricing matrix: tiers × plans × hourly / half-day / full day", () => {
  it.each(MATRIX)("%s %s %sh (included %s) → %s cents", (plan, resourceId, hours, included, subtotal, includedApplied, cap) => {
    const result = price(plan, resourceId, hours, included);
    expect(result.subtotalCents).toBe(subtotal);
    expect(result.includedHoursApplied).toBe(includedApplied);
    expect(result.billableHours).toBe(hours - includedApplied);
    expect(result.capApplied).toBe(cap);
  });

  it("matches the shared preview engine exactly for every case", () => {
    for (const [plan, resourceId, hours, included] of MATRIX) {
      const input = { plan, segments: [{ resourceId, hours }], includedHoursRemaining: included };
      expect(shared.priceDeskSegments(input)).toEqual(priceDeskSegments(input));
    }
  });

  it("rejects staff-only or unknown desks", () => {
    expect(() => price("guest", "seat-7", 1)).toThrow(/Unknown desk/);
    expect(() => shared.priceDeskSegments({ plan: "guest", segments: [{ resourceId: "seat-7", hours: 1 }], includedHoursRemaining: 0 })).toThrow(/Unknown desk/);
  });
});

describe("priceChoice (server quote and hold pricing)", () => {
  it("bills presets: Morning and Afternoon at the half-day price, Full day at the day price", () => {
    expect(priceChoice(desk("seat-1"), at(8), at(12))).toMatchObject({ subtotalCents: 2900, capApplied: "half_day", dailyCapApplied: true, membershipName: null });
    expect(priceChoice(desk("seat-3"), at(13), at(17))).toMatchObject({ subtotalCents: 3900, capApplied: "half_day" });
    expect(priceChoice(desk("seat-5"), at(8), at(17))).toMatchObject({ subtotalCents: 7900, capApplied: "day" });
    expect(priceChoice(desk("seat-5"), at(9), at(10, 30))).toMatchObject({ subtotalCents: 3300, capApplied: null, dailyCapApplied: false, hourlyRateCents: 2200 });
  });

  it("applies member allowance on D1–D4 and member overage on D5–D6", () => {
    expect(priceChoice(desk("seat-4"), at(8), at(17), { membershipTier: member, includedHoursRemaining: 36 }))
      .toMatchObject({ subtotalCents: 0, includedHoursApplied: 9, billableHours: 0, membershipName: "Coworking Member" });
    expect(priceChoice(desk("seat-5"), at(8), at(12), { membershipTier: member, includedHoursRemaining: 36 }))
      .toMatchObject({ subtotalCents: 4900, includedHoursApplied: 0, billableHours: 4, hourlyRateCents: 1760, capApplied: "half_day" });
    expect(priceChoice(desk("seat-5"), at(8), at(17), { membershipTier: plus, includedHoursRemaining: 54 }))
      .toMatchObject({ subtotalCents: 0, includedHoursApplied: 9 });
  });

  it("prices desk changes per segment tier and per-segment allowance eligibility", () => {
    const change: BookingChoice = {
      kind: "desk_change",
      resourceId: "seat-flex",
      resourceName: "Desk 1 → Desk 5",
      resourceType: "SEAT",
      planId: `seat-1:${at(11)}:seat-5`,
      segments: [
        { resourceId: "seat-1", resourceName: "Desk 1", start: at(8), end: at(11) },
        { resourceId: "seat-5", resourceName: "Desk 5", start: at(11), end: at(14) },
      ],
    };
    // Member: 3h on D1 covered, 3h on D5 billed at $17.60 = $52.80 → capped at Equipped half-day $49.
    const memberQuote = priceChoice(change, at(8), at(14), { membershipTier: member, includedHoursRemaining: 36 });
    expect(memberQuote).toMatchObject({ includedHoursApplied: 3, billableHours: 3, subtotalCents: 4900, capApplied: "half_day" });
    expect(memberQuote.segmentPricing?.map((segment) => [segment.tierId, segment.includedHoursApplied, segment.subtotalCents]))
      .toEqual([["basic", 3, 0], ["equipped", 0, 4900]]);
    // Guest: 3h D1 capped at $29 + 3h D5 capped at $49 = $78, already under the Equipped day price ($79).
    expect(priceChoice(change, at(8), at(14))).toMatchObject({ subtotalCents: 7800, includedHoursApplied: 0, billableHours: 6, capApplied: "half_day" });
    // Plus: both segments covered.
    expect(priceChoice(change, at(8), at(14), { membershipTier: plus, includedHoursRemaining: 54 })).toMatchObject({ subtotalCents: 0, includedHoursApplied: 6 });
    // Plus with 2 hours left: 2h of D1 covered; 1h D1 at $12.25 + 3h D5 at $15.40 = $58.45 → capped at Equipped half-day $49.
    expect(priceChoice(change, at(8), at(14), { membershipTier: plus, includedHoursRemaining: 2 })).toMatchObject({ includedHoursApplied: 2, billableHours: 4, subtotalCents: 4900, capApplied: "half_day" });
  });

  it("never lets a multi-desk booking cost more than a single priciest-tier day", () => {
    const change: BookingChoice = {
      kind: "desk_change",
      resourceId: "seat-flex",
      resourceName: "Desk 5 → Desk 3",
      resourceType: "SEAT",
      planId: `seat-5:${at(12, 30)}:seat-3`,
      segments: [
        { resourceId: "seat-5", resourceName: "Desk 5", start: at(8), end: at(12, 30) },
        { resourceId: "seat-3", resourceName: "Desk 3", start: at(12, 30), end: at(17) },
      ],
    };
    // 4.5h D5 ($79 day) + 4.5h D3 ($65 day) = $144 → capped at the Equipped day price.
    expect(priceChoice(change, at(8), at(17))).toMatchObject({ subtotalCents: 7900, capApplied: "day" });
  });
});

describe("weekday 4-hour conference slots ($249)", () => {
  it("is marketed as 6 seats everywhere", () => {
    expect(CONFERENCE_ROOM_MAX_CAPACITY).toBe(6);
    expect(shared.CONFERENCE_ROOM_MAX_CAPACITY).toBe(6);
    expect(shared.CONFERENCE_ROOM_CONFIG).toMatchObject({ maxCapacity: 6, slotPriceCents: 24900, slotHours: 4, afterHoursSlotPriceCents: 29900 });
    expect(shared.RESOURCE_CATALOG["mode-conference"].capacity).toBe(6);
  });

  it("prices Morning 8–12 and Afternoon 1–5 at a flat $249", () => {
    expect(CONFERENCE_ROOM_SLOT_PRICE_CENTS).toBe(24900);
    expect(priceChoice(conference, at(8), at(12))).toMatchObject({ subtotalCents: 24900, conferenceSlot: "morning", membershipName: null, includedHoursApplied: 0 });
    expect(priceChoice(conference, at(13), at(17))).toMatchObject({ subtotalCents: 24900, conferenceSlot: "afternoon" });
    // Membership hours never cover the conference room.
    expect(priceChoice(conference, at(8), at(12), { membershipTier: plus, includedHoursRemaining: 54 })).toMatchObject({ subtotalCents: 24900, includedHoursApplied: 0 });
    expect(conferenceSlotFor(8 * 60, 12 * 60)).toBe("morning");
    expect(conferenceSlotFor(13 * 60, 17 * 60)).toBe("afternoon");
    expect(shared.conferenceSlotForTimes("08:00", "12:00")).toBe("morning");
    expect(shared.conferenceSlotForTimes("13:00", "17:00")).toBe("afternoon");
  });

  it.each([
    ["full weekday", 8, 17],
    ["one hour", 9, 10],
    ["off-slot four hours", 9, 13],
    ["midday", 12, 16],
    ["two hours", 13, 15],
  ])("rejects %s with a clear message", (_label, startHour, endHour) => {
    expect(() => priceChoice(conference, at(startHour), at(endHour))).toThrow(CONFERENCE_SLOT_MESSAGE);
  });

  it("blocks every bookable desk D1–D6 while the room is booked", () => {
    const busy = [{ resourceId: "mode-conference", start: at(8), end: at(12), status: "CONFIRMED" }];
    for (const seat of ["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6"]) {
      expect(RESOURCE_CONFIG[seat].exclusiveGroupId).toBe("main_space");
      expect(resourceConflicts(seat, at(9), at(10), busy)).toBe(true);
      expect(resourceConflicts(seat, at(13), at(14), busy)).toBe(false);
    }
    const deskBusy = [{ resourceId: "seat-6", start: at(13), end: at(14), status: "CONFIRMED" }];
    expect(resourceConflicts("mode-conference", at(13), at(17), deskBusy)).toBe(true);
  });
});

describe("checkout line descriptions", () => {
  const base = {
    resourceId: "seat-3",
    resourceName: "Desk 3",
    resourceType: "SEAT",
    bookingKind: "single",
    durationHours: 4,
  } as BookingQuote;
  it("names the desk, length and cap, and the conference slot", () => {
    expect(checkoutLineLabel({ ...base, capApplied: "half_day" })).toBe("Desk 3 · 4 hours (half-day price)");
    expect(checkoutLineLabel({ ...base, durationHours: 9, capApplied: "day" })).toBe("Desk 3 · 9 hours (day price)");
    expect(checkoutLineLabel({ ...base, durationHours: 1, capApplied: null })).toBe("Desk 3 · 1 hour");
    expect(checkoutLineLabel({ ...base, resourceType: "MODE", resourceName: "Meeting setup", conferenceSlot: "afternoon" }))
      .toBe("Conference room · Afternoon 1–5 PM · 4-hour slot");
  });
});

describe("no stale pricing in active surfaces", () => {
  it("drops the $115 daily cap, $99/hr conference, and 10/15-hour allowances", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      "packages/shared/src/index.ts",
      "packages/shared/src/seatCatalog.ts",
      "apps/functions/src/payments/stripeConfig.ts",
      "apps/functions/src/config.ts",
      "apps/functions/src/bookingFlexShared.ts",
      "apps/functions/src/bookingFlexTransaction.ts",
      "apps/functions/src/adminMemberOperations.ts",
      "apps/functions/src/payments/membershipWelcomeEmail.ts",
      "apps/functions/src/bookingConfirmationEmail.ts",
      "apps/web/src/app/pricing/page.tsx",
      "apps/web/src/components/BookingExperienceWithDeskChange.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/GUEST_DAILY_CAP_CENTS|dailyCapCents|11500|CONFERENCE_ROOM_HOURLY_RATE_CENTS|hourlyRateCents: 9900/);
      expect(source, file).not.toMatch(/Virtual Office|Virtual Plus/);
      expect(source, file).not.toMatch(/includedHoursPerMonth: (10|15),/);
      expect(source, file).not.toMatch(/amountCents: (4900|12900|19900),/);
    }
  });
});
