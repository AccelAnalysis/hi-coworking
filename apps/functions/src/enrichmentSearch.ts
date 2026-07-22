import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseCallableInput } from "./exchange/contracts";
import { getAuthorizedActor } from "./exchange/security";
import {
  requestSamGovEntities,
  type SamGovEntitySearchParams,
} from "./providers/samGovClient";

const samGovApiKey = defineSecret("SAM_GOV_API_KEY");
const ENRICHMENT_REQUEST_TTL_MS = 30 * 60 * 1_000;
const HEALTHY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEGRADED_CACHE_TTL_MS = 5 * 60 * 1_000;

type EnrichmentCandidate = {
  matchId: string;
  legalName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
  duns?: string;
  registrationStatus?: string;
  registrationExpirationDate?: string;
  businessTypes?: string[];
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

const enrichmentSearchInputSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  city: z.string().trim().max(160).optional(),
  state: z.string().trim().max(80).optional(),
  domain: z.string().trim().max(253).optional(),
  uei: z.string().trim().max(40).optional(),
  cage: z.string().trim().max(20).optional(),
  duns: z.string().trim().max(20).optional(),
}).strict();

type EnrichmentSearchInput = z.infer<typeof enrichmentSearchInputSchema>;

function getDb() {
  return admin.firestore();
}

function normalize(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeState(value?: string): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  return /^[A-Za-z]{2}$/.test(cleaned) ? cleaned.toUpperCase() : cleaned;
}

function normalizeInput(input: EnrichmentSearchInput) {
  return {
    businessName: input.businessName.trim(),
    ...(input.city?.trim() ? { city: input.city.trim() } : {}),
    ...(normalizeState(input.state) ? { state: normalizeState(input.state) } : {}),
    ...(input.domain?.trim() ? { domain: input.domain.trim().toLowerCase() } : {}),
    ...(input.uei?.trim() ? { uei: input.uei.trim().toUpperCase() } : {}),
    ...(input.cage?.trim() ? { cage: input.cage.trim().toUpperCase() } : {}),
    ...(input.duns?.trim() ? { duns: input.duns.trim() } : {}),
  };
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
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const ref = db.collection("enrichmentRateLimit").doc(`${uid}_${minuteBucket}`);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists
      ? (snapshot.data()?.count as number | undefined) ?? 0
      : 0;
    if (current >= maxPerMinute) {
      throw new HttpsError("resource-exhausted", "Rate limit exceeded. Please try again shortly.");
    }

    transaction.set(ref, {
      uid,
      minuteBucket,
      count: current + 1,
      updatedAt: Date.now(),
    }, { merge: true });
  });
}

function scoreCandidate(
  input: { businessName: string; city?: string; state?: string; uei?: string; cage?: string; duns?: string },
  candidate: { legalName?: string; city?: string; state?: string; uei?: string; cage?: string; duns?: string },
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

async function searchSamGov(
  params: ReturnType<typeof normalizeInput>,
): Promise<EnrichmentProviderResult> {
  const key = samGovApiKey.value().trim();
  if (!key) return { candidates: [], status: "not_configured" };

  const searchParams: SamGovEntitySearchParams = {
    businessName: params.businessName,
    ...(params.city ? { city: params.city } : {}),
    ...(params.state ? { state: params.state } : {}),
    ...(params.uei ? { uei: params.uei } : {}),
    ...(params.cage ? { cage: params.cage } : {}),
  };
  const result = await requestSamGovEntities(searchParams, key);
  if (result.status === "unavailable") {
    logger.warn("SAM.gov entity search unavaile", result.error);
    return { candidates: [], status: "unavailable" };
  }

  const candidates = result.entities.slice(0, 10).map((entity, index) => {
    const { score, reason } = scoreCandidate(params, entity);
    return {
      matchId: `sam_${entity.uei || entity.cage || index}`,
      legalName: entity.legalName,
      ...(entity.city ? { city: entity.city } : {}),
      ...(entity.state ? { state: entity.state } : {}),
      ...(entity.uei ? { uei: entity.uei } : {}),
      ...(entity.cage ? { cage: entity.cage } : {}),
      ...(entity.registrationStatus ? { registrationStatus: entity.registrationStatus } : {}),
      ...(entity.registrationExpirationDate
        ? { registrationExpirationDate: entity.registrationExpirationDate }
        : {}),
      ...(entity.businessTypes.length > 0 ? { businessTypes: entity.businessTypes } : {}),
      confidenceScore: score,
      matchReason: reason,
      source: "sam_gov" as const,
      providers: ["sam_gov" as const],
    };
  });

  return { candidates, status: "ok" };
}

async function searchUsaSpending(
  params: ReturnType<typeof normalizeInput>,
): Promise<EnrichmentProviderResult> {
  const url = "https://api.usaspending.gov/api/v2/recipient/duns/";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        recipient_name: params.businessName,
        state: params.state,
        city: params.city,
        uei: params.uei,
        duns: params.duns,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.warn("USAspending request failed", { status: response.status });
      return { candidates: [], status: "unavailable" };
    }

    const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
    const rows = Array.isArray(data.results) ? data.results : [];
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
  if (normalize(candidate.cage)) return `cage:${normalize(candidate.cage)}`;
  if (normalize(candidate.duns)) return `duns:${normalize(candidate.duns)}`;
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
    let input: EnrichmentSearchInput;
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

    await enforceRateLimit(actor.uid);
    const normalized = normalizeInput(input);
    const cacheKey = toCacheKey(normalized);
    const db = getDb();
    const cacheRef = db.collection("enrichmentCache").doc(cacheKey);
    const now = Date.now();

    let candidates: EnrichmentCandidate[] | undefined;
    let providerStatus: {
      samGov: EnrichmentProviderStatus;
      usaSpending: EnrichmentProviderStatus;
    } | undefined;
    let cached = false;
    const cacheSnapshot = await cacheRef.get();
    if (cacheSnapshot.exists) {
      const cacheData = cacheSnapshot.data() as {
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
      const degraded = Object.values(providerStatus).includes("unavailable");
      await cacheRef.set({
        id: cacheKey,
        query: normalized,
        candidates,
        providerStatus,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + (degraded ? DEGRADED_CACHE_TTL_MS : HEALTHY_CACHE_TTL_MS),
      }, { merge: true });
    }

    const resolvedCandidates = candidates ?? [];
    const resolvedProviderStatus = providerStatus ?? {
      samGov: "unavailable" as const,
      usaSpending: "unavailable" as const,
    };
    const requestId = await recordEnrichmentRequest({
      uid: actor.uid,
      query: normalized,
      candidates: resolvedCandidates,
      providerStatus: resolvedProviderStatus,
      sourceCacheKey: cacheKey,
      now,
    });

    return {
      requestId,
      candidates: resolvedCandidates,
      providerStatus: resolvedProviderStatus,
      cached,
      operationRequestId,
    };
  },
);
