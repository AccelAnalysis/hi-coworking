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
  /** Booked minutes already used by earlier closed visits the same day. */
  bookingMinutesUsedToday?: number;
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
      allowanceMinutes: Math.max(0, Math.round(minutes - Math.max(0, input.bookingMinutesUsedToday ?? 0))),
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

/**
 * Booked minutes an earlier, closed same-day visit used up: its stay capped
 * at the allowance it was given. Open visits use nothing yet.
 */
export function bookingMinutesUsedByVisit(visit: { allowanceSource?: unknown; allowanceMinutes?: unknown; checkInAt?: unknown; checkOutAt?: unknown }): number {
  if (visit.allowanceSource !== "booking" || visit.checkOutAt == null) return 0;
  const stay = Math.max(0, (Number(visit.checkOutAt) - Number(visit.checkInAt)) / MINUTE_MS);
  const allowed = Math.max(0, Number(visit.allowanceMinutes || 0));
  return Number.isFinite(stay) ? Math.round(Math.min(stay, allowed)) : 0;
}

/** True when a visit overlaps the booking window (an open visit runs on). */
export function visitOverlapsBooking(
  visit: { checkInAt?: unknown; checkOutAt?: unknown },
  booking: { start: number; end: number },
): boolean {
  const checkInAt = Number(visit.checkInAt);
  if (!Number.isFinite(checkInAt) || checkInAt >= booking.end) return false;
  return visit.checkOutAt == null || Number(visit.checkOutAt) > booking.start;
}

export function attendanceFlag(input: { start: number; end: number; hasVisit: boolean; now: number }): AttendanceFlag | null {
  if (input.hasVisit) return null;
  if (input.now >= input.end) return "no_show";
  if (input.now >= input.start + LATE_AFTER_MINUTES * MINUTE_MS) return "late";
  return null;
}

// ------------------------------------------------- deferred tasks ----
//
// Late / no-show flags and forgotten check-outs are handled by one-time
// Cloud Tasks (no polling). Task IDs are deterministic so a redelivered
// trigger cannot enqueue twice, and every handler re-reads current state and
// no-ops when the booking or visit no longer matches the task.

export type FrontDeskTaskKind = "late" | "no_show" | "auto_close";

export type AttendanceTaskPayload = {
  kind: "late" | "no_show";
  bookingId: string;
  uid: string;
  start: number;
  end: number;
};

export type AutoCloseTaskPayload = {
  kind: "auto_close";
  uid: string;
  visitId: string;
  dueAt: number;
};

export type FrontDeskTaskPayload = AttendanceTaskPayload | AutoCloseTaskPayload;

export type PlannedTask = { id: string; scheduleAt: number; payload: FrontDeskTaskPayload };

/** Cloud Tasks IDs allow letters, digits, hyphens and underscores only. */
export function taskIdPart(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200) || "none";
}

export function attendanceTaskId(bookingId: string, kind: "late" | "no_show", start: number): string {
  return `kiosk-${kind === "late" ? "late" : "noshow"}-${taskIdPart(bookingId)}-${Math.round(start)}`;
}

export function autoCloseTaskId(visitId: string, dueAt: number): string {
  return `kiosk-close-${taskIdPart(visitId)}-${Math.round(dueAt)}`;
}

/**
 * Cloud Tasks rejects a scheduleTime more than 30 days out. Later bookings
 * get a relay task at this horizon that re-queues the real check.
 */
export const MAX_TASK_DELAY_MS = 29 * 24 * 60 * MINUTE_MS;
/** Earlier than this before due counts as clock skew: retry, don't relay. */
export const EARLY_DELIVERY_TOLERANCE_MS = 5 * MINUTE_MS;

export function attendanceDueAt(task: Pick<AttendanceTaskPayload, "kind" | "start" | "end">): number {
  return task.kind === "late" ? task.start + LATE_AFTER_MINUTES * MINUTE_MS : task.end;
}

/**
 * The task to enqueue for a late / no-show check. Due within the Cloud Tasks
 * horizon: the check itself, under its fixed ID. Further out: a relay at the
 * horizon, whose ID also carries the relay day so trigger replays that day
 * collapse into one.
 */
export function attendanceTaskPlan(payload: AttendanceTaskPayload, now: number): PlannedTask {
  const due = attendanceDueAt(payload);
  const id = attendanceTaskId(payload.bookingId, payload.kind, payload.start);
  if (due - now <= MAX_TASK_DELAY_MS) return { id, scheduleAt: Math.max(now, due), payload };
  return { id: `${id}-relay-${Math.floor(now / (24 * 60 * MINUTE_MS))}`, scheduleAt: now + MAX_TASK_DELAY_MS, payload };
}

type BookingLike = { start?: unknown; end?: unknown; status?: unknown; resourceId?: unknown; userId?: unknown } | null | undefined;

/** A confirmed seat booking with a member and a valid window. */
export function trackableBooking(id: string, data: BookingLike): KioskBooking | null {
  if (!data) return null;
  const start = Number(data.start);
  const end = Number(data.end);
  const userId = typeof data.userId === "string" ? data.userId : "";
  if (!userId || !isConfirmedBooking(data.status) || !isSeatResource(data.resourceId)) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { id, start, end, status: String(data.status), resourceId: String(data.resourceId), userId };
}

/**
 * Tasks to enqueue after a booking write. Nothing is planned when the
 * attendance-relevant fields did not change, when the booking is no longer a
 * confirmed seat booking (stale tasks then no-op), or when it already ended.
 * A late check whose time has passed but whose booking is still running is
 * scheduled for now.
 */
export function planAttendanceTasks(input: { bookingId: string; before: BookingLike; after: BookingLike; now: number }): PlannedTask[] {
  const after = trackableBooking(input.bookingId, input.after);
  if (!after) return [];
  const before = trackableBooking(input.bookingId, input.before);
  if (before && before.start === after.start && before.end === after.end && before.userId === after.userId) return [];
  if (after.end <= input.now) return [];
  const base = { bookingId: after.id, uid: after.userId as string, start: after.start, end: after.end };
  return [
    attendanceTaskPlan({ kind: "late", ...base }, input.now),
    attendanceTaskPlan({ kind: "no_show", ...base }, input.now),
  ];
}

export type AttendanceDecision =
  | { action: "noop"; reason: "stale_booking" | "attended" | "already_flagged" | "too_early" }
  | { action: "relay" }
  | { action: "flag"; status: AttendanceFlag }
  | { action: "arrived_late" };

/**
 * What a late / no-show task does, given the booking as it is now. The task
 * no-ops if the booking was cancelled, rescheduled or reassigned, if a visit
 * overlaps it, or if the same flag is already set (duplicate delivery).
 */
export function decideAttendanceTask(input: {
  task: AttendanceTaskPayload;
  booking: KioskBooking | null;
  hasVisit: boolean;
  currentFlag: unknown;
  now: number;
}): AttendanceDecision {
  const { task, booking } = input;
  if (!booking || booking.start !== task.start || booking.end !== task.end || booking.userId !== task.uid) {
    return { action: "noop", reason: "stale_booking" };
  }
  // Nothing is decided before the task is due.
  const due = attendanceDueAt(task);
  // A relay hop for a booking beyond the Cloud Tasks horizon: re-queue.
  if (due - input.now > EARLY_DELIVERY_TOLERANCE_MS) return { action: "relay" };
  if (input.now < due) return { action: "noop", reason: "too_early" };
  if (input.hasVisit) {
    if (task.kind === "no_show" && input.currentFlag === "late") return { action: "arrived_late" };
    return { action: "noop", reason: "attended" };
  }
  if (input.currentFlag === task.kind || input.currentFlag === "no_show") return { action: "noop", reason: "already_flagged" };
  return { action: "flag", status: task.kind };
}

export type AutoCloseDecision =
  | { action: "noop"; reason: "not_open" | "different_visit" }
  | { action: "reschedule"; dueAt: number }
  | { action: "close"; checkOutAt: number };

/**
 * What a forgotten-check-out task does. It re-reads the closing time, so a
 * day whose hours were extended after check-in is re-queued for the new
 * closing time instead of being closed early.
 */
export function decideAutoClose(input: {
  task: AutoCloseTaskPayload;
  openVisitId: string | null;
  visitStatus: unknown;
  checkInAt: number;
  closingAt: number;
  dayEnd: number;
  now: number;
}): AutoCloseDecision {
  if (!input.openVisitId) return { action: "noop", reason: "not_open" };
  if (input.openVisitId !== input.task.visitId) return { action: "noop", reason: "different_visit" };
  if (input.visitStatus !== "open") return { action: "noop", reason: "not_open" };
  const plan = autoClosePlan({ checkInAt: input.checkInAt, closingAt: input.closingAt, dayEnd: input.dayEnd });
  if (input.now < plan.dueAt) return { action: "reschedule", dueAt: plan.dueAt };
  return { action: "close", checkOutAt: plan.checkOutAt };
}

/** Validates a task body from Cloud Tasks before any read. */
export function parseFrontDeskTask(data: unknown): FrontDeskTaskPayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("/") ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (d.kind === "late" || d.kind === "no_show") {
    const bookingId = str(d.bookingId);
    const uid = str(d.uid);
    const start = num(d.start);
    const end = num(d.end);
    if (!bookingId || !uid || start === null || end === null || end <= start) return null;
    return { kind: d.kind, bookingId, uid, start, end };
  }
  if (d.kind === "auto_close") {
    const uid = str(d.uid);
    const visitId = str(d.visitId);
    const dueAt = num(d.dueAt);
    if (!uid || !visitId || dueAt === null) return null;
    return { kind: "auto_close", uid, visitId, dueAt };
  }
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

/**
 * What a member types at the iPad: their email, or the door code for a booking
 * of theirs that is active now (the per-booking Seam PIN; one code only, so
 * there is no separate front-desk code). Door codes are 4 to 8 digits.
 */
export type LookupQuery = { kind: "email"; email: string } | { kind: "door_code"; code: string };

export function normalizeDoorCode(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function isValidDoorCode(code: string): boolean {
  return /^\d{4,8}$/.test(code);
}

export function parseLookupQuery(raw: unknown): LookupQuery | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 254) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: "email", email } : null;
  }
  const code = normalizeDoorCode(value);
  return isValidDoorCode(code) ? { kind: "door_code", code } : null;
}

/** How early before its booking a door code is accepted at the iPad (matches the lock grace). */
export const DOOR_CODE_EARLY_MS = 15 * 60_000;

/**
 * Whether a door code's grant lets its owner check in at the iPad now: the
 * code and grant are live and now is inside the booked window (plus the
 * early allowance). A code for another day never matches.
 */
export function doorCodeUsableAt(input: {
  codeStatus: unknown;
  grantStatus: unknown;
  startsAt: number;
  endsAt: number;
  now: number;
}): boolean {
  if (input.codeStatus !== "active" && input.codeStatus !== "programming") return false;
  if (input.grantStatus !== "active" && input.grantStatus !== "pending") return false;
  if (!Number.isFinite(input.startsAt) || !Number.isFinite(input.endsAt)) return false;
  return input.now >= input.startsAt - DOOR_CODE_EARLY_MS && input.now < input.endsAt;
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
