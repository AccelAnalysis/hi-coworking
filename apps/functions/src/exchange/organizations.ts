import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { writeExchangeAudit } from "./security";
import {
  createSearchTokens,
  normalizeOrganizationName,
  normalizeWebsiteDomain,
  scoreOrganizationMatch,
  ORGANIZATION_SCHEMA_VERSION,
  createOrganizationSlug,
  sanitizePublicOrganization,
} from "./organizationModel";

type OrganizationCandidate = {
  id: string;
  name: string;
  city?: string;
  state?: string;
  website?: string;
  claimStatus: "unclaimed" | "claim_pending" | "claimed";
  verificationStatus: string;
  sources: string[];
  confidenceScore: number;
  matchReason: string;
  canRequestClaim: boolean;
  external: boolean;
  authorizedActor?: boolean;
};

function getDb() { return admin.firestore(); }

function cleanString(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function assertAuthenticated(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }): asserts request is { auth: { uid: string; token?: Record<string, unknown> } } {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to search or manage organizations.");
}

function assertAdmin(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }): asserts request is { auth: { uid: string; token: Record<string, unknown> } } {
  assertAuthenticated(request);
  const role = String(request.auth.token?.role || "");
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Platform administrator required.");
  }
}

function publicClaim(doc: admin.firestore.DocumentSnapshot): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    organizationId: String(data.organizationId || ""),
    organizationName: String(data.organizationName || ""),
    organizationCity: String(data.organizationCity || ""),
    organizationState: String(data.organizationState || ""),
    organizationWebsite: String(data.organizationWebsite || ""),
    organizationSources: Array.isArray(data.organizationSources) ? data.organizationSources.map(String) : [],
    requestedBy: String(data.requestedBy || ""),
    requesterEmail: String(data.requesterEmail || ""),
    status: String(data.status || "pending"),
    reason: String(data.reason || ""),
    reviewNote: String(data.reviewNote || ""),
    reviewedBy: String(data.reviewedBy || ""),
    createdAt: Number(data.createdAt || 0),
    updatedAt: Number(data.updatedAt || 0),
    reviewedAt: Number(data.reviewedAt || 0) || null,
  };
}

async function enforceSearchRateLimit(uid: string): Promise<void> {
  const minute = Math.floor(Date.now() / 60000);
  const ref = getDb().collection("organizationSearchRateLimits").doc(`${uid}_${minute}`);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.data()?.count || 0);
    if (count >= 30) throw new HttpsError("resource-exhausted", "Too many searches. Try again shortly.");
    tx.set(ref, { uid, minute, count: count + 1, updatedAt: Date.now() }, { merge: true });
  });
}

async function searchLocalOrganizations(input: { name: string; city?: string; state?: string; website?: string }): Promise<OrganizationCandidate[]> {
  const tokens = createSearchTokens(input.name);
  if (!tokens.length) return [];
  // Search only the approved public projection. Restricted source candidates
  // are matching evidence, not a directory or claim surface.
  const orgSnap = await getDb().collection("publicOrganizations")
    .where("searchTokens", "array-contains", tokens[0])
    .limit(40)
    .get();

  const mapDocument = (doc: admin.firestore.QueryDocumentSnapshot) => {
    const data = doc.data();
    const match = scoreOrganizationMatch(input, data as { name: string; city?: string; state?: string; website?: string; websiteDomain?: string });
    return {
      id: doc.id,
      name: String(data.name || "Organization"),
      city: cleanString(data.city),
      state: cleanString(data.state),
      website: cleanString(data.website),
      claimStatus: data.claimStatus === "claimed" || data.claimStatus === "claim_pending" ? data.claimStatus : "unclaimed",
      verificationStatus: String(data.verificationStatus || "unverified"),
      // Source provenance is intentionally excluded from public search results.
      sources: [],
      confidenceScore: match.score,
      matchReason: match.reasons.join(" + ") || "name similarity",
      canRequestClaim: data.status === "active"
        && data.publicationApproved === true
        && data.claimStatus !== "claimed",
      external: false,
    } satisfies OrganizationCandidate;
  };
  return orgSnap.docs
    .filter((doc) => doc.get("status") === "active" && doc.get("publicationApproved") === true)
    .map((doc) => mapDocument(doc))
    .filter((candidate) => candidate.confidenceScore >= 30);
}

async function searchUsaSpending(name: string): Promise<OrganizationCandidate[]> {
  if (process.env.EXCHANGE_DISABLE_USASPENDING === "1") return [];
  try {
    const response = await fetch("https://api.usaspending.gov/api/v2/autocomplete/recipient/", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Hi-Coworking-Exchange/1.0" },
      body: JSON.stringify({ search_text: name, limit: 10 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      logger.warn("USAspending recipient search failed", { status: response.status });
      return [];
    }
    const payload = await response.json() as {
      results?: Record<string, Array<Record<string, unknown>>> | Array<Record<string, unknown>>;
    };
    const groups = Array.isArray(payload.results) ? [payload.results] : Object.values(payload.results || {});
    return groups.flat().slice(0, 15).map((row, index) => {
      const recipientName = cleanString(row.recipient_name || row.name) || name;
      const uei = cleanString(row.uei || row.recipient_uei || row.recipient_unique_id);
      const match = scoreOrganizationMatch({ name }, { name: recipientName });
      const stable = createHash("sha256").update(`usaspending:${uei || recipientName}:${index}`).digest("hex").slice(0, 24);
      return {
        id: `usaspending:${stable}`,
        name: recipientName,
        claimStatus: "unclaimed",
        verificationStatus: "unverified",
        sources: ["usaspending"],
        confidenceScore: match.score,
        matchReason: match.reasons.join(" + ") || "USAspending recipient name",
        canRequestClaim: false,
        external: true,
      } satisfies OrganizationCandidate;
    });
  } catch (error) {
    logger.warn("USAspending recipient search unavailable", { error });
    return [];
  }
}

async function searchActorOrganizations(
  uid: string,
  input: { name: string; city?: string; state?: string; website?: string },
): Promise<OrganizationCandidate[]> {
  const memberships = await getDb().collection("orgMembers").where("uid", "==", uid).limit(50).get();
  const active = memberships.docs.filter((document) => document.get("status") === "active");
  if (!active.length) return [];
  const snapshots = await getDb().getAll(...active.map((document) =>
    getDb().collection("orgs").doc(String(document.get("orgId")))));
  return snapshots.flatMap((snapshot) => {
    const data = snapshot.data();
    if (!snapshot.exists || !data || data.status !== "active") return [];
    const organizationName = cleanString(data.legalName || data.name) ?? "Organization";
    const match = scoreOrganizationMatch(input, {
      name: organizationName,
      city: cleanString(data.city),
      state: cleanString(data.state),
      website: cleanString(data.website),
      websiteDomain: cleanString(data.websiteDomain),
    });
    if (match.score < 30) return [];
    return [{
      id: snapshot.id,
      name: organizationName,
      city: cleanString(data.city),
      state: cleanString(data.state),
      website: cleanString(data.website),
      claimStatus: "claimed" as const,
      verificationStatus: String(data.verificationStatus || "unverified"),
      sources: [],
      confidenceScore: match.score + 1_000,
      matchReason: data.publicationApproved === true
        ? "Your organization"
        : "Your organization — directory draft",
      canRequestClaim: false,
      external: false,
      authorizedActor: true,
    }];
  });
}

function dedupeCandidates(candidates: OrganizationCandidate[]): OrganizationCandidate[] {
  const best = new Map<string, OrganizationCandidate>();
  for (const candidate of candidates) {
    const key = `${normalizeOrganizationName(candidate.name)}|${candidate.city?.toLowerCase() || ""}|${candidate.state?.toLowerCase() || ""}`;
    const existing = best.get(key);
    if (!existing || (!candidate.external && existing.external) || candidate.confidenceScore > existing.confidenceScore) {
      best.set(key, existing ? {
        ...candidate,
        sources: [...new Set([...existing.sources, ...candidate.sources])],
        confidenceScore: Math.max(existing.confidenceScore, candidate.confidenceScore),
      } : candidate);
    } else {
      existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
    }
  }
  return [...best.values()].sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 20);
}

function claimNotification(input: {
  id: string;
  uid: string;
  title: string;
  message: string;
  organizationId: string;
  createdAt: number;
}): Record<string, unknown> {
  return {
    id: input.id,
    uid: input.uid,
    type: "organization_claim",
    title: input.title,
    message: input.message,
    link: "/exchange/onboarding",
    organizationId: input.organizationId,
    read: false,
    createdAt: input.createdAt,
  };
}

export const exchange_organizationSearch = onCall(async (request) => {
  assertAuthenticated(request);
  const name = cleanString(request.data?.name, 160);
  const city = cleanString(request.data?.city, 100);
  const state = cleanString(request.data?.state, 40);
  const website = cleanString(request.data?.website, 300);
  if (!name || name.length < 2) throw new HttpsError("invalid-argument", "Enter at least two characters of the organization name.");
  await enforceSearchRateLimit(request.auth.uid);

  const [local, actorOrganizations, usaspending] = await Promise.all([
    searchLocalOrganizations({ name, city, state, website }),
    searchActorOrganizations(request.auth.uid, { name, city, state, website }),
    searchUsaSpending(name),
  ]);
  await getDb().collection("users").doc(request.auth.uid).set({
    organizationSearchCompletedAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });
  return { candidates: dedupeCandidates([...actorOrganizations, ...local, ...usaspending]) };
});

export const exchange_organizationCreate = onCall(async (request) => {
  assertAuthenticated(request);
  const name = cleanString(request.data?.name, 160);
  const city = cleanString(request.data?.city, 100);
  const state = cleanString(request.data?.state, 40)?.toUpperCase();
  const website = cleanString(request.data?.website, 300);
  const forceCreate = request.data?.forceCreate === true;
  const suppliedKey = cleanString(request.data?.idempotencyKey, 160);
  if (!name) throw new HttpsError("invalid-argument", "Organization name is required.");

  const db = getDb();
  const normalizedName = normalizeOrganizationName(name);
  const websiteDomain = normalizeWebsiteDomain(website) || "";
  const idempotencyFingerprint = createHash("sha256")
    .update(JSON.stringify({ normalizedName, city: city || "", state: state || "", websiteDomain, forceCreate }))
    .digest("hex");
  const idempotencyLookup = createHash("sha256")
    .update(suppliedKey || idempotencyFingerprint)
    .digest("hex");
  const idempotencyRef = db.collection("exchangeIdempotency")
    .doc(`${request.auth.uid}:organization_create:${idempotencyLookup.slice(0, 32)}`);
  const prior = await idempotencyRef.get();
  if (prior.exists) {
    if (prior.data()?.requestFingerprint !== idempotencyFingerprint) {
      throw new HttpsError("already-exists", "The idempotency key belongs to a different organization request.");
    }
    return {
      created: true,
      organizationId: String(prior.data()?.entityId || ""),
      idempotent: true,
    };
  }

  const possibleMatches = await searchLocalOrganizations({ name, city, state, website });
  const strongMatches = possibleMatches.filter((candidate) => candidate.confidenceScore >= 65);
  if (strongMatches.length && !forceCreate) {
    return { created: false, possibleMatches: strongMatches.slice(0, 5) };
  }

  const now = Date.now();
  const orgRef = db.collection("orgs").doc();
  const memberRef = db.collection("orgMembers").doc(`${orgRef.id}_${request.auth.uid}`);
  const membershipRef = db.collection("exchangeMemberships").doc(orgRef.id);
  const accountRef = db.collection("exchangeCreditAccounts").doc(orgRef.id);
  const publicRef = db.collection("publicOrganizations").doc(orgRef.id);
  const identityFingerprint = createHash("sha256")
    .update([normalizedName, city || "", state || "", websiteDomain].join("\u001f"))
    .digest("hex");
  const identityRef = db.collection("organizationIdentityReservations").doc(identityFingerprint);
  const org: Record<string, unknown> = {
    id: orgRef.id,
    schemaVersion: ORGANIZATION_SCHEMA_VERSION,
    name,
    legalName: name,
    tradeNames: [],
    identifiers: {},
    industries: [],
    capabilities: [],
    publicationStatus: "draft",
    activeLocationCount: 0,
    recordVersion: 0,
    canonicalName: name,
    normalizedName,
    searchTokens: createSearchTokens(name),
    slug: createOrganizationSlug(name, orgRef.id),
    website: website || "",
    websiteDomain,
    addressLine1: "",
    addressLine2: "",
    city: city || "",
    county: "",
    state: state || "",
    postalCode: "",
    latitude: null,
    longitude: null,
    geohash: "",
    homeBased: false,
    privacySuppressed: false,
    publicationApproved: false,
    addressPublicationApproved: false,
    coordinatePublicationApproved: false,
    naicsCodes: [],
    capabilityKeywords: [],
    certifications: [],
    ownerUid: request.auth.uid,
    status: "active",
    claimStatus: "claimed",
    verificationStatus: "unverified",
    exchangeVerificationStatus: "claimed",
    resourceProviderStatus: "none",
    issuerStatus: "none",
    sources: ["manual"],
    sourceIds: {},
    sourceProvenance: [{ source: "manual", importedAt: now }],
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.runTransaction(async (tx) => {
    const [retry, identity] = await Promise.all([
      tx.get(idempotencyRef),
      forceCreate ? Promise.resolve(null) : tx.get(identityRef),
    ]);
    if (retry.exists) {
      if (retry.data()?.requestFingerprint !== idempotencyFingerprint) {
        throw new HttpsError("already-exists", "The idempotency key belongs to a different organization request.");
      }
      return {
        created: true,
        organizationId: String(retry.data()?.entityId || ""),
        idempotent: true,
      };
    }
    if (identity?.exists) {
      const sameCreator = identity.data()?.createdByUid === request.auth.uid;
      return {
        created: sameCreator,
        organizationId: String(identity.data()?.organizationId || ""),
        idempotent: true,
        duplicatePrevented: true,
      };
    }
    tx.create(orgRef, org);
    tx.create(memberRef, {
      id: memberRef.id,
      orgId: orgRef.id,
      uid: request.auth.uid,
      role: "owner",
      status: "active",
      permissions: ["view_exchange", "edit_profile", "respond_to_opportunities", "manage_referrals", "spend_credits", "purchase_credits", "manage_billing", "manage_members"],
      joinedAt: now,
      updatedAt: now,
    });
    tx.create(membershipRef, {
      organizationId: orgRef.id,
      tier: "free",
      status: "active",
      isFoundingMember: false,
      foundingRecognitionRetained: false,
      startedAt: now,
      pricingVersion: "free-v1",
      entitlementVersion: "free-entitlements-v1",
      createdAt: now,
      updatedAt: now,
    });
    tx.create(accountRef, {
      organizationId: orgRef.id,
      usableCredits: 0,
      hasDeficit: false,
      createdAt: now,
      updatedAt: now,
    });
    tx.create(publicRef, sanitizePublicOrganization(orgRef.id, org));
    tx.create(idempotencyRef, {
      uid: request.auth.uid,
      action: "organization.create",
      entityId: orgRef.id,
      status: "completed",
      requestFingerprint: idempotencyFingerprint,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
    });
    tx.set(db.collection("exchangeWorkspacePreferences").doc(request.auth.uid), {
      uid: request.auth.uid,
      actorOrganizationId: orgRef.id,
      updatedAt: now,
    }, { merge: true });
    if (!forceCreate) {
      tx.create(identityRef, {
        id: identityRef.id,
        organizationId: orgRef.id,
        normalizedName,
        websiteDomain,
        createdByUid: request.auth.uid,
        createdAt: now,
      });
    }
    writeExchangeAudit(tx, db, {
      actorUid: request.auth.uid,
      actorRole: String(request.auth.token?.role || "member"),
      action: "organization.created",
      entityType: "organization",
      entityId: orgRef.id,
      orgId: orgRef.id,
      actorOrganizationId: orgRef.id,
      subjectOrganizationId: orgRef.id,
      newStatus: "claimed",
      metadata: { source: "manual" },
      createdAt: now,
    });
    return { created: true, organizationId: orgRef.id, idempotent: false };
  });
  return result;
});

export const exchange_organizationRequestClaim = onCall(async (request) => {
  assertAuthenticated(request);
  const requestedId = cleanString(request.data?.organizationId, 200);
  const reason = cleanString(request.data?.reason, 1000);
  if (!requestedId || requestedId.startsWith("usaspending:") || requestedId.startsWith("source:")) {
    throw new HttpsError("failed-precondition", "External matches must be imported through a governed source workflow before they can be claimed.");
  }
  if (!reason || reason.length < 10) {
    throw new HttpsError("invalid-argument", "Explain your authority to claim this organization in at least 10 characters.");
  }

  const db = getDb();
  const organizationId = requestedId;

  const orgRef = db.collection("orgs").doc(organizationId);
  const publicRef = db.collection("publicOrganizations").doc(organizationId);
  const claimRef = db.collection("organizationClaims").doc(`${organizationId}_${request.auth.uid}`);
  await db.runTransaction(async (tx) => {
    const [orgSnap, publicSnap, claimSnap] = await Promise.all([
      tx.get(orgRef),
      tx.get(publicRef),
      tx.get(claimRef),
    ]);
    let org = orgSnap.data();
    const now = Date.now();
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    if (org?.status !== "active") throw new HttpsError("failed-precondition", "Organization is unavailable.");
    if (org?.claimStatus === "claimed") {
      if (org.ownerUid === request.auth.uid && claimSnap.data()?.status === "approved") return;
      throw new HttpsError("already-exists", "This organization is already claimed.");
    }
    if (["pending", "approved"].includes(String(claimSnap.data()?.status || ""))) return;
    tx.set(claimRef, {
      id: claimRef.id,
      organizationId,
      organizationName: String(org?.name || ""),
      organizationCity: String(org?.city || ""),
      organizationState: String(org?.state || ""),
      organizationWebsite: String(org?.website || ""),
      organizationSources: Array.isArray(org?.sources) ? org.sources.map(String) : [],
      requestedBy: request.auth.uid,
      requesterEmail: String(request.auth.token?.email || ""),
      status: "pending",
      reason,
      createdAt: Number(claimSnap.data()?.createdAt || now),
      updatedAt: now,
      reviewNote: "",
      reviewedAt: null,
      reviewedBy: "",
    }, { merge: true });
    const updatedOrg = { ...org, claimStatus: "claim_pending", exchangeVerificationStatus: "claim_pending", updatedAt: now };
    tx.set(orgRef, updatedOrg, { merge: true });
    if (publicSnap.exists && publicSnap.get("publicationApproved") === true) {
      tx.set(publicRef, sanitizePublicOrganization(organizationId, updatedOrg), { merge: true });
    }
    const notificationRef = db.collection("notifications").doc(`organization_claim_requested_${claimRef.id}`);
    tx.set(notificationRef, claimNotification({
      id: notificationRef.id,
      uid: request.auth.uid,
      title: "Organization claim submitted",
      message: `Your claim for ${String(org?.name || "this organization")} is awaiting administrator review.`,
      organizationId,
      createdAt: now,
    }));
    writeExchangeAudit(tx, db, {
      actorUid: request.auth.uid,
      actorRole: String(request.auth.token?.role || "member"),
      action: "organization.claim_requested",
      entityType: "organizationClaim",
      entityId: claimRef.id,
      orgId: organizationId,
      subjectOrganizationId: organizationId,
      previousStatus: String(org?.claimStatus || "unclaimed"),
      newStatus: "pending",
      createdAt: now,
    });
  });
  return { success: true, claimId: claimRef.id, organizationId };
});

export const exchange_organizationListMyClaims = onCall(async (request) => {
  assertAuthenticated(request);
  const snap = await getDb().collection("organizationClaims")
    .where("requestedBy", "==", request.auth.uid)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();
  return { claims: snap.docs.map(publicClaim) };
});

export const exchange_adminListOrganizationClaims = onCall(async (request) => {
  assertAdmin(request);
  const status = cleanString(request.data?.status, 20) || "pending";
  if (!["pending", "approved", "rejected", "all"].includes(status)) {
    throw new HttpsError("invalid-argument", "Unsupported claim status.");
  }
  let query: admin.firestore.Query = getDb().collection("organizationClaims");
  if (status !== "all") query = query.where("status", "==", status);
  const snap = await query.orderBy("updatedAt", "desc").limit(100).get();
  return { claims: snap.docs.map(publicClaim) };
});

export const exchange_adminGetOrganizationClaim = onCall(async (request) => {
  assertAdmin(request);
  const claimId = cleanString(request.data?.claimId, 300);
  if (!claimId) throw new HttpsError("invalid-argument", "claimId is required.");
  const snap = await getDb().collection("organizationClaims").doc(claimId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Claim not found.");
  const organizationId = String(snap.data()?.organizationId || "");
  const organization = await getDb().collection("orgs").doc(organizationId).get();
  const data = organization.data() || {};
  return {
    claim: publicClaim(snap),
    organization: {
      id: organizationId,
      name: String(data.name || ""),
      city: String(data.city || ""),
      state: String(data.state || ""),
      website: String(data.website || ""),
      sources: Array.isArray(data.sources) ? data.sources.map(String) : [],
      claimStatus: String(data.claimStatus || "unclaimed"),
      verificationStatus: String(data.verificationStatus || "unverified"),
    },
  };
});

export const exchange_adminReviewOrganizationClaim = onCall(async (request) => {
  assertAdmin(request);
  const claimId = cleanString(request.data?.claimId, 300);
  const decision = cleanString(request.data?.decision, 20);
  const reviewNote = cleanString(request.data?.reviewNote, 1000);
  if (!claimId || !["approve", "reject"].includes(decision || "") || !reviewNote) {
    throw new HttpsError("invalid-argument", "claimId, approve/reject decision, and reviewNote are required.");
  }
  const db = getDb();
  const claimRef = db.collection("organizationClaims").doc(claimId);
  return db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists) throw new HttpsError("not-found", "Claim not found.");
    const claim = claimSnap.data() || {};
    const nextStatus = decision === "approve" ? "approved" : "rejected";
    if (claim.status === nextStatus) return { success: true, idempotent: true, status: nextStatus, organizationId: String(claim.organizationId || "") };
    if (claim.status !== "pending") throw new HttpsError("failed-precondition", "This claim has already been decided.");
    const organizationId = String(claim.organizationId || "");
    const requestedBy = String(claim.requestedBy || "");
    const orgRef = db.collection("orgs").doc(organizationId);
    const publicRef = db.collection("publicOrganizations").doc(organizationId);
    const memberRef = db.collection("orgMembers").doc(`${organizationId}_${requestedBy}`);
    const membershipRef = db.collection("exchangeMemberships").doc(organizationId);
    const accountRef = db.collection("exchangeCreditAccounts").doc(organizationId);
    const competingQuery = db.collection("organizationClaims")
      .where("organizationId", "==", organizationId)
      .where("status", "==", "pending");
    const [orgSnap, publicSnap, competing, membershipSnap, accountSnap] = await Promise.all([
      tx.get(orgRef), tx.get(publicRef), tx.get(competingQuery), tx.get(membershipRef), tx.get(accountRef),
    ]);
    if (!orgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
    const org = orgSnap.data() || {};
    if (decision === "approve" && org.claimStatus === "claimed" && org.ownerUid !== requestedBy) {
      throw new HttpsError("failed-precondition", "A competing claim has already been approved.");
    }
    const now = Date.now();
    tx.update(claimRef, { status: nextStatus, reviewNote, reviewedBy: request.auth.uid, reviewedAt: now, updatedAt: now });

    let nextClaimStatus = "unclaimed";
    let updatedOrg: Record<string, unknown> = { ...org };
    if (decision === "approve") {
      nextClaimStatus = "claimed";
      tx.set(memberRef, {
        id: memberRef.id,
        orgId: organizationId,
        uid: requestedBy,
        role: "owner",
        status: "active",
        permissions: ["view_exchange", "edit_profile", "respond_to_opportunities", "manage_referrals", "spend_credits", "purchase_credits", "manage_billing", "manage_members"],
        joinedAt: now,
        updatedAt: now,
      }, { merge: true });
      if (!membershipSnap.exists) tx.create(membershipRef, {
        organizationId,
        tier: "free",
        status: "active",
        isFoundingMember: false,
        foundingRecognitionRetained: false,
        startedAt: now,
        pricingVersion: "free-v1",
        entitlementVersion: "free-entitlements-v1",
        createdAt: now,
        updatedAt: now,
      });
      if (!accountSnap.exists) tx.create(accountRef, {
        organizationId,
        usableCredits: 0,
        hasDeficit: false,
        createdAt: now,
        updatedAt: now,
      });
      updatedOrg = {
        ...org,
        ownerUid: requestedBy,
        status: "active",
        claimStatus: "claimed",
        exchangeVerificationStatus: "claimed",
        claimedAt: now,
        claimedBy: requestedBy,
        updatedAt: now,
      };
      tx.set(orgRef, updatedOrg, { merge: true });
      tx.set(db.collection("exchangeWorkspacePreferences").doc(requestedBy), {
        uid: requestedBy,
        actorOrganizationId: organizationId,
        updatedAt: now,
      }, { merge: true });
      for (const other of competing.docs) {
        if (other.id !== claimId) {
          tx.update(other.ref, {
            status: "rejected",
            reviewNote: "Another claim was approved.",
            reviewedBy: request.auth.uid,
            reviewedAt: now,
            updatedAt: now,
          });
          const otherUid = String(other.data().requestedBy || "");
          if (otherUid) {
            const otherNotification = db.collection("notifications").doc(`organization_claim_competing_${other.id}`);
            tx.set(otherNotification, claimNotification({
              id: otherNotification.id,
              uid: otherUid,
              title: "Organization claim not approved",
              message: "Another claimant established authority for this organization.",
              organizationId,
              createdAt: now,
            }));
          }
        }
      }
    } else {
      const otherPending = competing.docs.some((doc) => doc.id !== claimId);
      nextClaimStatus = otherPending ? "claim_pending" : "unclaimed";
      updatedOrg = {
        ...org,
        claimStatus: nextClaimStatus,
        exchangeVerificationStatus: nextClaimStatus,
        updatedAt: now,
      };
      tx.set(orgRef, updatedOrg, { merge: true });
    }
    if (publicSnap.exists) {
      tx.set(publicRef, sanitizePublicOrganization(organizationId, updatedOrg), { merge: true });
    } else if (updatedOrg.publicationApproved === true) {
      tx.create(publicRef, sanitizePublicOrganization(organizationId, updatedOrg));
    }
    const notificationRef = db.collection("notifications").doc(`organization_claim_reviewed_${claimId}`);
    tx.set(notificationRef, claimNotification({
      id: notificationRef.id,
      uid: requestedBy,
      title: decision === "approve" ? "Organization claim approved" : "Organization claim not approved",
      message: decision === "approve"
        ? "You can now act for this organization in the Exchange."
        : `Your organization claim was not approved: ${reviewNote}`,
      organizationId,
      createdAt: now,
    }));
    writeExchangeAudit(tx, db, {
      actorUid: request.auth.uid,
      actorRole: String(request.auth.token?.role || "member"),
      action: `organization.claim_${nextStatus}`,
      entityType: "organizationClaim",
      entityId: claimId,
      orgId: organizationId,
      subjectOrganizationId: organizationId,
      previousStatus: "pending",
      newStatus: nextStatus,
      metadata: { subjectUid: requestedBy },
      createdAt: now,
    });
    return { success: true, idempotent: false, status: nextStatus, organizationId };
  });
});
