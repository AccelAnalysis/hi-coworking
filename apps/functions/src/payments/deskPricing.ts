/**
 * Pure desk and conference pricing (no Firebase imports).
 *
 * MIRROR of packages/shared/src/deskPricing.ts — kept inline because
 * @hi/shared is ESM-only. tests/functions/tiered-pricing.test.ts checks the
 * two produce identical results.
 *
 * Rules (Jonathan, 24 Nov 2026):
 * - Guests and SayHi Connect pay the seat tier's guest hourly rate.
 * - Coworking Member: included hours cover Basic and Window seats (D1–D4).
 *   Hours beyond the allowance, and any time on Equipped seats (D5–D6), bill
 *   at 20% off that seat's guest rate.
 * - Coworking Plus: included hours cover D1–D6; extra hours bill at 30% off.
 * - Every billable amount is capped per seat tier: up to 4 billable hours
 *   never cost more than the half-day price; longer never more than the day
 *   price. A 4-hour Morning (8–12) or Afternoon (1–5) bills the half-day
 *   price and a 9-hour Full day (8–5) bills the day price.
 * - Desk-change bookings price each segment on its own seat tier, then the
 *   total is capped at the half-day/day price of the priciest billable tier.
 */
import {
  CONFERENCE_ROOM_SLOT_PRICE_CENTS,
  CONFERENCE_ROOM_WEEKDAY_SLOTS,
  DESK_SEAT_TIERS,
  DESK_SEAT_TIER_BY_RESOURCE,
  HALF_DAY_HOURS,
  type ConferenceSlotId,
  type DeskSeatTierId,
  type DeskSeatTierRates,
  type MembershipTierId,
} from "./stripeConfig";

export type DeskPricingPlan = "guest" | "member" | "plus";
export type DeskCapApplied = "half_day" | "day" | null;

export type DeskPricingSegmentInput = { resourceId: string; hours: number };

export type DeskPricingSegment = {
  resourceId: string;
  tierId: DeskSeatTierId;
  hours: number;
  includedHoursApplied: number;
  billableHours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  capApplied: DeskCapApplied;
};

export type DeskPricingResult = {
  plan: DeskPricingPlan;
  segments: DeskPricingSegment[];
  durationHours: number;
  includedHoursApplied: number;
  billableHours: number;
  /** Rate on the first billable segment (or the first segment). */
  hourlyRateCents: number;
  subtotalCents: number;
  capApplied: DeskCapApplied;
};

const INCLUDED_TIERS: Record<DeskPricingPlan, readonly DeskSeatTierId[]> = {
  guest: [],
  member: ["basic", "window"],
  plus: ["basic", "window", "equipped"],
};

/** Membership plan id → pricing plan. SayHi Connect (`virtual`) and no plan are guest pricing. */
export function deskPricingPlanFor(planId: MembershipTierId | string | null | undefined): DeskPricingPlan {
  if (planId === "coworking") return "member";
  if (planId === "coworking_plus") return "plus";
  return "guest";
}

export function deskTierFor(resourceId: string): DeskSeatTierRates | undefined {
  const tierId = DESK_SEAT_TIER_BY_RESOURCE[resourceId];
  return tierId ? DESK_SEAT_TIERS[tierId] : undefined;
}

export function deskHourlyRateCents(plan: DeskPricingPlan, tier: DeskSeatTierRates): number {
  if (plan === "member") return tier.memberOverageHourlyCents;
  if (plan === "plus") return tier.plusOverageHourlyCents;
  return tier.guestHourlyCents;
}

export function planCoversTier(plan: DeskPricingPlan, tierId: DeskSeatTierId): boolean {
  return INCLUDED_TIERS[plan].includes(tierId);
}

function roundHours(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Cap one billable duration at the tier's half-day (≤4h) or day (>4h) price. */
export function capDeskCharge(
  billableHours: number,
  hourlyRateCents: number,
  tier: Pick<DeskSeatTierRates, "guestHalfDayCents" | "guestDayCents">,
): { subtotalCents: number; capApplied: DeskCapApplied } {
  if (!(billableHours > 0)) return { subtotalCents: 0, capApplied: null };
  const uncapped = Math.round(billableHours * hourlyRateCents);
  const halfDay = billableHours <= HALF_DAY_HOURS;
  const cap = halfDay ? tier.guestHalfDayCents : tier.guestDayCents;
  return uncapped > cap
    ? { subtotalCents: cap, capApplied: halfDay ? "half_day" : "day" }
    : { subtotalCents: uncapped, capApplied: null };
}

export function priceDeskSegments(input: {
  plan: DeskPricingPlan;
  segments: DeskPricingSegmentInput[];
  includedHoursRemaining: number;
}): DeskPricingResult {
  let remaining = Math.max(0, Number(input.includedHoursRemaining) || 0);
  const segments: DeskPricingSegment[] = input.segments.map((segment) => {
    const tierId = DESK_SEAT_TIER_BY_RESOURCE[segment.resourceId];
    if (!tierId) throw new Error(`Unknown desk resource: ${segment.resourceId}`);
    const tier = DESK_SEAT_TIERS[tierId];
    const hours = Math.max(0, segment.hours);
    const includedHoursApplied = planCoversTier(input.plan, tierId)
      ? roundHours(Math.min(hours, remaining))
      : 0;
    remaining = roundHours(remaining - includedHoursApplied);
    const billableHours = roundHours(hours - includedHoursApplied);
    const hourlyRateCents = deskHourlyRateCents(input.plan, tier);
    const charge = capDeskCharge(billableHours, hourlyRateCents, tier);
    return {
      resourceId: segment.resourceId,
      tierId,
      hours,
      includedHoursApplied,
      billableHours,
      hourlyRateCents,
      subtotalCents: charge.subtotalCents,
      capApplied: charge.capApplied,
    };
  });

  const durationHours = roundHours(segments.reduce((sum, s) => sum + s.hours, 0));
  const includedHoursApplied = roundHours(segments.reduce((sum, s) => sum + s.includedHoursApplied, 0));
  const billableHours = roundHours(segments.reduce((sum, s) => sum + s.billableHours, 0));
  let subtotalCents = segments.reduce((sum, s) => sum + s.subtotalCents, 0);
  let capApplied: DeskCapApplied = segments.find((s) => s.capApplied)?.capApplied ?? null;

  const billable = segments.filter((s) => s.billableHours > 0);
  if (billable.length > 1) {
    const priciest = billable
      .map((s) => DESK_SEAT_TIERS[s.tierId])
      .reduce((a, b) => (b.guestDayCents > a.guestDayCents ? b : a));
    const halfDay = billableHours <= HALF_DAY_HOURS;
    const overallCap = halfDay ? priciest.guestHalfDayCents : priciest.guestDayCents;
    if (subtotalCents > overallCap) {
      subtotalCents = overallCap;
      capApplied = halfDay ? "half_day" : "day";
    }
  }

  const rateSource = billable[0] ?? segments[0];
  return {
    plan: input.plan,
    segments,
    durationHours,
    includedHoursApplied,
    billableHours,
    hourlyRateCents: rateSource?.hourlyRateCents ?? 0,
    subtotalCents,
    capApplied,
  };
}

/** Weekday conference slot for facility-local start/end minutes, or undefined. */
export function conferenceSlotFor(startMinutes: number, endMinutes: number): ConferenceSlotId | undefined {
  return CONFERENCE_ROOM_WEEKDAY_SLOTS.find(
    (slot) => slot.startMinutes === startMinutes && slot.endMinutes === endMinutes,
  )?.id;
}

export function conferenceSlotPriceCents(slot: ConferenceSlotId | undefined): number | undefined {
  return slot ? CONFERENCE_ROOM_SLOT_PRICE_CENTS : undefined;
}
