import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const BOOKING_TIME_ZONE = "America/New_York";
export const BOOKING_EARLIEST_TIME = "08:00";
export const BOOKING_LATEST_TIME = "20:00";

const SETTINGS_COLLECTION = "bookingSettings";
const SETTINGS_DOCUMENT = "operatingHours";
const EXCEPTIONS_COLLECTION = "bookingScheduleExceptions";
const AUDIT_COLLECTION = "bookingScheduleAudit";
const INCREMENT_MINUTES = 30;
const EARLIEST_MINUTES = 8 * 60;
const LATEST_MINUTES = 20 * 60;

export type BookingDayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type BookingScheduleExceptionKind = "OPEN" | "CLOSED";

export type WeeklyDayHours = {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

export type WeeklyHours = Record<BookingDayKey, WeeklyDayHours>;

export type BookingScheduleException = {
  id: string;
  date: string;
  kind: BookingScheduleExceptionKind;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  label: string;
  createdAt: number;
  createdBy: string;
};

export type BookingOpenInterval = {
  startTime: string;
  endTime: string;
};

export type ResolvedBookingDay = {
  date: string;
  timeZone: string;
  isOpen: boolean;
  intervals: BookingOpenInterval[];
  hasException: boolean;
};

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  sun: { isOpen: false, openTime: "08:00", closeTime: "17:00" },
  mon: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  tue: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  wed: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  thu: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  fri: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  sat: { isOpen: false, openTime: "08:00", closeTime: "17:00" },
};

const DAY_KEYS: BookingDayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function db() {
  if (admin.apps.length === 0) admin.initializeApp();
  return admin.firestore();
}

function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function validateDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Choose a valid calendar date.");
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpsError("invalid-argument", "Choose a valid calendar date.");
  }
}

function validateTime(value: string, fieldName: string) {
  const minutes = timeToMinutes(value);
  if (
    !Number.isFinite(minutes)
    || minutes < EARLIEST_MINUTES
    || minutes > LATEST_MINUTES
    || minutes % INCREMENT_MINUTES !== 0
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must use a 30-minute time between ${BOOKING_EARLIEST_TIME} and ${BOOKING_LATEST_TIME}.`,
    );
  }
  return minutes;
}

function validateRange(startTime: string, endTime: string) {
  const start = validateTime(startTime, "Start time");
  const end = validateTime(endTime, "End time");
  if (end <= start) {
    throw new HttpsError("invalid-argument", "End time must be after start time.");
  }
  return { start, end };
}

function normalizeDay(value: unknown, fallback: WeeklyDayHours): WeeklyDayHours {
  const raw = (value || {}) as Record<string, unknown>;
  const isOpen = typeof raw.isOpen === "boolean" ? raw.isOpen : fallback.isOpen;
  const openTime = typeof raw.openTime === "string" ? raw.openTime : fallback.openTime;
  const closeTime = typeof raw.closeTime === "string" ? raw.closeTime : fallback.closeTime;
  const openMinutes = timeToMinutes(openTime);
  const closeMinutes = timeToMinutes(closeTime);
  if (
    !Number.isFinite(openMinutes)
    || !Number.isFinite(closeMinutes)
    || openMinutes < EARLIEST_MINUTES
    || closeMinutes > LATEST_MINUTES
    || openMinutes % INCREMENT_MINUTES !== 0
    || closeMinutes % INCREMENT_MINUTES !== 0
    || closeMinutes <= openMinutes
  ) {
    return { ...fallback };
  }
  return { isOpen, openTime, closeTime };
}

export function normalizeWeeklyHours(value: unknown): WeeklyHours {
  const raw = (value || {}) as Record<string, unknown>;
  return Object.fromEntries(
    DAY_KEYS.map((day) => [day, normalizeDay(raw[day], DEFAULT_WEEKLY_HOURS[day])]),
  ) as WeeklyHours;
}

function normalizeException(
  id: string,
  value: FirebaseFirestore.DocumentData,
): BookingScheduleException | null {
  const date = typeof value.date === "string" ? value.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const kind = value.kind === "OPEN" ? "OPEN" : value.kind === "CLOSED" ? "CLOSED" : null;
  if (!kind) return null;
  const allDay = Boolean(value.allDay);
  return {
    id,
    date,
    kind,
    allDay,
    startTime: typeof value.startTime === "string" ? value.startTime : null,
    endTime: typeof value.endTime === "string" ? value.endTime : null,
    label: typeof value.label === "string" ? value.label : "",
    createdAt: Number(value.createdAt || 0),
    createdBy: typeof value.createdBy === "string" ? value.createdBy : "",
  };
}

type MinuteInterval = { start: number; end: number };

function mergeIntervals(intervals: MinuteInterval[]) {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MinuteInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }
  return merged;
}

function subtractInterval(intervals: MinuteInterval[], closure: MinuteInterval) {
  const next: MinuteInterval[] = [];
  for (const interval of intervals) {
    if (closure.end <= interval.start || closure.start >= interval.end) {
      next.push(interval);
      continue;
    }
    if (closure.start > interval.start) {
      next.push({ start: interval.start, end: Math.min(closure.start, interval.end) });
    }
    if (closure.end < interval.end) {
      next.push({ start: Math.max(closure.end, interval.start), end: interval.end });
    }
  }
  return next.filter((interval) => interval.end > interval.start);
}

function weekdayForDate(date: string): BookingDayKey {
  const index = new Date(`${date}T12:00:00Z`).getUTCDay();
  return DAY_KEYS[index];
}

export function resolveDayIntervals(
  date: string,
  weekly: WeeklyHours,
  exceptions: Array<Pick<BookingScheduleException, "date" | "kind" | "allDay" | "startTime" | "endTime">>,
): BookingOpenInterval[] {
  const day = weekly[weekdayForDate(date)];
  let intervals: MinuteInterval[] = day.isOpen
    ? [{ start: timeToMinutes(day.openTime), end: timeToMinutes(day.closeTime) }]
    : [];

  const matching = exceptions.filter((exception) => exception.date === date);
  for (const exception of matching.filter((item) => item.kind === "OPEN")) {
    if (exception.allDay) {
      intervals.push({ start: EARLIEST_MINUTES, end: LATEST_MINUTES });
      continue;
    }
    const start = exception.startTime ? timeToMinutes(exception.startTime) : Number.NaN;
    const end = exception.endTime ? timeToMinutes(exception.endTime) : Number.NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      intervals.push({
        start: Math.max(EARLIEST_MINUTES, start),
        end: Math.min(LATEST_MINUTES, end),
      });
    }
  }

  intervals = mergeIntervals(intervals);

  for (const exception of matching.filter((item) => item.kind === "CLOSED")) {
    if (exception.allDay) {
      intervals = [];
      break;
    }
    const start = exception.startTime ? timeToMinutes(exception.startTime) : Number.NaN;
    const end = exception.endTime ? timeToMinutes(exception.endTime) : Number.NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      intervals = subtractInterval(intervals, { start, end });
    }
  }

  return mergeIntervals(intervals).map((interval) => ({
    startTime: minutesToTime(interval.start),
    endTime: minutesToTime(interval.end),
  }));
}

async function weeklyHours() {
  const snap = await db().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOCUMENT).get();
  return normalizeWeeklyHours(snap.data()?.weekly);
}

async function exceptionsForDate(date: string) {
  const snap = await db().collection(EXCEPTIONS_COLLECTION).where("date", "==", date).get();
  return snap.docs
    .map((doc) => normalizeException(doc.id, doc.data()))
    .filter((item): item is BookingScheduleException => item !== null);
}

export async function getResolvedBookingDay(date: string): Promise<ResolvedBookingDay> {
  validateDateKey(date);
  const [weekly, exceptions] = await Promise.all([
    weeklyHours(),
    exceptionsForDate(date),
  ]);
  const intervals = resolveDayIntervals(date, weekly, exceptions);
  return {
    date,
    timeZone: BOOKING_TIME_ZONE,
    isOpen: intervals.length > 0,
    intervals,
    hasException: exceptions.length > 0,
  };
}

function localClock(timestamp: number) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function facilityDateKey(timestamp = Date.now()) {
  return localClock(timestamp).date;
}

export async function assertWindowWithinOperatingCalendar(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpsError("invalid-argument", "Choose a valid start and end time.");
  }
  const startClock = localClock(start);
  const endClockForDay = localClock(end - 1);
  if (startClock.date !== endClockForDay.date) {
    throw new HttpsError("invalid-argument", "Bookings must start and end on the same day.");
  }
  const endClock = localClock(end);
  const day = await getResolvedBookingDay(startClock.date);
  const contained = day.intervals.some((interval) => (
    startClock.minutes >= timeToMinutes(interval.startTime)
    && endClock.minutes <= timeToMinutes(interval.endTime)
  ));
  if (!contained) {
    throw new HttpsError(
      "failed-precondition",
      day.isOpen
        ? "That time falls outside the available hours for this date."
        : "Hi Coworking is closed for bookings on this date.",
    );
  }
  return day;
}

function requireStaff(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "staff" && role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Staff access is required.");
  }
  return { uid: request.auth.uid, role };
}

function requireAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  const actor = requireStaff(request);
  if (actor.role !== "admin" && actor.role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required to change regular operating hours or add special openings.");
  }
  return actor;
}

async function audit(action: string, actorUid: string, details: Record<string, unknown>) {
  const ref = db().collection(AUDIT_COLLECTION).doc();
  await ref.set({
    id: ref.id,
    action,
    actorUid,
    details,
    createdAt: Date.now(),
  });
}

function facilityWallTimeToTimestamp(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: BOOKING_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const observedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      0,
      0,
    );
    guess += targetAsUtc - observedAsUtc;
  }
  return guess;
}

type AffectedBookingRecord = FirebaseFirestore.DocumentData & { id: string };

async function affectedBookingsForClosure(
  date: string,
  allDay: boolean,
  startTime: string | null,
  endTime: string | null,
) {
  const effectiveStart = allDay ? BOOKING_EARLIEST_TIME : startTime!;
  const effectiveEnd = allDay ? BOOKING_LATEST_TIME : endTime!;
  const start = facilityWallTimeToTimestamp(date, effectiveStart);
  const end = facilityWallTimeToTimestamp(date, effectiveEnd);
  const snap = await db().collection("bookings").where("end", ">", start).get();
  const affected = snap.docs
    .map((doc): AffectedBookingRecord => ({ id: doc.id, ...doc.data() }))
    .filter((booking) => (
      booking.status === "CONFIRMED"
      && Number(booking.start || 0) < end
      && Number(booking.end || 0) > start
    ))
    .sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
  return {
    count: affected.length,
    bookings: affected.slice(0, 10).map((booking) => ({
      id: booking.id,
      resourceName: typeof booking.resourceName === "string" ? booking.resourceName : "Space",
      userName: typeof booking.userName === "string" ? booking.userName : "Customer",
      start: Number(booking.start || 0),
      end: Number(booking.end || 0),
    })),
  };
}

export const booking_getDaySchedule = onCall(async (request) => {
  const { date } = request.data as { date: string };
  return getResolvedBookingDay(date);
});

export const booking_adminGetOperatingCalendar = onCall(async (request) => {
  requireStaff(request);
  const weekly = await weeklyHours();
  const allExceptions = await db().collection(EXCEPTIONS_COLLECTION).get();
  const today = facilityDateKey();
  const exceptions = allExceptions.docs
    .map((doc) => normalizeException(doc.id, doc.data()))
    .filter((item): item is BookingScheduleException => item !== null && item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .slice(0, 200);
  return {
    timeZone: BOOKING_TIME_ZONE,
    earliestTime: BOOKING_EARLIEST_TIME,
    latestTime: BOOKING_LATEST_TIME,
    weekly,
    exceptions,
  };
});

export const booking_adminSetWeeklyHours = onCall(async (request) => {
  const actor = requireAdmin(request);
  const { day, isOpen, openTime, closeTime } = request.data as {
    day: BookingDayKey;
    isOpen: boolean;
    openTime: string;
    closeTime: string;
  };
  if (!DAY_KEYS.includes(day)) {
    throw new HttpsError("invalid-argument", "Choose a valid day of the week.");
  }
  validateRange(openTime, closeTime);
  const ref = db().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOCUMENT);
  const snap = await ref.get();
  const weekly = normalizeWeeklyHours(snap.data()?.weekly);
  weekly[day] = { isOpen: Boolean(isOpen), openTime, closeTime };
  await ref.set({
    id: SETTINGS_DOCUMENT,
    timeZone: BOOKING_TIME_ZONE,
    weekly,
    updatedAt: Date.now(),
    updatedBy: actor.uid,
  }, { merge: true });
  await audit("weekly_hours_updated", actor.uid, { day, isOpen: Boolean(isOpen), openTime, closeTime });
  return { success: true, weekly };
});

export const booking_adminAddException = onCall(async (request) => {
  const actor = requireStaff(request);
  const { date, kind, allDay, startTime, endTime, label } = request.data as {
    date: string;
    kind: BookingScheduleExceptionKind;
    allDay?: boolean;
    startTime?: string | null;
    endTime?: string | null;
    label?: string;
  };
  validateDateKey(date);
  if (date < facilityDateKey()) {
    throw new HttpsError("invalid-argument", "Schedule exceptions cannot be added in the past.");
  }
  if (kind !== "CLOSED" && kind !== "OPEN") {
    throw new HttpsError("invalid-argument", "Choose whether this exception closes or opens the space.");
  }
  if (kind === "OPEN" && actor.role !== "admin" && actor.role !== "master") {
    throw new HttpsError("permission-denied", "Only an admin can add special opening hours.");
  }
  const normalizedAllDay = kind === "CLOSED" && Boolean(allDay);
  let normalizedStart: string | null = null;
  let normalizedEnd: string | null = null;
  if (!normalizedAllDay) {
    if (!startTime || !endTime) {
      throw new HttpsError("invalid-argument", "Start and end times are required for a partial closure or special opening.");
    }
    validateRange(startTime, endTime);
    normalizedStart = startTime;
    normalizedEnd = endTime;
  }
  const safeLabel = String(label || "").trim().slice(0, 120);
  const ref = db().collection(EXCEPTIONS_COLLECTION).doc();
  const exception: BookingScheduleException = {
    id: ref.id,
    date,
    kind,
    allDay: normalizedAllDay,
    startTime: normalizedStart,
    endTime: normalizedEnd,
    label: safeLabel,
    createdAt: Date.now(),
    createdBy: actor.uid,
  };
  await ref.set(exception);
  await audit("schedule_exception_added", actor.uid, { ...exception });

  const affected = kind === "CLOSED"
    ? await affectedBookingsForClosure(date, normalizedAllDay, normalizedStart, normalizedEnd)
    : { count: 0, bookings: [] as Array<{ id: string; resourceName: string; userName: string; start: number; end: number }> };

  return {
    success: true,
    exception,
    affectedBookingCount: affected.count,
    affectedBookings: affected.bookings,
  };
});

export const booking_adminDeleteException = onCall(async (request) => {
  const actor = requireStaff(request);
  const { exceptionId } = request.data as { exceptionId: string };
  if (!exceptionId) throw new HttpsError("invalid-argument", "Exception is required.");
  const ref = db().collection(EXCEPTIONS_COLLECTION).doc(exceptionId);
  const snap = await ref.get();
  if (!snap.exists) return { success: true, alreadyDeleted: true };
  const exception = normalizeException(snap.id, snap.data() || {});
  if (
    exception?.kind === "OPEN"
    && actor.role !== "admin"
    && actor.role !== "master"
  ) {
    throw new HttpsError("permission-denied", "Only an admin can remove special opening hours.");
  }
  await ref.delete();
  await audit("schedule_exception_deleted", actor.uid, { exceptionId, exception: exception || null });
  return { success: true };
});
