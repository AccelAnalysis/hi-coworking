"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referralFinance_adminApproveManualPayout = exports.referralFinance_getPayoutReadiness = exports.referralFinance_initializeLifecycle = exports.referralFinance_getOperatingReserve = exports.referralFinance_quote = void 0;
exports.calculateReferralFinancialQuote = calculateReferralFinancialQuote;
exports.calculatePlatformOperatingReserveTarget = calculatePlatformOperatingReserveTarget;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const security_1 = require("./exchange/security");
const exchangeCommercialPolicy_1 = require("./exchangeCommercialPolicy");
const exchangeCommercial_1 = require("./exchangeCommercial");
const security_2 = require("./exchange/security");
const node_crypto_1 = require("node:crypto");
function roundBasisPoints(cents, bps) {
    return Number((BigInt(cents) * BigInt(bps) + BigInt(5000)) / BigInt(10000));
}
function calculateReferralFinancialQuote(input) {
    const { grossReferralFeeCents, recipientStage, policy } = input;
    if (!Number.isSafeInteger(grossReferralFeeCents) || grossReferralFeeCents <= 0) {
        throw new Error("Gross referral fee must be positive integer cents");
    }
    if (policy.minimumReferralFeeCents !== undefined && grossReferralFeeCents < policy.minimumReferralFeeCents) {
        throw new Error("Gross referral fee is below the configured minimum");
    }
    const platformPercentageFeeCents = roundBasisPoints(grossReferralFeeCents, policy.platformFeeBps);
    const platformServiceFeeCents = Math.max(platformPercentageFeeCents, policy.minimumPlatformServiceFeeCents);
    const estimatedProcessingFeeRecaptureCents = roundBasisPoints(grossReferralFeeCents, policy.estimatedPaymentPercentBps)
        + policy.estimatedPaymentFixedFeeCents
        + roundBasisPoints(grossReferralFeeCents, policy.estimatedPayoutPercentBps)
        + policy.estimatedPayoutFixedFeeCents
        + policy.estimatedMonthlyActiveAccountAllocationCents;
    const eventuallyPayable = grossReferralFeeCents - platformServiceFeeCents - estimatedProcessingFeeRecaptureCents;
    if (policy.requirePositiveReferrerProceeds && eventuallyPayable <= 0) {
        throw new Error("Configured deductions leave no positive referrer proceeds");
    }
    const reserveBps = recipientStage === "new"
        ? policy.newRecipientReservePercentBps
        : policy.establishedRecipientReservePercentBps;
    const reserveHeldCents = Math.max(0, roundBasisPoints(eventuallyPayable, reserveBps));
    const immediatelyAvailable = eventuallyPayable - reserveHeldCents;
    if (policy.requirePositiveReferrerProceeds && immediatelyAvailable <= 0) {
        throw new Error("Configured reserve leaves no positive immediate proceeds");
    }
    return {
        grossReferralFeeCents,
        platformPercentageFeeCents,
        platformMinimumFeeAdjustmentCents: platformServiceFeeCents - platformPercentageFeeCents,
        platformServiceFeeCents,
        estimatedProcessingFeeRecaptureCents,
        reserveHeldCents,
        estimatedImmediatelyAvailableCents: immediatelyAvailable,
        estimatedEventuallyPayableCents: eventuallyPayable,
        payoutThresholdCents: policy.minimumAccumulatedPayoutCents,
        payoutHoldDays: policy.payoutHoldDays,
        reserveReleaseDays: recipientStage === "new"
            ? policy.newRecipientReserveReleaseDays
            : policy.establishedRecipientReserveReleaseDays,
        policyVersion: policy.policyVersion,
    };
}
function calculatePlatformOperatingReserveTarget(input) {
    return Math.max(50000, roundBasisPoints(input.trailing90DayGrossReferralFeesCents, 500), input.trailing90DayLossesCents * 2);
}
const quoteInputSchema = zod_1.z.object({
    grossReferralFeeCents: zod_1.z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recipientStage: zod_1.z.enum(["new", "established"]),
}).strict();
exports.referralFinance_quote = (0, https_1.onCall)(async (request) => {
    (0, security_1.getAuthorizedActor)(request);
    const input = quoteInputSchema.parse(request.data);
    const policy = (await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)()).referralFinancialPolicy;
    if (!policy.enabled) {
        throw new https_1.HttpsError("failed-precondition", "Paid referral finance is not enabled");
    }
    try {
        return { quote: calculateReferralFinancialQuote({ ...input, policy }), policySnapshot: policy };
    }
    catch (error) {
        throw new https_1.HttpsError("failed-precondition", error instanceof Error ? error.message : "Quote unavailable");
    }
});
exports.referralFinance_getOperatingReserve = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireAdmin)(actor);
    const input = zod_1.z.object({
        trailing90DayGrossReferralFeesCents: zod_1.z.number().int().nonnegative(),
        trailing90DayLossesCents: zod_1.z.number().int().nonnegative(),
    }).strict().parse(request.data);
    return { targetCents: calculatePlatformOperatingReserveTarget(input), calculatedAt: Date.now() };
});
const safeId = zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const idempotencyKey = zod_1.z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9_.:@-]+$/);
const asRecord = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
/**
 * Opens a disabled-by-default referral payment lifecycle from immutable,
 * accepted fixed-fee terms. No money is moved and no payout is represented.
 */
exports.referralFinance_initializeLifecycle = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = zod_1.z.object({ referralId: safeId, expectedReferralVersion: zod_1.z.number().int().nonnegative(), idempotencyKey }).strict().parse(request.data);
    const db = (0, security_2.getDb)();
    const [policy, referralSnapshot] = await Promise.all([
        (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)(db),
        db.collection("businessReferrals").doc(input.referralId).get(),
    ]);
    if (!policy.featureFlags.exchangeReferralPaymentsEnabled || !policy.referralFinancialPolicy.enabled) {
        throw new https_1.HttpsError("failed-precondition", "Referral payments are disabled");
    }
    if (!referralSnapshot.exists)
        throw new https_1.HttpsError("not-found", "Referral not found");
    const referral = asRecord(referralSnapshot.data());
    if (referral.version !== input.expectedReferralVersion)
        throw new https_1.HttpsError("aborted", "Referral changed; reload and retry");
    const recipientOrgId = typeof referral.recipientOrgId === "string" ? referral.recipientOrgId : undefined;
    const referrerOrgId = typeof referral.referrerOrgId === "string" ? referral.referrerOrgId : undefined;
    if (!recipientOrgId || !referrerOrgId)
        throw new https_1.HttpsError("failed-precondition", "Paid referral finance requires two organizations");
    await (0, exchangeCommercial_1.resolveExchangeEntitlements)({ organizationId: recipientOrgId, actor, requiredPermission: "manage_referrals", requireVerified: true });
    const terms = asRecord(referral.acceptedTermsSnapshot);
    if (terms.compensationType !== "fixed" || !Number.isSafeInteger(terms.fixedCompensationCents) || Number(terms.fixedCompensationCents) <= 0) {
        throw new https_1.HttpsError("failed-precondition", "Only accepted fixed-fee terms can enter the initial payment foundation");
    }
    const profileSnapshot = await db.collection("referralFinancialOrganizationProfiles").doc(recipientOrgId).get();
    const profile = asRecord(profileSnapshot.data());
    const qualificationAge = typeof profile.firstPaidReferralAt === "number"
        ? Date.now() - profile.firstPaidReferralAt
        : 0;
    const isEstablished = qualificationAge >= policy.referralFinancialPolicy.newRecipientQualificationDays * 86400000
        && Number(profile.successfulSettlementCount ?? 0) >= policy.referralFinancialPolicy.newRecipientSuccessfulSettlementCount;
    let quote;
    try {
        quote = calculateReferralFinancialQuote({
            grossReferralFeeCents: Number(terms.fixedCompensationCents),
            recipientStage: isEstablished ? "established" : "new",
            policy: policy.referralFinancialPolicy,
        });
    }
    catch (error) {
        throw new https_1.HttpsError("failed-precondition", error instanceof Error ? error.message : "Referral finance quote failed");
    }
    const lifecycleId = (0, node_crypto_1.createHash)("sha256").update(`referral-finance:${input.referralId}`).digest("hex");
    const lifecycleRef = db.collection("referralFinancialAccounts").doc(lifecycleId);
    const eventRef = db.collection("referralFinancialEvents").doc((0, node_crypto_1.createHash)("sha256").update(`${lifecycleId}:${input.idempotencyKey}`).digest("hex"));
    return db.runTransaction(async (transaction) => {
        const [existing, event] = await Promise.all([transaction.get(lifecycleRef), transaction.get(eventRef)]);
        if (event.exists)
            return { lifecycleId, idempotent: true };
        if (existing.exists)
            throw new https_1.HttpsError("already-exists", "Referral finance lifecycle already exists");
        const now = Date.now();
        const payoutEligibilityDate = now + quote.payoutHoldDays * 86400000;
        const reserveReleaseDate = now + quote.reserveReleaseDays * 86400000;
        transaction.create(lifecycleRef, {
            id: lifecycleId,
            referralId: input.referralId,
            recipientOrgId,
            referrerOrgId,
            status: "unpaid",
            grossReferralFeeCents: quote.grossReferralFeeCents,
            platformPercentageFeeCents: quote.platformPercentageFeeCents,
            platformMinimumFeeAdjustmentCents: quote.platformMinimumFeeAdjustmentCents,
            platformServiceFeeCents: quote.platformServiceFeeCents,
            estimatedProcessingFeeRecaptureCents: quote.estimatedProcessingFeeRecaptureCents,
            actualProcessingFeeCents: null,
            reserveHeldCents: quote.reserveHeldCents,
            reserveReleaseDate,
            payoutEligibilityDate,
            availableAmountCents: 0,
            accumulatedUnpaidBalanceCents: 0,
            amountTransferredCents: 0,
            connectedAccountReady: false,
            automatedPayoutsEnabled: false,
            manualPayoutReviewStatus: "not_ready",
            policySnapshot: policy.referralFinancialPolicy,
            quoteSnapshot: quote,
            acceptedTermsVersion: terms.version ?? referral.version,
            idempotencyKeys: [input.idempotencyKey],
            createdAt: now,
            updatedAt: now,
        });
        transaction.create(eventRef, {
            id: eventRef.id,
            lifecycleId,
            actorUid: actor.uid,
            action: "referral_finance.initialized",
            previousStatus: null,
            nextStatus: "unpaid",
            idempotencyKey: input.idempotencyKey,
            policyVersion: quote.policyVersion,
            createdAt: now,
        });
        return { lifecycleId, quote, idempotent: false };
    });
});
exports.referralFinance_getPayoutReadiness = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = zod_1.z.object({ organizationId: safeId, limit: zod_1.z.number().int().min(1).max(100).default(50) }).strict().parse(request.data);
    await (0, exchangeCommercial_1.resolveExchangeEntitlements)({ organizationId: input.organizationId, actor, requiredPermission: "manage_referrals" });
    const snapshot = await (0, security_2.getDb)().collection("referralFinancialAccounts").where("referrerOrgId", "==", input.organizationId).limit(input.limit).get();
    const records = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    return {
        organizationId: input.organizationId,
        automatedPayoutsEnabled: false,
        connectedAccountRequired: true,
        records,
        accumulatedEligibleCents: records
            .filter((record) => ["payout_eligible", "accumulating", "payout_pending"].includes(String(record.status)))
            .reduce((sum, record) => sum + Number(record.availableAmountCents ?? 0), 0),
        truncated: snapshot.size === input.limit,
    };
});
exports.referralFinance_adminApproveManualPayout = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireAdmin)(actor);
    const input = zod_1.z.object({ lifecycleId: safeId, idempotencyKey, dispositionNote: zod_1.z.string().trim().min(8).max(1000) }).strict().parse(request.data);
    const db = (0, security_2.getDb)();
    const lifecycleRef = db.collection("referralFinancialAccounts").doc(input.lifecycleId);
    const eventRef = db.collection("referralFinancialEvents").doc((0, node_crypto_1.createHash)("sha256").update(`${input.lifecycleId}:${input.idempotencyKey}`).digest("hex"));
    return db.runTransaction(async (transaction) => {
        const [lifecycleSnapshot, eventSnapshot] = await Promise.all([transaction.get(lifecycleRef), transaction.get(eventRef)]);
        if (eventSnapshot.exists)
            return { lifecycleId: input.lifecycleId, idempotent: true };
        if (!lifecycleSnapshot.exists)
            throw new https_1.HttpsError("not-found", "Referral financial lifecycle not found");
        const lifecycle = asRecord(lifecycleSnapshot.data());
        if (lifecycle.status !== "payout_eligible")
            throw new https_1.HttpsError("failed-precondition", "Only payout-eligible balances can enter manual approval");
        const now = Date.now();
        transaction.update(lifecycleRef, {
            status: "payout_pending",
            manualPayoutReviewStatus: "approved_intent",
            manualPayoutApprovedBy: actor.uid,
            manualPayoutApprovedAt: now,
            transferCompleted: false,
            updatedAt: now,
        });
        transaction.create(eventRef, {
            id: eventRef.id,
            lifecycleId: input.lifecycleId,
            actorUid: actor.uid,
            action: "referral_finance.manual_payout_intent_approved",
            previousStatus: "payout_eligible",
            nextStatus: "payout_pending",
            dispositionNote: input.dispositionNote,
            transferCompleted: false,
            idempotencyKey: input.idempotencyKey,
            policyVersion: asRecord(lifecycle.policySnapshot).policyVersion ?? "unknown",
            createdAt: now,
        });
        return { lifecycleId: input.lifecycleId, status: "payout_pending", transferCompleted: false, idempotent: false };
    });
});
