import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { getDb } from "./exchange/security";

export const EXCHANGE_ACTION_KEYS = [
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
export type ExchangeActionKey = (typeof EXCHANGE_ACTION_KEYS)[number];

const actionKeySchema = z.enum(EXCHANGE_ACTION_KEYS);
const featureFlagsSchema = z.object({
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

const referralFinancialPolicySchema = z.object({
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
  policyVersion: z.string().min(1).max(128),
}).strict();

export const exchangeCommercialPolicySchema = z.object({
  schemaVersion: z.literal(1),
  policyVersion: z.string().min(1).max(128),
  updatedAt: z.number().int().nonnegative(),
  updatedBy: z.string().min(1).max(128),
  featureFlags: featureFlagsSchema,
  launchMarket: z.object({
    enabled: z.boolean(),
    publicLabel: z.string().min(1).max(160),
    stateCode: z.string().length(2),
    countyOrLocalityName: z.string().min(1).max(160),
    countryCode: z.string().length(2),
    seedMarket: z.boolean(),
    campaignPriority: z.boolean(),
    policyVersion: z.string().min(1).max(128),
  }).strict(),
  foundingMembership: z.object({
    enabled: z.boolean(),
    checkoutEnabled: z.boolean(),
    publicLabel: z.string().min(1).max(160),
    amountCents: z.number().int().positive().optional(),
    currency: z.literal("usd"),
    billingInterval: z.literal("month"),
    stripeProductId: z.string().min(1).max(255).optional(),
    stripePriceId: z.string().min(1).max(255).optional(),
    includedCreditsPerPeriod: z.number().int().nonnegative(),
    foundingCapacity: z.number().int().positive().optional(),
    foundingEnrollmentClosesAt: z.number().int().nonnegative().optional(),
    retainRecognitionAfterCancellation: z.boolean(),
    preservePriceOnlyWhileContinuouslyActive: z.boolean(),
    delinquencyGraceDays: z.number().int().nonnegative().max(365),
    pricingVersion: z.string().min(1).max(128),
    entitlementVersion: z.string().min(1).max(128),
  }).strict(),
  creditExpirationCalendarMonths: z.literal(12),
  creditPacks: z.array(z.object({
    key: z.string().min(1).max(128),
    enabled: z.boolean(),
    credits: z.number().int().positive(),
    amountCents: z.number().int().positive(),
    currency: z.literal("usd"),
    stripeProductId: z.string().min(1).max(255).optional(),
    stripePriceId: z.string().min(1).max(255).optional(),
    version: z.string().min(1).max(128),
  }).strict()).max(50),
  actionCosts: z.record(actionKeySchema, z.object({
    enabled: z.boolean(),
    credits: z.number().int().nonnegative(),
    verifiedBusinessRequired: z.boolean(),
  }).strict()),
  quotas: z.object({
    free: z.record(actionKeySchema, z.number().int().nonnegative()),
    founding: z.record(actionKeySchema, z.number().int().nonnegative()),
  }).strict(),
  referralFinancialPolicy: referralFinancialPolicySchema,
}).strict();

export type ExchangeCommercialPolicy = z.infer<typeof exchangeCommercialPolicySchema>;
export type ReferralFinancialPolicy = z.infer<typeof referralFinancialPolicySchema>;

const disabledActions = Object.fromEntries(EXCHANGE_ACTION_KEYS.map((key) => [key, {
  enabled: false,
  credits: 0,
  verifiedBusinessRequired: true,
}])) as ExchangeCommercialPolicy["actionCosts"];
const closedQuotas = Object.fromEntries(EXCHANGE_ACTION_KEYS.map((key) => [key, 0])) as ExchangeCommercialPolicy["quotas"]["free"];

export const DEFAULT_EXCHANGE_COMMERCIAL_POLICY: ExchangeCommercialPolicy = exchangeCommercialPolicySchema.parse({
  schemaVersion: 1,
  policyVersion: "exchange-launch-v1",
  updatedAt: 0,
  updatedBy: "system:default",
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
  actionCosts: disabledActions,
  quotas: { free: closedQuotas, founding: closedQuotas },
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

export async function loadExchangeCommercialPolicy(
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<ExchangeCommercialPolicy> {
  const snapshot = await db.collection("exchangeCommercialPolicies").doc("current").get();
  if (!snapshot.exists) return DEFAULT_EXCHANGE_COMMERCIAL_POLICY;
  const parsed = exchangeCommercialPolicySchema.safeParse(snapshot.data());
  if (!parsed.success) {
    throw new HttpsError("failed-precondition", "Exchange commercial policy is invalid");
  }
  return parsed.data;
}

export function publicCommercialPolicy(policy: ExchangeCommercialPolicy) {
  const founding = policy.foundingMembership;
  return {
    schemaVersion: policy.schemaVersion,
    policyVersion: policy.policyVersion,
    updatedAt: policy.updatedAt,
    featureFlags: policy.featureFlags,
    launchMarket: policy.launchMarket,
    foundingMembership: {
      enabled: founding.enabled,
      checkoutReady: founding.checkoutEnabled
        && policy.featureFlags.exchangeFoundingCheckoutEnabled
        && Boolean(founding.amountCents && founding.stripePriceId),
      publicLabel: founding.publicLabel,
      amountCents: founding.amountCents,
      currency: founding.currency,
      billingInterval: founding.billingInterval,
      includedCreditsPerPeriod: founding.includedCreditsPerPeriod,
      foundingCapacity: founding.foundingCapacity,
      foundingEnrollmentClosesAt: founding.foundingEnrollmentClosesAt,
      retainRecognitionAfterCancellation: founding.retainRecognitionAfterCancellation,
      pricingVersion: founding.pricingVersion,
      entitlementVersion: founding.entitlementVersion,
    },
    creditDefinition: {
      nominalDollarValuePerCredit: 1,
      expirationCalendarMonths: policy.creditExpirationCalendarMonths,
      transferable: false,
      cashRedeemable: false,
      generallyRefundable: false,
      verifiedBusinessRequired: true,
      spendingOrder: "earliest_expiration_first" as const,
    },
    creditPacks: policy.creditPacks.map((pack) => ({
      key: pack.key,
      enabled: pack.enabled,
      checkoutReady: pack.enabled
        && policy.featureFlags.exchangeCreditPurchasesEnabled
        && Boolean(pack.stripePriceId),
      credits: pack.credits,
      amountCents: pack.amountCents,
      currency: pack.currency,
      version: pack.version,
    })),
    actionCosts: policy.actionCosts,
    quotas: policy.quotas,
    referralFinancialPolicy: {
      enabled: policy.referralFinancialPolicy.enabled
        && policy.featureFlags.exchangeReferralPaymentsEnabled,
      platformFeeBps: policy.referralFinancialPolicy.platformFeeBps,
      minimumPlatformServiceFeeCents: policy.referralFinancialPolicy.minimumPlatformServiceFeeCents,
      minimumAccumulatedPayoutCents: policy.referralFinancialPolicy.minimumAccumulatedPayoutCents,
      payoutHoldDays: policy.referralFinancialPolicy.payoutHoldDays,
      automatedPayoutsEnabled: false,
      policyVersion: policy.referralFinancialPolicy.policyVersion,
    },
  };
}
