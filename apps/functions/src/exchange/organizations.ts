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

function assertAuthenticated(request: { auth?: { uid: string } | null }): asserts request is { auth: { uid: string } } {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to search or manage organizations.");
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
    const existing = await orgRef.get();
    if (!existing.exists) {
      const now = Date.now();
      await orgRef.create({
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
    }
    resolvedOrganizationId = orgRef.id;
  }
  const orgRef = getDb().collection("orgs").doc(resolvedOrganizationId);
  const claimRef = getDb().collection("organizationClaims").doc(`${resolvedOrganizationId}_${request.auth.uid}`);
  await getDb().runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
    if (orgSnap.data()?.claimStatus === "claimed") throw new HttpsError("already-exists", "This organization is already claimed.");
    const now = Date.now();
    tx.set(claimRef, { id: claimRef.id, organizationId: resolvedOrganizationId, requestedBy: request.auth.uid, status: "pending", reason: reason || "", createdAt: now, updatedAt: now });
    tx.update(orgRef, { claimStatus: "claim_pending", updatedAt: now });
  });
  return { success: true, claimId: claimRef.id, organizationId: resolvedOrganizationId };
});
