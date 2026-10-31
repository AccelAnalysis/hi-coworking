/**
 * Door access code rules (Jonathan, Oct 30, 2026, 6:40 PM and 8:44 PM).
 *
 * - One code per booking, time-limited to that booking (Seam time_bound code).
 * - The code is shown only to its owner on the signed-in SayHi page (/my-hi)
 *   and the booking page, stacked one per booking.
 * - The code is never emailed and never put in a notification. The email and
 *   in-app notice only say the code is ready and link to SayHi.
 * - Firestore keeps only the SHA-256 hash and the last two digits; the full
 *   code is read from Seam when its owner opens SayHi.
 *
 * Pure helpers (no Firebase imports) so the rules are unit-tested.
 */

export const SAYHI_PATH = "/my-hi";
export const ACCESS_CODE_READY_TEMPLATE = "access_code_ready";
export const ACCESS_CODE_NOTICE_TYPE = "access_code_ready";

const LIVE_GRANT = new Set(["pending", "active"]);
const LIVE_CODE = new Set(["programming", "active"]);

/**
 * Whether the full code may be returned to this signed-in user: it is their
 * grant, the grant and code are live, and the booking (plus grace) has not
 * ended. Cancelled, rescheduled-away, revoked, failed and past codes never
 * show, and nobody else's code ever does (staff included).
 */
export function ownerMaySeeCode(input: {
  requesterUid: string | null | undefined;
  grant: { userId?: unknown; status?: unknown; endsAt?: unknown } | null | undefined;
  code: { status?: unknown } | null | undefined;
  now: number;
}): boolean {
  const { requesterUid, grant, code, now } = input;
  if (!requesterUid || !grant || !code) return false;
  if (grant.userId !== requesterUid) return false;
  if (!LIVE_GRANT.has(String(grant.status))) return false;
  if (!LIVE_CODE.has(String(code.status))) return false;
  const endsAt = Number(grant.endsAt);
  return Number.isFinite(endsAt) && endsAt > now;
}

function easternTime(ms: number, withDate: boolean): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export type AccessReadyInput = { bookingId: string; doorName: string; startsAt: number; endsAt: number };

/** In-app notice: says the code is ready and links to SayHi. Never contains the code. */
export function accessReadyNotification(input: AccessReadyInput) {
  return {
    type: ACCESS_CODE_NOTICE_TYPE,
    title: "Your access code is ready",
    body: `Your access code for ${easternTime(input.startsAt, true)} to ${easternTime(input.endsAt, false)} is on your SayHi page.`,
    linkTo: SAYHI_PATH,
  };
}

/** Booking email payload: same promise, no code, no last digits. */
export function accessReadyMail(input: AccessReadyInput & { origin: string }) {
  return {
    template: ACCESS_CODE_READY_TEMPLATE,
    data: {
      doorName: input.doorName,
      startTime: easternTime(input.startsAt, true),
      endTime: easternTime(input.endsAt, false),
      bookingId: input.bookingId,
      sayHiUrl: `${input.origin.replace(/\/+$/, "")}${SAYHI_PATH}`,
    },
  };
}

/** True when a value looks like it carries a door code (used by tests and a runtime guard). */
export function containsDoorCode(value: unknown, code: string): boolean {
  if (!code) return false;
  return JSON.stringify(value ?? null).includes(code);
}
