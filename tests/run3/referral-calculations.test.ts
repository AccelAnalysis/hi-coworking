import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFERRAL_COMMERCE_CONFIG,
  REFERRAL_CALCULATION_VERSION,
  businessReferralDocSchema,
  calculateBasisPointsHalfUp,
  calculateReferralFinancials,
  referralCommerceConfigurationSchema,
  referralServiceOfferDocSchema,
  referralTermsSnapshotSchema,
  referralTransactionReportDocSchema,
} from "../../packages/shared/src";

describe("Run 3 referral financial calculations", () => {
  it("applies the default 100-basis-point fee to gross payout, not customer value", () => {
    const result = calculateReferralFinancials({
      qualifyingTransactionCents: 1_000_000,
      collectedTransactionCents: 1_000_000,
      compensationType: "percentage",
      compensationRateBasisPoints: 1_000,
      platformFeeBasisPoints: DEFAULT_REFERRAL_COMMERCE_CONFIG.platformFeeBasisPoints,
      currency: "USD",
    });

    expect(result).toEqual({
      qualifyingTransactionCents: 1_000_000,
      collectedTransactionCents: 1_000_000,
      compensationBasisCents: 1_000_000,
      grossReferralPayoutCents: 100_000,
      platformFeeBasisPointsSnapshot: 100,
      platformFeeCents: 1_000,
      netReferrerPayoutCents: 99_000,
      currency: "USD",
      calculationVersion: REFERRAL_CALCULATION_VERSION,
      calculationStatus: "calculated",
    });
    expect(result.platformFeeCents).not.toBe(10_000);
  });

  it("supports no-compensation and fixed-compensation referrals", () => {
    expect(calculateReferralFinancials({
      qualifyingTransactionCents: 25_000,
      collectedTransactionCents: 25_000,
      compensationType: "none",
      platformFeeBasisPoints: 100,
      currency: "USD",
    })).toMatchObject({
      grossReferralPayoutCents: 0,
      platformFeeCents: 0,
      netReferrerPayoutCents: 0,
      calculationStatus: "no_compensation",
    });

    expect(calculateReferralFinancials({
      qualifyingTransactionCents: 25_000,
      collectedTransactionCents: 20_000,
      compensationType: "fixed",
      fixedCompensationCents: 5_000,
      platformFeeBasisPoints: 100,
      currency: "USD",
    })).toMatchObject({
      compensationBasisCents: 20_000,
      grossReferralPayoutCents: 5_000,
      platformFeeCents: 50,
      netReferrerPayoutCents: 4_950,
      calculationStatus: "calculated",
    });

    expect(calculateReferralFinancials({
      qualifyingTransactionCents: 25_000,
      collectedTransactionCents: 0,
      compensationType: "fixed",
      fixedCompensationCents: 5_000,
      platformFeeBasisPoints: 100,
      currency: "USD",
    }).grossReferralPayoutCents).toBe(0);
  });

  it("rounds BigInt basis-point intermediates half-up at one-cent boundaries", () => {
    expect(calculateBasisPointsHalfUp(49, 100)).toBe(0);
    expect(calculateBasisPointsHalfUp(50, 100)).toBe(1);
    expect(calculateBasisPointsHalfUp(149, 100)).toBe(1);
    expect(calculateBasisPointsHalfUp(150, 100)).toBe(2);
    expect(calculateBasisPointsHalfUp(Number.MAX_SAFE_INTEGER, 10_000))
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it("uses the lesser qualifying and collected amount for percentage compensation", () => {
    const result = calculateReferralFinancials({
      qualifyingTransactionCents: 100_000,
      collectedTransactionCents: 40_000,
      compensationType: "percentage",
      compensationRateBasisPoints: 1_250,
      platformFeeBasisPoints: 100,
      currency: "usd",
    });
    expect(result).toMatchObject({
      compensationBasisCents: 40_000,
      grossReferralPayoutCents: 5_000,
      platformFeeCents: 50,
      currency: "USD",
    });
  });

  it("keeps custom and benefit policies explicitly non-calculable as cash", () => {
    expect(calculateReferralFinancials({
      qualifyingTransactionCents: 100_000,
      collectedTransactionCents: 100_000,
      compensationType: "custom",
      platformFeeBasisPoints: 100,
      currency: "USD",
    })).toMatchObject({
      grossReferralPayoutCents: 0,
      platformFeeCents: 0,
      netReferrerPayoutCents: 0,
      calculationStatus: "manual_terms_required",
    });
    expect(calculateReferralFinancials({
      qualifyingTransactionCents: 100_000,
      collectedTransactionCents: 100_000,
      compensationType: "benefit",
      platformFeeBasisPoints: 100,
      currency: "USD",
    })).toMatchObject({
      grossReferralPayoutCents: 0,
      platformFeeCents: 0,
      netReferrerPayoutCents: 0,
      calculationStatus: "non_cash_benefit",
    });
  });

  it("rejects negative, unsafe, out-of-range, and currency-mismatched inputs", () => {
    expect(() => calculateBasisPointsHalfUp(-1, 100)).toThrow(/nonnegative safe integer/i);
    expect(() => calculateBasisPointsHalfUp(1, 10_001)).toThrow(/10,000/i);
    expect(() => calculateReferralFinancials({
      qualifyingTransactionCents: Number.MAX_SAFE_INTEGER + 1,
      collectedTransactionCents: 1,
      compensationType: "none",
      platformFeeBasisPoints: 100,
      currency: "USD",
    })).toThrow(/invalid referral calculation input/i);
    expect(() => calculateReferralFinancials({
      qualifyingTransactionCents: 100,
      collectedTransactionCents: 100,
      compensationType: "none",
      platformFeeBasisPoints: 100,
      currency: "USD",
      termsCurrency: "EUR",
    })).toThrow(/currency/i);
  });
});

describe("Run 3 referral commerce contracts", () => {
  const publishedOffer = {
    id: "offer-one",
    offerId: "offer-one",
    schemaVersion: 1 as const,
    providerOrgId: "provider-org",
    serviceName: "Facilities support",
    serviceCategory: "facilities",
    naicsCodes: ["561210"],
    territoryFips: ["51095"],
    status: "published" as const,
    acceptingReferrals: true,
    compensationType: "percentage" as const,
    compensationRateBasisPoints: 1_000,
    percentageBasis: "first_collected_invoice" as const,
    currency: "USD",
    attributionWindowDays: 90,
    version: 2,
    stateVersion: 1,
    effectiveAt: 10,
    publishedAt: 10,
    publishedBy: "org-manager",
    sourceVersionId: "offer-one_v1",
    createdBy: "org-manager",
    createdAt: 5,
    updatedAt: 10,
  };

  it("validates versioned published offers and rejects mixed formulas", () => {
    expect(referralServiceOfferDocSchema.safeParse(publishedOffer).success).toBe(true);
    expect(referralServiceOfferDocSchema.safeParse({
      ...publishedOffer,
      fixedCompensationCents: 5_000,
    }).success).toBe(false);
    expect(referralServiceOfferDocSchema.safeParse({
      ...publishedOffer,
      compensationType: "benefit",
      compensationRateBasisPoints: undefined,
      percentageBasis: undefined,
      benefitDescription: "One month of workspace access",
    }).success).toBe(true);
  });

  it("locks exact offer and platform-fee versions in accepted terms", () => {
    expect(referralTermsSnapshotSchema.safeParse({
      schemaVersion: 1,
      serviceOfferId: "offer-one",
      serviceOfferVersionId: "offer-one_v2",
      serviceOfferVersion: 2,
      compensationType: "none",
      currency: "USD",
      attributionWindowDays: 90,
      platformFeeBasisPoints: 100,
      platformFeeConfigVersion: 1,
      acceptedByUid: "recipient",
      acceptedByOrgId: "provider-org",
      acceptedAt: 20,
      calculationVersion: REFERRAL_CALCULATION_VERSION,
    }).success).toBe(true);
    expect(referralTermsSnapshotSchema.safeParse({
      schemaVersion: 1,
      serviceOfferId: "offer-one",
      compensationType: "none",
      currency: "USD",
      attributionWindowDays: 90,
      platformFeeBasisPoints: 100,
      platformFeeConfigVersion: 1,
      acceptedByUid: "recipient",
      acceptedAt: 20,
      calculationVersion: 1,
    }).success).toBe(false);
  });

  it("keeps commerce enabled while settlement is structurally disabled", () => {
    expect(referralCommerceConfigurationSchema.parse(DEFAULT_REFERRAL_COMMERCE_CONFIG))
      .toMatchObject({
        platformFeeBasisPoints: 100,
        version: 1,
        commerceEnabled: true,
        settlementEnabled: false,
      });
    expect(referralCommerceConfigurationSchema.safeParse({
      ...DEFAULT_REFERRAL_COMMERCE_CONFIG,
      settlementEnabled: true,
    }).success).toBe(false);
  });

  it("extends business referrals for versioned offers and commerce without breaking v1 defaults", () => {
    const versionTwo = {
      id: "referral-v2",
      schemaVersion: 2 as const,
      referrerUid: "referrer",
      recipientOrgId: "provider-org",
      referralType: "service_need" as const,
      title: "Facilities introduction",
      needSummary: "Introduce a qualified facilities provider.",
      consentStatus: "not_required" as const,
      status: "accepted" as const,
      compensationPolicy: {
        type: "benefit" as const,
        currency: "USD",
        benefitDescription: "One month of workspace access",
        status: "agreed" as const,
        lockedAt: 20,
      },
      serviceOfferId: "offer-one_v2",
      serviceOfferVersion: 2,
      acceptedTermsSnapshot: {
        schemaVersion: 1 as const,
        serviceOfferId: "offer-one",
        serviceOfferVersionId: "offer-one_v2",
        serviceOfferVersion: 2,
        compensationType: "benefit" as const,
        currency: "USD",
        benefitDescription: "One month of workspace access",
        attributionWindowDays: 90,
        platformFeeBasisPoints: 100,
        platformFeeConfigVersion: 1,
        acceptedByUid: "recipient",
        acceptedByOrgId: "provider-org",
        acceptedAt: 20,
        calculationVersion: REFERRAL_CALCULATION_VERSION,
      },
      commerceStatus: "none" as const,
      convertedAt: 30,
      version: 3,
      createdAt: 10,
      updatedAt: 30,
    };
    expect(businessReferralDocSchema.safeParse(versionTwo).success).toBe(true);
    expect(businessReferralDocSchema.safeParse({
      ...versionTwo,
      commerceStatus: "paid_from_screenshot",
    }).success).toBe(false);
    expect(businessReferralDocSchema.parse({
      ...versionTwo,
      schemaVersion: undefined,
      acceptedTermsSnapshot: undefined,
    }).schemaVersion).toBe(1);
  });

  it("validates minimized transaction reports and confirmed financials", () => {
    const financials = calculateReferralFinancials({
      qualifyingTransactionCents: 10_000,
      collectedTransactionCents: 10_000,
      compensationType: "percentage",
      compensationRateBasisPoints: 1_000,
      platformFeeBasisPoints: 100,
      currency: "USD",
    });
    const report = {
      id: "report-one",
      schemaVersion: 1,
      referralId: "referral-one",
      reportedByUid: "recipient",
      qualifyingTransactionCents: 10_000,
      collectedTransactionCents: 10_000,
      collectionDate: 10,
      currency: "USD",
      evidenceStoragePaths: [],
      refundStatus: "none",
      status: "payout_calculated",
      referrerDecision: "confirmed",
      reviewNote: "Private confirmation context",
      confirmedByUid: "referrer",
      confirmedAt: 20,
      financials,
      version: 2,
      createdAt: 10,
      updatedAt: 20,
    } as const;
    expect(referralTransactionReportDocSchema.safeParse(report).success).toBe(true);
    expect(referralTransactionReportDocSchema.safeParse({
      ...report,
      reviewNote: "x".repeat(2_001),
    }).success).toBe(false);
  });
});
