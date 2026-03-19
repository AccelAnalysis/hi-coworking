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
exports.allocateMonthlyCredits = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const config_1 = require("../config");
const credits_1 = require("../credits");
function getDb() {
    return admin.firestore();
}
/**
 * Monthly scheduled task to allocate credits to active members.
 * Runs on the 1st of every month at 00:00 (midnight).
 */
exports.allocateMonthlyCredits = (0, scheduler_1.onSchedule)({
    schedule: "0 0 1 * *", // 1st of every month at midnight
    timeZone: "America/New_York", // Or UTC, but consistent with business ops
    memory: "512MiB",
}, async (event) => {
    logger.info("Starting monthly credit allocation...", { scheduleTime: event.scheduleTime });
    const db = getDb();
    const usersRef = db.collection("users");
    // Process in batches
    // Query for active members only
    const snapshot = await usersRef
        .where("membershipStatus", "==", "active")
        .get();
    if (snapshot.empty) {
        logger.info("No active members found for credit allocation.");
        return;
    }
    logger.info(`Found ${snapshot.size} active members. Processing...`);
    let successCount = 0;
    let errorCount = 0;
    const batchSize = 100; // arbitrary chunk size for potential batched writes if we weren't using `addCredits` helper
    // Since `addCredits` uses a transaction internally, we can just map over them.
    // However, `Promise.all` on thousands of users might overwhelm the connection.
    // Let's process in chunks.
    const users = snapshot.docs;
    for (let i = 0; i < users.length; i += batchSize) {
        const chunk = users.slice(i, i + batchSize);
        await Promise.all(chunk.map(async (doc) => {
            const userData = doc.data();
            const uid = doc.id;
            const planId = userData.plan;
            if (!planId) {
                logger.warn(`User ${uid} is active but has no plan ID.`);
                return;
            }
            // Find the tier definition
            const tier = config_1.MEMBERSHIP_TIERS.find((t) => t.id === planId);
            if (!tier) {
                // It might be a legacy plan or custom plan not in the standard config
                // We'll skip for now or log warning
                logger.debug(`User ${uid} has plan '${planId}' which is not in MEMBERSHIP_TIERS.`);
                return;
            }
            const creditsToGive = tier.includedCreditsPerMonth;
            if (creditsToGive <= 0) {
                return;
            }
            try {
                // We use a simplified description for the transaction
                const month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
                await (0, credits_1.addCredits)(uid, creditsToGive, "monthly_allocation", `Monthly included credits for ${tier.name} - ${month}`, `monthly_${new Date().toISOString().slice(0, 7)}` // Simple dedup key prefix
                );
                successCount++;
            }
            catch (err) {
                logger.error(`Failed to allocate credits for user ${uid}`, { err });
                errorCount++;
            }
        }));
    }
    logger.info("Monthly credit allocation complete.", { successCount, errorCount });
});
