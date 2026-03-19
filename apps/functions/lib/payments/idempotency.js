"use strict";
/**
 * Webhook Idempotency Helper (PR-09)
 *
 * Uses webhookEvents/{eventId} to de-duplicate incoming webhook events.
 * If an event has already been processed, returns false so the caller
 * can skip re-processing.
 */
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
exports.ensureIdempotent = ensureIdempotent;
exports.markWebhookResult = markWebhookResult;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() { return admin.firestore(); }
/**
 * Ensure a webhook event is processed at most once.
 *
 * @returns `true` if this is a new event and the caller should proceed.
 *          `false` if it was already processed (caller should skip).
 */
async function ensureIdempotent(eventId, provider) {
    const db = getDb();
    const ref = db.collection("webhookEvents").doc(eventId);
    try {
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.exists) {
                logger.info(`Webhook event ${eventId} already processed, skipping`, {
                    provider,
                    processedAt: snap.data()?.processedAt,
                });
                return false;
            }
            const doc = {
                eventId,
                provider,
                processedAt: Date.now(),
            };
            tx.set(ref, doc);
            return true;
        });
        return result;
    }
    catch (err) {
        logger.error("ensureIdempotent transaction failed", { eventId, provider, err });
        throw err;
    }
}
/**
 * Mark a previously-claimed webhook event with a result string.
 * Call this after processing completes (success or error).
 */
async function markWebhookResult(eventId, result) {
    await getDb().collection("webhookEvents").doc(eventId).update({ result });
}
