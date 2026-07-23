import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  deleteApp,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  type Auth,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";

const PROJECT_ID = "demo-hi-coworking";
const PASSWORD = "organization-workspace-password";
const AUTH_EMULATOR_URL = "http://127.0.0.1:9100";
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8081";

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9100";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

interface TestActor {
  uid: string;
  auth: Auth;
  functions: Functions;
  app: FirebaseApp;
}

let adminApp: AdminApp;
let db: Firestore;
let sequence = 0;
const clients: FirebaseApp[] = [];

async function clearFirestore(): Promise<void> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Could not clear Firestore: ${response.status}`);
}

async function clearAuth(): Promise<void> {
  const response = await fetch(`${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Could not clear Auth: ${response.status}`);
}

async function createActor(uid: string, role = "member"): Promise<TestActor> {
  const email = `${uid}@example.test`;
  await getAdminAuth(adminApp).createUser({ uid, email, password: PASSWORD, emailVerified: true });
  await getAdminAuth(adminApp).setCustomUserClaims(uid, { role });
  const app = initializeApp({
    projectId: PROJECT_ID,
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
  }, `organization-workspace-${sequence++}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5004);
  return { uid, auth, functions, app };
}

async function call(
  actor: TestActor,
  name: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const callable = httpsCallable<Record<string, unknown>, Record<string, unknown>>(actor.functions, name);
  return (await callable(data)).data;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

async function seedOrganizations(): Promise<void> {
  const now = Date.now();
  await Promise.all([
    db.doc("orgs/actor-org").set({
      id: "actor-org",
      schemaVersion: 2,
      name: "Actor Organization",
      normalizedName: "actor organization",
      status: "active",
      publicationApproved: true,
      claimStatus: "claimed",
      verificationStatus: "verified",
      ownerUid: "owner-user",
      billingEmail: "private@example.test",
      sourceIds: { duns: "private" },
      updatedAt: now,
    }),
    db.doc("orgMembers/actor-org_owner-user").set({
      id: "actor-org_owner-user",
      orgId: "actor-org",
      uid: "owner-user",
      role: "owner",
      status: "active",
      joinedAt: now,
    }),
    db.doc("orgMembers/actor-org_former-user").set({
      id: "actor-org_former-user",
      orgId: "actor-org",
      uid: "former-user",
      role: "admin",
      status: "former",
      joinedAt: now,
    }),
    db.doc("publicOrganizations/actor-org").set({
      id: "actor-org",
      schemaVersion: 2,
      name: "Actor Organization",
      normalizedName: "actor organization",
      status: "active",
      publicationApproved: true,
      claimStatus: "claimed",
      verificationStatus: "verified",
      resourceProviderStatus: "not_provider",
      updatedAt: now,
    }),
    db.doc("orgs/subject-org").set({
      id: "subject-org",
      name: "Subject Organization",
      status: "active",
      publicationApproved: true,
      claimStatus: "claimed",
      verificationStatus: "verified",
      ownerUid: "private-subject-owner",
      updatedAt: now,
    }),
    db.doc("publicOrganizations/subject-org").set({
      id: "subject-org",
      schemaVersion: 2,
      name: "Subject Organization",
      normalizedName: "subject organization",
      status: "active",
      publicationApproved: true,
      claimStatus: "claimed",
      verificationStatus: "verified",
      resourceProviderStatus: "not_provider",
      latitude: 36.98,
      longitude: -76.63,
      coordinateConfidence: "verified",
      coordinatePublicationApproved: true,
      updatedAt: now,
    }),
    db.doc("orgs/resource-org").set({
      id: "resource-org",
      name: "Resource Provider",
      status: "active",
      publicationApproved: true,
      claimStatus: "claimed",
      resourceProviderStatus: "approved",
      updatedAt: now,
    }),
    db.doc("publicOrganizations/resource-org").set({
      id: "resource-org",
      schemaVersion: 2,
      name: "Resource Provider",
      normalizedName: "resource provider",
      status: "active",
      publicationApproved: true,
      claimStatus: "claimed",
      verificationStatus: "verified",
      resourceProviderStatus: "approved",
      resourceCategories: ["procurement"],
      updatedAt: now,
    }),
    db.doc("referralRelationshipInsights/actor-org__subject-org").set({
      id: "actor-org__subject-org",
      participantSubjectKeys: ["org:actor-org", "org:subject-org"],
      state: "trusted",
      // No external disclosure approval: the callable may return only a generic indicator.
      updatedAt: now,
    }),
  ]);
}

beforeAll(async () => {
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "organization-workspace-admin");
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await Promise.all([clearFirestore(), clearAuth()]);
  await seedOrganizations();
});

afterAll(async () => {
  await Promise.all(clients.map((app) => deleteApp(app)));
  await deleteAdminApp(adminApp);
});

describe("organization workspace callables", () => {
  it("creates one canonical organization idempotently and activates it as an actor", async () => {
    const creator = await createActor("creator-user");
    const input = {
      name: "New Canonical Organization",
      city: "Smithfield",
      state: "VA",
      website: "https://canonical.example",
      idempotencyKey: "organization-create-0001",
    };
    const first = await call(creator, "exchange_organizationCreate", input);
    const replay = await call(creator, "exchange_organizationCreate", input);
    expect(first).toMatchObject({ created: true, idempotent: false });
    expect(replay).toMatchObject({
      created: true,
      organizationId: first.organizationId,
      idempotent: true,
    });
    const organizationId = String(first.organizationId);
    const [organization, publicOrganization, membership, commercial, preference] = await Promise.all([
      db.doc(`orgs/${organizationId}`).get(),
      db.doc(`publicOrganizations/${organizationId}`).get(),
      db.doc(`orgMembers/${organizationId}_${creator.uid}`).get(),
      db.doc(`exchangeMemberships/${organizationId}`).get(),
      db.doc(`exchangeWorkspacePreferences/${creator.uid}`).get(),
    ]);
    expect(organization.data()).toMatchObject({
      ownerUid: creator.uid,
      claimStatus: "claimed",
      verificationStatus: "unverified",
      publicationApproved: false,
    });
    expect(publicOrganization.data()).toMatchObject({
      status: "inactive",
      publicationApproved: false,
      claimStatus: "claimed",
      verificationStatus: "unverified",
    });
    expect(membership.data()).toMatchObject({ role: "owner", status: "active" });
    expect(commercial.data()).toMatchObject({
      status: "active",
      startedAt: expect.any(Number),
      pricingVersion: "free-v1",
      entitlementVersion: "free-entitlements-v1",
    });
    expect(preference.data()?.actorOrganizationId).toBe(organizationId);

    await expectCode(call(creator, "exchange_organizationRequestClaim", {
      organizationId: "source:restricted-candidate",
      reason: "I have authority for this restricted candidate.",
    }), "functions/failed-precondition");
    expect((await db.doc("orgs/target_restricted-candidate").get()).exists).toBe(false);
  });

  it("lists exact-active actors and safely falls back from an unauthorized requested actor", async () => {
    const owner = await createActor("owner-user");
    const former = await createActor("former-user");
    const ownerResult = await call(owner, "exchange_listActorOrganizations", {
      requestedActorOrganizationId: "forged-org",
    });
    expect(ownerResult.selectedActorOrganizationId).toBe("actor-org");
    expect(ownerResult.fallbackApplied).toBe(true);
    expect(ownerResult.actors).toEqual([
      expect.objectContaining({ organizationId: "actor-org", membershipRole: "owner" }),
    ]);

    const formerResult = await call(former, "exchange_listActorOrganizations", {
      requestedActorOrganizationId: "actor-org",
    });
    expect(formerResult.actors).toEqual([]);
    expect(formerResult.selectedActorOrganizationId).toBeNull();
  });

  it("returns private self and public external/resource final allowlists", async () => {
    const owner = await createActor("owner-user");
    const self = await call(owner, "exchange_resolveOrganizationPerspective", {
      actorOrganizationId: "actor-org",
      subjectOrganizationId: "actor-org",
      mode: "intelligence",
    });
    expect((self.perspective as Record<string, unknown>).projectionLevel).toBe("private_owner");
    expect((self.organization as Record<string, unknown>).billingEmail).toBe("private@example.test");
    expect((self.organization as Record<string, unknown>).sourceIds).toBeUndefined();

    const external = await call(owner, "exchange_resolveOrganizationPerspective", {
      actorOrganizationId: "actor-org",
      subjectOrganizationId: "subject-org",
      mode: "referrals",
    });
    expect((external.perspective as Record<string, unknown>).projectionLevel).toBe("public_claimed");
    expect((external.organization as Record<string, unknown>).ownerUid).toBeUndefined();
    expect((external.relationship as Record<string, unknown>).type).toBe("undisclosed");
    expect((external.relationship as Record<string, unknown>).trustedIntroductionMayBeAvailable).toBe(true);

    const resource = await call(owner, "exchange_resolveOrganizationPerspective", {
      actorOrganizationId: "actor-org",
      subjectOrganizationId: "resource-org",
      mode: "resources",
    });
    expect((resource.subject as Record<string, unknown>).contextType).toBe("resource_provider");
    expect((resource.perspective as Record<string, unknown>).projectionLevel).toBe("resource_public");
  });

  it("provides bounded directory pages and actor-scoped save/list state", async () => {
    const owner = await createActor("owner-user");
    const directory = await call(owner, "exchange_organizationDirectory", {
      query: "Subject",
      bounds: { west: -77, south: 36, east: -76, north: 38 },
      pageSize: 10,
    });
    expect(directory.organizations).toEqual([
      expect.objectContaining({ id: "subject-org", coordinatePublicationApproved: true }),
    ]);

    await call(owner, "exchange_saveOrganization", {
      actorOrganizationId: "actor-org",
      action: "set",
      organizationId: "subject-org",
      saved: true,
    });
    const list = await call(owner, "exchange_saveOrganization", {
      actorOrganizationId: "actor-org",
      action: "list",
    });
    expect(list.savedOrganizations).toEqual([
      expect.objectContaining({ id: "subject-org" }),
    ]);
  });

  it("routes idempotent contact/introduction requests without exposing a path and denies former actors", async () => {
    const owner = await createActor("owner-user");
    const former = await createActor("former-user");
    const contactInput = {
      actorOrganizationId: "actor-org",
      subjectOrganizationId: "subject-org",
      message: "Please connect our organizations about upcoming work.",
      idempotencyKey: "contact-request-0001",
    };
    const first = await call(owner, "exchange_requestOrganizationContact", contactInput);
    const replay = await call(owner, "exchange_requestOrganizationContact", contactInput);
    expect(first.idempotent).toBe(false);
    expect(replay).toMatchObject({ requestId: first.requestId, idempotent: true });

    const introduction = await call(owner, "exchange_requestOrganizationIntroduction", {
      actorOrganizationId: "actor-org",
      subjectOrganizationId: "subject-org",
      message: "A trusted introduction would help us explore a partnership.",
      idempotencyKey: "introduction-request-0001",
    });
    expect(introduction.trustedIntroductionMayBeAvailable).toBe(true);
    expect(introduction).not.toHaveProperty("path");
    expect(introduction).not.toHaveProperty("introducers");

    await expectCode(call(former, "exchange_saveOrganization", {
      actorOrganizationId: "actor-org",
      action: "set",
      organizationId: "subject-org",
      saved: true,
    }), "functions/permission-denied");
  });
});
