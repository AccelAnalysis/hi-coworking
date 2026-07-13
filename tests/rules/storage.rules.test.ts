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
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

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

  test("canonical RFx response files are writable by the path-bound respondent and readable by exact participants", async () => {
    const path = "rfxResponses/rfx-one/bob/proposal.pdf";
    const disposablePath = "rfxResponses/rfx-one/bob/draft-to-remove.pdf";
    const unreferencedPath = "rfxResponses/rfx-one/bob/abandoned.pdf";
    const postSubmitPath = "rfxResponses/rfx-one/bob/post-submit.pdf";
    const latePath = "rfxResponses/expired-rfx/bob/late.pdf";
    const legacyProposalPath = "rfxProposals/rfx-one/bob/legacy.pdf";
    const legacySiblingPath = "rfxProposals/rfx-one/bob/unreferenced.pdf";
    await seedFirestore({
      "rfx/rfx-one": {
        ownerUid: "alice",
        createdBy: "alice",
        orgId: "rfx-org",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: false,
      },
      "rfx/expired-rfx": {
        ownerUid: "issuer",
        createdBy: "issuer",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: false,
        dueDate: Date.now() - 60_000,
      },
      "orgMembers/rfx-org_org-owner": {
        orgId: "rfx-org",
        uid: "org-owner",
        role: "member",
      },
      "rfxResponseUploadGrantScopes/rfx-one/uploadGrants/bob": {
        id: "bob",
        grantType: "rfx_response_upload",
        rfxId: "rfx-one",
        respondentUid: "bob",
        allowedStoragePaths: [path, disposablePath, unreferencedPath, postSubmitPath],
        expiresAt: Date.now() + 60_000,
      },
      "rfxResponseUploadGrantScopes/expired-rfx/uploadGrants/bob": {
        id: "bob",
        grantType: "rfx_response_upload",
        rfxId: "expired-rfx",
        respondentUid: "bob",
        allowedStoragePaths: [latePath],
        expiresAt: Date.now() + 60_000,
      },
    });

    const alice = authenticated("alice").storage();
    const bob = authenticated("bob").storage();
    const orgOwner = authenticated("org-owner").storage();
    const outsider = authenticated("outsider").storage();
    const staff = authenticated("staff", { role: "staff" }).storage();
    await assertSucceeds(
      uploadBytes(ref(bob, disposablePath), PDF, { contentType: "application/pdf" }),
    );
    await assertSucceeds(deleteObject(ref(bob, disposablePath)));

    await assertSucceeds(
      uploadBytes(ref(bob, path), PDF, { contentType: "application/pdf" }),
    );
    await assertSucceeds(
      uploadBytes(ref(bob, unreferencedPath), PDF, { contentType: "application/pdf" }),
    );
    await assertFails(
      uploadBytes(ref(bob, "rfxResponses/rfx-one/bob/not-granted.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertSucceeds(getMetadata(ref(bob, path)));
    await assertFails(getMetadata(ref(alice, path)));
    await assertFails(getMetadata(ref(orgOwner, path)));
    await assertFails(getMetadata(ref(staff, path)));

    await seedFirestore({
      "rfxResponseAccess/rfx-one/respondents/bob": {
        id: "bob",
        rfxId: "rfx-one",
        respondentUid: "bob",
        responseId: "response-one",
        attachmentStoragePaths: [path, legacyProposalPath],
      },
    });
    await Promise.all([
      seedFile(legacyProposalPath),
      seedFile(legacySiblingPath),
    ]);
    // The individual creator no longer owns an organization-issued RFx after
    // losing organization membership.
    await assertFails(getMetadata(ref(alice, path)));
    await assertSucceeds(getMetadata(ref(orgOwner, path)));
    await assertSucceeds(getMetadata(ref(staff, path)));
    await assertFails(getMetadata(ref(outsider, path)));
    await assertSucceeds(getMetadata(ref(bob, legacyProposalPath)));
    await assertSucceeds(getMetadata(ref(orgOwner, legacyProposalPath)));
    await assertSucceeds(getMetadata(ref(staff, legacyProposalPath)));
    await assertFails(getMetadata(ref(outsider, legacyProposalPath)));
    await assertFails(getMetadata(ref(bob, legacySiblingPath)));
    for (const storage of [bob, alice, orgOwner, staff]) {
      await assertFails(getMetadata(ref(storage, unreferencedPath)));
    }

    await assertFails(
      uploadBytes(ref(alice, "rfxResponses/rfx-one/bob/owner-forged.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      uploadBytes(ref(outsider, "rfxResponses/rfx-one/bob/outsider-forged.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      uploadBytes(ref(bob, postSubmitPath), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      uploadBytes(ref(bob, latePath), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      uploadBytes(ref(bob, "rfxResponses/missing-rfx/bob/missing.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      updateMetadata(ref(bob, path), { customMetadata: { tampered: "true" } }),
    );
    await assertFails(
      uploadBytes(ref(bob, "rfxProposals/rfx-one/bob/legacy.pdf"), PDF, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(deleteObject(ref(bob, path)));
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

  test("organization responses follow current org membership and exact submitted paths", async () => {
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
    });
    await seedFile(path);

    const bob = authenticated("bob").storage();
    const carol = authenticated("carol").storage();
    const issuer = authenticated("issuer").storage();
    const outsider = authenticated("outsider").storage();
    await assertSucceeds(getMetadata(ref(bob, path)));
    await assertSucceeds(getMetadata(ref(carol, path)));
    await assertSucceeds(getMetadata(ref(issuer, path)));
    await assertFails(getMetadata(ref(outsider, path)));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), "orgMembers/respondent-org_bob"));
    });
    await assertFails(getMetadata(ref(bob, path)));
    await assertSucceeds(getMetadata(ref(carol, path)));
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
    });

    const alice = authenticated("alice").storage();
    const bob = authenticated("bob").storage();
    const orgRecipient = authenticated("org-recipient").storage();
    const outsider = authenticated("outsider").storage();
    const staleArrayMember = authenticated("stale-array-member").storage();
    const mismatchedGuard = authenticated("mismatched-guard").storage();
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

    await assertSucceeds(
      uploadBytes(ref(alice, referralPath), PDF, { contentType: "application/pdf" }),
    );
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
    });
    await assertSucceeds(getMetadata(ref(bob, referralPath)));
    await assertSucceeds(getMetadata(ref(orgRecipient, referralPath)));

    await assertSucceeds(
      uploadBytes(ref(bob, disputePath), PDF, { contentType: "application/pdf" }),
    );
    await assertSucceeds(getMetadata(ref(alice, disputePath)));
    await assertSucceeds(getMetadata(ref(orgRecipient, disputePath)));
    await assertFails(getMetadata(ref(outsider, disputePath)));
    await assertFails(
      uploadBytes(
        ref(outsider, "businessReferralDisputeEvidence/referral-one/outsider/forged.pdf"),
        PDF,
        { contentType: "application/pdf" },
      ),
    );
    await assertFails(deleteObject(ref(bob, disputePath)));

    await seedFirestore({
      "orgs/recipient-org": { id: "recipient-org", status: "suspended" },
    });
    await assertFails(getMetadata(ref(orgRecipient, referralPath)));
  });
});
