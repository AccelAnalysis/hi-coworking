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

function getDb() {
  return admin.firestore();
}

type RRuleFrequency = "daily" | "weekly" | "monthly";

function parseRRuleParts(rrule?: string): Record<string, string> {
  if (!rrule) return {};
  const normalized = rrule.replace(/^RRULE:/i, "");
  return normalized.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim().toUpperCase();
    const value = rawValue.join("=").trim();
    if (key && value) {
      acc[key] = value;
    }
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
  const dayMap: Record<string, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
  };
  const values = byDay.split(",").map((entry) => entry.trim().toUpperCase());
  const parsed = values
    .map((value) => dayMap[value.slice(-2)])
    .filter((value): value is number => Number.isInteger(value));
  return parsed.length ? new Set(parsed) : null;
}

function parseByMonthDay(parts: Record<string, string>): number | null {
  const raw = parts.BYMONTHDAY;
  if (!raw) return null;
  const value = parseInt(raw.split(",")[0], 10);
  if (!Number.isFinite(value) || value === 0 || value < -31 || value > 31) {
    return null;
  }
  return value;
}

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function applyTimeOfDay(dayTs: number, timeOfDay?: string): number {
  const d = new Date(dayTs);
  const [hh, mm] = (timeOfDay || "09:00").split(":").map((v) => parseInt(v, 10));
  d.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
  return d.getTime();
}

function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function weeksBetween(startTs: number, targetTs: number): number {
  return Math.floor((dayStart(targetTs) - dayStart(startTs)) / (7 * 24 * 60 * 60 * 1000));
}

function monthsBetween(startTs: number, targetTs: number): number {
  const start = new Date(startTs);
  const target = new Date(targetTs);
  return (target.getFullYear() - start.getFullYear()) * 12 + (target.getMonth() - start.getMonth());
}

function resolveMonthlyDay(cursor: Date, byMonthDay: number | null, fallbackDay: number): boolean {
  if (byMonthDay == null) {
    return cursor.getDate() === fallbackDay;
  }
  if (byMonthDay > 0) {
    return cursor.getDate() === byMonthDay;
  }
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  return cursor.getDate() === lastDay + byMonthDay + 1;
}

function generateOccurrenceStarts(series: EventSeriesDoc, horizonDays = 180): number[] {
  const now = Date.now();
  const startBoundary = dayStart(series.seriesStartDate || now);
  const endBoundary = Math.min(
    dayStart(series.seriesEndDate || now + horizonDays * 24 * 60 * 60 * 1000),
    dayStart(now + horizonDays * 24 * 60 * 60 * 1000)
  );

  const parts = parseRRuleParts(series.rrule);
  const frequency = parseRRuleFrequency(parts);
  const interval = parseRRuleInterval(parts);
  const byDay = parseByDay(parts);
  const byMonthDay = parseByMonthDay(parts);

  const exceptions = new Set((series.exceptions || []).map(dayStart));
  const starts: number[] = [];
  const seriesStartDay = new Date(startBoundary).getDay();
  const seriesStartDate = new Date(startBoundary).getDate();

  for (let cursor = startBoundary; cursor <= endBoundary; cursor = addDays(cursor, 1)) {
    const day = dayStart(cursor);
    if (exceptions.has(day)) continue;

    if (frequency === "daily") {
      const dayDiff = Math.floor((day - startBoundary) / (24 * 60 * 60 * 1000));
      if (dayDiff % interval !== 0) continue;
    }

    if (frequency === "weekly") {
      const weekDiff = weeksBetween(startBoundary, day);
      if (weekDiff % interval !== 0) continue;
      if (byDay && !byDay.has(new Date(day).getDay())) continue;
      if (!byDay && new Date(day).getDay() !== seriesStartDay) continue;
    }

    if (frequency === "monthly") {
      const monthDiff = monthsBetween(startBoundary, day);
      if (monthDiff % interval !== 0) continue;
      if (!resolveMonthlyDay(new Date(day), byMonthDay, seriesStartDate)) continue;
    }

    starts.push(applyTimeOfDay(day, series.startTimeOfDay));
  }

  return starts;
}

function occurrenceId(seriesId: string, startTs: number): string {
  return `evt_${seriesId}_${startTs}`;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getOccurrenceOverride(series: EventSeriesDoc, startTime: number): Record<string, unknown> | undefined {
  const byDay = series.overrides?.[String(dayStart(startTime))];
  if (byDay) return byDay;
  return series.overrides?.[String(startTime)];
}

async function upsertOccurrencesForSeries(series: EventSeriesDoc, horizonDays = 180) {
  const db = getDb();
  const starts = generateOccurrenceStarts(series, horizonDays);
  const durationMs = Math.max(30, series.durationMins || 60) * 60 * 1000;

  const writes = starts.map(async (startTime) => {
    const override = getOccurrenceOverride(series, startTime);
    if (asBoolean(override?.cancelled)) {
      return;
    }

    const overrideStartTime = asNumber(override?.startTime);
    const overrideEndTime = asNumber(override?.endTime);
    const finalStartTime = overrideStartTime ?? startTime;
    const finalEndTime = overrideEndTime ?? (finalStartTime + durationMs);
    const isOverride = !!override && Object.keys(override).length > 0;

    const eventId = occurrenceId(series.id, startTime);
    const eventRef = db.collection("events").doc(eventId);
    const existingSnap = await eventRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() || {} : {};

    await eventRef.set({
      id: eventId,
      seriesId: series.id,
      occurrenceDate: dayStart(startTime),
      title: series.title,
      description: series.description,
      format: series.format,
      location: series.location,
      virtualUrl: series.virtualUrl,
      startTime: finalStartTime,
      endTime: finalEndTime,
      occurrenceStartTime: startTime,
      occurrenceEndTime: startTime + durationMs,
      isOverride,
      seatCap: series.seatCap,
      registrationCount: existingData.registrationCount || 0,
      price: series.price || 0,
      currency: series.currency || "USD",
      linkedRfxId: series.linkedRfxId,
      status: series.status,
      ticketTypes: series.ticketTypes || [],
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
  logger.info("Event series occurrences upserted", { seriesId: series.id, count: starts.length });
}

export const events_upsertSeries = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("unauthenticated");
  }

  const role = request.auth.token.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new Error("permission-denied");
  }

  const { series } = request.data as { series?: EventSeriesDoc };
  if (!series?.id) {
    throw new Error("invalid-argument");
  }

  const db = getDb();
  const now = Date.now();

  await db.collection("eventSeries").doc(series.id).set({
    ...series,
    timezone: series.timezone || "America/New_York",
    createdAt: series.createdAt || now,
    updatedAt: now,
  }, { merge: true });

  await upsertOccurrencesForSeries({
    ...series,
    timezone: series.timezone || "America/New_York",
    createdAt: series.createdAt || now,
    updatedAt: now,
  });

  return { success: true, seriesId: series.id };
});

export const events_setSeriesOccurrenceOverride = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("unauthenticated");
  }

  const role = request.auth.token.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new Error("permission-denied");
  }

  const {
    seriesId,
    occurrenceDate,
    override,
    remove,
  } = request.data as {
    seriesId?: string;
    occurrenceDate?: number;
    override?: Record<string, unknown>;
    remove?: boolean;
  };

  if (!seriesId || !occurrenceDate) {
    throw new Error("invalid-argument");
  }

  const db = getDb();
  const seriesRef = db.collection("eventSeries").doc(seriesId);

  const series = await db.runTransaction(async (tx) => {
    const snap = await tx.get(seriesRef);
    if (!snap.exists) {
      throw new Error("not-found");
    }

    const existing = snap.data() as EventSeriesDoc;
    const overrides = { ...(existing.overrides || {}) };
    const key = String(dayStart(occurrenceDate));

    if (remove) {
      delete overrides[key];
    } else {
      overrides[key] = { ...(override || {}) };
    }

    const updatedSeries: EventSeriesDoc = {
      ...existing,
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
    timeZone: "America/New_York",
    memory: "512MiB",
  },
  async () => {
    const db = getDb();
    const seriesSnap = await db.collection("eventSeries").where("status", "in", ["draft", "published"]).get();

    for (const doc of seriesSnap.docs) {
      const series = doc.data() as EventSeriesDoc;
      try {
        await upsertOccurrencesForSeries(series);
      } catch (err) {
        logger.error("Failed to extend event horizon for series", { seriesId: doc.id, err });
      }
    }

    logger.info("Event horizon extension complete", { seriesCount: seriesSnap.size });
  }
);
