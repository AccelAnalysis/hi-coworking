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
exports.referral_createPayoutCheckout = exports.referral_decline = exports.referral_accept = exports.referral_markPaid = exports.referral_convert = exports.referral_create = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const config_1 = require("./config");
const ledger_1 = require("./payments/ledger");
const stripeProvider_1 = require("./payments/stripeProvider");
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
function getDb() {
    return admin.firestore();
}
/**
 * Create a new Referral.
 * Handles monetization: checks referral limits and deducts credits if necessary.
 */
exports.referral_create = (0, https_1.onCall)(async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to create a referral");
    }
    const uid = request.auth.uid;
    const data = request.data;
    // Basic validation
    if (!data.referredEmail && !data.clientEmail) {
        throw new https_1.HttpsError("invalid-argument", "Email is required");
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
        // Admins bypass limits
        if (role === "admin" || role === "master") {
            logger.info(`Admin ${uid} bypassing referral limits`);
        }
        else {
            // Get Plan Limits
            const tier = config_1.MEMBERSHIP_TIERS.find(t => t.id === planId);
            const limit = tier?.limits.referralsSentPerMonth ?? 0; // Default to 0
            // Count referrals sent THIS MONTH
            // We need a query for this.
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            const sentQuery = db.collection("referrals")
                .where("referrerUid", "==", uid)
                .where("createdAt", ">=", startOfMonth);
            const sentSnap = await t.get(sentQuery);
            const currentSent = sentSnap.size;
            if (currentSent < limit) {
                logger.info(`User ${uid} within referral limit (${currentSent}/${limit}). Creating for free.`);
            }
            else {
                // Over limit - charge credits
                const cost = config_1.CREDIT_COSTS.REFERRAL_SEND_EXTRA;
                const currentCredits = userData?.credits || 0;
                if (currentCredits < cost) {
                    throw new https_1.HttpsError("resource-exhausted", `You have reached your monthly limit of ${limit} referrals. Sending another requires ${cost} credits, but you only have ${currentCredits}.`);
                }
                // Deduct credits
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
                    referenceId: "pending_referral_creation",
                    description: `Send Referral: ${data.referredEmail || data.clientEmail}`,
                    createdAt: Date.now()
                });
                logger.info(`User ${uid} over referral limit. Deducted ${cost} credits.`);
            }
        }
        // 3. Create Referral
        const refRef = db.collection("referrals").doc();
        // Construct doc based on type
        const now = Date.now();
        const type = data.type || "platform_invite";
        const referralDoc = {
            id: refRef.id,
            type,
            referrerUid: uid,
            status: "pending",
            note: data.note || undefined,
            viewedByProvider: false,
            createdAt: now,
            updatedAt: now,
        };
        if (type === "platform_invite") {
            referralDoc.referredEmail = data.referredEmail;
            referralDoc.referredName = data.referredName;
        }
        else {
            // Business intro
            referralDoc.providerUid = data.providerUid;
            referralDoc.clientName = data.clientName;
            referralDoc.clientEmail = data.clientEmail;
            referralDoc.clientPhone = data.clientPhone;
            referralDoc.clientCompany = data.clientCompany;
            // Look up policy if providerUid is set?
            // For now, simple creation.
        }
        t.set(refRef, referralDoc);
        return { id: refRef.id };
    });
});
/**
 * Provider marks a referral as "Converted".
 */
exports.referral_convert = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { referralId, note } = request.data;
    if (!referralId) {
        throw new https_1.HttpsError("invalid-argument", "referralId is required");
    }
    const db = getDb();
    const refRef = db.collection("referrals").doc(referralId);
    const refSnap = await refRef.get();
    if (!refSnap.exists) {
        throw new https_1.HttpsError("not-found", "Referral not found");
    }
    const referral = refSnap.data();
    // Only the provider can convert business intros
    if (referral.type === "business_intro") {
        if (referral.providerUid !== request.auth.uid) {
            throw new https_1.HttpsError("permission-denied", "Only the assigned provider can convert this referral");
        }
    }
    await refRef.update({
        status: "converted",
        convertedAt: Date.now(),
        note: note || referral.note,
        updatedAt: Date.now()
    });
    return { success: true };
});
/**
 * Provider marks a referral as "Paid" (Manual Payout).
 * Requires uploading proof of payment. Deducts 1 credit for processing/verification.
 */
exports.referral_markPaid = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { referralId, proofUrl, method } = request.data;
    if (!referralId || !proofUrl) {
        throw new https_1.HttpsError("invalid-argument", "referralId and proofUrl are required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    return await db.runTransaction(async (t) => {
        // 1. Get Referral
        const refRef = db.collection("referrals").doc(referralId);
        const refSnap = await t.get(refRef);
        if (!refSnap.exists) {
            throw new https_1.HttpsError("not-found", "Referral not found");
        }
        const referral = refSnap.data();
        if (referral.providerUid !== uid) {
            throw new https_1.HttpsError("permission-denied", "Only the assigned provider can mark this as paid");
        }
        if (referral.status !== "converted") {
            throw new https_1.HttpsError("failed-precondition", "Referral must be converted before it can be paid");
        }
        // 2. Charge Credit (1 credit for manual proof upload)
        const userRef = db.collection("users").doc(uid);
        const userDoc = await t.get(userRef);
        const currentCredits = userDoc.data()?.credits || 0;
        const cost = 1; // Manual proof upload fee
        if (currentCredits < cost) {
            throw new https_1.HttpsError("resource-exhausted", `Insufficient credits. Manual payout verification requires ${cost} credit.`);
        }
        // Deduct credits
        t.update(userRef, {
            credits: currentCredits - cost,
            updatedAt: Date.now()
        });
        // Log credit transaction
        const transRef = db.collection("creditTransactions").doc();
        t.set(transRef, {
            id: transRef.id,
            userId: uid,
            amount: -cost,
            type: "usage",
            referenceId: referralId,
            description: "Manual Payout Verification Fee",
            createdAt: Date.now()
        });
        // 3. Update Referral
        t.update(refRef, {
            status: "paid",
            paidAt: Date.now(),
            payoutMethod: method || "manual",
            payoutProofUrl: proofUrl,
            updatedAt: Date.now()
        });
        return { success: true };
    });
});
/**
 * Provider accepts a referral.
 * Handles monetization: checks receive limits and deducts credits if necessary.
 */
exports.referral_accept = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { referralId } = request.data;
    if (!referralId) {
        throw new https_1.HttpsError("invalid-argument", "referralId is required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    return await db.runTransaction(async (t) => {
        // 1. Get Referral
        const refRef = db.collection("referrals").doc(referralId);
        const refSnap = await t.get(refRef);
        if (!refSnap.exists) {
            throw new https_1.HttpsError("not-found", "Referral not found");
        }
        const referral = refSnap.data();
        if (referral.providerUid !== uid) {
            throw new https_1.HttpsError("permission-denied", "Only the assigned provider can accept this referral");
        }
        if (referral.status !== "pending" && referral.status !== "contacted") {
            throw new https_1.HttpsError("failed-precondition", "Referral is not in a pending state");
        }
        // 2. Monetization Check
        const userRef = db.collection("users").doc(uid);
        const userDoc = await t.get(userRef);
        const userData = userDoc.data();
        const planId = userData?.plan;
        const role = userData?.role;
        if (role !== "admin" && role !== "master") {
            const tier = config_1.MEMBERSHIP_TIERS.find(t => t.id === planId);
            const limit = tier?.limits.referralsReceivedPerMonth ?? 0;
            // Count accepted this month
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            // Need query inside transaction? Firestore transactions require all reads before writes.
            // But query cannot be dynamic based on userDoc read inside transaction easily unless we queried first.
            // We can query outside transaction for approximate count? Or use a separate counter doc.
            // For simplicity/correctness, we'll query inside.
            const acceptedQuery = db.collection("referrals")
                .where("providerUid", "==", uid)
                .where("status", "in", ["accepted", "converted", "paid"])
                .where("acceptedAt", ">=", startOfMonth);
            const acceptedSnap = await t.get(acceptedQuery);
            const currentAccepted = acceptedSnap.size;
            if (currentAccepted >= limit) {
                // Charge credit
                const cost = config_1.CREDIT_COSTS.REFERRAL_ACCEPT_EXTRA;
                const currentCredits = userData?.credits || 0;
                if (currentCredits < cost) {
                    throw new https_1.HttpsError("resource-exhausted", `Monthly acceptance limit reached (${limit}). Accepting requires ${cost} credit.`);
                }
                // Deduct
                t.update(userRef, {
                    credits: currentCredits - cost,
                    updatedAt: Date.now()
                });
                // Log
                const transRef = db.collection("creditTransactions").doc();
                t.set(transRef, {
                    id: transRef.id,
                    userId: uid,
                    amount: -cost,
                    type: "usage",
                    referenceId: referralId,
                    description: "Accept Referral Fee",
                    createdAt: Date.now()
                });
                logger.info(`User ${uid} over acceptance limit. Deducted ${cost} credits.`);
            }
        }
        // 3. Update Referral
        t.update(refRef, {
            status: "accepted",
            acceptedAt: Date.now(),
            viewedByProvider: true,
            updatedAt: Date.now()
        });
        return { success: true };
    });
});
/**
 * Provider declines a referral.
 */
exports.referral_decline = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { referralId } = request.data;
    if (!referralId) {
        throw new https_1.HttpsError("invalid-argument", "referralId is required");
    }
    const db = getDb();
    const refRef = db.collection("referrals").doc(referralId);
    const refSnap = await refRef.get();
    if (!refSnap.exists) {
        throw new https_1.HttpsError("not-found", "Referral not found");
    }
    const referral = refSnap.data();
    if (referral.providerUid !== request.auth.uid) {
        throw new https_1.HttpsError("permission-denied", "Only the assigned provider can decline this referral");
    }
    await refRef.update({
        status: "declined",
        viewedByProvider: true,
        updatedAt: Date.now()
    });
    return { success: true };
});
/**
 * Create a Stripe Checkout Session for a Provider to pay a referral fee.
 */
exports.referral_createPayoutCheckout = (0, https_1.onCall)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { referralId, successUrl, cancelUrl } = request.data;
    if (!referralId || !successUrl || !cancelUrl) {
        throw new https_1.HttpsError("invalid-argument", "referralId, successUrl, and cancelUrl are required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    // 1. Validate Referral
    const refSnap = await db.collection("referrals").doc(referralId).get();
    if (!refSnap.exists) {
        throw new https_1.HttpsError("not-found", "Referral not found");
    }
    const referral = refSnap.data();
    if (referral.providerUid !== uid) {
        throw new https_1.HttpsError("permission-denied", "Only the assigned provider can pay this referral");
    }
    if (referral.status !== "converted") {
        throw new https_1.HttpsError("failed-precondition", "Referral must be converted before payout");
    }
    // Determine Amount from Policy Snapshot
    // Fallback to manual input if snapshot missing? For now require snapshot or error.
    const amountCents = referral.policySnapshot?.amountCents;
    const percentage = referral.policySnapshot?.percentage; // We can't auto-calculate percentage of invoice without invoice amount input.
    // For now, only support fixed amount from snapshot or require manual input for percentage?
    // Let's assume amountCents is populated (either fixed or calculated beforehand).
    // If not, we might need an input for "invoice amount" to calc fee.
    let finalAmount = amountCents;
    if (!finalAmount) {
        // If percentage model, we need invoice amount. 
        // For MVP, we'll assume fixed fee or throw if amount is missing.
        throw new https_1.HttpsError("failed-precondition", "Referral fee amount is not defined on this referral. Use manual payout or update terms.");
    }
    // Platform Fee (5%, min $3, cap $150)
    let feeCents = Math.round(finalAmount * 0.05);
    if (feeCents < 300)
        feeCents = 300;
    if (feeCents > 15000)
        feeCents = 15000;
    const totalCharge = finalAmount + feeCents; // Provider pays Referrer + Platform Fee? 
    // Wait, usually Platform Fee is deducted from Payout if we are facilitating transfer.
    // OR Provider pays Total, we keep Fee, and transfer rest to Referrer (Connect).
    // WITHOUT Connect (Standard Stripe): 
    // Provider pays Platform (Total). Platform pays Referrer manually or via separate Payout mechanism.
    // This is "Platform-Managed Payout" (we collect funds).
    // So we charge Provider `finalAmount`. We keep `feeCents`. We owe `finalAmount - feeCents` to referrer?
    // OR: Provider pays `finalAmount`. We take fee FROM that. Referrer gets less.
    // Plan says: "Platform service fee (take-rate): 5% of the referral payout"
    // Usually means: Referrer gets $100. Provider pays $105? OR Provider pays $100, Referrer gets $95?
    // "When a Provider pays a referral fee... Platform service fee... 5% of the referral payout"
    // Let's assume Provider pays $Fee + $ServiceCharge.
    // i.e. Total = ReferralFee * 1.05 (subject to min/cap).
    // Recalculate total to charge Provider
    // Fee logic: 5% of referral payout amount.
    // e.g. Referral = $100. Fee = $5. Total Charge = $105.
    // 2. Create Pending Payment Record
    const payment = await (0, ledger_1.createPayment)({
        uid,
        provider: "stripe",
        amount: finalAmount + feeCents,
        currency: "usd",
        purpose: "referral",
        purposeRefId: referralId,
        status: "pending",
    });
    // 3. Create Checkout Session
    const provider = new stripeProvider_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
        uid,
        amount: finalAmount + feeCents,
        currency: "usd",
        purpose: "referral",
        purposeRefId: referralId,
        successUrl,
        cancelUrl,
        mode: "payment", // One-time
        lineItemLabel: `Referral Fee: ${referral.referredName || referral.clientName || "Client"}`,
        metadata: {
            referralId,
            paymentId: payment.id,
            // email: ... (optional)
        },
    });
    return {
        sessionId: session.sessionId,
        url: session.url,
        paymentId: payment.id,
    };
});
