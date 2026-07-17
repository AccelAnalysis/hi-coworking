import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp as deleteAdminApp, getApps as getAdminApps, initializeApp as initializeAdminApp, type App as AdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore, type Firestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, type Firestore as ClientFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { createRequire } from "node:module";

const PROJECT_ID = "demo-hi-coworking";
const PASSWORD = "exchange-acceptance-password";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9100";

interface Actor { uid: string; app: FirebaseApp; auth: Auth; functions: Functions; firestore: ClientFirestore }
let adminApp: AdminApp;
let db: Firestore;
const clients: FirebaseApp[] = [];

async function clearEmulators() {
  await fetch(`http://127.0.0.1:8081/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9100/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

async function actor(uid: string, role: "member" | "admin" = "member"): Promise<Actor> {
  const email = `${uid}@example.test`;
  await getAdminAuth(adminApp).createUser({ uid, email, password: PASSWORD, emailVerified: true });
  await getAdminAuth(adminApp).setCustomUserClaims(uid, { role });
  const app = initializeApp({ apiKey: "demo", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID }, `exchange-${uid}-${clients.length}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9100", { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5004);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8081);
  return { uid, app, auth, functions, firestore };
}

function anonymousActor(): Actor {
  const app = initializeApp({ apiKey: "demo", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID }, `exchange-anonymous-${clients.length}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9100", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5004);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8081);
  return { uid: "", app, auth, functions, firestore };
}

async function call<Result>(who: Actor, name: string, data: Record<string, unknown> = {}): Promise<Result> {
  return (await httpsCallable<Record<string, unknown>, Result>(who.functions, name)(data)).data;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code: `functions/${code}` });
}

async function seedUnclaimed(id = "org_seeded") {
  await db.collection("orgs").doc(id).set({
    id, name: "Fixture Smithfield Services LLC", normalizedName: "fixture smithfield services",
    searchTokens: ["fixture", "smithfield", "services"], city: "Smithfield", state: "VA",
    sources: ["iow_companies"], claimStatus: "unclaimed", verificationStatus: "unverified",
    ownerUid: "", createdAt: Date.now(), updatedAt: Date.now(),
  });
}

describe("Exchange Week 1 callable acceptance", () => {
  beforeAll(async () => {
    adminApp = getAdminApps()[0] || initializeAdminApp({ projectId: PROJECT_ID });
    db = getAdminFirestore(adminApp);
    const requireFromFunctions = createRequire(new URL("../../apps/functions/package.json", import.meta.url));
    const functionsAdmin = requireFromFunctions("firebase-admin/app") as typeof import("firebase-admin/app");
    if (!functionsAdmin.getApps().length) functionsAdmin.initializeApp({ projectId: PROJECT_ID });
  });
  beforeEach(clearEmulators);
  afterAll(async () => {
    await Promise.all(clients.splice(0).map(deleteApp));
    await deleteAdminApp(adminApp);
  });

  it("searches seeded organizations and creates a free organization without duplicates", async () => {
    await seedUnclaimed();
    await expectCode(call(anonymousActor(), "exchange_organizationSearch", { name: "Fixture" }), "unauthenticated");
    const member = await actor("searcher");
    const search = await call<{ candidates: Array<{ id: string; name: string }> }>(member, "exchange_organizationSearch", { name: "Fixture Smithfield Services" });
    expect(search.candidates.filter((item) => item.id === "org_seeded")).toHaveLength(1);
    const duplicate = await call<{ created: boolean; possibleMatches: unknown[] }>(member, "exchange_organizationCreate", { name: "Fixture Smithfield Services LLC", city: "Smithfield", state: "VA" });
    expect(duplicate.created).toBe(false);
    expect(duplicate.possibleMatches.length).toBeGreaterThan(0);
    const created = await call<{ created: boolean; organizationId: string }>(member, "exchange_organizationCreate", { name: "Different Exchange Studio", city: "Windsor", state: "VA" });
    expect(created.created).toBe(true);
    expect((await db.collection("organizationMemberships").doc(created.organizationId).get()).data()?.status).toBe("free");
  });

  it("keeps claims server-only and atomically approves one competing claimant", async () => {
    await seedUnclaimed();
    const first = await actor("claimant-one");
    const second = await actor("claimant-two");
    const admin = await actor("claim-admin", "admin");
    const one = await call<{ claimId: string }>(first, "exchange_organizationRequestClaim", { organizationId: "org_seeded", reason: "I own it" });
    const retry = await call<{ claimId: string }>(first, "exchange_organizationRequestClaim", { organizationId: "org_seeded", reason: "retry" });
    expect(retry.claimId).toBe(one.claimId);
    await call(second, "exchange_organizationRequestClaim", { organizationId: "org_seeded", reason: "Competing request" });
    await expectCode(call(first, "exchange_adminReviewOrganizationClaim", { claimId: one.claimId, decision: "approve", reviewNote: "No" }), "permission-denied");
    await expect(getDoc(doc(first.firestore, "organizationClaims", one.claimId))).rejects.toBeTruthy();
    const reviewed = await call<{ idempotent: boolean }>(admin, "exchange_adminReviewOrganizationClaim", { claimId: one.claimId, decision: "approve", reviewNote: "Authority confirmed" });
    expect(reviewed.idempotent).toBe(false);
    const reviewedAgain = await call<{ idempotent: boolean }>(admin, "exchange_adminReviewOrganizationClaim", { claimId: one.claimId, decision: "approve", reviewNote: "Authority confirmed" });
    expect(reviewedAgain.idempotent).toBe(true);
    expect((await db.collection("orgs").doc("org_seeded").get()).data()?.ownerUid).toBe(first.uid);
    expect((await db.collection("orgMembers").doc(`org_seeded_${first.uid}`).get()).data()?.role).toBe("owner");
    expect((await db.collection("organizationClaims").doc("org_seeded_claimant-two").get()).data()?.status).toBe("rejected");
    expect((await getDoc(doc(first.firestore, "orgs", "org_seeded"))).data()?.ownerUid).toBe(first.uid);
    await expect(setDoc(doc(first.firestore, "orgs", "org_seeded"), { ownerUid: second.uid }, { merge: true })).rejects.toBeTruthy();
    await expect(getDoc(doc(first.firestore, "organizationCreditLots", "private"))).rejects.toBeTruthy();
    await expect(getDoc(doc(first.firestore, "founderAllocation", "state"))).rejects.toBeTruthy();
    await expect(getDoc(doc(first.firestore, "organizationSourceCandidates", "private"))).rejects.toBeTruthy();
    await expectCode(call(second, "exchange_organizationRequestClaim", { organizationId: "org_seeded", reason: "late" }), "already-exists");
  });

  it("rejects a claim without granting authority and restores an unclaimed organization", async () => {
    await seedUnclaimed("org_rejected");
    const claimant = await actor("rejected-claimant");
    const admin = await actor("reject-admin", "admin");
    const claim = await call<{ claimId: string }>(claimant, "exchange_organizationRequestClaim", { organizationId: "org_rejected", reason: "Insufficient evidence" });
    await call(admin, "exchange_adminReviewOrganizationClaim", { claimId: claim.claimId, decision: "reject", reviewNote: "Authority not established" });
    expect((await db.collection("organizationClaims").doc(claim.claimId).get()).data()?.status).toBe("rejected");
    expect((await db.collection("orgs").doc("org_rejected").get()).data()?.claimStatus).toBe("unclaimed");
    expect((await db.collection("orgMembers").doc(`org_rejected_${claimant.uid}`).get()).exists).toBe(false);
  });

  it("enforces organization authority, reserves safely, and rejects the 251st founder", async () => {
    const owner = await actor("founder-owner");
    const outsider = await actor("founder-outsider");
    const created = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Founder One LLC", city: "Smithfield", state: "VA" });
    await expectCode(call(outsider, "exchange_createFoundingCheckout", { organizationId: created.organizationId }), "permission-denied");
    const checkout = await call<{ url: string }>(owner, "exchange_createFoundingCheckout", { organizationId: created.organizationId });
    expect(checkout.url).toContain("mock=1");
    expect((await db.collection("founderReservations").doc(created.organizationId).get()).exists).toBe(true);
    await expectCode(call(owner, "exchange_createFoundingCheckout", { organizationId: created.organizationId }), "already-exists");
    await db.collection("founderReservations").doc(created.organizationId).delete();
    await db.collection("founderAllocation").doc("state").set({ activeCount: 250, reservationCount: 0, nextFounderNumber: 251 });
    const capped = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Founder Two LLC", city: "Windsor", state: "VA" });
    await expectCode(call(owner, "exchange_createFoundingCheckout", { organizationId: capped.organizationId }), "resource-exhausted");
  });

  it("serializes concurrent 250th/251st attempts and releases an expired Checkout", async () => {
    const owner = await actor("concurrent-owner");
    const first = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Concurrent Founder One", city: "Smithfield", state: "VA" });
    const second = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Concurrent Founder Two", city: "Windsor", state: "VA" });
    await db.collection("founderAllocation").doc("state").set({ activeCount: 249, reservationCount: 0, nextFounderNumber: 250 });
    const attempts = await Promise.allSettled([
      call<{ url: string }>(owner, "exchange_createFoundingCheckout", { organizationId: first.organizationId }),
      call<{ url: string }>(owner, "exchange_createFoundingCheckout", { organizationId: second.organizationId }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const reservedId = (await db.collection("founderReservations").get()).docs[0].id;
    const { processExchangeMembershipWebhook } = await import("../../apps/functions/src/exchange/membership");
    expect(await processExchangeMembershipWebhook({ eventId: "evt_checkout_expired", action: "checkout_expired", metadata: { organizationId: reservedId, membershipKind: "exchange_founding" } })).toBe(true);
    expect((await db.collection("founderReservations").doc(reservedId).get()).exists).toBe(false);
    expect((await db.collection("founderAllocation").doc("state").get()).data()?.reservationCount).toBe(0);
  });

  it("keeps subscription activation idempotent and blocks cross-organization reuse", async () => {
    const owner = await actor("lifecycle-owner");
    const one = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Lifecycle One", city: "Smithfield", state: "VA" });
    const two = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Lifecycle Two", city: "Windsor", state: "VA" });
    const { processExchangeMembershipWebhook } = await import("../../apps/functions/src/exchange/membership");
    const metadata = { organizationId: one.organizationId, membershipKind: "exchange_founding", subscriptionId: "sub_shared", subscriptionStatus: "active", customerId: "cus_one" };
    await processExchangeMembershipWebhook({ eventId: "evt_sub_1", action: "subscription_updated", metadata });
    await processExchangeMembershipWebhook({ eventId: "evt_sub_1", action: "subscription_updated", metadata });
    await processExchangeMembershipWebhook({ eventId: "evt_sub_retry", action: "subscription_updated", metadata });
    const membership = (await db.collection("organizationMemberships").doc(one.organizationId).get()).data();
    expect(membership?.founderNumber).toBe(1);
    expect((await db.collection("founderAllocation").doc("state").get()).data()?.activeCount).toBe(1);
    await expect(processExchangeMembershipWebhook({ eventId: "evt_sub_cross", action: "subscription_updated", metadata: { ...metadata, organizationId: two.organizationId } })).rejects.toThrow(/another organization/);
    await processExchangeMembershipWebhook({ eventId: "evt_payment_failed", action: "payment_failed", metadata: { ...metadata, subscriptionStatus: "past_due" } });
    expect((await db.collection("organizationMemberships").doc(one.organizationId).get()).data()?.status).toBe("past_due");
    await processExchangeMembershipWebhook({ eventId: "evt_sub_deleted", action: "payment_failed", metadata: { ...metadata, reason: "subscription_cancelled", subscriptionStatus: "canceled" } });
    expect((await db.collection("organizationMemberships").doc(one.organizationId).get()).data()?.status).toBe("canceled");
  });

  it("grants each paid invoice once and excludes expired credits", async () => {
    const owner = await actor("credit-owner");
    const created = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Credit Owner LLC", city: "Windsor", state: "VA" });
    const { grantFoundingInvoiceCredits } = await import("../../apps/functions/src/exchange/credits");
    expect(await grantFoundingInvoiceCredits({ organizationId: created.organizationId, invoiceId: "in_1", eventId: "evt_1" })).toBe(true);
    expect(await grantFoundingInvoiceCredits({ organizationId: created.organizationId, invoiceId: "in_1", eventId: "evt_retry" })).toBe(false);
    const before = await call<{ creditBalance: number }>(owner, "exchange_getOrganizationMembership", { organizationId: created.organizationId });
    expect(before.creditBalance).toBe(25);
    const lot = (await db.collection("organizationCreditLots").doc("stripe_invoice_in_1").get()).data();
    const effectiveAt = new Date(Number(lot?.effectiveAt));
    const expiresAt = new Date(Number(lot?.expiresAt));
    expect(expiresAt.getUTCFullYear()).toBe(effectiveAt.getUTCFullYear() + 1);
    expect(expiresAt.getUTCMonth()).toBe(effectiveAt.getUTCMonth());
    expect(expiresAt.getUTCDate()).toBe(effectiveAt.getUTCDate());
    const isolated = await call<{ organizationId: string }>(owner, "exchange_organizationCreate", { name: "Isolated Credit Org", city: "Smithfield", state: "VA" });
    expect((await call<{ creditBalance: number }>(owner, "exchange_getOrganizationMembership", { organizationId: isolated.organizationId })).creditBalance).toBe(0);
    await db.collection("organizationCreditLots").doc("stripe_invoice_in_1").update({ expiresAt: Date.now() - 1 });
    const after = await call<{ creditBalance: number }>(owner, "exchange_getOrganizationMembership", { organizationId: created.organizationId });
    expect(after.creditBalance).toBe(0);
  });
});
