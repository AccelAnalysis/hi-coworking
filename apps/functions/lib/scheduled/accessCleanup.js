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
exports.access_noShowRevoke = exports.access_expireGrants = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const access_1 = require("../access");
const db = admin.firestore();
/**
 * Runs every 15 minutes.
 * Revokes grants whose endsAt has passed (expired).
 */
exports.access_expireGrants = (0, scheduler_1.onSchedule)({ schedule: "every 15 minutes", secrets: [access_1.seamApiKey] }, async () => {
    const now = Date.now();
    const snap = await db
        .collection("accessGrants")
        .where("endsAt", "<", now)
        .where("status", "in", ["pending", "active"])
        .limit(50)
        .get();
    if (snap.empty) {
        logger.info("access_expireGrants: no expired grants found");
        return;
    }
    logger.info(`access_expireGrants: revoking ${snap.size} expired grants`);
    await Promise.allSettled(snap.docs.map((doc) => (0, access_1.revokeAccessGrant)(doc.id, "expired", "system")));
});
/**
 * Runs every 15 minutes.
 * Revokes grants where the booking start + NO_SHOW_GRACE_MINUTES has passed
 * but no code_used event has been recorded — indicating a no-show.
 */
exports.access_noShowRevoke = (0, scheduler_1.onSchedule)({ schedule: "every 15 minutes", secrets: [access_1.seamApiKey] }, async () => {
    const now = Date.now();
    const noShowCutoff = now - access_1.NO_SHOW_GRACE_MINUTES * 60 * 1000;
    // Find grants that started more than NO_SHOW_GRACE_MINUTES ago and are still active
    const snap = await db
        .collection("accessGrants")
        .where("startsAt", "<", noShowCutoff)
        .where("endsAt", ">", now) // Not yet expired
        .where("status", "==", "active")
        .limit(50)
        .get();
    if (snap.empty) {
        logger.info("access_noShowRevoke: no candidate grants found");
        return;
    }
    let noShowCount = 0;
    await Promise.allSettled(snap.docs.map(async (doc) => {
        const grantId = doc.id;
        // Check if any code_used event exists for this grant
        const usedEventsSnap = await db
            .collection("accessEvents")
            .where("grantId", "==", grantId)
            .where("eventType", "==", "code_used")
            .limit(1)
            .get();
        if (usedEventsSnap.empty) {
            // No usage recorded — treat as no-show
            noShowCount++;
            await (0, access_1.revokeAccessGrant)(grantId, "no_show", "system");
        }
    }));
    logger.info(`access_noShowRevoke: processed ${snap.size} candidates, revoked ${noShowCount} no-shows`);
});
