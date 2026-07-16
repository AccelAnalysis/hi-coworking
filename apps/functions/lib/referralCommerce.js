"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referralCommerce_updateConfiguration = exports.referralCommerce_getConfiguration = exports.LOCAL_DEFAULT_REFERRAL_COMMERCE_CONFIG = exports.referralCommerceUpdateConfigurationInputSchema = void 0;
exports.loadReferralCommerceConfiguration = loadReferralCommerceConfiguration;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const contracts_1 = require("./exchange/contracts");
const security_1 = require("./exchange/security");
const localReferralCommerceConfigurationSchema = zod_1.z.object({
    id: zod_1.z.literal("referralCommerce"),
    schemaVersion: zod_1.z.literal(1),
    platformFeeBasisPoints: zod_1.z.number().int().min(0).max(10000),
    version: zod_1.z.number().int().min(1),
    effectiveAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    updatedBy: zod_1.z.string().trim().min(1).max(128),
    updatedAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    payoutHoldDays: zod_1.z.number().int().min(0).max(365).optional(),
    manualEvidenceThresholdCents: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    commerceEnabled: zod_1.z.boolean(),
    settlementEnabled: zod_1.z.literal(false),
}).strict();
exports.referralCommerceUpdateConfigurationInputSchema = zod_1.z.object({
    idempotencyKey: contracts_1.idempotencyKeySchema,
    expectedVersion: zod_1.z.number().int().min(1),
    platformFeeBasisPoints: zod_1.z.number().int().min(0).max(10000).optional(),
    payoutHoldDays: zod_1.z.number().int().min(0).max(365).nullable().optional(),
    manualEvidenceThresholdCents: zod_1.z.number().int().nonnegative()
        .max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    commerceEnabled: zod_1.z.boolean().optional(),
    settlementEnabled: zod_1.z.literal(false).optional(),
}).strict().superRefine((value, context) => {
    if (value.platformFeeBasisPoints === undefined
        && value.payoutHoldDays === undefined
        && value.manualEvidenceThresholdCents === undefined
        && value.commerceEnabled === undefined
        && value.settlementEnabled === undefined) {
        context.addIssue({ code: "custom", message: "At least one prospective configuration change is required" });
    }
});
exports.LOCAL_DEFAULT_REFERRAL_COMMERCE_CONFIG = Object.freeze({
    id: "referralCommerce",
    schemaVersion: 1,
    platformFeeBasisPoints: 100,
    version: 1,
    effectiveAt: 0,
    updatedBy: "system:default",
    updatedAt: 0,
    commerceEnabled: true,
    settlementEnabled: false,
});
const CONFIG_COLLECTION = "platformConfiguration";
const CONFIG_DOCUMENT = "referralCommerce";
const CONFIG_VERSIONS_COLLECTION = "versions";
function parseConfiguration(value) {
    const parsed = localReferralCommerceConfigurationSchema.safeParse(value);
    if (!parsed.success) {
        throw new https_1.HttpsError("failed-precondition", "Referral commerce configuration is invalid");
    }
    return parsed.data;
}
function configurationOutput(config) {
    return {
        id: config.id,
        schemaVersion: config.schemaVersion,
        platformFeeBasisPoints: config.platformFeeBasisPoints,
        version: config.version,
        effectiveAt: config.effectiveAt,
        updatedBy: config.updatedBy,
        updatedAt: config.updatedAt,
        ...(config.payoutHoldDays !== undefined ? { payoutHoldDays: config.payoutHoldDays } : {}),
        ...(config.manualEvidenceThresholdCents !== undefined
            ? { manualEvidenceThresholdCents: config.manualEvidenceThresholdCents }
            : {}),
        commerceEnabled: config.commerceEnabled,
        settlementEnabled: false,
    };
}
/**
 * Current configuration reader for other trusted Functions. The default is
 * code-versioned and settlement remains disabled even when no document exists.
 */
async function loadReferralCommerceConfiguration(db = (0, security_1.getDb)()) {
    const snapshot = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT).get();
    return snapshot.exists
        ? configurationOutput(parseConfiguration(snapshot.data()))
        : configurationOutput(exports.LOCAL_DEFAULT_REFERRAL_COMMERCE_CONFIG);
}
function completedIdempotentResult(snapshot, actorUid, action, requestFingerprint) {
    if (!snapshot.exists)
        return null;
    const data = snapshot.data();
    if (data?.uid !== actorUid || data.action !== action || data.status !== "completed") {
        throw new https_1.HttpsError("already-exists", "The idempotency key is already in use");
    }
    if (data.requestFingerprint !== requestFingerprint) {
        throw new https_1.HttpsError("already-exists", "The idempotency key belongs to a different request");
    }
    return data.result ?? { id: data.entityId };
}
exports.referralCommerce_getConfiguration = (0, https_1.onCall)(async (request) => {
    (0, security_1.getAuthorizedActor)(request);
    return { configuration: await loadReferralCommerceConfiguration() };
});
exports.referralCommerce_updateConfiguration = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireAdmin)(actor);
    const input = (0, contracts_1.parseCallableInput)(exports.referralCommerceUpdateConfigurationInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const action = "referral_commerce.update_configuration";
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const configRef = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT);
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, configSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(configRef),
        ]);
        const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (prior)
            return { ...prior, idempotent: true };
        const current = configSnapshot.exists
            ? parseConfiguration(configSnapshot.data())
            : configurationOutput(exports.LOCAL_DEFAULT_REFERRAL_COMMERCE_CONFIG);
        if (current.version !== input.expectedVersion) {
            throw new https_1.HttpsError("aborted", "The referral commerce configuration changed; reload it and retry", {
                expectedVersion: input.expectedVersion,
                currentVersion: current.version,
            });
        }
        const now = Date.now();
        const next = {
            id: "referralCommerce",
            schemaVersion: 1,
            platformFeeBasisPoints: input.platformFeeBasisPoints ?? current.platformFeeBasisPoints,
            version: current.version + 1,
            effectiveAt: now,
            updatedBy: actor.uid,
            updatedAt: now,
            ...(input.payoutHoldDays === null
                ? {}
                : input.payoutHoldDays !== undefined
                    ? { payoutHoldDays: input.payoutHoldDays }
                    : current.payoutHoldDays !== undefined
                        ? { payoutHoldDays: current.payoutHoldDays }
                        : {}),
            ...(input.manualEvidenceThresholdCents === null
                ? {}
                : input.manualEvidenceThresholdCents !== undefined
                    ? { manualEvidenceThresholdCents: input.manualEvidenceThresholdCents }
                    : current.manualEvidenceThresholdCents !== undefined
                        ? { manualEvidenceThresholdCents: current.manualEvidenceThresholdCents }
                        : {}),
            commerceEnabled: input.commerceEnabled ?? current.commerceEnabled,
            settlementEnabled: false,
        };
        const validatedNext = parseConfiguration(next);
        const currentVersionRef = configRef.collection(CONFIG_VERSIONS_COLLECTION).doc(String(current.version));
        const nextVersionRef = configRef.collection(CONFIG_VERSIONS_COLLECTION).doc(String(validatedNext.version));
        const [currentVersionSnapshot, nextVersionSnapshot] = await Promise.all([
            transaction.get(currentVersionRef),
            transaction.get(nextVersionRef),
        ]);
        if (nextVersionSnapshot.exists) {
            throw new https_1.HttpsError("failed-precondition", "The next configuration version already exists");
        }
        if (!currentVersionSnapshot.exists)
            transaction.create(currentVersionRef, current);
        transaction.create(nextVersionRef, validatedNext);
        transaction.set(configRef, validatedNext);
        const result = { configuration: configurationOutput(validatedNext) };
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: CONFIG_DOCUMENT,
            result,
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "referralCommerceConfiguration",
            entityId: CONFIG_DOCUMENT,
            previousStatus: current.commerceEnabled ? "commerce_enabled" : "commerce_disabled",
            newStatus: validatedNext.commerceEnabled ? "commerce_enabled" : "commerce_disabled",
            metadata: {
                previousVersion: current.version,
                newVersion: validatedNext.version,
                previousPlatformFeeBasisPoints: current.platformFeeBasisPoints,
                newPlatformFeeBasisPoints: validatedNext.platformFeeBasisPoints,
                settlementEnabled: false,
            },
            createdAt: now,
        });
        return result;
    });
});
