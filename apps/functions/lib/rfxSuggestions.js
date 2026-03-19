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
exports.rfx_refreshSuggestions_scheduled = exports.rfx_refreshSuggestions = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const db = admin.firestore();
function overlapCount(a = [], b = []) {
    if (!a.length || !b.length)
        return 0;
    const setA = new Set(a.map((x) => x.trim().toLowerCase()));
    return b.reduce((acc, code) => (setA.has(code.trim().toLowerCase()) ? acc + 1 : acc), 0);
}
function computeSuggestionScore(profile, rfx, releasedSet) {
    const reasons = [];
    let score = 0;
    const profileTerritory = typeof profile.territoryFips === "string" ? profile.territoryFips : undefined;
    const rfxTerritory = typeof rfx.territoryFips === "string" ? rfx.territoryFips : undefined;
    const rfxResponses = typeof rfx.responseCount === "number" ? rfx.responseCount : 0;
    const rfxCreatedAt = typeof rfx.createdAt === "number" ? rfx.createdAt : 0;
    const ageDays = Math.max(0, (Date.now() - rfxCreatedAt) / (1000 * 60 * 60 * 24));
    if (profileTerritory && rfxTerritory && profileTerritory === rfxTerritory) {
        score += 90;
        reasons.push("same_territory");
    }
    else if (rfxTerritory && releasedSet.has(rfxTerritory)) {
        score += 35;
        reasons.push("released_territory");
    }
    const profileNaics = Array.isArray(profile.naicsCodes) ? profile.naicsCodes : [];
    const rfxNaics = Array.isArray(rfx.naicsCodes) ? rfx.naicsCodes : [];
    const matches = overlapCount(profileNaics, rfxNaics);
    if (matches > 0) {
        score += Math.min(60, matches * 20);
        reasons.push("naics_overlap");
    }
    if (rfxResponses <= 2) {
        score += 15;
        reasons.push("low_competition");
    }
    score += Math.max(0, 20 - Math.floor(ageDays));
    if (ageDays < 3)
        reasons.push("fresh_opportunity");
    return {
        rfxId: String(rfx.id || ""),
        score,
        reasons,
    };
}
async function generateSuggestionsForUid(uid) {
    const [profileSnap, rfxSnap, releasedTerritoriesSnap] = await Promise.all([
        db.collection("profiles").doc(uid).get(),
        db
            .collection("rfx")
            .where("status", "==", "open")
            .where("adminApprovalStatus", "==", "approved")
            .orderBy("createdAt", "desc")
            .limit(250)
            .get(),
        db.collection("territories").where("status", "==", "released").get(),
    ]);
    if (!profileSnap.exists) {
        throw new https_1.HttpsError("not-found", "Profile not found for suggestion generation.");
    }
    const profile = profileSnap.data();
    const releasedSet = new Set(releasedTerritoriesSnap.docs
        .map((d) => d.data()?.fips)
        .filter((v) => typeof v === "string"));
    const suggestions = rfxSnap.docs
        .map((d) => computeSuggestionScore(profile, d.data(), releasedSet))
        .filter((s) => s.rfxId)
        .sort((a, b) => b.score - a.score)
        .slice(0, 60);
    await db.collection("userSuggestions").doc(uid).set({
        uid,
        suggestions,
        generatedAt: Date.now(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        algorithmVersion: "v1_local_first",
    }, { merge: true });
    return { count: suggestions.length };
}
exports.rfx_refreshSuggestions = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
    }
    const callerUid = request.auth.uid;
    const callerRole = request.auth.token.role;
    const targetUid = (callerRole === "admin" || callerRole === "master") && typeof request.data?.uid === "string"
        ? request.data.uid
        : callerUid;
    const result = await generateSuggestionsForUid(targetUid);
    return { success: true, uid: targetUid, ...result };
});
exports.rfx_refreshSuggestions_scheduled = (0, scheduler_1.onSchedule)("every 15 minutes", async () => {
    const profilesSnap = await db.collection("profiles").limit(500).get();
    let processed = 0;
    for (const profileDoc of profilesSnap.docs) {
        try {
            await generateSuggestionsForUid(profileDoc.id);
            processed += 1;
        }
        catch (err) {
            logger.error("Failed to generate suggestions for profile", {
                uid: profileDoc.id,
                err,
            });
        }
    }
    logger.info("RFx suggestion refresh complete", { processed });
});
