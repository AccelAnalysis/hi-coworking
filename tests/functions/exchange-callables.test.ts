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
import {
  connectStorageEmulator,
  getDownloadURL,
  getMetadata,
  getStorage,
  ref as storageRef,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

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
  storage: FirebaseStorage;
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
let cleanupExpiredResponseReadGrantAt: typeof import(
  "../../apps/functions/src/rfx"
).cleanupExpiredResponseReadGrantAt;
let cleanupExpiredResponseUploadGrantAt: typeof import(
  "../../apps/functions/src/rfx"
).cleanupExpiredResponseUploadGrantAt;
let cleanupExpiredBusinessReferralStorageGrantAt: typeof import(
  "../../apps/functions/src/businessReferrals"
).cleanupExpiredBusinessReferralStorageGrantAt;
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
  const storage = getStorage(app);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return { uid, auth, functions, storage };
}

async function callFunction<Result>(
  actor: TestActor,
  name: string,
  data: Record<string, unknown>,
): Promise<Result> {
  const callable = httpsCallable<Record<string, unknown>, Result>(actor.functions, name);
  return (await callable(data)).data;
}

function createUnauthenticatedFunctions(): Functions {
  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `exchange-callable-test-${++clientSequence}`,
  );
  clientApps.push(app);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, FUNCTIONS_EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
  return functions;
}

async function callUnauthenticatedFunction<Result>(
  functions: Functions,
  name: string,
  data: Record<string, unknown>,
): Promise<Result> {
  const callable = httpsCallable<Record<string, unknown>, Result>(functions, name);
  return (await callable(data)).data;
}

function discoveryQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 1,
    query: "",
    filters: {
      naics: [],
      industries: [],
      capabilities: [],
      opportunityTypes: [],
      rfxTypes: [],
      buyerTypes: [],
      workArrangements: [],
      visibility: [],
      requiredCertifications: [],
      setAsideDesignations: [],
      territoryFips: [],
      primeClassifications: [],
      awardClassifications: [],
      personalized: [],
    },
    sort: "recommended",
    pageSize: 40,
    ...overrides,
  };
}

function discoveryProjection(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Date.now();
  return {
    projectionVersion: 1,
    id,
    title: `Opportunity ${id}`,
    searchableDescription: "Commercial HVAC and building automation services.",
    issuerDisplayName: "Test Public Works",
    issuerType: "government",
    issuerVerified: true,
    rfxType: "RFP",
    opportunityType: "services",
    naicsCodes: ["238220"],
    industryLabels: ["Construction"],
    capabilityKeywords: ["HVAC", "building automation"],
    searchTokens: ["opportunity", "commercial", "hvac", "building", "automation"],
    postedAt: now - 1_000,
    updatedAt: now,
    currency: "USD",
    workArrangement: "on_site",
    visibility: "public",
    requiredCertifications: [],
    setAsideDesignations: [],
    primeClassification: "either",
    awardClassification: "single",
    teamingSuitable: true,
    addendumCount: 0,
    qAndAStatus: "open",
    status: "open",
    adminApprovalStatus: "approved",
    discoverable: true,
    recommendedRank: now,
    projectionUpdatedAt: now,
    ownerUid: `owner-${id}`,
    createdBy: `owner-${id}`,
    normalizedTitle: `opportunity ${id}`,
    normalizedIssuer: "test public works",
    protectedResponderNames: ["must never leave the server"],
    ...overrides,
  };
}

async function privateStorageRequest(
  actor: TestActor,
  operation: "upload" | "download",
  storagePath: string,
  body?: Uint8Array,
  contentType = "application/pdf",
): Promise<Response> {
  const token = await actor.auth.currentUser?.getIdToken();
  if (!token) throw new Error("Test actor is not authenticated");
  return fetch(
    `http://${FUNCTIONS_EMULATOR_HOST}:${FUNCTIONS_EMULATOR_PORT}/${PROJECT_ID}/${REGION}/exchange_privateStorage`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Exchange-Storage-Operation": operation,
        "X-Storage-Path": storagePath,
        ...(body ? { "Content-Type": contentType } : {}),
      },
      body: body ? Buffer.from(body) : undefined,
    },
  );
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
  ({
    cleanupExpiredResponseReadGrantAt,
    cleanupExpiredResponseUploadGrantAt,
  } = await import("../../apps/functions/src/rfx"));
  ({ cleanupExpiredBusinessReferralStorageGrantAt } = await import(
    "../../apps/functions/src/businessReferrals"
  ));
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

describe("Opportunity discovery gateway boundaries", () => {
  it("supports anonymous and authenticated discovery without leaking protected fields", async () => {
    const member = await createActor("discovery-member");
    const unauthenticatedFunctions = createUnauthenticatedFunctions();
    await Promise.all([
      db.collection("opportunityDiscovery").doc("public-opportunity").set(
        discoveryProjection("public-opportunity"),
      ),
      db.collection("opportunityDiscovery").doc("member-opportunity").set(
        discoveryProjection("member-opportunity", { visibility: "members" }),
      ),
      db.collection("opportunityDiscovery").doc("restricted-opportunity").set(
        discoveryProjection("restricted-opportunity", { visibility: "restricted" }),
      ),
    ]);

    const anonymous = await callUnauthenticatedFunction<{
      records: Array<Record<string, unknown>>;
    }>(unauthenticatedFunctions, "rfx_listManaged", {
      operation: "discover",
      payload: discoveryQuery(),
    });
    expect(anonymous.records.map((record) => record.id)).toEqual(["public-opportunity"]);

    const authenticated = await callFunction<{
      records: Array<Record<string, unknown>>;
    }>(member, "rfx_listManaged", {
      operation: "discover",
      payload: discoveryQuery(),
    });
    expect(authenticated.records.map((record) => record.id).sort()).toEqual([
      "member-opportunity",
      "public-opportunity",
    ]);
    for (const record of [...anonymous.records, ...authenticated.records]) {
      expect(record).not.toHaveProperty("ownerUid");
      expect(record).not.toHaveProperty("createdBy");
      expect(record).not.toHaveProperty("adminApprovalStatus");
      expect(record).not.toHaveProperty("discoverable");
      expect(record).not.toHaveProperty("recommendedRank");
      expect(record).not.toHaveProperty("protectedResponderNames");
      expect(record.searchTokens).toEqual([]);
    }
  });

  it("limits restricted issuer opportunities to current exact organization managers", async () => {
    const manager = await createActor("discovery-issuer-manager");
    const participant = await createActor("discovery-issuer-participant");
    const outsider = await createActor("discovery-outsider");
    await Promise.all([
      db.collection("orgs").doc("discovery-issuer-org").set({
        id: "discovery-issuer-org",
        name: "Discovery Issuer",
        status: "active",
        naicsCodes: ["238220"],
        capabilityKeywords: ["building automation"],
      }),
      db.collection("orgMembers").doc(`discovery-issuer-org_${manager.uid}`).set({
        orgId: "discovery-issuer-org",
        uid: manager.uid,
        role: "owner",
        status: "active",
      }),
      db.collection("orgMembers").doc(`discovery-issuer-org_${participant.uid}`).set({
        orgId: "discovery-issuer-org",
        uid: participant.uid,
        role: "member",
        status: "active",
      }),
      db.collection("orgMembers").doc("malformed-discovery-membership").set({
        orgId: "discovery-issuer-org",
        uid: outsider.uid,
        role: "owner",
        status: "active",
      }),
      db.collection("opportunityDiscovery").doc("issuer-restricted").set(
        discoveryProjection("issuer-restricted", {
          visibility: "restricted",
          issuerOrganizationId: "discovery-issuer-org",
        }),
      ),
    ]);

    for (const [actor, expectedIds] of [
      [manager, ["issuer-restricted"]],
      [participant, []],
      [outsider, []],
    ] as const) {
      const result = await callFunction<{ records: Array<Record<string, unknown>> }>(
        actor,
        "rfx_listManaged",
        { operation: "discover", payload: discoveryQuery() },
      );
      expect(result.records.map((record) => record.id)).toEqual(expectedIds);
    }
  });

  it("validates geography and cursor paging while keeping pages bounded and stable", async () => {
    const member = await createActor("discovery-pagination-member");
    await Promise.all(Array.from({ length: 25 }, (_, index) => {
      const id = `paged-${String(index).padStart(2, "0")}`;
      return db.collection("opportunityDiscovery").doc(id).set(discoveryProjection(id, {
        recommendedRank: 10_000 - index,
        updatedAt: 10_000 - index,
      }));
    }));

    const first = await callFunction<{
      records: Array<Record<string, unknown>>;
      nextCursor?: string;
    }>(member, "rfx_listManaged", {
      operation: "discover",
      payload: discoveryQuery({ pageSize: 10 }),
    });
    expect(first.records).toHaveLength(10);
    expect(first.nextCursor).toBeTruthy();
    const second = await callFunction<typeof first>(member, "rfx_listManaged", {
      operation: "discover",
      payload: discoveryQuery({ pageSize: 10, cursor: first.nextCursor }),
    });
    expect(second.records).toHaveLength(10);
    expect(new Set([
      ...first.records.map((record) => record.id),
      ...second.records.map((record) => record.id),
    ]).size).toBe(20);

    await expectCallableError(callFunction(member, "rfx_listManaged", {
      operation: "discover",
      payload: discoveryQuery({
        location: {
          latitude: 36.8,
          longitude: -76.2,
          radiusMiles: 501,
          includeRemote: false,
        },
      }),
    }), "invalid-argument");
    await expectCallableError(callFunction(member, "rfx_listManaged", {
      operation: "discover",
      payload: discoveryQuery({
        location: {
          bounds: { west: -77, south: 38, east: -75, north: 36 },
          includeRemote: false,
        },
      }),
    }), "invalid-argument");
  });

  it("keeps saved items, saved searches, alerts, and recent searches exactly owner scoped", async () => {
    const owner = await createActor("discovery-state-owner");
    const outsider = await createActor("discovery-state-outsider");
    await db.collection("opportunityDiscovery").doc("stateful-opportunity").set(
      discoveryProjection("stateful-opportunity", {
        title: "HVAC controls modernization",
        searchTokens: [
          "hvac",
          "heating",
          "ventilation",
          "air conditioning",
          "238220",
          "controls",
          "modernization",
        ],
      }),
    );

    await callFunction(owner, "rfx_listManaged", {
      operation: "setSaved",
      payload: { rfxId: "stateful-opportunity", saved: true },
    });
    const ownerDiscovery = await callFunction<{
      records: Array<{ id: string; relationship: { saved: boolean } }>;
    }>(owner, "rfx_listManaged", {
      operation: "discover",
      payload: discoveryQuery({ query: "hvac" }),
    });
    const outsiderDiscovery = await callFunction<typeof ownerDiscovery>(
      outsider,
      "rfx_listManaged",
      { operation: "discover", payload: discoveryQuery({ query: "hvac" }) },
    );
    expect(ownerDiscovery.records[0]).toMatchObject({
      id: "stateful-opportunity",
      relationship: { saved: true },
    });
    expect(outsiderDiscovery.records[0]).toMatchObject({
      id: "stateful-opportunity",
      relationship: { saved: false },
    });

    const saved = await callFunction<{ id: string }>(owner, "rfx_listManaged", {
      operation: "savedSearchUpsert",
      payload: {
        name: "Owner HVAC alerts",
        query: discoveryQuery({ query: "hvac" }),
        alertFrequency: "weekly",
      },
    });
    const ownerSaved = await callFunction<{
      searches: Array<Record<string, unknown>>;
    }>(owner, "rfx_listManaged", {
      operation: "savedSearchList",
      payload: { maxResults: 10 },
    });
    expect(ownerSaved.searches).toHaveLength(1);
    expect(ownerSaved.searches[0]).toMatchObject({
      id: saved.id,
      ownerUid: owner.uid,
      name: "Owner HVAC alerts",
      alertFrequency: "weekly",
    });
    expect(ownerSaved.searches[0]?.createdAt).toEqual(expect.any(Number));
    expect(ownerSaved.searches[0]?.updatedAt).toEqual(expect.any(Number));

    const outsiderSaved = await callFunction<typeof ownerSaved>(
      outsider,
      "rfx_listManaged",
      { operation: "savedSearchList", payload: { maxResults: 10 } },
    );
    expect(outsiderSaved.searches).toEqual([]);
    await expectCallableError(callFunction(outsider, "rfx_listManaged", {
      operation: "savedSearchDelete",
      payload: { id: saved.id },
    }), "permission-denied");

    const ownerRecent = await callFunction<{
      searches: Array<Record<string, unknown>>;
    }>(owner, "rfx_listManaged", {
      operation: "recentSearchList",
      payload: { maxResults: 10 },
    });
    expect(ownerRecent.searches).toHaveLength(1);
    expect(ownerRecent.searches[0]).toMatchObject({
      ownerUid: owner.uid,
      label: "hvac",
      normalizedVersion: 1,
    });
    expect(ownerRecent.searches[0]?.lastUsedAt).toEqual(expect.any(Number));
  });

  it("keeps addenda and Q&A mutations issuer-only and private questions private", async () => {
    const issuer = await createActor("governance-issuer");
    const supplier = await createActor("governance-supplier");
    const rfxId = "governed-opportunity";
    await db.collection("rfx").doc(rfxId).set({
      id: rfxId,
      ownerUid: issuer.uid,
      createdBy: issuer.uid,
      title: "Governed opportunity",
      description: "Governance tests",
      status: "open",
      adminApprovalStatus: "approved",
      visibility: "public",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expectCallableError(callFunction(supplier, "rfx_listManaged", {
      operation: "addendumCreate",
      payload: {
        rfxId,
        title: "Unauthorized addendum",
        summary: "A supplier cannot publish this.",
        materialChanges: ["No change"],
        deadlineChanged: false,
        acknowledgmentRequired: false,
        idempotencyKey: "unauthorized-addendum-0001",
      },
    }), "permission-denied");

    await callFunction(issuer, "rfx_listManaged", {
      operation: "addendumCreate",
      payload: {
        rfxId,
        title: "Schedule clarification",
        summary: "The response schedule has been clarified.",
        materialChanges: ["Clarified submission schedule"],
        deadlineChanged: false,
        acknowledgmentRequired: true,
        idempotencyKey: "issuer-addendum-0001",
      },
    });
    await callFunction(supplier, "rfx_listManaged", {
      operation: "questionSubmit",
      payload: {
        rfxId,
        question: "Can the supplier submit a private clarification?",
        visibilityRequested: "private",
        idempotencyKey: "supplier-question-0001",
      },
    });

    const supplierView = await callFunction<{
      addenda: unknown[];
      questions: Array<Record<string, unknown>>;
      canManage: boolean;
    }>(supplier, "rfx_listManaged", {
      operation: "governanceList",
      payload: { rfxId, includePrivate: true },
    });
    expect(supplierView.addenda).toHaveLength(1);
    expect(supplierView.questions).toHaveLength(1);
    expect(supplierView.canManage).toBe(false);

    const outsider = await createActor("governance-outsider");
    const outsiderView = await callFunction<typeof supplierView>(outsider, "rfx_listManaged", {
      operation: "governanceList",
      payload: { rfxId, includePrivate: true },
    });
    expect(outsiderView.questions).toEqual([]);
  });
});

describe("Territory map projection and admin geometry", () => {
  it("classifies admin statuses, returns only map fields, and rejects malformed boundaries", async () => {
    const administrator = await createActor("territory-map-admin", "admin");
    const member = await createActor("territory-map-member");
    const validBoundary = {
      type: "Polygon",
      coordinates: [[
        [-76.8, 36.8],
        [-76.6, 36.8],
        [-76.6, 37],
        [-76.8, 37],
        [-76.8, 36.8],
      ]],
    };

    await callFunction(administrator, "territory_create", {
      fips: "51800",
      name: "Inactive City",
      state: "VA",
      type: "city",
      status: "paused",
      notes: "Private operations note",
      centroid: { lat: 36.9, lng: -76.7 },
      boundaryGeoJSON: validBoundary,
    });
    await Promise.all([
      db.collection("territories").doc("51093").set({
        fips: "51093",
        name: "Released County",
        state: "VA",
        status: "released",
        type: "county",
        boundaryGeoJSON: JSON.stringify(validBoundary),
        notes: "Must not be projected",
        statusHistory: [{ status: "released", at: Date.now(), by: administrator.uid }],
        createdAt: Date.now(),
      }),
      db.collection("territories").doc("51175").set({
        fips: "51175",
        name: "Scheduled County",
        state: "VA",
        status: "scheduled",
        type: "county",
        releaseDate: Date.now() + FUTURE,
        boundaryGeoJSON: JSON.stringify(validBoundary),
        createdAt: Date.now(),
      }),
    ]);

    const result = await callFunction<{
      released: Array<Record<string, unknown>>;
      scheduled: Array<Record<string, unknown>>;
      unreleased: Array<Record<string, unknown>>;
    }>(member, "territory_list_released", {});
    expect(result.released.map((territory) => territory.fips)).toEqual(["51093"]);
    expect(result.scheduled.map((territory) => territory.fips)).toEqual(["51175"]);
    expect(result.unreleased).toMatchObject([{
      fips: "51800",
      status: "paused",
      type: "city",
      centroid: { lat: 36.9, lng: -76.7 },
      boundaryGeoJSON: validBoundary,
    }]);
    expect(result.released[0]).not.toHaveProperty("notes");
    expect(result.released[0]).not.toHaveProperty("statusHistory");

    await expectCallableError(
      callFunction(administrator, "territory_update", {
        fips: "51800",
        boundaryGeoJSON: {
          type: "Polygon",
          coordinates: [[[-76.8, 36.8], [-76.6, 36.8], [-76.6, 37], [-76.7, 36.9]]],
        },
      }),
      "invalid-argument",
    );
  });
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

  it("lists and summarizes RFx only through current canonical organization authority", async () => {
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
      db.collection("orgMembers").doc(`managed-org_${formerCreator.uid}`).set({
        orgId: "managed-org",
        uid: formerCreator.uid,
        role: "owner",
        joinedAt: now - 1,
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
      // The former creator submitted this bid for the organization. It remains
      // visible to current organization participants but must not follow the
      // former member merely because respondentUid still names them.
      db.collection("rfxResponses").doc("managed-org-active-bid").set({
        id: "managed-org-active-bid",
        rfxId: "external-rfx",
        rfxOwnerUid: "external-owner",
        respondentUid: formerCreator.uid,
        respondentOrgId: "managed-org",
        status: "submitted",
        createdAt: now,
      }),
      db.collection("rfxResponses").doc("former-individual-active-bid").set({
        id: "former-individual-active-bid",
        rfxId: "external-rfx-two",
        rfxOwnerUid: "external-owner",
        respondentUid: formerCreator.uid,
        status: "under_review",
        createdAt: now,
      }),
      db.collection("rfxResponses").doc("managed-org-received-response").set({
        id: "managed-org-received-response",
        rfxId: "managed-org-rfx",
        rfxOwnerUid: formerCreator.uid,
        respondentUid: "outside-respondent-one",
        status: "declined",
        createdAt: now,
      }),
      db.collection("rfxResponses").doc("former-individual-received-response").set({
        id: "former-individual-received-response",
        rfxId: "former-creator-individual-rfx",
        rfxOwnerUid: formerCreator.uid,
        respondentUid: "outside-respondent-two",
        status: "declined",
        createdAt: now,
      }),
    ]);
    // Model the historical creator leaving the organization before opening the
    // dashboard. Stale RFx/response identity fields must not preserve access.
    await db.collection("orgMembers").doc(`managed-org_${formerCreator.uid}`).delete();

    const managerResult = await callFunction<{
      rfx: Array<Record<string, unknown>>;
      manageableRfxIds: string[];
      managerOrganizations: Array<{ orgId: string; role: string; name?: string }>;
      activeCount: number;
      publisherActiveCounts: { individual: number; organizations: Record<string, number> };
      dashboardMetrics: {
        activeBidCount: number;
        activeBidCountTruncated: boolean;
        receivedResponseCount: number;
        receivedResponseCountTruncated: boolean;
      };
    }>(manager, "rfx_listManaged", { maxResults: 20, includeDashboardMetrics: true });
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
    expect(managerResult.dashboardMetrics).toEqual({
      activeBidCount: 1,
      activeBidCountTruncated: false,
      receivedResponseCount: 1,
      receivedResponseCountTruncated: false,
    });

    const formerCreatorResult = await callFunction<{
      rfx: Array<Record<string, unknown>>;
      manageableRfxIds: string[];
      managerOrganizations: Array<{ orgId: string }>;
      activeCount: number;
      publisherActiveCounts: { individual: number; organizations: Record<string, number> };
      dashboardMetrics: {
        activeBidCount: number;
        activeBidCountTruncated: boolean;
        receivedResponseCount: number;
        receivedResponseCountTruncated: boolean;
      };
    }>(formerCreator, "rfx_listManaged", { maxResults: 20, includeDashboardMetrics: true });
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
    expect(formerCreatorResult.dashboardMetrics).toEqual({
      activeBidCount: 1,
      activeBidCountTruncated: false,
      receivedResponseCount: 1,
      receivedResponseCountTruncated: false,
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
    const spreadsheetPath = `rfxResponses/${published.id}/${respondent.uid}/requested/pricing.xls`;
    const webpPath = `rfxResponses/${published.id}/${respondent.uid}/requested/preview.webp`;

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
    await expectCallableError(
      callFunction(respondent, "rfx_prepareResponseUploads", {
        rfxId: published.id,
        attachments: [{ storagePath: webpPath, contentType: "image/webp", size: 10 }],
      }),
      "invalid-argument",
    );

    const grant = await callFunction<{
      success: boolean;
      expiresAt: number;
      allowedPathCount: number;
    }>(respondent, "rfx_prepareResponseUploads", {
      rfxId: published.id,
      attachments: [
        { storagePath, contentType: "application/pdf", size: 10 },
        { storagePath: spreadsheetPath, contentType: "application/vnd.ms-excel", size: 10 },
      ],
    });
    expect(grant).toMatchObject({ success: true, allowedPathCount: 2 });
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
    expect((await db.collection("rfxResponseUploadGrantScopes")
      .doc(published.id)
      .collection("uploadGrants")
      .doc(respondent.uid)
      .get()).data()).toMatchObject({
      rfxId: published.id,
      respondentUid: respondent.uid,
      allowedStoragePaths: [storagePath, spreadsheetPath],
    });

    const spreadsheetUpload = await privateStorageRequest(
      respondent,
      "upload",
      spreadsheetPath,
      new TextEncoder().encode("spreadsheet"),
      "application/vnd.ms-excel",
    );
    expect(spreadsheetUpload.status).toBe(201);
    await db.collection("rfxResponseUploadGrantScopes").doc(published.id)
      .collection("uploadGrants").doc(respondent.uid).update({
        allowedStoragePaths: [storagePath, spreadsheetPath, webpPath],
      });
    const webpUpload = await privateStorageRequest(
      respondent,
      "upload",
      webpPath,
      new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      "image/webp",
    );
    expect(webpUpload.status).toBe(400);

    await expect(
      uploadBytes(
        storageRef(respondent.storage, storagePath),
        new TextEncoder().encode("proposal"),
        { contentType: "application/pdf" },
      ),
    ).rejects.toBeDefined();
    const uploadResponse = await privateStorageRequest(
      respondent,
      "upload",
      storagePath,
      new TextEncoder().encode("proposal"),
    );
    expect(uploadResponse.status).toBe(201);
    expect(await uploadResponse.json()).toMatchObject({
      success: true,
      idempotent: false,
      storagePath,
      contentType: "application/pdf",
      size: 8,
    });
    const uploadReplay = await privateStorageRequest(
      respondent,
      "upload",
      storagePath,
      new TextEncoder().encode("proposal"),
    );
    expect(uploadReplay.status).toBe(200);
    expect(await uploadReplay.json()).toMatchObject({ success: true, idempotent: true });
    const [storedMetadata] = await getAdminStorage(adminApp).bucket().file(storagePath).getMetadata();
    expect(storedMetadata.cacheControl).toContain("private");
    expect(storedMetadata.metadata).not.toHaveProperty("firebaseStorageDownloadTokens");
    await expect(getMetadata(storageRef(respondent.storage, storagePath))).rejects.toBeDefined();
    await expect(getDownloadURL(storageRef(respondent.storage, storagePath))).rejects.toBeDefined();
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

    await callFunction(owner, "rfx_prepareResponseDownload", {
      rfxId: published.id,
      respondentUid: respondent.uid,
      storagePath,
    });
    const downloadResponse = await privateStorageRequest(owner, "download", storagePath);
    expect(downloadResponse.status).toBe(200);
    expect(await downloadResponse.text()).toBe("proposal");
  });

  it("materializes exact short-lived response read grants from current authority", async () => {
    const respondent = await createActor("rfx-read-respondent");
    const respondentColleague = await createActor("rfx-read-colleague");
    const issuerManager = await createActor("rfx-read-issuer-manager");
    const malformedMember = await createActor("rfx-read-malformed-member");
    const malformedFormerCreator = await createActor("rfx-read-malformed-former-creator");
    const outsider = await createActor("rfx-read-outsider");
    const rfxId = "rfx-read-grant";
    const storagePath = `rfxResponses/${rfxId}/${respondent.uid}/proposal.pdf`;
    const nullOrgRfxId = "rfx-null-org-scope";
    const emptyOrgRfxId = "rfx-empty-org-scope";
    const nullOrgPath = `rfxResponses/${nullOrgRfxId}/${respondent.uid}/proposal.pdf`;
    const emptyOrgPath = `rfxResponses/${emptyOrgRfxId}/${respondent.uid}/proposal.pdf`;
    const nullMarkerPath = `rfxResponses/${rfxId}/${outsider.uid}/null-marker.pdf`;
    const emptyMarkerPath = `rfxResponses/${rfxId}/${malformedMember.uid}/empty-marker.pdf`;
    await Promise.all([
      db.collection("orgs").doc("read-respondent-org").set({
        id: "read-respondent-org",
        status: "active",
      }),
      db.collection("orgs").doc("read-issuer-org").set({
        id: "read-issuer-org",
        status: "active",
      }),
      db.collection("orgMembers").doc(`read-respondent-org_${respondent.uid}`).set({
        orgId: "read-respondent-org",
        uid: respondent.uid,
        role: "owner",
      }),
      db.collection("orgMembers").doc(`read-respondent-org_${respondentColleague.uid}`).set({
        orgId: "read-respondent-org",
        uid: respondentColleague.uid,
        role: "member",
      }),
      db.collection("orgMembers").doc(`read-issuer-org_${issuerManager.uid}`).set({
        orgId: "read-issuer-org",
        uid: issuerManager.uid,
        role: "owner",
      }),
      db.collection("orgMembers").doc("noncanonical-read-membership").set({
        orgId: "read-respondent-org",
        uid: malformedMember.uid,
        role: "owner",
      }),
      db.collection("rfx").doc(rfxId).set({
        id: rfxId,
        schemaVersion: 2,
        version: 1,
        ownerUid: "former-issuer",
        createdBy: "former-issuer",
        orgId: "read-issuer-org",
        status: "open",
        adminApprovalStatus: "approved",
        createdAt: Date.now(),
      }),
      db.collection("rfxResponseAccess").doc(rfxId)
        .collection("respondents").doc(respondent.uid).set({
          id: respondent.uid,
          rfxId,
          respondentUid: respondent.uid,
          respondentOrgId: "read-respondent-org",
          responseId: "read-response",
          attachmentStoragePaths: [storagePath],
          submittedAt: Date.now(),
        }),
      db.collection("rfx").doc(nullOrgRfxId).set({
        id: nullOrgRfxId,
        ownerUid: malformedFormerCreator.uid,
        createdBy: malformedFormerCreator.uid,
        orgId: null,
        status: "open",
        adminApprovalStatus: "approved",
      }),
      db.collection("rfx").doc(emptyOrgRfxId).set({
        id: emptyOrgRfxId,
        ownerUid: malformedFormerCreator.uid,
        createdBy: malformedFormerCreator.uid,
        orgId: "",
        status: "open",
        adminApprovalStatus: "approved",
      }),
      db.collection("rfxResponseAccess").doc(nullOrgRfxId)
        .collection("respondents").doc(respondent.uid).set({
          id: respondent.uid,
          rfxId: nullOrgRfxId,
          respondentUid: respondent.uid,
          responseId: "null-org-response",
          attachmentStoragePaths: [nullOrgPath],
        }),
      db.collection("rfxResponseAccess").doc(emptyOrgRfxId)
        .collection("respondents").doc(respondent.uid).set({
          id: respondent.uid,
          rfxId: emptyOrgRfxId,
          respondentUid: respondent.uid,
          responseId: "empty-org-response",
          attachmentStoragePaths: [emptyOrgPath],
        }),
      db.collection("rfxResponseAccess").doc(rfxId)
        .collection("respondents").doc(outsider.uid).set({
          id: outsider.uid,
          rfxId,
          respondentUid: outsider.uid,
          respondentOrgId: null,
          responseId: "null-marker-response",
          attachmentStoragePaths: [nullMarkerPath],
        }),
      db.collection("rfxResponseAccess").doc(rfxId)
        .collection("respondents").doc(malformedMember.uid).set({
          id: malformedMember.uid,
          rfxId,
          respondentUid: malformedMember.uid,
          respondentOrgId: "",
          responseId: "empty-marker-response",
          attachmentStoragePaths: [emptyMarkerPath],
        }),
    ]);

    for (const actor of [respondent, respondentColleague, issuerManager]) {
      const result = await callFunction<{
        success: boolean;
        expiresAt: number;
        storagePath: string;
      }>(actor, "rfx_prepareResponseDownload", {
        rfxId,
        respondentUid: respondent.uid,
        storagePath,
      });
      expect(result).toMatchObject({ success: true, storagePath });
      expect(result.expiresAt).toBeGreaterThan(Date.now());
      expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    }

    await expectCallableError(
      callFunction(outsider, "rfx_prepareResponseDownload", {
        rfxId,
        respondentUid: respondent.uid,
        storagePath,
      }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(malformedMember, "rfx_prepareResponseDownload", {
        rfxId,
        respondentUid: respondent.uid,
        storagePath,
      }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(respondent, "rfx_prepareResponseDownload", {
        rfxId,
        respondentUid: respondent.uid,
        storagePath: `rfxResponses/${rfxId}/${respondent.uid}/unreferenced.pdf`,
      }),
      "permission-denied",
    );
    const existingMarkerProbe = await expectCallableError(
      callFunction(outsider, "rfx_prepareResponseDownload", {
        rfxId,
        respondentUid: respondent.uid,
        storagePath: `rfxResponses/${rfxId}/${respondent.uid}/probe.pdf`,
      }),
      "permission-denied",
    );
    const missingMarkerProbe = await expectCallableError(
      callFunction(outsider, "rfx_prepareResponseDownload", {
        rfxId,
        respondentUid: "missing-respondent",
        storagePath: `rfxResponses/${rfxId}/missing-respondent/probe.pdf`,
      }),
      "permission-denied",
    );
    expect(missingMarkerProbe.message).toBe(existingMarkerProbe.message);

    for (const [actor, markerPath] of [
      [outsider, nullMarkerPath],
      [malformedMember, emptyMarkerPath],
    ] as const) {
      await expectCallableError(
        callFunction(actor, "rfx_prepareResponseDownload", {
          rfxId,
          respondentUid: actor.uid,
          storagePath: markerPath,
        }),
        "failed-precondition",
      );
    }

    for (const [malformedRfxId, malformedPath] of [
      [nullOrgRfxId, nullOrgPath],
      [emptyOrgRfxId, emptyOrgPath],
    ] as const) {
      await expectCallableError(
        callFunction(malformedFormerCreator, "rfx_prepareResponseDownload", {
          rfxId: malformedRfxId,
          respondentUid: respondent.uid,
          storagePath: malformedPath,
        }),
        "failed-precondition",
      );
    }

    await db.collection("orgMembers")
      .doc(`read-respondent-org_${respondentColleague.uid}`)
      .delete();
    await expectCallableError(
      callFunction(respondentColleague, "rfx_prepareResponseDownload", {
        rfxId,
        respondentUid: respondent.uid,
        storagePath,
      }),
      "permission-denied",
    );
    expect((await db.collection("rfxResponseReadGrantScopes").doc(rfxId)
      .collection("readGrants").doc(issuerManager.uid).get()).data()).toMatchObject({
      grantType: "rfx_response_read",
      rfxId,
      accessorUid: issuerManager.uid,
      allowedStoragePaths: [storagePath],
    });
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

  it("deduplicates response submission/counting across subjects and restricts evaluation to RFx authority", async () => {
    await seedReleasedTerritory();
    const owner = await createActor("rfx-owner", "admin");
    const respondent = await createActor("rfx-respondent", "member");
    const secondOrgManager = await createActor("rfx-second-org-manager", "member");
    const outsider = await createActor("rfx-outsider", "member");
    await Promise.all([
      db.collection("orgs").doc("respondent-org").set({
        id: "respondent-org",
        status: "active",
      }),
      db.collection("orgs").doc("unsubmitted-probe-org").set({
        id: "unsubmitted-probe-org",
        status: "active",
      }),
      db.collection("orgMembers").doc(`respondent-org_${respondent.uid}`).set({
        orgId: "respondent-org",
        uid: respondent.uid,
        role: "owner",
        status: "active",
      }),
      db.collection("orgMembers").doc(`respondent-org_${secondOrgManager.uid}`).set({
        orgId: "respondent-org",
        uid: secondOrgManager.uid,
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

    const markerBeforeCrossSubjectAttempt = (await db.collection("rfxResponseAccess")
      .doc(published.id)
      .collection("respondents")
      .doc(respondent.uid)
      .get()).data();
    await expectCallableError(
      callFunction(respondent, "rfx_submitResponse", {
        rfxId: published.id,
        idempotencyKey: "response-submit-cross-subject-0001",
        proposalText: "A second individual response must not replace the organization marker.",
        uploadedDocuments: [],
      }),
      "already-exists",
    );
    expect((await db.collection("rfxResponseAccess")
      .doc(published.id)
      .collection("respondents")
      .doc(respondent.uid)
      .get()).data()).toEqual(markerBeforeCrossSubjectAttempt);

    const secondManagerPath =
      `rfxResponses/${published.id}/${secondOrgManager.uid}/second-manager.pdf`;
    await expectCallableError(
      callFunction(secondOrgManager, "rfx_prepareResponseUploads", {
        rfxId: published.id,
        orgId: "respondent-org",
        attachments: [{
          storagePath: secondManagerPath,
          contentType: "application/pdf",
          size: 10,
        }],
      }),
      "already-exists",
    );
    await expectCallableError(
      callFunction(secondOrgManager, "rfx_submitResponse", {
        rfxId: published.id,
        orgId: "respondent-org",
        idempotencyKey: "response-submit-second-manager-0001",
        proposalText: "A second manager cannot collide with the existing organization response.",
        uploadedDocuments: [],
      }),
      "already-exists",
    );
    expect((await db.collection("rfxResponseUploadGrantScopes").doc(published.id)
      .collection("uploadGrants").doc(secondOrgManager.uid).get()).exists).toBe(false);

    const legacyPublished = await callFunction<{ id: string }>(
      owner,
      "rfx_publish",
      publishInput({ idempotencyKey: "legacy-org-response-publish-0001" }),
    );
    const legacyResponseId = "legacy-org-response-record";
    await db.collection("rfxResponses").doc(legacyResponseId).set({
      id: legacyResponseId,
      schemaVersion: 1,
      version: 1,
      rfxId: legacyPublished.id,
      respondentUid: respondent.uid,
      orgId: "respondent-org",
      idempotencyKey: "legacy-org-response-replay-0001",
      status: "submitted",
      submittedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const legacyReplay = await callFunction<{ id: string }>(respondent, "rfx_submitResponse", {
      rfxId: legacyPublished.id,
      orgId: "respondent-org",
      idempotencyKey: "legacy-org-response-replay-0001",
      proposalText: "Repair the access marker for a canonical legacy organization response.",
      uploadedDocuments: [],
    });
    expect(legacyReplay.id).toBe(legacyResponseId);
    expect((await db.collection("rfxResponseAccess").doc(legacyPublished.id)
      .collection("respondents").doc(respondent.uid).get()).data()).toMatchObject({
      responseId: legacyResponseId,
      respondentOrgId: "respondent-org",
    });

    const outsiderProbePath = `rfxResponses/${published.id}/${outsider.uid}/probe.pdf`;
    const submittedOrgProbe = await expectCallableError(
      callFunction(outsider, "rfx_prepareResponseUploads", {
        rfxId: published.id,
        orgId: "respondent-org",
        attachments: [{
          storagePath: outsiderProbePath,
          contentType: "application/pdf",
          size: 10,
        }],
      }),
      "failed-precondition",
    );
    const unsubmittedOrgProbe = await expectCallableError(
      callFunction(outsider, "rfx_prepareResponseUploads", {
        rfxId: published.id,
        orgId: "unsubmitted-probe-org",
        attachments: [{
          storagePath: outsiderProbePath,
          contentType: "application/pdf",
          size: 10,
        }],
      }),
      "failed-precondition",
    );
    expect(unsubmittedOrgProbe.message).toBe(submittedOrgProbe.message);

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
      db.collection("referrals").doc("legacy-mixed-referred-uid").set({
        id: "legacy-mixed-referred-uid",
        referrerUid: "legacy-referrer",
        providerUid: recipient.uid,
        referredUid: "platform-invite-account",
        clientEmail: "mixed-private-contact@example.test",
        consentStatus: "confirmed",
        status: "pending",
        createdAt: 40,
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
    expect(JSON.stringify(result)).not.toContain("mixed-private-contact@example.test");
  });

  it("rejects malformed organization memberships when listing legacy business introductions", async () => {
    const recipient = await createActor("legacy-org-recipient");
    await Promise.all([
      db.collection("orgs").doc("legacy-recipient-org").set({
        id: "legacy-recipient-org",
        status: "active",
      }),
      db.collection("orgMembers").doc("malformed-legacy-membership").set({
        orgId: "legacy-recipient-org",
        uid: recipient.uid,
        role: "member",
        status: "active",
        // Untrusted document data must never overwrite the trusted snapshot ID.
        documentId: `legacy-recipient-org_${recipient.uid}`,
      }),
      db.collection("referrals").doc("legacy-org-private-intro").set({
        id: "legacy-org-private-intro",
        type: "business_intro",
        referrerUid: "legacy-org-referrer",
        providerOrgId: "legacy-recipient-org",
        clientEmail: "org-private-contact@example.test",
        consentStatus: "confirmed",
        status: "pending",
        createdAt: 40,
      }),
    ]);

    const denied = await callFunction<{ referrals: Array<Record<string, unknown>> }>(
      recipient,
      "legacyBusinessReferral_listReceived",
      {},
    );
    expect(denied.referrals).toEqual([]);
    expect(JSON.stringify(denied)).not.toContain("org-private-contact@example.test");

    await db.collection("orgMembers").doc(`legacy-recipient-org_${recipient.uid}`).set({
      orgId: "legacy-recipient-org",
      uid: recipient.uid,
      role: "member",
      status: "active",
    });
    const authorized = await callFunction<{ referrals: Array<Record<string, unknown>> }>(
      recipient,
      "legacyBusinessReferral_listReceived",
      {},
    );
    expect(authorized.referrals.map((referral) => referral.id)).toEqual([
      "legacy-org-private-intro",
    ]);
  });

  it("uses current organization authority for legacy provider actions and gives admins no implicit lifecycle bypass", async () => {
    const formerProvider = await createActor("legacy-former-provider");
    const currentProvider = await createActor("legacy-current-provider");
    const admin = await createActor("legacy-lifecycle-admin", "admin");
    await Promise.all([
      db.collection("orgs").doc("legacy-provider-org").set({
        id: "legacy-provider-org",
        status: "active",
      }),
      db.collection("orgMembers").doc(`legacy-provider-org_${formerProvider.uid}`).set({
        orgId: "legacy-provider-org",
        uid: formerProvider.uid,
        role: "member",
        status: "active",
      }),
      db.collection("orgMembers").doc(`legacy-provider-org_${currentProvider.uid}`).set({
        orgId: "legacy-provider-org",
        uid: currentProvider.uid,
        role: "member",
        status: "active",
      }),
      db.collection("referrals").doc("legacy-org-action").set({
        id: "legacy-org-action",
        type: "business_intro",
        referrerUid: "legacy-referrer",
        providerUid: formerProvider.uid,
        providerOrgId: "legacy-provider-org",
        status: "pending",
        createdAt: 1,
      }),
      db.collection("referrals").doc("legacy-individual-action").set({
        id: "legacy-individual-action",
        type: "business_intro",
        referrerUid: "legacy-referrer",
        providerUid: formerProvider.uid,
        status: "pending",
        createdAt: 1,
      }),
    ]);

    await db.collection("orgMembers").doc(`legacy-provider-org_${formerProvider.uid}`).delete();
    await expectCallableError(
      callFunction(formerProvider, "referral_contact", { referralId: "legacy-org-action" }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(admin, "referral_contact", { referralId: "legacy-org-action" }),
      "permission-denied",
    );
    await callFunction(currentProvider, "referral_contact", { referralId: "legacy-org-action" });
    await callFunction(formerProvider, "referral_contact", { referralId: "legacy-individual-action" });
    expect((await db.collection("referrals").doc("legacy-org-action").get()).data()?.status)
      .toBe("contacted");
    expect((await db.collection("referrals").doc("legacy-individual-action").get()).data()?.status)
      .toBe("contacted");
  });

  it("materializes consent-aware exact referral evidence grants from current authority", async () => {
    const referrer = await createActor("evidence-referrer");
    const recipient = await createActor("evidence-recipient");
    const recipientColleague = await createActor("evidence-recipient-colleague");
    const outsider = await createActor("evidence-outsider");
    const referralId = "evidence-referral";
    const referrerPath =
      `businessReferralEvidence/${referralId}/${referrer.uid}/context.pdf`;
    const recipientPath =
      `businessReferralDisputeEvidence/${referralId}/${recipient.uid}/dispute.pdf`;
    await Promise.all([
      db.collection("orgs").doc("evidence-referrer-org").set({
        id: "evidence-referrer-org",
        status: "active",
      }),
      db.collection("orgs").doc("evidence-recipient-org").set({
        id: "evidence-recipient-org",
        status: "active",
      }),
      db.collection("orgMembers")
        .doc(`evidence-referrer-org_${referrer.uid}`).set({
          orgId: "evidence-referrer-org",
          uid: referrer.uid,
          role: "owner",
          status: "active",
        }),
      db.collection("orgMembers")
        .doc(`evidence-recipient-org_${recipient.uid}`).set({
          orgId: "evidence-recipient-org",
          uid: recipient.uid,
          role: "member",
          status: "active",
        }),
      db.collection("orgMembers")
        .doc(`evidence-recipient-org_${recipientColleague.uid}`).set({
          orgId: "evidence-recipient-org",
          uid: recipientColleague.uid,
          role: "member",
        }),
      db.collection("businessReferrals").doc(referralId).set({
        id: referralId,
        schemaVersion: 1,
        referrerUid: referrer.uid,
        referrerOrgId: "evidence-referrer-org",
        recipientUid: recipient.uid,
        recipientOrgId: "evidence-recipient-org",
        assignedStaffUids: [],
        status: "sent",
        consentStatus: "pending",
        compensationPolicy: { type: "none", status: "none" },
        referralType: "customer_lead",
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ]);

    const uploadGrant = await callFunction<{
      success: boolean;
      operation: string;
      allowedPathCount: number;
      expiresAt: number;
    }>(referrer, "businessReferral_prepareEvidenceAccess", {
      referralId,
      operation: "upload",
      storagePaths: [referrerPath],
    });
    expect(uploadGrant).toMatchObject({
      success: true,
      operation: "upload",
      allowedPathCount: 1,
    });
    const referralEvidence = new TextEncoder().encode("%PDF-1.4\nreferral evidence");
    await expect(
      uploadBytes(
        storageRef(referrer.storage, referrerPath),
        referralEvidence,
        { contentType: "application/pdf" },
      ),
    ).rejects.toBeDefined();
    const referralUpload = await privateStorageRequest(
      referrer,
      "upload",
      referrerPath,
      referralEvidence,
    );
    expect(referralUpload.status).toBe(201);
    const [referralMetadata] = await getAdminStorage(adminApp).bucket()
      .file(referrerPath).getMetadata();
    expect(referralMetadata.metadata).not.toHaveProperty("firebaseStorageDownloadTokens");
    await expectCallableError(
      callFunction(outsider, "businessReferral_prepareEvidenceAccess", {
        referralId,
        operation: "upload",
        storagePaths: [
          `businessReferralEvidence/${referralId}/${outsider.uid}/forged.pdf`,
        ],
      }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(recipient, "businessReferral_prepareEvidenceAccess", {
        referralId,
        operation: "read",
        storagePaths: [referrerPath],
      }),
      "permission-denied",
    );

    const referrerRead = await callFunction<{ success: boolean }>(
      referrer,
      "businessReferral_prepareEvidenceAccess",
      { referralId, operation: "read", storagePaths: [recipientPath] },
    );
    expect(referrerRead.success).toBe(true);

    await db.collection("businessReferrals").doc(referralId).update({
      consentStatus: "confirmed",
      updatedAt: Date.now(),
    });
    for (const actor of [recipient, recipientColleague]) {
      const readGrant = await callFunction<{ success: boolean; operation: string }>(
        actor,
        "businessReferral_prepareEvidenceAccess",
        { referralId, operation: "read", storagePaths: [referrerPath] },
      );
      expect(readGrant).toMatchObject({ success: true, operation: "read" });
    }
    const referralDownload = await privateStorageRequest(recipient, "download", referrerPath);
    expect(referralDownload.status).toBe(200);
    expect(await referralDownload.text()).toBe("%PDF-1.4\nreferral evidence");

    await Promise.all([
      db.collection("orgMembers").doc(`evidence-referrer-org_${referrer.uid}`).delete(),
      db.collection("orgMembers").doc(`evidence-recipient-org_${recipient.uid}`).delete(),
    ]);
    await expectCallableError(
      callFunction(referrer, "businessReferral_prepareEvidenceAccess", {
        referralId,
        operation: "read",
        storagePaths: [recipientPath],
      }),
      "permission-denied",
    );
    await expectCallableError(
      callFunction(recipient, "businessReferral_prepareEvidenceAccess", {
        referralId,
        operation: "read",
        storagePaths: [referrerPath],
      }),
      "permission-denied",
    );
    expect((await callFunction<{ success: boolean }>(
      recipientColleague,
      "businessReferral_prepareEvidenceAccess",
      { referralId, operation: "read", storagePaths: [referrerPath] },
    )).success).toBe(true);

    await db.collection("orgs").doc("evidence-recipient-org").update({
      status: "suspended",
    });
    await expectCallableError(
      callFunction(recipientColleague, "businessReferral_prepareEvidenceAccess", {
        referralId,
        operation: "read",
        storagePaths: [referrerPath],
      }),
      "permission-denied",
    );
    expect((await db.collection("businessReferralStorageGrantScopes").doc(referralId)
      .collection("storageGrants").doc(recipient.uid).get()).data()).toMatchObject({
      grantType: "business_referral_storage",
      referralId,
      accessorUid: recipient.uid,
      allowedReadStoragePaths: [referrerPath],
    });
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
      db.collection("referrals").doc("mixed-referred-uid-referral").set({
        id: "mixed-referred-uid-referral",
        referrerUid: "inviter",
        providerUid: "provider",
        referredUid: invitee.uid,
        clientEmail: "referred-uid-private@example.test",
        consentStatus: "confirmed",
        status: "pending",
        createdAt: 40,
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
    expect(JSON.stringify(result)).not.toContain("referred-uid-private@example.test");
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
    await db.collection("orgMembers").doc(`recipient-org_${recipient.uid}`).set({
      orgId: "recipient-org", uid: recipient.uid, role: "owner", status: "active",
    });

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
    const overdue = await callFunction<{ referralId: string }>(referrer, "businessReferral_create", {
      idempotencyKey: "business-referral-overdue-0001",
      recipientUid: recipient.uid,
      recipientOrgId: "recipient-org",
      referralType: "business_lead",
      title: "Overdue introduction",
      needSummary: "This referral verifies that expiry is enforced in the response transaction.",
      consentStatus: "not_required",
    });
    await callFunction(referrer, "businessReferral_send", {
      referralId: overdue.referralId,
      expectedVersion: 0,
    });
    await db.collection("businessReferrals").doc(overdue.referralId).update({
      expiresAt: Date.now() - 1,
    });
    await expectCallableError(
      callFunction(recipient, "businessReferral_respond", {
        referralId: overdue.referralId,
        response: "accepted",
        expectedVersion: 1,
      }),
      "failed-precondition",
    );
    expect((await db.collection("businessReferrals").doc(overdue.referralId).get()).data()?.status)
      .toBe("sent");
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
      acceptTerms: { acknowledged: true },
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
      acceptTerms: { acknowledged: true },
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

describe("short-lived storage grant cleanup concurrency", () => {
  it("re-reads refreshed grants transactionally before deleting an expired query candidate", async () => {
    const now = Date.now();
    const readGrantRef = db.collection("rfxResponseReadGrantScopes").doc("cleanup-rfx")
      .collection("readGrants").doc("cleanup-reader");
    const storageGrantRef = db.collection("businessReferralStorageGrantScopes")
      .doc("cleanup-referral").collection("storageGrants").doc("cleanup-reader");
    const uploadGrantRef = db.collection("rfxResponseUploadGrantScopes").doc("cleanup-rfx")
      .collection("uploadGrants").doc("cleanup-uploader");
    const orphanPath = "rfxResponses/cleanup-rfx/cleanup-uploader/orphan.pdf";
    await Promise.all([
      readGrantRef.set({
        grantType: "rfx_response_read",
        expiresAt: now - 1,
      }),
      storageGrantRef.set({
        grantType: "business_referral_storage",
        expiresAt: now - 1,
      }),
      uploadGrantRef.set({
        grantType: "rfx_response_upload",
        rfxId: "cleanup-rfx",
        respondentUid: "cleanup-uploader",
        allowedStoragePaths: [orphanPath],
        expiresAt: now - 1,
      }),
      getAdminStorage(adminApp).bucket().file(orphanPath).save(Buffer.from("orphan"), {
        metadata: { contentType: "application/pdf" },
      }),
    ]);

    // Model the scheduler query observing both expired candidates, followed by
    // a callable refreshing them before cleanup reaches the delete transaction.
    const queriedCandidates = await Promise.all([
      readGrantRef.get(),
      storageGrantRef.get(),
      uploadGrantRef.get(),
    ]);
    expect(queriedCandidates.every((snapshot) => snapshot.exists)).toBe(true);
    const refreshedExpiresAt = now + 60_000;
    await Promise.all([
      readGrantRef.update({ expiresAt: refreshedExpiresAt }),
      storageGrantRef.update({ expiresAt: refreshedExpiresAt }),
      uploadGrantRef.update({ expiresAt: refreshedExpiresAt }),
    ]);

    expect(await cleanupExpiredResponseReadGrantAt(readGrantRef, now, db)).toBe(false);
    expect(await cleanupExpiredBusinessReferralStorageGrantAt(storageGrantRef, now, db))
      .toBe(false);
    expect(await cleanupExpiredResponseUploadGrantAt(uploadGrantRef, now, db)).toBe(false);
    expect((await readGrantRef.get()).data()?.expiresAt).toBe(refreshedExpiresAt);
    expect((await storageGrantRef.get()).data()?.expiresAt).toBe(refreshedExpiresAt);
    expect((await uploadGrantRef.get()).data()?.expiresAt).toBe(refreshedExpiresAt);

    await Promise.all([
      readGrantRef.update({ expiresAt: now - 1 }),
      storageGrantRef.update({ expiresAt: now - 1 }),
      uploadGrantRef.update({ expiresAt: now - 1 }),
    ]);
    expect(await cleanupExpiredResponseReadGrantAt(readGrantRef, now, db)).toBe(true);
    expect(await cleanupExpiredBusinessReferralStorageGrantAt(storageGrantRef, now, db))
      .toBe(true);
    expect(await cleanupExpiredResponseUploadGrantAt(uploadGrantRef, now, db)).toBe(true);
    expect((await readGrantRef.get()).exists).toBe(false);
    expect((await storageGrantRef.get()).exists).toBe(false);
    expect((await uploadGrantRef.get()).exists).toBe(false);
    expect((await getAdminStorage(adminApp).bucket().file(orphanPath).exists())[0]).toBe(true);
  });
});

describe("profile save and enrichment identity boundaries", () => {
  it("saves current-schema and legacy profiles without weakening the strict input contract", async () => {
    const member = await createActor("profile-current-member", "member");
    await db.collection("profiles").doc(member.uid).update({ profileSchemaVersion: 2 });

    const currentResult = await callFunction<{
      success: boolean;
      profileSchemaVersion: number;
    }>(member, "profile_update", {
      businessName: "Current Schema Member LLC",
      capabilityStatementUrl: null,
      capabilityStatementStoragePath: null,
      photoUrl: null,
      photoStoragePath: null,
      videoIntroUrl: null,
      videoIntroStoragePath: null,
      videoIntroPosterUrl: null,
      videoIntroPosterStoragePath: null,
      published: false,
    });
    expect(currentResult).toMatchObject({ success: true, profileSchemaVersion: 2 });
    expect((await db.collection("profiles").doc(member.uid).get()).data()).toMatchObject({
      uid: member.uid,
      businessName: "Current Schema Member LLC",
      profileSchemaVersion: 2,
    });

    const legacy = await createActor("profile-legacy-admin", "admin");
    await db.collection("profiles").doc(legacy.uid).set({
      uid: legacy.uid,
      businessName: "Legacy Administrator LLC",
      published: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await callFunction(legacy, "profile_update", { published: false });
    const migrated = (await db.collection("profiles").doc(legacy.uid).get()).data();
    expect(migrated).toMatchObject({
      uid: legacy.uid,
      businessName: "Legacy Administrator LLC",
      profileSchemaVersion: 2,
      createdAt: 1,
    });
    expect(Number(migrated?.legacyMigratedAt)).toBeGreaterThan(1);

    await expectCallableError(
      callFunction(member, "profile_update", {
        orgId: "browser-supplied-organization",
        published: false,
      }),
      "invalid-argument",
    );
  });

  it("links only a live server-recorded enrichment candidate owned by the caller", async () => {
    const member = await createActor("enrichment-member", "member");
    const other = await createActor("enrichment-other", "member");
    const candidate = {
      matchId: "sam_verified-candidate",
      legalName: "Verified Candidate LLC",
      state: "VA",
      uei: "SERVER-RECORDED-UEI",
      confidenceScore: 90,
      matchReason: "exact name match + state match",
      source: "sam_gov",
    };
    await db.collection("enrichmentRequests").doc("request-owned-by-member").set({
      id: "request-owned-by-member",
      uid: member.uid,
      candidates: [candidate],
      status: "open",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    const result = await callFunction<{ success: boolean; matchId: string }>(member, "enrichment_link", {
      requestId: "request-owned-by-member",
      matchId: candidate.matchId,
      selectedCandidate: { legalName: "Browser Forgery LLC", source: "manual" },
      attestationText: "I confirm I am authorized to represent this company.",
      acknowledgedConsequences: true,
    });
    expect(result).toEqual({ success: true, matchId: candidate.matchId });
    expect((await db.collection("profiles").doc(member.uid).get()).data()).toMatchObject({
      enrichmentMatchId: candidate.matchId,
      enrichmentData: candidate,
      enrichmentSource: "sam_gov",
      enrichmentProvenance: {
        requestId: "request-owned-by-member",
        provider: "sam_gov",
      },
    });

    await expectCallableError(
      callFunction(other, "enrichment_link", {
        requestId: "request-owned-by-member",
        matchId: candidate.matchId,
        attestationText: "I confirm I am authorized to represent this company.",
        acknowledgedConsequences: true,
      }),
      "permission-denied",
    );

    await db.collection("enrichmentRequests").doc("request-forged-match").set({
      id: "request-forged-match",
      uid: other.uid,
      candidates: [candidate],
      status: "open",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    await expectCallableError(
      callFunction(other, "enrichment_link", {
        requestId: "request-forged-match",
        matchId: "browser-fabricated-match",
        attestationText: "I confirm I am authorized to represent this company.",
        acknowledgedConsequences: true,
      }),
      "invalid-argument",
    );
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
