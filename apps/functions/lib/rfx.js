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
exports.rfx_backfillGeo = exports.rfx_publish = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const config_1 = require("./config");
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function getDb() {
    return admin.firestore();
}
function encodeGeohash(lat, lng, precision = 9) {
    let idx = 0;
    let bit = 0;
    let evenBit = true;
    let geohash = "";
    let latMin = -90;
    let latMax = 90;
    let lngMin = -180;
    let lngMax = 180;
    while (geohash.length < precision) {
        if (evenBit) {
            const mid = (lngMin + lngMax) / 2;
            if (lng >= mid) {
                idx = idx * 2 + 1;
                lngMin = mid;
            }
            else {
                idx = idx * 2;
                lngMax = mid;
            }
        }
        else {
            const mid = (latMin + latMax) / 2;
            if (lat >= mid) {
                idx = idx * 2 + 1;
                latMin = mid;
            }
            else {
                idx = idx * 2;
                latMax = mid;
            }
        }
        evenBit = !evenBit;
        if (++bit === 5) {
            geohash += BASE32.charAt(idx);
            bit = 0;
            idx = 0;
        }
    }
    return geohash;
}
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function normalizeGeoFromInput(data) {
    const nestedGeo = data.geo;
    const rawLat = isFiniteNumber(data.geoLat) ? data.geoLat : nestedGeo?.lat;
    const rawLng = isFiniteNumber(data.geoLng) ? data.geoLng : nestedGeo?.lng;
    if (!isFiniteNumber(rawLat) || !isFiniteNumber(rawLng)) {
        return null;
    }
    if (rawLat < -90 || rawLat > 90 || rawLng < -180 || rawLng > 180) {
        return null;
    }
    return {
        lat: rawLat,
        lng: rawLng,
        geohash: encodeGeohash(rawLat, rawLng),
    };
}
function requireAdminOrMaster(request) {
    const role = request.auth?.token?.role;
    if (role !== "admin" && role !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin/master can run this operation");
    }
}
/**
 * Publish an RFx.
 * Handles monetization: checks active post limits and deducts credits if necessary.
 */
exports.rfx_publish = (0, https_1.onCall)(async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to publish RFx");
    }
    const uid = request.auth.uid;
    const data = request.data;
    const title = typeof data.title === "string" ? data.title : "";
    const description = typeof data.description === "string" ? data.description : "";
    const territoryFips = typeof data.territoryFips === "string" ? data.territoryFips : "";
    const adminApprovalStatus = typeof data.adminApprovalStatus === "string" ? data.adminApprovalStatus : "approved";
    // Basic validation (more detailed validation should be done on client or use Zod here if needed)
    if (!title || !description) {
        throw new https_1.HttpsError("invalid-argument", "Title and description are required");
    }
    if (!territoryFips) {
        throw new https_1.HttpsError("invalid-argument", "territoryFips is required");
    }
    const normalizedGeo = normalizeGeoFromInput(data);
    if (!normalizedGeo) {
        throw new https_1.HttpsError("invalid-argument", "Valid geoLat/geoLng (or geo.lat/geo.lng) are required");
    }
    const db = getDb();
    // 2. Monetization Check (Transactional)
    return await db.runTransaction(async (t) => {
        const userRef = db.collection("users").doc(uid);
        const userDoc = await t.get(userRef);
        if (!userDoc.exists) {
            throw new https_1.HttpsError("not-found", "User profile not found");
        }
        const userData = userDoc.data();
        const planId = userData?.plan;
        const role = userData?.role;
        // 2a. Territory + verification transact gate (admin/master bypass)
        if (role !== "admin" && role !== "master") {
            const territoryRef = db.collection("territories").doc(territoryFips);
            const territoryDoc = await t.get(territoryRef);
            if (!territoryDoc.exists) {
                throw new https_1.HttpsError("failed-precondition", "Selected territory not found");
            }
            const territoryStatus = territoryDoc.data()?.status;
            if (territoryStatus !== "released") {
                throw new https_1.HttpsError("failed-precondition", "Territory has not been released for transactions");
            }
            const profileRef = db.collection("profiles").doc(uid);
            const profileDoc = await t.get(profileRef);
            const verificationStatus = profileDoc.data()?.verificationStatus;
            if (verificationStatus !== "verified") {
                throw new https_1.HttpsError("failed-precondition", "Company verification required before publishing RFx");
            }
        }
        // Admins bypass limits
        if (role === "admin" || role === "master") {
            logger.info(`Admin ${uid} bypassing RFx limits`);
        }
        else {
            // Get Plan Limits
            const tier = config_1.MEMBERSHIP_TIERS.find(t => t.id === planId);
            const limit = tier?.limits.rfxActivePosts ?? 0; // Default to 0 if no plan (or Virtual)
            // Count active posts
            // Note: Transactional query for count might be expensive or limited. 
            // Ideally we track 'activeRfxCount' on userDoc, but for now let's query.
            // Since we are inside a transaction, we must use t.get().
            const activeRfxQuery = db.collection("rfx")
                .where("createdBy", "==", uid)
                .where("status", "==", "open");
            const activeSnap = await t.get(activeRfxQuery);
            const currentActive = activeSnap.size;
            if (currentActive < limit) {
                logger.info(`User ${uid} within RFx limit (${currentActive}/${limit}). Publishing for free.`);
            }
            else {
                // Over limit - try to charge credits
                const cost = config_1.CREDIT_COSTS.RFX_PUBLISH;
                const currentCredits = userData?.credits || 0;
                if (currentCredits < cost) {
                    throw new https_1.HttpsError("resource-exhausted", `You have reached your limit of ${limit} active RFx posts. Publishing requires ${cost} credits, but you only have ${currentCredits}.`);
                }
                // Deduct credits logic inline or call helper? 
                // Helper `deductCredits` uses its own transaction. We are ALREADY in a transaction.
                // We cannot call `deductCredits` here. We must duplicate logic or refactor.
                // Let's duplicate simple deduction logic here to keep it in ONE transaction.
                const newCreditBalance = currentCredits - cost;
                t.update(userRef, {
                    credits: newCreditBalance,
                    updatedAt: Date.now()
                });
                // Log transaction
                const transRef = db.collection("creditTransactions").doc();
                t.set(transRef, {
                    id: transRef.id,
                    userId: uid,
                    amount: -cost,
                    type: "usage",
                    referenceId: "pending_rfx_creation", // Will verify this later or just use correlation
                    description: `Publish RFx: ${title.substring(0, 30)}...`,
                    createdAt: Date.now()
                });
                logger.info(`User ${uid} over limit. Deducted ${cost} credits.`);
            }
        }
        // 3. Create RFx
        const rfxRef = db.collection("rfx").doc();
        const rfxDoc = {
            ...data,
            title,
            description,
            territoryFips,
            geo: normalizedGeo,
            id: rfxRef.id,
            createdBy: uid,
            createdByName: userData?.displayName || request.auth?.token.name || "Unknown",
            status: "open",
            responseCount: 0,
            createdAt: Date.now(),
            // Ensure admin approval status is set (default to approved for now, or pending if needed)
            adminApprovalStatus,
        };
        t.set(rfxRef, rfxDoc);
        return { id: rfxRef.id };
    });
});
/**
 * Admin-only backfill for geo.geohash on existing RFx docs.
 * Uses existing geo lat/lng when available, otherwise falls back to territory centroid.
 */
exports.rfx_backfillGeo = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    requireAdminOrMaster(request);
    const db = getDb();
    const maxDocs = Math.min(1000, Math.max(1, Number(request.data?.maxDocs ?? 300)));
    const [rfxSnap, territorySnap] = await Promise.all([
        db.collection("rfx").orderBy("createdAt", "desc").limit(maxDocs).get(),
        db.collection("territories").get(),
    ]);
    const territoryCentroidByFips = new Map();
    territorySnap.docs.forEach((docSnap) => {
        const row = docSnap.data();
        if (!row.fips || !row.centroid)
            return;
        if (!isFiniteNumber(row.centroid.lat) || !isFiniteNumber(row.centroid.lng))
            return;
        territoryCentroidByFips.set(row.fips, { lat: row.centroid.lat, lng: row.centroid.lng });
    });
    const batch = db.batch();
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    rfxSnap.docs.forEach((docSnap) => {
        processed += 1;
        const row = docSnap.data();
        const hasGeohash = typeof row.geo?.geohash === "string" && row.geo.geohash.length > 0;
        if (hasGeohash) {
            skipped += 1;
            return;
        }
        const directLat = isFiniteNumber(row.geo?.lat) ? row.geo.lat : undefined;
        const directLng = isFiniteNumber(row.geo?.lng) ? row.geo.lng : undefined;
        const territoryFallback = row.territoryFips
            ? territoryCentroidByFips.get(row.territoryFips)
            : undefined;
        const lat = directLat ?? territoryFallback?.lat;
        const lng = directLng ?? territoryFallback?.lng;
        if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
            skipped += 1;
            return;
        }
        batch.update(docSnap.ref, {
            geo: {
                lat,
                lng,
                geohash: encodeGeohash(lat, lng),
            },
            updatedAt: Date.now(),
        });
        updated += 1;
    });
    if (updated > 0) {
        await batch.commit();
    }
    logger.info("RFx geo backfill completed", { processed, updated, skipped });
    return { success: true, processed, updated, skipped };
});
