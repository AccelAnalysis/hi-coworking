/**
 * Overtime (extra time) policy, pure so it can be unit tested. Approved by
 * Jonathan, Oct 30-31, 2026:
 *  - Time keeps running until check-out.
 *  - Checking out up to 15 minutes after the booked end: no charge.
 *  - More than 15 minutes: the time past the booked end is charged in
 *    15-minute steps at the visit's recorded hourly rate (plan extra-hour
 *    rate for members, guest rate otherwise).
 *  - No check-out: billing is capped at the booked end plus one hour, and the
 *    visit waits for staff review. Only a visit the member checked out of, or
 *    one staff closed with the real time, is ever charged.
 *  - Leaving early: the booking was already paid or applied in full.
 * Only visits tied to a booking have a booked end, so a walk-in that draws
 * on monthly included hours keeps the existing record-only overage.
 */

export const OVERTIME_FREE_MINUTES = 15;
export const OVERTIME_INCREMENT_MINUTES = 15;
export const NO_CHECKOUT_CAP_MINUTES = 60;
export const OVERTIME_CHARGEABLE_STATUSES = ["closed", "staff_closed"] as const;

const MINUTE_MS = 60_000;

export type OvertimeVisit = {
  status?: unknown;
  allowanceSource?: unknown;
  bookedWindow?: { start?: unknown; end?: unknown } | null;
  checkOutAt?: unknown;
  rateCents?: unknown;
  billingCapApplied?: unknown;
  chargeStatus?: unknown;
};

export type Overtime = { minutes: number; cents: number };

export function overtimeForVisit(visit: OvertimeVisit): Overtime {
  const none = { minutes: 0, cents: 0 };
  if (visit.allowanceSource !== "booking") return none;
  const bookedEnd = Number(visit.bookedWindow?.end);
  const checkOutAt = Number(visit.checkOutAt);
  if (!Number.isFinite(bookedEnd) || !Number.isFinite(checkOutAt)) return none;
  const rawMinutes = (checkOutAt - bookedEnd) / MINUTE_MS;
  if (!(rawMinutes > OVERTIME_FREE_MINUTES)) return none;
  let minutes = Math.ceil(rawMinutes / OVERTIME_INCREMENT_MINUTES) * OVERTIME_INCREMENT_MINUTES;
  if (visit.billingCapApplied === true) minutes = Math.min(minutes, NO_CHECKOUT_CAP_MINUTES);
  const rateCents = Math.max(0, Math.round(Number(visit.rateCents) || 0));
  return { minutes, cents: Math.round((minutes / 60) * rateCents) };
}

/** True once, when a visit moves into a charge-eligible closed state. */
export function shouldChargeOvertime(before: OvertimeVisit | undefined, after: OvertimeVisit | undefined): boolean {
  if (!after) return false;
  const chargeable = (status: unknown) =>
    (OVERTIME_CHARGEABLE_STATUSES as readonly unknown[]).includes(status);
  if (!chargeable(after.status) || chargeable(before?.status)) return false;
  if (after.chargeStatus !== "not_charged" && after.chargeStatus != null) return false;
  return overtimeForVisit(after).cents > 0;
}

export function overtimeDescription(minutes: number): string {
  return `Hi Coworking extra time: ${minutes} minutes past your booking`;
}
