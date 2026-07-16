import { describe, expect, it } from "vitest";
import {
  analyzeReferralReciprocity,
  buildReferralGapAnalysis,
  calculateReferralMedian,
  calculateReferralNetworkMetrics,
  calculateReferralRate,
  countConfirmedReferralConversions,
  deriveReferralRelationshipInsight,
  isConfirmedReferralConversionStatus,
  shouldSuppressReferralAggregate,
  summarizeReferralEconomicImpact,
  type ReferralAnalyticsRecord,
} from "../../packages/shared/src/referralIntelligence";

const DAY = 86_400_000;
const HOUR = 3_600_000;

function referral(
  id: string,
  overrides: Partial<ReferralAnalyticsRecord> = {},
): ReferralAnalyticsRecord {
  return {
    id,
    domain: "business_referral",
    referrerSubjectKey: "org:sender",
    recipientSubjectKey: "org:receiver",
    status: "sent",
    createdAt: 1,
    ...overrides,
  };
}

describe("Run 3 referral intelligence utilities", () => {
  it("calculates rates and exact medians without inventing zero-denominator values", () => {
    expect(calculateReferralRate(3, 4)).toBe(0.75);
    expect(calculateReferralRate(0, 0)).toBeNull();
    expect(calculateReferralMedian([9, 1, 5])).toBe(5);
    expect(calculateReferralMedian([10, 2, 8, 4])).toBe(6);
    expect(calculateReferralMedian([Number.NaN, -1])).toBeNull();
  });

  it("derives explainable relationship states from verified minimum samples", () => {
    expect(deriveReferralRelationshipInsight({
      acceptedReferrals: 2,
      confirmedConversions: 0,
      medianResponseTimeHours: 12,
      disputesOpened: 0,
      disputesLost: 0,
      reversals: 0,
      verified: true,
    }).state).toBe("active");

    const trusted = deriveReferralRelationshipInsight({
      acceptedReferrals: 5,
      confirmedConversions: 3,
      medianResponseTimeHours: 9,
      disputesOpened: 1,
      disputesLost: 0,
      reversals: 0,
      verified: true,
    });
    expect(trusted.state).toBe("trusted");
    expect(trusted.sampleSize).toBe(5);
    expect(trusted.reasons).toContain("verified_minimum_sample");

    expect(deriveReferralRelationshipInsight({
      acceptedReferrals: 6,
      confirmedConversions: 4,
      medianResponseTimeHours: 9,
      disputesOpened: 2,
      disputesLost: 2,
      reversals: 0,
      verified: true,
    }).state).toBe("review_required");
  });

  it("keeps normal reciprocity legitimate and requires corroboration for review", () => {
    expect(analyzeReferralReciprocity({
      forwardCount: 2,
      reverseCount: 2,
      firstPartyTotal: 10,
      secondPartyTotal: 9,
    }).classification).toBe("normal_reciprocity");

    expect(analyzeReferralReciprocity({
      forwardCount: 5,
      reverseCount: 5,
      firstPartyTotal: 6,
      secondPartyTotal: 6,
    }).classification).toBe("concentrated_pair");

    const review = analyzeReferralReciprocity({
      forwardCount: 6,
      reverseCount: 6,
      firstPartyTotal: 7,
      secondPartyTotal: 7,
      disputedOrReversedCount: 1,
      rapidCrossReferralCount: 2,
    });
    expect(review.classification).toBe("review_recommended");
    expect(review.factors).toContain("verified_disputes_or_reversals");
  });

  it("calculates network metrics and excludes platform invitations", () => {
    const records = [
      referral("sent-one", {
        status: "converted",
        sentAt: 10,
        respondedAt: 10 + 4 * HOUR,
        acceptedAt: 10 + 4 * HOUR,
        closedAt: 10 + 2 * DAY,
      }),
      referral("received-one", {
        referrerSubjectKey: "org:partner",
        recipientSubjectKey: "org:sender",
        status: "accepted",
        sentAt: 20,
        respondedAt: 20 + 8 * HOUR,
      }),
      referral("invite", {
        domain: "platform_invite",
        type: "platform_invite",
        status: "converted",
      }),
    ];

    const metrics = calculateReferralNetworkMetrics(records, "org:sender");
    expect(metrics.referralsSent).toBe(1);
    expect(metrics.referralsReceived).toBe(1);
    expect(metrics.acceptedReferrals).toBe(1);
    expect(metrics.uniquePartners).toBe(2);
    expect(metrics.medianResponseTimeHours).toBe(6);
  });

  it("separates reported and confirmed currency totals and applies refunds", () => {
    const impact = summarizeReferralEconomicImpact([
      referral("ref-one", { status: "converted", category: "legal", territoryFips: "11001" }),
      referral("invite", { domain: "platform_invite", type: "platform_invite", status: "converted" }),
    ], [
      {
        id: "report-one",
        referralId: "ref-one",
        status: "confirmed",
        currency: "USD",
        collectedTransactionCents: 100_000,
        calculation: {
          grossReferralPayoutCents: 10_000,
          platformFeeCents: 100,
          netReferrerPayoutCents: 9_900,
        },
      },
      {
        id: "report-two",
        referralId: "ref-one",
        status: "refunded",
        currency: "USD",
        collectedTransactionCents: 50_000,
        refundCents: 20_000,
        calculation: {
          grossReferralPayoutCents: 5_000,
          platformFeeCents: 50,
          netReferrerPayoutCents: 4_950,
        },
      },
      {
        id: "report-three",
        referralId: "ref-one",
        status: "reported",
        currency: "EUR",
        collectedTransactionCents: 20_000,
      },
      {
        id: "report-four",
        referralId: "ref-one",
        status: "reversed",
        currency: "USD",
        collectedTransactionCents: 90_000,
      },
    ]);

    expect(impact.confirmedConversions).toBe(1);
    expect(impact.currencies.USD).toEqual({
      reportedTransactionCents: 150_000,
      confirmedTransactionCents: 130_000,
      refundedTransactionCents: 20_000,
      grossReferralPayoutCents: 13_000,
      calculatedPlatformFeeCents: 130,
      netReferrerBenefitCents: 12_870,
    });
    expect(impact.currencies.EUR.confirmedTransactionCents).toBe(0);
    expect(impact.currencies.EUR.reportedTransactionCents).toBe(20_000);
  });

  it("deduplicates record IDs and requires a corroborated transaction for confirmed conversions", () => {
    const converted = referral("converted-one", {
      status: "converted",
      category: "facilities",
      territoryFips: "51095",
    });
    const confirmed = {
      id: "confirmed-report",
      referralId: converted.id,
      status: "settlement_unavailable",
      currency: "USD",
      collectedTransactionCents: 100_000,
      calculation: {
        grossReferralPayoutCents: 10_000,
        platformFeeCents: 100,
        netReferrerPayoutCents: 9_900,
      },
    };
    const adverseAndUnconfirmed = [
      {
        id: "disputed-report",
        referralId: converted.id,
        status: "disputed",
        currency: "USD",
        collectedTransactionCents: 90_000,
      },
      {
        id: "clarification-report",
        referralId: converted.id,
        status: "clarification_requested",
        currency: "USD",
        collectedTransactionCents: 80_000,
      },
      {
        id: "awaiting-report",
        referralId: converted.id,
        status: "awaiting_confirmation",
        currency: "USD",
        collectedTransactionCents: 70_000,
      },
      {
        id: "reversed-report",
        referralId: converted.id,
        status: "reversed",
        currency: "USD",
        collectedTransactionCents: 60_000,
      },
    ];
    const impact = summarizeReferralEconomicImpact(
      [converted, { ...converted }],
      [confirmed, { ...confirmed }, ...adverseAndUnconfirmed],
    );
    expect(impact.referralsInitiated).toBe(1);
    expect(impact.confirmedConversions).toBe(1);
    expect(impact.currencies.USD).toMatchObject({
      reportedTransactionCents: 340_000,
      confirmedTransactionCents: 100_000,
      grossReferralPayoutCents: 10_000,
      calculatedPlatformFeeCents: 100,
      netReferrerBenefitCents: 9_900,
    });

    const adverseOnly = summarizeReferralEconomicImpact([converted], adverseAndUnconfirmed);
    expect(adverseOnly.confirmedConversions).toBe(0);
    expect(adverseOnly.currencies.USD.confirmedTransactionCents).toBe(0);
    expect(countConfirmedReferralConversions([converted], adverseAndUnconfirmed)).toBe(0);
    expect(isConfirmedReferralConversionStatus("disputed")).toBe(false);

    const superseded = countConfirmedReferralConversions([converted], [
      confirmed,
      { ...confirmed, status: "disputed" },
    ]);
    expect(superseded).toBe(0);

    const metrics = calculateReferralNetworkMetrics(
      [converted, { ...converted }],
      "org:receiver",
      [confirmed, { ...confirmed }],
    );
    expect(metrics.referralsReceived).toBe(1);
    expect(metrics.confirmedConversions).toBe(1);
  });

  it("suppresses platform gap cells until both privacy thresholds are met", () => {
    expect(shouldSuppressReferralAggregate(5, 4)).toBe(true);
    expect(shouldSuppressReferralAggregate(5, 5)).toBe(false);

    const demand = Array.from({ length: 5 }, (_, index) => ({
      id: `demand-${index}`,
      organizationIds: [`org-${index}`],
      category: "accounting",
      territoryFips: "11001",
      status: "sent",
    }));
    const supply = [{
      id: "offer-one",
      providerOrgId: "provider-one",
      category: "accounting",
      territoryFips: ["11001"],
      active: true,
    }];

    const publishable = buildReferralGapAnalysis(demand, supply, { ownScope: false });
    expect(publishable.find((cell) => cell.dimension === "industry")).toMatchObject({
      demandCount: 5,
      activeRecipientCount: 1,
      privacyStatus: "publishable",
    });

    const suppressed = buildReferralGapAnalysis(demand.slice(0, 4), supply, { ownScope: false });
    expect(suppressed.find((cell) => cell.dimension === "industry")).toMatchObject({
      demandCount: null,
      activeRecipientCount: null,
      privacyStatus: "suppressed",
    });

    const own = buildReferralGapAnalysis(demand.slice(0, 1), supply, { ownScope: true });
    expect(own.find((cell) => cell.dimension === "industry")).toMatchObject({
      demandCount: 1,
      privacyStatus: "own_exact",
    });
  });
});
