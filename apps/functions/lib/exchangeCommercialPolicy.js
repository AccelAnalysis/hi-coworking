"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_EXCHANGE_COMMERCIAL_POLICY = exports.exchangeCommercialPolicySchema = exports.EXCHANGE_ACTION_KEYS = void 0;
exports.loadExchangeCommercialPolicy = loadExchangeCommercialPolicy;
exports.publicCommercialPolicy = publicCommercialPolicy;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const security_1 = require("./exchange/security");
exports.EXCHANGE_ACTION_KEYS = [
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
];
const actionKeySchema = zod_1.z.enum(exports.EXCHANGE_ACTION_KEYS);
const featureFlagsSchema = zod_1.z.object({
    exchangeEnabled: zod_1.z.boolean(),
    exchangeFoundingCampaignEnabled: zod_1.z.boolean(),
    exchangeFoundingCheckoutEnabled: zod_1.z.boolean(),
    exchangeCreditPurchasesEnabled: zod_1.z.boolean(),
    exchangeReferralPaymentsEnabled: zod_1.z.boolean(),
    referralAutomatedPayoutsEnabled: zod_1.z.literal(false),
    bookstoreEnabled: zod_1.z.boolean(),
    eventsEnabled: zod_1.z.boolean(),
    physicalWorkspaceEnabled: zod_1.z.boolean(),
}).strict();
const referralFinancialPolicySchema = zod_1.z.object({
    enabled: zod_1.z.boolean(),
    platformFeeBps: zod_1.z.number().int().min(0).max(10000),
    minimumPlatformServiceFeeCents: zod_1.z.number().int().nonnegative(),
    estimatedPaymentPercentBps: zod_1.z.number().int().min(0).max(10000),
    estimatedPaymentFixedFeeCents: zod_1.z.number().int().nonnegative(),
    estimatedPayoutPercentBps: zod_1.z.number().int().min(0).max(10000),
    estimatedPayoutFixedFeeCents: zod_1.z.number().int().nonnegative(),
    estimatedMonthlyActiveAccountAllocationCents: zod_1.z.number().int().nonnegative(),
    minimumReferralFeeCents: zod_1.z.number().int().positive().optional(),
    requirePositiveReferrerProceeds: zod_1.z.boolean(),
    minimumAccumulatedPayoutCents: zod_1.z.number().int().positive(),
    payoutHoldDays: zod_1.z.number().int().nonnegative(),
    newRecipientReservePercentBps: zod_1.z.number().int().min(0).max(10000),
    newRecipientReserveReleaseDays: zod_1.z.number().int().nonnegative(),
    newRecipientQualificationDays: zod_1.z.number().int().nonnegative(),
    newRecipientSuccessfulSettlementCount: zod_1.z.number().int().nonnegative(),
    establishedRecipientReservePercentBps: zod_1.z.number().int().min(0).max(10000),
    establishedRecipientReserveReleaseDays: zod_1.z.number().int().nonnegative(),
    policyVersion: zod_1.z.string().min(1).max(128),
}).strict();
exports.exchangeCommercialPolicySchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal(1),
    policyVersion: zod_1.z.string().min(1).max(128),
    updatedAt: zod_1.z.number().int().nonnegative(),
    updatedBy: zod_1.z.string().min(1).max(128),
    featureFlags: featureFlagsSchema,
    launchMarket: zod_1.z.object({
        enabled: zod_1.z.boolean(),
        publicLabel: zod_1.z.string().min(1).max(160),
        stateCode: zod_1.z.string().length(2),
        countyOrLocalityName: zod_1.z.string().min(1).max(160),
        countryCode: zod_1.z.string().length(2),
        seedMarket: zod_1.z.boolean(),
        campaignPriority: zod_1.z.boolean(),
        policyVersion: zod_1.z.string().min(1).max(128),
    }).strict(),
    foundingMembership: zod_1.z.object({
        enabled: zod_1.z.boolean(),
        checkoutEnabled: zod_1.z.boolean(),
        publicLabel: zod_1.z.string().min(1).max(160),
        amountCents: zod_1.z.number().int().positive().optional(),
        currency: zod_1.z.literal("usd"),
        billingInterval: zod_1.z.literal("month"),
        stripeProductId: zod_1.z.string().min(1).max(255).optional(),
        stripePriceId: zod_1.z.string().min(1).max(255).optional(),
        includedCreditsPerPeriod: zod_1.z.number().int().nonnegative(),
        foundingCapacity: zod_1.z.number().int().positive().optional(),
        foundingEnrollmentClosesAt: zod_1.z.number().int().nonnegative().optional(),
        retainRecognitionAfterCancellation: zod_1.z.boolean(),
        preservePriceOnlyWhileContinuouslyActive: zod_1.z.boolean(),
        delinquencyGraceDays: zod_1.z.number().int().nonnegative().max(365),
        pricingVersion: zod_1.z.string().min(1).max(128),
        entitlementVersion: zod_1.z.string().min(1).max(128),
    }).strict(),
    creditExpirationCalendarMonths: zod_1.z.literal(12),
    creditPacks: zod_1.z.array(zod_1.z.object({
        key: zod_1.z.string().min(1).max(128),
        enabled: zod_1.z.boolean(),
        credits: zod_1.z.number().int().positive(),
        amountCents: zod_1.z.number().int().positive(),
        currency: zod_1.z.literal("usd"),
        stripeProductId: zod_1.z.string().min(1).max(255).optional(),
        stripePriceId: zod_1.z.string().min(1).max(255).optional(),
        version: zod_1.z.string().min(1).max(128),
    }).strict()).max(50),
    actionCosts: zod_1.z.record(actionKeySchema, zod_1.z.object({
        enabled: zod_1.z.boolean(),
        credits: zod_1.z.number().int().nonnegative(),
        verifiedBusinessRequired: zod_1.z.boolean(),
    }).strict()),
    quotas: zod_1.z.object({
        free: zod_1.z.record(actionKeySchema, zod_1.z.number().int().nonnegative()),
        founding: zod_1.z.record(actionKeySchema, zod_1.z.number().int().nonnegative()),
    }).strict(),
    referralFinancialPolicy: referralFinancialPolicySchema,
}).strict();
const disabledActions = Object.fromEntries(exports.EXCHANGE_ACTION_KEYS.map((key) => [key, {
        enabled: false,
        credits: 0,
        verifiedBusinessRequired: true,
    }]));
const closedQuotas = Object.fromEntries(exports.EXCHANGE_ACTION_KEYS.map((key) => [key, 0]));
exports.DEFAULT_EXCHANGE_COMMERCIAL_POLICY = exports.exchangeCommercialPolicySchema.parse({
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
        { key: "exchange_credits_25", enabled: false, credits: 25, amountCents: 2500, currency: "usd", version: "credit-packs-v1" },
        { key: "exchange_credits_60", enabled: false, credits: 60, amountCents: 6000, currency: "usd", version: "credit-packs-v1" },
        { key: "exchange_credits_120", enabled: false, credits: 120, amountCents: 12000, currency: "usd", version: "credit-packs-v1" },
    ],
    actionCosts: disabledActions,
    quotas: { free: closedQuotas, founding: closedQuotas },
    referralFinancialPolicy: {
        enabled: false,
        platformFeeBps: 1000,
        minimumPlatformServiceFeeCents: 500,
        estimatedPaymentPercentBps: 0,
        estimatedPaymentFixedFeeCents: 0,
        estimatedPayoutPercentBps: 0,
        estimatedPayoutFixedFeeCents: 0,
        estimatedMonthlyActiveAccountAllocationCents: 0,
        requirePositiveReferrerProceeds: true,
        minimumAccumulatedPayoutCents: 10000,
        payoutHoldDays: 14,
        newRecipientReservePercentBps: 1000,
        newRecipientReserveReleaseDays: 45,
        newRecipientQualificationDays: 90,
        newRecipientSuccessfulSettlementCount: 3,
        establishedRecipientReservePercentBps: 500,
        establishedRecipientReserveReleaseDays: 30,
        policyVersion: "referral-finance-v1",
    },
});
async function loadExchangeCommercialPolicy(db = (0, security_1.getDb)()) {
    const snapshot = await db.collection("exchangeCommercialPolicies").doc("current").get();
    if (!snapshot.exists)
        return exports.DEFAULT_EXCHANGE_COMMERCIAL_POLICY;
    const parsed = exports.exchangeCommercialPolicySchema.safeParse(snapshot.data());
    if (!parsed.success) {
        throw new https_1.HttpsError("failed-precondition", "Exchange commercial policy is invalid");
    }
    return parsed.data;
}
function publicCommercialPolicy(policy) {
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
            spendingOrder: "earliest_expiration_first",
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
