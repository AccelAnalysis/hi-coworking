import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
  type TokenOptions,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const PROJECT_ID = "demo-hi-coworking";

function emulatorAddress(variable: string, fallbackPort: number) {
  const address = process.env[variable] ?? `127.0.0.1:${fallbackPort}`;
  const separator = address.lastIndexOf(":");

  return {
    host: address.slice(0, separator),
    port: Number(address.slice(separator + 1)),
  };
}

function memberToken(uid: string, overrides: TokenOptions = {}): TokenOptions {
  return {
    role: "member",
    email: `${uid}@example.test`,
    email_verified: true,
    ...overrides,
  };
}

describe("Run 1 Firestore authorization matrix", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        ...emulatorAddress("FIRESTORE_EMULATOR_HOST", 8081),
        rules: readFileSync(resolve("firestore.rules"), "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  function authenticated(uid: string, overrides: TokenOptions = {}): RulesTestContext {
    return testEnv.authenticatedContext(uid, memberToken(uid, overrides));
  }

  async function seed(entries: Record<string, DocumentData>) {
    const expanded: Record<string, DocumentData> = { ...entries };
    for (const [path, data] of Object.entries(entries)) {
      if (path.startsWith("orgMembers/") && typeof data.orgId === "string") {
        expanded[path] = { status: "active", ...data };
        const orgPath = `orgs/${data.orgId}`;
        expanded[orgPath] ??= { id: data.orgId, status: "active" };
      }
    }
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all(
        Object.entries(expanded).map(([path, data]) => setDoc(doc(db, path), data)),
      );
    });
  }

  test("users deny self-escalation while allowing the documented safe membership update", async () => {
    await seed({
      "users/alice": {
        uid: "alice",
        email: "alice@example.test",
        displayName: "Alice",
        membershipTrack: "community",
        role: "member",
        plan: "basic",
        featureEntitlements: ["directory"],
        credits: 10,
        createdAt: "seed",
        updatedAt: "seed",
      },
    });

    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const staff = authenticated("staff", { role: "staff" }).firestore();
    const aliceRef = doc(alice, "users/alice");

    await assertSucceeds(getDoc(aliceRef));
    await assertSucceeds(getDoc(doc(staff, "users/alice")));
    await assertFails(getDoc(doc(bob, "users/alice")));

    await assertSucceeds(updateDoc(aliceRef, {
      membershipTrack: "supplier",
      updatedAt: "client-update",
    }));
    await assertFails(updateDoc(aliceRef, { role: "admin" }));
    await assertFails(updateDoc(aliceRef, { plan: "enterprise" }));
    await assertFails(updateDoc(aliceRef, { featureEntitlements: ["everything"] }));
    await assertFails(updateDoc(aliceRef, { credits: 1_000_000 }));
    await assertFails(updateDoc(aliceRef, { email: "attacker@example.test" }));
    await assertFails(
      setDoc(doc(alice, "users/new-user"), {
        uid: "new-user",
        email: "new-user@example.test",
      }),
    );
  });

  test("organization authority is exact-active and private workspace state is callable-only", async () => {
    await seed({
      "orgs/active-org": { id: "active-org", status: "active" },
      "orgMembers/active-org_active-user": {
        orgId: "active-org", uid: "active-user", role: "owner", status: "active",
      },
      "orgMembers/active-org_former-user": {
        orgId: "active-org", uid: "former-user", role: "admin", status: "former",
      },
      "orgMembers/active-org_legacy-user": {
        orgId: "active-org", uid: "legacy-user", role: "member", status: null,
      },
      "exchangeMemberships/active-org": {
        organizationId: "active-org", tier: "free", status: "active",
      },
      "publicOrganizations/approved-org": {
        id: "approved-org", status: "active", publicationApproved: true,
      },
      "publicOrganizations/unapproved-org": {
        id: "unapproved-org", status: "active", publicationApproved: false,
      },
      "exchangeWorkspacePreferences/active-user": {
        uid: "active-user", actorOrganizationId: "active-org",
      },
      "exchangeSavedOrganizations/saved-one": {
        actorOrganizationId: "active-org", organizationId: "approved-org",
      },
      "organizationContactRequests/contact-one": {
        actorOrganizationId: "active-org", subjectOrganizationId: "approved-org",
      },
      "organizationIntroductionRequests/intro-one": {
        actorOrganizationId: "active-org", subjectOrganizationId: "approved-org",
      },
    });

    const active = authenticated("active-user").firestore();
    const former = authenticated("former-user").firestore();
    const legacy = authenticated("legacy-user").firestore();
    const staff = authenticated("staff", { role: "staff" }).firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(active, "orgs/active-org")));
    await assertSucceeds(getDoc(doc(staff, "orgs/active-org")));
    await assertSucceeds(getDoc(doc(active, "exchangeMemberships/active-org")));
    await assertFails(getDoc(doc(former, "exchangeMemberships/active-org")));
    await assertFails(getDoc(doc(legacy, "exchangeMemberships/active-org")));
    await assertSucceeds(getDoc(doc(anonymous, "publicOrganizations/approved-org")));
    await assertFails(getDoc(doc(anonymous, "publicOrganizations/unapproved-org")));

    for (const path of [
      "exchangeWorkspacePreferences/active-user",
      "exchangeSavedOrganizations/saved-one",
      "organizationContactRequests/contact-one",
      "organizationIntroductionRequests/intro-one",
    ]) {
      await assertFails(getDoc(doc(active, path)));
      await assertFails(updateDoc(doc(active, path), { forged: true }));
    }
  });

  test("private profiles stay private and only published projections are discoverable", async () => {
    await seed({
      "profiles/alice": {
        uid: "alice",
        displayName: "Alice",
        privateEmail: "alice@example.test",
        verificationStatus: "verified",
      },
      "publicProfiles/alice": {
        uid: "alice",
        displayName: "Alice Public",
        published: true,
      },
      "publicProfiles/unpublished": {
        uid: "unpublished",
        displayName: "Not Listed",
        published: false,
      },
    });

    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const staff = authenticated("staff", { role: "staff" }).firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(alice, "profiles/alice")));
    await assertSucceeds(getDoc(doc(staff, "profiles/alice")));
    await assertFails(getDoc(doc(bob, "profiles/alice")));
    await assertFails(getDoc(doc(anonymous, "profiles/alice")));
    await assertFails(updateDoc(doc(alice, "profiles/alice"), { verified: true }));
    await assertFails(
      setDoc(doc(alice, "profiles/new-profile"), {
        uid: "new-profile",
        published: true,
      }),
    );

    await assertSucceeds(getDoc(doc(anonymous, "publicProfiles/alice")));
    await assertSucceeds(getDoc(doc(bob, "publicProfiles/alice")));
    await assertFails(getDoc(doc(anonymous, "publicProfiles/unpublished")));
    await assertFails(updateDoc(doc(alice, "publicProfiles/alice"), { displayName: "Forged" }));
    await assertSucceeds(
      getDocs(
        query(
          collection(anonymous, "publicProfiles"),
          where("published", "==", true),
        ),
      ),
    );
    await assertFails(getDocs(collection(anonymous, "publicProfiles")));
  });

  test("RFx discovery is approval-aware and all RFx and response writes are server-authoritative", async () => {
    await seed({
      "rfx/public-rfx": {
        ownerUid: "alice",
        createdBy: "alice",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: false,
        title: "Public opportunity",
      },
      "rfx/member-rfx": {
        ownerUid: "alice",
        createdBy: "alice",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: true,
        title: "Member opportunity",
      },
      "rfx/pending-rfx": {
        ownerUid: "alice",
        createdBy: "alice",
        status: "draft",
        adminApprovalStatus: "pending",
        memberOnly: false,
        title: "Pending opportunity",
      },
      "rfx/org-pending-rfx": {
        ownerUid: "alice",
        createdBy: "alice",
        orgId: "issuer-org",
        status: "draft",
        adminApprovalStatus: "pending",
        memberOnly: true,
        title: "Private organization opportunity",
      },
      "orgMembers/issuer-org_org-owner": {
        orgId: "issuer-org",
        uid: "org-owner",
        role: "owner",
      },
      "orgMembers/respondent-org_dave": {
        orgId: "respondent-org",
        uid: "dave",
        role: "member",
      },
      "rfxResponses/response-one": {
        rfxId: "public-rfx",
        rfxOwnerUid: "alice",
        respondentUid: "bob",
        respondentOrgId: "respondent-org",
        status: "submitted",
      },
      "rfxResponses/individual-response": {
        rfxId: "public-rfx",
        rfxOwnerUid: "alice",
        respondentUid: "bob",
        status: "submitted",
      },
      "rfxResponses/legacy-org-response": {
        rfxId: "public-rfx",
        rfxOwnerUid: "alice",
        respondentUid: "bob",
        orgId: "respondent-org",
        status: "submitted",
      },
      "rfxResponses/malformed-legacy-org-response": {
        rfxId: "public-rfx",
        rfxOwnerUid: "alice",
        respondentUid: "bob",
        orgId: null,
        status: "submitted",
      },
      "rfxResponses/mismatched-org-response": {
        rfxId: "public-rfx",
        rfxOwnerUid: "alice",
        respondentUid: "bob",
        respondentOrgId: "respondent-org",
        orgId: "different-org",
        status: "submitted",
      },
      "rfxResponses/org-response": {
        rfxId: "org-pending-rfx",
        rfxOwnerUid: "alice",
        respondentUid: "bob",
        status: "submitted",
      },
    });

    const anonymous = testEnv.unauthenticatedContext().firestore();
    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const dave = authenticated("dave").firestore();
    const outsider = authenticated("outsider").firestore();
    const staff = authenticated("staff", { role: "staff" }).firestore();
    const orgOwner = authenticated("org-owner").firestore();

    await assertSucceeds(getDoc(doc(anonymous, "rfx/public-rfx")));
    await assertFails(getDoc(doc(anonymous, "rfx/member-rfx")));
    await assertSucceeds(getDoc(doc(bob, "rfx/member-rfx")));
    await assertFails(getDoc(doc(outsider, "rfx/pending-rfx")));
    await assertSucceeds(getDoc(doc(alice, "rfx/pending-rfx")));
    await assertSucceeds(getDoc(doc(staff, "rfx/pending-rfx")));
    await assertFails(getDoc(doc(alice, "rfx/org-pending-rfx")));
    await assertSucceeds(getDoc(doc(orgOwner, "rfx/org-pending-rfx")));

    await assertSucceeds(
      getDocs(
        query(
          collection(anonymous, "rfx"),
          where("status", "==", "open"),
          where("adminApprovalStatus", "==", "approved"),
          where("memberOnly", "==", false),
        ),
      ),
    );
    await assertFails(getDocs(collection(anonymous, "rfx")));

    await assertFails(
      setDoc(doc(bob, "rfx/forged-rfx"), {
        ownerUid: "bob",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: false,
      }),
    );
    await assertFails(updateDoc(doc(alice, "rfx/public-rfx"), { status: "closed" }));

    await assertFails(getDoc(doc(bob, "rfxResponses/response-one")));
    await assertSucceeds(getDoc(doc(bob, "rfxResponses/individual-response")));
    await assertFails(getDoc(doc(bob, "rfxResponses/legacy-org-response")));
    await assertSucceeds(getDoc(doc(dave, "rfxResponses/legacy-org-response")));
    await assertFails(getDoc(doc(bob, "rfxResponses/malformed-legacy-org-response")));
    await assertFails(getDoc(doc(bob, "rfxResponses/mismatched-org-response")));
    await assertFails(getDoc(doc(dave, "rfxResponses/mismatched-org-response")));
    await assertSucceeds(getDoc(doc(alice, "rfxResponses/response-one")));
    await assertSucceeds(getDoc(doc(dave, "rfxResponses/response-one")));
    await assertSucceeds(getDoc(doc(staff, "rfxResponses/response-one")));
    await assertFails(getDoc(doc(outsider, "rfxResponses/response-one")));
    await assertFails(getDoc(doc(alice, "rfxResponses/org-response")));
    await assertSucceeds(getDoc(doc(orgOwner, "rfxResponses/org-response")));
    await assertFails(
      setDoc(doc(bob, "rfxResponses/forged-response"), {
        rfxId: "public-rfx",
        rfxOwnerUid: "alice",
        respondentUid: "bob",
        status: "accepted",
      }),
    );
    await assertFails(
      updateDoc(doc(bob, "rfxResponses/response-one"), { status: "accepted" }),
    );
    await assertFails(deleteDoc(doc(bob, "rfxResponses/response-one")));
  });

  test("Opportunity Discovery projections and account state remain callable-only", async () => {
    const alice = authenticated("alice").firestore();
    const admin = authenticated("admin", { role: "admin" }).firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();
    const protectedCollections = [
      "opportunityDiscovery",
      "opportunitySavedItems",
      "opportunityRecentViews",
      "opportunitySavedSearches",
      "opportunityRecentSearches",
      "rfxAddenda",
      "rfxAddendumAcknowledgments",
      "rfxQuestions",
      "opportunityNotificationJobs",
    ];

    await seed(Object.fromEntries(
      protectedCollections.map((collectionName) => [
        `${collectionName}/record`,
        { ownerUid: "alice", rfxId: "public-rfx", status: "active" },
      ]),
    ));

    for (const collectionName of protectedCollections) {
      const path = `${collectionName}/record`;
      await assertFails(getDoc(doc(anonymous, path)));
      await assertFails(getDoc(doc(alice, path)));
      await assertFails(getDoc(doc(admin, path)));
      await assertFails(setDoc(doc(alice, `${collectionName}/forged`), { ownerUid: "alice" }));
      await assertFails(updateDoc(doc(alice, path), { status: "forged" }));
      await assertFails(deleteDoc(doc(admin, path)));
    }
  });

  test("legacy and business referrals are visible only to individual or organization parties", async () => {
    await seed({
      "orgMembers/referrer-org_ref-org-user": {
        orgId: "referrer-org",
        uid: "ref-org-user",
        role: "member",
      },
      "orgMembers/referrer-org_alice": {
        orgId: "referrer-org",
        uid: "alice",
        role: "owner",
      },
      "orgMembers/recipient-org_rec-org-user": {
        orgId: "recipient-org",
        uid: "rec-org-user",
        role: "member",
      },
      "orgMembers/recipient-org_bob": {
        orgId: "recipient-org",
        uid: "bob",
        role: "member",
      },
      "referrals/legacy-business": {
        type: "business_intro",
        referrerUid: "alice",
        providerUid: "bob",
        referrerOrgId: "referrer-org",
        providerOrgId: "recipient-org",
        status: "sent",
      },
      "referrals/legacy-private-business": {
        type: "business_intro",
        referrerUid: "alice",
        providerUid: "bob",
        referrerOrgId: "referrer-org",
        providerOrgId: "recipient-org",
        clientName: "Private Contact",
        clientEmail: "private@example.test",
        consentStatus: "pending",
        status: "pending",
      },
      "referrals/legacy-consented-business": {
        type: "business_intro",
        referrerUid: "alice",
        providerUid: "bob",
        providerOrgId: "recipient-org",
        clientEmail: "consented@example.test",
        consentStatus: "confirmed",
        status: "pending",
      },
      "referrals/platform-invite": {
        type: "platform_invite",
        referrerUid: "alice",
        referredEmail: "invitee@example.test",
        status: "sent",
      },
      "referrals/untyped-platform-invite": {
        referrerUid: "alice",
        referredEmail: "invitee@example.test",
        status: "pending",
      },
      "referrals/untyped-mixed-referral": {
        referrerUid: "alice",
        providerUid: "provider",
        referredEmail: "invitee@example.test",
        status: "pending",
      },
      "businessReferrals/business-one": {
        referrerUid: "alice",
        recipientUid: "bob",
        referrerOrgId: "referrer-org",
        recipientOrgId: "recipient-org",
        assignedStaffUids: ["caseworker"],
        consentStatus: "pending",
        status: "sent",
      },
      "businessReferralDisputes/dispute-one": {
        id: "dispute-one",
        referralId: "business-one",
        openerUid: "bob",
        status: "open",
      },
    });

    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const refOrgUser = authenticated("ref-org-user").firestore();
    const recipientOrgUser = authenticated("rec-org-user").firestore();
    const caseworker = authenticated("caseworker", { role: "staff" }).firestore();
    const outsider = authenticated("outsider").firestore();
    const unassignedStaff = authenticated("staff", { role: "staff" }).firestore();
    const admin = authenticated("admin", { role: "admin" }).firestore();
    const verifiedInvitee = authenticated("invitee", {
      email: "invitee@example.test",
      email_verified: true,
    }).firestore();
    const unverifiedInvitee = authenticated("unverified-invitee", {
      email: "invitee@example.test",
      email_verified: false,
    }).firestore();

    for (const db of [alice, bob, refOrgUser, recipientOrgUser]) {
      await assertSucceeds(getDoc(doc(db, "referrals/legacy-business")));
    }
    for (const db of [alice, refOrgUser, admin]) {
      await assertSucceeds(getDoc(doc(db, "referrals/legacy-private-business")));
    }
    for (const db of [bob, recipientOrgUser, unassignedStaff, outsider]) {
      await assertFails(getDoc(doc(db, "referrals/legacy-private-business")));
    }
    for (const db of [alice, bob, recipientOrgUser, admin]) {
      await assertSucceeds(getDoc(doc(db, "referrals/legacy-consented-business")));
    }
    await assertFails(getDoc(doc(unassignedStaff, "referrals/legacy-business")));
    await assertFails(getDoc(doc(outsider, "referrals/legacy-business")));
    await assertSucceeds(getDoc(doc(verifiedInvitee, "referrals/platform-invite")));
    await assertSucceeds(getDoc(doc(verifiedInvitee, "referrals/untyped-platform-invite")));
    await assertFails(getDoc(doc(verifiedInvitee, "referrals/untyped-mixed-referral")));
    await assertSucceeds(getDoc(doc(unassignedStaff, "referrals/platform-invite")));
    await assertFails(getDoc(doc(unverifiedInvitee, "referrals/platform-invite")));

    for (const db of [alice, bob, refOrgUser, recipientOrgUser, caseworker, admin]) {
      await assertSucceeds(getDoc(doc(db, "businessReferrals/business-one")));
    }
    await assertFails(getDoc(doc(unassignedStaff, "businessReferrals/business-one")));
    await assertFails(getDoc(doc(outsider, "businessReferrals/business-one")));

    for (const db of [alice, bob, refOrgUser, recipientOrgUser, caseworker, admin]) {
      await assertSucceeds(getDoc(doc(db, "businessReferralDisputes/dispute-one")));
    }
    await assertFails(getDoc(doc(unassignedStaff, "businessReferralDisputes/dispute-one")));
    await assertFails(getDoc(doc(outsider, "businessReferralDisputes/dispute-one")));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        deleteDoc(doc(db, "orgMembers/referrer-org_alice")),
        deleteDoc(doc(db, "orgMembers/recipient-org_bob")),
      ]);
    });
    for (const formerMember of [alice, bob]) {
      await assertFails(getDoc(doc(formerMember, "referrals/legacy-business")));
      await assertFails(getDoc(doc(formerMember, "businessReferrals/business-one")));
      await assertFails(getDoc(doc(formerMember, "businessReferralDisputes/dispute-one")));
    }
    await assertSucceeds(getDoc(doc(refOrgUser, "referrals/legacy-business")));
    await assertSucceeds(getDoc(doc(recipientOrgUser, "referrals/legacy-business")));
    await assertSucceeds(getDoc(doc(refOrgUser, "businessReferrals/business-one")));
    await assertSucceeds(getDoc(doc(recipientOrgUser, "businessReferrals/business-one")));
    await assertFails(
      updateDoc(doc(bob, "businessReferralDisputes/dispute-one"), { status: "resolved" }),
    );

    await assertFails(
      setDoc(doc(alice, "referrals/forged"), {
        type: "business_intro",
        referrerUid: "alice",
      }),
    );
    await assertFails(
      updateDoc(doc(alice, "referrals/legacy-business"), { status: "paid" }),
    );
    await assertFails(
      setDoc(doc(alice, "businessReferrals/forged"), {
        referrerUid: "alice",
        recipientUid: "bob",
        status: "converted",
      }),
    );
    await assertFails(
      updateDoc(doc(bob, "businessReferrals/business-one"), { status: "converted" }),
    );
  });

  test("third-party referral contacts remain hidden until confirmed consent", async () => {
    await seed({
      "orgMembers/referrer-org_ref-org-user": {
        orgId: "referrer-org",
        uid: "ref-org-user",
        role: "member",
      },
      "orgMembers/referrer-org_alice": {
        orgId: "referrer-org",
        uid: "alice",
        role: "owner",
      },
      "orgMembers/recipient-org_rec-org-user": {
        orgId: "recipient-org",
        uid: "rec-org-user",
        role: "member",
      },
      "orgMembers/recipient-org_bob": {
        orgId: "recipient-org",
        uid: "bob",
        role: "member",
      },
      "businessReferrals/contact-referral": {
        referrerUid: "alice",
        recipientUid: "bob",
        referrerOrgId: "referrer-org",
        recipientOrgId: "recipient-org",
        assignedStaffUids: ["staff"],
        consentStatus: "pending",
        status: "sent",
      },
      "businessReferralContacts/contact-referral": {
        id: "contact-referral",
        referralId: "contact-referral",
        referrerUid: "alice",
        referrerOrgId: "referrer-org",
        recipientUid: "bob",
        recipientOrgId: "recipient-org",
        consentStatus: "pending",
        recipientDisclosureAllowed: false,
        name: "Private Prospect",
        email: "prospect@example.test",
        phone: "+15555550100",
      },
    });

    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const refOrgUser = authenticated("ref-org-user").firestore();
    const recipientOrgUser = authenticated("rec-org-user").firestore();
    const outsider = authenticated("outsider").firestore();
    const staff = authenticated("staff", { role: "staff" }).firestore();

    await assertSucceeds(getDoc(doc(alice, "businessReferralContacts/contact-referral")));
    await assertSucceeds(getDoc(doc(refOrgUser, "businessReferralContacts/contact-referral")));
    await assertSucceeds(getDoc(doc(staff, "businessReferralContacts/contact-referral")));
    await assertFails(getDoc(doc(bob, "businessReferralContacts/contact-referral")));
    await assertFails(getDoc(doc(recipientOrgUser, "businessReferralContacts/contact-referral")));
    await assertFails(getDoc(doc(outsider, "businessReferralContacts/contact-referral")));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        updateDoc(doc(db, "businessReferrals/contact-referral"), {
          consentStatus: "confirmed",
        }),
        updateDoc(doc(db, "businessReferralContacts/contact-referral"), {
          consentStatus: "confirmed",
          recipientDisclosureAllowed: true,
        }),
      ]);
    });

    await assertSucceeds(getDoc(doc(bob, "businessReferralContacts/contact-referral")));
    await assertSucceeds(getDoc(doc(recipientOrgUser, "businessReferralContacts/contact-referral")));
    await assertFails(getDoc(doc(outsider, "businessReferralContacts/contact-referral")));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        deleteDoc(doc(db, "orgMembers/referrer-org_alice")),
        deleteDoc(doc(db, "orgMembers/recipient-org_bob")),
      ]);
    });
    await assertFails(getDoc(doc(alice, "businessReferralContacts/contact-referral")));
    await assertFails(getDoc(doc(bob, "businessReferralContacts/contact-referral")));
    await assertSucceeds(getDoc(doc(refOrgUser, "businessReferralContacts/contact-referral")));
    await assertSucceeds(getDoc(doc(recipientOrgUser, "businessReferralContacts/contact-referral")));
    await assertFails(
      updateDoc(doc(alice, "businessReferralContacts/contact-referral"), {
        email: "forged@example.test",
      }),
    );
  });

  test("teams and invitations are private to exact participants and server-authoritative", async () => {
    await seed({
      "rfxTeams/team-one": {
        id: "team-one",
        rfxId: "public-rfx",
        primeUid: "alice",
        memberUids: ["alice", "bob", "charlie", "stale-array-member", "mismatched-guard"],
      },
      "rfxTeamMemberships/team-one/members/alice": {
        id: "alice", teamId: "team-one", rfxId: "public-rfx", uid: "alice", role: "prime",
      },
      "rfxTeamMemberships/team-one/members/bob": {
        id: "bob", teamId: "team-one", rfxId: "public-rfx", uid: "bob", role: "sub",
      },
      "rfxTeamMemberships/team-one/members/charlie": {
        id: "charlie", teamId: "team-one", rfxId: "public-rfx", uid: "charlie", role: "estimator",
      },
      "rfxTeamMemberships/team-one/members/mismatched-guard": {
        id: "someone-else",
        teamId: "team-one",
        rfxId: "public-rfx",
        uid: "someone-else",
        role: "sub",
      },
      "rfxTeamInvites/invite-one": {
        id: "invite-one",
        teamId: "team-one",
        rfxId: "public-rfx",
        inviterUid: "dave",
        inviteeUid: "erin",
        status: "pending",
      },
    });

    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const charlie = authenticated("charlie").firestore();
    const dave = authenticated("dave").firestore();
    const erin = authenticated("erin").firestore();
    const outsider = authenticated("outsider").firestore();
    const staleArrayMember = authenticated("stale-array-member").firestore();
    const mismatchedGuard = authenticated("mismatched-guard").firestore();
    const staff = authenticated("staff", { role: "staff" }).firestore();
    const admin = authenticated("admin", { role: "admin" }).firestore();

    await assertSucceeds(getDoc(doc(alice, "rfxTeams/team-one")));
    await assertSucceeds(getDoc(doc(bob, "rfxTeams/team-one")));
    await assertSucceeds(getDoc(doc(admin, "rfxTeams/team-one")));
    await assertFails(getDoc(doc(staff, "rfxTeams/team-one")));
    await assertFails(getDoc(doc(outsider, "rfxTeams/team-one")));
    await assertFails(getDoc(doc(staleArrayMember, "rfxTeams/team-one")));
    await assertFails(getDoc(doc(mismatchedGuard, "rfxTeams/team-one")));
    // Dynamic guard existence cannot be proven safely for an arbitrary list;
    // team_listMine performs this list operation server-side.
    await assertFails(
      getDocs(query(collection(bob, "rfxTeams"), where("memberUids", "array-contains", "bob"))),
    );

    for (const db of [dave, erin, charlie, staff]) {
      await assertSucceeds(getDoc(doc(db, "rfxTeamInvites/invite-one")));
    }
    await assertFails(getDoc(doc(outsider, "rfxTeamInvites/invite-one")));

    await assertFails(
      setDoc(doc(alice, "rfxTeams/forged-team"), {
        id: "forged-team",
        primeUid: "alice",
        memberUids: ["alice"],
      }),
    );
    await assertFails(
      updateDoc(doc(alice, "rfxTeams/team-one"), { memberUids: ["alice"] }),
    );
    await assertFails(
      setDoc(doc(outsider, "rfxTeamMemberships/team-one/members/outsider"), {
        id: "outsider",
        teamId: "team-one",
        rfxId: "public-rfx",
        uid: "outsider",
        role: "sub",
      }),
    );
    await assertFails(
      setDoc(doc(dave, "rfxTeamInvites/forged-invite"), {
        teamId: "team-one",
        inviterUid: "dave",
        inviteeUid: "outsider",
      }),
    );
    await assertFails(
      updateDoc(doc(erin, "rfxTeamInvites/invite-one"), { status: "accepted" }),
    );
  });

  test("saved Exchange items require deterministic IDs and exact ownership", async () => {
    await seed({
      "rfx/public-rfx": {
        ownerUid: "owner",
        createdBy: "owner",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: false,
      },
    });

    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const savedId = "alice_rfx_public-rfx";
    const saved = {
      id: savedId,
      uid: "alice",
      entityType: "rfx",
      entityId: "public-rfx",
      createdAt: "client-time",
    };

    await assertSucceeds(setDoc(doc(alice, `savedExchangeItems/${savedId}`), saved));
    await assertSucceeds(getDoc(doc(alice, `savedExchangeItems/${savedId}`)));
    await assertFails(getDoc(doc(bob, `savedExchangeItems/${savedId}`)));
    await assertFails(
      setDoc(doc(alice, "savedExchangeItems/wrong-id"), {
        ...saved,
        id: "wrong-id",
      }),
    );
    await assertFails(
      setDoc(doc(alice, "savedExchangeItems/bob_rfx_public-rfx"), {
        ...saved,
        id: "bob_rfx_public-rfx",
        uid: "bob",
      }),
    );
    await assertFails(
      setDoc(doc(alice, "savedExchangeItems/alice_rfx_public-rfx_extra"), {
        ...saved,
        id: "alice_rfx_public-rfx_extra",
        internalScore: 100,
      }),
    );
    await assertFails(updateDoc(doc(alice, `savedExchangeItems/${savedId}`), { entityId: "other" }));
    await assertFails(deleteDoc(doc(bob, `savedExchangeItems/${savedId}`)));
    await assertSucceeds(deleteDoc(doc(alice, `savedExchangeItems/${savedId}`)));
  });

  test("verification documents, flags, and audit records are owner/staff private and immutable", async () => {
    await seed({
      "verificationDocuments/document-one": {
        uid: "alice",
        storagePath: "verificationDocs/alice/license/proof.pdf",
        status: "pending",
      },
      "verificationAuditLog/audit-one": {
        uid: "alice",
        action: "submitted",
      },
      "verificationFlags/flag-one": {
        uid: "alice",
        reason: "manual_review",
      },
    });

    const alice = authenticated("alice").firestore();
    const bob = authenticated("bob").firestore();
    const staff = authenticated("staff", { role: "staff" }).firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();
    const paths = [
      "verificationDocuments/document-one",
      "verificationAuditLog/audit-one",
    ];

    for (const path of paths) {
      await assertSucceeds(getDoc(doc(alice, path)));
      await assertSucceeds(getDoc(doc(staff, path)));
      await assertFails(getDoc(doc(bob, path)));
      await assertFails(getDoc(doc(anonymous, path)));
      await assertFails(updateDoc(doc(alice, path), { uid: "alice", forged: true }));
      await assertFails(deleteDoc(doc(alice, path)));
    }

    await assertSucceeds(getDoc(doc(staff, "verificationFlags/flag-one")));
    await assertFails(getDoc(doc(alice, "verificationFlags/flag-one")));
    await assertFails(getDoc(doc(bob, "verificationFlags/flag-one")));
    await assertFails(getDoc(doc(anonymous, "verificationFlags/flag-one")));
    await assertFails(updateDoc(doc(alice, "verificationFlags/flag-one"), { forged: true }));

    await assertFails(
      setDoc(doc(alice, "verificationDocuments/forged"), {
        uid: "alice",
        status: "verified",
      }),
    );
  });

  test("Run 3 commerce, timeline, relationship, risk, and analytics records are callable-only", async () => {
    const records: Record<string, DocumentData> = {
      "referralServiceOffers/offer-one": { id: "offer-one", providerUid: "alice", status: "published" },
      "referralTransactionReports/report-one": { id: "report-one", referralId: "referral-one" },
      "businessReferralTimeline/event-one": { id: "event-one", referralId: "referral-one" },
      "referralRelationshipInsights/pair-one": {
        id: "pair-one",
        participantSubjectKeys: ["uid:alice", "uid:bob"],
      },
      "referralAnalyticsSnapshots/snapshot-one": {
        id: "snapshot-one",
        scopeType: "organization",
        scopeId: "org-one",
      },
      "referralRiskSignals/signal-one": { id: "signal-one", status: "open" },
      "referralDuplicateFingerprints/fingerprint-one": { id: "fingerprint-one", keyVersion: 1 },
      "platformConfiguration/referralCommerce": {
        platformFeeBasisPoints: 100,
        version: 1,
        commerceEnabled: true,
        settlementEnabled: false,
      },
    };
    await seed(records);

    const member = authenticated("alice").firestore();
    const admin = authenticated("admin", { role: "admin" }).firestore();
    for (const path of Object.keys(records)) {
      await assertFails(getDoc(doc(member, path)));
      await assertFails(getDoc(doc(admin, path)));
      await assertFails(updateDoc(doc(member, path), { forged: true }));
      await assertFails(deleteDoc(doc(admin, path)));
    }

    await assertFails(setDoc(doc(member, "businessReferralTimeline/forged"), {
      id: "forged",
      referralId: "referral-one",
      eventType: "transaction_confirmed",
    }));
    await assertFails(setDoc(doc(admin, "platformConfiguration/forged"), {
      platformFeeBasisPoints: 0,
      settlementEnabled: true,
    }));
  });
});
