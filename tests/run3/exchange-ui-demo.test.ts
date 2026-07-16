import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReferralIntelligenceCsv } from "../../apps/web/src/features/exchange/intelligence/AnalyticsCsvExport";
import {
  EXCHANGE_DEMO_INTELLIGENCE,
  EXCHANGE_DEMO_REFERRALS,
  EXCHANGE_DEMO_RFX,
  EXCHANGE_DEMO_SERVICE_OFFERS,
  EXCHANGE_DEMO_SUGGESTIONS,
  EXCHANGE_DEMO_TERRITORIES,
} from "../../apps/web/src/features/exchange/demo/exchangeDemoFixtures";
import {
  calculateDemoReferralAmounts,
  createExchangeDemoGateway,
} from "../../apps/web/src/features/exchange/demo/exchangeDemoGateway";
import { resolveExchangeDemoMode } from "../../apps/web/src/features/exchange/demo/exchangeDemoMode";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("Run 3 Exchange demo and presenters", () => {
  it("makes visual demo mode impossible in production", () => {
    expect(resolveExchangeDemoMode("production", "true")).toBe(false);
    expect(resolveExchangeDemoMode("development", "true")).toBe(true);
    expect(resolveExchangeDemoMode("test", "false")).toBe(false);
    expect(resolveExchangeDemoMode("development", "TRUE")).toBe(false);
  });

  it("ships deterministic fixtures for all review surfaces", () => {
    expect(EXCHANGE_DEMO_RFX).toHaveLength(3);
    expect(EXCHANGE_DEMO_TERRITORIES.map((territory) => territory.status)).toEqual(
      expect.arrayContaining(["released", "scheduled"]),
    );
    expect(EXCHANGE_DEMO_REFERRALS.some((referral) => referral.direction === "sent")).toBe(true);
    expect(EXCHANGE_DEMO_REFERRALS.some((referral) => referral.direction === "received")).toBe(true);
    expect(EXCHANGE_DEMO_REFERRALS.some((referral) => referral.status === "converted" && !referral.compensation.configured)).toBe(true);
    expect(EXCHANGE_DEMO_REFERRALS.some((referral) => referral.commerceStatus === "settlement_unavailable")).toBe(true);
    expect(EXCHANGE_DEMO_REFERRALS.some((referral) => referral.linkedEntities.some((entity) => entity.type === "rfx"))).toBe(true);
    expect(EXCHANGE_DEMO_REFERRALS.some((referral) => referral.linkedEntities.some((entity) => entity.type === "team"))).toBe(true);
    expect(EXCHANGE_DEMO_SERVICE_OFFERS.map((offer) => offer.compensationType)).toEqual(
      expect.arrayContaining(["none", "percentage", "benefit"]),
    );
    expect(EXCHANGE_DEMO_SUGGESTIONS.every((suggestion) => suggestion.reasons.length > 0)).toBe(true);
    expect(EXCHANGE_DEMO_INTELLIGENCE.relationships.some((relationship) => relationship.state === "trusted")).toBe(true);
    expect(EXCHANGE_DEMO_INTELLIGENCE.industryGaps.length).toBeGreaterThan(0);
    expect(EXCHANGE_DEMO_INTELLIGENCE.territoryGaps.length).toBeGreaterThan(0);
    expect(EXCHANGE_DEMO_INTELLIGENCE.reciprocalPatterns.some((pattern) => pattern.classification === "review_recommended")).toBe(true);
  });

  it("keeps demo mutations in memory and enforces explicit offer-version acceptance", async () => {
    const gateway = createExchangeDemoGateway();
    const suggestion = EXCHANGE_DEMO_SUGGESTIONS[0];
    const offer = EXCHANGE_DEMO_SERVICE_OFFERS[0];
    const draft = await gateway.createReferralDraft({
      idempotencyKey: "demo-test-create",
      recipientOrgId: suggestion.providerOrgId,
      recipientLabel: suggestion.providerLabel,
      referralType: "business_lead",
      title: "Synthetic controls introduction",
      needSummary: "A synthetic manufacturer needs controls engineering support.",
      category: offer.serviceCategory,
      naicsCodes: offer.naicsCodes,
      territoryFips: offer.territoryFips[0],
      consentStatus: "not_required",
      serviceOfferId: offer.id,
      compensationType: offer.compensationType,
      currency: offer.currency,
    });
    const sent = await gateway.sendReferral(draft.id, draft.version);
    await expect(gateway.respondReferral(sent.id, "accepted", sent.version, {
      acknowledged: true,
      serviceOfferId: "wrong-offer",
      serviceOfferVersion: offer.version,
    })).rejects.toThrow(/offer version/i);
    const accepted = await gateway.respondReferral(sent.id, "accepted", sent.version, {
      acknowledged: true,
      serviceOfferId: offer.id,
      serviceOfferVersion: offer.version,
    });
    const reported = await gateway.reportTransaction(
      accepted.id,
      accepted.version,
      1_000_000,
      "USD",
      offer.id,
    );
    const confirmed = await gateway.confirmTransaction(
      reported.id,
      reported.latestTransactionReportId as string,
      reported.latestTransactionReportVersion as number,
    );
    expect(confirmed.commerceStatus).toBe("settlement_unavailable");
    expect(confirmed.compensation).toMatchObject({
      grossReferralPayoutCents: 100_000,
      platformFeeBasisPoints: 100,
      platformFeeCents: 1_000,
      netReferrerPayoutCents: 99_000,
      settlementEnabled: false,
    });
    expect(calculateDemoReferralAmounts(100_000, 100)).toEqual({
      grossReferralPayoutCents: 100_000,
      platformFeeBasisPoints: 100,
      platformFeeCents: 1_000,
      netReferrerPayoutCents: 99_000,
    });
  });

  it("exports authorized analytics with integrity labels and suppressed cells", () => {
    const csv = buildReferralIntelligenceCsv(EXCHANGE_DEMO_INTELLIGENCE);
    expect(csv).toContain("reported_referred_transaction_value");
    expect(csv).toContain("confirmed_referred_transaction_value");
    expect(csv).toContain("calculated_platform_fee");
    expect(csv).toContain("Cybersecurity services,suppressed");
    expect(csv).toContain("Platform membership invitations are excluded");
    expect(csv).not.toMatch(/email|phone|evidence_storage|customer_name/i);
  });

  it("uses strict live callable names and keeps non-opportunity views map-free", () => {
    const functionsSource = fs.readFileSync(
      path.join(repoRoot, "apps/web/src/lib/functions.ts"),
      "utf8",
    );
    const gatewaySource = fs.readFileSync(
      path.join(repoRoot, "apps/web/src/features/exchange/data/exchangeRun3Gateway.ts"),
      "utf8",
    );
    const connectionsSource = fs.readFileSync(
      path.join(repoRoot, "apps/web/src/features/exchange/connections/ConnectionsWorkspace.tsx"),
      "utf8",
    );
    const intelligenceSource = fs.readFileSync(
      path.join(repoRoot, "apps/web/src/features/exchange/intelligence/IntelligenceWorkspace.tsx"),
      "utf8",
    );
    expect(functionsSource).toContain('"businessReferral_reviewTransaction"');
    expect(functionsSource).toContain('"referralIntelligence_getOverview"');
    expect(functionsSource).toContain('"referralIntelligence_listRelationships"');
    expect(functionsSource).not.toContain('"businessReferral_confirmTransaction"');
    expect(functionsSource).not.toContain('"businessReferral_calculateCompensation"');
    expect(gatewaySource).toContain("expectedReferralVersion: expectedVersion");
    expect(gatewaySource).toContain("evidenceStoragePaths: []");
    expect(connectionsSource).not.toContain("../map/");
    expect(intelligenceSource).not.toContain("../map/");
  });
});
