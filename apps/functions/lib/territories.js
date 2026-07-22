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
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const MAX_BOUNDARY_POSITIONS = 25000;
const MAX_BOUNDARY_JSON_LENGTH = 700000;
function isValidCentroid(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return typeof candidate.lat === "number"
        && Number.isFinite(candidate.lat)
        && candidate.lat >= -90
        && candidate.lat <= 90
        && typeof candidate.lng === "number"
        && Number.isFinite(candidate.lng)
        && candidate.lng >= -180
        && candidate.lng <= 180;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPosition(value) {
    return Array.isArray(value)
        && value.length >= 2
        && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
        && value[0] >= -180
        && value[0] <= 180
        && value[1] >= -90
        && value[1] <= 90;
}
function positionsEqual(left, right) {
    return left[0] === right[0] && left[1] === right[1];
}
function isLinearRing(value) {
    return Array.isArray(value)
        && value.length >= 4
        && value.every(isPosition)
        && positionsEqual(value[0], value[value.length - 1]);
}
function isPolygonCoordinates(value) {
    return Array.isArray(value) && value.length > 0 && value.every(isLinearRing);
}
function isMultiPolygonCoordinates(value) {
    return Array.isArray(value) && value.length > 0 && value.every(isPolygonCoordinates);
}
function countBoundaryPositions(value) {
    if (isPosition(value))
        return 1;
    if (!Array.isArray(value))
        return 0;
    return value.reduce((total, item) => total + countBoundaryPositions(item), 0);
}
function parseBoundaryGeometry(value) {
    if (typeof value === "string") {
        try {
            return parseBoundaryGeometry(JSON.parse(value));
        }
        catch {
            return null;
        }
    }
    if (!isRecord(value) || !("coordinates" in value))
        return null;
    if (value.type === "Polygon" && isPolygonCoordinates(value.coordinates)) {
        return { type: "Polygon", coordinates: value.coordinates };
    }
    if (value.type === "MultiPolygon" && isMultiPolygonCoordinates(value.coordinates)) {
        return { type: "MultiPolygon", coordinates: value.coordinates };
    }
    return null;
}
function validateBoundaryGeometry(value) {
    const geometry = parseBoundaryGeometry(value);
    if (!geometry) {
        throw new https_1.HttpsError("invalid-argument", "boundaryGeoJSON must be a Polygon or MultiPolygon with finite, closed rings");
    }
    if (countBoundaryPositions(geometry.coordinates) > MAX_BOUNDARY_POSITIONS
        || JSON.stringify(geometry).length > MAX_BOUNDARY_JSON_LENGTH) {
        throw new https_1.HttpsError("invalid-argument", "boundaryGeoJSON is too large for a territory record");
    }
    return geometry;
}
function isTerritoryStatus(value) {
    return typeof value === "string"
        && ["scheduled", "released", "paused", "archived"].includes(value);
}
function isTerritoryType(value) {
    return typeof value === "string"
        && ["county", "city", "custom_polygon"].includes(value);
}
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
    const { fips, name, state, status, releaseDate, notes, centroid, type, timezone, autoReleaseEnabled, autoPauseEnabled, regionTag, needsReview, fipsStateCode, boundaryGeoJSON, } = request.data;
    if (!fips || !name || !state) {
        throw new https_1.HttpsError("invalid-argument", "fips, name, and state are required");
    }
    validateFips(fips);
    if (centroid !== undefined && !isValidCentroid(centroid)) {
        throw new https_1.HttpsError("invalid-argument", "centroid must contain valid latitude and longitude");
    }
    if (status !== undefined && !isTerritoryStatus(status)) {
        throw new https_1.HttpsError("invalid-argument", "status is not a supported territory status");
    }
    if (type !== undefined && !isTerritoryType(type)) {
        throw new https_1.HttpsError("invalid-argument", "type is not a supported territory type");
    }
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
        ...(typeof releaseDate === "number" ? { releaseDate } : {}),
        ...(finalStatus === "paused" ? { pausedAt: now } : {}),
        notes: notes?.trim() || "",
        ...(centroid && isValidCentroid(centroid)
            ? { centroid: { lat: centroid.lat, lng: centroid.lng } }
            : {}),
        ...(boundaryGeoJSON === undefined
            ? {}
            : { boundaryGeoJSON: JSON.stringify(validateBoundaryGeometry(boundaryGeoJSON)) }),
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
    const { fips, status, releaseDate, notes, centroid, name, state, type, timezone, autoReleaseEnabled, autoPauseEnabled, regionTag, needsReview, fipsStateCode, boundaryGeoJSON, } = request.data;
    if (!fips) {
        throw new https_1.HttpsError("invalid-argument", "fips is required");
    }
    validateFips(fips);
    if (status !== undefined && !isTerritoryStatus(status)) {
        throw new https_1.HttpsError("invalid-argument", "status is not a supported territory status");
    }
    if (type !== undefined && !isTerritoryType(type)) {
        throw new https_1.HttpsError("invalid-argument", "type is not a supported territory type");
    }
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
        updates.releaseDate = firestore_1.FieldValue.delete();
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
        updates.centroid = firestore_1.FieldValue.delete();
    }
    else if (centroid !== undefined && !isValidCentroid(centroid)) {
        throw new https_1.HttpsError("invalid-argument", "centroid must contain valid latitude and longitude");
    }
    else if (centroid && isValidCentroid(centroid)) {
        updates.centroid = { lat: centroid.lat, lng: centroid.lng };
    }
    if (boundaryGeoJSON === null) {
        updates.boundaryGeoJSON = firestore_1.FieldValue.delete();
    }
    else if (boundaryGeoJSON !== undefined) {
        updates.boundaryGeoJSON = JSON.stringify(validateBoundaryGeometry(boundaryGeoJSON));
    }
    if (statusHistoryEntry) {
        updates.statusHistory = firestore_1.FieldValue.arrayUnion(statusHistoryEntry);
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
    const [releasedSnap, scheduledSnap, pausedSnap, archivedSnap] = await Promise.all(["released", "scheduled", "paused", "archived"].map((status) => db
        .collection("territories")
        .where("status", "==", status)
        .limit(250)
        .get()));
    const projectForMap = (doc) => {
        const source = doc.data();
        const centroid = isValidCentroid(source.centroid)
            ? { lat: source.centroid.lat, lng: source.centroid.lng }
            : undefined;
        const boundaryGeoJSON = parseBoundaryGeometry(source.boundaryGeoJSON) ?? undefined;
        return {
            fips: typeof source.fips === "string" ? source.fips : doc.id,
            name: typeof source.name === "string" ? source.name : "Territory",
            state: typeof source.state === "string" ? source.state : "",
            status: source.status,
            type: isTerritoryType(source.type) ? source.type : "county",
            ...(typeof source.releaseDate === "number" ? { releaseDate: source.releaseDate } : {}),
            ...(centroid ? { centroid } : {}),
            ...(boundaryGeoJSON ? { boundaryGeoJSON } : {}),
            createdAt: typeof source.createdAt === "number" ? source.createdAt : 0,
            ...(typeof source.updatedAt === "number" ? { updatedAt: source.updatedAt } : {}),
        };
    };
    const byName = (left, right) => left.name.localeCompare(right.name) || left.fips.localeCompare(right.fips);
    const byReleaseDate = (left, right) => (left.releaseDate ?? Number.MAX_SAFE_INTEGER) - (right.releaseDate ?? Number.MAX_SAFE_INTEGER)
        || byName(left, right);
    return {
        released: releasedSnap.docs.map(projectForMap).sort(byName),
        scheduled: scheduledSnap.docs.map(projectForMap).sort(byReleaseDate),
        unreleased: [...pausedSnap.docs, ...archivedSnap.docs].map(projectForMap).sort(byName),
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
