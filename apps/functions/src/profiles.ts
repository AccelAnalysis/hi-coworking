import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getAuthorizedActor, getDb, writeExchangeAudit } from "./exchange/security";
import { parseCallableInput } from "./exchange/contracts";
import {
  getInvalidProfileAssetStoragePathFields,
  profileUpdateInputSchema,
  sanitizePublicProfile,
} from "./exchange/publicProfiles";

const PROFILE_SCHEMA_VERSION = 2;

const PROFILE_ASSET_FIELD_PAIRS = [
  ["capabilityStatementStoragePath", "capabilityStatementUrl"],
  ["photoStoragePath", "photoUrl"],
  ["videoIntroStoragePath", "videoIntroUrl"],
  ["videoIntroPosterStoragePath", "videoIntroPosterUrl"],
] as const;

function computeCompleteness(profile: Record<string, unknown>): number {
  let score = 0;
  if (profile.businessName) score += 15;
  if (profile.bio) score += 10;
  if (profile.website) score += 5;
  if (profile.linkedin) score += 5;
  if (Array.isArray(profile.naicsCodes) && profile.naicsCodes.length > 0) score += 15;
  if (Array.isArray(profile.certifications) && profile.certifications.length > 0) score += 10;
  if (profile.uei) score += 10;
  if (profile.duns) score += 5;
  if (profile.cageCode) score += 5;
  if (profile.capabilityStatementStoragePath || profile.capabilityStatementUrl) score += 15;
  if (profile.photoStoragePath || profile.photoUrl) score += 5;
  return Math.min(100, score);
}

function computeReadiness(profile: Record<string, unknown>): "seat_ready" | "bid_ready" | "procurement_ready" {
  const bidReady = profile.verificationStatus === "verified"
    && Boolean(profile.capabilityStatementStoragePath || profile.capabilityStatementUrl);
  if (!bidReady) return "seat_ready";
  const procurementReady = Boolean(profile.enrichmentMatchId)
    && Number(profile.profileCompletenessScore ?? 0) >= 70
    && Boolean(profile.trustStats);
  return procurementReady ? "procurement_ready" : "bid_ready";
}

export const profile_update = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  let input;
  try {
    input = parseCallableInput(profileUpdateInputSchema, request.data);
  } catch (error) {
    if (error instanceof HttpsError && error.code === "invalid-argument") {
      throw new HttpsError("invalid-argument", error.message, {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        diagnosticCode: "INVALID_PROFILE_DATA",
      });
    }
    throw error;
  }
  const invalidAssetPaths = getInvalidProfileAssetStoragePathFields(
    actor.uid,
    input as Record<string, unknown>,
  );
  if (invalidAssetPaths.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      "Profile asset paths must belong to the authenticated profile",
      { fields: invalidAssetPaths, diagnosticCode: "STORAGE_REFERENCE_INVALID" },
    );
  }
  const db = getDb();
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const profileRef = db.collection("profiles").doc(actor.uid);
    const publicRef = db.collection("publicProfiles").doc(actor.uid);
    const snapshot = await transaction.get(profileRef);
    const previous = snapshot.data() ?? {};
    const merged: Record<string, unknown> = {
      ...previous,
      ...input,
      uid: actor.uid,
      createdAt: previous.createdAt ?? now,
      updatedAt: now,
      profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      ...(previous.profileSchemaVersion ? {} : { legacyMigratedAt: now }),
    };

    const inputRecord = input as Record<string, unknown>;
    for (const [pathField, legacyUrlField] of PROFILE_ASSET_FIELD_PAIRS) {
      if (inputRecord[pathField] === null) delete merged[pathField];
      if (inputRecord[legacyUrlField] === null) delete merged[legacyUrlField];

      // Selecting a canonical object supersedes and removes the permanent
      // bearer URL from the private source document as well as the projection.
      if (typeof inputRecord[pathField] === "string") delete merged[legacyUrlField];
    }
    merged.profileCompletenessScore = computeCompleteness(merged);
    merged.readinessTier = computeReadiness(merged);

    transaction.set(profileRef, merged);
    if (input.published) {
      transaction.set(publicRef, sanitizePublicProfile(actor.uid, merged));
    } else {
      transaction.delete(publicRef);
    }

    if (previous.published !== input.published) {
      writeExchangeAudit(transaction, db, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: input.published ? "profile.published" : "profile.unpublished",
        entityType: "profile",
        entityId: actor.uid,
        previousStatus: previous.published === true ? "published" : "private",
        newStatus: input.published ? "published" : "private",
        createdAt: now,
      });
    }

    return {
      success: true,
      profileCompletenessScore: merged.profileCompletenessScore as number,
      readinessTier: merged.readinessTier as string,
      published: input.published,
      profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    };
  });
});
