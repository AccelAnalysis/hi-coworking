import { z } from "zod";

export const organizationPermissionSchema = z.enum([
  "view_exchange",
  "edit_profile",
  "respond_to_opportunities",
  "manage_referrals",
  "spend_credits",
  "purchase_credits",
  "manage_billing",
  "manage_members",
]);
export type OrganizationPermission = z.infer<typeof organizationPermissionSchema>;

export const organizationVerificationStatusSchema = z.enum([
  "unverified",
  "claim_pending",
  "claimed",
  "verification_pending",
  "verified",
  "suspended",
  "disputed",
]);
export type OrganizationVerificationStatus = z.infer<typeof organizationVerificationStatusSchema>;

export const exchangeTierIdSchema = z.enum(["free", "founding"]);
export type ExchangeTierId = z.infer<typeof exchangeTierIdSchema>;

export const exchangeMembershipStatusSchema = z.enum([
  "active",
  "past_due",
  "cancelled",
  "incomplete",
  "paused",
]);
export type ExchangeMembershipStatus = z.infer<typeof exchangeMembershipStatusSchema>;

export const exchangeMembershipSchema = z.object({
  organizationId: z.string().min(1),
  tier: exchangeTierIdSchema,
  status: exchangeMembershipStatusSchema,
  isFoundingMember: z.boolean(),
  foundingRecognitionRetained: z.boolean(),
  startedAt: z.number().int().nonnegative(),
  currentPeriodStart: z.number().int().nonnegative().optional(),
  currentPeriodEnd: z.number().int().nonnegative().optional(),
  cancelledAt: z.number().int().nonnegative().optional(),
  stripeCustomerId: z.string().min(1).optional(),
  stripeSubscriptionId: z.string().min(1).optional(),
  stripePriceId: z.string().min(1).optional(),
  pricingVersion: z.string().min(1),
  entitlementVersion: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export type ExchangeMembership = z.infer<typeof exchangeMembershipSchema>;

export const exchangeFeatureFlagsSchema = z.object({
  exchangeEnabled: z.boolean(),
  exchangeFoundingCampaignEnabled: z.boolean(),
  exchangeFoundingCheckoutEnabled: z.boolean(),
  exchangeCreditPurchasesEnabled: z.boolean(),
  exchangeReferralPaymentsEnabled: z.boolean(),
  referralAutomatedPayoutsEnabled: z.literal(false),
  bookstoreEnabled: z.boolean(),
  eventsEnabled: z.boolean(),
  physicalWorkspaceEnabled: z.boolean(),
}).strict();
export type ExchangeFeatureFlags = z.infer<typeof exchangeFeatureFlagsSchema>;

export const exchangeLaunchMarketSchema = z.object({
  enabled: z.boolean(),
  publicLabel: z.string().min(1),
  stateCode: z.string().length(2),
  countyOrLocalityName: z.string().min(1),
  countryCode: z.string().length(2),
  seedMarket: z.boolean(),
  campaignPriority: z.boolean(),
  policyVersion: z.string().min(1),
}).strict();
export type ExchangeLaunchMarketConfig = z.infer<typeof exchangeLaunchMarketSchema>;

export const foundingMembershipConfigSchema = z.object({
  enabled: z.boolean(),
  checkoutEnabled: z.boolean(),
  publicLabel: z.string().min(1),
  amountCents: z.number().int().positive().optional(),
  currency: z.literal("usd"),
  billingInterval: z.literal("month"),
  stripeProductId: z.string().min(1).optional(),
  stripePriceId: z.string().min(1).optional(),
  includedCreditsPerPeriod: z.number().int().nonnegative(),
  foundingCapacity: z.number().int().positive().optional(),
  foundingEnrollmentClosesAt: z.number().int().nonnegative().optional(),
  retainRecognitionAfterCancellation: z.boolean(),
  preservePriceOnlyWhileContinuouslyActive: z.boolean(),
  delinquencyGraceDays: z.number().int().nonnegative(),
  pricingVersion: z.string().min(1),
  entitlementVersion: z.string().min(1),
}).strict();
export type FoundingMembershipConfig = z.infer<typeof foundingMembershipConfigSchema>;

export const exchangeCreditPackSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
  credits: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  currency: z.literal("usd"),
  stripeProductId: z.string().min(1).optional(),
  stripePriceId: z.string().min(1).optional(),
  version: z.string().min(1),
}).strict();
export type ExchangeCreditPack = z.infer<typeof exchangeCreditPackSchema>;

export const exchangeActionKeys = [
  "opportunity_response",
  "teaming_interest",
  "private_opportunity_unlock",
  "facilitated_introduction",
  "qualified_referral_acceptance",
  "warm_referral_introduction",
  "response_boost",
  "opportunity_promotion",
  "profile_promotion",
  "enhanced_verification_review",
  "premium_intelligence_request",
] as const;
export const exchangeActionKeySchema = z.enum(exchangeActionKeys);
export type ExchangeActionKey = z.infer<typeof exchangeActionKeySchema>;

export const referralFinancialPolicySchema = z.object({
  enabled: z.boolean(),
  platformFeeBps: z.number().int().min(0).max(10_000),
  minimumPlatformServiceFeeCents: z.number().int().nonnegative(),
  estimatedPaymentPercentBps: z.number().int().min(0).max(10_000),
  estimatedPaymentFixedFeeCents: z.number().int().nonnegative(),
  estimatedPayoutPercentBps: z.number().int().min(0).max(10_000),
  estimatedPayoutFixedFeeCents: z.number().int().nonnegative(),
  estimatedMonthlyActiveAccountAllocationCents: z.number().int().nonnegative(),
  minimumReferralFeeCents: z.number().int().positive().optional(),
  requirePositiveReferrerProceeds: z.boolean(),
  minimumAccumulatedPayoutCents: z.number().int().positive(),
  payoutHoldDays: z.number().int().nonnegative(),
  newRecipientReservePercentBps: z.number().int().min(0).max(10_000),
  newRecipientReserveReleaseDays: z.number().int().nonnegative(),
  newRecipientQualificationDays: z.number().int().nonnegative(),
  newRecipientSuccessfulSettlementCount: z.number().int().nonnegative(),
  establishedRecipientReservePercentBps: z.number().int().min(0).max(10_000),
  establishedRecipientReserveReleaseDays: z.number().int().nonnegative(),
  policyVersion: z.string().min(1),
}).strict();
export type ReferralFinancialPolicy = z.infer<typeof referralFinancialPolicySchema>;

export const exchangeCommercialPolicySchema = z.object({
  schemaVersion: z.literal(1),
  policyVersion: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
  featureFlags: exchangeFeatureFlagsSchema,
  launchMarket: exchangeLaunchMarketSchema,
  foundingMembership: foundingMembershipConfigSchema,
  creditExpirationCalendarMonths: z.literal(12),
  creditPacks: z.array(exchangeCreditPackSchema),
  actionCosts: z.record(exchangeActionKeySchema, z.object({
    enabled: z.boolean(),
    credits: z.number().int().nonnegative(),
    verifiedBusinessRequired: z.boolean(),
  }).strict()),
  quotas: z.object({
    free: z.record(exchangeActionKeySchema, z.number().int().nonnegative()),
    founding: z.record(exchangeActionKeySchema, z.number().int().nonnegative()),
  }).strict(),
  referralFinancialPolicy: referralFinancialPolicySchema,
}).strict();
export type ExchangeCommercialPolicy = z.infer<typeof exchangeCommercialPolicySchema>;

const DISABLED_ACTION_COSTS = Object.fromEntries(exchangeActionKeys.map((key) => [key, {
  enabled: false,
  credits: 0,
  verifiedBusinessRequired: true,
}])) as ExchangeCommercialPolicy["actionCosts"];
const CLOSED_ACTION_QUOTAS = Object.fromEntries(exchangeActionKeys.map((key) => [key, 0])) as ExchangeCommercialPolicy["quotas"]["free"];

export const DEFAULT_EXCHANGE_COMMERCIAL_POLICY: ExchangeCommercialPolicy = exchangeCommercialPolicySchema.parse({
  schemaVersion: 1,
  policyVersion: "exchange-launch-v1",
  updatedAt: 0,
  featureFlags: {
    exchangeEnabled: true,
    exchangeFoundingCampaignEnabled: true,
    exchangeFoundingCheckoutEnabled: false,
    exchangeCreditPurchasesEnabled: false,
    exchangeReferralPaymentsEnabled: false,
    referralAutomatedPayoutsEnabled: false,
    bookstoreEnabled: false,
    eventsEnabled: false,
    physicalWorkspaceEnabled: false,
  },
  launchMarket: {
    enabled: true,
    publicLabel: "Isle of Wight County, Virginia",
    stateCode: "VA",
    countyOrLocalityName: "Isle of Wight County",
    countryCode: "US",
    seedMarket: true,
    campaignPriority: true,
    policyVersion: "launch-market-v1",
  },
  foundingMembership: {
    enabled: true,
    checkoutEnabled: false,
    publicLabel: "Exchange Founding Membership",
    currency: "usd",
    billingInterval: "month",
    includedCreditsPerPeriod: 0,
    retainRecognitionAfterCancellation: true,
    preservePriceOnlyWhileContinuouslyActive: true,
    delinquencyGraceDays: 0,
    pricingVersion: "founding-price-unapproved",
    entitlementVersion: "founding-entitlements-v1",
  },
  creditExpirationCalendarMonths: 12,
  creditPacks: [
    { key: "exchange_credits_25", enabled: false, credits: 25, amountCents: 2_500, currency: "usd", version: "credit-packs-v1" },
    { key: "exchange_credits_60", enabled: false, credits: 60, amountCents: 6_000, currency: "usd", version: "credit-packs-v1" },
    { key: "exchange_credits_120", enabled: false, credits: 120, amountCents: 12_000, currency: "usd", version: "credit-packs-v1" },
  ],
  actionCosts: DISABLED_ACTION_COSTS,
  quotas: { free: CLOSED_ACTION_QUOTAS, founding: CLOSED_ACTION_QUOTAS },
  referralFinancialPolicy: {
    enabled: false,
    platformFeeBps: 1_000,
    minimumPlatformServiceFeeCents: 500,
    estimatedPaymentPercentBps: 0,
    estimatedPaymentFixedFeeCents: 0,
    estimatedPayoutPercentBps: 0,
    estimatedPayoutFixedFeeCents: 0,
    estimatedMonthlyActiveAccountAllocationCents: 0,
    requirePositiveReferrerProceeds: true,
    minimumAccumulatedPayoutCents: 10_000,
    payoutHoldDays: 14,
    newRecipientReservePercentBps: 1_000,
    newRecipientReserveReleaseDays: 45,
    newRecipientQualificationDays: 90,
    newRecipientSuccessfulSettlementCount: 3,
    establishedRecipientReservePercentBps: 500,
    establishedRecipientReserveReleaseDays: 30,
    policyVersion: "referral-finance-v1",
  },
});

export type CreditGrantSource = "purchase" | "subscription_allocation" | "promotion" | "admin_adjustment" | "legacy_import";
export type CreditGrantStatus = "active" | "consumed" | "expired" | "revoked";
export interface CreditGrant {
  id: string;
  organizationId: string;
  source: CreditGrantSource;
  originalCredits: number;
  remainingCredits: number;
  grantedAt: number;
  expiresAt?: number;
  status: CreditGrantStatus;
  sourceReferenceId: string;
  idempotencyKey: string;
  policyVersion: string;
  purchasedOrAllocatedByUid?: string;
  createdAt: number;
  updatedAt: number;
}

export function allocateCreditsEarliestExpiration(input: {
  grants: Array<Pick<CreditGrant, "id" | "remainingCredits" | "status" | "grantedAt" | "expiresAt">>;
  credits: number;
  now: number;
}): Array<{ grantId: string; credits: number }> {
  if (!Number.isSafeInteger(input.credits) || input.credits <= 0) throw new Error("Credit spend must be a positive whole number");
  const eligible = input.grants
    .filter((grant) => grant.status === "active" && Number.isSafeInteger(grant.remainingCredits)
      && grant.remainingCredits > 0 && (grant.expiresAt === undefined || grant.expiresAt > input.now))
    .sort((left, right) => (left.expiresAt ?? Number.MAX_SAFE_INTEGER) - (right.expiresAt ?? Number.MAX_SAFE_INTEGER)
      || left.grantedAt - right.grantedAt || left.id.localeCompare(right.id));
  if (eligible.reduce((sum, grant) => sum + grant.remainingCredits, 0) < input.credits) {
    throw new Error("Insufficient usable Exchange credits");
  }
  let remaining = input.credits;
  const result: Array<{ grantId: string; credits: number }> = [];
  for (const grant of eligible) {
    if (remaining === 0) break;
    const credits = Math.min(remaining, grant.remainingCredits);
    result.push({ grantId: grant.id, credits });
    remaining -= credits;
  }
  return result;
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Adds whole calendar months while keeping end-of-month grants at end-of-month. */
export function addCalendarMonths(timestamp: number, months: number): number {
  if (!Number.isInteger(timestamp) || timestamp < 0 || !Number.isInteger(months) || months < 0) {
    throw new Error("Calendar expiration inputs must be non-negative integers");
  }
  const source = new Date(timestamp);
  const targetMonthIndex = source.getUTCMonth() + months;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const sourceLastDay = source.getUTCDate() === daysInUtcMonth(source.getUTCFullYear(), source.getUTCMonth());
  const targetDay = sourceLastDay
    ? daysInUtcMonth(targetYear, targetMonth)
    : Math.min(source.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  );
}

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

export const referralFinancialLifecycleStatusSchema = z.enum([
  "unpaid",
  "awaiting_payment",
  "payment_processing",
  "funded",
  "holding",
  "reserve_active",
  "payout_eligible",
  "accumulating",
  "payout_pending",
  "paid_out",
  "partially_released",
  "refunded",
  "disputed",
  "cancelled",
  "manual_review",
]);
export type ReferralFinancialLifecycleStatus = z.infer<typeof referralFinancialLifecycleStatusSchema>;

export const REFERRAL_RESERVE_RECOVERY_ORDER = [
  "untransferred_transaction_proceeds",
  "transaction_specific_reserve",
  "organization_rolling_reserve",
  "future_referral_earnings",
  "authorized_connected_account_recovery",
  "platform_operating_reserve",
  "direct_collection",
] as const;

export function evaluateAccumulatedPayout(input: {
  existingEligibleBalanceCents: number;
  newlyEligibleCents: number;
  thresholdCents: number;
  blocked?: boolean;
}): { accumulatedCents: number; status: "accumulating" | "payout_eligible" | "manual_review" } {
  const values = [input.existingEligibleBalanceCents, input.newlyEligibleCents, input.thresholdCents];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || input.thresholdCents === 0) {
    throw new Error("Payout accumulation values must be non-negative integer cents and threshold must be positive");
  }
  const accumulatedCents = input.existingEligibleBalanceCents + input.newlyEligibleCents;
  return {
    accumulatedCents,
    status: input.blocked ? "manual_review" : accumulatedCents >= input.thresholdCents ? "payout_eligible" : "accumulating",
  };
}

export function calculateReferralFinancialQuote(input: {
  grossReferralFeeCents: number;
  recipientStage: "new" | "established";
  policy: ReferralFinancialPolicy;
}): ReferralFinancialQuote {
  const { grossReferralFeeCents, recipientStage, policy } = input;
  if (!Number.isSafeInteger(grossReferralFeeCents) || grossReferralFeeCents <= 0) {
    throw new Error("Gross referral fee must be a positive integer number of cents");
  }
  if (policy.minimumReferralFeeCents !== undefined && grossReferralFeeCents < policy.minimumReferralFeeCents) {
    throw new Error("Gross referral fee is below the configured minimum");
  }
  const platformPercentageFeeCents = roundBasisPoints(grossReferralFeeCents, policy.platformFeeBps);
  const platformServiceFeeCents = Math.max(platformPercentageFeeCents, policy.minimumPlatformServiceFeeCents);
  const platformMinimumFeeAdjustmentCents = platformServiceFeeCents - platformPercentageFeeCents;
  const estimatedProcessingFeeRecaptureCents =
    roundBasisPoints(grossReferralFeeCents, policy.estimatedPaymentPercentBps)
    + policy.estimatedPaymentFixedFeeCents
    + roundBasisPoints(grossReferralFeeCents, policy.estimatedPayoutPercentBps)
    + policy.estimatedPayoutFixedFeeCents
    + policy.estimatedMonthlyActiveAccountAllocationCents;
  const beforeReserve = grossReferralFeeCents - platformServiceFeeCents - estimatedProcessingFeeRecaptureCents;
  if (policy.requirePositiveReferrerProceeds && beforeReserve <= 0) {
    throw new Error("Configured deductions leave no positive referrer proceeds");
  }
  const reserveBps = recipientStage === "new"
    ? policy.newRecipientReservePercentBps
    : policy.establishedRecipientReservePercentBps;
  const reserveHeldCents = Math.max(0, roundBasisPoints(beforeReserve, reserveBps));
  const estimatedImmediatelyAvailableCents = beforeReserve - reserveHeldCents;
  if (policy.requirePositiveReferrerProceeds && estimatedImmediatelyAvailableCents <= 0) {
    throw new Error("Configured deductions and reserve leave no positive immediate proceeds");
  }
  return {
    grossReferralFeeCents,
    platformPercentageFeeCents,
    platformMinimumFeeAdjustmentCents,
    platformServiceFeeCents,
    estimatedProcessingFeeRecaptureCents,
    reserveHeldCents,
    estimatedImmediatelyAvailableCents,
    estimatedEventuallyPayableCents: beforeReserve,
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
  const grossTarget = roundBasisPoints(input.trailing90DayGrossReferralFeesCents, 500);
  const lossTarget = input.trailing90DayLossesCents * 2;
  return Math.max(50_000, grossTarget, lossTarget);
}
