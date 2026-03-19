import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createHash } from "node:crypto";

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
};

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
  uei?: string;
  cage?: string;
  duns?: string;
}): string {
  const key = JSON.stringify({
    businessName: normalize(data.businessName),
    city: normalize(data.city),
    state: normalize(data.state),
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
}): Promise<EnrichmentCandidate[]> {
  const key = samGovApiKey.value();
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
      return [];
    }

    const data = (await response.json()) as {
      entityData?: Array<Record<string, unknown>>;
      entities?: Array<Record<string, unknown>>;
    };

    const rows = data.entityData || data.entities || [];
    return rows.slice(0, 15).map((row, index) => {
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
        city,
        state,
        uei,
        cage,
        duns,
        confidenceScore: score,
        matchReason: reason,
        source: "sam_gov" as const,
      };
    });
  } catch (err) {
    logger.error("SAM.gov enrichment error", { err });
    return [];
  }
}

async function searchUsaSpending(params: {
  businessName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
  duns?: string;
}): Promise<EnrichmentCandidate[]> {
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
      return [];
    }

    const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
    const rows = data.results || [];

    return rows.slice(0, 10).map((row, index) => {
      const legalName = String(row.recipient_name || row.legal_name || params.businessName);
      const city = String(row.city_name || row.city || "") || undefined;
      const state = String(row.state_code || row.state || "") || undefined;
      const uei = String(row.uei || "") || undefined;
      const duns = String(row.duns || "") || undefined;
      const { score, reason } = scoreCandidate(params, { legalName, city, state, uei, duns });

      return {
        matchId: `usaspending_${uei || duns || index}`,
        legalName,
        city,
        state,
        uei,
        duns,
        confidenceScore: score,
        matchReason: reason,
        source: "usaspending" as const,
      };
    });
  } catch (err) {
    logger.error("USAspending enrichment error", { err });
    return [];
  }
}

export const enrichment_search = onCall(
  { secrets: [samGovApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { businessName, city, state, uei, cage, duns } = request.data as {
      businessName?: string;
      city?: string;
      state?: string;
      uei?: string;
      cage?: string;
      duns?: string;
    };

    if (!businessName?.trim()) {
      throw new HttpsError("invalid-argument", "businessName is required");
    }

    await enforceRateLimit(request.auth.uid);

    const normalized = {
      businessName: businessName.trim(),
      city: city?.trim(),
      state: state?.trim(),
      uei: uei?.trim(),
      cage: cage?.trim(),
      duns: duns?.trim(),
    };

    const cacheKey = toCacheKey(normalized);
    const db = getDb();
    const cacheRef = db.collection("enrichmentCache").doc(cacheKey);
    const now = Date.now();

    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const cacheData = cacheSnap.data() as { expiresAt?: number; candidates?: EnrichmentCandidate[] } | undefined;
      if (cacheData?.expiresAt && cacheData.expiresAt > now && Array.isArray(cacheData.candidates)) {
        return { candidates: cacheData.candidates, cached: true };
      }
    }

    const [samResults, spendingResults] = await Promise.all([
      searchSamGov(normalized),
      searchUsaSpending(normalized),
    ]);

    const candidates = [...samResults, ...spendingResults]
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 20);

    await cacheRef.set(
      {
        id: cacheKey,
        query: normalized,
        candidates,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      },
      { merge: true }
    );

    return { candidates, cached: false };
  }
);

export const enrichment_link = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const uid = request.auth.uid;
  const {
    matchId,
    selectedCandidate,
    attestationText,
    acknowledgedConsequences,
  } = request.data as {
    matchId?: string;
    selectedCandidate?: Record<string, unknown>;
    attestationText?: string;
    acknowledgedConsequences?: boolean;
  };

  if (!matchId) {
    throw new HttpsError("invalid-argument", "matchId is required");
  }

  const expectedAttestation = "I confirm I am authorized to represent this company.";
  if ((attestationText || "").trim() !== expectedAttestation) {
    throw new HttpsError("invalid-argument", "Attestation text must match required confirmation");
  }

  if (!acknowledgedConsequences) {
    throw new HttpsError("invalid-argument", "You must acknowledge consequences of false representation");
  }

  const db = getDb();
  const profileRef = db.collection("profiles").doc(uid);
  const now = Date.now();

  await profileRef.set(
    {
      uid,
      enrichmentMatchId: matchId,
      enrichmentData: selectedCandidate || {},
      enrichmentSource: String(selectedCandidate?.source || "manual"),
      enrichmentLinkedAt: now,
      attestationText: expectedAttestation,
      attestationTimestamp: now,
      attestationAcknowledgedConsequences: true,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  const auditRef = db.collection("verificationAuditLog").doc();
  await auditRef.set({
    id: auditRef.id,
    uid,
    action: "enrichment_linked",
    performedBy: uid,
    details: `Linked enrichment match ${matchId}`,
    createdAt: now,
  });

  const attestationAuditRef = db.collection("verificationAuditLog").doc();
  await attestationAuditRef.set({
    id: attestationAuditRef.id,
    uid,
    action: "attestation_signed",
    performedBy: uid,
    details: "Authorization attestation completed",
    createdAt: now,
  });

  return { success: true, matchId };
});
