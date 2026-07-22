import { HttpsError, onCall } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";
import { getAuthorizedActor, getDb, writeExchangeAudit } from "./exchange/security";
import { parseCallableInput } from "./exchange/contracts";
import {
  getInvalidProfileAssetStoragePathFields,
  profileUpdateInputSchema,
  sanitizePublicProfile,
} from "./exchange/publicProfiles";
import {
  computeProfileCompleteness,
  computeProfileReadiness,
  PROFILE_SCHEMA_VERSION,
  sanitizeCanonicalProfile,
} from "./profileModel";
import { mergeOrganizationOnboardingSuggestions } from "./profileBusinessMigration";

const PROFILE_ASSET_FIELD_PAIRS = [
  ["capabilityStatementStoragePath", "capabilityStatementUrl"],
  ["photoStoragePath", "photoUrl"],
  ["videoIntroStoragePath", "videoIntroUrl"],
  ["videoIntroPosterStoragePath", "videoIntroPosterUrl"],
] as const;

const CLEARABLE_SCALAR_FIELDS = [
  "displayName",
  "professionalTitle",
  "preferredPrivateEmail",
  "preferredPrivatePhone",
  "preferredOrganizationId",
  "preferredEstablishmentId",
  "businessName",
  "bio",
  "city",
  "state",
  "domain",
  "uei",
  "duns",
  "cageCode",
  "website",
  "linkedin",
] as const;

export const profile_update = onCall(async (request) => {
  const requestId = randomUUID();
  const actor = getAuthorizedActor(request);
  let input;
  try {
    input = parseCallableInput(profileUpdateInputSchema, request.data);
  } catch (error) {
    if (error instanceof HttpsError && error.code === "invalid-argument") {
      throw new HttpsError("invalid-argument", error.message, {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        diagnosticCode: "INVALID_PROFILE_DATA",
        requestId,
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
      { fields: invalidAssetPaths, diagnosticCode: "STORAGE_REFERENCE_INVALID", requestId },
    );
  }
  const db = getDb();
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const profileRef = db.collection("profiles").doc(actor.uid);
    const publicRef = db.collection("publicProfiles").doc(actor.uid);
    const snapshot = await transaction.get(profileRef);
    const previous = snapshot.data() ?? {};
    const previousVersion = Number.isInteger(previous.profileVersion)
      ? Number(previous.profileVersion)
      : 0;
    if (input.expectedVersion !== previousVersion) {
      throw new HttpsError("aborted", "The profile changed after it was loaded", {
        diagnosticCode: "PROFILE_VERSION_CONFLICT",
        requestId,
        currentVersion: previousVersion,
      });
    }
    const merged: Record<string, unknown> = {
      ...previous,
      ...input,
      uid: actor.uid,
      createdAt: previous.createdAt ?? now,
      updatedAt: now,
      profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      profileVersion: previousVersion + 1,
      ...(previous.profileSchemaVersion === PROFILE_SCHEMA_VERSION ? {} : { legacyMigratedAt: now }),
    };
    delete merged.expectedVersion;
    const inputRecord = input as Record<string, unknown>;

    // Legacy UID-owned business fields remain readable, but are no longer
    // organization authority. Copy them into an explicit suggestion envelope
    // for owner-reviewed organization onboarding without overwriting an org.
    const suggestions = mergeOrganizationOnboardingSuggestions(previous, inputRecord);
    if (Object.keys(suggestions).length) merged.organizationOnboardingSuggestions = suggestions;

    for (const field of CLEARABLE_SCALAR_FIELDS) {
      if (inputRecord[field] === null) delete merged[field];
    }
    for (const [pathField, legacyUrlField] of PROFILE_ASSET_FIELD_PAIRS) {
      if (inputRecord[pathField] === null) delete merged[pathField];
      if (inputRecord[legacyUrlField] === null) delete merged[legacyUrlField];

      // Selecting a canonical object supersedes and removes the permanent
      // bearer URL from the private source document as well as the projection.
      if (typeof inputRecord[pathField] === "string") delete merged[legacyUrlField];
    }
    merged.profileCompletenessScore = computeProfileCompleteness(merged);
    merged.readinessTier = computeProfileReadiness(merged);

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
      requestId,
      profileVersion: merged.profileVersion as number,
      profileCompletenessScore: merged.profileCompletenessScore as number,
      readinessTier: merged.readinessTier as string,
      published: input.published,
      profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      updatedAt: now,
      publicProjectionUpdated: true,
      profile: sanitizeCanonicalProfile(merged),
    };
  });
});
