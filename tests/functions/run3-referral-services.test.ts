import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  analyzeReferralReciprocity as sharedReciprocity,
  buildReferralGapAnalysis as sharedGaps,
  calculateReferralMedian as sharedMedian,
  calculateReferralNetworkMetrics as sharedNetwork,
  calculateReferralRate as sharedRate,
  countConfirmedReferralConversions as sharedConfirmedConversions,
  deriveReferralRelationshipInsight as sharedRelationship,
  summarizeReferralEconomicImpact as sharedEconomic,
  type ReferralAnalyticsRecord,
  type ReferralGapDemandRecord,
  type ReferralGapSupplyRecord,
  type ReferralTransactionAnalyticsRecord,
} from "../../packages/shared/src/referralIntelligence";
import {
  calculateBasisPointsHalfUp as sharedBasisPoints,
  calculateReferralFinancials as sharedFinancials,
  type ReferralFinancialCalculationInput,
} from "../../packages/shared/src/referralCommerce";
import {
  analyzeReferralReciprocity as localReciprocity,
  buildReferralGapAnalysis as localGaps,
  calculateBasisPointsHalfUp as localBasisPoints,
  calculateReferralFinancials as localFinancials,
  calculateReferralMedian as localMedian,
  calculateReferralNetworkMetrics as localNetwork,
  calculateReferralRate as localRate,
  countConfirmedReferralConversions as localConfirmedConversions,
  deriveReferralRelationshipInsight as localRelationship,
  summarizeReferralEconomicImpact as localEconomic,
} from "../../apps/functions/src/referralAnalytics";
import {
  referralIntelligence_getOverview,
  sanitizeBusinessReferralSummary,
  sanitizeReferralTransactionReport,
} from "../../apps/functions/src/referralRun3";

const functionsRequire = createRequire(resolve("apps/functions/package.json"));
const functionsAdmin = functionsRequire("firebase-admin") as typeof import("firebase-admin");

const referrals: ReferralAnalyticsRecord[] = [
  {
    id: "r1",
    domain: "business_referral",
    type: "service_need",
    referrerSubjectKey: "org:a",
    recipientSubjectKey: "org:b",
    referrerOrgId: "a",
    recipientOrgId: "b",
    status: "converted",
    createdAt: 1,
    sentAt: 1_000,
    respondedAt: 7_201_000,
    acceptedAt: 7_201_000,
    closedAt: 93_601_000,
    category: "facilities",
    naicsCodes: ["561210"],
    territoryFips: "51095",
    compensationType: "percentage",
    linkedRfxId: "rfx-1",
  },
  {
    id: "r2",
    domain: "business_referral",
    type: "business_lead",
    referrerSubjectKey: "org:b",
    recipientSubjectKey: "org:a",
    referrerOrgId: "b",
    recipientOrgId: "a",
    status: "accepted",
    createdAt: 2,
    sentAt: 1_000,
    respondedAt: 3_601_000,
    category: "construction",
    compensationType: "none",
    linkedTeamId: "team-1",
  },
  {
    id: "invite",
    domain: "platform_invite",
    type: "platform_invite",
    referrerSubjectKey: "org:a",
    recipientSubjectKey: "org:c",
    status: "converted",
    createdAt: 3,
  },
];

const reports: ReferralTransactionAnalyticsRecord[] = [
  {
    id: "t1",
    referralId: "r1",
    status: "settlement_unavailable",
    currency: "USD",
    collectedTransactionCents: 1_000_000,
    calculation: {
      grossReferralPayoutCents: 100_000,
      platformFeeCents: 1_000,
      netReferrerPayoutCents: 99_000,
    },
  },
  {
    id: "t2",
    referralId: "r2",
    status: "transaction_reported",
    currency: "EUR",
    collectedTransactionCents: 50_000,
  },
];

const demand: ReferralGapDemandRecord[] = Array.from({ length: 5 }, (_, index) => ({
  id: `d${index}`,
  organizationIds: [`org-${index}`],
  category: "facilities",
  territoryFips: "51095",
  status: index === 0 ? "accepted" : "sent",
}));

const supply: ReferralGapSupplyRecord[] = [{
  id: "s1",
  providerOrgId: "supplier",
  category: "facilities",
  territoryFips: ["51095"],
  active: true,
}];

describe("Run 3 Functions runtime parity", () => {
  it("keeps analytics calculations identical to shared contracts", () => {
    expect(localRate(2, 3)).toBe(sharedRate(2, 3));
    expect(localMedian([9, 1, 4, 2])).toBe(sharedMedian([9, 1, 4, 2]));
    expect(localNetwork(referrals, "org:a")).toEqual(sharedNetwork(referrals, "org:a"));

    const relationship = {
      acceptedReferrals: 6,
      confirmedConversions: 4,
      medianResponseTimeHours: 3,
      disputesOpened: 0,
      disputesLost: 0,
      reversals: 0,
      verified: true,
    };
    expect(localRelationship(relationship)).toEqual(sharedRelationship(relationship));

    const reciprocity = {
      forwardCount: 4,
      reverseCount: 3,
      firstPartyTotal: 5,
      secondPartyTotal: 5,
      disputedOrReversedCount: 1,
      rapidCrossReferralCount: 1,
    };
    expect(localReciprocity(reciprocity)).toEqual(sharedReciprocity(reciprocity));
    expect(localEconomic(referrals, reports)).toEqual(sharedEconomic(referrals, reports));
    expect(localConfirmedConversions(referrals, reports))
      .toBe(sharedConfirmedConversions(referrals, reports));
    expect(localGaps(demand, supply, { ownScope: false }))
      .toEqual(sharedGaps(demand, supply, { ownScope: false }));
  });

  it("keeps monetary calculations identical and fees based on payout", () => {
    const inputs: ReferralFinancialCalculationInput[] = [
      {
        qualifyingTransactionCents: 1_000_000,
        collectedTransactionCents: 1_000_000,
        compensationType: "percentage",
        compensationRateBasisPoints: 1_000,
        platformFeeBasisPoints: 100,
        currency: "usd",
        termsCurrency: "USD",
      },
      {
        qualifyingTransactionCents: 25_000,
        collectedTransactionCents: 20_000,
        compensationType: "fixed",
        fixedCompensationCents: 5_000,
        platformFeeBasisPoints: 100,
        currency: "USD",
      },
      {
        qualifyingTransactionCents: 25_000,
        collectedTransactionCents: 20_000,
        compensationType: "none",
        platformFeeBasisPoints: 100,
        currency: "USD",
      },
      {
        qualifyingTransactionCents: 25_000,
        collectedTransactionCents: 20_000,
        compensationType: "benefit",
        platformFeeBasisPoints: 100,
        currency: "USD",
      },
      {
        qualifyingTransactionCents: 25_000,
        collectedTransactionCents: 20_000,
        compensationType: "custom",
        platformFeeBasisPoints: 100,
        currency: "USD",
      },
    ];
    for (const input of inputs) {
      expect(localFinancials(input)).toEqual(sharedFinancials(input));
    }
    expect(localFinancials(inputs[0])).toMatchObject({
      grossReferralPayoutCents: 100_000,
      platformFeeCents: 1_000,
      netReferrerPayoutCents: 99_000,
    });
    for (const amount of [0, 49, 50, 149, 150, Number.MAX_SAFE_INTEGER]) {
      expect(localBasisPoints(amount, 100)).toBe(sharedBasisPoints(amount, 100));
    }
  });
});

describe("Run 3 response minimization and platform authority", () => {
  it("drops private transaction and referral fields from participant projections", () => {
    const transaction = sanitizeReferralTransactionReport("report-1", {
      referralId: "referral-1",
      status: "settlement_unavailable",
      reportedByUid: "recipient-user",
      reportedByOrgId: "recipient-org",
      confirmedByUid: "referrer-user",
      qualifyingTransactionCents: 100_000,
      collectedTransactionCents: 100_000,
      currency: "USD",
      collectionDate: 100,
      contractReference: "contract-private",
      invoiceReference: "invoice-private",
      evidenceStoragePaths: ["businessReferralEvidence/referral-1/recipient-user/file.pdf"],
      reviewNote: "private review context",
      financials: {
        grossReferralPayoutCents: 10_000,
        platformFeeCents: 100,
        netReferrerPayoutCents: 9_900,
        calculationVersion: 1,
      },
      version: 1,
      createdAt: 100,
      updatedAt: 200,
    });
    expect(transaction).toMatchObject({
      reportedByUid: "recipient-user",
      reportedByOrgId: "recipient-org",
      confirmedByUid: "referrer-user",
      evidenceCount: 1,
    });
    expect(transaction).not.toHaveProperty("contractReference");
    expect(transaction).not.toHaveProperty("invoiceReference");
    expect(transaction).not.toHaveProperty("evidenceStoragePaths");
    expect(transaction).not.toHaveProperty("reviewNote");

    const referral = sanitizeBusinessReferralSummary("referral-1", {
      schemaVersion: 2,
      referrerUid: "referrer-user",
      recipientUid: "recipient-user",
      referralType: "service_need",
      title: "Facilities introduction",
      needSummary: "Find a provider",
      consentStatus: "not_required",
      status: "accepted",
      compensationPolicy: { type: "percentage", status: "agreed" },
      acceptedTermsSnapshot: { customTerms: "private commercial text" },
      contactEmail: "private@example.test",
      version: 1,
      createdAt: 100,
      updatedAt: 200,
    });
    expect(referral).not.toHaveProperty("acceptedTermsSnapshot");
    expect(referral).not.toHaveProperty("contactEmail");
  });

  it("rejects non-admin platform intelligence before any database read", async () => {
    const request = {
      data: { scope: "platform", windowDays: 90 },
      auth: { uid: "member", token: { role: "member" } },
    } as unknown as CallableRequest<unknown>;
    await expect(referralIntelligence_getOverview.run(request)).rejects.toMatchObject({
      code: "permission-denied",
    });
  });
});

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe("Run 3 transaction replay authority", () => {
  let app: App;
  let db: Firestore;

  function request(uid: string, data: unknown): CallableRequest<unknown> {
    return {
      data,
      auth: { uid, token: { role: "member", email: `${uid}@example.test` } },
    } as unknown as CallableRequest<unknown>;
  }

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    try {
      await promise;
      throw new Error(`Expected callable error ${code}`);
    } catch (error) {
      expect((error as { code?: unknown }).code).toBe(code);
    }
  }

  beforeAll(async () => {
    for (const existing of getApps()) await deleteApp(existing);
    app = initializeApp({
      projectId: "demo-hi-coworking",
      storageBucket: "demo-hi-coworking.appspot.com",
    });
    if (functionsAdmin.apps.length === 0) {
      functionsAdmin.initializeApp({
        projectId: "demo-hi-coworking",
        storageBucket: "demo-hi-coworking.appspot.com",
      });
    }
    db = getFirestore(app);
  });

  beforeEach(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST as string;
    const response = await fetch(
      `http://${host}/emulator/v1/projects/demo-hi-coworking/databases/(default)/documents`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error(`Could not clear Firestore: ${response.status}`);
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
    await Promise.all(functionsAdmin.apps.map((existing) => existing.delete()));
  });

  it("denies exact report and review replays after organization authority is revoked", async () => {
    const now = Date.now();
    await Promise.all([
      db.collection("orgs").doc("referrer-org").set({ id: "referrer-org", status: "active" }),
      db.collection("orgs").doc("recipient-org").set({ id: "recipient-org", status: "active" }),
      db.collection("orgMembers").doc("referrer-org_referrer-manager").set({
        id: "referrer-org_referrer-manager",
        orgId: "referrer-org",
        uid: "referrer-manager",
        role: "owner",
        status: "active",
      }),
      db.collection("orgMembers").doc("recipient-org_recipient-manager").set({
        id: "recipient-org_recipient-manager",
        orgId: "recipient-org",
        uid: "recipient-manager",
        role: "admin",
        status: "active",
      }),
      db.collection("businessReferrals").doc("referral-replay").set({
        id: "referral-replay",
        schemaVersion: 2,
        referrerUid: "referrer-manager",
        referrerOrgId: "referrer-org",
        recipientOrgId: "recipient-org",
        referralType: "service_need",
        title: "Facilities referral",
        needSummary: "Introduce a facilities provider",
        consentStatus: "not_required",
        status: "accepted",
        compensationPolicy: { type: "none", currency: "USD", status: "agreed" },
        acceptedTermsSnapshot: {
          schemaVersion: 1,
          compensationType: "none",
          currency: "USD",
          attributionWindowDays: 90,
          platformFeeBasisPoints: 100,
          platformFeeConfigVersion: 1,
          acceptedByUid: "recipient-manager",
          acceptedByOrgId: "recipient-org",
          acceptedAt: now - 1_000,
          calculationVersion: 1,
        },
        commerceStatus: "none",
        version: 0,
        acceptedAt: now - 1_000,
        createdAt: now - 2_000,
        updatedAt: now - 1_000,
      }),
    ]);

    const reportInput = {
      referralId: "referral-replay",
      idempotencyKey: "report-replay-0001",
      expectedReferralVersion: 0,
      qualifyingTransactionCents: 100_000,
      collectedTransactionCents: 100_000,
      collectedAt: now,
      currency: "USD",
      evidenceStoragePaths: [],
    };
    const reported = await (await import("../../apps/functions/src/referralRun3"))
      .businessReferral_reportTransaction.run(request("recipient-manager", reportInput)) as {
        reportId: string;
      };
    expect(await (await import("../../apps/functions/src/referralRun3"))
      .businessReferral_reportTransaction.run(request("recipient-manager", reportInput)))
      .toMatchObject({ reportId: reported.reportId, idempotent: true });
    await db.collection("orgMembers").doc("recipient-org_recipient-manager").delete();
    await expectCode(
      (await import("../../apps/functions/src/referralRun3"))
        .businessReferral_reportTransaction.run(request("recipient-manager", reportInput)),
      "permission-denied",
    );

    const reviewInput = {
      reportId: reported.reportId,
      action: "confirm" as const,
      idempotencyKey: "review-replay-0001",
      expectedVersion: 0,
    };
    const reviewed = await (await import("../../apps/functions/src/referralRun3"))
      .businessReferral_reviewTransaction.run(request("referrer-manager", reviewInput)) as {
        status: string;
      };
    expect(reviewed.status).toBe("transaction_confirmed");
    expect(await (await import("../../apps/functions/src/referralRun3"))
      .businessReferral_reviewTransaction.run(request("referrer-manager", reviewInput)))
      .toMatchObject({ status: "transaction_confirmed", idempotent: true });
    await db.collection("orgMembers").doc("referrer-org_referrer-manager").delete();
    await expectCode(
      (await import("../../apps/functions/src/referralRun3"))
        .businessReferral_reviewTransaction.run(request("referrer-manager", reviewInput)),
      "permission-denied",
    );
  });
});
