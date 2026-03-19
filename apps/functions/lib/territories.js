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
exports.territory_release_scheduled = exports.territory_list_released = exports.territory_update = exports.territory_create = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() {
    return admin.firestore();
}
function requireAdminRole(request) {
    const role = request.auth?.token?.role;
    if (role !== "admin" && role !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin or master users can perform this action");
    }
}
function validateFips(fips) {
    if (!/^\d{5}$/.test(fips)) {
        throw new https_1.HttpsError("invalid-argument", "fips must be a 5-digit county code");
    }
}
exports.territory_create = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    requireAdminRole(request);
    const { fips, name, state, status, releaseDate, notes, centroid, type, timezone, autoReleaseEnabled, autoPauseEnabled, regionTag, needsReview, fipsStateCode, } = request.data;
    if (!fips || !name || !state) {
        throw new https_1.HttpsError("invalid-argument", "fips, name, and state are required");
    }
    validateFips(fips);
    const finalStatus = status ?? "scheduled";
    const db = getDb();
    const ref = db.collection("territories").doc(fips);
    const existing = await ref.get();
    if (existing.exists) {
        throw new https_1.HttpsError("already-exists", `Territory ${fips} already exists`);
    }
    const now = Date.now();
    const createdBy = request.auth.uid;
    const historyEntry = {
        status: finalStatus,
        at: now,
        by: createdBy,
        note: "Territory created",
    };
    await ref.set({
        fips,
        name: name.trim(),
        state: state.trim(),
        type: type ?? "county",
        timezone: typeof timezone === "string" && timezone.trim() ? timezone.trim() : "America/New_York",
        autoReleaseEnabled: typeof autoReleaseEnabled === "boolean" ? autoReleaseEnabled : true,
        autoPauseEnabled: typeof autoPauseEnabled === "boolean" ? autoPauseEnabled : false,
        regionTag: typeof regionTag === "string" ? regionTag.trim() : "",
        needsReview: Boolean(needsReview),
        fipsStateCode: typeof fipsStateCode === "string" ? fipsStateCode.trim() : fips.slice(0, 2),
        status: finalStatus,
        releaseDate: typeof releaseDate === "number" ? releaseDate : undefined,
        pausedAt: finalStatus === "paused" ? now : undefined,
        notes: notes?.trim() || "",
        centroid: centroid && Number.isFinite(centroid.lat) && Number.isFinite(centroid.lng)
            ? { lat: centroid.lat, lng: centroid.lng }
            : undefined,
        createdAt: now,
        updatedAt: now,
        updatedBy: createdBy,
        createdBy,
        statusHistory: [historyEntry],
    });
    logger.info("Territory created", { fips, status: finalStatus, by: request.auth.uid });
    return { success: true, fips };
});
exports.territory_update = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    requireAdminRole(request);
    const { fips, status, releaseDate, notes, centroid, name, state, type, timezone, autoReleaseEnabled, autoPauseEnabled, regionTag, needsReview, fipsStateCode, } = request.data;
    if (!fips) {
        throw new https_1.HttpsError("invalid-argument", "fips is required");
    }
    validateFips(fips);
    const db = getDb();
    const ref = db.collection("territories").doc(fips);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Territory not found");
    }
    const now = Date.now();
    const updates = {
        updatedAt: now,
        updatedBy: request.auth.uid,
    };
    let statusHistoryEntry = null;
    if (status) {
        updates.status = status;
        if (status === "paused") {
            updates.pausedAt = now;
        }
        statusHistoryEntry = {
            status,
            at: now,
            by: request.auth.uid,
            note: "Status updated",
        };
    }
    if (typeof releaseDate === "number") {
        updates.releaseDate = releaseDate;
    }
    if (releaseDate === null) {
        updates.releaseDate = admin.firestore.FieldValue.delete();
    }
    if (typeof notes === "string") {
        updates.notes = notes.trim();
    }
    if (typeof name === "string" && name.trim()) {
        updates.name = name.trim();
    }
    if (typeof state === "string" && state.trim()) {
        updates.state = state.trim();
    }
    if (type) {
        updates.type = type;
    }
    if (typeof timezone === "string" && timezone.trim()) {
        updates.timezone = timezone.trim();
    }
    if (typeof autoReleaseEnabled === "boolean") {
        updates.autoReleaseEnabled = autoReleaseEnabled;
    }
    if (typeof autoPauseEnabled === "boolean") {
        updates.autoPauseEnabled = autoPauseEnabled;
    }
    if (typeof regionTag === "string") {
        updates.regionTag = regionTag.trim();
    }
    if (typeof needsReview === "boolean") {
        updates.needsReview = needsReview;
    }
    if (typeof fipsStateCode === "string" && fipsStateCode.trim()) {
        updates.fipsStateCode = fipsStateCode.trim();
    }
    if (centroid === null) {
        updates.centroid = admin.firestore.FieldValue.delete();
    }
    else if (centroid &&
        Number.isFinite(centroid.lat) &&
        Number.isFinite(centroid.lng)) {
        updates.centroid = { lat: centroid.lat, lng: centroid.lng };
    }
    if (statusHistoryEntry) {
        updates.statusHistory = admin.firestore.FieldValue.arrayUnion(statusHistoryEntry);
    }
    await ref.update(updates);
    logger.info("Territory updated", { fips, updates: Object.keys(updates), by: request.auth.uid });
    return { success: true, fips };
});
exports.territory_list_released = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const db = getDb();
    const releasedSnap = await db
        .collection("territories")
        .where("status", "==", "released")
        .orderBy("name", "asc")
        .get();
    const scheduledSnap = await db
        .collection("territories")
        .where("status", "==", "scheduled")
        .orderBy("releaseDate", "asc")
        .get();
    return {
        released: releasedSnap.docs.map((d) => d.data()),
        scheduled: scheduledSnap.docs.map((d) => d.data()),
    };
});
exports.territory_release_scheduled = (0, scheduler_1.onSchedule)({
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    memory: "256MiB",
}, async () => {
    const db = getDb();
    const now = Date.now();
    const dueSnap = await db
        .collection("territories")
        .where("status", "==", "scheduled")
        .where("releaseDate", "<=", now)
        .get();
    if (dueSnap.empty) {
        logger.info("No scheduled territories due for release");
        return;
    }
    const batch = db.batch();
    dueSnap.docs.forEach((docSnap) => {
        batch.update(docSnap.ref, {
            status: "released",
            updatedAt: now,
        });
    });
    await batch.commit();
    logger.info("Released scheduled territories", {
        count: dueSnap.size,
        territoryFips: dueSnap.docs.map((d) => d.id),
    });
});
