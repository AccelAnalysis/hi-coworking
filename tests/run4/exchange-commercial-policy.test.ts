import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCHANGE_COMMERCIAL_POLICY,
  addCalendarMonths,
  allocateCreditsEarliestExpiration,
  calculatePlatformOperatingReserveTarget,
  calculateReferralFinancialQuote,
  evaluateAccumulatedPayout,
  exchangeCommercialPolicySchema,
} from "../../packages/shared/src";

describe("Run 4 Exchange commercial policy", () => {
  it("defaults protected commerce and deferred products closed while keeping Exchange and campaign visible", () => {
    const policy = exchangeCommercialPolicySchema.parse(DEFAULT_EXCHANGE_COMMERCIAL_POLICY);
    expect(policy.featureFlags).toEqual({
      exchangeEnabled: true,
      exchangeFoundingCampaignEnabled: true,
      exchangeFoundingCheckoutEnabled: false,
      exchangeCreditPurchasesEnabled: false,
      exchangeReferralPaymentsEnabled: false,
      referralAutomatedPayoutsEnabled: false,
      bookstoreEnabled: false,
      eventsEnabled: false,
      physicalWorkspaceEnabled: false,
    });
    expect(policy.foundingMembership.amountCents).toBeUndefined();
    expect(policy.foundingMembership.stripePriceId).toBeUndefined();
    expect(policy.launchMarket.publicLabel).toBe("Isle of Wight County, Virginia");
    expect(policy.creditPacks.map((pack) => [pack.credits, pack.amountCents])).toEqual([[25, 2500], [60, 6000], [120, 12000]]);
  });

  it("expires grants after twelve calendar months, including end-of-month behavior", () => {
    expect(new Date(addCalendarMonths(Date.UTC(2026, 6, 15, 14, 30), 12)).toISOString()).toBe("2027-07-15T14:30:00.000Z");
    expect(new Date(addCalendarMonths(Date.UTC(2024, 1, 29), 12)).toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(new Date(addCalendarMonths(Date.UTC(2026, 0, 31), 1)).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("spends active grants earliest-expiration-first and rejects expired value", () => {
    const now = 1_000;
    const grants = [
      { id: "later", remainingCredits: 10, status: "active" as const, grantedAt: 10, expiresAt: 5_000 },
      { id: "soon", remainingCredits: 4, status: "active" as const, grantedAt: 20, expiresAt: 2_000 },
      { id: "expired", remainingCredits: 100, status: "active" as const, grantedAt: 1, expiresAt: 999 },
      { id: "legacy", remainingCredits: 20, status: "active" as const, grantedAt: 1 },
    ];
    expect(allocateCreditsEarliestExpiration({ grants, credits: 8, now })).toEqual([
      { grantId: "soon", credits: 4 },
      { grantId: "later", credits: 4 },
    ]);
    expect(() => allocateCreditsEarliestExpiration({ grants: grants.slice(2, 3), credits: 1, now })).toThrow(/insufficient/i);
  });
});
describe("Run 4 referral financial policy", () => {
  const policy = { ...DEFAULT_EXCHANGE_COMMERCIAL_POLICY.referralFinancialPolicy, enabled: true };

  it.each([
    [2_000, 200, 300, 500],
    [5_000, 500, 0, 500],
    [10_000, 1_000, 0, 1_000],
  ])("applies 10 percent with the $5 minimum to %i cents", (gross, percentage, adjustment, serviceFee) => {
    const quote = calculateReferralFinancialQuote({ grossReferralFeeCents: gross, recipientStage: "new", policy });
    expect(quote.platformPercentageFeeCents).toBe(percentage);
    expect(quote.platformMinimumFeeAdjustmentCents).toBe(adjustment);
    expect(quote.platformServiceFeeCents).toBe(serviceFee);
  });

  it("allows fees below $50 when proceeds remain positive and rejects non-positive proceeds", () => {
    expect(calculateReferralFinancialQuote({ grossReferralFeeCents: 600, recipientStage: "established", policy }).estimatedEventuallyPayableCents).toBe(100);
    expect(() => calculateReferralFinancialQuote({ grossReferralFeeCents: 500, recipientStage: "established", policy })).toThrow(/no positive/i);
  });

  it("recaptures configured payment costs separately and applies different reserve stages", () => {
    const withFees = { ...policy, estimatedPaymentPercentBps: 300, estimatedPaymentFixedFeeCents: 30 };
    const fresh = calculateReferralFinancialQuote({ grossReferralFeeCents: 10_000, recipientStage: "new", policy: withFees });
    const established = calculateReferralFinancialQuote({ grossReferralFeeCents: 10_000, recipientStage: "established", policy: withFees });
    expect(fresh.estimatedProcessingFeeRecaptureCents).toBe(330);
    expect(fresh.reserveHeldCents).toBeGreaterThan(established.reserveHeldCents);
    expect(fresh.reserveReleaseDays).toBe(45);
    expect(established.reserveReleaseDays).toBe(30);
  });

  it("accumulates four $25 balances to the $100 threshold without rejecting smaller earnings", () => {
    expect(evaluateAccumulatedPayout({ existingEligibleBalanceCents: 0, newlyEligibleCents: 2_500, thresholdCents: 10_000 })).toEqual({ accumulatedCents: 2_500, status: "accumulating" });
    expect(evaluateAccumulatedPayout({ existingEligibleBalanceCents: 7_500, newlyEligibleCents: 2_500, thresholdCents: 10_000 })).toEqual({ accumulatedCents: 10_000, status: "payout_eligible" });
    expect(evaluateAccumulatedPayout({ existingEligibleBalanceCents: 10_000, newlyEligibleCents: 0, thresholdCents: 10_000, blocked: true }).status).toBe("manual_review");
  });

  it("uses the greatest platform reserve target", () => {
    expect(calculatePlatformOperatingReserveTarget({ trailing90DayGrossReferralFeesCents: 100_000, trailing90DayLossesCents: 10_000 })).toBe(50_000);
    expect(calculatePlatformOperatingReserveTarget({ trailing90DayGrossReferralFeesCents: 2_000_000, trailing90DayLossesCents: 10_000 })).toBe(100_000);
    expect(calculatePlatformOperatingReserveTarget({ trailing90DayGrossReferralFeesCents: 100_000, trailing90DayLossesCents: 40_000 })).toBe(80_000);
  });
});
