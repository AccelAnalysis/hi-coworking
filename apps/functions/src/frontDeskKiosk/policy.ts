/**
 * Front-desk kiosk policy: pure rules with no Firebase imports, so they can be
 * unit tested directly. Every time rule uses facility time (America/New_York)
 * and works across daylight-saving changes.
 *
 * Rules Jonathan accepted (Oct 2026):
 *  - Overage rounds UP to the next 15 minutes after a 5-minute grace.
 *  - Allowance is the booked window when the member has a seat booking that
 *    day, otherwise their remaining monthly included hours.
 *  - Overage is recorded with the plan rate. Nothing is ever charged here.
 *  - Late = 15 minutes past a confirmed booking start with no visit.
 *    No-show = booking ended with no visit. Both are flags only.
 */

export const KIOSK_TIME_ZONE = "America/New_York";
export const OVERAGE_GRACE_MINUTES = 5;
export const OVERAGE_INCREMENT_MINUTES = 15;
export const LATE_AFTER_MINUTES = 15;
export const LOOKUP_TTL_MS = 2 * 60 * 1000;
export const LOOKUPS_PER_MINUTE = 12;
export const DEFAULT_IDLE_LOGO_MINUTES = 15;
export const DEFAULT_LOGO_SECONDS = 6;
export const IDLE_LOGO_MINUTES_RANGE = { min: 1, max: 120 } as const;
export const LOGO_SECONDS_RANGE = { min: 3, max: 15 } as const;
export const CLOSE_REASON_MIN = 3;
export const CLOSE_REASON_MAX = 300;
export const DEFAULT_CLOSE_TIME = "17:00";
/** Unambiguous code alphabet: no 0/O, 1/I/L. */
export const MEMBER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MEMBER_CODE_LENGTH = 6;

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------- time ----

type ClockParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KIOSK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function easternClock(timestamp: number): ClockParts {
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

export function easternDayKey(timestamp: number): string {
  const c = easternClock(timestamp);
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

export function easternMonthKey(timestamp: number): string {
  const c = easternClock(timestamp);
  return `${c.year}-${pad(c.month)}`;
}

/**
 * Epoch ms for a wall-clock time on a facility date ("2026-11-01", "17:00").
 * Corrects for the UTC offset in effect at that moment, so it is right on
 * both sides of a daylight-saving change.
 */
export function easternEpoch(dateKey: string, time: string): number {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new Error(`Invalid facility date or time: ${dateKey} ${time}`);
  const wallAsUtc = Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2]),
  );
  let guess = wallAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const c = easternClock(guess);
    const shownAsUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
    const next = wallAsUtc - (shownAsUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** Start (inclusive) and end (exclusive) of a facility day in epoch ms. */
export function easternDayBounds(dateKey: string): { start: number; end: number } {
  const start = easternEpoch(dateKey, "00:00");
  const [y, m, d] = dateKey.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const nextKey = `${nextDay.getUTCFullYear()}-${pad(nextDay.getUTCMonth() + 1)}-${pad(nextDay.getUTCDate())}`;
  return { start, end: easternEpoch(nextKey, "00:00") };
}

// ------------------------------------------------------------- overage ----

/** Overage minutes: nothing within the 5-minute grace, then up to the next 15. */
export function roundOverageMinutes(rawMinutes: number): number {
  if (!Number.isFinite(rawMinutes) || rawMinutes <= OVERAGE_GRACE_MINUTES) return 0;
  return Math.ceil(rawMinutes / OVERAGE_INCREMENT_MINUTES) * OVERAGE_INCREMENT_MINUTES;
}

export type OverageResult = {
  actualMinutes: number;
  rawOverageMinutes: number;
  overageMinutes: number;
  /** Included minutes this visit used up (monthly allowance only). */
  includedMinutesApplied: number;
};

export function computeOverage(input: {
  checkInAt: number;
  checkOutAt: number;
  allowanceMinutes: number;
}): OverageResult {
  const actualMinutes = Math.max(0, (input.checkOutAt - input.checkInAt) / MINUTE_MS);
  const allowance = Math.max(0, input.allowanceMinutes);
  const rawOverageMinutes = Math.max(0, actualMinutes - allowance);
  return {
    actualMinutes: Math.round(actualMinutes * 10) / 10,
    rawOverageMinutes: Math.round(rawOverageMinutes * 10) / 10,
    overageMinutes: roundOverageMinutes(rawOverageMinutes),
    includedMinutesApplied: Math.round(Math.min(actualMinutes, allowance) * 10) / 10,
  };
}

// ----------------------------------------------------------- allowance ----

export type KioskBooking = {
  id: string;
  start: number;
  end: number;
  status?: string;
  resourceId?: string;
  userId?: string;
};

export type AllowanceSource = "booking" | "monthly" | "none";

export type Allowance = {
  source: AllowanceSource;
  allowanceMinutes: number;
  bookedWindow: { start: number; end: number } | null;
  bookingIds: string[];
  /** Included monthly minutes left before this visit, or null without a desk plan. */
  remainingMonthlyMinutes: number | null;
};

export function isSeatResource(resourceId: unknown): boolean {
  return typeof resourceId === "string" && (resourceId === "seat-flex" || /^seat-\d+$/.test(resourceId));
}

export function isConfirmedBooking(status: unknown): boolean {
  return String(status || "").toLowerCase() === "confirmed";
}

/** Confirmed seat bookings that start on the given facility day. */
export function seatBookingsForDay(bookings: KioskBooking[], dayKey: string): KioskBooking[] {
  return bookings
    .filter((b) => isConfirmedBooking(b.status) && isSeatResource(b.resourceId))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .filter((b) => easternDayKey(b.start) === dayKey)
    .sort((a, b) => a.start - b.start);
}

export function computeAllowance(input: {
  dayBookings: KioskBooking[];
  includedHoursPerMonth: number | null;
  usedBookingHoursThisMonth: number;
  walkInIncludedMinutesThisMonth: number;
}): Allowance {
  const remainingMonthlyMinutes = input.includedHoursPerMonth && input.includedHoursPerMonth > 0
    ? Math.max(
      0,
      Math.round(
        input.includedHoursPerMonth * 60
        - Math.max(0, input.usedBookingHoursThisMonth) * 60
        - Math.max(0, input.walkInIncludedMinutesThisMonth),
      ),
    )
    : null;

  if (input.dayBookings.length > 0) {
    const minutes = input.dayBookings.reduce((sum, b) => sum + (b.end - b.start) / MINUTE_MS, 0);
    return {
      source: "booking",
      allowanceMinutes: Math.round(minutes),
      bookedWindow: {
        start: Math.min(...input.dayBookings.map((b) => b.start)),
        end: Math.max(...input.dayBookings.map((b) => b.end)),
      },
      bookingIds: input.dayBookings.map((b) => b.id),
      remainingMonthlyMinutes,
    };
  }
  if (remainingMonthlyMinutes !== null) {
    return { source: "monthly", allowanceMinutes: remainingMonthlyMinutes, bookedWindow: null, bookingIds: [], remainingMonthlyMinutes };
  }
  return { source: "none", allowanceMinutes: 0, bookedWindow: null, bookingIds: [], remainingMonthlyMinutes: null };
}

// --------------------------------------------------- membership alerts ----

export type HoursAlertReason =
  | "past_due"
  | "cancelled"
  | "expired"
  | "comp_ended"
  | "no_hours_remaining"
  | "no_plan_or_booking";

export const HOURS_ALERT_LABELS: Record<HoursAlertReason, string> = {
  past_due: "Membership payment is past due",
  cancelled: "Membership is cancelled",
  expired: "Membership has expired",
  comp_ended: "Complimentary membership has ended",
  no_hours_remaining: "No included hours left this month",
  no_plan_or_booking: "No desk plan and no booking today",
};

/**
 * The staff-only alert for a check-in, or null. The member never sees this;
 * the kiosk shows a normal check-in either way.
 */
export function hoursAlertReason(input: {
  membershipStatus: unknown;
  compEnded: boolean;
  hasDeskPlan: boolean;
  allowance: Allowance;
}): HoursAlertReason | null {
  const status = String(input.membershipStatus || "");
  if (status === "pastDue") return "past_due";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "expired") return "expired";
  if (input.compEnded) return "comp_ended";
  if (input.allowance.source === "booking") return null;
  if (input.hasDeskPlan && (input.allowance.remainingMonthlyMinutes ?? 0) <= 0) return "no_hours_remaining";
  if (!input.hasDeskPlan) return "no_plan_or_booking";
  return null;
}

// ---------------------------------------------------- late / no-show ----

export type AttendanceFlag = "late" | "no_show";

export function attendanceFlag(input: { start: number; end: number; hasVisit: boolean; now: number }): AttendanceFlag | null {
  if (input.hasVisit) return null;
  if (input.now >= input.end) return "no_show";
  if (input.now >= input.start + LATE_AFTER_MINUTES * MINUTE_MS) return "late";
  return null;
}

// --------------------------------------------------------- auto-close ----

/**
 * When a forgotten check-out is closed automatically, and the check-out time
 * recorded. Visits that started before closing close at closing time. A
 * visit that started after closing waits until the end of that day and is
 * recorded with a zero-length stay, so staff set the real time on review.
 */
export function autoClosePlan(input: { checkInAt: number; closingAt: number; dayEnd: number }): { dueAt: number; checkOutAt: number } {
  if (input.checkInAt < input.closingAt) return { dueAt: input.closingAt, checkOutAt: input.closingAt };
  return { dueAt: input.dayEnd, checkOutAt: input.checkInAt };
}

/** Latest end time of the day's open intervals, or the default close. */
export function closingTimeFromIntervals(intervals: Array<{ endTime: string }>): string {
  const times = intervals.map((i) => i.endTime).filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
  return times.length ? times[times.length - 1] : DEFAULT_CLOSE_TIME;
}

// ------------------------------------------------------ lookup inputs ----

export type LookupQuery = { kind: "email"; email: string } | { kind: "code"; code: string };

export function normalizeMemberCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

export function isValidMemberCode(code: string): boolean {
  return code.length === MEMBER_CODE_LENGTH && [...code].every((ch) => MEMBER_CODE_ALPHABET.includes(ch));
}

export function parseLookupQuery(raw: unknown): LookupQuery | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 254) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: "email", email } : null;
  }
  const code = normalizeMemberCode(value);
  return isValidMemberCode(code) ? { kind: "code", code } : null;
}

export function generateMemberCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < MEMBER_CODE_LENGTH; i += 1) {
    code += MEMBER_CODE_ALPHABET[Math.floor(random() * MEMBER_CODE_ALPHABET.length) % MEMBER_CODE_ALPHABET.length];
  }
  return code;
}

// ------------------------------------------------------------- names ----

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.includes("@") ? "" : trimmed;
}

/** First name and last initial ("Avery K."), never the email. */
export function maskedName(input: { displayName?: unknown; firstName?: unknown; lastName?: unknown }): string {
  const first = cleanName(input.firstName);
  const last = cleanName(input.lastName);
  const parts = first ? [first, last].filter(Boolean) : cleanName(input.displayName).split(" ").filter(Boolean);
  if (parts.length === 0) return "Member";
  const given = parts[0];
  const family = parts.length > 1 ? parts[parts.length - 1] : "";
  return family ? `${given} ${family[0].toUpperCase()}.` : given;
}

export function firstName(input: { displayName?: unknown; firstName?: unknown }): string {
  const first = cleanName(input.firstName);
  if (first) return first.split(" ")[0];
  const display = cleanName(input.displayName);
  return display ? display.split(" ")[0] : "";
}

// ---------------------------------------------------------- settings ----

export type KioskSettings = { idleLogoMinutes: number; logoSeconds: number };

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

export function normalizeKioskSettings(value: unknown): KioskSettings {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    idleLogoMinutes: clampInt(record.idleLogoMinutes, IDLE_LOGO_MINUTES_RANGE, DEFAULT_IDLE_LOGO_MINUTES),
    logoSeconds: clampInt(record.logoSeconds, LOGO_SECONDS_RANGE, DEFAULT_LOGO_SECONDS),
  };
}

export function validateKioskSettings(value: unknown): KioskSettings | string {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const idle = Number(record.idleLogoMinutes);
  const logo = Number(record.logoSeconds);
  if (!Number.isInteger(idle) || idle < IDLE_LOGO_MINUTES_RANGE.min || idle > IDLE_LOGO_MINUTES_RANGE.max) {
    return `Idle time must be a whole number of minutes from ${IDLE_LOGO_MINUTES_RANGE.min} to ${IDLE_LOGO_MINUTES_RANGE.max}.`;
  }
  if (!Number.isInteger(logo) || logo < LOGO_SECONDS_RANGE.min || logo > LOGO_SECONDS_RANGE.max) {
    return `Logo time must be a whole number of seconds from ${LOGO_SECONDS_RANGE.min} to ${LOGO_SECONDS_RANGE.max}.`;
  }
  return { idleLogoMinutes: idle, logoSeconds: logo };
}

export function validateCloseReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= CLOSE_REASON_MIN && reason.length <= CLOSE_REASON_MAX ? reason : null;
}

/** Client request ids: 8-64 url-safe characters. */
export function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export const STAFF_ROLES = new Set(["staff", "admin", "master"]);
