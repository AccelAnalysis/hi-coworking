"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profile_update = void 0;
const https_1 = require("firebase-functions/v2/https");
const node_crypto_1 = require("node:crypto");
const security_1 = require("./exchange/security");
const contracts_1 = require("./exchange/contracts");
const publicProfiles_1 = require("./exchange/publicProfiles");
const profileModel_1 = require("./profileModel");
const profileBusinessMigration_1 = require("./profileBusinessMigration");
const PROFILE_ASSET_FIELD_PAIRS = [
    ["capabilityStatementStoragePath", "capabilityStatementUrl"],
    ["photoStoragePath", "photoUrl"],
    ["videoIntroStoragePath", "videoIntroUrl"],
    ["videoIntroPosterStoragePath", "videoIntroPosterUrl"],
];
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
];
exports.profile_update = (0, https_1.onCall)(async (request) => {
    const requestId = (0, node_crypto_1.randomUUID)();
    const actor = (0, security_1.getAuthorizedActor)(request);
    let input;
    try {
        input = (0, contracts_1.parseCallableInput)(publicProfiles_1.profileUpdateInputSchema, request.data);
    }
    catch (error) {
        if (error instanceof https_1.HttpsError && error.code === "invalid-argument") {
            throw new https_1.HttpsError("invalid-argument", error.message, {
                ...(error.details && typeof error.details === "object" ? error.details : {}),
                diagnosticCode: "INVALID_PROFILE_DATA",
                requestId,
            });
        }
        throw error;
    }
    const invalidAssetPaths = (0, publicProfiles_1.getInvalidProfileAssetStoragePathFields)(actor.uid, input);
    if (invalidAssetPaths.length > 0) {
        throw new https_1.HttpsError("invalid-argument", "Profile asset paths must belong to the authenticated profile", { fields: invalidAssetPaths, diagnosticCode: "STORAGE_REFERENCE_INVALID", requestId });
    }
    const db = (0, security_1.getDb)();
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
            throw new https_1.HttpsError("aborted", "The profile changed after it was loaded", {
                diagnosticCode: "PROFILE_VERSION_CONFLICT",
                requestId,
                currentVersion: previousVersion,
            });
        }
        const merged = {
            ...previous,
            ...input,
            uid: actor.uid,
            createdAt: previous.createdAt ?? now,
            updatedAt: now,
            profileSchemaVersion: profileModel_1.PROFILE_SCHEMA_VERSION,
            profileVersion: previousVersion + 1,
            ...(previous.profileSchemaVersion === profileModel_1.PROFILE_SCHEMA_VERSION ? {} : { legacyMigratedAt: now }),
        };
        delete merged.expectedVersion;
        const inputRecord = input;
        // Legacy UID-owned business fields remain readable, but are no longer
        // organization authority. Copy them into an explicit suggestion envelope
        // for owner-reviewed organization onboarding without overwriting an org.
        const suggestions = (0, profileBusinessMigration_1.mergeOrganizationOnboardingSuggestions)(previous, inputRecord);
        if (Object.keys(suggestions).length)
            merged.organizationOnboardingSuggestions = suggestions;
        for (const field of CLEARABLE_SCALAR_FIELDS) {
            if (inputRecord[field] === null)
                delete merged[field];
        }
        for (const [pathField, legacyUrlField] of PROFILE_ASSET_FIELD_PAIRS) {
            if (inputRecord[pathField] === null)
                delete merged[pathField];
            if (inputRecord[legacyUrlField] === null)
                delete merged[legacyUrlField];
            // Selecting a canonical object supersedes and removes the permanent
            // bearer URL from the private source document as well as the projection.
            if (typeof inputRecord[pathField] === "string")
                delete merged[legacyUrlField];
        }
        merged.profileCompletenessScore = (0, profileModel_1.computeProfileCompleteness)(merged);
        merged.readinessTier = (0, profileModel_1.computeProfileReadiness)(merged);
        transaction.set(profileRef, merged);
        if (input.published) {
            transaction.set(publicRef, (0, publicProfiles_1.sanitizePublicProfile)(actor.uid, merged));
        }
        else {
            transaction.delete(publicRef);
        }
        if (previous.published !== input.published) {
            (0, security_1.writeExchangeAudit)(transaction, db, {
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
            profileVersion: merged.profileVersion,
            profileCompletenessScore: merged.profileCompletenessScore,
            readinessTier: merged.readinessTier,
            published: input.published,
            profileSchemaVersion: profileModel_1.PROFILE_SCHEMA_VERSION,
            updatedAt: now,
            publicProjectionUpdated: true,
            profile: (0, profileModel_1.sanitizeCanonicalProfile)(merged),
        };
    });
});
