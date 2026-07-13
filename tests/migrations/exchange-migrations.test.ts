import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-hi-coworking";

let admin: typeof import("firebase-admin");
let assessLegacyReferrals: typeof import("../../apps/functions/src/scripts/assessLegacyReferrals").assessLegacyReferrals;
let backfillTeamInvitationTeamIds: typeof import("../../apps/functions/src/scripts/backfillTeamInvitationTeamIds").backfillTeamInvitationTeamIds;
let backfillTeamMemberships: typeof import("../../apps/functions/src/scripts/backfillTeamMemberships").backfillTeamMemberships;
let backfillPublicProfiles: typeof import("../../apps/functions/src/scripts/backfillPublicProfiles").backfillPublicProfiles;

async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is required");
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Failed to clear Firestore emulator: ${response.status}`);
}

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
  admin = await import("firebase-admin");
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  ({ assessLegacyReferrals } = await import(
    "../../apps/functions/src/scripts/assessLegacyReferrals"
  ));
  ({ backfillTeamInvitationTeamIds } = await import(
    "../../apps/functions/src/scripts/backfillTeamInvitationTeamIds"
  ));
  ({ backfillTeamMemberships } = await import(
    "../../apps/functions/src/scripts/backfillTeamMemberships"
  ));
  ({ backfillPublicProfiles } = await import(
    "../../apps/functions/src/scripts/backfillPublicProfiles"
  ));
});

beforeEach(clearFirestore);

describe("legacy referral assessment", () => {
  it("classifies mixed legacy data without changing any record in dry-run mode", async () => {
    const db = admin.firestore();
    await Promise.all([
      db.collection("referrals").doc("platform").set({
        id: "platform",
        type: "platform_invite",
        referrerUid: "referrer",
        referredEmail: "invitee@example.test",
        status: "pending",
        createdAt: 1,
      }),
      db.collection("referrals").doc("business").set({
        id: "business",
        type: "business_intro",
        referrerUid: "referrer",
        providerUid: "provider",
        clientEmail: "customer@example.test",
        status: "accepted",
        createdAt: 2,
      }),
      db.collection("referrals").doc("mixed").set({
        id: "mixed",
        type: "business_intro",
        referrerUid: "referrer",
        providerUid: "provider",
        referredEmail: "invitee@example.test",
        status: "pending",
        createdAt: 3,
      }),
      db.collection("referrals").doc("invalid").set({
        id: "invalid",
        type: "business_intro",
        status: "pending",
        createdAt: 4,
      }),
      db.collection("referrals").doc("untyped-platform").set({
        id: "untyped-platform",
        referrerUid: "referrer",
        invitedEmail: "legacy-invitee@example.test",
        status: "pending",
        createdAt: 5,
      }),
      db.collection("referrals").doc("untyped-business").set({
        id: "untyped-business",
        referrerUid: "referrer",
        providerUid: "provider",
        clientEmail: "legacy-customer@example.test",
        status: "accepted",
        createdAt: 6,
      }),
    ]);

    const report = await assessLegacyReferrals({ limit: 20, pageSize: 2 });
    expect(report).toMatchObject({
      dryRun: true,
      totalScanned: 6,
      platformInvite: 2,
      businessIntro: 2,
      inferredPlatformInvite: 1,
      inferredBusinessIntro: 1,
      ambiguous: 1,
      invalid: 1,
      eligibleForCopy: 2,
      copied: 0,
    });
    expect((await db.collection("businessReferrals").get()).empty).toBe(true);
    expect((await db.collection("referrals").get()).size).toBe(6);
  });

  it("copies only unambiguous business introductions with unknown legacy consent", async () => {
    const db = admin.firestore();
    await db.collection("referrals").doc("legacy-business").set({
      id: "legacy-business",
      type: "business_intro",
      referrerUid: "referrer",
      providerUid: "provider",
      clientName: "Private Customer",
      clientEmail: "private@example.test",
      status: "accepted",
      createdAt: 10,
      acceptedAt: 20,
      policySnapshot: { amountCents: 5000 },
    });

    const report = await assessLegacyReferrals({
      apply: true,
      confirmProject: PROJECT_ID,
    });
    expect(report).toMatchObject({ copied: 1, failed: 0, dryRun: false });

    const referral = (await db.collection("businessReferrals").doc("legacy_legacy-business").get()).data();
    expect(referral).toMatchObject({
      legacyReferralId: "legacy-business",
      consentStatus: "unknown_legacy",
      status: "accepted",
      compensationPolicy: { type: "none", status: "none" },
      legacyCompensationReviewRequired: true,
    });
    expect(referral).not.toHaveProperty("clientEmail");

    const contact = (await db.collection("businessReferralContacts").doc("legacy_legacy-business").get()).data();
    expect(contact).toMatchObject({
      email: "private@example.test",
      consentStatus: "unknown_legacy",
      recipientDisclosureAllowed: false,
    });
    expect((await db.collection("referrals").doc("legacy-business").get()).exists).toBe(true);

    const replay = await assessLegacyReferrals({
      apply: true,
      confirmProject: PROJECT_ID,
    });
    expect(replay).toMatchObject({ copied: 0, alreadyMapped: 1, failed: 0 });
  });

  it("requires an exact project confirmation before applying", async () => {
    await expect(
      assessLegacyReferrals({ apply: true, confirmProject: "wrong-project" }),
    ).rejects.toThrow(`--confirm-project=${PROJECT_ID}`);
  });
});

describe("team invitation teamId backfill", () => {
  it("reports valid, resolvable, ambiguous, missing, and invalid invitations without writes", async () => {
    const db = admin.firestore();
    await Promise.all([
      db.collection("rfx").doc("rfx-valid").set({ id: "rfx-valid" }),
      db.collection("rfx").doc("rfx-resolve").set({ id: "rfx-resolve" }),
      db.collection("rfx").doc("rfx-ambiguous").set({ id: "rfx-ambiguous" }),
      db.collection("rfxTeams").doc("team-valid").set({
        id: "team-valid", rfxId: "rfx-valid", primeUid: "prime-valid", members: [], memberUids: [],
      }),
      db.collection("rfxTeams").doc("team-resolve").set({
        id: "team-resolve", rfxId: "rfx-resolve", primeUid: "prime-resolve", members: [], memberUids: [],
      }),
      db.collection("rfxTeams").doc("team-ambiguous-a").set({
        id: "team-ambiguous-a", rfxId: "rfx-ambiguous", primeUid: "prime-ambiguous", members: [], memberUids: [],
      }),
      db.collection("rfxTeams").doc("team-ambiguous-b").set({
        id: "team-ambiguous-b", rfxId: "rfx-ambiguous", primeUid: "prime-ambiguous", members: [], memberUids: [],
      }),
    ]);
    await Promise.all([
      db.collection("rfxTeamInvites").doc("already").set({
        id: "already", teamId: "team-valid", rfxId: "rfx-valid", inviterUid: "prime-valid",
        inviteeUid: "one", role: "sub", status: "pending",
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10_000),
      }),
      db.collection("rfxTeamInvites").doc("resolve").set({
        id: "resolve", rfxId: "rfx-resolve", inviterUid: "prime-resolve",
        inviteeUid: "two", role: "estimator", status: "pending", expiresAt: Date.now() + 10_000,
      }),
      db.collection("rfxTeamInvites").doc("ambiguous").set({
        id: "ambiguous", rfxId: "rfx-ambiguous", inviterUid: "prime-ambiguous",
        inviteeUid: "three", role: "sub", status: "pending",
      }),
      db.collection("rfxTeamInvites").doc("missing").set({
        id: "missing", rfxId: "rfx-valid", inviterUid: "other-prime",
        inviteeUid: "four", role: "sub", status: "pending",
      }),
      db.collection("rfxTeamInvites").doc("invalid").set({
        id: "invalid", rfxId: "rfx-does-not-exist", inviterUid: "prime",
        inviteeUid: "five", role: "sub", status: "pending",
      }),
    ]);

    const report = await backfillTeamInvitationTeamIds({
      projectId: PROJECT_ID,
      limit: 20,
      pageSize: 2,
    });
    expect(report).toMatchObject({
      dryRun: true,
      totalScanned: 5,
      alreadyValid: 1,
      resolved: 1,
      ambiguous: 1,
      missingTeam: 1,
      invalidRfx: 1,
      updatesApplied: 0,
      failedUpdates: 0,
      reviewRecordsApplied: 0,
      failedReviewWrites: 0,
      timestampExpiryValues: 1,
      expiryNormalizationsApplied: 0,
      failedExpiryNormalizations: 0,
    });
    expect(report.reviewRequiredInviteIds).toEqual(["ambiguous", "invalid", "missing"]);
    expect((await db.collection("rfxTeamInvites").doc("resolve").get()).data()).not.toHaveProperty("teamId");
    expect((await db.collection("rfxTeamInviteReviews").get()).empty).toBe(true);
  });

  it("persists ambiguous legacy invitations for administrative review and is safe to repeat", async () => {
    const db = admin.firestore();
    await db.collection("rfx").doc("rfx-ambiguous").set({ id: "rfx-ambiguous" });
    await Promise.all([
      db.collection("rfxTeams").doc("team-a").set({
        id: "team-a", rfxId: "rfx-ambiguous", primeUid: "prime", members: [], memberUids: [],
      }),
      db.collection("rfxTeams").doc("team-b").set({
        id: "team-b", rfxId: "rfx-ambiguous", primeUid: "prime", members: [], memberUids: [],
      }),
    ]);
    await db.collection("rfxTeamInvites").doc("needs-review").set({
      id: "needs-review",
      rfxId: "rfx-ambiguous",
      inviterUid: "prime",
      inviteeUid: "invitee",
      role: "sub",
      status: "pending",
    });

    const applied = await backfillTeamInvitationTeamIds({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(applied).toMatchObject({
      ambiguous: 1,
      reviewRecordsApplied: 1,
      reviewRecordsAlreadyPresent: 0,
      failedReviewWrites: 0,
    });
    expect((await db.collection("rfxTeamInviteReviews").doc("needs-review").get()).data())
      .toMatchObject({
        inviteId: "needs-review",
        status: "needs_admin_review",
        reason: "ambiguous_legacy_linkage",
        candidateTeamIds: ["team-a", "team-b"],
        reportedByUid: "system:team-invitation-backfill",
      });

    const replay = await backfillTeamInvitationTeamIds({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(replay).toMatchObject({
      reviewRecordsApplied: 0,
      reviewRecordsAlreadyPresent: 1,
      failedReviewWrites: 0,
    });
  });

  it("applies only an exact unambiguous resolution and is safe to repeat", async () => {
    const db = admin.firestore();
    await db.collection("rfx").doc("rfx-one").set({ id: "rfx-one" });
    await db.collection("rfxTeams").doc("team-one").set({
      id: "team-one",
      rfxId: "rfx-one",
      primeUid: "prime-one",
      members: [],
      memberUids: [],
    });
    const legacyTimestampExpiry = Date.now() + 10_000;
    await db.collection("rfxTeamInvites").doc("invite-one").set({
      id: "invite-one",
      rfxId: "rfx-one",
      inviterUid: "prime-one",
      inviteeUid: "invitee-one",
      role: "proposal_writer",
      status: "pending",
      expiresAt: admin.firestore.Timestamp.fromMillis(legacyTimestampExpiry),
      version: 0,
    });

    const applied = await backfillTeamInvitationTeamIds({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(applied).toMatchObject({
      resolved: 1,
      updatesApplied: 1,
      failedUpdates: 0,
      timestampExpiryValues: 1,
      expiryNormalizationsApplied: 1,
      failedExpiryNormalizations: 0,
    });
    expect((await db.collection("rfxTeamInvites").doc("invite-one").get()).data()).toMatchObject({
      teamId: "team-one",
      expiresAt: legacyTimestampExpiry,
      version: 2,
    });

    const replay = await backfillTeamInvitationTeamIds({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(replay).toMatchObject({
      alreadyValid: 1,
      updatesApplied: 0,
      failedUpdates: 0,
      timestampExpiryValues: 0,
      expiryNormalizationsApplied: 0,
    });
  });

  it("refuses apply mode without explicit matching project arguments", async () => {
    await expect(
      backfillTeamInvitationTeamIds({ apply: true }),
    ).rejects.toThrow("--apply requires an explicit --project");
    await expect(
      backfillTeamInvitationTeamIds({
        apply: true,
        projectId: PROJECT_ID,
        confirmProject: "wrong-project",
      }),
    ).rejects.toThrow(`--confirm-project=${PROJECT_ID}`);
  });
});

describe("authoritative team membership backfill", () => {
  async function seedMembershipFixtures(): Promise<void> {
    const db = admin.firestore();
    await Promise.all([
      db.collection("rfxTeams").doc("valid-team").set({
        id: "valid-team",
        rfxId: "rfx-valid",
        primeUid: "prime",
        members: [
          { uid: "prime", role: "prime", joinedAt: 1 },
          { uid: "member", role: "sub", joinedAt: 2 },
        ],
        memberUids: ["prime", "member"],
        status: "forming",
      }),
      db.collection("rfxTeams").doc("invalid-team").set({
        id: "invalid-team",
        rfxId: "rfx-invalid",
        primeUid: "other-prime",
        members: [{ uid: "other-prime", role: "prime", joinedAt: 1 }],
        memberUids: ["other-prime", "forged-array-member"],
        status: "forming",
      }),
      db.doc("rfxTeamMemberships/valid-team/members/prime").set({
        id: "prime",
        teamId: "valid-team",
        rfxId: "rfx-valid",
        uid: "prime",
        role: "sub",
      }),
      db.doc("rfxTeamMemberships/valid-team/members/stale-member").set({
        id: "stale-member",
        teamId: "valid-team",
        rfxId: "rfx-valid",
        uid: "stale-member",
        role: "sub",
      }),
      db.doc("rfxTeamMemberships/invalid-team/members/forged-array-member").set({
        id: "forged-array-member",
        teamId: "invalid-team",
        rfxId: "rfx-invalid",
        uid: "forged-array-member",
        role: "sub",
      }),
    ]);
  }

  it("reports exact parity failures and guard reconciliation without writes", async () => {
    await seedMembershipFixtures();
    const db = admin.firestore();
    const report = await backfillTeamMemberships({
      projectId: PROJECT_ID,
      pageSize: 1,
    });
    expect(report).toMatchObject({
      dryRun: true,
      totalScanned: 2,
      validTeams: 1,
      reviewTeams: 1,
      canonicalMembers: 2,
      missingOrInvalidGuards: 2,
      staleGuards: 2,
      wouldWriteGuards: 2,
      wouldDeleteGuards: 2,
      guardWritesApplied: 0,
      guardDeletesApplied: 0,
      reviewRecordsApplied: 0,
      failedTeams: 0,
    });
    expect(report.reviewRequiredTeamIds).toEqual(["invalid-team"]);
    expect((await db.doc("rfxTeamMemberships/valid-team/members/stale-member").get()).exists)
      .toBe(true);
    expect((await db.collection("rfxTeamMembershipReviews").get()).empty).toBe(true);
  });

  it("creates canonical guards, deletes stale authority, and persists review records idempotently", async () => {
    await seedMembershipFixtures();
    const db = admin.firestore();
    const applied = await backfillTeamMemberships({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(applied).toMatchObject({
      validTeams: 1,
      reviewTeams: 1,
      guardWritesApplied: 2,
      guardDeletesApplied: 2,
      reviewRecordsApplied: 1,
      failedTeams: 0,
    });
    expect((await db.doc("rfxTeamMemberships/valid-team/members/prime").get()).data())
      .toMatchObject({
        id: "prime",
        teamId: "valid-team",
        rfxId: "rfx-valid",
        uid: "prime",
        role: "prime",
      });
    expect((await db.doc("rfxTeamMemberships/valid-team/members/member").get()).data())
      .toMatchObject({ uid: "member", role: "sub" });
    expect((await db.doc("rfxTeamMemberships/valid-team/members/stale-member").get()).exists)
      .toBe(false);
    expect((await db.doc(
      "rfxTeamMemberships/invalid-team/members/forged-array-member",
    ).get()).exists).toBe(false);
    expect((await db.collection("rfxTeamMembershipReviews").doc("invalid-team").get()).data())
      .toMatchObject({
        id: "invalid-team",
        status: "needs_admin_review",
        reasons: ["member_uid_parity_mismatch"],
      });

    const replay = await backfillTeamMemberships({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(replay).toMatchObject({
      guardWritesApplied: 0,
      guardDeletesApplied: 0,
      reviewRecordsApplied: 0,
      reviewRecordsAlreadyPresent: 1,
      failedTeams: 0,
    });
  });

  it("requires exact project confirmation before applying membership guards", async () => {
    await expect(backfillTeamMemberships({ apply: true }))
      .rejects.toThrow("--apply requires an explicit --project");
    await expect(backfillTeamMemberships({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: "wrong-project",
    })).rejects.toThrow(`--confirm-project=${PROJECT_ID}`);
  });
});

describe("public profile projection backfill", () => {
  it("reports projection work without leaking or writing private fields in dry-run mode", async () => {
    const db = admin.firestore();
    await Promise.all([
      db.collection("profiles").doc("published").set({
        uid: "spoofed-uid",
        published: true,
        businessName: "Published Co",
        naicsCodes: ["541611"],
        verificationStatus: "verified",
        enrichmentData: { privateMatch: "secret" },
        attestationText: "private attestation",
        verificationRejectionReason: "private reviewer note",
        adminNotes: "private admin note",
        email: "private@example.test",
        createdAt: 1,
        updatedAt: 2,
      }),
      db.collection("profiles").doc("private").set({
        uid: "private",
        published: false,
        businessName: "Private Co",
      }),
      db.collection("publicProfiles").doc("orphan").set({
        uid: "orphan",
        published: true,
        businessName: "Stale Co",
      }),
    ]);

    const report = await backfillPublicProfiles({ projectId: PROJECT_ID });
    expect(report).toMatchObject({
      dryRun: true,
      total: 2,
      published: 1,
      private: 1,
      wouldCreate: 1,
      staleProjection: 1,
      wouldDelete: 1,
      updatesApplied: 0,
      deletesApplied: 0,
      failed: 0,
    });
    expect((await db.collection("publicProfiles").doc("published").get()).exists).toBe(false);
    expect((await db.collection("publicProfiles").doc("orphan").get()).exists).toBe(true);
  });

  it("creates sanitized projections, removes stale projections, and is idempotent", async () => {
    const db = admin.firestore();
    await db.collection("profiles").doc("published").set({
      uid: "wrong-uid",
      published: true,
      businessName: "Published Co",
      website: "https://example.test",
      verificationStatus: "verified",
      trustStats: { referralsConverted: 2, privateInternalScore: 999 },
      enrichmentData: { secret: true },
      verificationReviewedBy: "reviewer-private",
      email: "private@example.test",
      createdAt: 1,
      updatedAt: 2,
    });
    await db.collection("profiles").doc("private").set({
      uid: "private",
      published: false,
      businessName: "Private Co",
    });
    await Promise.all([
      db.collection("publicProfiles").doc("private").set({
        uid: "private", published: true, businessName: "Should disappear",
      }),
      db.collection("publicProfiles").doc("orphan").set({
        uid: "orphan", published: true, businessName: "Should disappear",
      }),
    ]);

    const applied = await backfillPublicProfiles({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(applied).toMatchObject({
      updatesApplied: 1,
      deletesApplied: 2,
      failed: 0,
    });
    const projected = (await db.collection("publicProfiles").doc("published").get()).data();
    expect(projected).toMatchObject({
      uid: "published",
      published: true,
      businessName: "Published Co",
      trustStats: { referralsConverted: 2 },
    });
    expect(projected).not.toHaveProperty("email");
    expect(projected).not.toHaveProperty("enrichmentData");
    expect(projected).not.toHaveProperty("verificationReviewedBy");
    expect((await db.collection("publicProfiles").doc("private").get()).exists).toBe(false);
    expect((await db.collection("publicProfiles").doc("orphan").get()).exists).toBe(false);

    const replay = await backfillPublicProfiles({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(replay).toMatchObject({
      alreadyCurrent: 1,
      updatesApplied: 0,
      deletesApplied: 0,
      failed: 0,
    });
  });

  it("requires explicit matching project confirmation for apply mode", async () => {
    await expect(backfillPublicProfiles({ apply: true })).rejects.toThrow(
      "--apply requires an explicit --project",
    );
    await expect(backfillPublicProfiles({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: "wrong-project",
    })).rejects.toThrow(`--confirm-project=${PROJECT_ID}`);
  });
});
