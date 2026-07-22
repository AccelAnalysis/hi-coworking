"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referralServiceOffer_listDiscoverable = exports.referralServiceOffer_listMine = exports.referralServiceOffer_deactivate = exports.referralServiceOffer_createVersion = exports.referralServiceOffer_publish = exports.referralServiceOffer_create = exports.referralServiceOfferListDiscoverableInputSchema = exports.referralServiceOfferListMineInputSchema = exports.referralServiceOfferDecisionInputSchema = exports.referralServiceOfferCreateVersionInputSchema = exports.referralServiceOfferCreateInputSchema = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const contracts_1 = require("./exchange/contracts");
const security_1 = require("./exchange/security");
const safeId = zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const currencyCode = zod_1.z.string().trim().length(3).transform((value) => value.toUpperCase())
    .pipe(zod_1.z.string().regex(/^[A-Z]{3}$/));
const uniqueNaicsCodes = zod_1.z.array(zod_1.z.string().trim().regex(/^\d{2,6}$/)).max(50)
    .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "NAICS codes must be unique" });
    }
});
const uniqueTerritoryFips = zod_1.z.array(zod_1.z.string().trim().regex(/^\d{5}$/)).max(200)
    .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Territories must be unique" });
    }
});
const boundedList = zod_1.z.array(zod_1.z.string().trim().min(1).max(160)).max(50)
    .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Values must be unique" });
    }
});
const compensationFields = {
    compensationType: zod_1.z.enum(["none", "fixed", "percentage", "custom", "benefit"]),
    fixedCompensationCents: zod_1.z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    compensationRateBasisPoints: zod_1.z.number().int().min(1).max(10000).optional(),
    percentageBasis: zod_1.z.enum(["first_collected_invoice", "total_collected_contract"]).optional(),
    currency: currencyCode,
    benefitDescription: zod_1.z.string().trim().min(1).max(5000).optional(),
    customTerms: zod_1.z.string().trim().min(1).max(5000).optional(),
};
function validateCompensation(value, context) {
    const monetary = value.fixedCompensationCents !== undefined
        || value.compensationRateBasisPoints !== undefined
        || value.percentageBasis !== undefined;
    if (value.compensationType === "none") {
        if (monetary || value.benefitDescription || value.customTerms) {
            context.addIssue({ code: "custom", message: "No-compensation offers cannot include compensation terms" });
        }
    }
    else if (value.compensationType === "fixed") {
        if (value.fixedCompensationCents === undefined) {
            context.addIssue({ code: "custom", path: ["fixedCompensationCents"], message: "Fixed compensation requires cents" });
        }
        if (value.compensationRateBasisPoints !== undefined || value.percentageBasis || value.benefitDescription) {
            context.addIssue({ code: "custom", message: "Fixed compensation cannot include percentage or benefit fields" });
        }
    }
    else if (value.compensationType === "percentage") {
        if (value.compensationRateBasisPoints === undefined || !value.percentageBasis) {
            context.addIssue({ code: "custom", message: "Percentage compensation requires rate and basis" });
        }
        if (value.fixedCompensationCents !== undefined || value.benefitDescription) {
            context.addIssue({ code: "custom", message: "Percentage compensation cannot include fixed or benefit fields" });
        }
    }
    else if (value.compensationType === "custom") {
        if (!value.customTerms || monetary || value.benefitDescription) {
            context.addIssue({ code: "custom", message: "Custom compensation is explanatory and cannot define an automatic cash formula" });
        }
    }
    else if (!value.benefitDescription || monetary) {
        context.addIssue({ code: "custom", message: "Benefit compensation requires a non-cash description and no monetary formula" });
    }
}
const offerTermsFields = {
    serviceName: zod_1.z.string().trim().min(1).max(160),
    serviceCategory: zod_1.z.string().trim().min(1).max(160),
    naicsCodes: uniqueNaicsCodes.default([]),
    territoryFips: uniqueTerritoryFips.default([]),
    acceptingReferrals: zod_1.z.boolean(),
    ...compensationFields,
    attributionWindowDays: zod_1.z.number().int().min(1).max(3650),
    payoutTrigger: zod_1.z.string().trim().min(1).max(500).optional(),
    paymentDeadlineDays: zod_1.z.number().int().min(1).max(3650).optional(),
    refundTreatment: zod_1.z.string().trim().min(1).max(1000).optional(),
    includedCharges: boundedList.optional(),
    excludedCharges: boundedList.optional(),
    effectiveAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
};
function validateOfferTerms(value, context) {
    validateCompensation(value, context);
    const included = new Set(value.includedCharges ?? []);
    if ((value.excludedCharges ?? []).some((charge) => included.has(charge))) {
        context.addIssue({
            code: "custom",
            path: ["excludedCharges"],
            message: "A charge cannot be both included and excluded",
        });
    }
}
exports.referralServiceOfferCreateInputSchema = zod_1.z.object({
    idempotencyKey: contracts_1.idempotencyKeySchema,
    providerOrgId: safeId.optional(),
    ...offerTermsFields,
}).strict().superRefine(validateOfferTerms);
exports.referralServiceOfferCreateVersionInputSchema = zod_1.z.object({
    idempotencyKey: contracts_1.idempotencyKeySchema,
    sourceVersionId: safeId,
    expectedStateVersion: zod_1.z.number().int().nonnegative(),
    ...offerTermsFields,
}).strict().superRefine(validateOfferTerms);
exports.referralServiceOfferDecisionInputSchema = zod_1.z.object({
    idempotencyKey: contracts_1.idempotencyKeySchema,
    serviceOfferVersionId: safeId,
    expectedStateVersion: zod_1.z.number().int().nonnegative(),
}).strict();
exports.referralServiceOfferListMineInputSchema = zod_1.z.object({
    limit: zod_1.z.number().int().min(1).max(200).default(100),
}).strict();
exports.referralServiceOfferListDiscoverableInputSchema = zod_1.z.object({
    limit: zod_1.z.number().int().min(1).max(100).default(50),
    cursor: safeId.optional(),
    serviceCategory: zod_1.z.string().trim().min(1).max(160).optional(),
    naicsCode: zod_1.z.string().trim().regex(/^\d{2,6}$/).optional(),
    territoryFips: zod_1.z.string().trim().regex(/^\d{5}$/).optional(),
}).strict();
const referralServiceOfferRecordSchema = zod_1.z.object({
    id: safeId,
    offerId: safeId,
    schemaVersion: zod_1.z.literal(1),
    providerUid: safeId.optional(),
    providerOrgId: safeId.optional(),
    serviceName: zod_1.z.string().trim().min(1).max(160),
    serviceCategory: zod_1.z.string().trim().min(1).max(160),
    naicsCodes: uniqueNaicsCodes,
    territoryFips: uniqueTerritoryFips,
    acceptingReferrals: zod_1.z.boolean(),
    ...compensationFields,
    attributionWindowDays: zod_1.z.number().int().min(1).max(3650),
    payoutTrigger: zod_1.z.string().trim().min(1).max(500).optional(),
    paymentDeadlineDays: zod_1.z.number().int().min(1).max(3650).optional(),
    refundTreatment: zod_1.z.string().trim().min(1).max(1000).optional(),
    includedCharges: boundedList.optional(),
    excludedCharges: boundedList.optional(),
    status: zod_1.z.enum(["draft", "published", "inactive"]),
    version: zod_1.z.number().int().min(1).max(100),
    stateVersion: zod_1.z.number().int().nonnegative(),
    effectiveAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    publishedAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    publishedBy: safeId.optional(),
    deactivatedAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    deactivatedBy: safeId.optional(),
    sourceVersionId: safeId.optional(),
    createdBy: safeId,
    createdAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    updatedAt: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, context) => {
    if (Boolean(value.providerUid) === Boolean(value.providerOrgId)) {
        context.addIssue({ code: "custom", message: "Exactly one service-offer provider is required" });
    }
    validateOfferTerms(value, context);
    if (value.status === "draft" && (value.publishedAt !== undefined || value.deactivatedAt !== undefined)) {
        context.addIssue({ code: "custom", message: "A draft cannot have publication lifecycle timestamps" });
    }
    if (value.status === "published"
        && (value.publishedAt === undefined || !value.publishedBy || value.deactivatedAt !== undefined)) {
        context.addIssue({ code: "custom", message: "A published offer has invalid lifecycle metadata" });
    }
    if (value.status === "inactive"
        && (value.publishedAt === undefined || !value.publishedBy
            || value.deactivatedAt === undefined || !value.deactivatedBy)) {
        context.addIssue({ code: "custom", message: "An inactive offer has invalid lifecycle metadata" });
    }
});
const MAX_OFFER_VERSIONS = 100;
const MAX_MANAGED_ORGS = 20;
const MAX_MEMBERSHIP_SCAN = 100;
const MAX_QUERY_RESULTS = 250;
function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}
function requireOffer(snapshot) {
    if (!snapshot.exists)
        throw new https_1.HttpsError("not-found", "Referral service offer not found");
    const parsed = referralServiceOfferRecordSchema.safeParse(snapshot.data());
    if (!parsed.success || parsed.data.id !== snapshot.id) {
        throw new https_1.HttpsError("failed-precondition", "Referral service offer data is invalid");
    }
    return parsed.data;
}
function requireExpectedStateVersion(offer, expectedStateVersion) {
    if (offer.stateVersion !== expectedStateVersion) {
        throw new https_1.HttpsError("aborted", "The service offer changed; reload it and retry", {
            expectedVersion: expectedStateVersion,
            currentVersion: offer.stateVersion,
        });
    }
}
async function requireOfferAuthority(transaction, offer, actor) {
    if (offer.providerOrgId) {
        await (0, security_1.loadOrgAuthority)(transaction, (0, security_1.getDb)(), offer.providerOrgId, actor.uid, {
            managementRequired: true,
        });
        return;
    }
    if (offer.providerUid !== actor.uid) {
        throw new https_1.HttpsError("permission-denied", "Service-offer provider authority is required");
    }
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
function termsPayload(input, now) {
    const payload = {
        serviceName: input.serviceName,
        serviceCategory: input.serviceCategory,
        naicsCodes: input.naicsCodes,
        territoryFips: input.territoryFips,
        acceptingReferrals: input.acceptingReferrals,
        compensationType: input.compensationType,
        currency: input.currency,
        attributionWindowDays: input.attributionWindowDays,
        effectiveAt: input.effectiveAt ?? now,
    };
    for (const field of [
        "fixedCompensationCents",
        "compensationRateBasisPoints",
        "percentageBasis",
        "benefitDescription",
        "customTerms",
        "payoutTrigger",
        "paymentDeadlineDays",
        "refundTreatment",
        "includedCharges",
        "excludedCharges",
    ]) {
        if (input[field] !== undefined)
            payload[field] = input[field];
    }
    return payload;
}
const OFFER_OUTPUT_FIELDS = [
    "id",
    "offerId",
    "schemaVersion",
    "providerUid",
    "providerOrgId",
    "serviceName",
    "serviceCategory",
    "naicsCodes",
    "territoryFips",
    "status",
    "acceptingReferrals",
    "compensationType",
    "fixedCompensationCents",
    "compensationRateBasisPoints",
    "percentageBasis",
    "currency",
    "benefitDescription",
    "customTerms",
    "attributionWindowDays",
    "payoutTrigger",
    "paymentDeadlineDays",
    "refundTreatment",
    "includedCharges",
    "excludedCharges",
    "version",
    "stateVersion",
    "effectiveAt",
    "publishedAt",
    "deactivatedAt",
    "sourceVersionId",
    "createdAt",
    "updatedAt",
];
function offerOutput(data) {
    const output = {};
    for (const field of OFFER_OUTPUT_FIELDS) {
        if (data[field] !== undefined)
            output[field] = data[field];
    }
    return output;
}
exports.referralServiceOffer_create = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(exports.referralServiceOfferCreateInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const action = "referral_service_offer.create";
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const offerRef = db.collection("referralServiceOffers").doc();
    return db.runTransaction(async (transaction) => {
        const dedupeSnapshot = await transaction.get(dedupeRef);
        if (input.providerOrgId) {
            await (0, security_1.loadOrgAuthority)(transaction, db, input.providerOrgId, actor.uid, {
                managementRequired: true,
            });
        }
        const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (prior)
            return { ...prior, idempotent: true };
        const now = Date.now();
        const offer = {
            id: offerRef.id,
            offerId: offerRef.id,
            schemaVersion: 1,
            ...(input.providerOrgId ? { providerOrgId: input.providerOrgId } : { providerUid: actor.uid }),
            ...termsPayload(input, now),
            status: "draft",
            version: 1,
            stateVersion: 0,
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
        };
        transaction.create(offerRef, offer);
        const result = {
            serviceOfferVersionId: offerRef.id,
            offerId: offerRef.id,
            version: 1,
            stateVersion: 0,
            status: "draft",
        };
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: offerRef.id,
            result,
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "referralServiceOffer",
            entityId: offerRef.id,
            orgId: input.providerOrgId,
            newStatus: "draft",
            metadata: { compensationType: input.compensationType, version: 1 },
            createdAt: now,
        });
        return result;
    });
});
exports.referralServiceOffer_publish = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(exports.referralServiceOfferDecisionInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const action = "referral_service_offer.publish";
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const offerRef = db.collection("referralServiceOffers").doc(input.serviceOfferVersionId);
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, offerSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(offerRef),
        ]);
        const offer = requireOffer(offerSnapshot);
        await requireOfferAuthority(transaction, offer, actor);
        const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (prior)
            return { ...prior, idempotent: true };
        requireExpectedStateVersion(offer, input.expectedStateVersion);
        if (offer.status !== "draft") {
            throw new https_1.HttpsError("failed-precondition", "Only a draft service-offer version can be published");
        }
        const now = Date.now();
        if (typeof offer.effectiveAt !== "number" || offer.effectiveAt > now) {
            throw new https_1.HttpsError("failed-precondition", "The service offer cannot be published before its effective time");
        }
        const versionsSnapshot = await transaction.get(db.collection("referralServiceOffers").where("offerId", "==", offer.offerId).limit(MAX_OFFER_VERSIONS + 1));
        if (versionsSnapshot.size > MAX_OFFER_VERSIONS) {
            throw new https_1.HttpsError("resource-exhausted", "The service offer has too many versions for safe publication");
        }
        const publishedOthers = versionsSnapshot.docs
            .filter((document) => document.id !== offer.id && document.get("status") === "published");
        for (const priorVersion of publishedOthers) {
            const priorStateVersion = priorVersion.get("stateVersion");
            if (!Number.isInteger(priorStateVersion) || priorStateVersion < 0) {
                throw new https_1.HttpsError("failed-precondition", "A prior service-offer version is invalid");
            }
            transaction.update(priorVersion.ref, {
                status: "inactive",
                deactivatedAt: now,
                deactivatedBy: actor.uid,
                stateVersion: priorStateVersion + 1,
                updatedAt: now,
            });
        }
        const stateVersion = offer.stateVersion + 1;
        transaction.update(offerRef, {
            status: "published",
            publishedAt: now,
            publishedBy: actor.uid,
            stateVersion,
            updatedAt: now,
        });
        const result = {
            serviceOfferVersionId: offer.id,
            offerId: offer.offerId,
            version: offer.version,
            stateVersion,
            status: "published",
            replacedVersions: publishedOthers.length,
        };
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: offer.id,
            result,
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "referralServiceOffer",
            entityId: offer.id,
            orgId: offer.providerOrgId,
            previousStatus: "draft",
            newStatus: "published",
            metadata: { version: offer.version, replacedVersions: publishedOthers.length },
            createdAt: now,
        });
        return result;
    });
});
exports.referralServiceOffer_createVersion = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(exports.referralServiceOfferCreateVersionInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const action = "referral_service_offer.create_version";
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const sourceRef = db.collection("referralServiceOffers").doc(input.sourceVersionId);
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, sourceSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(sourceRef),
        ]);
        const source = requireOffer(sourceSnapshot);
        await requireOfferAuthority(transaction, source, actor);
        const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (prior)
            return { ...prior, idempotent: true };
        requireExpectedStateVersion(source, input.expectedStateVersion);
        if (source.status === "draft") {
            throw new https_1.HttpsError("failed-precondition", "Publish the current draft before creating another version");
        }
        const versionsSnapshot = await transaction.get(db.collection("referralServiceOffers").where("offerId", "==", source.offerId).limit(MAX_OFFER_VERSIONS + 1));
        if (versionsSnapshot.size > MAX_OFFER_VERSIONS) {
            throw new https_1.HttpsError("resource-exhausted", "The service offer has reached its version limit");
        }
        if (versionsSnapshot.docs.some((document) => document.get("status") === "draft")) {
            throw new https_1.HttpsError("already-exists", "This service offer already has a draft version");
        }
        const latestVersion = versionsSnapshot.docs.reduce((highest, document) => Math.max(highest, Number(document.get("version") ?? 0)), 0);
        if (!Number.isInteger(latestVersion) || latestVersion < 1 || latestVersion >= MAX_OFFER_VERSIONS) {
            throw new https_1.HttpsError("failed-precondition", "The service-offer version history is invalid");
        }
        const version = latestVersion + 1;
        const versionRef = db.collection("referralServiceOffers").doc(`${source.offerId}_v${version}`);
        const existingVersion = await transaction.get(versionRef);
        if (existingVersion.exists) {
            throw new https_1.HttpsError("already-exists", "The next service-offer version already exists");
        }
        const now = Date.now();
        const offer = {
            id: versionRef.id,
            offerId: source.offerId,
            schemaVersion: 1,
            ...(source.providerOrgId ? { providerOrgId: source.providerOrgId } : { providerUid: source.providerUid }),
            ...termsPayload(input, now),
            status: "draft",
            version,
            stateVersion: 0,
            sourceVersionId: source.id,
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
        };
        transaction.create(versionRef, offer);
        const result = {
            serviceOfferVersionId: versionRef.id,
            offerId: source.offerId,
            version,
            stateVersion: 0,
            status: "draft",
        };
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: versionRef.id,
            result,
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "referralServiceOffer",
            entityId: versionRef.id,
            orgId: source.providerOrgId,
            newStatus: "draft",
            metadata: { version, sourceVersionId: source.id },
            createdAt: now,
        });
        return result;
    });
});
exports.referralServiceOffer_deactivate = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(exports.referralServiceOfferDecisionInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const action = "referral_service_offer.deactivate";
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const offerRef = db.collection("referralServiceOffers").doc(input.serviceOfferVersionId);
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, offerSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(offerRef),
        ]);
        const offer = requireOffer(offerSnapshot);
        await requireOfferAuthority(transaction, offer, actor);
        const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (prior)
            return { ...prior, idempotent: true };
        requireExpectedStateVersion(offer, input.expectedStateVersion);
        if (offer.status !== "published") {
            throw new https_1.HttpsError("failed-precondition", "Only a published service-offer version can be deactivated");
        }
        const now = Date.now();
        const stateVersion = offer.stateVersion + 1;
        transaction.update(offerRef, {
            status: "inactive",
            deactivatedAt: now,
            deactivatedBy: actor.uid,
            stateVersion,
            updatedAt: now,
        });
        const result = {
            serviceOfferVersionId: offer.id,
            offerId: offer.offerId,
            version: offer.version,
            stateVersion,
            status: "inactive",
        };
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: offer.id,
            result,
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "referralServiceOffer",
            entityId: offer.id,
            orgId: offer.providerOrgId,
            previousStatus: "published",
            newStatus: "inactive",
            metadata: { version: offer.version },
            createdAt: now,
        });
        return result;
    });
});
async function currentManagedOrgIds(actor) {
    const db = (0, security_1.getDb)();
    const memberships = await db.collection("orgMembers")
        .where("uid", "==", actor.uid)
        .limit(MAX_MEMBERSHIP_SCAN + 1)
        .get();
    const managerMemberships = memberships.docs.filter((document) => {
        const member = document.data();
        return member.uid === actor.uid
            && isNonEmptyString(member.orgId)
            && document.id === `${member.orgId}_${actor.uid}`
            && member.status === "active"
            && ["owner", "admin"].includes(member.role);
    });
    const candidates = managerMemberships.slice(0, MAX_MANAGED_ORGS);
    if (candidates.length === 0) {
        return { ids: [], truncated: memberships.size > MAX_MEMBERSHIP_SCAN };
    }
    const organizations = await db.getAll(...candidates.map((document) => db.collection("orgs").doc(document.get("orgId"))));
    return {
        ids: organizations
            .filter((snapshot) => snapshot.exists && snapshot.get("status") === "active")
            .map((snapshot) => snapshot.id),
        truncated: memberships.size > MAX_MEMBERSHIP_SCAN || managerMemberships.length > MAX_MANAGED_ORGS,
    };
}
exports.referralServiceOffer_listMine = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(exports.referralServiceOfferListMineInputSchema, request.data ?? {});
    const db = (0, security_1.getDb)();
    const managedOrganizations = await currentManagedOrgIds(actor);
    const perScopeLimit = Math.min(input.limit + 1, MAX_QUERY_RESULTS);
    const snapshots = await Promise.all([
        db.collection("referralServiceOffers").where("providerUid", "==", actor.uid).limit(perScopeLimit).get(),
        ...managedOrganizations.ids.map((orgId) => db.collection("referralServiceOffers")
            .where("providerOrgId", "==", orgId)
            .limit(perScopeLimit)
            .get()),
    ]);
    const unique = new Map();
    for (const snapshot of snapshots) {
        for (const document of snapshot.docs)
            unique.set(document.id, document.data());
    }
    const offers = [...unique.values()]
        .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0))
        .slice(0, input.limit)
        .map(offerOutput);
    return {
        offers,
        truncated: managedOrganizations.truncated
            || snapshots.some((snapshot) => snapshot.size >= perScopeLimit)
            || unique.size > input.limit,
    };
});
exports.referralServiceOffer_listDiscoverable = (0, https_1.onCall)(async (request) => {
    (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(exports.referralServiceOfferListDiscoverableInputSchema, request.data ?? {});
    const db = (0, security_1.getDb)();
    let query = db.collection("referralServiceOffers")
        .where("status", "==", "published")
        .where("acceptingReferrals", "==", true)
        .orderBy(firestore_1.FieldPath.documentId())
        .limit(Math.min(input.limit * 3 + 1, MAX_QUERY_RESULTS));
    if (input.cursor) {
        const cursorSnapshot = await db.collection("referralServiceOffers").doc(input.cursor).get();
        if (!cursorSnapshot.exists)
            throw new https_1.HttpsError("invalid-argument", "The service-offer cursor is invalid");
        query = query.startAfter(cursorSnapshot);
    }
    const snapshot = await query.get();
    const now = Date.now();
    const termsMatching = snapshot.docs.filter((document) => {
        const offer = document.data();
        if (typeof offer.effectiveAt !== "number" || offer.effectiveAt > now)
            return false;
        if (input.serviceCategory && offer.serviceCategory !== input.serviceCategory)
            return false;
        if (input.naicsCode && (!Array.isArray(offer.naicsCodes) || !offer.naicsCodes.includes(input.naicsCode)))
            return false;
        if (input.territoryFips && (!Array.isArray(offer.territoryFips) || !offer.territoryFips.includes(input.territoryFips)))
            return false;
        return true;
    });
    const orgIds = [...new Set(termsMatching.flatMap((document) => (isNonEmptyString(document.get("providerOrgId")) ? [document.get("providerOrgId")] : [])))];
    const providerUids = [...new Set(termsMatching.flatMap((document) => (!isNonEmptyString(document.get("providerOrgId")) && isNonEmptyString(document.get("providerUid"))
            ? [document.get("providerUid")]
            : [])))];
    const [organizations, profiles] = await Promise.all([
        orgIds.length ? db.getAll(...orgIds.map((id) => db.collection("orgs").doc(id))) : [],
        providerUids.length
            ? db.getAll(...providerUids.map((uid) => db.collection("publicProfiles").doc(uid)))
            : [],
    ]);
    const activeOrgIds = new Set(organizations
        .filter((document) => document.exists && document.get("status") === "active")
        .map((document) => document.id));
    const publishedProviderUids = new Set(profiles
        .filter((document) => document.exists && document.get("published") === true)
        .map((document) => document.id));
    const matching = termsMatching.filter((document) => {
        const providerOrgId = document.get("providerOrgId");
        if (isNonEmptyString(providerOrgId))
            return activeOrgIds.has(providerOrgId);
        const providerUid = document.get("providerUid");
        return isNonEmptyString(providerUid) && publishedProviderUids.has(providerUid);
    });
    const offers = matching.slice(0, input.limit).map((document) => offerOutput(document.data()));
    const scannedAll = snapshot.size < Math.min(input.limit * 3 + 1, MAX_QUERY_RESULTS);
    return {
        offers,
        nextCursor: !scannedAll && snapshot.docs.length > 0
            ? snapshot.docs[snapshot.docs.length - 1].id
            : null,
        truncated: !scannedAll || matching.length > input.limit,
    };
});
