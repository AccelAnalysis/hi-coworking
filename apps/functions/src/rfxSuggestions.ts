import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

const db = admin.firestore();

interface SuggestionEntry {
  rfxId: string;
  score: number;
  reasons: string[];
}

function overlapCount(a: string[] = [], b: string[] = []): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a.map((x) => x.trim().toLowerCase()));
  return b.reduce((acc, code) => (setA.has(code.trim().toLowerCase()) ? acc + 1 : acc), 0);
}

function computeSuggestionScore(profile: Record<string, unknown>, rfx: Record<string, unknown>, releasedSet: Set<string>): SuggestionEntry {
  const reasons: string[] = [];
  let score = 0;

  const profileTerritory = typeof profile.territoryFips === "string" ? profile.territoryFips : undefined;
  const rfxTerritory = typeof rfx.territoryFips === "string" ? rfx.territoryFips : undefined;
  const rfxResponses = typeof rfx.responseCount === "number" ? rfx.responseCount : 0;
  const rfxCreatedAt = typeof rfx.createdAt === "number" ? rfx.createdAt : 0;
  const ageDays = Math.max(0, (Date.now() - rfxCreatedAt) / (1000 * 60 * 60 * 24));

  if (profileTerritory && rfxTerritory && profileTerritory === rfxTerritory) {
    score += 90;
    reasons.push("same_territory");
  } else if (rfxTerritory && releasedSet.has(rfxTerritory)) {
    score += 35;
    reasons.push("released_territory");
  }

  const profileNaics = Array.isArray(profile.naicsCodes) ? (profile.naicsCodes as string[]) : [];
  const rfxNaics = Array.isArray(rfx.naicsCodes) ? (rfx.naicsCodes as string[]) : [];
  const matches = overlapCount(profileNaics, rfxNaics);
  if (matches > 0) {
    score += Math.min(60, matches * 20);
    reasons.push("naics_overlap");
  }

  if (rfxResponses <= 2) {
    score += 15;
    reasons.push("low_competition");
  }

  score += Math.max(0, 20 - Math.floor(ageDays));
  if (ageDays < 3) reasons.push("fresh_opportunity");

  return {
    rfxId: String(rfx.id || ""),
    score,
    reasons,
  };
}

async function generateSuggestionsForUid(uid: string): Promise<{ count: number }> {
  const [profileSnap, rfxSnap, releasedTerritoriesSnap] = await Promise.all([
    db.collection("profiles").doc(uid).get(),
    db
      .collection("rfx")
      .where("status", "==", "open")
      .where("adminApprovalStatus", "==", "approved")
      .orderBy("createdAt", "desc")
      .limit(250)
      .get(),
    db.collection("territories").where("status", "==", "released").get(),
  ]);

  if (!profileSnap.exists) {
    throw new HttpsError("not-found", "Profile not found for suggestion generation.");
  }

  const profile = profileSnap.data() as Record<string, unknown>;
  const releasedSet = new Set(
    releasedTerritoriesSnap.docs
      .map((d) => d.data()?.fips)
      .filter((v): v is string => typeof v === "string")
  );

  const suggestions = rfxSnap.docs
    .map((d) => computeSuggestionScore(profile, d.data() as Record<string, unknown>, releasedSet))
    .filter((s) => s.rfxId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  await db.collection("userSuggestions").doc(uid).set(
    {
      uid,
      suggestions,
      generatedAt: Date.now(),
      expiresAt: Date.now() + 15 * 60 * 1000,
      algorithmVersion: "v1_local_first",
    },
    { merge: true }
  );

  return { count: suggestions.length };
}

export const rfx_refreshSuggestions = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const callerUid = request.auth.uid;
  const callerRole = request.auth.token.role as string | undefined;
  const targetUid =
    (callerRole === "admin" || callerRole === "master") && typeof request.data?.uid === "string"
      ? request.data.uid
      : callerUid;

  const result = await generateSuggestionsForUid(targetUid);
  return { success: true, uid: targetUid, ...result };
});

export const rfx_refreshSuggestions_scheduled = onSchedule("every 15 minutes", async () => {
  const profilesSnap = await db.collection("profiles").limit(500).get();
  let processed = 0;

  for (const profileDoc of profilesSnap.docs) {
    try {
      await generateSuggestionsForUid(profileDoc.id);
      processed += 1;
    } catch (err) {
      logger.error("Failed to generate suggestions for profile", {
        uid: profileDoc.id,
        err,
      });
    }
  }

  logger.info("RFx suggestion refresh complete", { processed });
});
