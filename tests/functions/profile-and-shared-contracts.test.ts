import { describe, expect, it } from "vitest";
import {
  businessReferralContactDocSchema,
  businessReferralDocSchema,
  businessReferralDisputeDocSchema,
  legacyReferralDisputeDocSchema,
  profileAssetStoragePathBelongsToUid,
  profileDocSchema,
  rfxTeamInviteDocSchema,
  uploadedDocumentSchema,
} from "../../packages/shared/src";
import {
  getInvalidProfileAssetStoragePathFields,
  profileUpdateInputSchema,
  sanitizePublicProfile,
} from "../../apps/functions/src/exchange/publicProfiles";
import { businessReferralProgressInputSchema } from "../../apps/functions/src/exchange/contracts";

describe("profile URL and public-projection contracts", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.test/profile",
  ])("rejects non-HTTP profile links: %s", (unsafeUrl) => {
    expect(profileUpdateInputSchema.safeParse({ expectedVersion: 0, published: true, website: unsafeUrl }).success)
      .toBe(false);
    expect(profileUpdateInputSchema.safeParse({ expectedVersion: 0, published: true, linkedin: unsafeUrl }).success)
      .toBe(false);
    expect(profileDocSchema.safeParse({ uid: "profile-one", website: unsafeUrl, createdAt: 1 }).success)
      .toBe(false);
  });

  it("accepts HTTP(S) profile links and trims callable input", () => {
    const result = profileUpdateInputSchema.safeParse({
      expectedVersion: 0,
      published: true,
      website: " https://example.test/profile ",
      linkedin: "http://www.linkedin.com/in/example",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.website).toBe("https://example.test/profile");
  });

  it("keeps callable and persisted canonical asset-path contracts aligned", () => {
    const assets = {
      capabilityStatementStoragePath:
        "capabilityStatements/profile-one/capability.pdf",
      photoStoragePath: "profilePhotos/profile-one/photo.png",
      videoIntroStoragePath: "profileVideos/profile-one/raw/intro.mp4",
      videoIntroPosterStoragePath:
        "profileVideos/profile-one/posters/intro.png",
    };

    expect(profileUpdateInputSchema.safeParse({ expectedVersion: 0, published: false, ...assets }).success)
      .toBe(true);
    expect(profileDocSchema.safeParse({
      uid: "profile-one",
      createdAt: 1,
      ...assets,
    }).success).toBe(true);
    expect(profileUpdateInputSchema.safeParse({
      expectedVersion: 0,
      published: false,
      photoStoragePath: "profilePhotos/profile-one/history/old.png",
    }).success).toBe(false);
  });

  it("projects only allowlisted top-level and nested profile fields", () => {
    const projected = sanitizePublicProfile("canonical-uid", {
      uid: "spoofed-uid",
      published: true,
      businessName: "Safe Business",
      website: "javascript:alert(1)",
      linkedin: "https://www.linkedin.com/company/safe-business",
      badges: ["verified_business", { privateBadgePayload: true }],
      trustStats: {
        referralsConverted: 4,
        payoutsOnTimeRate: Number.POSITIVE_INFINITY,
        privateInternalScore: 999,
      },
      enrichmentData: { secret: true },
      verificationReviewedBy: "private-reviewer",
      email: "private@example.test",
      createdAt: 1,
    });

    expect(projected).toEqual({
      uid: "canonical-uid",
      published: true,
      businessName: "Safe Business",
      linkedin: "https://www.linkedin.com/company/safe-business",
      badges: ["verified_business"],
      trustStats: { referralsConverted: 4 },
      createdAt: 1,
    });
  });

  it("projects exact canonical assets without also publishing legacy bearer URLs", () => {
    const projected = sanitizePublicProfile("canonical-uid", {
      uid: "canonical-uid",
      published: true,
      photoStoragePath: "profilePhotos/canonical-uid/selected.png",
      photoUrl: "https://firebasestorage.googleapis.com/legacy-photo-token",
      capabilityStatementStoragePath:
        "capabilityStatements/canonical-uid/selected.pdf",
      capabilityStatementUrl:
        "https://firebasestorage.googleapis.com/legacy-capability-token",
      videoIntroStoragePath: "profileVideos/canonical-uid/processed/selected.mp4",
      videoIntroPosterStoragePath:
        "profilePhotos/canonical-uid/selected.png",
      createdAt: 1,
    });

    expect(projected).toMatchObject({
      uid: "canonical-uid",
      published: true,
      photoStoragePath: "profilePhotos/canonical-uid/selected.png",
      capabilityStatementStoragePath:
        "capabilityStatements/canonical-uid/selected.pdf",
      videoIntroStoragePath: "profileVideos/canonical-uid/processed/selected.mp4",
      videoIntroPosterStoragePath:
        "profilePhotos/canonical-uid/selected.png",
    });
    expect(projected).not.toHaveProperty("photoUrl");
    expect(projected).not.toHaveProperty("capabilityStatementUrl");

    const rawVideoProjection = sanitizePublicProfile("canonical-uid", {
      videoIntroStoragePath: "profileVideos/canonical-uid/raw/unprocessed.mp4",
    });
    expect(rawVideoProjection).not.toHaveProperty("videoIntroStoragePath");
  });

  it("rejects cross-account canonical paths and drops them from public projections", () => {
    const forgedPath = "profilePhotos/another-user/forged.png";
    expect(profileUpdateInputSchema.safeParse({
      expectedVersion: 0,
      published: true,
      photoStoragePath: forgedPath,
    }).success).toBe(true);
    expect(profileAssetStoragePathBelongsToUid(
      "photoStoragePath",
      forgedPath,
      "canonical-uid",
    )).toBe(false);
    expect(getInvalidProfileAssetStoragePathFields("canonical-uid", {
      photoStoragePath: forgedPath,
    })).toEqual(["photoStoragePath"]);

    const projected = sanitizePublicProfile("canonical-uid", {
      photoStoragePath: forgedPath,
      photoUrl: "https://example.test/legacy-compatible-photo.png",
    });
    expect(projected).not.toHaveProperty("photoStoragePath");
    expect(projected.photoUrl).toBe(
      "https://example.test/legacy-compatible-photo.png",
    );
    expect(profileDocSchema.safeParse({
      uid: "canonical-uid",
      photoStoragePath: forgedPath,
      createdAt: 1,
    }).success).toBe(false);
  });

  it("requires optimistic concurrency and preserves explicit clear semantics", () => {
    expect(profileUpdateInputSchema.safeParse({ published: false }).success).toBe(false);
    const clear = profileUpdateInputSchema.safeParse({
      expectedVersion: 4,
      published: false,
      bio: null,
      website: null,
      certifications: [],
    });
    expect(clear.success).toBe(true);
  });
});

describe("persisted Exchange shared contracts", () => {
  it("binds terminal business-referral status to a consistent outcome", () => {
    const base = { referralId: "referral-one", expectedVersion: 3 };
    expect(businessReferralProgressInputSchema.safeParse({
      ...base,
      status: "converted",
      outcome: { type: "not_a_fit" },
    }).success).toBe(false);
    expect(businessReferralProgressInputSchema.safeParse({
      ...base,
      status: "closed",
      outcome: { type: "converted" },
    }).success).toBe(false);
    expect(businessReferralProgressInputSchema.safeParse({
      ...base,
      status: "converted",
      outcome: { type: "converted" },
    }).success).toBe(true);
  });

  it("round-trips business-referral lifecycle, consent, and dispute state", () => {
    const persisted = {
      id: "referral-lifecycle",
      schemaVersion: 1 as const,
      referrerUid: "referrer",
      recipientUid: "recipient",
      assignedStaffUids: ["caseworker"],
      referralType: "business_lead" as const,
      title: "Qualified introduction",
      needSummary: "A business needs a vetted service provider.",
      consentStatus: "withdrawn" as const,
      consentConfirmedAt: 2,
      consentConfirmedByUid: "referrer",
      consentWithdrawnAt: 8,
      consentWithdrawnByUid: "referrer",
      status: "withdrawn" as const,
      compensationPolicy: { type: "fixed" as const, amountCents: 5000, status: "disputed" as const },
      compensationStatusBeforeDispute: "agreed" as const,
      activeDisputeId: "dispute-one",
      respondedAt: 4,
      respondedByUid: "recipient",
      recipientResponseNote: "Accepted before consent was withdrawn.",
      acceptedAt: 4,
      withdrawnAt: 8,
      withdrawnByUid: "referrer",
      version: 5,
      createdAt: 1,
      updatedAt: 8,
    };
    expect(businessReferralDocSchema.parse(persisted)).toEqual(persisted);
  });

  it("accepts the consent-aware business-referral contact shape", () => {
    expect(businessReferralContactDocSchema.safeParse({
      id: "referral-one",
      referralId: "referral-one",
      type: "business",
      companyName: "Referred Co",
      email: "contact@example.test",
      createdByUid: "referrer",
      referrerUid: "referrer",
      referrerOrgId: "referrer-org",
      recipientOrgId: "recipient-org",
      consentStatus: "unknown_legacy",
      recipientDisclosureAllowed: false,
      legacyReferralId: "legacy-one",
      createdAt: 1,
      updatedAt: 2,
    }).success).toBe(true);
  });

  it("distinguishes business-referral disputes from legacy dispute documents", () => {
    const businessDispute = {
      id: "dispute-one",
      referralId: "referral-one",
      openerUid: "referrer",
      referrerUid: "referrer",
      recipientUid: null,
      referrerOrgId: "referrer-org",
      recipientOrgId: "recipient-org",
      assignedStaffUids: ["staff-one"],
      reason: "The referral outcome is disputed.",
      evidenceStoragePaths: ["businessReferralDisputeEvidence/referral-one/referrer/proof.pdf"],
      status: "resolved_agreement",
      resolutionNote: "Parties agreed on an outcome.",
      resolvedAt: 3,
      resolvedByUid: "staff-one",
      createdAt: 1,
      updatedAt: 3,
    };
    expect(businessReferralDisputeDocSchema.safeParse(businessDispute).success).toBe(true);

    const legacyDispute = {
      id: "legacy-dispute",
      referralId: "legacy-referral",
      openerUid: "referrer",
      reason: "Legacy payout dispute",
      evidenceUrls: ["https://example.test/evidence.pdf"],
      status: "resolved_upheld",
      createdAt: 1,
    };
    expect(legacyReferralDisputeDocSchema.safeParse(legacyDispute).success).toBe(true);
    expect(businessReferralDisputeDocSchema.safeParse(legacyDispute).success).toBe(false);
  });

  it("matches optional RFx requested-document links and team revoke fields", () => {
    expect(uploadedDocumentSchema.safeParse({
      label: "Supplemental document",
      storagePath: "rfxResponses/rfx-one/member-one/supplement.pdf",
      fileName: "supplement.pdf",
    }).success).toBe(true);

    const invite = rfxTeamInviteDocSchema.parse({
      id: "invite-one",
      teamId: "team-one",
      rfxId: "rfx-one",
      inviterUid: "prime-one",
      inviteeUid: "member-one",
      role: "sub",
      status: "revoked",
      createdAt: 1,
      expiresAt: 10,
      revokedAt: 2,
      revokedByUid: "prime-one",
      revokeReason: "Team requirements changed",
    });
    expect(invite.revokeReason).toBe("Team requirements changed");
  });
});
