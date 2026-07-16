import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

const PROJECT_ID = "demo-hi-coworking";
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8081";
const functionsRequire = createRequire(resolve("apps/functions/package.json"));
const functionsAdmin = functionsRequire("firebase-admin") as typeof import("firebase-admin");

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

let app: App;
let db: Firestore;
let referrals: typeof import("../../apps/functions/src/businessReferrals");

function request(uid: string, data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: { uid, token: { role: "member", email: `${uid}@example.test` } },
  } as unknown as CallableRequest<unknown>;
}

async function clearFirestore(): Promise<void> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Could not clear Firestore: ${response.status}`);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected callable error ${code}`);
  } catch (error) {
    expect((error as { code?: unknown }).code).toBe(code);
  }
}

async function seedAuthority(): Promise<void> {
  await Promise.all([
    db.doc("users/referrer").set({ uid: "referrer", email: "referrer@example.test" }),
    db.doc("users/recipient").set({ uid: "recipient", email: "recipient@example.test" }),
    db.doc("orgs/referrer-org").set({ id: "referrer-org", status: "active" }),
    db.doc("orgs/recipient-org").set({ id: "recipient-org", status: "active" }),
    db.doc("orgMembers/referrer-org_referrer").set({
      id: "referrer-org_referrer", orgId: "referrer-org", uid: "referrer", role: "owner",
    }),
    db.doc("orgMembers/recipient-org_recipient").set({
      id: "recipient-org_recipient", orgId: "recipient-org", uid: "recipient", role: "owner",
    }),
    db.doc("rfx/linked-rfx").set({
      id: "linked-rfx",
      ownerUid: "issuer",
      status: "open",
      adminApprovalStatus: "approved",
      memberOnly: false,
    }),
    db.doc("rfx/pending-rfx").set({
      id: "pending-rfx",
      ownerUid: "issuer",
      status: "under_review",
      adminApprovalStatus: "pending",
      memberOnly: true,
    }),
    db.doc("rfxTeams/linked-team").set({
      id: "linked-team",
      rfxId: "linked-rfx",
      primeUid: "referrer",
      memberUids: ["referrer", "recipient"],
    }),
    db.doc("rfxTeamMemberships/linked-team/members/referrer").set({
      id: "referrer", uid: "referrer", teamId: "linked-team", rfxId: "linked-rfx", role: "prime",
    }),
    db.doc("rfxTeamMemberships/linked-team/members/recipient").set({
      id: "recipient", uid: "recipient", teamId: "linked-team", rfxId: "linked-rfx", role: "member",
    }),
    db.doc("referralServiceOffers/offer-v1").set({
      id: "offer-v1",
      offerId: "offer-series",
      schemaVersion: 1,
      providerOrgId: "recipient-org",
      serviceName: "Energy engineering",
      serviceCategory: "Engineering",
      naicsCodes: ["541330"],
      territoryFips: ["51003"],
      status: "published",
      acceptingReferrals: true,
      compensationType: "percentage",
      compensationRateBasisPoints: 1_000,
      percentageBasis: "first_collected_invoice",
      currency: "USD",
      attributionWindowDays: 90,
      payoutTrigger: "confirmed collection",
      paymentDeadlineDays: 30,
      refundTreatment: "recalculate after confirmed refund",
      includedCharges: ["services"],
      excludedCharges: ["tax"],
      version: 1,
      stateVersion: 1,
      effectiveAt: 1,
      publishedAt: 1,
      publishedBy: "recipient",
      createdBy: "recipient",
      createdAt: 1,
      updatedAt: 1,
    }),
  ]);
}

beforeAll(async () => {
  for (const existing of getApps()) await deleteApp(existing);
  app = initializeApp({ projectId: PROJECT_ID });
  if (functionsAdmin.apps.length === 0) functionsAdmin.initializeApp({ projectId: PROJECT_ID });
  db = getFirestore(app);
  referrals = await import("../../apps/functions/src/businessReferrals");
});

beforeEach(async () => {
  await clearFirestore();
  await seedAuthority();
});

afterAll(async () => {
  await deleteApp(app);
  await Promise.all(functionsAdmin.apps.map((existing) => existing.delete()));
});

describe("Run 3 accepted referral terms and guarded links", () => {
  it("locks exact offer/config terms and makes conversion await a transaction without asserting payment due", async () => {
    const created = await referrals.businessReferral_create.run(request("referrer", {
      idempotencyKey: "run3-referral-create-0001",
      referrerOrgId: "referrer-org",
      recipientUid: "recipient",
      recipientOrgId: "recipient-org",
      referralType: "project_opportunity",
      title: "Engineering referral",
      needSummary: "A synthetic customer needs engineering support.",
      category: "Engineering",
      naicsCodes: ["541330"],
      territoryFips: "51003",
      consentStatus: "not_required",
      serviceOfferId: "offer-v1",
      relatedRfxId: "linked-rfx",
      relatedTeamId: "linked-team",
      relatedOpportunityId: "linked-rfx",
    })) as { referralId: string; version: number };

    await referrals.businessReferral_send.run(request("referrer", {
      referralId: created.referralId,
      expectedVersion: 0,
      idempotencyKey: "run3-referral-send-0001",
    }));
    await expectCode(referrals.businessReferral_respond.run(request("recipient", {
      referralId: created.referralId,
      response: "accepted",
      expectedVersion: 1,
    })), "failed-precondition");
    await referrals.businessReferral_respond.run(request("recipient", {
      referralId: created.referralId,
      response: "accepted",
      expectedVersion: 1,
      idempotencyKey: "run3-referral-accept-0001",
      acceptTerms: {
        acknowledged: true,
        serviceOfferId: "offer-v1",
        serviceOfferVersion: 1,
      },
    }));

    const accepted = (await db.doc(`businessReferrals/${created.referralId}`).get()).data();
    expect(accepted).toMatchObject({
      schemaVersion: 2,
      status: "accepted",
      serviceOfferId: "offer-v1",
      serviceOfferVersion: 1,
      compensationPolicy: { type: "percentage", status: "agreed" },
      commerceStatus: "none",
      acceptedTermsSnapshot: {
        schemaVersion: 1,
        serviceOfferId: "offer-series",
        serviceOfferVersionId: "offer-v1",
        serviceOfferVersion: 1,
        compensationType: "percentage",
        platformFeeBasisPoints: 100,
        platformFeeConfigVersion: 1,
        calculationVersion: 1,
      },
    });

    await db.doc("platformConfiguration/referralCommerce").set({
      id: "referralCommerce",
      schemaVersion: 1,
      platformFeeBasisPoints: 175,
      version: 2,
      effectiveAt: Date.now(),
      updatedBy: "admin",
      updatedAt: Date.now(),
      commerceEnabled: true,
      settlementEnabled: false,
    });
    await referrals.businessReferral_progress.run(request("recipient", {
      referralId: created.referralId,
      status: "in_progress",
      expectedVersion: 2,
      idempotencyKey: "run3-referral-progress-0001",
    }));
    await referrals.businessReferral_progress.run(request("recipient", {
      referralId: created.referralId,
      status: "converted",
      expectedVersion: 3,
      idempotencyKey: "run3-referral-convert-0001",
      outcome: { type: "converted", summary: "Synthetic conversion" },
    }));

    const converted = (await db.doc(`businessReferrals/${created.referralId}`).get()).data();
    expect(converted).toMatchObject({
      status: "converted",
      commerceStatus: "awaiting_transaction",
      compensationPolicy: { type: "percentage", status: "agreed" },
      acceptedTermsSnapshot: { platformFeeBasisPoints: 100, platformFeeConfigVersion: 1 },
    });
    expect(converted?.compensationPolicy?.status).not.toBe("due");

    const timeline = await db.collection("businessReferralTimeline")
      .where("referralId", "==", created.referralId)
      .get();
    const eventTypes = new Set(timeline.docs.map((document) => document.get("eventType")));
    for (const eventType of [
        "draft_created",
        "referral_sent",
        "recipient_accepted",
        "terms_snapshot_locked",
        "progress_changed",
        "referral_converted",
    ]) {
      expect(eventTypes).toContain(eventType);
    }
  });

  it("rejects inferred same-organization, non-visible RFx, and stale team-array links", async () => {
    await db.doc("orgMembers/recipient-org_referrer").set({
      id: "recipient-org_referrer",
      orgId: "recipient-org",
      uid: "referrer",
      role: "member",
    });
    await expectCode(referrals.businessReferral_create.run(request("referrer", {
      idempotencyKey: "run3-referral-same-org-0001",
      recipientUid: "recipient",
      recipientOrgId: "recipient-org",
      referralType: "service_need",
      title: "Invalid same-org referral",
      needSummary: "This must be rejected.",
      consentStatus: "not_required",
    })), "invalid-argument");
    await db.doc("orgMembers/recipient-org_referrer").delete();

    await expectCode(referrals.businessReferral_create.run(request("referrer", {
      idempotencyKey: "run3-referral-private-rfx-0001",
      recipientUid: "recipient",
      recipientOrgId: "recipient-org",
      referralType: "service_need",
      title: "Invalid private RFx link",
      needSummary: "This must be rejected.",
      consentStatus: "not_required",
      relatedRfxId: "pending-rfx",
    })), "permission-denied");

    await db.doc("rfxTeamMemberships/linked-team/members/referrer").delete();
    await expectCode(referrals.businessReferral_create.run(request("referrer", {
      idempotencyKey: "run3-referral-stale-team-0001",
      recipientUid: "recipient",
      recipientOrgId: "recipient-org",
      referralType: "service_need",
      title: "Invalid stale team link",
      needSummary: "A stale memberUids array must not grant authority.",
      consentStatus: "not_required",
      relatedRfxId: "linked-rfx",
      relatedTeamId: "linked-team",
    })), "permission-denied");
  });
});
