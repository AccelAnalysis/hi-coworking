import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { BOOKING_HOURS_MESSAGE, bookingHoursViolation } from "./bookingOperatingCalendar";

interface EventSeriesDoc {
  id: string;
  title: string;
  description: string;
  format: "in-person" | "virtual" | "hybrid";
  status: "draft" | "published" | "cancelled" | "completed";
  timezone?: string;
  rrule?: string;
  startTimeOfDay?: string;
  durationMins?: number;
  seriesStartDate?: number;
  seriesEndDate?: number;
  exceptions?: number[];
  overrides?: Record<string, Record<string, unknown>>;
  location?: string;
  virtualUrl?: string;
  seatCap?: number;
  price?: number;
  currency?: string;
  linkedRfxId?: string;
  ticketTypes?: Array<Record<string, unknown>>;
  sponsorships?: Array<Record<string, unknown>>;
  allowVendorTables?: boolean;
  vendorTablePriceCents?: number;
  upsellProducts?: string[];
  heroImage?: Record<string, unknown>;
  gallery?: Array<Record<string, unknown>>;
  promoVideo?: Record<string, unknown>;
  speakerCards?: Array<Record<string, unknown>>;
  sponsorLogos?: Array<Record<string, unknown>>;
  topics?: string[];
  audienceRules?: Record<string, unknown>;
  campaign?: Record<string, unknown>;
  createdBy: string;
  createdAt: number;
  updatedAt?: number;
}

type RRuleFrequency = "daily" | "weekly" | "monthly";
type LocalDateParts = { year: number; month: number; day: number };
type LocalDateTimeParts = LocalDateParts & { hour: number; minute: number };

const DEFAULT_TIME_ZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

function getDb() {
  return admin.firestore();
}

function parseRRuleParts(rrule?: string): Record<string, string> {
  if (!rrule) return {};
  const normalized = rrule.replace(/^RRULE:/i, "");
  return normalized.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim().toUpperCase();
    const value = rawValue.join("=").trim();
    if (key && value) acc[key] = value;
    return acc;
  }, {});
}

function parseRRuleFrequency(parts: Record<string, string>): RRuleFrequency {
  const freq = (parts.FREQ || "WEEKLY").toUpperCase();
  if (freq === "DAILY") return "daily";
  if (freq === "MONTHLY") return "monthly";
  return "weekly";
}

function parseRRuleInterval(parts: Record<string, string>): number {
  const value = parseInt(parts.INTERVAL || "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function parseByDay(parts: Record<string, string>): Set<number> | null {
  const byDay = parts.BYDAY;
  if (!byDay) return null;
  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const parsed = byDay
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .map((value) => dayMap[value.slice(-2)])
    .filter((value): value is number => Number.isInteger(value));
  return parsed.length ? new Set(parsed) : null;
}

function parseByMonthDay(parts: Record<string, string>): number | null {
  const raw = parts.BYMONTHDAY;
  if (!raw) return null;
  const value = parseInt(raw.split(",")[0], 10);
  if (!Number.isFinite(value) || value === 0 || value < -31 || value > 31) return null;
  return value;
}

function zonedDateTimeParts(timestamp: number, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
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
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function localDateKey(parts: LocalDateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateOrdinal(parts: LocalDateParts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function localDateFromOrdinal(ordinal: number): LocalDateParts {
  const date = new Date(ordinal * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function localDayOfWeek(parts: LocalDateParts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function monthsBetween(start: LocalDateParts, target: LocalDateParts) {
  return (target.year - start.year) * 12 + (target.month - start.month);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function resolveMonthlyDay(cursor: LocalDateParts, byMonthDay: number | null, fallbackDay: number) {
  if (byMonthDay == null) return cursor.day === fallbackDay;
  if (byMonthDay > 0) return cursor.day === byMonthDay;
  return cursor.day === lastDayOfMonth(cursor.year, cursor.month) + byMonthDay + 1;
}

function parseTimeOfDay(value?: string) {
  const [rawHour, rawMinute] = (value || "09:00").split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

/**
 * Convert a wall-clock date/time in an IANA zone to an epoch timestamp without
 * depending on the Cloud Functions host timezone. The iteration converges by
 * comparing the requested local wall clock to how Intl renders the current guess.
 */
export function zonedDateTimeToEpoch(
  date: LocalDateParts,
  timeOfDay: string | undefined,
  timeZone: string,
) {
  const time = parseTimeOfDay(timeOfDay);
  const desiredAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  let guess = desiredAsUtc;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = zonedDateTimeParts(guess, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const correction = desiredAsUtc - actualAsUtc;
    guess += correction;
    if (correction === 0) break;
  }

  return guess;
}

function localMidnightEpoch(date: LocalDateParts, timeZone: string) {
  return zonedDateTimeToEpoch(date, "00:00", timeZone);
}

function dateKeyForTimestamp(timestamp: number, timeZone: string) {
  return localDateKey(zonedDateTimeParts(timestamp, timeZone));
}

function overrideForDate(series: EventSeriesDoc, occurrenceStart: number) {
  const overrides = series.overrides || {};
  const timeZone = series.timezone || DEFAULT_TIME_ZONE;
  const targetKey = dateKeyForTimestamp(occurrenceStart, timeZone);

  // Newer override keys and some legacy records use an exact occurrence timestamp.
  if (overrides[String(occurrenceStart)]) return overrides[String(occurrenceStart)];

  // Older UI stored local-midnight timestamps as object keys. Match by the local
  // calendar date rather than by runtime-local dayStart so DST/host timezone do not matter.
  for (const [key, override] of Object.entries(overrides)) {
    const timestamp = Number(key);
    if (Number.isFinite(timestamp) && dateKeyForTimestamp(timestamp, timeZone) === targetKey) {
      return override;
    }
  }
  return undefined;
}

function exceptionDateKeys(series: EventSeriesDoc) {
  const timeZone = series.timezone || DEFAULT_TIME_ZONE;
  return new Set((series.exceptions || []).map((timestamp) => dateKeyForTimestamp(timestamp, timeZone)));
}

export function generateOccurrenceStarts(
  series: EventSeriesDoc,
  horizonDays = 180,
  now = Date.now(),
): number[] {
  const timeZone = series.timezone || DEFAULT_TIME_ZONE;
  const startDate = zonedDateTimeParts(series.seriesStartDate || now, timeZone);
  const seriesEnd = zonedDateTimeParts(series.seriesEndDate || now + horizonDays * DAY_MS, timeZone);
  const horizonEnd = zonedDateTimeParts(now + horizonDays * DAY_MS, timeZone);
  const startOrdinal = localDateOrdinal(startDate);
  const endOrdinal = Math.min(localDateOrdinal(seriesEnd), localDateOrdinal(horizonEnd));
  const nowOrdinal = localDateOrdinal(zonedDateTimeParts(now, timeZone));
  const effectiveStartOrdinal = Math.max(startOrdinal, nowOrdinal);

  const parts = parseRRuleParts(series.rrule);
  const frequency = parseRRuleFrequency(parts);
  const interval = parseRRuleInterval(parts);
  const byDay = parseByDay(parts);
  const byMonthDay = parseByMonthDay(parts);
  const exceptions = exceptionDateKeys(series);
  const starts: number[] = [];
  const seriesStartDay = localDayOfWeek(startDate);

  for (let ordinal = effectiveStartOrdinal; ordinal <= endOrdinal; ordinal += 1) {
    const cursor = localDateFromOrdinal(ordinal);
    if (exceptions.has(localDateKey(cursor))) continue;

    if (frequency === "daily") {
      const dayDiff = ordinal - startOrdinal;
      if (dayDiff % interval !== 0) continue;
    }

    if (frequency === "weekly") {
      const weekDiff = Math.floor((ordinal - startOrdinal) / 7);
      if (weekDiff % interval !== 0) continue;
      const weekday = localDayOfWeek(cursor);
      if (byDay && !byDay.has(weekday)) continue;
      if (!byDay && weekday !== seriesStartDay) continue;
    }

    if (frequency === "monthly") {
      const monthDiff = monthsBetween(startDate, cursor);
      if (monthDiff % interval !== 0) continue;
      if (!resolveMonthlyDay(cursor, byMonthDay, startDate.day)) continue;
    }

    starts.push(zonedDateTimeToEpoch(cursor, series.startTimeOfDay, timeZone));
  }

  return starts;
}

function occurrenceId(seriesId: string, startTs: number) {
  return `evt_${seriesId}_${startTs}`;
}

export const SERIES_HOURS_MESSAGE =
  `In-person and hybrid events have to fit inside opening hours. ${BOOKING_HOURS_MESSAGE}`;

/** Virtual events can run any time; in-person and hybrid events use the space. */
export function seriesUsesFacility(format: unknown) {
  return format !== "virtual";
}

/** Null when the occurrence fits Mon-Fri 8 AM-5 PM ET (or the series is virtual). */
export function seriesOccurrenceHoursViolation(format: unknown, start: number, end: number): string | null {
  if (!seriesUsesFacility(format)) return null;
  return bookingHoursViolation(start, end) ? SERIES_HOURS_MESSAGE : null;
}

/** Optional fields an admin can clear; a merge write must delete them explicitly. */
const CLEARABLE_SERIES_FIELDS = ["seriesEndDate", "seatCap", "location", "virtualUrl"] as const;
const CLEARABLE_OCCURRENCE_FIELDS = ["seatCap", "location", "virtualUrl"] as const;

function clearedFields(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(
    keys.filter((key) => value[key] === undefined).map((key) => [key, FieldValue.delete()]),
  );
}

/** Firestore (without ignoreUndefinedProperties) rejects undefined values. */
export function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SERIES_ID_RE = /^[A-Za-z0-9_-]{3,100}$/;
const SUPPORTED_FREQUENCIES = new Set(["DAILY", "WEEKLY", "MONTHLY"]);

/**
 * Validates and normalizes an admin series payload. Throws HttpsError with a
 * message the admin UI can show as-is.
 */
/** Rich content and monetization fields stored as sent (the admin UI owns their shape). */
const SERIES_PASSTHROUGH_FIELDS = [
  "linkedRfxId", "recordingUrl", "imageUrl", "ticketTypes", "sponsorships", "allowVendorTables",
  "vendorTablePriceCents", "upsellProducts", "heroImage", "gallery", "promoVideo", "speakerCards",
  "sponsorLogos", "topics", "audienceRules", "campaign",
] as const;

export function normalizeSeriesInput(
  input: Partial<EventSeriesDoc> | undefined,
  uid: string,
  now = Date.now(),
): EventSeriesDoc {
  if (!input || typeof input !== "object") throw new HttpsError("invalid-argument", "Series details are required.");
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  if (!title) throw new HttpsError("invalid-argument", "Add a title for the series.");
  if (!description) throw new HttpsError("invalid-argument", "Add a short description for the series.");
  const format = input.format;
  if (format !== "in-person" && format !== "virtual" && format !== "hybrid") {
    throw new HttpsError("invalid-argument", "Choose in person, virtual, or hybrid.");
  }
  const status = input.status || "draft";
  if (!["draft", "published", "cancelled", "completed"].includes(status)) {
    throw new HttpsError("invalid-argument", "Choose a valid series status.");
  }
  const id = String(input.id || `series_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`).trim();
  if (!SERIES_ID_RE.test(id)) throw new HttpsError("invalid-argument", "The series id can only use letters, numbers, dashes, and underscores.");
  const startTimeOfDay = String(input.startTimeOfDay || "").trim();
  if (!TIME_OF_DAY_RE.test(startTimeOfDay)) throw new HttpsError("invalid-argument", "Set a start time such as 09:00.");
  const durationMins = Math.round(Number(input.durationMins || 0));
  if (!Number.isFinite(durationMins) || durationMins < 15 || durationMins > 12 * 60) {
    throw new HttpsError("invalid-argument", "Set a duration between 15 minutes and 12 hours.");
  }
  const seriesStartDate = Number(input.seriesStartDate);
  if (!Number.isFinite(seriesStartDate) || seriesStartDate <= 0) {
    throw new HttpsError("invalid-argument", "Choose the date the series starts.");
  }
  const seriesEndDate = input.seriesEndDate == null || (input.seriesEndDate as unknown) === "" ? undefined : Number(input.seriesEndDate);
  if (seriesEndDate !== undefined && (!Number.isFinite(seriesEndDate) || seriesEndDate < seriesStartDate)) {
    throw new HttpsError("invalid-argument", "The end date has to be on or after the start date.");
  }
  const rrule = String(input.rrule || "FREQ=WEEKLY;INTERVAL=1").replace(/^RRULE:/i, "").trim();
  const freq = (parseRRuleParts(rrule).FREQ || "WEEKLY").toUpperCase();
  if (!SUPPORTED_FREQUENCIES.has(freq)) throw new HttpsError("invalid-argument", "Repeat daily, weekly, or monthly.");
  const location = String(input.location || "").trim() || undefined;
  const virtualUrl = String(input.virtualUrl || "").trim() || undefined;
  if (format !== "virtual" && !location) throw new HttpsError("invalid-argument", "Add a location for in-person or hybrid events.");
  if (format !== "in-person" && virtualUrl && !/^https:\/\//i.test(virtualUrl)) {
    throw new HttpsError("invalid-argument", "The virtual link has to start with https://.");
  }
  const seatCap = input.seatCap == null || (input.seatCap as unknown) === "" ? undefined : Math.round(Number(input.seatCap));
  if (seatCap !== undefined && (!Number.isFinite(seatCap) || seatCap < 1 || seatCap > 5000)) {
    throw new HttpsError("invalid-argument", "Seat cap has to be between 1 and 5000, or left blank.");
  }
  const price = Math.round(Number(input.price || 0));
  if (!Number.isFinite(price) || price < 0) throw new HttpsError("invalid-argument", "Price can't be negative.");

  // Only carry known series fields; anything else the client sends is dropped.
  const passthrough = Object.fromEntries(
    SERIES_PASSTHROUGH_FIELDS.filter((key) => input[key as keyof EventSeriesDoc] !== undefined)
      .map((key) => [key, input[key as keyof EventSeriesDoc]]),
  );

  return withoutUndefined({
    ...passthrough,
    id,
    title: title.slice(0, 200),
    description: description.slice(0, 5000),
    format,
    status,
    timezone: DEFAULT_TIME_ZONE,
    rrule,
    startTimeOfDay,
    durationMins,
    seriesStartDate,
    seriesEndDate,
    location,
    virtualUrl,
    seatCap,
    price,
    currency: String(input.currency || "USD").toUpperCase(),
    exceptions: Array.isArray(input.exceptions) ? input.exceptions.filter((value) => Number.isFinite(Number(value))).map(Number) : [],
    overrides: input.overrides && typeof input.overrides === "object" ? input.overrides : {},
    createdBy: String(input.createdBy || uid),
    createdAt: Number(input.createdAt) || now,
    updatedAt: now,
  }) as EventSeriesDoc;
}

/** First occurrence (if any) that breaks opening hours, for a clear admin error. */
export function firstSeriesHoursViolation(series: EventSeriesDoc, horizonDays = 180, now = Date.now()) {
  if (!seriesUsesFacility(series.format)) return null;
  const durationMs = Math.max(15, series.durationMins || 60) * 60 * 1000;
  for (const start of generateOccurrenceStarts(series, horizonDays, now)) {
    const override = overrideForDate(series, start);
    if (asBoolean(override?.cancelled)) continue;
    const finalStart = asNumber(override?.startTime) ?? start;
    const finalEnd = asNumber(override?.endTime) ?? finalStart + durationMs;
    if (seriesOccurrenceHoursViolation(series.format, finalStart, finalEnd)) return { start: finalStart, end: finalEnd };
  }
  return null;
}

function requireSeriesAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in as an admin to manage event series.");
  const role = String(request.auth.token.role || "");
  if (role !== "admin" && role !== "master") throw new HttpsError("permission-denied", "Admin access is required to manage event series.");
  return request.auth.uid;
}

function describeFacilityTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mergeOccurrenceTickets(
  templateTickets: Array<Record<string, unknown>>,
  existingTickets: unknown,
) {
  const existing = Array.isArray(existingTickets) ? existingTickets as Array<Record<string, unknown>> : [];
  return templateTickets.map((ticket) => {
    const id = String(ticket.id || "");
    const current = existing.find((item) => String(item.id || "") === id);
    return {
      ...ticket,
      soldCount: Math.max(0, Number(current?.soldCount ?? ticket.soldCount ?? 0)),
      heldCount: Math.max(0, Number(current?.heldCount ?? 0)),
    };
  });
}

async function upsertOccurrencesForSeries(series: EventSeriesDoc, horizonDays = 180) {
  const db = getDb();
  const timeZone = series.timezone || DEFAULT_TIME_ZONE;
  const starts = generateOccurrenceStarts(series, horizonDays);
  const durationMs = Math.max(15, series.durationMins || 60) * 60 * 1000;
  let skippedForHours = 0;

  const writes = starts.map(async (startTime) => {
    const override = overrideForDate(series, startTime);
    const eventId = occurrenceId(series.id, startTime);
    const eventRef = db.collection("events").doc(eventId);

    if (asBoolean(override?.cancelled)) {
      // A cancelled date must also come off the public calendar if it was
      // already generated. Registrations are guarded by the override callable.
      const existing = await eventRef.get();
      if (existing.exists && existing.data()?.status !== "cancelled") {
        await eventRef.set({ status: "cancelled", isOverride: true, updatedAt: Date.now() }, { merge: true });
      }
      return;
    }

    const overrideStartTime = asNumber(override?.startTime);
    const overrideEndTime = asNumber(override?.endTime);
    const finalStartTime = overrideStartTime ?? startTime;
    const finalEndTime = overrideEndTime ?? (finalStartTime + durationMs);
    const isOverride = !!override && Object.keys(override).length > 0;

    if (seriesOccurrenceHoursViolation(series.format, finalStartTime, finalEndTime)) {
      skippedForHours += 1;
      return;
    }

    const existingSnap = await eventRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() || {} : {};
    const confirmedQuantity = Math.max(
      0,
      Number(existingData.confirmedQuantity ?? existingData.registrationCount ?? 0),
    );
    const heldQuantity = Math.max(0, Number(existingData.heldQuantity || 0));
    const occurrenceDate = localMidnightEpoch(zonedDateTimeParts(startTime, timeZone), timeZone);
    const ticketTypes = mergeOccurrenceTickets(series.ticketTypes || [], existingData.ticketTypes);

    const { cancelled: _cancelled, ...overrideFields } = override || {};
    void _cancelled;
    const occurrence: Record<string, unknown> = {
      id: eventId,
      seriesId: series.id,
      occurrenceDate,
      title: String(override?.title || series.title),
      description: series.description,
      format: series.format,
      location: series.location,
      virtualUrl: series.virtualUrl,
      timezone: timeZone,
      startTime: finalStartTime,
      endTime: finalEndTime,
      occurrenceStartTime: startTime,
      occurrenceEndTime: startTime + durationMs,
      isOverride,
      seatCap: series.seatCap,
      registrationCount: confirmedQuantity,
      confirmedQuantity,
      heldQuantity,
      price: series.price || 0,
      currency: series.currency || "USD",
      linkedRfxId: series.linkedRfxId,
      // An occurrence cancelled or completed from the Events admin stays that way.
      status: existingData.status === "cancelled" || existingData.status === "completed"
        ? existingData.status
        : series.status,
      ticketTypes,
      sponsorships: series.sponsorships || [],
      allowVendorTables: !!series.allowVendorTables,
      vendorTablePriceCents: series.vendorTablePriceCents,
      upsellProducts: series.upsellProducts || [],
      heroImage: series.heroImage,
      gallery: series.gallery || [],
      promoVideo: series.promoVideo,
      speakerCards: series.speakerCards || [],
      sponsorLogos: series.sponsorLogos || [],
      topics: series.topics || [],
      audienceRules: series.audienceRules,
      campaign: series.campaign,
      createdBy: series.createdBy,
      createdAt: existingData.createdAt || Date.now(),
      updatedAt: Date.now(),
      ...overrideFields,
    };
    await eventRef.set(
      { ...withoutUndefined(occurrence), ...clearedFields(occurrence, CLEARABLE_OCCURRENCE_FIELDS) },
      { merge: true },
    );
  });

  await Promise.all(writes);
  if (skippedForHours > 0) {
    logger.warn("Skipped series occurrences outside opening hours", { seriesId: series.id, skippedForHours });
  }
  logger.info("Event series occurrences upserted", { seriesId: series.id, count: starts.length - skippedForHours, timeZone });
  return { generated: starts.length - skippedForHours, skippedForHours };
}

export const events_upsertSeries = onCall(async (request) => {
  const uid = requireSeriesAdmin(request);
  const { series } = (request.data || {}) as { series?: Partial<EventSeriesDoc> };
  const db = getDb();
  const draft = normalizeSeriesInput(series, uid);
  const seriesRef = db.collection("eventSeries").doc(draft.id);
  const existingSnap = await seriesRef.get();
  const existing = existingSnap.exists ? (existingSnap.data() as EventSeriesDoc) : null;
  const normalizedSeries: EventSeriesDoc = {
    ...draft,
    // Keep overrides/exceptions saved by the occurrence editor unless the caller sends new ones.
    overrides: series?.overrides ? draft.overrides : existing?.overrides || {},
    exceptions: series?.exceptions ? draft.exceptions : existing?.exceptions || [],
    createdBy: existing?.createdBy || draft.createdBy,
    createdAt: existing?.createdAt || draft.createdAt,
  };

  const violation = firstSeriesHoursViolation(normalizedSeries);
  if (violation) {
    throw new HttpsError(
      "invalid-argument",
      `${SERIES_HOURS_MESSAGE} The occurrence on ${describeFacilityTime(violation.start)} ET falls outside those hours.`,
    );
  }

  const seriesRecord = { ...normalizedSeries } as Record<string, unknown>;
  await seriesRef.set(
    { ...withoutUndefined(seriesRecord), ...clearedFields(seriesRecord, CLEARABLE_SERIES_FIELDS) },
    { merge: true },
  );
  const result = await upsertOccurrencesForSeries(normalizedSeries);
  return { success: true, seriesId: normalizedSeries.id, occurrences: result.generated };
});

export const events_setSeriesOccurrenceOverride = onCall(async (request) => {
  requireSeriesAdmin(request);

  const { seriesId, occurrenceDate, override, remove } = request.data as {
    seriesId?: string;
    occurrenceDate?: number;
    override?: Record<string, unknown>;
    remove?: boolean;
  };
  if (!seriesId || !Number.isFinite(Number(occurrenceDate))) {
    throw new HttpsError("invalid-argument", "Choose a series and an occurrence date.");
  }
  const cleanOverride = withoutUndefined({ ...(override || {}) });
  const overrideStart = asNumber(cleanOverride.startTime);
  const overrideEnd = asNumber(cleanOverride.endTime);
  if ((overrideStart !== undefined) !== (overrideEnd !== undefined) && !remove) {
    throw new HttpsError("invalid-argument", "Set both a start and an end time, or neither.");
  }
  if (overrideStart !== undefined && overrideEnd !== undefined && overrideEnd <= overrideStart) {
    throw new HttpsError("invalid-argument", "The end time has to be after the start time.");
  }

  const db = getDb();
  const seriesRef = db.collection("eventSeries").doc(seriesId);
  const series = await db.runTransaction(async (tx) => {
    const snap = await tx.get(seriesRef);
    if (!snap.exists) throw new HttpsError("not-found", "That series no longer exists.");
    const existing = snap.data() as EventSeriesDoc;
    if (!remove && overrideStart !== undefined && overrideEnd !== undefined
      && seriesOccurrenceHoursViolation(existing.format, overrideStart, overrideEnd)) {
      throw new HttpsError("invalid-argument", SERIES_HOURS_MESSAGE);
    }
    const timeZone = existing.timezone || DEFAULT_TIME_ZONE;
    const overrides = { ...(existing.overrides || {}) };
    const date = zonedDateTimeParts(Number(occurrenceDate), timeZone);
    const key = String(localMidnightEpoch(date, timeZone));

    if (!remove && asBoolean(cleanOverride.cancelled)) {
      const occurrences = await tx.get(db.collection("events").where("seriesId", "==", seriesId));
      const dateKey = dateKeyForTimestamp(Number(occurrenceDate), timeZone);
      const booked = occurrences.docs.find((doc) => {
        const data = doc.data();
        return dateKeyForTimestamp(Number(data.occurrenceStartTime || data.startTime), timeZone) === dateKey
          && Number(data.confirmedQuantity ?? data.registrationCount ?? 0) + Number(data.heldQuantity || 0) > 0;
      });
      if (booked) {
        throw new HttpsError(
          "failed-precondition",
          "This date already has registrations. Cancel it with Cancel event on the Events admin screen so attendees are notified and refunded.",
        );
      }
    }

    if (remove) delete overrides[key];
    else overrides[key] = cleanOverride;

    const updatedSeries: EventSeriesDoc = {
      ...existing,
      timezone: timeZone,
      overrides,
      updatedAt: Date.now(),
    };
    tx.set(seriesRef, { overrides, updatedAt: updatedSeries.updatedAt }, { merge: true });
    return updatedSeries;
  });

  await upsertOccurrencesForSeries(series);
  return { success: true };
});

export const events_extendHorizon = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: DEFAULT_TIME_ZONE,
    memory: "512MiB",
  },
  async () => {
    const db = getDb();
    const seriesSnap = await db.collection("eventSeries").where("status", "in", ["draft", "published"]).get();
    for (const doc of seriesSnap.docs) {
      const series = doc.data() as EventSeriesDoc;
      try {
        await upsertOccurrencesForSeries({ ...series, id: series.id || doc.id, timezone: series.timezone || DEFAULT_TIME_ZONE });
      } catch (err) {
        logger.error("Failed to extend event horizon for series", { seriesId: doc.id, err });
      }
    }
    logger.info("Event horizon extension complete", { seriesCount: seriesSnap.size });
  },
);
