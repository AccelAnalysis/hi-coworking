const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

// This guarded Node runner intentionally does not use Vitest's *.test.* convention.

const PROJECT_ID = "hi-coworking-plat";
const REGION = "us-central1";
const PURPOSE = "configured-organization-lifecycle-acceptance";
const enabled = process.env.EXCHANGE_DEV_ORGANIZATION_LIFECYCLE === "true";

function readWebApiKey() {
  const source = readFileSync("apps/web/.env.local", "utf8");
  const match = source.match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(.+)$/m);
  if (!match) throw new Error("Configured Firebase web API key is unavailable");
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function normalizeName(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|corporation|company|limited|inc|corp|co|llc|ltd|pllc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function searchTokens(name) {
  return [...new Set(normalizeName(name).split(" ").filter((token) => token.length >= 2))].slice(0, 20);
}

function identityReservationId(name, city, state, websiteDomain = "") {
  return createHash("sha256")
    .update([normalizeName(name), city, state, websiteDomain].join("\u001f"))
    .digest("hex");
}

function idempotencyDocumentId(uid, key) {
  const lookup = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `${uid}:organization_create:${lookup}`;
}

function publicProjection(source) {
  return {
    id: source.id,
    schemaVersion: 2,
    name: source.name,
    normalizedName: source.normalizedName,
    searchTokens: source.searchTokens,
    slug: source.slug,
    city: source.city,
    county: source.county,
    state: source.state,
    territoryFips: source.territoryFips,
    claimStatus: "unclaimed",
    verificationStatus: "unverified",
    organizationType: "",
    industries: [],
    description: "Synthetic configured-development claim fixture.",
    website: "",
    naicsCodes: [],
    capabilityKeywords: [],
    certifications: [],
    resourceProviderStatus: "not_provider",
    resourceCategories: [],
    issuerStatus: "not_issuer",
    acceptsReferrals: false,
    publicContactAvailable: false,
    publicationApproved: true,
    status: "active",
    updatedAt: source.updatedAt,
    developmentTestPurpose: PURPOSE,
  };
}

function unclaimedOrganization(id, name, createdAt) {
  return {
    id,
    schemaVersion: 2,
    name,
    canonicalName: name,
    normalizedName: normalizeName(name),
    searchTokens: searchTokens(name),
    slug: id,
    website: "",
    websiteDomain: "",
    addressLine1: "never-publish-synthetic-address",
    addressLine2: "",
    city: "Windsor",
    county: "Isle of Wight",
    state: "VA",
    postalCode: "never-publish",
    territoryFips: "51093",
    latitude: null,
    longitude: null,
    geohash: "",
    homeBased: false,
    privacySuppressed: false,
    publicationApproved: true,
    addressPublicationApproved: false,
    coordinatePublicationApproved: false,
    naicsCodes: [],
    capabilityKeywords: [],
    certifications: [],
    status: "active",
    claimStatus: "unclaimed",
    verificationStatus: "unverified",
    exchangeVerificationStatus: "unclaimed",
    resourceProviderStatus: "none",
    issuerStatus: "none",
    sources: ["synthetic_configured_acceptance"],
    sourceIds: {},
    sourceProvenance: [{ source: "synthetic_configured_acceptance", importedAt: createdAt }],
    developmentTestPurpose: PURPOSE,
    createdAt,
    updatedAt: createdAt,
  };
}

async function signIn(apiKey, email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await response.json();
  if (!response.ok || typeof body.idToken !== "string") {
    throw new Error(`Synthetic configured sign-in failed (${response.status})`);
  }
  return body.idToken;
}

async function callFunction(name, token, data, expectedErrorStatus) {
  const response = await fetch(
    `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = await response.json();
  if (expectedErrorStatus) {
    assert.equal(body.error?.status, expectedErrorStatus);
    return body.error;
  }
  if (!response.ok || body.error) {
    throw new Error(`${name} failed: ${body.error?.status || response.status} ${body.error?.message || ""}`.trim());
  }
  return body.result;
}

async function directFirestoreRead(token, collection, documentId) {
  return fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${documentId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
}

async function deleteQueryDocuments(db, collection, field, values) {
  if (!values.length) return;
  const snapshot = values.length === 1
    ? await db.collection(collection).where(field, "==", values[0]).get()
    : await db.collection(collection).where(field, "in", values).get();
  if (!snapshot.empty) {
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
  }
}

test("configured development completes the canonical organization lifecycle", {
  skip: !enabled,
  timeout: 180_000,
}, async (context) => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const app = initializeApp({ projectId: PROJECT_ID }, `configured-organization-lifecycle-${suffix}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const apiKey = readWebApiKey();
  const createdAt = Date.now();
  const password = `Codex!${randomUUID()}9a`;
  const users = [];
  const organizationRecords = new Map();
  const createdOrganizationName = `Codex Lifecycle Created ${suffix}`;
  const createdIdempotencyKey = `configured-create-${suffix}`;
  const rejectedOrganizationId = `codex-org-rejected-${suffix}`;
  const rejectedOrganizationName = `Codex Rejected Claim ${suffix}`;
  const competingOrganizationId = `codex-org-competing-${suffix}`;
  const competingOrganizationName = `Codex Competing Claim ${suffix}`;
  const restrictedCandidateId = `codex-restricted-${suffix}`;
  let createdOrganizationId = "";

  async function createSyntheticUser(label, role = "member") {
    const email = `codex-org-lifecycle-${label}-${suffix}@example.test`;
    const user = await auth.createUser({
      email,
      password,
      displayName: `Codex Organization Lifecycle ${label} ${suffix}`,
      emailVerified: true,
    });
    await auth.setCustomUserClaims(user.uid, {
      role,
      developmentTestAccount: true,
      developmentTestPurpose: PURPOSE,
    });
    const record = { uid: user.uid, email, role };
    users.push(record);
    return record;
  }

  context.after(async () => {
    const knownUids = users.map((user) => user.uid);
    for (const user of users) {
      const record = await auth.getUser(user.uid).catch(() => null);
      if (!record) continue;
      const safe = record.email === user.email
        && record.email.startsWith("codex-org-lifecycle-")
        && record.email.endsWith("@example.test")
        && record.customClaims?.developmentTestPurpose === PURPOSE;
      if (!safe) throw new Error("Refusing synthetic lifecycle cleanup because an Auth marker did not match");
    }
    if (knownUids.length) await auth.deleteUsers(knownUids);

    for (const [organizationId, expectedName] of organizationRecords) {
      const snapshot = await db.collection("orgs").doc(organizationId).get();
      if (!snapshot.exists) continue;
      const data = snapshot.data();
      const safe = organizationId.startsWith("codex-org-")
        || (data?.name === expectedName && data?.ownerUid === users[0]?.uid);
      if (!safe || data?.name !== expectedName) {
        throw new Error("Refusing synthetic lifecycle cleanup because an organization marker did not match");
      }
    }

    await Promise.all([
      deleteQueryDocuments(db, "exchangeAudit", "actorUid", knownUids),
      deleteQueryDocuments(db, "organizationClaims", "requestedBy", knownUids),
      deleteQueryDocuments(db, "notifications", "uid", knownUids),
      deleteQueryDocuments(db, "organizationSearchRateLimits", "uid", knownUids),
    ]);

    const batch = db.batch();
    const organizationIds = [...organizationRecords.keys()];
    for (const organizationId of organizationIds) {
      batch.delete(db.collection("orgs").doc(organizationId));
      batch.delete(db.collection("publicOrganizations").doc(organizationId));
      batch.delete(db.collection("exchangeMemberships").doc(organizationId));
      batch.delete(db.collection("exchangeCreditAccounts").doc(organizationId));
      for (const user of users) {
        batch.delete(db.collection("orgMembers").doc(`${organizationId}_${user.uid}`));
        batch.delete(db.collection("organizationClaims").doc(`${organizationId}_${user.uid}`));
      }
    }
    for (const user of users) {
      batch.delete(db.collection("exchangeWorkspacePreferences").doc(user.uid));
    }
    if (users[0]) {
      batch.delete(db.collection("exchangeIdempotency").doc(
        idempotencyDocumentId(users[0].uid, createdIdempotencyKey),
      ));
    }
    batch.delete(db.collection("organizationIdentityReservations").doc(
      identityReservationId(createdOrganizationName, "Smithfield", "VA"),
    ));
    batch.delete(db.collection("organizationSourceCandidates").doc(restrictedCandidateId));
    await batch.commit();
  });

  const [creator, claimant, competitor, administrator] = await Promise.all([
    createSyntheticUser("creator"),
    createSyntheticUser("claimant"),
    createSyntheticUser("competitor"),
    createSyntheticUser("admin", "admin"),
  ]);
  const [creatorToken, claimantToken, competitorToken, administratorToken] = await Promise.all([
    signIn(apiKey, creator.email, password),
    signIn(apiKey, claimant.email, password),
    signIn(apiKey, competitor.email, password),
    signIn(apiKey, administrator.email, password),
  ]);

  const rejectedOrganization = unclaimedOrganization(
    rejectedOrganizationId,
    rejectedOrganizationName,
    createdAt,
  );
  const competingOrganization = unclaimedOrganization(
    competingOrganizationId,
    competingOrganizationName,
    createdAt,
  );
  const fixtureBatch = db.batch();
  for (const organization of [rejectedOrganization, competingOrganization]) {
    organizationRecords.set(organization.id, organization.name);
    fixtureBatch.create(db.collection("orgs").doc(organization.id), organization);
    fixtureBatch.create(db.collection("publicOrganizations").doc(organization.id), publicProjection(organization));
  }
  fixtureBatch.create(db.collection("organizationSourceCandidates").doc(restrictedCandidateId), {
    id: restrictedCandidateId,
    name: `Codex Restricted Candidate ${suffix}`,
    reviewStatus: "pending",
    publicationApproved: false,
    developmentTestPurpose: PURPOSE,
    createdAt,
    updatedAt: createdAt,
  });
  await fixtureBatch.commit();

  const created = await callFunction("exchange_organizationCreate", creatorToken, {
    name: createdOrganizationName,
    city: "Smithfield",
    state: "VA",
    idempotencyKey: createdIdempotencyKey,
  });
  assert.equal(created.created, true);
  assert.equal(created.idempotent, false);
  createdOrganizationId = created.organizationId;
  organizationRecords.set(createdOrganizationId, createdOrganizationName);
  assert.ok(createdOrganizationId);

  const createRetry = await callFunction("exchange_organizationCreate", creatorToken, {
    name: createdOrganizationName,
    city: "Smithfield",
    state: "VA",
    idempotencyKey: createdIdempotencyKey,
  });
  assert.deepEqual(createRetry, {
    created: true,
    organizationId: createdOrganizationId,
    idempotent: true,
  });
  const [createdOrg, createdPublic, createdMember, createdMembership, createdAccount] = await Promise.all([
    db.collection("orgs").doc(createdOrganizationId).get(),
    db.collection("publicOrganizations").doc(createdOrganizationId).get(),
    db.collection("orgMembers").doc(`${createdOrganizationId}_${creator.uid}`).get(),
    db.collection("exchangeMemberships").doc(createdOrganizationId).get(),
    db.collection("exchangeCreditAccounts").doc(createdOrganizationId).get(),
  ]);
  assert.equal(createdOrg.data()?.ownerUid, creator.uid);
  assert.equal(createdOrg.data()?.verificationStatus, "unverified");
  assert.equal(createdMember.data()?.status, "active");
  assert.equal(createdMember.data()?.role, "owner");
  assert.equal(createdMembership.data()?.tier, "free");
  assert.equal(createdAccount.data()?.usableCredits, 0);
  assert.equal(createdPublic.data()?.addressLine1, undefined);
  assert.equal(createdPublic.data()?.latitude, undefined);
  await Promise.all([
    createdOrg.ref.update({ developmentTestPurpose: PURPOSE }),
    createdPublic.ref.update({ developmentTestPurpose: PURPOSE }),
  ]);

  const search = await callFunction("exchange_organizationSearch", creatorToken, {
    name: rejectedOrganizationName,
    city: "Windsor",
    state: "VA",
  });
  const discovered = search.candidates.find((candidate) => candidate.id === rejectedOrganizationId);
  assert.equal(discovered?.claimStatus, "unclaimed");
  assert.equal(discovered?.canRequestClaim, true);
  assert.deepEqual(discovered?.sources, []);

  const rejectedClaim = await callFunction("exchange_organizationRequestClaim", claimantToken, {
    organizationId: rejectedOrganizationId,
    reason: "I am the authorized synthetic lifecycle claimant.",
  });
  const claimantClaims = await callFunction("exchange_organizationListMyClaims", claimantToken, {});
  assert.equal(claimantClaims.claims.some((claim) => (
    claim.id === rejectedClaim.claimId && claim.status === "pending"
  )), true);
  const pendingClaims = await callFunction("exchange_adminListOrganizationClaims", administratorToken, {
    status: "pending",
  });
  assert.equal(pendingClaims.claims.some((claim) => claim.id === rejectedClaim.claimId), true);
  const claimDetail = await callFunction("exchange_adminGetOrganizationClaim", administratorToken, {
    claimId: rejectedClaim.claimId,
  });
  assert.equal(claimDetail.organization.verificationStatus, "unverified");
  const rejection = await callFunction("exchange_adminReviewOrganizationClaim", administratorToken, {
    claimId: rejectedClaim.claimId,
    decision: "reject",
    reviewNote: "Synthetic configured rejection acceptance.",
  });
  assert.equal(rejection.status, "rejected");
  const rejectionRetry = await callFunction("exchange_adminReviewOrganizationClaim", administratorToken, {
    claimId: rejectedClaim.claimId,
    decision: "reject",
    reviewNote: "Synthetic configured rejection acceptance.",
  });
  assert.equal(rejectionRetry.idempotent, true);
  assert.equal((await db.collection("orgMembers").doc(`${rejectedOrganizationId}_${claimant.uid}`).get()).exists, false);
  assert.equal((await db.collection("orgs").doc(rejectedOrganizationId).get()).data()?.claimStatus, "unclaimed");

  const [winningClaim, losingClaim] = await Promise.all([
    callFunction("exchange_organizationRequestClaim", claimantToken, {
      organizationId: competingOrganizationId,
      reason: "I am the authorized winning synthetic claimant.",
    }),
    callFunction("exchange_organizationRequestClaim", competitorToken, {
      organizationId: competingOrganizationId,
      reason: "I am the competing synthetic claimant for acceptance.",
    }),
  ]);
  const approval = await callFunction("exchange_adminReviewOrganizationClaim", administratorToken, {
    claimId: winningClaim.claimId,
    decision: "approve",
    reviewNote: "Synthetic configured approval acceptance.",
  });
  assert.equal(approval.status, "approved");
  const approvalRetry = await callFunction("exchange_adminReviewOrganizationClaim", administratorToken, {
    claimId: winningClaim.claimId,
    decision: "approve",
    reviewNote: "Synthetic configured approval acceptance.",
  });
  assert.equal(approvalRetry.idempotent, true);
  const [winningClaimSnapshot, losingClaimSnapshot, approvedOrganization, winningMembership] = await Promise.all([
    db.collection("organizationClaims").doc(winningClaim.claimId).get(),
    db.collection("organizationClaims").doc(losingClaim.claimId).get(),
    db.collection("orgs").doc(competingOrganizationId).get(),
    db.collection("orgMembers").doc(`${competingOrganizationId}_${claimant.uid}`).get(),
  ]);
  assert.equal(winningClaimSnapshot.data()?.status, "approved");
  assert.equal(losingClaimSnapshot.data()?.status, "rejected");
  assert.equal(approvedOrganization.data()?.ownerUid, claimant.uid);
  assert.equal(approvedOrganization.data()?.claimStatus, "claimed");
  assert.equal(approvedOrganization.data()?.verificationStatus, "unverified");
  assert.equal(winningMembership.data()?.status, "active");
  assert.equal(winningMembership.data()?.role, "owner");
  const approvedPublic = await db.collection("publicOrganizations").doc(competingOrganizationId).get();
  assert.equal(approvedPublic.data()?.addressLine1, undefined);
  assert.equal(approvedPublic.data()?.postalCode, undefined);
  assert.equal(approvedPublic.data()?.latitude, undefined);

  const selfPerspective = await callFunction("exchange_resolveOrganizationPerspective", claimantToken, {
    contractVersion: 1,
    actorOrganizationId: competingOrganizationId,
    subjectOrganizationId: competingOrganizationId,
    mode: "opportunities",
  });
  assert.equal(selfPerspective.subject.contextType, "self");
  assert.equal(selfPerspective.perspective.projectionLevel, "private_owner");
  assert.equal(selfPerspective.organization.ownerUid, claimant.uid);

  const privateRead = await directFirestoreRead(competitorToken, "orgs", competingOrganizationId);
  const publicRead = await directFirestoreRead(competitorToken, "publicOrganizations", competingOrganizationId);
  const restrictedRead = await directFirestoreRead(competitorToken, "organizationSourceCandidates", restrictedCandidateId);
  const reviewRead = await directFirestoreRead(competitorToken, "organizationClaims", winningClaim.claimId);
  assert.equal(privateRead.status, 403);
  assert.equal(publicRead.status, 200);
  assert.equal(restrictedRead.status, 403);
  assert.equal(reviewRead.status, 403);

  await winningMembership.ref.update({ status: "removed", updatedAt: Date.now() });
  const actorFallback = await callFunction("exchange_listActorOrganizations", claimantToken, {
    contractVersion: 1,
    requestedActorOrganizationId: competingOrganizationId,
  });
  assert.equal(actorFallback.actors.some((actor) => actor.organizationId === competingOrganizationId), false);
  assert.equal(actorFallback.selectedActorOrganizationId, null);
  assert.equal(actorFallback.fallbackApplied, true);
  const revokedPerspective = await callFunction("exchange_resolveOrganizationPerspective", claimantToken, {
    contractVersion: 1,
    actorOrganizationId: competingOrganizationId,
    subjectOrganizationId: competingOrganizationId,
    mode: "opportunities",
  });
  assert.equal(revokedPerspective.actor.valid, false);
  assert.equal(revokedPerspective.perspective.projectionLevel, "public_claimed");
  assert.equal(revokedPerspective.organization.ownerUid, undefined);
  await callFunction("exchange_saveOrganization", claimantToken, {
    contractVersion: 1,
    actorOrganizationId: competingOrganizationId,
    action: "set",
    organizationId: rejectedOrganizationId,
    saved: true,
  }, "PERMISSION_DENIED");
});
