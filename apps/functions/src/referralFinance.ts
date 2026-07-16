import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { getAuthorizedActor, requireAdmin } from "./exchange/security";
import { loadExchangeCommercialPolicy, type ReferralFinancialPolicy } from "./exchangeCommercialPolicy";
import { resolveExchangeEntitlements } from "./exchangeCommercial";
import { getDb } from "./exchange/security";
import { createHash } from "node:crypto";

function roundBasisPoints(cents: number, bps: number): number {
  return Number((BigInt(cents) * BigInt(bps) + BigInt(5_000)) / BigInt(10_000));
}

export interface ReferralFinancialQuote {
  grossReferralFeeCents: number;
  platformPercentageFeeCents: number;
  platformMinimumFeeAdjustmentCents: number;
  platformServiceFeeCents: number;
  estimatedProcessingFeeRecaptureCents: number;
  reserveHeldCents: number;
  estimatedImmediatelyAvailableCents: number;
  estimatedEventuallyPayableCents: number;
  payoutThresholdCents: number;
  payoutHoldDays: number;
  reserveReleaseDays: number;
  policyVersion: string;
}

export function calculateReferralFinancialQuote(input: {
  grossReferralFeeCents: number;
  recipientStage: "new" | "established";
  policy: ReferralFinancialPolicy;
}): ReferralFinancialQuote {
  const { grossReferralFeeCents, recipientStage, policy } = input;
  if (!Number.isSafeInteger(grossReferralFeeCents) || grossReferralFeeCents <= 0) {
    throw new Error("Gross referral fee must be positive integer cents");
  }
  if (policy.minimumReferralFeeCents !== undefined && grossReferralFeeCents < policy.minimumReferralFeeCents) {
    throw new Error("Gross referral fee is below the configured minimum");
  }
  const platformPercentageFeeCents = roundBasisPoints(grossReferralFeeCents, policy.platformFeeBps);
  const platformServiceFeeCents = Math.max(platformPercentageFeeCents, policy.minimumPlatformServiceFeeCents);
  const estimatedProcessingFeeRecaptureCents =
    roundBasisPoints(grossReferralFeeCents, policy.estimatedPaymentPercentBps)
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

export function calculatePlatformOperatingReserveTarget(input: {
  trailing90DayGrossReferralFeesCents: number;
  trailing90DayLossesCents: number;
}): number {
  return Math.max(
    50_000,
    roundBasisPoints(input.trailing90DayGrossReferralFeesCents, 500),
    input.trailing90DayLossesCents * 2,
  );
}

const quoteInputSchema = z.object({
  grossReferralFeeCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recipientStage: z.enum(["new", "established"]),
}).strict();

export const referralFinance_quote = onCall(async (request) => {
  getAuthorizedActor(request);
  const input = quoteInputSchema.parse(request.data);
  const policy = (await loadExchangeCommercialPolicy()).referralFinancialPolicy;
  if (!policy.enabled) {
    throw new HttpsError("failed-precondition", "Paid referral finance is not enabled");
  }
  try {
    return { quote: calculateReferralFinancialQuote({ ...input, policy }), policySnapshot: policy };
  } catch (error) {
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Quote unavailable");
  }
});

export const referralFinance_getOperatingReserve = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  requireAdmin(actor);
  const input = z.object({
    trailing90DayGrossReferralFeesCents: z.number().int().nonnegative(),
    trailing90DayLossesCents: z.number().int().nonnegative(),
  }).strict().parse(request.data);
  return { targetCents: calculatePlatformOperatingReserveTarget(input), calculatedAt: Date.now() };
});

const safeId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const idempotencyKey = z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9_.:@-]+$/);
const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

/**
 * Opens a disabled-by-default referral payment lifecycle from immutable,
 * accepted fixed-fee terms. No money is moved and no payout is represented.
 */
export const referralFinance_initializeLifecycle = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = z.object({ referralId: safeId, expectedReferralVersion: z.number().int().nonnegative(), idempotencyKey }).strict().parse(request.data);
  const db = getDb();
  const [policy, referralSnapshot] = await Promise.all([
    loadExchangeCommercialPolicy(db),
    db.collection("businessReferrals").doc(input.referralId).get(),
  ]);
  if (!policy.featureFlags.exchangeReferralPaymentsEnabled || !policy.referralFinancialPolicy.enabled) {
    throw new HttpsError("failed-precondition", "Referral payments are disabled");
  }
  if (!referralSnapshot.exists) throw new HttpsError("not-found", "Referral not found");
  const referral = asRecord(referralSnapshot.data());
  if (referral.version !== input.expectedReferralVersion) throw new HttpsError("aborted", "Referral changed; reload and retry");
  const recipientOrgId = typeof referral.recipientOrgId === "string" ? referral.recipientOrgId : undefined;
  const referrerOrgId = typeof referral.referrerOrgId === "string" ? referral.referrerOrgId : undefined;
  if (!recipientOrgId || !referrerOrgId) throw new HttpsError("failed-precondition", "Paid referral finance requires two organizations");
  await resolveExchangeEntitlements({ organizationId: recipientOrgId, actor, requiredPermission: "manage_referrals", requireVerified: true });
  const terms = asRecord(referral.acceptedTermsSnapshot);
  if (terms.compensationType !== "fixed" || !Number.isSafeInteger(terms.fixedCompensationCents) || Number(terms.fixedCompensationCents) <= 0) {
    throw new HttpsError("failed-precondition", "Only accepted fixed-fee terms can enter the initial payment foundation");
  }
  const profileSnapshot = await db.collection("referralFinancialOrganizationProfiles").doc(recipientOrgId).get();
  const profile = asRecord(profileSnapshot.data());
  const qualificationAge = typeof profile.firstPaidReferralAt === "number"
    ? Date.now() - profile.firstPaidReferralAt
    : 0;
  const isEstablished = qualificationAge >= policy.referralFinancialPolicy.newRecipientQualificationDays * 86_400_000
    && Number(profile.successfulSettlementCount ?? 0) >= policy.referralFinancialPolicy.newRecipientSuccessfulSettlementCount;
  let quote: ReferralFinancialQuote;
  try {
    quote = calculateReferralFinancialQuote({
      grossReferralFeeCents: Number(terms.fixedCompensationCents),
      recipientStage: isEstablished ? "established" : "new",
      policy: policy.referralFinancialPolicy,
    });
  } catch (error) {
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Referral finance quote failed");
  }
  const lifecycleId = createHash("sha256").update(`referral-finance:${input.referralId}`).digest("hex");
  const lifecycleRef = db.collection("referralFinancialAccounts").doc(lifecycleId);
  const eventRef = db.collection("referralFinancialEvents").doc(createHash("sha256").update(`${lifecycleId}:${input.idempotencyKey}`).digest("hex"));
  return db.runTransaction(async (transaction) => {
    const [existing, event] = await Promise.all([transaction.get(lifecycleRef), transaction.get(eventRef)]);
    if (event.exists) return { lifecycleId, idempotent: true };
    if (existing.exists) throw new HttpsError("already-exists", "Referral finance lifecycle already exists");
    const now = Date.now();
    const payoutEligibilityDate = now + quote.payoutHoldDays * 86_400_000;
    const reserveReleaseDate = now + quote.reserveReleaseDays * 86_400_000;
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

export const referralFinance_getPayoutReadiness = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = z.object({ organizationId: safeId, limit: z.number().int().min(1).max(100).default(50) }).strict().parse(request.data);
  await resolveExchangeEntitlements({ organizationId: input.organizationId, actor, requiredPermission: "manage_referrals" });
  const snapshot = await getDb().collection("referralFinancialAccounts").where("referrerOrgId", "==", input.organizationId).limit(input.limit).get();
  const records = snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as Record<string, unknown> & { id: string }));
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

export const referralFinance_adminApproveManualPayout = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  requireAdmin(actor);
  const input = z.object({ lifecycleId: safeId, idempotencyKey, dispositionNote: z.string().trim().min(8).max(1_000) }).strict().parse(request.data);
  const db = getDb();
  const lifecycleRef = db.collection("referralFinancialAccounts").doc(input.lifecycleId);
  const eventRef = db.collection("referralFinancialEvents").doc(createHash("sha256").update(`${input.lifecycleId}:${input.idempotencyKey}`).digest("hex"));
  return db.runTransaction(async (transaction) => {
    const [lifecycleSnapshot, eventSnapshot] = await Promise.all([transaction.get(lifecycleRef), transaction.get(eventRef)]);
    if (eventSnapshot.exists) return { lifecycleId: input.lifecycleId, idempotent: true };
    if (!lifecycleSnapshot.exists) throw new HttpsError("not-found", "Referral financial lifecycle not found");
    const lifecycle = asRecord(lifecycleSnapshot.data());
    if (lifecycle.status !== "payout_eligible") throw new HttpsError("failed-precondition", "Only payout-eligible balances can enter manual approval");
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
