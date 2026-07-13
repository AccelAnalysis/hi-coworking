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
import { deleteDoc, doc, setDoc, type DocumentData } from "firebase/firestore";
import {
  deleteObject,
  getMetadata,
  ref,
  updateMetadata,
  uploadBytes,
  type UploadMetadata,
} from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

const PROJECT_ID = "demo-hi-coworking";
const PDF = new TextEncoder().encode("%PDF-1.4\n% emulator fixture");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

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

describe("Run 1 Storage authorization matrix", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        ...emulatorAddress("FIRESTORE_EMULATOR_HOST", 8081),
        rules: readFileSync(resolve("firestore.rules"), "utf8"),
      },
      storage: {
        ...emulatorAddress("FIREBASE_STORAGE_EMULATOR_HOST", 9199),
        rules: readFileSync(resolve("storage.rules"), "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await Promise.all([testEnv.clearFirestore(), testEnv.clearStorage()]);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  function authenticated(uid: string, overrides: TokenOptions = {}): RulesTestContext {
    return testEnv.authenticatedContext(uid, memberToken(uid, overrides));
  }

  async function seedFirestore(entries: Record<string, DocumentData>) {
    const expanded: Record<string, DocumentData> = { ...entries };
    for (const [path, data] of Object.entries(entries)) {
      if (path.startsWith("orgMembers/") && typeof data.orgId === "string") {
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

  async function seedFile(
    path: string,
    bytes: Uint8Array = PDF,
    metadata: UploadMetadata = { contentType: "application/pdf" },
  ) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), path), bytes, metadata);
    });
  }

  test("private RFx bytes deny every direct client read and write, even with a grant", async () => {
    const path = "rfxResponses/rfx-one/bob/proposal.pdf";
    const legacyProposalPath = "rfxProposals/rfx-one/bob/legacy.pdf";
    const legacyDocumentPath = "rfxDocuments/rfx-one/bob/legacy.pdf";
    await seedFirestore({
      "rfx/rfx-one": {
        ownerUid: "alice",
        createdBy: "alice",
        status: "open",
        adminApprovalStatus: "approved",
      },
      "rfxResponseUploadGrantScopes/rfx-one/uploadGrants/bob": {
        id: "bob",
        grantType: "rfx_response_upload",
        rfxId: "rfx-one",
        respondentUid: "bob",
        allowedStoragePaths: [path],
        expiresAt: Date.now() + 60_000,
      },
      "rfxResponseReadGrantScopes/rfx-one/readGrants/alice": {
        id: "alice",
        grantType: "rfx_response_read",
        rfxId: "rfx-one",
        accessorUid: "alice",
        allowedStoragePaths: [path, legacyProposalPath, legacyDocumentPath],
        expiresAt: Date.now() + 60_000,
      },
    });
    await Promise.all([
      seedFile(path),
      seedFile(legacyProposalPath),
      seedFile(legacyDocumentPath),
    ]);

    const bob = authenticated("bob").storage();
    const alice = authenticated("alice").storage();
    const staff = authenticated("staff", { role: "staff" }).storage();
    const admin = authenticated("admin", { role: "admin" }).storage();
    for (const storage of [bob, alice, staff, admin]) {
      await assertFails(getMetadata(ref(storage, path)));
      await assertFails(getMetadata(ref(storage, legacyProposalPath)));
      await assertFails(getMetadata(ref(storage, legacyDocumentPath)));
    }
    await assertFails(
      uploadBytes(ref(bob, path), PDF, { contentType: "application/pdf" }),
    );
    await assertFails(updateMetadata(ref(bob, path), { customMetadata: { tampered: "true" } }));
    await assertFails(deleteObject(ref(bob, path)));
    await assertSucceeds(deleteObject(ref(admin, path)));
  });

  test("published profiles expose only selected immutable assets and unpublish revokes anonymous rules access", async () => {
    const selectedPhotoPath = "profilePhotos/alice/photo.png";
    const siblingPhotoPath = "profilePhotos/alice/draft.png";
    const selectedCapabilityPath = "capabilityStatements/alice/capability.pdf";
    const siblingCapabilityPath = "capabilityStatements/alice/draft.pdf";
    const selectedVideoPath = "profileVideos/alice/processed/intro.mp4";
    const historicalVideoPath = "profileVideos/alice/raw/old-intro.mp4";
    await seedFirestore({
      "publicProfiles/alice": {
        uid: "alice",
        displayName: "Alice",
        published: true,
        photoStoragePath: selectedPhotoPath,
        capabilityStatementStoragePath: selectedCapabilityPath,
        videoIntroStoragePath: selectedVideoPath,
      },
    });
    await Promise.all([
      seedFile("profilePhotos/private-user/photo.png", PNG, { contentType: "image/png" }),
      seedFile(siblingPhotoPath, PNG, { contentType: "image/png" }),
      seedFile(siblingCapabilityPath),
      seedFile(historicalVideoPath, PNG, { contentType: "video/mp4" }),
      seedFile("profilePhotos/alice/history/old.png", PNG, { contentType: "image/png" }),
    ]);

    const alice = authenticated("alice").storage();
    const bob = authenticated("bob").storage();
    const staff = authenticated("staff", { role: "staff" }).storage();
    const anonymous = testEnv.unauthenticatedContext().storage();

    await assertSucceeds(
      uploadBytes(ref(alice, selectedPhotoPath), PNG, { contentType: "image/png" }),
    );
    await assertSucceeds(
      uploadBytes(ref(alice, selectedCapabilityPath), PDF, { contentType: "application/pdf" }),
    );
    await assertSucceeds(
      uploadBytes(ref(alice, selectedVideoPath), PNG, { contentType: "video/mp4" }),
    );
    await assertFails(
      uploadBytes(ref(bob, "profilePhotos/alice/forged.png"), PNG, {
        contentType: "image/png",
      }),
    );
    await assertFails(
      uploadBytes(ref(alice, "profilePhotos/alice/not-an-image.exe"), PNG, {
        contentType: "application/x-msdownload",
      }),
    );
    await assertFails(
      uploadBytes(ref(alice, "profilePhotos/alice/empty.png"), new Uint8Array(), {
        contentType: "image/png",
      }),
    );
    await assertFails(
      uploadBytes(ref(alice, "profilePhotos/alice/custom-metadata.png"), PNG, {
        contentType: "image/png",
        customMetadata: { publicCache: "true" },
      }),
    );
    await assertFails(
      uploadBytes(ref(alice, "profilePhotos/alice/unsafe-disposition.png"), PNG, {
        contentType: "image/png",
        contentDisposition: "inline; filename=unsafe.png",
      }),
    );
    await assertFails(
      uploadBytes(
        ref(alice, "profilePhotos/alice/too-large.png"),
        new Uint8Array(5 * 1024 * 1024 + 1),
        { contentType: "image/png" },
      ),
    );

    await assertSucceeds(getMetadata(ref(anonymous, selectedPhotoPath)));
    await assertSucceeds(getMetadata(ref(anonymous, selectedCapabilityPath)));
    await assertSucceeds(getMetadata(ref(anonymous, selectedVideoPath)));
    await assertFails(getMetadata(ref(anonymous, siblingPhotoPath)));
    await assertFails(getMetadata(ref(anonymous, siblingCapabilityPath)));
    await assertFails(getMetadata(ref(anonymous, historicalVideoPath)));
    await assertFails(getMetadata(ref(anonymous, "profilePhotos/alice/history/old.png")));
    await assertFails(
      getMetadata(ref(anonymous, "profilePhotos/private-user/photo.png")),
    );
    await assertSucceeds(getMetadata(ref(alice, siblingPhotoPath)));
    await assertSucceeds(getMetadata(ref(staff, siblingPhotoPath)));
    await assertFails(
      updateMetadata(ref(alice, selectedPhotoPath), { customMetadata: { replacement: "true" } }),
    );

    // Fail closed even if a malformed server-side projection names a raw
    // video as its selected asset.
    await seedFirestore({
      "publicProfiles/alice": {
        uid: "alice",
        published: true,
        videoIntroStoragePath: historicalVideoPath,
      },
    });
    await assertFails(getMetadata(ref(anonymous, historicalVideoPath)));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), "publicProfiles/alice"));
    });
    await assertFails(getMetadata(ref(anonymous, selectedPhotoPath)));
    await assertFails(getMetadata(ref(anonymous, selectedCapabilityPath)));
    await assertFails(getMetadata(ref(anonymous, selectedVideoPath)));
    await assertSucceeds(getMetadata(ref(alice, selectedPhotoPath)));
  });

  test("organization response grants do not reopen direct Storage access", async () => {
    const path = "rfxResponses/org-response-rfx/bob/proposal/response.pdf";
    await seedFirestore({
      "rfx/org-response-rfx": {
        ownerUid: "issuer",
        createdBy: "issuer",
        status: "open",
        adminApprovalStatus: "approved",
      },
      "orgMembers/respondent-org_bob": {
        orgId: "respondent-org",
        uid: "bob",
        role: "owner",
      },
      "orgMembers/respondent-org_carol": {
        orgId: "respondent-org",
        uid: "carol",
        role: "member",
      },
      "rfxResponseAccess/org-response-rfx/respondents/bob": {
        id: "bob",
        rfxId: "org-response-rfx",
        respondentUid: "bob",
        respondentOrgId: "respondent-org",
        responseId: "org-response",
        attachmentStoragePaths: [path],
      },
      "rfxResponseReadGrantScopes/org-response-rfx/readGrants/bob": {
        id: "bob",
        grantType: "rfx_response_read",
        rfxId: "org-response-rfx",
        accessorUid: "bob",
        allowedStoragePaths: [path],
        expiresAt: Date.now() + 60_000,
      },
      "rfxResponseReadGrantScopes/org-response-rfx/readGrants/carol": {
        id: "carol",
        grantType: "rfx_response_read",
        rfxId: "org-response-rfx",
        accessorUid: "carol",
        allowedStoragePaths: [path],
        expiresAt: Date.now() + 60_000,
      },
      "rfxResponseReadGrantScopes/org-response-rfx/readGrants/issuer": {
        id: "issuer",
        grantType: "rfx_response_read",
        rfxId: "org-response-rfx",
        accessorUid: "issuer",
        allowedStoragePaths: [path],
        expiresAt: Date.now() + 60_000,
      },
    });
    await seedFile(path);

    const bob = authenticated("bob").storage();
    const carol = authenticated("carol").storage();
    const issuer = authenticated("issuer").storage();
    const outsider = authenticated("outsider").storage();
    await assertFails(getMetadata(ref(bob, path)));
    await assertFails(getMetadata(ref(carol, path)));
    await assertFails(getMetadata(ref(issuer, path)));
    await assertFails(getMetadata(ref(outsider, path)));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await Promise.all([
        deleteDoc(doc(context.firestore(), "orgMembers/respondent-org_bob")),
        deleteDoc(doc(
          context.firestore(),
          "rfxResponseReadGrantScopes/org-response-rfx/readGrants/bob",
        )),
      ]);
    });
    await assertFails(getMetadata(ref(bob, path)));
    await assertFails(getMetadata(ref(carol, path)));
  });

  test("verification evidence is private, immutable, and bound to the submitting account", async () => {
    const alice = authenticated("alice").storage();
    const bob = authenticated("bob").storage();
    const staff = authenticated("staff", { role: "staff" }).storage();
    const admin = authenticated("admin", { role: "admin" }).storage();
    const path = "verificationDocs/alice/license/proof.pdf";

    await assertSucceeds(
      uploadBytes(ref(alice, path), PDF, { contentType: "application/pdf" }),
    );
    await assertSucceeds(getMetadata(ref(alice, path)));
    await assertSucceeds(getMetadata(ref(staff, path)));
    await assertFails(getMetadata(ref(bob, path)));
    await assertFails(
      uploadBytes(ref(bob, "verificationDocs/alice/license/forged.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      uploadBytes(ref(staff, "verificationDocs/alice/license/staff-write.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      uploadBytes(ref(alice, "verificationDocs/alice/license/custom.pdf"), PDF, {
        contentType: "application/pdf",
        customMetadata: { publicCache: "true" },
      }),
    );
    await assertFails(
      updateMetadata(ref(alice, path), { customMetadata: { tampered: "true" } }),
    );
    await seedFirestore({
      "verificationEvidenceLocks/alice_license": {
        id: "alice_license",
        uid: "alice",
        documentType: "license",
        storagePath: path,
      },
    });
    await assertFails(deleteObject(ref(alice, path)));
    await assertSucceeds(deleteObject(ref(admin, path)));
  });

  test("team and business-referral evidence is private to exact participants", async () => {
    await seedFirestore({
      "rfxTeams/team-one": {
        id: "team-one",
        rfxId: "rfx-one",
        primeUid: "alice",
        memberUids: ["alice", "bob", "stale-array-member", "mismatched-guard"],
      },
      "rfxTeamMemberships/team-one/members/alice": {
        id: "alice", teamId: "team-one", rfxId: "rfx-one", uid: "alice", role: "prime",
      },
      "rfxTeamMemberships/team-one/members/bob": {
        id: "bob", teamId: "team-one", rfxId: "rfx-one", uid: "bob", role: "sub",
      },
      "rfxTeamMemberships/team-one/members/mismatched-guard": {
        id: "someone-else",
        teamId: "team-one",
        rfxId: "rfx-one",
        uid: "someone-else",
        role: "sub",
      },
      "businessReferrals/referral-one": {
        referrerUid: "alice",
        recipientUid: "bob",
        recipientOrgId: "recipient-org",
        consentStatus: "pending",
        status: "sent",
      },
      "orgMembers/recipient-org_org-recipient": {
        orgId: "recipient-org",
        uid: "org-recipient",
        role: "member",
      },
      "businessReferralStorageGrantScopes/referral-one/storageGrants/alice": {
        id: "alice",
        grantType: "business_referral_storage",
        referralId: "referral-one",
        accessorUid: "alice",
        allowedReadStoragePaths: [],
        allowedCreateStoragePaths: [
          "businessReferralEvidence/referral-one/alice/context.pdf",
        ],
        expiresAt: Date.now() + 60_000,
      },
    });

    const alice = authenticated("alice").storage();
    const bob = authenticated("bob").storage();
    const orgRecipient = authenticated("org-recipient").storage();
    const outsider = authenticated("outsider").storage();
    const staleArrayMember = authenticated("stale-array-member").storage();
    const mismatchedGuard = authenticated("mismatched-guard").storage();
    const admin = authenticated("admin", { role: "admin" }).storage();
    const teamPath = "teamDocuments/team-one/bob/working-notes.pdf";
    const referralPath = "businessReferralEvidence/referral-one/alice/context.pdf";
    const disputePath =
      "businessReferralDisputeEvidence/referral-one/bob/dispute-context.pdf";

    await assertSucceeds(
      uploadBytes(ref(bob, teamPath), PDF, { contentType: "application/pdf" }),
    );
    await assertSucceeds(getMetadata(ref(alice, teamPath)));
    await assertSucceeds(getMetadata(ref(bob, teamPath)));
    await assertFails(getMetadata(ref(outsider, teamPath)));
    await assertFails(getMetadata(ref(staleArrayMember, teamPath)));
    await assertFails(getMetadata(ref(mismatchedGuard, teamPath)));
    await assertFails(
      uploadBytes(ref(outsider, "teamDocuments/team-one/outsider/forged.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );

    await assertFails(
      uploadBytes(ref(alice, referralPath), PDF, { contentType: "application/pdf" }),
    );
    await seedFile(referralPath);
    await assertFails(getMetadata(ref(alice, referralPath)));
    await assertFails(getMetadata(ref(bob, referralPath)));
    await assertFails(getMetadata(ref(orgRecipient, referralPath)));
    await assertFails(getMetadata(ref(outsider, referralPath)));
    await assertFails(
      uploadBytes(
        ref(outsider, "businessReferralEvidence/referral-one/outsider/forged.pdf"),
        PDF,
        { contentType: "application/pdf" },
      ),
    );
    await assertFails(deleteObject(ref(alice, referralPath)));

    await seedFirestore({
      "businessReferrals/referral-one": {
        referrerUid: "alice",
        recipientUid: "bob",
        recipientOrgId: "recipient-org",
        consentStatus: "confirmed",
        status: "sent",
      },
      "businessReferralStorageGrantScopes/referral-one/storageGrants/bob": {
        id: "bob",
        grantType: "business_referral_storage",
        referralId: "referral-one",
        accessorUid: "bob",
        allowedReadStoragePaths: [referralPath],
        allowedCreateStoragePaths: [],
        expiresAt: Date.now() + 60_000,
      },
      "businessReferralStorageGrantScopes/referral-one/storageGrants/org-recipient": {
        id: "org-recipient",
        grantType: "business_referral_storage",
        referralId: "referral-one",
        accessorUid: "org-recipient",
        allowedReadStoragePaths: [referralPath],
        allowedCreateStoragePaths: [],
        expiresAt: Date.now() + 60_000,
      },
    });
    await assertFails(getMetadata(ref(bob, referralPath)));
    await assertFails(getMetadata(ref(orgRecipient, referralPath)));

    await seedFirestore({
      "businessReferralStorageGrantScopes/referral-one/storageGrants/bob": {
        id: "bob",
        grantType: "business_referral_storage",
        referralId: "referral-one",
        accessorUid: "bob",
        allowedReadStoragePaths: [],
        allowedCreateStoragePaths: [disputePath],
        expiresAt: Date.now() + 60_000,
      },
      "businessReferralStorageGrantScopes/referral-one/storageGrants/alice": {
        id: "alice",
        grantType: "business_referral_storage",
        referralId: "referral-one",
        accessorUid: "alice",
        allowedReadStoragePaths: [disputePath],
        allowedCreateStoragePaths: [],
        expiresAt: Date.now() + 60_000,
      },
      "businessReferralStorageGrantScopes/referral-one/storageGrants/org-recipient": {
        id: "org-recipient",
        grantType: "business_referral_storage",
        referralId: "referral-one",
        accessorUid: "org-recipient",
        allowedReadStoragePaths: [referralPath, disputePath],
        allowedCreateStoragePaths: [],
        expiresAt: Date.now() + 60_000,
      },
    });
    await assertFails(
      uploadBytes(ref(bob, disputePath), PDF, { contentType: "application/pdf" }),
    );
    await seedFile(disputePath);
    await assertFails(getMetadata(ref(alice, disputePath)));
    await assertFails(getMetadata(ref(orgRecipient, disputePath)));
    await assertFails(getMetadata(ref(outsider, disputePath)));
    await assertFails(
      uploadBytes(
        ref(outsider, "businessReferralDisputeEvidence/referral-one/outsider/forged.pdf"),
        PDF,
        { contentType: "application/pdf" },
      ),
    );
    await assertFails(deleteObject(ref(bob, disputePath)));
    await assertSucceeds(deleteObject(ref(admin, disputePath)));

    await seedFirestore({
      "orgs/recipient-org": { id: "recipient-org", status: "suspended" },
      "businessReferralStorageGrantScopes/referral-one/storageGrants/org-recipient": {
        id: "org-recipient",
        grantType: "business_referral_storage",
        referralId: "referral-one",
        accessorUid: "org-recipient",
        allowedReadStoragePaths: [referralPath, disputePath],
        allowedCreateStoragePaths: [],
        expiresAt: Date.now() - 1,
      },
    });
    await assertFails(getMetadata(ref(orgRecipient, referralPath)));
  });

  test("high-risk private bytes never traverse the direct Storage rules surface", () => {
    const rules = readFileSync(resolve("storage.rules"), "utf8");
    expect(rules).not.toContain("rfxResponseReadGrantScopes");
    expect(rules).not.toContain("rfxResponseUploadGrantScopes");
    expect(rules).not.toContain("businessReferralStorageGrantScopes");
    for (const namespace of [
      "rfxResponses",
      "rfxProposals",
      "rfxDocuments",
      "businessReferralEvidence",
      "businessReferralDisputeEvidence",
    ]) {
      const matchStart = rules.indexOf(`match /${namespace}/`);
      expect(matchStart).toBeGreaterThan(-1);
      const matchSurface = rules.slice(matchStart, rules.indexOf("\n    }", matchStart) + 6);
      expect(matchSurface).toMatch(/allow read(?:, (?:create|write))?: if false;/);
    }
    expect(rules).toContain("function hasSafeSensitiveCreateMetadata");
  });
});
