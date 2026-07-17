import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  createSearchTokens,
  normalizeOrganizationName,
  normalizeWebsiteDomain,
  scoreOrganizationMatch,
} from "./model";

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

async function searchLocalOrganizations(input: { name: string; city?: string; state?: string }): Promise<OrganizationCandidate[]> {
  const tokens = createSearchTokens(input.name);
  if (!tokens.length) return [];
  const [orgSnap, restrictedSnap] = await Promise.all([
    getDb().collection("orgs").where("searchTokens", "array-contains", tokens[0]).limit(40).get(),
    getDb().collection("organizationSourceCandidates").where("searchTokens", "array-contains", tokens[0]).limit(20).get(),
  ]);

  const mapDocument = (doc: admin.firestore.QueryDocumentSnapshot, restricted = false) => {
    const data = doc.data();
    const match = scoreOrganizationMatch(input, data as { name: string; city?: string; state?: string; website?: string; websiteDomain?: string });
    return {
      id: restricted ? `source:${doc.id}` : doc.id,
      name: String(data.name || "Organization"),
      city: cleanString(data.city),
      state: cleanString(data.state),
      website: cleanString(data.website),
      claimStatus: data.claimStatus === "claimed" || data.claimStatus === "claim_pending" ? data.claimStatus : "unclaimed",
      verificationStatus: String(data.verificationStatus || "unverified"),
      sources: Array.isArray(data.sources) ? data.sources.map(String) : ["manual"],
      confidenceScore: match.score,
      matchReason: match.reasons.join(" + ") || "name similarity",
      canRequestClaim: data.claimStatus !== "claimed",
      external: restricted,
    } satisfies OrganizationCandidate;
  };
  return [
    ...orgSnap.docs.map((doc) => mapDocument(doc)),
    ...restrictedSnap.docs.map((doc) => mapDocument(doc, true)),
  ].filter((candidate) => candidate.confidenceScore >= 30);
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

export const exchange_organizationSearch = onCall(async (request) => {
  assertAuthenticated(request);
  const name = cleanString(request.data?.name, 160);
  const city = cleanString(request.data?.city, 100);
  const state = cleanString(request.data?.state, 40);
  if (!name || name.length < 2) throw new HttpsError("invalid-argument", "Enter at least two characters of the organization name.");
  await enforceSearchRateLimit(request.auth.uid);

  const [local, usaspending] = await Promise.all([
    searchLocalOrganizations({ name, city, state }),
    searchUsaSpending(name),
  ]);
  return { candidates: dedupeCandidates([...local, ...usaspending]) };
});

export const exchange_organizationCreate = onCall(async (request) => {
  assertAuthenticated(request);
  const name = cleanString(request.data?.name, 160);
  const city = cleanString(request.data?.city, 100);
  const state = cleanString(request.data?.state, 40);
  const website = cleanString(request.data?.website, 300);
  const forceCreate = request.data?.forceCreate === true;
  if (!name) throw new HttpsError("invalid-argument", "Organization name is required.");

  const possibleMatches = await searchLocalOrganizations({ name, city, state });
  const strongMatches = possibleMatches.filter((candidate) => candidate.confidenceScore >= 65);
  if (strongMatches.length && !forceCreate) {
    return { created: false, possibleMatches: strongMatches.slice(0, 5) };
  }

  const now = Date.now();
  const orgRef = getDb().collection("orgs").doc();
  const memberRef = getDb().collection("orgMembers").doc(`${orgRef.id}_${request.auth.uid}`);
  const membershipRef = getDb().collection("organizationMemberships").doc(orgRef.id);
  const normalizedName = normalizeOrganizationName(name);
  const slugBase = normalizedName.replace(/\s+/g, "-").slice(0, 60) || "organization";
  const org = {
    id: orgRef.id,
    name,
    normalizedName,
    slug: `${slugBase}-${orgRef.id.slice(0, 6)}`,
    ownerUid: request.auth.uid,
    website: website || "",
    websiteDomain: normalizeWebsiteDomain(website) || "",
    address: "",
    city: city || "",
    state: state || "",
    seatsPurchased: 1,
    seatsUsed: 1,
    billingEmail: "",
    status: "active",
    claimStatus: "claimed",
    verificationStatus: "pending",
    sources: ["manual"],
    sourceIds: {},
    homeBased: false,
    naicsCodes: [],
    searchTokens: createSearchTokens(name),
    createdAt: now,
    updatedAt: now,
  };

  await getDb().runTransaction(async (tx) => {
    tx.create(orgRef, org);
    tx.create(memberRef, { id: memberRef.id, orgId: orgRef.id, uid: request.auth.uid, role: "owner", joinedAt: now });
    tx.create(membershipRef, {
      organizationId: orgRef.id,
      plan: "free",
      status: "free",
      cancelAtPeriodEnd: false,
      protectedRateEligible: false,
      createdAt: now,
      updatedAt: now,
    });
  });
  return { created: true, organizationId: orgRef.id };
});

export const exchange_organizationRequestClaim = onCall(async (request) => {
  assertAuthenticated(request);
  const organizationId = cleanString(request.data?.organizationId, 200);
  const reason = cleanString(request.data?.reason, 1000);
  if (!organizationId || organizationId.startsWith("usaspending:")) {
    throw new HttpsError("failed-precondition", "Import this external match before requesting a claim.");
  }
  let resolvedOrganizationId = organizationId;
  if (organizationId.startsWith("source:")) {
    const sourceId = organizationId.slice("source:".length);
    const sourceSnap = await getDb().collection("organizationSourceCandidates").doc(sourceId).get();
    if (!sourceSnap.exists) throw new HttpsError("not-found", "Source organization not found.");
    const source = sourceSnap.data() || {};
    const orgRef = getDb().collection("orgs").doc(`target_${sourceId}`);
    await getDb().runTransaction(async (tx) => {
      const existing = await tx.get(orgRef);
      if (existing.exists) return;
      const now = Date.now();
      tx.create(orgRef, {
        ...source,
        id: orgRef.id,
        slug: `${String(source.normalizedName || "organization").replace(/\s+/g, "-").slice(0, 60)}-${sourceId.slice(-6)}`,
        ownerUid: "",
        seatsPurchased: 0,
        seatsUsed: 0,
        status: "active",
        claimStatus: "unclaimed",
        verificationStatus: "unverified",
        createdAt: now,
        updatedAt: now,
      });
    });
    resolvedOrganizationId = orgRef.id;
  }
  const orgRef = getDb().collection("orgs").doc(resolvedOrganizationId);
  const claimRef = getDb().collection("organizationClaims").doc(`${resolvedOrganizationId}_${request.auth.uid}`);
  await getDb().runTransaction(async (tx) => {
    const [orgSnap, claimSnap] = await Promise.all([tx.get(orgRef), tx.get(claimRef)]);
    if (!orgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
    if (orgSnap.data()?.claimStatus === "claimed") {
      if (orgSnap.data()?.ownerUid === request.auth.uid && claimSnap.data()?.status === "approved") return;
      throw new HttpsError("already-exists", "This organization is already claimed.");
    }
    if (["pending", "approved"].includes(String(claimSnap.data()?.status || ""))) return;
    const now = Date.now();
    tx.set(claimRef, {
      id: claimRef.id,
      organizationId: resolvedOrganizationId,
      organizationName: String(orgSnap.data()?.name || ""),
      organizationCity: String(orgSnap.data()?.city || ""),
      organizationState: String(orgSnap.data()?.state || ""),
      organizationWebsite: String(orgSnap.data()?.website || ""),
      organizationSources: Array.isArray(orgSnap.data()?.sources) ? orgSnap.data()?.sources.map(String) : [],
      requestedBy: request.auth.uid,
      requesterEmail: String((request.auth as { token?: Record<string, unknown> }).token?.email || ""),
      status: "pending",
      reason: reason || "",
      createdAt: Number(claimSnap.data()?.createdAt || now),
      updatedAt: now,
      reviewNote: "",
      reviewedAt: null,
      reviewedBy: "",
    }, { merge: true });
    tx.update(orgRef, { claimStatus: "claim_pending", updatedAt: now });
  });
  return { success: true, claimId: claimRef.id, organizationId: resolvedOrganizationId };
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
    if (claim.status === nextStatus) return { success: true, idempotent: true, claim: publicClaim(claimSnap) };
    if (claim.status !== "pending") throw new HttpsError("failed-precondition", "This claim has already been decided.");
    const organizationId = String(claim.organizationId || "");
    const requestedBy = String(claim.requestedBy || "");
    const orgRef = db.collection("orgs").doc(organizationId);
    const competingQuery = db.collection("organizationClaims")
      .where("organizationId", "==", organizationId)
      .where("status", "==", "pending");
    const [orgSnap, competing] = await Promise.all([tx.get(orgRef), tx.get(competingQuery)]);
    if (!orgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
    const org = orgSnap.data() || {};
    if (decision === "approve" && !["unclaimed", "claim_pending", "claimed"].includes(String(org.claimStatus || "unclaimed"))) {
      throw new HttpsError("failed-precondition", "Organization is not in a claimable state.");
    }
    if (decision === "approve" && org.claimStatus === "claimed" && org.ownerUid !== requestedBy) {
      throw new HttpsError("failed-precondition", "A competing claim has already been approved.");
    }
    const now = Date.now();
    tx.update(claimRef, { status: nextStatus, reviewNote, reviewedBy: request.auth.uid, reviewedAt: now, updatedAt: now });
    if (decision === "approve") {
      const memberRef = db.collection("orgMembers").doc(`${organizationId}_${requestedBy}`);
      tx.set(memberRef, { id: memberRef.id, orgId: organizationId, uid: requestedBy, role: "owner", joinedAt: now }, { merge: true });
      tx.update(orgRef, {
        ownerUid: requestedBy,
        status: "active",
        claimStatus: "claimed",
        claimVerificationStatus: "verified",
        claimedAt: now,
        claimedBy: requestedBy,
        verificationStatus: org.verificationStatus || "unverified",
        updatedAt: now,
      });
      for (const other of competing.docs) {
        if (other.id !== claimId) {
          tx.update(other.ref, { status: "rejected", reviewNote: "Another claim was approved.", reviewedBy: request.auth.uid, reviewedAt: now, updatedAt: now });
        }
      }
    } else {
      const otherPending = competing.docs.some((doc) => doc.id !== claimId);
      tx.update(orgRef, { claimStatus: otherPending ? "claim_pending" : "unclaimed", updatedAt: now });
    }
    const auditRef = db.collection("exchangeAudit").doc(`organization_claim_${claimId}_${nextStatus}`);
    tx.set(auditRef, {
      entityType: "organizationClaim",
      entityId: claimId,
      organizationId,
      action: `claim_${nextStatus}`,
      actorUid: request.auth.uid,
      subjectUid: requestedBy,
      reviewNote,
      createdAt: now,
    });
    return { success: true, idempotent: false, status: nextStatus, organizationId };
  });
});
