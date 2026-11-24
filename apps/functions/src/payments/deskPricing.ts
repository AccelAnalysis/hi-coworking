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
 * - Private Office is a room, not a desk: $39/hr capped at $99 half-day
 *   (≤4h) or $149 full day (>4h). It never consumes membership desk hours
 *   and never uses member or Plus overage discounts.
 * - Evening and weekend conference: flat $299 for a 4-hour slot by
 *   appointment (see after-hours helpers below).
 */
import {
  CONFERENCE_ROOM_AFTER_HOURS_SLOT_PRICE_CENTS,
  CONFERENCE_ROOM_SLOT_PRICE_CENTS,
  CONFERENCE_ROOM_WEEKDAY_SLOTS,
  DESK_SEAT_TIERS,
  DESK_SEAT_TIER_BY_RESOURCE,
  FULL_DAY_HOURS,
  HALF_DAY_HOURS,
  PRIVATE_OFFICE_RATES,
  isPrivateOfficeResource,
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


export const AFTER_HOURS_CONFERENCE_SLOT_PRICE_CENTS = CONFERENCE_ROOM_AFTER_HOURS_SLOT_PRICE_CENTS;
export const AFTER_HOURS_CONFERENCE_SLOT_HOURS = 4;
export const PRIVATE_OFFICE_HOURLY_CENTS = PRIVATE_OFFICE_RATES.guestHourlyCents;
export const PRIVATE_OFFICE_HALF_DAY_CENTS = PRIVATE_OFFICE_RATES.guestHalfDayCents;
export const PRIVATE_OFFICE_DAY_CENTS = PRIVATE_OFFICE_RATES.guestDayCents;

/** Price the private office at guest room rates (no membership hours or overage). */
export function pricePrivateOffice(hours: number): {
  hours: number;
  billableHours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  capApplied: DeskCapApplied;
} {
  const billableHours = Math.max(0, hours);
  const charge = capDeskCharge(
    billableHours,
    PRIVATE_OFFICE_RATES.guestHourlyCents,
    PRIVATE_OFFICE_RATES,
  );
  return {
    hours: billableHours,
    billableHours,
    hourlyRateCents: PRIVATE_OFFICE_RATES.guestHourlyCents,
    subtotalCents: charge.subtotalCents,
    capApplied: charge.capApplied,
  };
}

/**
 * Full-day (9h / 8:00 AM–5:00 PM) upgrade price minus the amount already paid,
 * floored at 0. Included hours for the target use the allowance as it stood
 * before the original booking (remaining now + hours already applied on it).
 */
export function priceUpgradeToFullDay(input: {
  resourceId: string;
  plan: DeskPricingPlan;
  includedHoursRemaining: number;
  includedHoursApplied: number;
  paidCents: number;
}): {
  resourceId: string;
  plan: DeskPricingPlan;
  targetHours: number;
  targetCents: number;
  paidCents: number;
  deltaCents: number;
  includedHoursApplied: number;
  incrementalIncludedHours: number;
  capApplied: DeskCapApplied;
} {
  const paidCents = Math.max(0, Math.round(Number(input.paidCents) || 0));
  const priorIncluded = Math.max(0, Number(input.includedHoursApplied) || 0);
  const remainingNow = Math.max(0, Number(input.includedHoursRemaining) || 0);
  const includedForTarget = remainingNow + priorIncluded;

  if (isPrivateOfficeResource(input.resourceId)) {
    const priced = pricePrivateOffice(FULL_DAY_HOURS);
    const deltaCents = Math.max(0, priced.subtotalCents - paidCents);
    return {
      resourceId: input.resourceId,
      plan: input.plan,
      targetHours: FULL_DAY_HOURS,
      targetCents: priced.subtotalCents,
      paidCents,
      deltaCents,
      includedHoursApplied: 0,
      incrementalIncludedHours: 0,
      capApplied: priced.capApplied,
    };
  }

  const priced = priceDeskSegments({
    plan: input.plan,
    segments: [{ resourceId: input.resourceId, hours: FULL_DAY_HOURS }],
    includedHoursRemaining: includedForTarget,
  });
  const incrementalIncludedHours = Math.max(0, priced.includedHoursApplied - priorIncluded);
  return {
    resourceId: input.resourceId,
    plan: input.plan,
    targetHours: FULL_DAY_HOURS,
    targetCents: priced.subtotalCents,
    paidCents,
    deltaCents: Math.max(0, priced.subtotalCents - paidCents),
    includedHoursApplied: priced.includedHoursApplied,
    incrementalIncludedHours,
    capApplied: priced.capApplied,
  };
}

export function alreadyPaidCents(booking: {
  subtotalCents?: number | null;
  totalCents?: number | null;
  amountCents?: number | null;
  paidCents?: number | null;
  accountCreditAppliedCents?: number | null;
  totalPrice?: number | null;
}): number {
  const explicit = [
    booking.subtotalCents,
    booking.paidCents,
    booking.amountCents,
  ];
  for (const value of explicit) {
    if (value != null && Number.isFinite(Number(value))) {
      return Math.max(0, Math.round(Number(value)));
    }
  }
  const total = booking.totalCents;
  const credit = booking.accountCreditAppliedCents;
  if (total != null && Number.isFinite(Number(total))) {
    return Math.max(0, Math.round(Number(total) + (Number(credit) || 0)));
  }
  if (booking.totalPrice != null && Number.isFinite(Number(booking.totalPrice))) {
    return Math.max(0, Math.round(Number(booking.totalPrice) * 100));
  }
  return 0;
}

export type AfterHoursConferenceKind =
  | "weekday_evening"
  | "weekend_am"
  | "weekend_pm"
  | "weekend_evening";

export type AfterHoursConferenceSlot = {
  id: string;
  kind: AfterHoursConferenceKind;
  label: string;
  timeLabel: string;
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
};

function hm(hours: number, minutes = 0) {
  return hours * 60 + minutes;
}

function clock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeLabel(startMinutes: number, endMinutes: number) {
  const fmt = (minutes: number) => {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const suffix = hour24 >= 12 && hour24 < 24 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return minute === 0 ? `${hour12}:00 ${suffix}` : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
  };
  const endLabel = endMinutes === 24 * 60 ? "12:00 AM" : fmt(endMinutes);
  const startLabel = fmt(startMinutes);
  return `${startLabel}–${endLabel}`;
}

function slot(
  id: string,
  kind: AfterHoursConferenceKind,
  label: string,
  startMinutes: number,
  endMinutes: number,
): AfterHoursConferenceSlot {
  return {
    id,
    kind,
    label,
    timeLabel: timeLabel(startMinutes, endMinutes),
    start: clock(startMinutes),
    end: endMinutes === 24 * 60 ? "24:00" : clock(endMinutes),
    startMinutes,
    endMinutes,
  };
}

export const WEEKEND_CONFERENCE_SLOTS: readonly AfterHoursConferenceSlot[] = [
  slot("weekend_am", "weekend_am", "Morning", hm(8), hm(12)),
  slot("weekend_pm_noon", "weekend_pm", "Afternoon", hm(12), hm(16)),
  slot("weekend_pm_1", "weekend_pm", "Afternoon", hm(13), hm(17)),
  slot("weekend_evening_4", "weekend_evening", "Evening", hm(16), hm(20)),
  slot("weekend_evening_5", "weekend_evening", "Evening", hm(17), hm(21)),
];

export const WEEKDAY_EVENING_EARLIEST_START_MINUTES = hm(17);
export const AFTER_HOURS_SLOT_DURATION_MINUTES = AFTER_HOURS_CONFERENCE_SLOT_HOURS * 60;

export function parseClockToMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 24 && minute === 0) return 24 * 60;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return hour * 60 + minute;
}

export function isWeekendDateKey(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function windowsOverlapMinutes(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && endA > startB;
}

export function weekdayEveningConferenceSlots(): AfterHoursConferenceSlot[] {
  const slots: AfterHoursConferenceSlot[] = [];
  for (let start = WEEKDAY_EVENING_EARLIEST_START_MINUTES; start + AFTER_HOURS_SLOT_DURATION_MINUTES <= 24 * 60; start += 30) {
    const end = start + AFTER_HOURS_SLOT_DURATION_MINUTES;
    slots.push(slot(
      `weekday_evening_${clock(start).replace(":", "")}`,
      "weekday_evening",
      "Evening",
      start,
      end,
    ));
  }
  return slots;
}

export function afterHoursSlotsForDate(date: string): AfterHoursConferenceSlot[] {
  return isWeekendDateKey(date) ? [...WEEKEND_CONFERENCE_SLOTS] : weekdayEveningConferenceSlots();
}

export type AfterHoursWindowValidation =
  | { ok: true; slot: AfterHoursConferenceSlot }
  | { ok: false; message: string };

export function validateAfterHoursConferenceWindow(
  date: string,
  start: string,
  end: string,
): AfterHoursWindowValidation {
  const startMinutes = parseClockToMinutes(start);
  const endMinutes = parseClockToMinutes(end);
  if (startMinutes == null || endMinutes == null) {
    return { ok: false, message: "Choose a valid start and end time." };
  }
  const candidates = afterHoursSlotsForDate(date);
  const found = candidates.find((item) => item.startMinutes === startMinutes && item.endMinutes === endMinutes);
  if (!found) {
    if (isWeekendDateKey(date)) {
      return {
        ok: false,
        message: "Weekend conference slots are 8:00 AM–12:00 PM, 12:00 PM–4:00 PM or 1:00 PM–5:00 PM, and 4:00 PM–8:00 PM or 5:00 PM–9:00 PM.",
      };
    }
    return {
      ok: false,
      message: "Weekday evening conference slots start at 5:00 PM or later, last exactly 4 hours, and must end by midnight.",
    };
  }
  return { ok: true, slot: found };
}

export function afterHoursSlotsOverlap(
  a: Pick<AfterHoursConferenceSlot, "startMinutes" | "endMinutes">,
  b: Pick<AfterHoursConferenceSlot, "startMinutes" | "endMinutes">,
): boolean {
  return windowsOverlapMinutes(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes);
}
