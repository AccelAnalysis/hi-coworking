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
exports.onReferralWritten = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() {
    return admin.firestore();
}
/**
 * Trigger: When a Referral document is written (created, updated, deleted).
 * Updates the Provider's trust stats and badges.
 */
exports.onReferralWritten = (0, firestore_1.onDocumentWritten)("referrals/{referralId}", async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    // We only care if the providerUid is involved and status changed or created
    const providerUid = after?.providerUid || before?.providerUid;
    if (!providerUid)
        return; // Not a business intro referral or no provider assigned
    // If provider changed (unlikely but possible), update both
    if (before?.providerUid && after?.providerUid && before.providerUid !== after.providerUid) {
        await updateProviderStats(before.providerUid);
        await updateProviderStats(after.providerUid);
        return;
    }
    // Update stats for the provider
    await updateProviderStats(providerUid);
});
async function updateProviderStats(providerUid) {
    const db = getDb();
    const providerRef = db.collection("profiles").doc(providerUid);
    // Fetch all referrals for this provider to recalculate stats
    // (In a high-scale system, we'd use incremental updates or scheduled jobs, 
    // but for <1000 referrals per user, this is fine for now)
    const referralsQuery = db.collection("referrals").where("providerUid", "==", providerUid);
    const snapshot = await referralsQuery.get();
    const referrals = snapshot.docs.map(d => d.data());
    if (referrals.length === 0)
        return;
    const now = Date.now();
    const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);
    // Stats Counters
    let referralsConverted = 0;
    let payoutsPlatformManaged = 0;
    let payoutsOnTime = 0;
    let payoutsTotal = 0;
    let disputesOpened = 0;
    let disputesLost = 0; // Requires dispute tracking (future)
    let responseTimes = [];
    referrals.forEach(ref => {
        // 1. Conversion count
        if (ref.status === "converted" || ref.status === "paid") {
            referralsConverted++;
        }
        // 2. Payout stats (only if marked paid)
        if (ref.status === "paid" && ref.paidAt) {
            payoutsTotal++;
            // Check if platform managed (TODO: Add flag to ReferralDoc for 'payoutMethod')
            // For now, assume manual unless flagged
            // Check on-time
            // Default policy: Net 10 after invoice? We need 'convertedAt' + policy window.
            // If we don't have policy snapshot, assume 30 days.
            const convertedAt = ref.convertedAt || ref.createdAt; // Fallback
            const windowDays = ref.policySnapshot?.attributionWindowDays || 90; // Actually window is for conversion, payout trigger is different.
            // Let's assume generic "14 days after conversion" for "on-time" if not specified.
            // In real implementation, parse `payoutTrigger`.
            const payoutDueAt = convertedAt + (14 * 24 * 60 * 60 * 1000);
            if (ref.paidAt <= payoutDueAt) {
                payoutsOnTime++;
            }
        }
        // 3. Response Time (for badges)
        // Time from createdAt to acceptedAt or declinedAt
        if (ref.acceptedAt) {
            responseTimes.push(ref.acceptedAt - ref.createdAt);
        }
        // 4. Disputes
        if (ref.status === "disputed") {
            disputesOpened++;
        }
    });
    // Calculate Derived Metrics
    const payoutsOnTimeRate = payoutsTotal > 0 ? (payoutsOnTime / payoutsTotal) * 100 : 100;
    // Median Response Time
    let medianResponseTimeHours = 0;
    if (responseTimes.length > 0) {
        responseTimes.sort((a, b) => a - b);
        const mid = Math.floor(responseTimes.length / 2);
        const medianMs = responseTimes.length % 2 !== 0
            ? responseTimes[mid]
            : (responseTimes[mid - 1] + responseTimes[mid]) / 2;
        medianResponseTimeHours = medianMs / (1000 * 60 * 60);
    }
    // --- Badge Logic ---
    // Reliable Payee: >= 5 converted in last 90 days? (Simplified: Total converted >= 5 for now)
    // Plan says: Last 90 days >= 5 converted & >= 4 platform payouts & 95% on-time.
    // Filter for last 90 days for badge check
    const recentReferrals = referrals.filter(r => r.createdAt >= ninetyDaysAgo);
    const recentConverted = recentReferrals.filter(r => r.status === "converted" || r.status === "paid").length;
    // const recentPlatformPayouts = ... (need field)
    const badges = [];
    // "Procurement-Ready" (existing logic usually, but we can re-verify here or leave it)
    // We'll preserve existing badges and toggle specific ones.
    const profileSnap = await providerRef.get();
    const currentBadges = profileSnap.data()?.badges || [];
    // Reliable Payee Badge
    const isReliablePayee = referralsConverted >= 5 && payoutsOnTimeRate >= 95 && disputesOpened === 0;
    if (isReliablePayee) {
        if (!currentBadges.includes("reliable_payee"))
            badges.push("reliable_payee");
    }
    // Fast Responder Badge (e.g. median < 24h)
    const isFastResponder = responseTimes.length >= 3 && medianResponseTimeHours <= 24;
    if (isFastResponder) {
        if (!currentBadges.includes("fast_responder"))
            badges.push("fast_responder");
    }
    // Merge with existing badges (excluding the ones we manage dynamically)
    const otherBadges = currentBadges.filter(b => !["reliable_payee", "fast_responder"].includes(b));
    const finalBadges = [...new Set([...otherBadges, ...badges])];
    // Update Profile
    await providerRef.update({
        badges: finalBadges,
        trustStats: {
            referralsConverted,
            payoutsPlatformManaged,
            payoutsOnTimeRate,
            medianResponseTimeHours,
            disputesOpened,
            disputesLost
        },
        updatedAt: Date.now()
    });
    logger.info(`Updated trust stats for provider ${providerUid}`, { referralsConverted, isReliablePayee });
}
