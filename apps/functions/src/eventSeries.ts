import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

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
  const durationMs = Math.max(30, series.durationMins || 60) * 60 * 1000;

  const writes = starts.map(async (startTime) => {
    const override = overrideForDate(series, startTime);
    if (asBoolean(override?.cancelled)) return;

    const overrideStartTime = asNumber(override?.startTime);
    const overrideEndTime = asNumber(override?.endTime);
    const finalStartTime = overrideStartTime ?? startTime;
    const finalEndTime = overrideEndTime ?? (finalStartTime + durationMs);
    const isOverride = !!override && Object.keys(override).length > 0;

    const eventId = occurrenceId(series.id, startTime);
    const eventRef = db.collection("events").doc(eventId);
    const existingSnap = await eventRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() || {} : {};
    const confirmedQuantity = Math.max(
      0,
      Number(existingData.confirmedQuantity ?? existingData.registrationCount ?? 0),
    );
    const heldQuantity = Math.max(0, Number(existingData.heldQuantity || 0));
    const occurrenceDate = localMidnightEpoch(zonedDateTimeParts(startTime, timeZone), timeZone);
    const ticketTypes = mergeOccurrenceTickets(series.ticketTypes || [], existingData.ticketTypes);

    await eventRef.set({
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
      status: series.status,
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
      ...(override || {}),
    }, { merge: true });
  });

  await Promise.all(writes);
  logger.info("Event series occurrences upserted", { seriesId: series.id, count: starts.length, timeZone });
}

export const events_upsertSeries = onCall(async (request) => {
  if (!request.auth) throw new Error("unauthenticated");
  const role = request.auth.token.role as string | undefined;
  if (role !== "admin" && role !== "master") throw new Error("permission-denied");

  const { series } = request.data as { series?: EventSeriesDoc };
  if (!series?.id) throw new Error("invalid-argument");

  const db = getDb();
  const now = Date.now();
  const normalizedSeries: EventSeriesDoc = {
    ...series,
    timezone: series.timezone || DEFAULT_TIME_ZONE,
    createdAt: series.createdAt || now,
    updatedAt: now,
  };

  await db.collection("eventSeries").doc(series.id).set(normalizedSeries, { merge: true });
  await upsertOccurrencesForSeries(normalizedSeries);
  return { success: true, seriesId: series.id };
});

export const events_setSeriesOccurrenceOverride = onCall(async (request) => {
  if (!request.auth) throw new Error("unauthenticated");
  const role = request.auth.token.role as string | undefined;
  if (role !== "admin" && role !== "master") throw new Error("permission-denied");

  const { seriesId, occurrenceDate, override, remove } = request.data as {
    seriesId?: string;
    occurrenceDate?: number;
    override?: Record<string, unknown>;
    remove?: boolean;
  };
  if (!seriesId || !occurrenceDate) throw new Error("invalid-argument");

  const db = getDb();
  const seriesRef = db.collection("eventSeries").doc(seriesId);
  const series = await db.runTransaction(async (tx) => {
    const snap = await tx.get(seriesRef);
    if (!snap.exists) throw new Error("not-found");
    const existing = snap.data() as EventSeriesDoc;
    const timeZone = existing.timezone || DEFAULT_TIME_ZONE;
    const overrides = { ...(existing.overrides || {}) };
    const date = zonedDateTimeParts(occurrenceDate, timeZone);
    const key = String(localMidnightEpoch(date, timeZone));

    if (remove) delete overrides[key];
    else overrides[key] = { ...(override || {}) };

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
        await upsertOccurrencesForSeries({ ...series, timezone: series.timezone || DEFAULT_TIME_ZONE });
      } catch (err) {
        logger.error("Failed to extend event horizon for series", { seriesId: doc.id, err });
      }
    }
    logger.info("Event horizon extension complete", { seriesCount: seriesSnap.size });
  },
);
