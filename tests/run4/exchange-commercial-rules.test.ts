import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

function emulatorAddress() {
  const address = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
  const separator = address.lastIndexOf(":");
  return { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) };
}

emulatorDescribe("Run 4 Exchange commercial Firestore rules", () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "demo-hi-coworking",
      firestore: { ...emulatorAddress(), rules: readFileSync(resolve("firestore.rules"), "utf8") },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "orgs/acme"), { id: "acme", name: "Acme", status: "active", exchangeVerificationStatus: "verified" }),
        setDoc(doc(db, "orgs/other"), { id: "other", name: "Other", status: "active" }),
        setDoc(doc(db, "orgMembers/acme_alice"), { id: "acme_alice", orgId: "acme", uid: "alice", role: "member" }),
        setDoc(doc(db, "exchangePublicConfiguration/current"), { policyVersion: "v1", featureFlags: { exchangeEnabled: true } }),
        setDoc(doc(db, "exchangeMemberships/acme"), { organizationId: "acme", tier: "free", status: "active", stripeCustomerId: "cus_private" }),
        setDoc(doc(db, "exchangeCreditAccounts/acme"), { organizationId: "acme", usableCredits: 25 }),
        setDoc(doc(db, "exchangeCreditGrants/grant-one"), { id: "grant-one", organizationId: "acme", originalCredits: 25, remainingCredits: 25, status: "active", expiresAt: 100 }),
        setDoc(doc(db, "exchangeCreditTransactions/txn-one"), { id: "txn-one", organizationId: "acme", amount: 25 }),
        setDoc(doc(db, "exchangeCommercialPolicies/current"), { policyVersion: "private" }),
        setDoc(doc(db, "exchangeCheckoutIntents/session"), { organizationId: "acme", stripePriceId: "price_private" }),
        setDoc(doc(db, "referralFinancialAccounts/lifecycle"), { referrerOrgId: "acme", grossReferralFeeCents: 10000 }),
        setDoc(doc(db, "exchangeAuditEvents/audit"), { actorUid: "admin", action: "updated" }),
        setDoc(doc(db, "exchangeJobRuns/job"), { job: "expiration" }),
      ]);
    });
  });
  afterAll(async () => env.cleanup());

  it("exposes only the sanitized public projection and denies every browser policy write", async () => {
    const guest = env.unauthenticatedContext().firestore();
    const alice = env.authenticatedContext("alice", { role: "member" }).firestore();
    await assertSucceeds(getDoc(doc(guest, "exchangePublicConfiguration/current")));
    await assertFails(setDoc(doc(alice, "exchangePublicConfiguration/current"), { policyVersion: "tampered" }));
    await assertFails(getDoc(doc(alice, "exchangeCommercialPolicies/current")));
    await assertFails(setDoc(doc(alice, "exchangeCommercialPolicies/current"), { policyVersion: "tampered" }));
  });

  it("lets organization members inspect their wallet while denying balance, grant, expiration, transaction, and transfer writes", async () => {
    const alice = env.authenticatedContext("alice", { role: "member" }).firestore();
    const bob = env.authenticatedContext("bob", { role: "member" }).firestore();
    await assertSucceeds(getDoc(doc(alice, "exchangeMemberships/acme")));
    await assertSucceeds(getDoc(doc(alice, "exchangeCreditAccounts/acme")));
    await assertSucceeds(getDoc(doc(alice, "exchangeCreditGrants/grant-one")));
    await assertSucceeds(getDoc(doc(alice, "exchangeCreditTransactions/txn-one")));
    await assertFails(getDoc(doc(bob, "exchangeMemberships/acme")));
    await assertFails(updateDoc(doc(alice, "exchangeMemberships/acme"), { tier: "founding" }));
    await assertFails(updateDoc(doc(alice, "exchangeCreditAccounts/acme"), { usableCredits: 999999 }));
    await assertFails(updateDoc(doc(alice, "exchangeCreditGrants/grant-one"), { expiresAt: 999999 }));
    await assertFails(setDoc(doc(alice, "exchangeCreditTransactions/transfer"), { organizationId: "other", amount: 25, type: "transfer" }));
  });

  it("keeps checkout correlation and referral financial records behind protected Functions", async () => {
    const alice = env.authenticatedContext("alice", { role: "member" }).firestore();
    const staff = env.authenticatedContext("staff", { role: "staff" }).firestore();
    const admin = env.authenticatedContext("admin", { role: "admin" }).firestore();
    await assertFails(getDoc(doc(alice, "exchangeCheckoutIntents/session")));
    await assertFails(getDoc(doc(alice, "referralFinancialAccounts/lifecycle")));
    await assertFails(setDoc(doc(admin, "referralFinancialAccounts/fake-paid"), { status: "paid_out" }));
    await assertSucceeds(getDoc(doc(staff, "exchangeAuditEvents/audit")));
    await assertSucceeds(getDoc(doc(admin, "exchangeJobRuns/job")));
  });
});
