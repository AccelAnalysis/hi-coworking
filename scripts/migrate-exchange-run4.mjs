#!/usr/bin/env node
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const projectId = option("project");
const apply = process.argv.includes("--apply");
const reportPath = option("report");
if (!projectId) {
  throw new Error("Explicit --project=<firebase-project-id> is required");
}
if (apply && !projectId.startsWith("demo-") && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Apply mode is restricted to demo projects or the Firestore emulator");
}
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const [users, orgs, members, referrals, profiles] = await Promise.all([
  db.collection("users").limit(5_000).get(),
  db.collection("orgs").limit(5_000).get(),
  db.collection("orgMembers").limit(10_000).get(),
  db.collection("businessReferrals").limit(5_000).get(),
  db.collection("profiles").limit(5_000).get(),
]);

const membershipsByUid = new Map();
for (const document of members.docs) {
  const data = document.data();
  const ids = membershipsByUid.get(data.uid) ?? [];
  ids.push(data.orgId);
  membershipsByUid.set(data.uid, ids);
}
const profileIds = new Set(profiles.docs.map((document) => document.id));
const invalidStripe = (value) => typeof value === "string"
  && (!/^(cus_|sub_|price_|prod_)/.test(value) || /placeholder|example|test_price/i.test(value));

const report = {
  schemaVersion: 1,
  projectId,
  mode: apply ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  counts: {
    users: users.size,
    organizations: orgs.size,
    organizationMembers: members.size,
    referrals: referrals.size,
    profiles: profiles.size,
  },
  existingUsersNeedingFreeExchangeCompatibility: users.docs.map((document) => document.id),
  organizationsNeedingExchangeMembership: [],
  organizationLegacyCredits: [],
  ambiguousUserCredits: [],
  usersWithoutOrganization: [],
  invalidOrPlaceholderStripeIds: [],
  referralsNeedingFinancialReview: [],
  schemaViolations: [],
  businessesNeedingClaimOrVerificationReview: [],
  physicalMembershipFieldsPreserved: true,
  writes: [],
};

for (const document of users.docs) {
  const data = document.data();
  const orgIds = membershipsByUid.get(document.id) ?? [];
  if (orgIds.length === 0) report.usersWithoutOrganization.push(document.id);
  if (Number(data.credits ?? 0) > 0) {
    report.ambiguousUserCredits.push({ uid: document.id, credits: data.credits, reason: "user-owned legacy balance has no authoritative organization owner" });
  }
  for (const field of ["stripeCustomerId", "stripeSubscriptionId", "stripePriceId"]) {
    if (invalidStripe(data[field])) report.invalidOrPlaceholderStripeIds.push({ collection: "users", id: document.id, field });
  }
}

for (const document of orgs.docs) {
  const data = document.data();
  const membership = await db.collection("exchangeMemberships").doc(document.id).get();
  if (!membership.exists) report.organizationsNeedingExchangeMembership.push(document.id);
  if (Number(data.credits ?? data.creditBalance ?? 0) > 0) {
    report.organizationLegacyCredits.push({ organizationId: document.id, credits: Number(data.credits ?? data.creditBalance) });
  }
  const verification = data.exchangeVerificationStatus ?? data.verificationStatus;
  if (verification !== "verified") report.businessesNeedingClaimOrVerificationReview.push({ organizationId: document.id, status: verification ?? "unverified" });
  for (const field of ["stripeCustomerId", "stripeSubscriptionId", "stripePriceId"]) {
    if (invalidStripe(data[field])) report.invalidOrPlaceholderStripeIds.push({ collection: "orgs", id: document.id, field });
  }
}

for (const document of referrals.docs) {
  const data = document.data();
  if (data.compensationPresent === true && (!data.acceptedTermsSnapshot || !data.recipientOrgId || !data.referrerOrgId)) {
    report.referralsNeedingFinancialReview.push({ referralId: document.id, reason: "compensated referral lacks complete organization-scoped accepted terms" });
  }
}

for (const document of profiles.docs) {
  const data = document.data();
  if (!profileIds.has(document.id) || !data.verificationStatus) {
    report.businessesNeedingClaimOrVerificationReview.push({ profileId: document.id, status: data.verificationStatus ?? "unknown" });
  }
}

if (apply) {
  for (const organizationId of report.organizationsNeedingExchangeMembership) {
    const ref = db.collection("exchangeMemberships").doc(organizationId);
    const now = Date.now();
    await ref.set({
      organizationId,
      tier: "free",
      status: "active",
      isFoundingMember: false,
      foundingRecognitionRetained: false,
      startedAt: now,
      pricingVersion: "free-migration-v1",
      entitlementVersion: "free-v1",
      createdAt: now,
      updatedAt: now,
    }, { merge: false });
    report.writes.push({ collection: "exchangeMemberships", id: organizationId, action: "create_free" });
  }
  for (const legacy of report.organizationLegacyCredits) {
    const grantId = createHash("sha256").update(`legacy_import:${legacy.organizationId}`).digest("hex");
    const grantRef = db.collection("exchangeCreditGrants").doc(grantId);
    const snapshot = await grantRef.get();
    if (snapshot.exists) continue;
    const now = Date.now();
    await db.runTransaction(async (transaction) => {
      const accountRef = db.collection("exchangeCreditAccounts").doc(legacy.organizationId);
      const accountSnapshot = await transaction.get(accountRef);
      const current = Number(accountSnapshot.data()?.usableCredits ?? 0);
      transaction.create(grantRef, {
        id: grantId,
        organizationId: legacy.organizationId,
        source: "legacy_import",
        originalCredits: legacy.credits,
        remainingCredits: legacy.credits,
        grantedAt: now,
        status: "active",
        sourceReferenceId: `legacy-org-balance:${legacy.organizationId}`,
        idempotencyKey: grantId,
        policyVersion: "legacy-import-v1",
        createdAt: now,
        updatedAt: now,
});
      transaction.set(accountRef, {
        organizationId: legacy.organizationId,
        usableCredits: current + legacy.credits,
        hasDeficit: false,
        policyVersion: "legacy-import-v1",
        updatedAt: now,
      }, { merge: true });
      transaction.create(db.collection("exchangeCreditTransactions").doc(`grant_${grantId}`), {
        id: `grant_${grantId}`,
        organizationId: legacy.organizationId,
        actingUid: "system:migration",
        amount: legacy.credits,
        type: "legacy_import",
        relatedGrantIds: [grantId],
        sourceReferenceId: `legacy-org-balance:${legacy.organizationId}`,
        idempotencyKey: grantId,
        policyVersion: "legacy-import-v1",
        createdAt: now,
      });
    });
    report.writes.push({ collection: "exchangeCreditGrants", id: grantId, action: "legacy_import_without_expiration" });
  }
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (reportPath) await writeFile(reportPath, serialized, "utf8");
process.stdout.write(serialized);
