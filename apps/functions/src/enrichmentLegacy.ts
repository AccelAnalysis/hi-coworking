import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseCallableInput } from "./exchange/contracts";
import { getAuthorizedActor, writeExchangeAudit } from "./exchange/security";
import { sanitizePublicProfile } from "./exchange/publicProfiles";
import {
  computeProfileCompleteness,
  computeProfileReadiness,
  PROFILE_SCHEMA_VERSION,
  sanitizeCanonicalProfile,
} from "./profileModel";

const samGovApiKey = defineSecret("SAM_GOV_API_KEY");

type EnrichmentCandidate = {
  matchId: string;
  legalName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
  duns?: string;
  confidenceScore: number;
  matchReason: string;
  source: "sam_gov" | "usaspending";
  providers: Array<"sam_gov" | "usaspending">;
};

type EnrichmentProviderStatus = "ok" | "not_configured" | "unavailable";

type EnrichmentProviderResult = {
  candidates: EnrichmentCandidate[];
  status: EnrichmentProviderStatus;
};

const ENRICHMENT_REQUEST_TTL_MS = 30 * 60 * 1_000;
const enrichmentSearchInputSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  city: z.string().trim().max(160).optional(),
  state: z.string().trim().max(80).optional(),
  domain: z.string().trim().max(253).optional(),
  uei: z.string().trim().max(40).optional(),
  cage: z.string().trim().max(20).optional(),
  duns: z.string().trim().max(20).optional(),
}).strict();
const enrichmentFieldSchema = z.enum([
  "businessName",
  "city",
  "state",
  "uei",
  "duns",
  "cageCode",
]);
type EnrichmentField = z.infer<typeof enrichmentFieldSchema>;
const enrichmentLinkInputSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  matchId: z.string().trim().min(1).max(256),
  selectedFields: z.array(enrichmentFieldSchema).min(1).max(6),
  expectedVersion: z.number().int().nonnegative(),
  replaceExisting: z.boolean().default(false),
  attestationText: z.string().trim().max(200),
  acknowledgedConsequences: z.literal(true),
}).strict().refine(
  (value) => new Set(value.selectedFields).size === value.selectedFields.length,
  { path: ["selectedFields"], message: "selectedFields must not contain duplicates" },
);

function getDb() {
  return admin.firestore();
}

function normalize(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toCacheKey(data: {
  businessName?: string;
  city?: string;
  state?: string;
  domain?: string;
  uei?: string;
  cage?: string;
  duns?: string;
}): string {
  const key = JSON.stringify({
    businessName: normalize(data.businessName),
    city: normalize(data.city),
    state: normalize(data.state),
    domain: normalize(data.domain),
    uei: normalize(data.uei),
    cage: normalize(data.cage),
    duns: normalize(data.duns),
  });
  return createHash("sha256").update(key).digest("hex");
}

async function enforceRateLimit(uid: string, maxPerMinute = 20): Promise<void> {
  const db = getDb();
  const minuteBucket = Math.floor(Date.now() / 60000);
  const ref = db.collection("enrichmentRateLimit").doc(`${uid}_${minuteBucket}`);

  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const current = snap.exists ? (snap.data()?.count as number | undefined) ?? 0 : 0;
    if (current >= maxPerMinute) {
      throw new HttpsError("resource-exhausted", "Rate limit exceeded. Please try again shortly.");
    }

    t.set(
      ref,
      {
        uid,
        minuteBucket,
        count: current + 1,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  });
}

function scoreCandidate(
  input: { businessName: string; city?: string; state?: string; uei?: string; cage?: string; duns?: string },
  candidate: { legalName?: string; city?: string; state?: string; uei?: string; cage?: string; duns?: string }
): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  const nameInput = normalize(input.businessName);
  const nameCandidate = normalize(candidate.legalName);
  if (nameInput && nameCandidate) {
    if (nameInput === nameCandidate) {
      score += 60;
      reasons.push("exact name match");
    } else if (nameCandidate.includes(nameInput) || nameInput.includes(nameCandidate)) {
      score += 35;
      reasons.push("partial name match");
    }
  }

  if (normalize(input.city) && normalize(input.city) === normalize(candidate.city)) {
    score += 15;
    reasons.push("city match");
  }

  if (normalize(input.state) && normalize(input.state) === normalize(candidate.state)) {
    score += 10;
    reasons.push("state match");
  }

  if (normalize(input.uei) && normalize(input.uei) === normalize(candidate.uei)) {
    score += 20;
    reasons.push("uei match");
  }

  if (normalize(input.cage) && normalize(input.cage) === normalize(candidate.cage)) {
    score += 10;
    reasons.push("cage match");
  }

  if (normalize(input.duns) && normalize(input.duns) === normalize(candidate.duns)) {
    score += 10;
    reasons.push("duns match");
  }

  return {
    score: Math.min(100, score),
    reason: reasons.join(" + ") || "name/location similarity",
  };
}

async function searchSamGov(params: {
  businessName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
  duns?: string;
}): Promise<EnrichmentProviderResult> {
  const key = samGovApiKey.value().trim();
  if (!key) return { candidates: [], status: "not_configured" };
  const url = new URL("https://api.sam.gov/entity-information/v3/entities");
  url.searchParams.set("api_key", key);
  url.searchParams.set("legalBusinessName", params.businessName);
  if (params.state) url.searchParams.set("physicalStateOrProvince", params.state);
  if (params.uei) url.searchParams.set("ueiSAM", params.uei);
  if (params.cage) url.searchParams.set("cageCode", params.cage);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      logger.warn("SAM.gov request failed", { status: response.status });
      return { candidates: [], status: "unavailable" };
    }

    const data = (await response.json()) as {
      entityData?: Array<Record<string, unknown>>;
      entities?: Array<Record<string, unknown>>;
    };

    const rows = data.entityData || data.entities || [];
    const candidates = rows.slice(0, 15).map((row, index) => {
      const legalName = String(
        row.legalBusinessName || row.entityName || row.legalName || params.businessName
      );
      const city = String(row.physicalAddressCityName || row.city || "") || undefined;
      const state = String(row.physicalAddressStateOrProvinceCode || row.state || "") || undefined;
      const uei = String(row.ueiSAM || row.uei || "") || undefined;
      const cage = String(row.cageCode || row.cage || "") || undefined;
      const duns = String(row.duns || "") || undefined;
      const { score, reason } = scoreCandidate(params, { legalName, city, state, uei, cage, duns });

      return {
        matchId: `sam_${uei || cage || index}`,
        legalName,
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(uei ? { uei } : {}),
        ...(cage ? { cage } : {}),
        ...(duns ? { duns } : {}),
        confidenceScore: score,
        matchReason: reason,
        source: "sam_gov" as const,
        providers: ["sam_gov" as const],
      };
    });
    return { candidates, status: "ok" };
  } catch (error) {
    logger.warn("SAM.gov enrichment unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { candidates: [], status: "unavailable" };
  }
}

async function searchUsaSpending(params: {
  businessName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
  duns?: string;
}): Promise<EnrichmentProviderResult> {
  const url = "https://api.usaspending.gov/api/v2/recipient/duns/";

  try {
    const payload = {
      recipient_name: params.businessName,
      state: params.state,
      city: params.city,
      uei: params.uei,
      duns: params.duns,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      logger.warn("USAspending request failed", { status: response.status });
      return { candidates: [], status: "unavailable" };
    }

    const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
    const rows = data.results || [];

    const candidates = rows.slice(0, 10).map((row, index) => {
      const legalName = String(row.recipient_name || row.legal_name || params.businessName);
      const city = String(row.city_name || row.city || "") || undefined;
      const state = String(row.state_code || row.state || "") || undefined;
      const uei = String(row.uei || "") || undefined;
      const duns = String(row.duns || "") || undefined;
      const { score, reason } = scoreCandidate(params, { legalName, city, state, uei, duns });

      return {
        matchId: `usaspending_${uei || duns || index}`,
        legalName,
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(uei ? { uei } : {}),
        ...(duns ? { duns } : {}),
        confidenceScore: score,
        matchReason: reason,
        source: "usaspending" as const,
        providers: ["usaspending" as const],
      };
    });
    return { candidates, status: "ok" };
  } catch (error) {
    logger.warn("USAspending enrichment unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { candidates: [], status: "unavailable" };
  }
}

function candidateIdentity(candidate: EnrichmentCandidate): string {
  if (normalize(candidate.uei)) return `uei:${normalize(candidate.uei)}`;
  if (normalize(candidate.duns)) return `duns:${normalize(candidate.duns)}`;
  if (normalize(candidate.cage)) return `cage:${normalize(candidate.cage)}`;
  return [candidate.legalName, candidate.city, candidate.state].map(normalize).join("|");
}

function deduplicateCandidates(candidates: EnrichmentCandidate[]): EnrichmentCandidate[] {
  const unique = new Map<string, EnrichmentCandidate>();
  for (const candidate of candidates) {
    const key = candidateIdentity(candidate);
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, candidate);
      continue;
    }
    const preferred = candidate.confidenceScore > previous.confidenceScore ? candidate : previous;
    unique.set(key, {
      ...preferred,
      providers: Array.from(new Set([...previous.providers, ...candidate.providers])),
    });
  }
  return Array.from(unique.values())
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, 20);
}

async function recordEnrichmentRequest(input: {
  uid: string;
  query: Record<string, string | undefined>;
  candidates: EnrichmentCandidate[];
  providerStatus: { samGov: EnrichmentProviderStatus; usaSpending: EnrichmentProviderStatus };
  sourceCacheKey: string;
  now: number;
}): Promise<string> {
  const requestId = randomUUID();
  await getDb().collection("enrichmentRequests").doc(requestId).set({
    id: requestId,
    uid: input.uid,
    query: input.query,
    candidates: input.candidates,
    providerStatus: input.providerStatus,
    sourceCacheKey: input.sourceCacheKey,
    status: "open",
    createdAt: input.now,
    expiresAt: input.now + ENRICHMENT_REQUEST_TTL_MS,
  });
  return requestId;
}

export const enrichment_search = onCall(
  { secrets: [samGovApiKey] },
  async (request) => {
    const actor = getAuthorizedActor(request);
    const operationRequestId = randomUUID();
    let input;
    try {
      input = parseCallableInput(enrichmentSearchInputSchema, request.data);
    } catch (error) {
      if (error instanceof HttpsError) {
        throw new HttpsError(error.code, error.message, {
          ...(error.details && typeof error.details === "object" ? error.details : {}),
          diagnosticCode: "INVALID_ENRICHMENT_QUERY",
          requestId: operationRequestId,
        });
      }
      throw error;
    }

    const { businessName, city, state, domain, uei, cage, duns } = input;
    await enforceRateLimit(actor.uid);

    const normalized = {
      businessName: businessName.trim(),
      ...(city?.trim() ? { city: city.trim() } : {}),
      ...(state?.trim() ? { state: state.trim() } : {}),
      ...(domain?.trim() ? { domain: domain.trim() } : {}),
      ...(uei?.trim() ? { uei: uei.trim() } : {}),
      ...(cage?.trim() ? { cage: cage.trim() } : {}),
      ...(duns?.trim() ? { duns: duns.trim() } : {}),
    };

    const cacheKey = toCacheKey(normalized);
    const db = getDb();
    const cacheRef = db.collection("enrichmentCache").doc(cacheKey);
    const now = Date.now();

    const cacheSnap = await cacheRef.get();
    let candidates: EnrichmentCandidate[];
    let providerStatus: {
      samGov: EnrichmentProviderStatus;
      usaSpending: EnrichmentProviderStatus;
    };
    let cached = false;
    if (cacheSnap.exists) {
      const cacheData = cacheSnap.data() as {
        expiresAt?: number;
        candidates?: EnrichmentCandidate[];
        providerStatus?: {
          samGov?: EnrichmentProviderStatus;
          usaSpending?: EnrichmentProviderStatus;
        };
      } | undefined;
      if (cacheData?.expiresAt && cacheData.expiresAt > now && Array.isArray(cacheData.candidates)) {
        candidates = deduplicateCandidates(cacheData.candidates.map((candidate) => ({
          ...candidate,
          providers: Array.isArray(candidate.providers) && candidate.providers.length > 0
            ? candidate.providers
            : [candidate.source],
        })));
        providerStatus = {
          samGov: cacheData.providerStatus?.samGov ?? "unavailable",
          usaSpending: cacheData.providerStatus?.usaSpending ?? "unavailable",
        };
        cached = true;
      }
    }

    if (!cached) {
      const [samResult, spendingResult] = await Promise.all([
        searchSamGov(normalized),
        searchUsaSpending(normalized),
      ]);

      candidates = deduplicateCandidates([
        ...samResult.candidates,
        ...spendingResult.candidates,
      ]);
      providerStatus = {
        samGov: samResult.status,
        usaSpending: spendingResult.status,
      };

      await cacheRef.set(
        {
          id: cacheKey,
          query: normalized,
          candidates,
          providerStatus,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        },
        { merge: true }
      );
    }

    const requestId = await recordEnrichmentRequest({
      uid: actor.uid,
      query: normalized,
      candidates: candidates!,
      providerStatus: providerStatus!,
      sourceCacheKey: cacheKey,
      now,
    });

    return {
      requestId,
      candidates: candidates!,
      providerStatus: providerStatus!,
      cached,
      operationRequestId,
    };
  }
);

export const enrichment_link = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const operationRequestId = randomUUID();
  let input;
  try {
    input = parseCallableInput(enrichmentLinkInputSchema, request.data);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw new HttpsError(error.code, error.message, {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        diagnosticCode: "INVALID_ENRICHMENT_LINK",
        requestId: operationRequestId,
      });
    }
    throw error;
  }

  const uid = actor.uid;
  const { requestId, matchId, attestationText, selectedFields, replaceExisting } = input;
  const expectedAttestation = "I confirm I am authorized to represent this company.";
  if (attestationText !== expectedAttestation) {
    throw new HttpsError("invalid-argument", "Attestation text must match required confirmation", {
      diagnosticCode: "ATTESTATION_REQUIRED",
      requestId: operationRequestId,
    });
  }

  const db = getDb();
  const profileRef = db.collection("profiles").doc(uid);
  const requestRef = db.collection("enrichmentRequests").doc(requestId);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [requestSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(profileRef),
    ]);
    const enrichmentRequest = requestSnapshot.data();
    if (!requestSnapshot.exists || enrichmentRequest?.uid !== uid) {
      throw new HttpsError("permission-denied", "Enrichment request is not available to this account", {
        diagnosticCode: "ENRICHMENT_REQUEST_FORBIDDEN",
        requestId: operationRequestId,
      });
    }
    if (Number(enrichmentRequest.expiresAt || 0) <= now || enrichmentRequest.status !== "open") {
      throw new HttpsError("failed-precondition", "Enrichment request has expired or was already used", {
        diagnosticCode: "ENRICHMENT_REQUEST_EXPIRED_OR_USED",
        requestId: operationRequestId,
      });
    }
    const candidates = Array.isArray(enrichmentRequest.candidates)
      ? enrichmentRequest.candidates as EnrichmentCandidate[]
      : [];
    const selectedCandidate = candidates.find((candidate) => candidate.matchId === matchId);
    if (!selectedCandidate) {
      throw new HttpsError("invalid-argument", "Selected match was not returned by this enrichment request", {
        diagnosticCode: "ENRICHMENT_MATCH_INVALID",
        requestId: operationRequestId,
      });
    }

    const previous = profileSnapshot.data() ?? {};
    const previousVersion = Number.isInteger(previous.profileVersion)
      ? Number(previous.profileVersion)
      : 0;
    if (input.expectedVersion !== previousVersion) {
      throw new HttpsError("aborted", "The profile changed after enrichment review began", {
        diagnosticCode: "PROFILE_VERSION_CONFLICT",
        requestId: operationRequestId,
        currentVersion: previousVersion,
      });
    }
    if (
      typeof previous.enrichmentMatchId === "string"
      && previous.enrichmentMatchId !== matchId
      && !replaceExisting
    ) {
      throw new HttpsError("failed-precondition", "Confirm replacement of the existing enrichment link", {
        diagnosticCode: "ENRICHMENT_RELINK_CONFIRMATION_REQUIRED",
        requestId: operationRequestId,
      });
    }

    const candidateFieldValues: Record<EnrichmentField, string | undefined> = {
      businessName: selectedCandidate.legalName,
      city: selectedCandidate.city,
      state: selectedCandidate.state,
      uei: selectedCandidate.uei,
      duns: selectedCandidate.duns,
      cageCode: selectedCandidate.cage,
    };
    const appliedValues: Record<string, string> = {};
    const fieldProvenance: Record<string, unknown> = previous.enrichmentFieldProvenance
      && typeof previous.enrichmentFieldProvenance === "object"
      ? { ...previous.enrichmentFieldProvenance }
      : {};
    for (const field of selectedFields) {
      const value = candidateFieldValues[field];
      if (!value) {
        throw new HttpsError("invalid-argument", `The selected match has no value for ${field}`, {
          diagnosticCode: "ENRICHMENT_FIELD_UNAVAILABLE",
          field,
          requestId: operationRequestId,
        });
      }
      appliedValues[field] = value;
      fieldProvenance[field] = {
        provider: selectedCandidate.source,
        requestId,
        matchId,
        linkedAt: now,
      };
    }

    const merged: Record<string, unknown> = {
      ...previous,
      ...appliedValues,
      uid,
      enrichmentMatchId: matchId,
      enrichmentData: selectedCandidate,
      enrichmentSource: selectedCandidate.source,
      enrichmentProvenance: {
        requestId,
        provider: selectedCandidate.source,
        matchedAt: now,
      },
      enrichmentLinkedAt: now,
      enrichmentFieldProvenance: fieldProvenance,
      attestationText: expectedAttestation,
      attestationTimestamp: now,
      attestationAcknowledgedConsequences: true,
      updatedAt: now,
      createdAt: previous.createdAt ?? now,
      profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      profileVersion: previousVersion + 1,
    };
    merged.profileCompletenessScore = computeProfileCompleteness(merged);
    merged.readinessTier = computeProfileReadiness(merged);
    transaction.set(profileRef, merged);
    if (merged.published === true) {
      transaction.set(
        db.collection("publicProfiles").doc(uid),
        sanitizePublicProfile(uid, merged),
      );
    }
    transaction.update(requestRef, {
      status: "linked",
      linkedMatchId: matchId,
      linkedAt: now,
      appliedFields: selectedFields,
    });
    const auditRef = db.collection("verificationAuditLog").doc();
    transaction.create(auditRef, {
      id: auditRef.id,
      uid,
      action: "enrichment_linked",
      performedBy: uid,
      details: "Approved enrichment fields linked from a server-recorded candidate",
      createdAt: now,
    });
    const attestationAuditRef = db.collection("verificationAuditLog").doc();
    transaction.create(attestationAuditRef, {
      id: attestationAuditRef.id,
      uid,
      action: "attestation_signed",
      performedBy: uid,
      details: "Authorization attestation completed",
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: uid,
      actorRole: actor.role,
      action: previous.enrichmentMatchId && previous.enrichmentMatchId !== matchId
        ? "profile.enrichment_relinked"
        : "profile.enrichment_linked",
      entityType: "profile",
      entityId: uid,
      metadata: {
        provider: selectedCandidate.source,
        selectedFieldCount: selectedFields.length,
        replacedExisting: Boolean(previous.enrichmentMatchId && previous.enrichmentMatchId !== matchId),
      },
      createdAt: now,
    });

    return {
      success: true,
      requestId,
      operationRequestId,
      matchId,
      appliedFields: selectedFields,
      profileVersion: merged.profileVersion as number,
      profileCompletenessScore: merged.profileCompletenessScore as number,
      readinessTier: merged.readinessTier as string,
      profile: sanitizeCanonicalProfile(merged),
    };
  });
});
