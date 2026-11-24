/**
 * Pure desk and conference pricing for previews and tests.
 *
 * Canonical rules; apps/functions/src/payments/deskPricing.ts mirrors this
 * file (functions cannot import @hi/shared). tests/functions/tiered-pricing.test.ts
 * checks both produce identical results.
 *
 * - Guests and SayHi Connect pay the seat tier's guest hourly rate.
 * - Coworking Member: included hours cover Basic and Window seats (D1–D4).
 *   Hours beyond the allowance, and any time on Equipped seats (D5–D6), bill
 *   at 20% off that seat's guest rate.
 * - Coworking Plus: included hours cover D1–D6; extra hours bill at 30% off.
 * - Billable time is capped per seat tier: up to 4 billable hours never cost
 *   more than the half-day price; longer never more than the day price.
 * - Desk-change bookings price each segment on its own tier, then cap the
 *   total at the half-day/day price of the priciest billable tier.
 * - Conference room: flat $249 for a weekday Morning (8–12) or Afternoon
 *   (1–5) slot; other durations are not bookable.
 */
import { SEAT_CATALOG, SEAT_TIERS, type SeatTierId, type SeatTierRates } from "./seatCatalog";

export type DeskPricingPlan = "guest" | "member" | "plus";
export type DeskCapApplied = "half_day" | "day" | null;
export type DeskPricingSegmentInput = { resourceId: string; hours: number };

export type DeskPricingSegment = {
  resourceId: string;
  tierId: SeatTierId;
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
  hourlyRateCents: number;
  subtotalCents: number;
  capApplied: DeskCapApplied;
};

export const DESK_HALF_DAY_HOURS = 4;
export const DESK_FULL_DAY_HOURS = 9;
export const CONFERENCE_SLOT_PRICE_CENTS = 24900;

const INCLUDED_TIERS: Record<DeskPricingPlan, readonly SeatTierId[]> = {
  guest: [],
  member: ["basic", "window"],
  plus: ["basic", "window", "equipped"],
};

/** Membership plan id → pricing plan. SayHi Connect (`virtual`) and no plan are guest pricing. */
export function deskPricingPlanFor(planId: string | null | undefined): DeskPricingPlan {
  if (planId === "coworking") return "member";
  if (planId === "coworking_plus") return "plus";
  return "guest";
}

function bookableTierId(resourceId: string): SeatTierId | undefined {
  const seat = (SEAT_CATALOG as Record<string, (typeof SEAT_CATALOG)[keyof typeof SEAT_CATALOG] | undefined>)[resourceId];
  return seat && seat.bookable ? seat.tierId : undefined;
}

export function deskHourlyRateCents(plan: DeskPricingPlan, tier: SeatTierRates): number {
  if (plan === "member") return tier.memberOverageHourlyCents;
  if (plan === "plus") return tier.plusOverageHourlyCents;
  return tier.guestHourlyCents;
}

export function planCoversTier(plan: DeskPricingPlan, tierId: SeatTierId): boolean {
  return INCLUDED_TIERS[plan].includes(tierId);
}

function roundHours(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Cap one billable duration at the tier's half-day (≤4h) or day (>4h) price. */
export function capDeskCharge(
  billableHours: number,
  hourlyRateCents: number,
  tier: Pick<SeatTierRates, "guestHalfDayCents" | "guestDayCents">,
): { subtotalCents: number; capApplied: DeskCapApplied } {
  if (!(billableHours > 0)) return { subtotalCents: 0, capApplied: null };
  const uncapped = Math.round(billableHours * hourlyRateCents);
  const halfDay = billableHours <= DESK_HALF_DAY_HOURS;
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
    const tierId = bookableTierId(segment.resourceId);
    if (!tierId) throw new Error(`Unknown desk resource: ${segment.resourceId}`);
    const tier = SEAT_TIERS[tierId];
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
      .map((s) => SEAT_TIERS[s.tierId])
      .reduce((a, b) => (b.guestDayCents > a.guestDayCents ? b : a));
    const halfDay = billableHours <= DESK_HALF_DAY_HOURS;
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

/** Weekday conference slot for facility-local "HH:MM" start/end, or undefined. */
export function conferenceSlotForTimes(start: string, end: string): "morning" | "afternoon" | undefined {
  if (start === "08:00" && end === "12:00") return "morning";
  if (start === "13:00" && end === "17:00") return "afternoon";
  return undefined;
}
