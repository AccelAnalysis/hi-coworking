/**
 * Pure eligibility for the daily post-attendance invitation job.
 * Send at 8:00 AM America/New_York on the first 8:00 AM after the booking
 * end: previous 8:00 AM ET <= end < this 8:00 AM ET.
 */
export const TIME_ZONE = "America/New_York";
export const GUEST_REPEAT_DAYS = 30;

export type Audience = "guest" | "member";

export type BookingLike = {
  id: string;
  status?: unknown;
  userId?: unknown;
  guestEmail?: unknown;
  email?: unknown;
  userName?: unknown;
  resourceName?: unknown;
  start?: unknown;
  end?: unknown;
  stripeRefundId?: unknown;
  cancellationRefundCents?: unknown;
  refundedAt?: unknown;
  paymentStatus?: unknown;
  visitFeedbackInvitedAt?: unknown;
  visitFeedbackId?: unknown;
};

export type InvitationLike = {
  userId?: string | null;
  emailHash?: string | null;
  invitedAt: number;
  bookingId?: string;
};

export type UserLike = {
  email?: unknown;
  displayName?: unknown;
  firstName?: unknown;
  membershipStatus?: unknown;
  marketingOptOut?: unknown;
  doNotContact?: unknown;
};

export type SkipReason =
  | "not_confirmed"
  | "refunded"
  | "no_show"
  | "already_invited"
  | "outside_window"
  | "no_recipient"
  | "suppressed"
  | "capped";

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(ms: number, timeZone = TIME_ZONE): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const value: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== "literal") value[part.type] = part.value;
  }
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  };
}

function zonedOffsetMs(utcInstant: number, timeZone: string): number {
  const p = zonedParts(utcInstant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcInstant;
}

/** UTC ms for a civil time in an IANA zone. */
export function zonedTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
  timeZone = TIME_ZONE,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = zonedOffsetMs(guess, timeZone);
  let instant = guess - offset;
  const again = zonedOffsetMs(instant, timeZone);
  if (again !== offset) instant = guess - again;
  return instant;
}

export function eightAmOn(year: number, month: number, day: number, timeZone = TIME_ZONE): number {
  return zonedTimeToUtcMs(year, month, day, 8, 0, 0, timeZone);
}

/** The 8:00 AM ET instant at or before `now`. */
export function mostRecentEightAm(now: number, timeZone = TIME_ZONE): number {
  const p = zonedParts(now, timeZone);
  const todayEight = eightAmOn(p.year, p.month, p.day, timeZone);
  if (now >= todayEight) return todayEight;
  const previousDay = zonedParts(todayEight - 12 * 60 * 60 * 1000, timeZone);
  return eightAmOn(previousDay.year, previousDay.month, previousDay.day, timeZone);
}

/** Previous 8:00 AM ET, safely across DST. */
export function previousEightAm(eightAm: number, timeZone = TIME_ZONE): number {
  const previousDay = zonedParts(eightAm - 12 * 60 * 60 * 1000, timeZone);
  return eightAmOn(previousDay.year, previousDay.month, previousDay.day, timeZone);
}

/**
 * The job's invitation window: bookings whose end is in
 * [previous 8:00 AM ET, this 8:00 AM ET).
 */
export function invitationWindow(now: number, timeZone = TIME_ZONE): { start: number; end: number } {
  const end = mostRecentEightAm(now, timeZone);
  return { start: previousEightAm(end, timeZone), end };
}

export function inInvitationWindow(endMs: number, window: { start: number; end: number }): boolean {
  return endMs >= window.start && endMs < window.end;
}

export function sameCalendarMonth(a: number, b: number, timeZone = TIME_ZONE): boolean {
  const left = zonedParts(a, timeZone);
  const right = zonedParts(b, timeZone);
  return left.year === right.year && left.month === right.month;
}

export function formatVisitDate(ms: number, timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(ms);
}

export function isConfirmed(booking: BookingLike): boolean {
  return String(booking.status || "").toUpperCase() === "CONFIRMED";
}

export function isRefunded(booking: BookingLike): boolean {
  if (Number(booking.cancellationRefundCents || 0) > 0) return true;
  if (Number(booking.refundedAt || 0) > 0) return true;
  if (typeof booking.stripeRefundId === "string" && booking.stripeRefundId.trim()) return true;
  return String(booking.paymentStatus || "").toLowerCase() === "refunded";
}

export function isNoShowFlag(flagStatus: unknown): boolean {
  return String(flagStatus || "") === "no_show";
}

export function alreadyInvited(booking: BookingLike): boolean {
  return Number(booking.visitFeedbackInvitedAt || 0) > 0 || Boolean(booking.visitFeedbackId);
}

export function bookingUserId(booking: BookingLike): string {
  return typeof booking.userId === "string" ? booking.userId : "";
}

export function audienceOf(user: UserLike | null, userId: string): Audience {
  if (userId && !userId.startsWith("guest:") && String(user?.membershipStatus || "") === "active") {
    return "member";
  }
  return "guest";
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function recipientEmail(booking: BookingLike, user: UserLike | null): string {
  for (const candidate of [booking.guestEmail, booking.email, user?.email]) {
    const email = normalizeEmail(candidate);
    if (isValidEmail(email)) return email;
  }
  return "";
}

export function isUserSuppressed(user: UserLike | null): boolean {
  return Boolean(user?.marketingOptOut || user?.doNotContact);
}

export function isCapped(input: {
  audience: Audience;
  now: number;
  invitations: InvitationLike[];
}): boolean {
  if (input.invitations.length === 0) return false;
  const last = Math.max(...input.invitations.map((invite) => invite.invitedAt));
  if (input.audience === "member") return sameCalendarMonth(last, input.now, TIME_ZONE);
  return input.now - last < GUEST_REPEAT_DAYS * 24 * 60 * 60 * 1000;
}

export function firstNameFrom(user: UserLike | null, booking: BookingLike): string {
  const candidates = [user?.firstName, user?.displayName, booking.userName];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("@")) continue;
    const first = candidate.trim().split(/\s+/)[0] || "";
    if (!first || first.length > 40) continue;
    const lower = first.toLowerCase();
    if (lower === "guest" || lower === "member") continue;
    return first;
  }
  return "";
}

export function bookingEnd(booking: BookingLike): number {
  const end = Number(booking.end || 0);
  return Number.isFinite(end) ? end : 0;
}

export function bookingStart(booking: BookingLike): number {
  const start = Number(booking.start || 0);
  return Number.isFinite(start) ? start : 0;
}

/**
 * Why a booking should not be invited. `suppressed` covers both a user
 * opt-out and a marketing suppression record (the caller checks the list).
 */
export function skipReason(input: {
  booking: BookingLike;
  window: { start: number; end: number };
  noShow: boolean;
  user: UserLike | null;
  email: string;
  suppressed: boolean;
  audience: Audience;
  invitations: InvitationLike[];
  now: number;
}): SkipReason | null {
  if (!isConfirmed(input.booking)) return "not_confirmed";
  if (isRefunded(input.booking)) return "refunded";
  if (input.noShow) return "no_show";
  if (alreadyInvited(input.booking)) return "already_invited";
  const end = bookingEnd(input.booking);
  if (!end || !inInvitationWindow(end, input.window)) return "outside_window";
  if (!input.email) return "no_recipient";
  if (input.suppressed || isUserSuppressed(input.user)) return "suppressed";
  if (isCapped({ audience: input.audience, now: input.now, invitations: input.invitations })) return "capped";
  return null;
}
