/**
 * Membership end (Jonathan, Oct 30-31, 2026): a cancellation takes effect at
 * the end of the paid month, and bookings after that date are cancelled
 * automatically along with their door codes. Pure helpers, unit tested.
 *
 * Only bookings that drew on the membership (included hours, or no charge)
 * are cancelled. A booking the member paid for separately (for example a
 * conference room) is kept with its code. Any amount paid on a cancelled
 * booking comes back as account credit; nothing is refunded to a card here.
 */

const LIVE_STATUSES = new Set(["active", "trial", "pastDue"]);

export type MembershipUserLike = { membershipStatus?: unknown; expiresAt?: unknown } | undefined;

export function membershipJustEnded(before: MembershipUserLike, after: MembershipUserLike): boolean {
  if (!before || !after) return false;
  return LIVE_STATUSES.has(String(before.membershipStatus))
    && !LIVE_STATUSES.has(String(after.membershipStatus));
}

export function membershipEndAt(after: MembershipUserLike, now: number): number {
  const expiresAt = Number(after?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > 0 ? Math.min(expiresAt, now) : now;
}

export type EndingBookingLike = {
  id: string;
  status?: unknown;
  start?: unknown;
  totalCents?: unknown;
  includedHoursApplied?: unknown;
};

export function bookingsToCancelAtMembershipEnd<T extends EndingBookingLike>(bookings: T[], endAt: number): T[] {
  return bookings.filter((booking) => {
    if (booking.status !== "CONFIRMED") return false;
    if (!(Number(booking.start) >= endAt)) return false;
    const usedIncludedHours = Number(booking.includedHoursApplied || 0) > 0;
    const unpaid = Number(booking.totalCents || 0) <= 0;
    return usedIncludedHours || unpaid;
  });
}
