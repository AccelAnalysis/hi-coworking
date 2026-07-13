import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp as deleteAdminApp,
  getApps as getAdminApps,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  getFirestore as getAdminFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { getStorage as getAdminStorage } from "firebase-admin/storage";
import {
  deleteApp,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";

const PROJECT_ID = "demo-hi-coworking";
const REGION = "us-central1";
const AUTH_EMULATOR_URL = "http://127.0.0.1:9100";
const FUNCTIONS_EMULATOR_HOST = "127.0.0.1";
const FUNCTIONS_EMULATOR_PORT = 5004;
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8081";
const PASSWORD = "exchange-test-password";
const FUTURE = 60 * 60 * 1_000;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9100";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";

type PlatformRole = "admin" | "staff" | "member" | "externalVendor" | "econPartner";

interface TestActor {
  uid: string;
  auth: Auth;
  functions: Functions;
}

interface CallableErrorLike {
  code?: string;
  details?: unknown;
  message?: string;
}

let adminApp: AdminApp;
let db: Firestore;
let expireTeamInvitationsAt: typeof import(
  "../../apps/functions/src/teaming"
).expireTeamInvitationsAt;
let clientSequence = 0;
const clientApps: FirebaseApp[] = [];

async function clearFirestore(): Promise<void> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Could not clear the Firestore emulator: ${response.status} ${await response.text()}`);
  }
}

async function clearAuth(): Promise<void> {
  const response = await fetch(
    `${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Could not clear the Auth emulator: ${response.status} ${await response.text()}`);
  }
}

async function disposeClients(): Promise<void> {
  const apps = clientApps.splice(0);
  await Promise.all(apps.map(async (app) => {
    const auth = getAuth(app);
    if (auth.currentUser) await signOut(auth);
    await deleteApp(app);
  }));
}

async function createActor(
  uid: string,
  role: PlatformRole = "member",
  options: { verified?: boolean; activePlan?: boolean } = {},
): Promise<TestActor> {
  const email = `${uid}@example.test`;
  await getAdminAuth(adminApp).createUser({ uid, email, password: PASSWORD, emailVerified: true });
  await getAdminAuth(adminApp).setCustomUserClaims(uid, { role });

  const activePlan = options.activePlan ?? true;
  await db.collection("users").doc(uid).set({
    uid,
    email,
    displayName: `Test ${uid}`,
    membershipStatus: activePlan ? "active" : "none",
    plan: activePlan ? "coworking_plus" : null,
    expiresAt: activePlan ? Date.now() + 24 * FUTURE : null,
    credits: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.collection("profiles").doc(uid).set({
    uid,
    businessName: `${uid} LLC`,
    verificationStatus: options.verified === false ? "pending" : "verified",
    verificationVersion: 0,
    published: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.appspot.com`,
    },
    `exchange-callable-test-${++clientSequence}`,
  );
  clientApps.push(app);

  const auth = getAuth(app);
  connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  await auth.currentUser?.getIdToken(true);

  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, FUNCTIONS_EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
  return { uid, auth, functions };
}

async function callFunction<Result>(
  actor: TestActor,
  name: string,
  data: Record<string, unknown>,
): Promise<Result> {
  const callable = httpsCallable<Record<string, unknown>, Result>(actor.functions, name);
  return (await callable(data)).data;
}

async function expectCallableError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<CallableErrorLike> {
  try {
    await promise;
  } catch (error) {
    const callableError = error as CallableErrorLike;
    expect(callableError.code).toBe(`functions/${expectedCode}`);
    return callableError;
  }
  throw new Error(`Expected callable to fail with functions/${expectedCode}`);
}

async function seedReleasedTerritory(fips = "12086"): Promise<void> {
  await db.collection("territories").doc(fips).set({
    id: fips,
    fips,
    name: "Test Territory",
    state: "FL",
    status: "released",
    centroid: { lat: 25.75, lng: -80.2 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

function publishInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotencyKey: "publish-key-0001",
    title: "Secure facilities maintenance opportunity",
    description: "Provide a complete response for recurring facilities maintenance services.",
    territoryFips: "12086",
    geoLat: 25.7617,
    geoLng: -80.1918,
    dueDate: Date.now() + FUTURE,
    memberOnly: false,
    evaluationCriteria: [],
    requestedDocuments: [],
    ...overrides,
  };
}

beforeAll(async () => {
  adminApp = getAdminApps().find((app) => app.name === "exchange-callable-tests")
    ?? initializeAdminApp(
      {
        projectId: PROJECT_ID,
        storageBucket: `${PROJECT_ID}.appspot.com`,
      },
      "exchange-callable-tests",
  );
  db = getAdminFirestore(adminApp);
  ({ expireTeamInvitationsAt } = await import("../../apps/functions/src/teaming"));
});

beforeEach(async () => {
  await disposeClients();
  await Promise.all([clearFirestore(), clearAuth()]);
});

afterAll(async () => {
  await disposeClients();
  await Promise.all([clearFirestore(), clearAuth()]);
  await db.terminate();
  await deleteAdminApp(adminApp);
});

describe("RFx callable authority and transaction boundaries", () => {
  it("rejects caller-controlled fields, fails closed on territory/verification, and publishes idempotently", async () => {
    const publisher = await createActor("rfx-publisher", "member", { verified: false });

    await expectCallableError(
      callFunction(publisher, "rfx_publish", publishInput({
        createdBy: "forged-owner",
        status: "open",
      })),
      "invalid-argument",
    );
    expect((await db.collection("rfx").get()).size).toBe(0);

    const territoryError = await expectCallableError(
      callFunction(publisher, "rfx_publish", publishInput({ idempotencyKey: "missing-territory-0001" })),
      "failed-precondition",
    );
    expect((territoryError.details as { reasonCode?: string } | undefined)?.reasonCode).toBe("TERRITORY_UNKNOWN");

    await seedReleasedTerritory();
    const verificationError = await expectCallableError(
      callFunction(publisher, "rfx_publish", publishInput({ idempotencyKey: "unverified-user-0001" })),
      "failed-precondition",
    );
    expect((verificationError.details as { reasonCode?: string } | undefined)?.reasonCode).toBe("VERIFICATION_REQUIRED");

    await db.collection("profiles").doc(publisher.uid).update({ verificationStatus: "verified" });
    const input = publishInput({ idempotencyKey: "successful-publish-0001" });
    const first = await callFunction<{
      id: string;
      status: string;
      adminApprovalStatus: string;
      version: number;
    }>(publisher, "rfx_publish", input);
    const replay = await callFunction<typeof first>(publisher, "rfx_publish", input);
    await expectCallableError(
      callFunction(publisher, "rfx_publish", {
        ...input,
        title: "A different RFx under the same idempotency key",
      }),
      "already-exists",
    );

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      status: "under_review",
      adminApprovalStatus: "pending",
      version: 1,
    });
    const rfxSnapshot = await db.collection("rfx").get();
    expect(rfxSnapshot.size).toBe(1);
    expect(rfxSnapshot.docs[0].data()).toMatchObject({
      id: first.id,
      ownerUid: publisher.uid,
      createdBy: publisher.uid,
      status: "under_review",
      adminApprovalStatus: "pending",
      responseCount: 0,
      geo: { lat: 25.75, lng: -80.2, source: "territory_centroid" },
    });

    const attacker = await createActor("rfx-version-attacker");
    await expectCallableError(
      callFunction(attacker, "rfx_update", {
        rfxId: first.id,
        expectedVersion: 999,
        title: "Unauthorized version probe",
      }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(attacker, "rfx_cancel", {
        rfxId: first.id,
        expectedVersion: 999,
        reason: "Unauthorized version probe",
      }),
      "permission-denied",
    );
  });

  it("lists only individual ownership and exact active organization management authority", async () => {
    const manager = await createActor("rfx-org-manager");
    const formerCreator = await createActor("rfx-former-org-creator");
    const now = Date.now();
    await Promise.all([
      db.collection("orgs").doc("managed-org").set({
        id: "managed-org",
        name: "Managed Organization",
        status: "active",
      }),
      db.collection("orgs").doc("suspended-org").set({
        id: "suspended-org",
        name: "Suspended Organization",
        status: "suspended",
      }),
      db.collection("orgMembers").doc(`managed-org_${manager.uid}`).set({
        orgId: "managed-org",
        uid: manager.uid,
        role: "owner",
        joinedAt: now,
      }),
      db.collection("orgMembers").doc(`suspended-org_${manager.uid}`).set({
        orgId: "suspended-org",
        uid: manager.uid,
        role: "admin",
        joinedAt: now,
      }),
      // A membership at any non-canonical ID must not restore former access.
      db.collection("orgMembers").doc("malformed-former-membership").set({
        orgId: "managed-org",
        uid: formerCreator.uid,
        role: "owner",
        joinedAt: now,
      }),
      db.collection("rfx").doc("managed-org-rfx").set({
        id: "managed-org-rfx",
        schemaVersion: 2,
        version: 1,
        ownerUid: formerCreator.uid,
        createdBy: formerCreator.uid,
        orgId: "managed-org",
        title: "Current organization managers control this RFx",
        description: "Former creator identity does not preserve organization authority.",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: false,
        evaluationCriteria: [],
        requestedDocuments: [],
        responseCount: 0,
        internalOnly: "must not cross the callable projection",
        createdAt: now,
        updatedAt: now,
      }),
      db.collection("rfx").doc("former-creator-individual-rfx").set({
        id: "former-creator-individual-rfx",
        schemaVersion: 2,
        version: 1,
        ownerUid: formerCreator.uid,
        createdBy: formerCreator.uid,
        title: "The creator still owns this individual RFx",
        description: "Individual authority remains independent of organization membership.",
        status: "under_review",
        adminApprovalStatus: "pending",
        memberOnly: false,
        evaluationCriteria: [],
        requestedDocuments: [],
        responseCount: 0,
        createdAt: now - 1,
        updatedAt: now,
      }),
      db.collection("rfx").doc("suspended-org-rfx").set({
        id: "suspended-org-rfx",
        schemaVersion: 2,
        version: 1,
        ownerUid: manager.uid,
        createdBy: manager.uid,
        orgId: "suspended-org",
        title: "Suspended organization RFx",
        description: "Suspended organizations do not confer current management authority.",
        status: "open",
        adminApprovalStatus: "approved",
        memberOnly: false,
        evaluationCriteria: [],
        requestedDocuments: [],
        responseCount: 0,
        createdAt: now - 2,
        updatedAt: now,
      }),
    ]);

    const managerResult = await callFunction<{
      rfx: Array<Record<string, unknown>>;
      manageableRfxIds: string[];
      managerOrganizations: Array<{ orgId: string; role: string; name?: string }>;
      activeCount: number;
      publisherActiveCounts: { individual: number; organizations: Record<string, number> };
    }>(manager, "rfx_listManaged", { maxResults: 20 });
    expect(managerResult.manageableRfxIds).toEqual(["managed-org-rfx"]);
    expect(managerResult.managerOrganizations).toEqual([{
      orgId: "managed-org",
      role: "owner",
      name: "Managed Organization",
    }]);
    expect(managerResult.activeCount).toBe(1);
    expect(managerResult.publisherActiveCounts).toEqual({
      individual: 0,
      organizations: { "managed-org": 1 },
    });
    expect(managerResult.rfx[0]).toMatchObject({
      id: "managed-org-rfx",
      orgId: "managed-org",
      ownerUid: formerCreator.uid,
    });
    expect(managerResult.rfx[0]).not.toHaveProperty("internalOnly");

    const formerCreatorResult = await callFunction<{
      rfx: Array<Record<string, unknown>>;
      manageableRfxIds: string[];
      managerOrganizations: Array<{ orgId: string }>;
      activeCount: number;
      publisherActiveCounts: { individual: number; organizations: Record<string, number> };
    }>(formerCreator, "rfx_listManaged", { maxResults: 20 });
    expect(formerCreatorResult.manageableRfxIds).toEqual(["former-creator-individual-rfx"]);
    expect(formerCreatorResult.managerOrganizations).toEqual([]);
    expect(formerCreatorResult.activeCount).toBe(1);
    expect(formerCreatorResult.publisherActiveCounts).toEqual({
      individual: 1,
      organizations: {},
    });
    expect(formerCreatorResult.rfx[0]).toMatchObject({
      id: "former-creator-individual-rfx",
      ownerUid: formerCreator.uid,
    });
  });

  it("accounts active RFx quota by current publisher subject instead of stale creator identity", async () => {
    await seedReleasedTerritory();
    const manager = await createActor("rfx-quota-manager");
    const formerCreator = await createActor("rfx-quota-former");
    const now = Date.now();
    await Promise.all([
      db.collection("orgs").doc("quota-org").set({
        id: "quota-org",
        name: "Quota Organization",
        status: "active",
      }),
      db.collection("orgMembers").doc(`quota-org_${manager.uid}`).set({
        orgId: "quota-org",
        uid: manager.uid,
        role: "owner",
        joinedAt: now,
      }),
      ...["one", "two", "three", "four", "five"].map((suffix, index) => db.collection("rfx").doc(`quota-org-${suffix}`).set({
        id: `quota-org-${suffix}`,
        schemaVersion: 2,
        version: 1,
        ownerUid: formerCreator.uid,
        createdBy: formerCreator.uid,
        orgId: "quota-org",
        title: `Existing organization RFx ${suffix}`,
        description: "Counts against the organization publisher subject.",
        territoryFips: "12086",
        status: index === 0 ? "open" : "under_review",
        adminApprovalStatus: index === 0 ? "approved" : "pending",
        evaluationCriteria: [],
        requestedDocuments: [],
        responseCount: 0,
        createdAt: now - index,
        updatedAt: now,
      })),
    ]);

    const organizationPublish = await callFunction<{ creditCost: number }>(
      manager,
      "rfx_publish",
      publishInput({
        idempotencyKey: "organization-quota-publish-0001",
        orgId: "quota-org",
      }),
    );
    expect(organizationPublish.creditCost).toBeGreaterThan(0);
    expect((await db.collection("exchangeUsage").doc("org:quota-org").get()).data())
      .toMatchObject({
        subjectType: "organization",
        subjectId: "quota-org",
        orgId: "quota-org",
        rfxActivePosts: 6,
      });

    const individualPublish = await callFunction<{ creditCost: number }>(
      formerCreator,
      "rfx_publish",
      publishInput({ idempotencyKey: "individual-quota-publish-0001" }),
    );
    expect(individualPublish.creditCost).toBe(0);
    expect((await db.collection("exchangeUsage").doc(formerCreator.uid).get()).data())
      .toMatchObject({
        subjectType: "user",
        subjectId: formerCreator.uid,
        rfxActivePosts: 1,
      });
  });

  it("preauthorizes only exact eligible response upload paths and consumes the grant on submit", async () => {
    await seedReleasedTerritory();
    const owner = await createActor("rfx-upload-owner", "admin");
    const respondent = await createActor("rfx-upload-respondent");
    const ineligible = await createActor("rfx-upload-ineligible", "member", { verified: false });
    const published = await callFunction<{ id: string }>(
      owner,
      "rfx_publish",
      publishInput({ idempotencyKey: "upload-grant-publish-0001" }),
    );
    const storagePath = `rfxResponses/${published.id}/${respondent.uid}/proposal/proposal.pdf`;

    await expectCallableError(
      callFunction(respondent, "rfx_prepareResponseUploads", {
        rfxId: published.id,
        attachments: [{
          storagePath: `rfxResponses/${published.id}/forged-user/proposal.pdf`,
          contentType: "application/pdf",
          size: 10,
        }],
      }),
      "invalid-argument",
    );
    await expectCallableError(
      callFunction(ineligible, "rfx_prepareResponseUploads", {
        rfxId: published.id,
        attachments: [{
          storagePath: `rfxResponses/${published.id}/${ineligible.uid}/proposal/proposal.pdf`,
          contentType: "application/pdf",
          size: 10,
        }],
      }),
      "failed-precondition",
    );

    const grant = await callFunction<{
      success: boolean;
      expiresAt: number;
      allowedPathCount: number;
    }>(respondent, "rfx_prepareResponseUploads", {
      rfxId: published.id,
      attachments: [{ storagePath, contentType: "application/pdf", size: 10 }],
    });
    expect(grant).toMatchObject({ success: true, allowedPathCount: 1 });
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
    expect((await db.collection("rfxResponseUploadGrantScopes")
      .doc(published.id)
      .collection("uploadGrants")
      .doc(respondent.uid)
      .get()).data()).toMatchObject({
      rfxId: published.id,
      respondentUid: respondent.uid,
      allowedStoragePaths: [storagePath],
    });

    await getAdminStorage(adminApp).bucket().file(storagePath).save(Buffer.from("proposal"), {
      metadata: { contentType: "application/pdf" },
    });
    const submitted = await callFunction<{ id: string; status: string }>(
      respondent,
      "rfx_submitResponse",
      {
        rfxId: published.id,
        idempotencyKey: "upload-grant-submit-0001",
        proposalText: "Response submitted with a preauthorized attachment.",
        proposalStoragePath: storagePath,
        uploadedDocuments: [],
      },
    );
    expect(submitted.status).toBe("submitted");
    expect((await db.collection("rfxResponseUploadGrantScopes")
      .doc(published.id)
      .collection("uploadGrants")
      .doc(respondent.uid)
      .get()).exists).toBe(false);
    expect((await db.collection("rfxResponseAccess")
      .doc(published.id)
      .collection("respondents")
      .doc(respondent.uid)
      .get()).data()).toMatchObject({ attachmentStoragePaths: [storagePath] });
  });

  it("keeps geo backfill dry-run by default and uses a deterministic document cursor", async () => {
    const adminActor = await createActor("rfx-geo-admin", "admin");
    await Promise.all([
      seedReleasedTerritory(),
      db.collection("territories").doc("invalid-centroid").set({
        id: "invalid-centroid",
        fips: "99999",
        status: "released",
        centroid: { lat: 91, lng: -80 },
      }),
      db.collection("rfx").doc("geo-a").set({
        id: "geo-a",
        territoryFips: "12086",
        status: "open",
      }),
      db.collection("rfx").doc("geo-b").set({
        id: "geo-b",
        territoryFips: "12086",
        status: "open",
      }),
    ]);

    const dryRun = await callFunction<{
      dryRun: boolean;
      processed: number;
      wouldUpdate: number;
      updated: number;
      invalidTerritoryCentroids: number;
      nextAfterId: string | null;
      complete: boolean;
    }>(adminActor, "rfx_backfillGeo", { maxDocs: 1 });
    expect(dryRun).toMatchObject({
      dryRun: true,
      processed: 1,
      wouldUpdate: 1,
      updated: 0,
      invalidTerritoryCentroids: 1,
      nextAfterId: "geo-a",
      complete: false,
    });
    expect((await db.collection("rfx").doc("geo-a").get()).data()).not.toHaveProperty("geo");

    await expectCallableError(
      callFunction(adminActor, "rfx_backfillGeo", {
        maxDocs: 1,
        apply: true,
        projectId: PROJECT_ID,
        confirmProject: "wrong-project",
      }),
      "failed-precondition",
    );
    const applied = await callFunction<{
      dryRun: boolean;
      processed: number;
      updated: number;
      nextAfterId: string | null;
    }>(adminActor, "rfx_backfillGeo", {
      maxDocs: 1,
      afterId: dryRun.nextAfterId,
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(applied).toMatchObject({
      dryRun: false,
      processed: 1,
      updated: 1,
      nextAfterId: "geo-b",
    });
    expect((await db.collection("rfx").doc("geo-b").get()).data()?.geo)
      .toMatchObject({ lat: 25.75, lng: -80.2, source: "territory_centroid_backfill" });
  });

  it("deduplicates response submission/counting and restricts evaluation to the RFx authority", async () => {
    await seedReleasedTerritory();
    const owner = await createActor("rfx-owner", "admin");
    const respondent = await createActor("rfx-respondent", "member");
    const outsider = await createActor("rfx-outsider", "member");
    await Promise.all([
      db.collection("orgs").doc("respondent-org").set({
        id: "respondent-org",
        status: "active",
      }),
      db.collection("orgMembers").doc(`respondent-org_${respondent.uid}`).set({
        orgId: "respondent-org",
        uid: respondent.uid,
        role: "owner",
        status: "active",
      }),
    ]);

    const published = await callFunction<{ id: string; version: number }>(
      owner,
      "rfx_publish",
      publishInput({ idempotencyKey: "owner-publish-0001" }),
    );
    const responseInput = {
      rfxId: published.id,
      orgId: "respondent-org",
      idempotencyKey: "response-submit-0001",
      proposalText: "A complete, independently prepared response.",
      uploadedDocuments: [],
    };
    const first = await callFunction<{ id: string; status: string }>(
      respondent,
      "rfx_submitResponse",
      responseInput,
    );
    const replay = await callFunction<typeof first>(respondent, "rfx_submitResponse", responseInput);
    await expectCallableError(
      callFunction(respondent, "rfx_submitResponse", {
        ...responseInput,
        proposalText: "A changed response must not replay under the same key.",
      }),
      "already-exists",
    );

    expect(replay).toEqual(first);
    expect(first.status).toBe("submitted");
    expect((await db.collection("rfx").doc(published.id).get()).data()?.responseCount).toBe(1);
    expect((await db.collection("rfxResponses").where("rfxId", "==", published.id).get()).size).toBe(1);
    expect((await db.collection("rfxResponseAccess")
      .doc(published.id)
      .collection("respondents")
      .doc(respondent.uid)
      .get()).data()).toMatchObject({
      rfxId: published.id,
      respondentUid: respondent.uid,
      responseId: first.id,
    });

    await expectCallableError(
      callFunction(respondent, "rfx_submitResponse", {
        ...responseInput,
        idempotencyKey: "response-submit-0002",
      }),
      "already-exists",
    );
    expect((await db.collection("rfx").doc(published.id).get()).data()?.responseCount).toBe(1);

    await expectCallableError(
      callFunction(outsider, "rfx_evaluateResponse", {
        responseId: first.id,
        transition: "under_review",
        evaluationNotes: "Forged review attempt",
      }),
      "permission-denied",
    );

    await db.collection("orgMembers").doc(`respondent-org_${owner.uid}`).set({
      orgId: "respondent-org",
      uid: owner.uid,
      role: "admin",
      status: "active",
    });
    await expectCallableError(
      callFunction(owner, "rfx_evaluateResponse", {
        responseId: first.id,
        transition: "under_review",
        evaluationNotes: "Conflicted evaluator review",
      }),
      "permission-denied",
    );
    await db.collection("orgMembers").doc(`respondent-org_${owner.uid}`).delete();

    const reviewed = await callFunction<{ status: string; rfxId: string }>(
      owner,
      "rfx_evaluateResponse",
      {
        responseId: first.id,
        transition: "under_review",
        evaluationNotes: "Authorized owner review",
      },
    );
    expect(reviewed).toMatchObject({ status: "under_review", rfxId: published.id });
    expect((await db.collection("rfxResponses").doc(first.id).get()).data()).toMatchObject({
      status: "under_review",
      evaluatedBy: owner.uid,
    });
  });

  it("awards the response-cap boundary without exceeding transaction writes and rejects above it", async () => {
    const owner = await createActor("high-cardinality-owner", "admin");
    const rfxId = "high-cardinality-rfx";
    const selectedId = "response-000";
    await db.collection("rfx").doc(rfxId).set({
      id: rfxId,
      schemaVersion: 2,
      version: 1,
      ownerUid: owner.uid,
      createdBy: owner.uid,
      title: "High-cardinality evaluation",
      description: "Exercises the bounded award transaction.",
      territoryFips: "12086",
      status: "open",
      adminApprovalStatus: "approved",
      evaluationCriteria: [],
      requestedDocuments: [],
      responseCount: 401,
      createdAt: 1,
      updatedAt: 1,
    });
    const batch = db.batch();
    for (let index = 0; index < 401; index += 1) {
      const id = `response-${String(index).padStart(3, "0")}`;
      batch.set(db.collection("rfxResponses").doc(id), {
        id,
        schemaVersion: 2,
        version: 1,
        rfxId,
        rfxOwnerUid: owner.uid,
        respondentUid: `respondent-${index}`,
        status: "submitted",
        submittedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    await batch.commit();

    await expectCallableError(
      callFunction(owner, "rfx_evaluateResponse", {
        responseId: selectedId,
        transition: "accepted",
      }),
      "failed-precondition",
    );
    await Promise.all([
      db.collection("rfxResponses").doc("response-400").delete(),
      db.collection("rfx").doc(rfxId).update({ responseCount: 400 }),
    ]);

    const result = await callFunction<{ status: string; declinedCompetitors: number }>(
      owner,
      "rfx_evaluateResponse",
      { responseId: selectedId, transition: "accepted" },
    );
    expect(result).toMatchObject({ status: "accepted", declinedCompetitors: 399 });
    expect((await db.collection("rfx").doc(rfxId).get()).data())
      .toMatchObject({ status: "awarded", awardedResponseId: selectedId });
    expect((await db.collection("rfxResponses").doc("response-399").get()).data()?.status)
      .toBe("declined");
  });
});

describe("RFx teaming invitation boundaries", () => {
  it("binds an invite to one exact team/invitee and fails closed when it expires", async () => {
    await seedReleasedTerritory();
    const prime = await createActor("team-prime", "member");
    const invitee = await createActor("team-invitee", "member");
    const attacker = await createActor("team-attacker", "member");
    const rfxId = "rfx-for-team";
    await db.collection("rfx").doc(rfxId).set({
      id: rfxId,
      schemaVersion: 2,
      version: 1,
      ownerUid: "issuer-user",
      createdBy: "issuer-user",
      title: "Team opportunity",
      description: "A seeded open RFx used to exercise invitation authority.",
      territoryFips: "12086",
      status: "open",
      adminApprovalStatus: "approved",
      dueDate: Date.now() + FUTURE,
      responseCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const created = await callFunction<{ teamId: string }>(prime, "team_create", {
      rfxId,
      name: "Exact Identity Team",
      idempotencyKey: "team-create-0001",
    });
    expect((await db.doc(
      `rfxTeamMemberships/${created.teamId}/members/${prime.uid}`,
    ).get()).data()).toMatchObject({
      id: prime.uid,
      teamId: created.teamId,
      rfxId,
      uid: prime.uid,
      role: "prime",
    });
    const invitation = await callFunction<{ inviteId: string; expiresAt: number }>(prime, "team_invite", {
      teamId: created.teamId,
      rfxId,
      inviteeUid: invitee.uid,
      role: "sub",
      expiresInDays: 7,
    });

    await expectCallableError(
      callFunction(attacker, "team_respond_invite", {
        inviteId: invitation.inviteId,
        response: "accepted",
      }),
      "permission-denied",
    );

    const accepted = await callFunction<{ teamId: string; status: string }>(invitee, "team_respond_invite", {
      inviteId: invitation.inviteId,
      response: "accepted",
    });
    expect(accepted).toMatchObject({ teamId: created.teamId, status: "accepted" });
    expect((await db.collection("rfxTeamInvites").doc(invitation.inviteId).get()).data()).toMatchObject({
      teamId: created.teamId,
      rfxId,
      inviteeUid: invitee.uid,
      status: "accepted",
    });
    expect((await db.collection("rfxTeams").doc(created.teamId).get()).data()?.memberUids).toEqual([
      prime.uid,
      invitee.uid,
    ]);
    expect((await db.doc(
      `rfxTeamMemberships/${created.teamId}/members/${invitee.uid}`,
    ).get()).data()).toMatchObject({
      id: invitee.uid,
      teamId: created.teamId,
      rfxId,
      uid: invitee.uid,
      role: "sub",
    });
    const primeTeams = await callFunction<{ teams: Array<{ id: string }> }>(
      prime,
      "team_listMine",
      {},
    );
    const inviteeTeams = await callFunction<{ teams: Array<{ id: string }> }>(
      invitee,
      "team_listMine",
      {},
    );
    expect(primeTeams.teams.map((team) => team.id)).toContain(created.teamId);
    expect(inviteeTeams.teams.map((team) => team.id)).toContain(created.teamId);

    const expiringInvitation = await callFunction<{ inviteId: string }>(prime, "team_invite", {
      teamId: created.teamId,
      rfxId,
      inviteeUid: attacker.uid,
      role: "estimator",
      expiresInDays: 1,
    });
    await db.collection("rfxTeamInvites").doc(expiringInvitation.inviteId).update({
      expiresAt: Date.now() - 1,
    });
    await expectCallableError(
      callFunction(attacker, "team_respond_invite", {
        inviteId: expiringInvitation.inviteId,
        response: "accepted",
      }),
      "failed-precondition",
    );
    expect((await db.collection("rfxTeamInvites").doc(expiringInvitation.inviteId).get()).data()?.status)
      .toBe("expired");
    expect((await db.collection("rfxTeams").doc(created.teamId).get()).data()?.memberUids)
      .not.toContain(attacker.uid);

    await callFunction(prime, "team_manage_member", {
      teamId: created.teamId,
      memberUid: invitee.uid,
      action: "update",
      newRole: "proposal_writer",
    });
    expect((await db.doc(
      `rfxTeamMemberships/${created.teamId}/members/${invitee.uid}`,
    ).get()).data()?.role).toBe("proposal_writer");

    await callFunction(prime, "team_manage_member", {
      teamId: created.teamId,
      memberUid: invitee.uid,
      action: "remove",
    });
    expect((await db.doc(
      `rfxTeamMemberships/${created.teamId}/members/${invitee.uid}`,
    ).get()).exists).toBe(false);
    expect((await db.collection("rfxTeams").doc(created.teamId).get()).data()?.memberUids)
      .toEqual([prime.uid]);

    await db.collection("rfxTeams").doc(created.teamId).update({
      memberUids: [prime.uid, attacker.uid],
    });
    await expectCallableError(
      callFunction(prime, "team_invite", {
        teamId: created.teamId,
        rfxId,
        inviteeUid: attacker.uid,
        role: "sub",
        expiresInDays: 7,
      }),
      "failed-precondition",
    );

    await db.collection("rfxTeams").doc(created.teamId).update({ memberUids: [prime.uid] });
    await db.doc(`rfxTeamMemberships/${created.teamId}/members/${prime.uid}`).delete();
    await expectCallableError(
      callFunction(prime, "team_invite", {
        teamId: created.teamId,
        rfxId,
        inviteeUid: attacker.uid,
        role: "sub",
        expiresInDays: 7,
      }),
      "failed-precondition",
    );
  });

  it("expires numeric and legacy Timestamp invitations under one bounded scan", async () => {
    const now = Date.now();
    await Promise.all([
      db.collection("rfxTeamInvites").doc("numeric-expired").set({
        id: "numeric-expired",
        status: "pending",
        expiresAt: now - 2_000,
        version: 1,
      }),
      db.collection("rfxTeamInvites").doc("timestamp-expired").set({
        id: "timestamp-expired",
        status: "pending",
        expiresAt: Timestamp.fromMillis(now - 1_000),
        version: 1,
      }),
      db.collection("rfxTeamInvites").doc("timestamp-future").set({
        id: "timestamp-future",
        status: "pending",
        expiresAt: Timestamp.fromMillis(now + FUTURE),
        version: 1,
      }),
    ]);

    const result = await expireTeamInvitationsAt(now, db);
    expect(result).toMatchObject({ selected: 2, expired: 2 });
    expect((await db.collection("rfxTeamInvites").doc("numeric-expired").get()).data()?.status)
      .toBe("expired");
    expect((await db.collection("rfxTeamInvites").doc("timestamp-expired").get()).data()?.status)
      .toBe("expired");
    expect((await db.collection("rfxTeamInvites").doc("timestamp-future").get()).data()?.status)
      .toBe("pending");
  });
});

describe("business referral purpose, authority, consent, and outcomes", () => {
  it("binds a platform-invite idempotency key to one recipient", async () => {
    const inviter = await createActor("platform-inviter");
    const input = {
      type: "platform_invite",
      idempotencyKey: "platform-invite-dedupe-0001",
      referredEmail: "first-invitee@example.test",
      referredName: "First Invitee",
    };
    const first = await callFunction<{ id: string }>(inviter, "referral_create", input);
    const replay = await callFunction<{ id: string }>(inviter, "referral_create", input);
    expect(replay.id).toBe(first.id);
    await expectCallableError(
      callFunction(inviter, "referral_create", {
        ...input,
        referredEmail: "second-invitee@example.test",
      }),
      "already-exists",
    );
    expect((await db.collection("referrals").where("referrerUid", "==", inviter.uid).get()).size)
      .toBe(1);
  });

  it("lists legacy business introductions while redacting unconsented contact fields", async () => {
    const recipient = await createActor("legacy-business-recipient");
    await Promise.all([
      db.collection("referrals").doc("legacy-private-intro").set({
        id: "legacy-private-intro",
        type: "business_intro",
        referrerUid: "legacy-referrer",
        providerUid: recipient.uid,
        clientName: "Private Person",
        clientEmail: "private-person@example.test",
        clientPhone: "+1-555-0100",
        clientCompany: "Private Company",
        note: "A facilities services opportunity.",
        consentStatus: "pending",
        status: "pending",
        createdAt: 20,
      }),
      db.collection("referrals").doc("legacy-consented-intro").set({
        id: "legacy-consented-intro",
        type: "business_intro",
        referrerUid: "legacy-referrer",
        providerUid: recipient.uid,
        clientName: "Consented Person",
        clientEmail: "consented-person@example.test",
        consentStatus: "confirmed",
        status: "pending",
        createdAt: 10,
      }),
      db.collection("referrals").doc("legacy-other-provider").set({
        id: "legacy-other-provider",
        type: "business_intro",
        referrerUid: "legacy-referrer",
        providerUid: "someone-else",
        clientEmail: "not-for-recipient@example.test",
        consentStatus: "confirmed",
        status: "pending",
        createdAt: 30,
      }),
    ]);

    const result = await callFunction<{ referrals: Array<Record<string, unknown>> }>(
      recipient,
      "legacyBusinessReferral_listReceived",
      {},
    );
    expect(result.referrals.map((referral) => referral.id)).toEqual([
      "legacy-private-intro",
      "legacy-consented-intro",
    ]);
    expect(result.referrals[0]).toMatchObject({ contactRedacted: true });
    expect(result.referrals[0]).not.toHaveProperty("clientName");
    expect(result.referrals[0]).not.toHaveProperty("clientEmail");
    expect(result.referrals[0]).not.toHaveProperty("clientPhone");
    expect(result.referrals[0]).not.toHaveProperty("clientCompany");
    expect(result.referrals[1]).toMatchObject({
      clientName: "Consented Person",
      clientEmail: "consented-person@example.test",
    });
    expect(JSON.stringify(result)).not.toContain("not-for-recipient@example.test");
  });

  it("lists typed and safely inferred platform invitations without leaking mixed referrals", async () => {
    const invitee = await createActor("legacy-invitee");
    await Promise.all([
      db.collection("referrals").doc("typed-invite").set({
        id: "typed-invite",
        type: "platform_invite",
        referrerUid: "inviter",
        referredEmail: "legacy-invitee@example.test",
        status: "pending",
        createdAt: 10,
      }),
      db.collection("referrals").doc("untyped-invite").set({
        id: "untyped-invite",
        referrerUid: "inviter",
        invitedEmail: "legacy-invitee@example.test",
        status: "pending",
        createdAt: 20,
      }),
      db.collection("referrals").doc("mixed-private-referral").set({
        id: "mixed-private-referral",
        referrerUid: "inviter",
        providerUid: "provider",
        referredEmail: "legacy-invitee@example.test",
        clientEmail: "customer@example.test",
        status: "pending",
        createdAt: 30,
      }),
    ]);

    const result = await callFunction<{ invitations: Array<Record<string, unknown>> }>(
      invitee,
      "platformInvite_listReceived",
      {},
    );
    expect(result.invitations.map((invite) => invite.id)).toEqual([
      "untyped-invite",
      "typed-invite",
    ]);
    expect(result.invitations.every((invite) => invite.type === "platform_invite")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("customer@example.test");
  });

  it("locks a verified legacy settlement against later financial-history rewrites", async () => {
    const admin = await createActor("settlement-admin", "admin");
    await db.collection("referrals").doc("legacy-converted").set({
      id: "legacy-converted",
      type: "business_intro",
      referrerUid: "referrer",
      providerUid: "provider",
      clientCompany: "Legacy Customer",
      status: "accepted",
      createdAt: 1,
    });
    await db.collection("referrals").doc("legacy-converted").update({ status: "converted" });

    await callFunction(admin, "referral_markPaid", {
      referralId: "legacy-converted",
      idempotencyKey: "settlement-first-0001",
      settlementReference: "ledger-entry-1001",
      note: "Verified against the accounting ledger.",
    });
    await expectCallableError(
      callFunction(admin, "referral_markPaid", {
        referralId: "legacy-converted",
        idempotencyKey: "settlement-first-0001",
        settlementReference: "conflicting-ledger-reference",
      }),
      "already-exists",
    );
    const first = (await db.collection("referrals").doc("legacy-converted").get()).data();
    const replay = await callFunction<{ idempotent?: boolean }>(admin, "referral_markPaid", {
      referralId: "legacy-converted",
      idempotencyKey: "settlement-replay-0002",
      settlementReference: "ledger-entry-1001",
      note: "This later note must not rewrite history.",
    });
    expect(replay.idempotent).toBe(true);
    expect((await db.collection("referrals").doc("legacy-converted").get()).data()).toEqual(first);
    await expectCallableError(
      callFunction(admin, "referral_markPaid", {
        referralId: "legacy-converted",
        idempotencyKey: "settlement-conflict-0003",
        settlementReference: "different-ledger-entry",
      }),
      "failed-precondition",
    );
  });

  it("defaults to no compensation, allows only the recipient to accept, and records recipient outcomes", async () => {
    const referrer = await createActor("referral-referrer");
    const recipient = await createActor("referral-recipient");
    const resolver = await createActor("referral-resolver", "admin");
    await db.collection("orgs").doc("recipient-org").set({
      id: "recipient-org",
      status: "active",
    });
    await Promise.all([
      db.collection("orgMembers").doc(`recipient-org_${recipient.uid}`).set({
        orgId: "recipient-org", uid: recipient.uid, role: "member", status: "active",
      }),
      // The referrer is deliberately also a recipient-org member. Separation
      // of duties still prevents them from accepting their own introduction.
      db.collection("orgMembers").doc(`recipient-org_${referrer.uid}`).set({
        orgId: "recipient-org", uid: referrer.uid, role: "member", status: "active",
      }),
    ]);

    const created = await callFunction<{ referralId: string; version: number }>(
      referrer,
      "businessReferral_create",
      {
        idempotencyKey: "business-referral-0001",
        recipientUid: recipient.uid,
        recipientOrgId: "recipient-org",
        referralType: "business_lead",
        title: "Potential facilities client",
        needSummary: "The referred company is looking for a qualified facilities maintenance provider.",
        consentStatus: "not_required",
      },
    );
    await expectCallableError(
      callFunction(referrer, "businessReferral_create", {
        idempotencyKey: "business-referral-0001",
        recipientUid: recipient.uid,
        recipientOrgId: "recipient-org",
        referralType: "business_lead",
        title: "A different introduction under the same key",
        needSummary: "This payload must not be treated as a replay of the original introduction.",
        consentStatus: "not_required",
      }),
      "already-exists",
    );
    expect((await db.collection("businessReferrals").doc(created.referralId).get()).data()).toMatchObject({
      referrerUid: referrer.uid,
      recipientUid: recipient.uid,
      status: "draft",
      version: 0,
      compensationPolicy: { type: "none", status: "none" },
    });

    await callFunction(referrer, "businessReferral_send", {
      referralId: created.referralId,
      expectedVersion: 0,
    });
    expect((await db.collection("businessReferrals").doc(created.referralId).get()).data()?.expiresAt)
      .toBeGreaterThan(Date.now());
    await expectCallableError(
      callFunction(referrer, "businessReferral_respond", {
        referralId: created.referralId,
        response: "accepted",
        expectedVersion: 1,
      }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(resolver, "businessReferral_respond", {
        referralId: created.referralId,
        response: "accepted",
        expectedVersion: 1,
      }),
      "permission-denied",
    );
    await callFunction(recipient, "businessReferral_respond", {
      referralId: created.referralId,
      response: "accepted",
      expectedVersion: 1,
    });

    await expectCallableError(
      callFunction(recipient, "businessReferral_progress", {
        referralId: created.referralId,
        status: "converted",
        expectedVersion: 2,
        outcome: { type: "converted", summary: "Attempted to skip active work" },
      }),
      "failed-precondition",
    );
    await expectCallableError(
      callFunction(resolver, "businessReferral_progress", {
        referralId: created.referralId,
        status: "in_progress",
        expectedVersion: 2,
      }),
      "permission-denied",
    );
    await callFunction(recipient, "businessReferral_progress", {
      referralId: created.referralId,
      status: "in_progress",
      expectedVersion: 2,
    });
    await callFunction(recipient, "businessReferral_progress", {
      referralId: created.referralId,
      status: "converted",
      expectedVersion: 3,
      outcome: { type: "converted", summary: "Recipient converted the referred opportunity" },
    });

    expect((await db.collection("businessReferrals").doc(created.referralId).get()).data()).toMatchObject({
      status: "converted",
      version: 4,
      compensationPolicy: { type: "none", status: "none" },
      outcome: {
        type: "converted",
        summary: "Recipient converted the referred opportunity",
        recordedByUid: recipient.uid,
      },
    });

    await expectCallableError(
      callFunction(recipient, "businessReferral_createDispute", {
        referralId: created.referralId,
        reason: "Recipient requests a documented review of the converted referral outcome.",
        evidenceStoragePaths: [
          `referralDisputeEvidence/${created.referralId}/unknown/${recipient.uid}/legacy.pdf`,
        ],
      }),
      "invalid-argument",
    );
    const evidenceStoragePath =
      `businessReferralDisputeEvidence/${created.referralId}/${recipient.uid}/conversion-review.pdf`;
    await getAdminStorage(adminApp).bucket().file(evidenceStoragePath).save(
      Buffer.from("%PDF-1.4\n% deterministic referral dispute evidence\n"),
      { resumable: false, metadata: { contentType: "application/pdf" } },
    );
    const dispute = await callFunction<{ disputeId: string }>(recipient, "businessReferral_createDispute", {
      referralId: created.referralId,
      reason: "Recipient requests a documented review of the converted referral outcome.",
      evidenceStoragePaths: [evidenceStoragePath],
    });
    await db.collection("businessReferralDisputes").doc("stale-open-dispute").set({
      id: "stale-open-dispute",
      referralId: created.referralId,
      openerUid: recipient.uid,
      referrerUid: referrer.uid,
      recipientUid: recipient.uid,
      referrerOrgId: null,
      recipientOrgId: "recipient-org",
      assignedStaffUids: [],
      reason: "A stale imported dispute that is not the active dispute.",
      evidenceStoragePaths: [],
      status: "open",
      createdAt: 1,
      updatedAt: 1,
    });
    await expectCallableError(
      callFunction(resolver, "businessReferral_resolveDispute", {
        disputeId: "stale-open-dispute",
        resolution: "dismissed",
        note: "This must not clear the actual active dispute.",
      }),
      "failed-precondition",
    );
    expect((await db.collection("businessReferrals").doc(created.referralId).get()).data()?.activeDisputeId)
      .toBe(dispute.disputeId);
    const resolution = await callFunction<{ status: string }>(resolver, "businessReferral_resolveDispute", {
      disputeId: dispute.disputeId,
      resolution: "dismissed",
      note: "The recorded outcome is supported by the referral history.",
    });
    expect(resolution.status).toBe("resolved_dismissed");
    expect((await db.collection("businessReferralDisputes").doc(dispute.disputeId).get()).data())
      .toMatchObject({
        status: "resolved_dismissed",
        resolvedByUid: resolver.uid,
        evidenceStoragePaths: [evidenceStoragePath],
      });
    const referralAfterResolution = (await db.collection("businessReferrals").doc(created.referralId).get()).data();
    expect(referralAfterResolution).not.toHaveProperty("activeDisputeId");
    expect(referralAfterResolution).toMatchObject({
      status: "converted",
      version: 6,
      compensationPolicy: { type: "none", status: "none" },
    });

    const closeable = await callFunction<{ referralId: string }>(referrer, "businessReferral_create", {
      idempotencyKey: "business-referral-close-0002",
      recipientUid: recipient.uid,
      recipientOrgId: "recipient-org",
      referralType: "service_need",
      title: "Referral that can close after acceptance",
      needSummary: "The recipient can determine immediately that this introduction is not a fit.",
      consentStatus: "not_required",
    });
    await callFunction(referrer, "businessReferral_send", {
      referralId: closeable.referralId,
      expectedVersion: 0,
    });
    await callFunction(recipient, "businessReferral_respond", {
      referralId: closeable.referralId,
      response: "accepted",
      expectedVersion: 1,
    });
    await callFunction(recipient, "businessReferral_progress", {
      referralId: closeable.referralId,
      status: "closed",
      expectedVersion: 2,
      outcome: { type: "not_a_fit", summary: "The requested service is outside the recipient's scope." },
    });
    expect((await db.collection("businessReferrals").doc(closeable.referralId).get()).data())
      .toMatchObject({ status: "closed", version: 3, outcome: { type: "not_a_fit" } });
  });

  it("keeps referred-party contact data separate and changes disclosure only through referrer consent", async () => {
    const referrer = await createActor("consent-referrer");
    const recipient = await createActor("consent-recipient");
    const admin = await createActor("consent-admin", "admin");
    const created = await callFunction<{ referralId: string }>(referrer, "businessReferral_create", {
      idempotencyKey: "business-consent-0001",
      recipientUid: recipient.uid,
      referralType: "customer_introduction",
      title: "Consent-aware customer introduction",
      needSummary: "A customer asked to be introduced to the receiving business.",
      consentStatus: "pending",
      referredParty: {
        type: "person",
        name: "Referred Customer",
        email: "customer@example.test",
        phone: "+1-305-555-0100",
      },
    });

    const referralBefore = (await db.collection("businessReferrals").doc(created.referralId).get()).data();
    const contactBefore = (await db.collection("businessReferralContacts").doc(created.referralId).get()).data();
    expect(referralBefore).not.toHaveProperty("email");
    expect(referralBefore).not.toHaveProperty("phone");
    expect(referralBefore).toMatchObject({
      consentStatus: "pending",
      referredPartySummary: { type: "person" },
    });
    expect(contactBefore).toMatchObject({
      referralId: created.referralId,
      consentStatus: "pending",
      recipientDisclosureAllowed: false,
      email: "customer@example.test",
    });

    await expectCallableError(
      callFunction(recipient, "businessReferral_confirmConsent", {
        referralId: created.referralId,
        expectedVersion: 0,
      }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(admin, "businessReferral_confirmConsent", {
        referralId: created.referralId,
        expectedVersion: 0,
      }),
      "permission-denied",
    );
    await callFunction(referrer, "businessReferral_confirmConsent", {
      referralId: created.referralId,
      expectedVersion: 0,
    });

    expect((await db.collection("businessReferrals").doc(created.referralId).get()).data())
      .toMatchObject({ consentStatus: "confirmed", version: 1 });
    expect((await db.collection("businessReferralContacts").doc(created.referralId).get()).data())
      .toMatchObject({ consentStatus: "confirmed", recipientDisclosureAllowed: true });
  });
});

describe("verification callable identity and review boundaries", () => {
  it("rejects another user's storage path, accepts canonical evidence idempotently, and blocks self-review", async () => {
    const submitter = await createActor("verification-staff", "staff", { verified: false });
    await expectCallableError(
      callFunction(submitter, "verification_submit", {
        idempotencyKey: "verification-wrong-path-0001",
        documents: [{
          type: "business_license",
          label: "Business license",
          storagePath: "verificationDocs/another-user/business_license/license.pdf",
        }],
      }),
      "invalid-argument",
    );

    const storagePath = `verificationDocs/${submitter.uid}/business_license/license.pdf`;
    await getAdminStorage(adminApp).bucket().file(storagePath).save(
      Buffer.from("%PDF-1.4\n% deterministic emulator evidence\n"),
      { resumable: false, metadata: { contentType: "application/pdf" } },
    );
    const submissionInput = {
      idempotencyKey: "verification-submit-0001",
      documents: [{ type: "business_license", label: "Business license", storagePath }],
    };
    const first = await callFunction<{
      success: boolean;
      idempotentReplay: boolean;
      documentIds: string[];
    }>(submitter, "verification_submit", submissionInput);
    const replay = await callFunction<typeof first>(submitter, "verification_submit", submissionInput);
    expect(first).toMatchObject({ success: true, idempotentReplay: false });
    expect(replay).toMatchObject({
      success: true,
      idempotentReplay: true,
      documentIds: first.documentIds,
    });
    expect((await db.collection("verificationDocuments").doc(first.documentIds[0]).get()).data())
      .toMatchObject({ uid: submitter.uid, storagePath, status: "pending" });
    expect((await db.collection("verificationEvidenceLocks")
      .doc(`${submitter.uid}_business_license`)
      .get()).data()).toMatchObject({
      uid: submitter.uid,
      documentType: "business_license",
      storagePath,
      documentId: first.documentIds[0],
    });

    await expectCallableError(
      callFunction(submitter, "verification_review", {
        uid: submitter.uid,
        documentId: first.documentIds[0],
        documentStatus: "approved",
        expectedProfileVersion: 1,
      }),
      "permission-denied",
    );
  });

  it("rejects review of a document that belongs to a different profile", async () => {
    const reviewer = await createActor("verification-reviewer", "staff");
    await createActor("verification-target-one", "member", { verified: false });
    await createActor("verification-target-two", "member", { verified: false });
    const documentId = "verification-document-one";
    const einDocumentId = "verification-ein-document-one";
    await db.collection("verificationDocuments").doc(documentId).set({
      id: documentId,
      uid: "verification-target-one",
      type: "business_license",
      label: "Business license",
      storagePath: "verificationDocs/verification-target-one/business_license/license.pdf",
      status: "pending",
      uploadedAt: Date.now(),
      updatedAt: Date.now(),
      version: 0,
    });
    await db.collection("verificationDocuments").doc(einDocumentId).set({
      id: einDocumentId,
      uid: "verification-target-one",
      type: "ein_letter",
      label: "EIN letter",
      storagePath: "verificationDocs/verification-target-one/ein_letter/ein.pdf",
      status: "pending",
      uploadedAt: Date.now(),
      updatedAt: Date.now(),
      version: 0,
    });

    await expectCallableError(
      callFunction(reviewer, "verification_review", {
        uid: "verification-target-two",
        documentId,
        documentStatus: "approved",
        expectedProfileVersion: 0,
      }),
      "permission-denied",
    );
    expect((await db.collection("verificationDocuments").doc(documentId).get()).data()?.status)
      .toBe("pending");

    const firstReview = await callFunction<{ verificationStatus: string; verificationVersion: number }>(
      reviewer,
      "verification_review",
      {
        uid: "verification-target-one",
        documentId,
        documentStatus: "approved",
        expectedProfileVersion: 0,
      },
    );
    expect(firstReview).toMatchObject({ verificationStatus: "pending", verificationVersion: 1 });
    const finalReview = await callFunction<typeof firstReview>(reviewer, "verification_review", {
      uid: "verification-target-one",
      documentId: einDocumentId,
      documentStatus: "approved",
      expectedProfileVersion: 1,
    });
    expect(finalReview).toMatchObject({ verificationStatus: "verified", verificationVersion: 2 });
    expect((await db.collection("profiles").doc("verification-target-one").get()).data()).toMatchObject({
      verificationStatus: "verified",
      verificationVersion: 2,
      verificationReviewedBy: reviewer.uid,
    });
    expect((await db.collection("verificationDocuments").doc(einDocumentId).get()).data())
      .toMatchObject({ status: "approved", reviewedBy: reviewer.uid, version: 1 });
  });
});
