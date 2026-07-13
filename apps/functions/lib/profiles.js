"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profile_update = void 0;
const https_1 = require("firebase-functions/v2/https");
const security_1 = require("./exchange/security");
const contracts_1 = require("./exchange/contracts");
const publicProfiles_1 = require("./exchange/publicProfiles");
const PROFILE_ASSET_FIELD_PAIRS = [
    ["capabilityStatementStoragePath", "capabilityStatementUrl"],
    ["photoStoragePath", "photoUrl"],
    ["videoIntroStoragePath", "videoIntroUrl"],
    ["videoIntroPosterStoragePath", "videoIntroPosterUrl"],
];
function computeCompleteness(profile) {
    let score = 0;
    if (profile.businessName)
        score += 15;
    if (profile.bio)
        score += 10;
    if (profile.website)
        score += 5;
    if (profile.linkedin)
        score += 5;
    if (Array.isArray(profile.naicsCodes) && profile.naicsCodes.length > 0)
        score += 15;
    if (Array.isArray(profile.certifications) && profile.certifications.length > 0)
        score += 10;
    if (profile.uei)
        score += 10;
    if (profile.duns)
        score += 5;
    if (profile.cageCode)
        score += 5;
    if (profile.capabilityStatementStoragePath || profile.capabilityStatementUrl)
        score += 15;
    if (profile.photoStoragePath || profile.photoUrl)
        score += 5;
    return Math.min(100, score);
}
function computeReadiness(profile) {
    const bidReady = profile.verificationStatus === "verified"
        && Boolean(profile.capabilityStatementStoragePath || profile.capabilityStatementUrl);
    if (!bidReady)
        return "seat_ready";
    const procurementReady = Boolean(profile.enrichmentMatchId)
        && Number(profile.profileCompletenessScore ?? 0) >= 70
        && Boolean(profile.trustStats);
    return procurementReady ? "procurement_ready" : "bid_ready";
}
exports.profile_update = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(publicProfiles_1.profileUpdateInputSchema, request.data);
    const invalidAssetPaths = (0, publicProfiles_1.getInvalidProfileAssetStoragePathFields)(actor.uid, input);
    if (invalidAssetPaths.length > 0) {
        throw new https_1.HttpsError("invalid-argument", "Profile asset paths must belong to the authenticated profile", { fields: invalidAssetPaths });
    }
    const db = (0, security_1.getDb)();
    const now = Date.now();
    return db.runTransaction(async (transaction) => {
        const profileRef = db.collection("profiles").doc(actor.uid);
        const publicRef = db.collection("publicProfiles").doc(actor.uid);
        const snapshot = await transaction.get(profileRef);
        const previous = snapshot.data() ?? {};
        const merged = {
            ...previous,
            ...input,
            uid: actor.uid,
            createdAt: previous.createdAt ?? now,
            updatedAt: now,
        };
        const inputRecord = input;
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
        merged.profileCompletenessScore = computeCompleteness(merged);
        merged.readinessTier = computeReadiness(merged);
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
            profileCompletenessScore: merged.profileCompletenessScore,
            readinessTier: merged.readinessTier,
            published: input.published,
        };
    });
});
