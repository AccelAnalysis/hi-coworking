import { createRequire } from "node:module";
import { resolve } from "node:path";
import { deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  exchange_spendCredits,
  grantOrganizationCreditsOnce,
  resolveExchangeEntitlements,
} from "../../apps/functions/src/exchangeCommercial";
import { DEFAULT_EXCHANGE_COMMERCIAL_POLICY } from "../../apps/functions/src/exchangeCommercialPolicy";

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const requireFromFunctions = createRequire(resolve("apps/functions/package.json"));
const functionsAdmin = requireFromFunctions("firebase-admin") as typeof import("firebase-admin");

emulatorDescribe("Run 4 organization entitlements and credit concurrency", () => {
  let app: App;
  let db: Firestore;
  const actor = (uid: string) => ({ uid, role: "member" as const, isAdmin: false, email: `${uid}@example.test` });
  const callable = (uid: string, data: unknown): CallableRequest<unknown> => ({
    data,
    auth: { uid, token: { role: "member", email: `${uid}@example.test` } },
  } as unknown as CallableRequest<unknown>);

  beforeAll(async () => {
    for (const existing of getApps()) await deleteApp(existing);
    app = initializeApp({ projectId: "demo-hi-coworking" });
    if (functionsAdmin.apps.length === 0) functionsAdmin.initializeApp({ projectId: "demo-hi-coworking" });
    db = getFirestore(app);
  });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-hi-coworking/databases/(default)/documents`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Could not clear Firestore: ${response.status}`);
    const policy = structuredClone(DEFAULT_EXCHANGE_COMMERCIAL_POLICY);
    policy.policyVersion = "test-policy-v1";
    policy.updatedBy = "test";
    policy.actionCosts.opportunity_response = { enabled: true, credits: 4, verifiedBusinessRequired: true };
    policy.quotas.free.opportunity_response = 10;
    policy.quotas.founding.opportunity_response = 10;
    await Promise.all([
      db.collection("exchangeCommercialPolicies").doc("current").set(policy),
      db.collection("orgs").doc("acme").set({ id: "acme", name: "Acme", status: "active", verificationStatus: "verified" }),
      db.collection("orgMembers").doc("acme_owner").set({ id: "acme_owner", orgId: "acme", uid: "owner", role: "owner", status: "active" }),
      db.collection("orgMembers").doc("acme_member").set({ id: "acme_member", orgId: "acme", uid: "member", role: "member", status: "active", permissions: ["view_exchange", "spend_credits"] }),
      db.collection("orgMembers").doc("acme_viewer").set({ id: "acme_viewer", orgId: "acme", uid: "viewer", role: "member", status: "active", permissions: ["view_exchange"] }),
      db.collection("exchangeMemberships").doc("acme").set({ organizationId: "acme", tier: "founding", status: "active", isFoundingMember: true, foundingRecognitionRetained: true, pricingVersion: "p1", entitlementVersion: "e1" }),
    ]);
  });
  afterAll(async () => {
    if (app) await deleteApp(app);
    await Promise.all(functionsAdmin.apps.map((existing) => existing.delete()));
  });

  it("separates active founding rights from free fallback and ignores physical user membership", async () => {
    await db.collection("users").doc("owner").set({ membershipStatus: "active", plan: "coworking_plus" });
    const active = await resolveExchangeEntitlements({ organizationId: "acme", actor: actor("owner") });
    expect(active).toMatchObject({ tier: "founding", paidEntitlementsActive: true, freeBrowsingAllowed: true });
    await db.collection("exchangeMemberships").doc("acme").update({ status: "past_due" });
    const pastDue = await resolveExchangeEntitlements({ organizationId: "acme", actor: actor("owner") });
    expect(pastDue).toMatchObject({ membershipStatus: "past_due", paidEntitlementsActive: false, freeBrowsingAllowed: true });
  });

  it("enforces explicit organization permissions and verification", async () => {
    await expect(resolveExchangeEntitlements({ organizationId: "acme", actor: actor("viewer"), requiredPermission: "spend_credits" })).rejects.toMatchObject({ code: "permission-denied" });
    await db.collection("orgs").doc("acme").update({ verificationStatus: "verification_pending" });
    await expect(resolveExchangeEntitlements({ organizationId: "acme", actor: actor("member"), requiredPermission: "spend_credits", requireVerified: true })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(resolveExchangeEntitlements({ organizationId: "missing", actor: actor("member") })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("grants once and prevents concurrent overspending", async () => {
    const grantedAt = Date.now();
    const first = await grantOrganizationCreditsOnce({ organizationId: "acme", source: "purchase", credits: 5, grantedAt, expiresAt: grantedAt + 10_000, sourceReferenceId: "session-one", idempotencyKey: "webhook-event-one", policyVersion: "test-policy-v1", actorUid: "member" });
    const replay = await grantOrganizationCreditsOnce({ organizationId: "acme", source: "purchase", credits: 5, grantedAt, expiresAt: grantedAt + 10_000, sourceReferenceId: "session-one", idempotencyKey: "webhook-event-two", policyVersion: "test-policy-v1", actorUid: "member" });
    expect(first.idempotent).toBe(false);
    expect(replay).toMatchObject({ grantId: first.grantId, idempotent: true });
    const outcomes = await Promise.allSettled([
      exchange_spendCredits.run(callable("member", { organizationId: "acme", actionKey: "opportunity_response", referenceId: "rfx-one", idempotencyKey: "spend-concurrent-one" })),
      exchange_spendCredits.run(callable("member", { organizationId: "acme", actionKey: "opportunity_response", referenceId: "rfx-two", idempotencyKey: "spend-concurrent-two" })),
    ]);
    const outcomeSummary = outcomes.map((result) => result.status === "fulfilled"
      ? { status: result.status }
      : {
          status: result.status,
          code: (result.reason as { code?: unknown })?.code,
          message: (result.reason as { message?: unknown })?.message,
        });
    expect(outcomes.filter((result) => result.status === "fulfilled"), JSON.stringify(outcomeSummary)).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await db.collection("exchangeCreditAccounts").doc("acme").get()).data()?.usableCredits).toBe(1);
  });

  it("rejects expired grants and client entitlement fields", async () => {
    const now = Date.now();
    await grantOrganizationCreditsOnce({ organizationId: "acme", source: "promotion", credits: 4, grantedAt: now - 2_000, expiresAt: now - 1, sourceReferenceId: "expired-promo", idempotencyKey: "expired-promo-event", policyVersion: "test-policy-v1" });
    await expect(exchange_spendCredits.run(callable("member", { organizationId: "acme", actionKey: "opportunity_response", referenceId: "rfx-expired", idempotencyKey: "spend-expired-grant" }))).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(exchange_spendCredits.run(callable("member", { organizationId: "acme", actionKey: "opportunity_response", referenceId: "rfx-tamper", idempotencyKey: "spend-tampered-tier", tier: "founding" }))).rejects.toBeDefined();
  });
});
