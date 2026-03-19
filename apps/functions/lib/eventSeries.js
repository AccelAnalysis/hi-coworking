"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.events_extendHorizon = exports.events_setSeriesOccurrenceOverride = exports.events_upsertSeries = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() {
    return admin.firestore();
}
function parseRRuleParts(rrule) {
    if (!rrule)
        return {};
    const normalized = rrule.replace(/^RRULE:/i, "");
    return normalized.split(";").reduce((acc, part) => {
        const [rawKey, ...rawValue] = part.split("=");
        const key = rawKey?.trim().toUpperCase();
        const value = rawValue.join("=").trim();
        if (key && value) {
            acc[key] = value;
        }
        return acc;
    }, {});
}
function parseRRuleFrequency(parts) {
    const freq = (parts.FREQ || "WEEKLY").toUpperCase();
    if (freq === "DAILY")
        return "daily";
    if (freq === "MONTHLY")
        return "monthly";
    return "weekly";
}
function parseRRuleInterval(parts) {
    const value = parseInt(parts.INTERVAL || "1", 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
}
function parseByDay(parts) {
    const byDay = parts.BYDAY;
    if (!byDay)
        return null;
    const dayMap = {
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
        .filter((value) => Number.isInteger(value));
    return parsed.length ? new Set(parsed) : null;
}
function parseByMonthDay(parts) {
    const raw = parts.BYMONTHDAY;
    if (!raw)
        return null;
    const value = parseInt(raw.split(",")[0], 10);
    if (!Number.isFinite(value) || value === 0 || value < -31 || value > 31) {
        return null;
    }
    return value;
}
function dayStart(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
function applyTimeOfDay(dayTs, timeOfDay) {
    const d = new Date(dayTs);
    const [hh, mm] = (timeOfDay || "09:00").split(":").map((v) => parseInt(v, 10));
    d.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
    return d.getTime();
}
function addDays(ts, days) {
    const d = new Date(ts);
    d.setDate(d.getDate() + days);
    return d.getTime();
}
function weeksBetween(startTs, targetTs) {
    return Math.floor((dayStart(targetTs) - dayStart(startTs)) / (7 * 24 * 60 * 60 * 1000));
}
function monthsBetween(startTs, targetTs) {
    const start = new Date(startTs);
    const target = new Date(targetTs);
    return (target.getFullYear() - start.getFullYear()) * 12 + (target.getMonth() - start.getMonth());
}
function resolveMonthlyDay(cursor, byMonthDay, fallbackDay) {
    if (byMonthDay == null) {
        return cursor.getDate() === fallbackDay;
    }
    if (byMonthDay > 0) {
        return cursor.getDate() === byMonthDay;
    }
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return cursor.getDate() === lastDay + byMonthDay + 1;
}
function generateOccurrenceStarts(series, horizonDays = 180) {
    const now = Date.now();
    const startBoundary = dayStart(series.seriesStartDate || now);
    const endBoundary = Math.min(dayStart(series.seriesEndDate || now + horizonDays * 24 * 60 * 60 * 1000), dayStart(now + horizonDays * 24 * 60 * 60 * 1000));
    const parts = parseRRuleParts(series.rrule);
    const frequency = parseRRuleFrequency(parts);
    const interval = parseRRuleInterval(parts);
    const byDay = parseByDay(parts);
    const byMonthDay = parseByMonthDay(parts);
    const exceptions = new Set((series.exceptions || []).map(dayStart));
    const starts = [];
    const seriesStartDay = new Date(startBoundary).getDay();
    const seriesStartDate = new Date(startBoundary).getDate();
    for (let cursor = startBoundary; cursor <= endBoundary; cursor = addDays(cursor, 1)) {
        const day = dayStart(cursor);
        if (exceptions.has(day))
            continue;
        if (frequency === "daily") {
            const dayDiff = Math.floor((day - startBoundary) / (24 * 60 * 60 * 1000));
            if (dayDiff % interval !== 0)
                continue;
        }
        if (frequency === "weekly") {
            const weekDiff = weeksBetween(startBoundary, day);
            if (weekDiff % interval !== 0)
                continue;
            if (byDay && !byDay.has(new Date(day).getDay()))
                continue;
            if (!byDay && new Date(day).getDay() !== seriesStartDay)
                continue;
        }
        if (frequency === "monthly") {
            const monthDiff = monthsBetween(startBoundary, day);
            if (monthDiff % interval !== 0)
                continue;
            if (!resolveMonthlyDay(new Date(day), byMonthDay, seriesStartDate))
                continue;
        }
        starts.push(applyTimeOfDay(day, series.startTimeOfDay));
    }
    return starts;
}
function occurrenceId(seriesId, startTs) {
    return `evt_${seriesId}_${startTs}`;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function asBoolean(value) {
    return typeof value === "boolean" ? value : undefined;
}
function getOccurrenceOverride(series, startTime) {
    const byDay = series.overrides?.[String(dayStart(startTime))];
    if (byDay)
        return byDay;
    return series.overrides?.[String(startTime)];
}
async function upsertOccurrencesForSeries(series, horizonDays = 180) {
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
exports.events_upsertSeries = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error("unauthenticated");
    }
    const role = request.auth.token.role;
    if (role !== "admin" && role !== "master") {
        throw new Error("permission-denied");
    }
    const { series } = request.data;
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
exports.events_setSeriesOccurrenceOverride = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error("unauthenticated");
    }
    const role = request.auth.token.role;
    if (role !== "admin" && role !== "master") {
        throw new Error("permission-denied");
    }
    const { seriesId, occurrenceDate, override, remove, } = request.data;
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
        const existing = snap.data();
        const overrides = { ...(existing.overrides || {}) };
        const key = String(dayStart(occurrenceDate));
        if (remove) {
            delete overrides[key];
        }
        else {
            overrides[key] = { ...(override || {}) };
        }
        const updatedSeries = {
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
exports.events_extendHorizon = (0, scheduler_1.onSchedule)({
    schedule: "0 4 * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
}, async () => {
    const db = getDb();
    const seriesSnap = await db.collection("eventSeries").where("status", "in", ["draft", "published"]).get();
    for (const doc of seriesSnap.docs) {
        const series = doc.data();
        try {
            await upsertOccurrencesForSeries(series);
        }
        catch (err) {
            logger.error("Failed to extend event horizon for series", { seriesId: doc.id, err });
        }
    }
    logger.info("Event horizon extension complete", { seriesCount: seriesSnap.size });
});
