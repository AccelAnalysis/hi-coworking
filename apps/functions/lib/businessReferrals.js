"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessReferral_expireSent = exports.businessReferral_resolveDispute = exports.businessReferral_createDispute = exports.businessReferral_prepareEvidenceAccess = exports.businessReferral_withdrawConsent = exports.businessReferral_confirmConsent = exports.businessReferral_updateConsent = exports.businessReferral_progress = exports.businessReferral_respond = exports.businessReferral_send = exports.businessReferral_create = void 0;
exports.cleanupExpiredBusinessReferralStorageGrantAt = cleanupExpiredBusinessReferralStorageGrantAt;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const zod_1 = require("zod");
const contracts_1 = require("./exchange/contracts");
const security_1 = require("./exchange/security");
const MAX_REFERRAL_EVIDENCE_FILE_SIZE = 15 * 1024 * 1024;
const BUSINESS_REFERRAL_SENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BUSINESS_REFERRAL_STORAGE_GRANT_TTL_MS = 60 * 1000;
const MAX_REFERRAL_EXPIRATIONS_PER_RUN = 200;
const DEFAULT_PLATFORM_FEE_BASIS_POINTS = 100;
const DEFAULT_PLATFORM_FEE_CONFIG_VERSION = 1;
const REFERRAL_CALCULATION_VERSION = 1;
const ALLOWED_REFERRAL_EVIDENCE_CONTENT_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
]);
function writeReferralTimeline(transaction, db, params) {
    const eventId = `${params.referralId}_${params.referralVersion}_${params.eventType}`;
    const event = {
        id: eventId,
        referralId: params.referralId,
        eventType: params.eventType,
        actorUid: params.actor.uid,
        actorRole: params.actor.role,
        referralVersion: params.referralVersion,
        occurredAt: params.occurredAt,
    };
    if (params.actorOrgId)
        event.actorOrgId = params.actorOrgId;
    if (params.transactionReportId)
        event.transactionReportId = params.transactionReportId;
    if (params.metadata && Object.keys(params.metadata).length > 0)
        event.metadata = params.metadata;
    transaction.create(db.collection("businessReferralTimeline").doc(eventId), event);
}
function assertCanonicalDisputeEvidencePaths(referralId, actorUid, paths) {
    const expectedPrefix = `businessReferralDisputeEvidence/${referralId}/${actorUid}/`;
    if (new Set(paths).size !== paths.length) {
        throw new https_1.HttpsError("invalid-argument", "Dispute evidence paths must be unique");
    }
    if (paths.some((path) => {
        const suffix = path.slice(expectedPrefix.length);
        return !path.startsWith(expectedPrefix)
            || !suffix
            || path.includes("..")
            || path.includes("\\")
            || path.includes("\0");
    })) {
        throw new https_1.HttpsError("invalid-argument", "Dispute evidence must use the authorized referral path");
    }
}
async function verifyDisputeEvidence(paths) {
    await Promise.all(paths.map(async (storagePath) => {
        try {
            const [metadata] = await admin.storage().bucket().file(storagePath).getMetadata();
            const size = Number(metadata.size ?? 0);
            const contentType = typeof metadata.contentType === "string"
                ? metadata.contentType.toLowerCase()
                : "";
            if (!Number.isSafeInteger(size)
                || size <= 0
                || size > MAX_REFERRAL_EVIDENCE_FILE_SIZE
                || !ALLOWED_REFERRAL_EVIDENCE_CONTENT_TYPES.has(contentType)) {
                throw new https_1.HttpsError("failed-precondition", "Dispute evidence has invalid stored metadata");
            }
        }
        catch (error) {
            if (error instanceof https_1.HttpsError)
                throw error;
            throw new https_1.HttpsError("failed-precondition", "Dispute evidence could not be verified in Storage");
        }
    }));
}
const disputeResolveInputSchema = zod_1.z
    .object({
    disputeId: zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    resolution: zod_1.z.enum(["upheld", "dismissed", "agreement"]),
    note: zod_1.z.string().trim().min(3).max(5000),
})
    .strict();
const referralEvidenceAccessInputSchema = zod_1.z
    .object({
    referralId: zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    operation: zod_1.z.enum(["upload", "read"]),
    storagePaths: zod_1.z.array(zod_1.z.string().trim().min(1).max(1024)).min(1).max(10),
})
    .strict();
const RESTORABLE_COMPENSATION_STATUSES = new Set([
    "none",
    "proposed",
    "agreed",
    "due",
    "processing",
    "settled",
    "cancelled",
]);
function getVersion(referral) {
    return Number.isInteger(referral.version) && referral.version >= 0 ? referral.version : 0;
}
function requireExpectedVersion(referral, expectedVersion) {
    if (getVersion(referral) !== expectedVersion) {
        throw new https_1.HttpsError("aborted", "The referral changed; reload it and retry", {
            expectedVersion,
            currentVersion: getVersion(referral),
        });
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
async function hasOrgAuthority(transaction, orgId, actor, managementRequired = false) {
    if (typeof orgId !== "string" || !orgId)
        return false;
    try {
        await (0, security_1.loadOrgAuthority)(transaction, (0, security_1.getDb)(), orgId, actor.uid, { managementRequired });
        return true;
    }
    catch (error) {
        if (error instanceof https_1.HttpsError && error.code === "permission-denied")
            return false;
        throw error;
    }
}
function hasOrganizationScope(referral, field) {
    return Object.prototype.hasOwnProperty.call(referral, field);
}
function isIndividualReferrer(referral, actorUid) {
    return !hasOrganizationScope(referral, "referrerOrgId")
        && referral.referrerUid === actorUid;
}
function isIndividualRecipient(referral, actorUid) {
    return !hasOrganizationScope(referral, "recipientOrgId")
        && referral.recipientUid === actorUid;
}
async function requireReferrerAuthority(transaction, referral, actor, actorOrganizationId) {
    if (actorOrganizationId) {
        if (referral.referrerOrgId !== actorOrganizationId) {
            throw new https_1.HttpsError("permission-denied", "The selected organization is not the referral referrer");
        }
        await (0, security_1.loadOrgAuthority)(transaction, (0, security_1.getDb)(), actorOrganizationId, actor.uid, {
            managementRequired: true,
        });
        return;
    }
    if (hasOrganizationScope(referral, "referrerOrgId")) {
        throw new https_1.HttpsError("permission-denied", "Select the referral's referrer organization before acting");
    }
    if (isIndividualReferrer(referral, actor.uid))
        return;
    throw new https_1.HttpsError("permission-denied", "Referrer authority is required");
}
async function requireRecipientAuthority(transaction, referral, actor, managementRequired = false, actorOrganizationId) {
    if (actorOrganizationId) {
        if (referral.recipientOrgId !== actorOrganizationId) {
            throw new https_1.HttpsError("permission-denied", "The selected organization is not the referral recipient");
        }
        await (0, security_1.loadOrgAuthority)(transaction, (0, security_1.getDb)(), actorOrganizationId, actor.uid, {
            managementRequired,
        });
        return;
    }
    if (hasOrganizationScope(referral, "recipientOrgId")) {
        throw new https_1.HttpsError("permission-denied", "Select the referral's recipient organization before acting");
    }
    if (isIndividualRecipient(referral, actor.uid))
        return;
    throw new https_1.HttpsError("permission-denied", "Recipient authority is required");
}
async function requirePartyAuthority(transaction, referral, actor) {
    if (actor.role === "staff" && referral.assignedStaffUids?.includes(actor.uid))
        return;
    const referrerAuthorized = hasOrganizationScope(referral, "referrerOrgId")
        ? await hasOrgAuthority(transaction, referral.referrerOrgId, actor)
        : isIndividualReferrer(referral, actor.uid);
    if (referrerAuthorized)
        return;
    const recipientAuthorized = hasOrganizationScope(referral, "recipientOrgId")
        ? await hasOrgAuthority(transaction, referral.recipientOrgId, actor)
        : isIndividualRecipient(referral, actor.uid);
    if (recipientAuthorized)
        return;
    throw new https_1.HttpsError("permission-denied", "Referral-party authority is required");
}
async function hasReferralOrgAuthority(transaction, orgId, actor) {
    if (!orgId)
        return false;
    try {
        await (0, security_1.loadOrgAuthority)(transaction, (0, security_1.getDb)(), orgId, actor.uid);
        return true;
    }
    catch (error) {
        if (error instanceof https_1.HttpsError && error.code === "permission-denied")
            return false;
        throw error;
    }
}
function requireReferralEvidenceGrantPaths(referralId, actorUid, operation, paths) {
    if (new Set(paths).size !== paths.length) {
        throw new https_1.HttpsError("invalid-argument", "Referral evidence paths must be unique");
    }
    const basePrefixes = [
        `businessReferralEvidence/${referralId}/`,
        `businessReferralDisputeEvidence/${referralId}/`,
    ];
    const uploadPrefixes = basePrefixes.map((prefix) => `${prefix}${actorUid}/`);
    const validPrefixes = operation === "upload" ? uploadPrefixes : basePrefixes;
    if (paths.some((path) => {
        const segments = path.split("/");
        const matchedPrefix = validPrefixes.find((prefix) => path.startsWith(prefix) && path.length > prefix.length);
        const lowered = path.toLowerCase();
        return !matchedPrefix
            || path.startsWith("/")
            || path.includes("\\")
            || path.includes("\0")
            || segments.some((segment) => !segment || segment === "." || segment === "..")
            || /^(?:https?:|gs:)/i.test(path)
            || lowered.includes("%2f")
            || lowered.includes("%5c")
            || lowered.includes("%2e");
    })) {
        throw new https_1.HttpsError("invalid-argument", "Referral evidence path is not canonical");
    }
}
function referralStorageGrantRef(db, referralId, uid) {
    return db.collection("businessReferralStorageGrantScopes")
        .doc(referralId)
        .collection("storageGrants")
        .doc(uid);
}
function requireReferralSnapshot(snapshot) {
    if (!snapshot.exists)
        throw new https_1.HttpsError("not-found", "Business referral not found");
    const referral = snapshot.data();
    if (referral.schemaVersion !== 1 && referral.schemaVersion !== 2) {
        throw new https_1.HttpsError("failed-precondition", "Unsupported business-referral version");
    }
    return referral;
}
function referralCommerceConfig(snapshot) {
    if (!snapshot.exists) {
        return {
            platformFeeBasisPoints: DEFAULT_PLATFORM_FEE_BASIS_POINTS,
            version: DEFAULT_PLATFORM_FEE_CONFIG_VERSION,
            commerceEnabled: true,
        };
    }
    const config = snapshot.data() ?? {};
    if (!Number.isInteger(config.platformFeeBasisPoints)
        || config.platformFeeBasisPoints < 0
        || config.platformFeeBasisPoints > 10000
        || !Number.isInteger(config.version)
        || config.version < 1
        || typeof config.commerceEnabled !== "boolean") {
        throw new https_1.HttpsError("failed-precondition", "Referral commerce configuration is invalid");
    }
    return {
        platformFeeBasisPoints: config.platformFeeBasisPoints,
        version: config.version,
        commerceEnabled: config.commerceEnabled,
    };
}
function compensationForCreate(policy) {
    if (!policy || policy.type === "none")
        return { type: "none", status: "none" };
    return { ...policy, status: "proposed" };
}
function compensationForOffer(offer) {
    if (offer.compensationType === "none")
        return { type: "none", status: "none" };
    const policy = {
        type: offer.compensationType,
        status: "proposed",
        currency: offer.currency,
    };
    if (offer.fixedCompensationCents !== undefined)
        policy.amountCents = offer.fixedCompensationCents;
    if (offer.compensationRateBasisPoints !== undefined) {
        policy.percentageBasisPoints = offer.compensationRateBasisPoints;
    }
    if (offer.percentageBasis)
        policy.percentageBasis = offer.percentageBasis;
    if (offer.benefitDescription)
        policy.benefitDescription = offer.benefitDescription;
    if (offer.customTerms)
        policy.terms = offer.customTerms;
    return policy;
}
function requirePublishedOffer(snapshot, expectedId) {
    if (!snapshot?.exists)
        throw new https_1.HttpsError("not-found", "Referral service offer not found");
    const offer = snapshot.data();
    if (offer.id !== expectedId
        || !Number.isInteger(offer.version)
        || offer.version < 1
        || offer.status !== "published"
        || offer.acceptingReferrals !== true) {
        throw new https_1.HttpsError("failed-precondition", "The referral service offer is not currently available");
    }
    return offer;
}
function offerMatchesRecipient(offer, recipientUid, recipientOrgId) {
    if (offer.providerOrgId)
        return offer.providerOrgId === recipientOrgId;
    return Boolean(offer.providerUid && offer.providerUid === recipientUid && !recipientOrgId);
}
function acceptedTermsSnapshot(params) {
    const compensationType = params.offer?.compensationType ?? params.referral.compensationPolicy.type;
    const snapshot = {
        schemaVersion: 1,
        compensationType,
        currency: params.offer?.currency ?? params.referral.compensationPolicy.currency ?? "USD",
        attributionWindowDays: params.offer?.attributionWindowDays ?? 30,
        platformFeeBasisPoints: params.platformFeeBasisPoints,
        platformFeeConfigVersion: params.platformFeeConfigVersion,
        acceptedByUid: params.acceptedByUid,
        acceptedAt: params.acceptedAt,
        calculationVersion: REFERRAL_CALCULATION_VERSION,
    };
    if (params.offer) {
        snapshot.serviceOfferId = params.offer.offerId ?? params.offer.id;
        snapshot.serviceOfferVersionId = params.offer.id;
        snapshot.serviceOfferVersion = params.offer.version;
    }
    if (params.acceptedByOrgId)
        snapshot.acceptedByOrgId = params.acceptedByOrgId;
    const fixedCents = params.offer?.fixedCompensationCents ?? params.referral.compensationPolicy.amountCents;
    const rate = params.offer?.compensationRateBasisPoints
        ?? params.referral.compensationPolicy.percentageBasisPoints;
    if (fixedCents !== undefined)
        snapshot.fixedCompensationCents = fixedCents;
    if (rate !== undefined)
        snapshot.compensationRateBasisPoints = rate;
    const percentageBasis = params.offer?.percentageBasis ?? params.referral.compensationPolicy.percentageBasis;
    if (percentageBasis)
        snapshot.percentageBasis = percentageBasis;
    if (params.offer?.payoutTrigger)
        snapshot.payoutTrigger = params.offer.payoutTrigger;
    if (params.offer?.paymentDeadlineDays !== undefined) {
        snapshot.paymentDeadlineDays = params.offer.paymentDeadlineDays;
    }
    if (params.offer?.refundTreatment)
        snapshot.refundTreatment = params.offer.refundTreatment;
    if (params.offer?.includedCharges)
        snapshot.includedCharges = params.offer.includedCharges;
    if (params.offer?.excludedCharges)
        snapshot.excludedCharges = params.offer.excludedCharges;
    const benefitDescription = params.offer?.benefitDescription
        ?? params.referral.compensationPolicy.benefitDescription;
    const customTerms = params.offer?.customTerms
        ?? (params.referral.compensationPolicy.type === "custom"
            ? params.referral.compensationPolicy.terms
            : undefined);
    if (benefitDescription)
        snapshot.benefitDescription = benefitDescription;
    if (customTerms)
        snapshot.customTerms = customTerms;
    return snapshot;
}
function contactPayload(params) {
    const payload = {
        id: params.referralId,
        referralId: params.referralId,
        type: params.contact.type,
        createdByUid: params.actorUid,
        referrerUid: params.actorUid,
        consentStatus: params.consentStatus,
        recipientDisclosureAllowed: params.consentStatus === "confirmed",
        createdAt: params.now,
        updatedAt: params.now,
    };
    if (params.contact.name)
        payload.name = params.contact.name;
    if (params.contact.companyName)
        payload.companyName = params.contact.companyName;
    if (params.contact.email)
        payload.email = params.contact.email.trim().toLowerCase();
    if (params.contact.phone)
        payload.phone = params.contact.phone;
    if (params.referrerOrgId)
        payload.referrerOrgId = params.referrerOrgId;
    if (params.recipientUid)
        payload.recipientUid = params.recipientUid;
    if (params.recipientOrgId)
        payload.recipientOrgId = params.recipientOrgId;
    return payload;
}
exports.businessReferral_create = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.businessReferralCreateInputSchema, request.data);
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const db = (0, security_1.getDb)();
    const action = "business_referral.create";
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const referralRef = db.collection("businessReferrals").doc();
    const contactRef = db.collection("businessReferralContacts").doc(referralRef.id);
    if (input.recipientUid === actor.uid
        || (input.referrerOrgId && input.referrerOrgId === input.recipientOrgId)) {
        throw new https_1.HttpsError("invalid-argument", "A business referral requires a distinct recipient");
    }
    return db.runTransaction(async (transaction) => {
        const dedupeSnapshot = await transaction.get(dedupeRef);
        if (input.actorOrganizationId) {
            await (0, security_1.loadOrgAuthority)(transaction, db, input.actorOrganizationId, actor.uid, {
                managementRequired: true,
            });
        }
        const priorResult = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (priorResult)
            return { ...priorResult, idempotent: true };
        const recipientUserRef = input.recipientUid ? db.collection("users").doc(input.recipientUid) : undefined;
        const recipientOrgRef = input.recipientOrgId ? db.collection("orgs").doc(input.recipientOrgId) : undefined;
        const recipientMemberRef = input.recipientUid && input.recipientOrgId
            ? db.collection("orgMembers").doc(`${input.recipientOrgId}_${input.recipientUid}`)
            : undefined;
        const recipientInReferrerOrgRef = input.referrerOrgId && input.recipientUid
            ? db.collection("orgMembers").doc(`${input.referrerOrgId}_${input.recipientUid}`)
            : undefined;
        const referrerInRecipientOrgRef = input.recipientOrgId
            ? db.collection("orgMembers").doc(`${input.recipientOrgId}_${actor.uid}`)
            : undefined;
        const relatedRfxRef = input.relatedRfxId ? db.collection("rfx").doc(input.relatedRfxId) : undefined;
        const relatedTeamRef = input.relatedTeamId ? db.collection("rfxTeams").doc(input.relatedTeamId) : undefined;
        const relatedTeamActorGuardRef = input.relatedTeamId
            ? db.collection("rfxTeamMemberships").doc(input.relatedTeamId).collection("members").doc(actor.uid)
            : undefined;
        const relatedTeamRecipientGuardRef = input.relatedTeamId && input.recipientUid
            ? db.collection("rfxTeamMemberships").doc(input.relatedTeamId).collection("members").doc(input.recipientUid)
            : undefined;
        const serviceOfferRef = input.serviceOfferId
            ? db.collection("referralServiceOffers").doc(input.serviceOfferId)
            : undefined;
        const [recipientUserSnapshot, recipientOrgSnapshot, recipientMemberSnapshot, recipientInReferrerOrgSnapshot, referrerInRecipientOrgSnapshot, rfxSnapshot, teamSnapshot, teamActorGuardSnapshot, teamRecipientGuardSnapshot, serviceOfferSnapshot,] = await Promise.all([
            recipientUserRef ? transaction.get(recipientUserRef) : Promise.resolve(undefined),
            recipientOrgRef ? transaction.get(recipientOrgRef) : Promise.resolve(undefined),
            recipientMemberRef ? transaction.get(recipientMemberRef) : Promise.resolve(undefined),
            recipientInReferrerOrgRef
                ? transaction.get(recipientInReferrerOrgRef)
                : Promise.resolve(undefined),
            referrerInRecipientOrgRef
                ? transaction.get(referrerInRecipientOrgRef)
                : Promise.resolve(undefined),
            relatedRfxRef ? transaction.get(relatedRfxRef) : Promise.resolve(undefined),
            relatedTeamRef ? transaction.get(relatedTeamRef) : Promise.resolve(undefined),
            relatedTeamActorGuardRef
                ? transaction.get(relatedTeamActorGuardRef)
                : Promise.resolve(undefined),
            relatedTeamRecipientGuardRef
                ? transaction.get(relatedTeamRecipientGuardRef)
                : Promise.resolve(undefined),
            serviceOfferRef ? transaction.get(serviceOfferRef) : Promise.resolve(undefined),
        ]);
        if (recipientUserRef && !recipientUserSnapshot?.exists) {
            throw new https_1.HttpsError("not-found", "Recipient account not found");
        }
        if (recipientOrgRef && (!recipientOrgSnapshot?.exists || recipientOrgSnapshot.data()?.status !== "active")) {
            throw new https_1.HttpsError("failed-precondition", "Recipient organization is unavailable");
        }
        if (recipientMemberRef) {
            const member = recipientMemberSnapshot?.data();
            if (!recipientMemberSnapshot?.exists || member?.uid !== input.recipientUid || member?.orgId !== input.recipientOrgId) {
                throw new https_1.HttpsError("invalid-argument", "Recipient user is not a member of the recipient organization");
            }
        }
        if (recipientInReferrerOrgSnapshot?.exists || referrerInRecipientOrgSnapshot?.exists) {
            throw new https_1.HttpsError("invalid-argument", "A business referral cannot be made within the same organization");
        }
        if (input.relatedOpportunityId && input.relatedOpportunityId !== input.relatedRfxId) {
            throw new https_1.HttpsError("invalid-argument", "Only an authorized RFx may currently be used as a related opportunity");
        }
        if (relatedRfxRef) {
            if (!rfxSnapshot?.exists)
                throw new https_1.HttpsError("not-found", "Related RFx not found");
            const rfx = rfxSnapshot.data() ?? {};
            const discoverable = rfx.status === "open" && rfx.adminApprovalStatus === "approved";
            let manageable = !Object.prototype.hasOwnProperty.call(rfx, "orgId")
                && (rfx.ownerUid === actor.uid || rfx.createdBy === actor.uid);
            if (!discoverable && typeof rfx.orgId === "string" && rfx.orgId) {
                manageable = await hasOrgAuthority(transaction, rfx.orgId, actor, true);
            }
            if (!discoverable && !manageable) {
                throw new https_1.HttpsError("permission-denied", "The related RFx is not visible to this referrer");
            }
        }
        if (relatedTeamRef) {
            if (!teamSnapshot?.exists)
                throw new https_1.HttpsError("not-found", "Related team not found");
            const team = teamSnapshot.data();
            const actorGuard = teamActorGuardSnapshot?.data();
            if (!teamActorGuardSnapshot?.exists
                || actorGuard?.teamId !== input.relatedTeamId
                || actorGuard?.uid !== actor.uid) {
                throw new https_1.HttpsError("permission-denied", "Related-team membership is required");
            }
            if (input.recipientUid) {
                const recipientGuard = teamRecipientGuardSnapshot?.data();
                if (!teamRecipientGuardSnapshot?.exists
                    || recipientGuard?.teamId !== input.relatedTeamId
                    || recipientGuard?.uid !== input.recipientUid) {
                    throw new https_1.HttpsError("failed-precondition", "The individual referral recipient is not a current member of the related team");
                }
            }
            if (input.relatedRfxId && team?.rfxId !== input.relatedRfxId) {
                throw new https_1.HttpsError("invalid-argument", "The related team does not belong to the related RFx");
            }
        }
        const serviceOffer = input.serviceOfferId
            ? requirePublishedOffer(serviceOfferSnapshot, input.serviceOfferId)
            : undefined;
        if (serviceOffer && !offerMatchesRecipient(serviceOffer, input.recipientUid, input.recipientOrgId)) {
            throw new https_1.HttpsError("invalid-argument", "The service offer does not belong to the selected referral recipient");
        }
        const now = Date.now();
        const compensationPolicy = serviceOffer
            ? compensationForOffer(serviceOffer)
            : compensationForCreate(input.compensationPolicy);
        const referral = {
            id: referralRef.id,
            schemaVersion: 2,
            referrerUid: actor.uid,
            assignedStaffUids: [],
            referralType: input.referralType,
            title: input.title,
            needSummary: input.needSummary,
            consentStatus: input.consentStatus,
            status: "draft",
            compensationPolicy,
            version: 0,
            createdAt: now,
            updatedAt: now,
        };
        if (input.referrerOrgId)
            referral.referrerOrgId = input.referrerOrgId;
        if (input.recipientUid)
            referral.recipientUid = input.recipientUid;
        if (input.recipientOrgId)
            referral.recipientOrgId = input.recipientOrgId;
        if (input.category)
            referral.category = input.category;
        if (input.naicsCodes)
            referral.naicsCodes = input.naicsCodes;
        if (input.territoryFips)
            referral.territoryFips = input.territoryFips;
        if (input.relatedRfxId)
            referral.relatedRfxId = input.relatedRfxId;
        if (input.relatedTeamId)
            referral.relatedTeamId = input.relatedTeamId;
        if (input.relatedOpportunityId)
            referral.relatedOpportunityId = input.relatedOpportunityId;
        if (serviceOffer) {
            referral.serviceOfferId = serviceOffer.id;
            referral.serviceOfferVersion = serviceOffer.version;
        }
        if (input.referredParty) {
            // Explicit referred-party identity stays in the separately authorized contact document.
            referral.referredPartySummary = { type: input.referredParty.type };
        }
        if (input.consentStatus === "confirmed") {
            referral.consentConfirmedAt = now;
            referral.consentConfirmedByUid = actor.uid;
        }
        transaction.create(referralRef, referral);
        if (input.referredParty) {
            transaction.create(contactRef, contactPayload({
                referralId: referralRef.id,
                actorUid: actor.uid,
                now,
                contact: input.referredParty,
                consentStatus: input.consentStatus,
                referrerOrgId: input.referrerOrgId,
                recipientUid: input.recipientUid,
                recipientOrgId: input.recipientOrgId,
            }));
        }
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: referralRef.id,
            result: { referralId: referralRef.id },
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "businessReferral",
            entityId: referralRef.id,
            orgId: input.referrerOrgId,
            newStatus: "draft",
            metadata: {
                referralType: input.referralType,
                consentStatus: input.consentStatus,
                compensationType: compensationPolicy.type,
                hasContact: Boolean(input.referredParty),
            },
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: referralRef.id,
            eventType: "draft_created",
            actor,
            actorOrgId: input.referrerOrgId,
            referralVersion: 0,
            occurredAt: now,
            metadata: {
                referralType: input.referralType,
                compensationType: compensationPolicy.type,
                hasServiceOffer: Boolean(serviceOffer),
            },
        });
        return { referralId: referralRef.id, version: 0 };
    });
});
exports.businessReferral_send = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.businessReferralSendInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(referralRef);
        const referral = requireReferralSnapshot(snapshot);
        await requireReferrerAuthority(transaction, referral, actor, input.actorOrganizationId);
        if (referral.status === "sent")
            return { success: true, idempotent: true, version: getVersion(referral) };
        requireExpectedVersion(referral, input.expectedVersion);
        if (referral.status !== "draft") {
            throw new https_1.HttpsError("failed-precondition", `A ${referral.status} referral cannot be sent`);
        }
        if (referral.consentStatus === "withdrawn" || referral.consentStatus === "unknown_legacy") {
            throw new https_1.HttpsError("failed-precondition", "Consent state does not permit sending this referral");
        }
        const now = Date.now();
        const version = getVersion(referral) + 1;
        transaction.update(referralRef, {
            status: "sent",
            sentAt: now,
            expiresAt: now + BUSINESS_REFERRAL_SENT_TTL_MS,
            updatedAt: now,
            version,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: "business_referral.send",
            entityType: "businessReferral",
            entityId: input.referralId,
            orgId: referral.referrerOrgId,
            previousStatus: "draft",
            newStatus: "sent",
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: input.referralId,
            eventType: "referral_sent",
            actor,
            actorOrgId: referral.referrerOrgId,
            referralVersion: version,
            occurredAt: now,
        });
        return { success: true, version };
    });
});
exports.businessReferral_respond = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.businessReferralRespondInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    const commerceConfigRef = db.collection("platformConfiguration").doc("referralCommerce");
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(referralRef);
        const referral = requireReferralSnapshot(snapshot);
        const financialAcceptance = input.response === "accepted"
            && (referral.compensationPolicy.type !== "none" || Boolean(referral.serviceOfferId));
        await requireRecipientAuthority(transaction, referral, actor, financialAcceptance, input.actorOrganizationId);
        if (referral.status === input.response) {
            return { success: true, idempotent: true, version: getVersion(referral) };
        }
        requireExpectedVersion(referral, input.expectedVersion);
        if (referral.status !== "sent") {
            throw new https_1.HttpsError("failed-precondition", `A ${referral.status} referral cannot be answered`);
        }
        const now = Date.now();
        if (typeof referral.expiresAt !== "number"
            || !Number.isFinite(referral.expiresAt)
            || referral.expiresAt <= now) {
            throw new https_1.HttpsError("failed-precondition", "This referral has expired or has an invalid expiration and cannot be answered");
        }
        const version = getVersion(referral) + 1;
        const updates = {
            status: input.response,
            updatedAt: now,
            version,
            respondedAt: now,
            respondedByUid: actor.uid,
        };
        if (input.note)
            updates.recipientResponseNote = input.note;
        if (input.response === "accepted") {
            if (referral.schemaVersion >= 2 && input.acceptTerms?.acknowledged !== true) {
                throw new https_1.HttpsError("failed-precondition", "The recipient must explicitly accept the locked referral terms");
            }
            if (referral.acceptedTermsSnapshot) {
                throw new https_1.HttpsError("failed-precondition", "Accepted referral terms are already locked");
            }
            const [configSnapshot, offerSnapshot] = await Promise.all([
                transaction.get(commerceConfigRef),
                referral.serviceOfferId
                    ? transaction.get(db.collection("referralServiceOffers").doc(referral.serviceOfferId))
                    : Promise.resolve(undefined),
            ]);
            const config = referralCommerceConfig(configSnapshot);
            const offer = referral.serviceOfferId
                ? requirePublishedOffer(offerSnapshot, referral.serviceOfferId)
                : undefined;
            if (offer) {
                if (offer.version !== referral.serviceOfferVersion
                    || input.acceptTerms?.serviceOfferId !== offer.id
                    || input.acceptTerms.serviceOfferVersion !== offer.version
                    || !offerMatchesRecipient(offer, referral.recipientUid, referral.recipientOrgId)) {
                    throw new https_1.HttpsError("failed-precondition", "The accepted service-offer version does not match this referral");
                }
            }
            else if (input.acceptTerms?.serviceOfferId || input.acceptTerms?.serviceOfferVersion) {
                throw new https_1.HttpsError("invalid-argument", "This referral does not use a service offer");
            }
            if (!config.commerceEnabled && referral.compensationPolicy.type !== "none") {
                throw new https_1.HttpsError("failed-precondition", "Referral commerce is not currently enabled");
            }
            updates.acceptedAt = now;
            updates.acceptedTermsSnapshot = acceptedTermsSnapshot({
                referral,
                offer,
                platformFeeBasisPoints: config.platformFeeBasisPoints,
                platformFeeConfigVersion: config.version,
                acceptedByUid: actor.uid,
                acceptedByOrgId: referral.recipientOrgId,
                acceptedAt: now,
            });
            updates.commerceStatus = "none";
            updates.compensationPolicy = {
                ...referral.compensationPolicy,
                status: referral.compensationPolicy.type === "none" ? "none" : "agreed",
                lockedAt: now,
            };
        }
        else if (referral.compensationPolicy.type !== "none") {
            updates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
        }
        transaction.update(referralRef, updates);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: `business_referral.${input.response}`,
            entityType: "businessReferral",
            entityId: input.referralId,
            orgId: referral.recipientOrgId,
            previousStatus: "sent",
            newStatus: input.response,
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: input.referralId,
            eventType: input.response === "accepted" ? "recipient_accepted" : "recipient_declined",
            actor,
            actorOrgId: referral.recipientOrgId,
            referralVersion: version,
            occurredAt: now,
        });
        if (input.response === "accepted") {
            writeReferralTimeline(transaction, db, {
                referralId: input.referralId,
                eventType: "terms_snapshot_locked",
                actor,
                actorOrgId: referral.recipientOrgId,
                referralVersion: version,
                occurredAt: now,
                metadata: {
                    compensationType: referral.compensationPolicy.type,
                    platformFeeBasisPoints: updates.acceptedTermsSnapshot.platformFeeBasisPoints,
                },
            });
        }
        return { success: true, version };
    });
});
exports.businessReferral_progress = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.businessReferralProgressInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(referralRef);
        const referral = requireReferralSnapshot(snapshot);
        if (input.status === "withdrawn") {
            await requireReferrerAuthority(transaction, referral, actor, input.actorOrganizationId);
        }
        else {
            await requireRecipientAuthority(transaction, referral, actor, false, input.actorOrganizationId);
        }
        if (referral.status === input.status) {
            return { success: true, idempotent: true, version: getVersion(referral) };
        }
        requireExpectedVersion(referral, input.expectedVersion);
        if (referral.activeDisputeId) {
            throw new https_1.HttpsError("failed-precondition", "Resolve the active dispute before progressing the referral");
        }
        const allowed = input.status === "in_progress"
            ? referral.status === "accepted"
            : input.status === "withdrawn"
                ? referral.status === "draft" || referral.status === "sent"
                : input.status === "closed"
                    ? referral.status === "accepted" || referral.status === "in_progress"
                    : referral.status === "in_progress";
        if (!allowed) {
            throw new https_1.HttpsError("failed-precondition", `Referral cannot transition from ${referral.status} to ${input.status}`);
        }
        const now = Date.now();
        const version = getVersion(referral) + 1;
        const updates = { status: input.status, updatedAt: now, version };
        if (input.status === "in_progress")
            updates.inProgressAt = now;
        if (input.status === "converted" || input.status === "closed") {
            updates.closedAt = now;
            if (input.status === "converted")
                updates.convertedAt = now;
            updates.outcome = {
                ...input.outcome,
                recordedAt: now,
                recordedByUid: actor.uid,
            };
        }
        if (input.status === "withdrawn") {
            updates.withdrawnAt = now;
            updates.withdrawnByUid = actor.uid;
        }
        if (referral.compensationPolicy.type !== "none") {
            if (input.status === "converted" && referral.compensationPolicy.status === "agreed") {
                updates.commerceStatus = referral.compensationPolicy.type === "benefit"
                    ? "none"
                    : "awaiting_transaction";
            }
            else if (input.status === "closed" || input.status === "withdrawn") {
                updates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
                updates.commerceStatus = "cancelled";
            }
        }
        transaction.update(referralRef, updates);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: `business_referral.${input.status}`,
            entityType: "businessReferral",
            entityId: input.referralId,
            orgId: input.status === "withdrawn" ? referral.referrerOrgId : referral.recipientOrgId,
            previousStatus: referral.status,
            newStatus: input.status,
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: input.referralId,
            eventType: input.status === "converted"
                ? "referral_converted"
                : input.status === "closed"
                    ? "referral_closed"
                    : input.status === "withdrawn"
                        ? "referral_withdrawn"
                        : "progress_changed",
            actor,
            actorOrgId: input.status === "withdrawn" ? referral.referrerOrgId : referral.recipientOrgId,
            referralVersion: version,
            occurredAt: now,
            metadata: { status: input.status },
        });
        return { success: true, version };
    });
});
async function updateConsent(request, forcedStatus) {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const raw = typeof request.data === "object" && request.data !== null
        ? { ...request.data, ...(forcedStatus ? { consentStatus: forcedStatus } : {}) }
        : request.data;
    const input = (0, contracts_1.parseCallableInput)(contracts_1.businessReferralConsentInputSchema, raw);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    const contactRef = db.collection("businessReferralContacts").doc(input.referralId);
    return db.runTransaction(async (transaction) => {
        const [referralSnapshot, contactSnapshot] = await Promise.all([
            transaction.get(referralRef),
            transaction.get(contactRef),
        ]);
        const referral = requireReferralSnapshot(referralSnapshot);
        await requireReferrerAuthority(transaction, referral, actor);
        if (!contactSnapshot.exists) {
            throw new https_1.HttpsError("failed-precondition", "This referral has no third-party contact record");
        }
        if (referral.consentStatus === input.consentStatus) {
            return { success: true, version: getVersion(referral), status: referral.status };
        }
        requireExpectedVersion(referral, input.expectedVersion);
        if (input.consentStatus === "confirmed" && referral.consentStatus !== "pending") {
            throw new https_1.HttpsError("failed-precondition", "Only pending consent can be confirmed");
        }
        if (input.consentStatus === "confirmed"
            && !["draft", "sent", "accepted", "in_progress"].includes(referral.status)) {
            throw new https_1.HttpsError("failed-precondition", "Consent cannot disclose contact details after referral closure");
        }
        if (input.consentStatus === "withdrawn"
            && referral.consentStatus !== "pending"
            && referral.consentStatus !== "confirmed") {
            throw new https_1.HttpsError("failed-precondition", "Consent cannot be withdrawn from its current state");
        }
        const now = Date.now();
        const version = getVersion(referral) + 1;
        let nextStatus = referral.status;
        const referralUpdates = {
            consentStatus: input.consentStatus,
            updatedAt: now,
            version,
        };
        if (input.consentStatus === "confirmed") {
            referralUpdates.consentConfirmedAt = now;
            referralUpdates.consentConfirmedByUid = actor.uid;
        }
        else {
            referralUpdates.consentWithdrawnAt = now;
            referralUpdates.consentWithdrawnByUid = actor.uid;
            if (["draft", "sent", "accepted", "in_progress"].includes(referral.status)) {
                nextStatus = "withdrawn";
                referralUpdates.status = "withdrawn";
                referralUpdates.withdrawnAt = now;
                referralUpdates.withdrawnByUid = actor.uid;
                if (referral.compensationPolicy.type !== "none") {
                    referralUpdates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
                }
            }
        }
        transaction.update(referralRef, referralUpdates);
        transaction.update(contactRef, {
            consentStatus: input.consentStatus,
            recipientDisclosureAllowed: input.consentStatus === "confirmed",
            updatedAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: `business_referral.consent_${input.consentStatus}`,
            entityType: "businessReferral",
            entityId: input.referralId,
            orgId: referral.referrerOrgId,
            previousStatus: referral.status,
            newStatus: nextStatus,
            metadata: { previousConsent: referral.consentStatus, newConsent: input.consentStatus },
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: input.referralId,
            eventType: input.consentStatus === "confirmed" ? "consent_confirmed" : "consent_withdrawn",
            actor,
            actorOrgId: referral.referrerOrgId,
            referralVersion: version,
            occurredAt: now,
            metadata: { disclosureAllowed: input.consentStatus === "confirmed" },
        });
        return { success: true, version, status: nextStatus };
    });
}
exports.businessReferral_updateConsent = (0, https_1.onCall)((request) => updateConsent(request));
exports.businessReferral_confirmConsent = (0, https_1.onCall)((request) => updateConsent(request, "confirmed"));
exports.businessReferral_withdrawConsent = (0, https_1.onCall)((request) => updateConsent(request, "withdrawn"));
/**
 * Materialize a one-minute, exact-path Storage decision after evaluating the
 * full current referral and organization authority graph server-side.
 */
exports.businessReferral_prepareEvidenceAccess = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(referralEvidenceAccessInputSchema, request.data);
    requireReferralEvidenceGrantPaths(input.referralId, actor.uid, input.operation, input.storagePaths);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    const grantRef = referralStorageGrantRef(db, input.referralId, actor.uid);
    return db.runTransaction(async (transaction) => {
        const referralSnapshot = await transaction.get(referralRef);
        const referral = requireReferralSnapshot(referralSnapshot);
        if (input.operation === "upload") {
            await requirePartyAuthority(transaction, referral, actor);
        }
        else {
            let mayReadWithoutConsent = actor.isAdmin
                || (actor.role === "staff" && referral.assignedStaffUids?.includes(actor.uid))
                || isIndividualReferrer(referral, actor.uid);
            if (!mayReadWithoutConsent) {
                mayReadWithoutConsent = await hasReferralOrgAuthority(transaction, referral.referrerOrgId, actor);
            }
            if (!mayReadWithoutConsent) {
                if (!["confirmed", "not_required"].includes(referral.consentStatus)) {
                    throw new https_1.HttpsError("permission-denied", "Confirmed referral consent is required to read this evidence");
                }
                await requirePartyAuthority(transaction, referral, actor);
            }
        }
        const now = Date.now();
        const expiresAt = now + BUSINESS_REFERRAL_STORAGE_GRANT_TTL_MS;
        transaction.set(grantRef, {
            id: actor.uid,
            grantType: "business_referral_storage",
            referralId: input.referralId,
            accessorUid: actor.uid,
            allowedReadStoragePaths: input.operation === "read" ? input.storagePaths : [],
            allowedCreateStoragePaths: input.operation === "upload" ? input.storagePaths : [],
            createdAt: now,
            updatedAt: now,
            expiresAt,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: `business_referral.evidence_${input.operation}_grant_prepared`,
            entityType: "businessReferral",
            entityId: input.referralId,
            metadata: { pathCount: input.storagePaths.length },
            createdAt: now,
        });
        return {
            success: true,
            operation: input.operation,
            expiresAt,
            allowedPathCount: input.storagePaths.length,
        };
    });
});
exports.businessReferral_createDispute = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.referralDisputeCreateInputSchema, request.data);
    assertCanonicalDisputeEvidencePaths(input.referralId, actor.uid, input.evidenceStoragePaths);
    await verifyDisputeEvidence(input.evidenceStoragePaths);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    const disputeRef = db.collection("businessReferralDisputes").doc();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(referralRef);
        const referral = requireReferralSnapshot(snapshot);
        await requirePartyAuthority(transaction, referral, actor);
        if (input.expectedVersion !== undefined) {
            requireExpectedVersion(referral, input.expectedVersion);
        }
        if (!["accepted", "in_progress", "converted", "closed"].includes(referral.status)) {
            throw new https_1.HttpsError("failed-precondition", "The referral is not in a disputable state");
        }
        if (referral.activeDisputeId) {
            throw new https_1.HttpsError("already-exists", "This referral already has an active dispute", {
                disputeId: referral.activeDisputeId,
            });
        }
        const now = Date.now();
        const version = getVersion(referral) + 1;
        transaction.create(disputeRef, {
            id: disputeRef.id,
            referralId: input.referralId,
            openerUid: actor.uid,
            referrerUid: referral.referrerUid,
            recipientUid: referral.recipientUid ?? null,
            referrerOrgId: referral.referrerOrgId ?? null,
            recipientOrgId: referral.recipientOrgId ?? null,
            assignedStaffUids: referral.assignedStaffUids ?? [],
            reason: input.reason,
            evidenceStoragePaths: input.evidenceStoragePaths,
            status: "open",
            createdAt: now,
            updatedAt: now,
        });
        const referralUpdates = {
            activeDisputeId: disputeRef.id,
            version,
            updatedAt: now,
        };
        if (typeof referral.commerceStatus === "string") {
            referralUpdates.commerceStatusBeforeDispute = referral.commerceStatus;
            referralUpdates.commerceStatus = "disputed";
        }
        if (referral.compensationPolicy.type !== "none") {
            referralUpdates.compensationStatusBeforeDispute = referral.compensationPolicy.status;
            referralUpdates.compensationPolicy = { ...referral.compensationPolicy, status: "disputed" };
        }
        transaction.update(referralRef, referralUpdates);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: "business_referral.dispute_opened",
            entityType: "businessReferral",
            entityId: input.referralId,
            metadata: { disputeId: disputeRef.id, evidenceCount: input.evidenceStoragePaths.length },
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: input.referralId,
            eventType: "dispute_opened",
            actor,
            actorOrgId: isIndividualReferrer(referral, actor.uid)
                ? referral.referrerOrgId
                : referral.recipientOrgId,
            referralVersion: version,
            occurredAt: now,
            metadata: { evidenceCount: input.evidenceStoragePaths.length },
        });
        return { success: true, disputeId: disputeRef.id };
    });
});
exports.businessReferral_resolveDispute = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireStaffOrAdmin)(actor);
    const input = (0, contracts_1.parseCallableInput)(disputeResolveInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const disputeRef = db.collection("businessReferralDisputes").doc(input.disputeId);
    return db.runTransaction(async (transaction) => {
        const disputeSnapshot = await transaction.get(disputeRef);
        if (!disputeSnapshot.exists)
            throw new https_1.HttpsError("not-found", "Dispute not found");
        const dispute = disputeSnapshot.data() ?? {};
        if (typeof dispute.referralId !== "string") {
            throw new https_1.HttpsError("failed-precondition", "Dispute referral identity is invalid");
        }
        const referralRef = db.collection("businessReferrals").doc(dispute.referralId);
        const referralSnapshot = await transaction.get(referralRef);
        const referral = requireReferralSnapshot(referralSnapshot);
        if (!actor.isAdmin && !referral.assignedStaffUids?.includes(actor.uid)) {
            throw new https_1.HttpsError("permission-denied", "The dispute must be assigned to this staff member");
        }
        if (!actor.isAdmin && dispute.openerUid === actor.uid) {
            throw new https_1.HttpsError("permission-denied", "The dispute opener cannot resolve their own dispute");
        }
        if (dispute.status !== "open" && dispute.status !== "under_review") {
            return { success: true, idempotent: true, status: dispute.status };
        }
        if (referral.activeDisputeId !== input.disputeId) {
            throw new https_1.HttpsError("failed-precondition", "This dispute is not the referral's current active dispute");
        }
        const now = Date.now();
        const resolutionStatus = `resolved_${input.resolution}`;
        transaction.update(disputeRef, {
            status: resolutionStatus,
            resolutionNote: input.note,
            resolvedAt: now,
            resolvedByUid: actor.uid,
            updatedAt: now,
        });
        const storedCompensationStatus = referral.compensationStatusBeforeDispute;
        const restoredCompensationStatus = typeof storedCompensationStatus === "string"
            && RESTORABLE_COMPENSATION_STATUSES.has(storedCompensationStatus)
            ? storedCompensationStatus
            : "agreed";
        const compensationStatus = ["closed", "declined", "withdrawn", "expired"].includes(referral.status)
            || input.resolution === "upheld"
            ? "cancelled"
            : restoredCompensationStatus;
        const version = getVersion(referral) + 1;
        const updates = {
            activeDisputeId: firestore_1.FieldValue.delete(),
            compensationStatusBeforeDispute: firestore_1.FieldValue.delete(),
            commerceStatusBeforeDispute: firestore_1.FieldValue.delete(),
            version,
            updatedAt: now,
        };
        const priorCommerceStatus = typeof referral.commerceStatusBeforeDispute === "string"
            ? referral.commerceStatusBeforeDispute
            : undefined;
        if (typeof referral.commerceStatus === "string") {
            updates.commerceStatus = input.resolution === "upheld"
                ? "cancelled"
                : priorCommerceStatus ?? "settlement_unavailable";
        }
        if (referral.compensationPolicy.type !== "none") {
            updates.compensationPolicy = {
                ...referral.compensationPolicy,
                status: compensationStatus,
            };
        }
        transaction.update(referralRef, updates);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: "business_referral.dispute_resolved",
            entityType: "businessReferral",
            entityId: dispute.referralId,
            metadata: { disputeId: input.disputeId, resolution: input.resolution },
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: dispute.referralId,
            eventType: "dispute_resolved",
            actor,
            referralVersion: version,
            occurredAt: now,
            metadata: { resolution: input.resolution },
        });
        return { success: true, status: resolutionStatus };
    });
});
async function expireSentReferral(referralRef, now) {
    const db = (0, security_1.getDb)();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(referralRef);
        if (!snapshot.exists)
            return false;
        const referral = requireReferralSnapshot(snapshot);
        const expiresAt = typeof referral.expiresAt === "number" ? referral.expiresAt : null;
        if (referral.status !== "sent" || expiresAt === null || expiresAt > now)
            return false;
        const version = getVersion(referral) + 1;
        const updates = {
            status: "expired",
            expiredAt: now,
            updatedAt: now,
            version,
        };
        if (referral.compensationPolicy.type !== "none") {
            updates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
        }
        transaction.update(referralRef, updates);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: "system",
            actorRole: "system",
            action: "business_referral.expired",
            entityType: "businessReferral",
            entityId: referralRef.id,
            previousStatus: "sent",
            newStatus: "expired",
            createdAt: now,
        });
        writeReferralTimeline(transaction, db, {
            referralId: referralRef.id,
            eventType: "referral_expired",
            actor: { uid: "system", role: "system" },
            referralVersion: version,
            occurredAt: now,
        });
        return true;
    });
}
async function cleanupExpiredBusinessReferralStorageGrantAt(grantRef, now, db = (0, security_1.getDb)()) {
    return db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(grantRef);
        if (!currentSnapshot.exists)
            return false;
        const current = currentSnapshot.data() ?? {};
        if (current.grantType !== "business_referral_storage"
            || typeof current.expiresAt !== "number"
            || !Number.isFinite(current.expiresAt)
            || current.expiresAt > now)
            return false;
        transaction.delete(grantRef);
        return true;
    });
}
/** Bounded expiry worker for unanswered business introductions. */
exports.businessReferral_expireSent = (0, scheduler_1.onSchedule)({ schedule: "every 60 minutes", timeZone: "UTC", retryCount: 3 }, async () => {
    const db = (0, security_1.getDb)();
    const now = Date.now();
    const snapshot = await db.collection("businessReferrals")
        .where("status", "==", "sent")
        .where("expiresAt", "<=", now)
        .orderBy("expiresAt", "asc")
        .limit(MAX_REFERRAL_EXPIRATIONS_PER_RUN)
        .get();
    const outcomes = await Promise.all(snapshot.docs.map((document) => expireSentReferral(document.ref, now)));
    const storageGrantSnapshot = await db.collectionGroup("storageGrants")
        .where("expiresAt", "<=", now)
        .orderBy("expiresAt", "asc")
        .limit(MAX_REFERRAL_EXPIRATIONS_PER_RUN)
        .get();
    const storageGrantOutcomes = await Promise.all(storageGrantSnapshot.docs.map((document) => (cleanupExpiredBusinessReferralStorageGrantAt(document.ref, now, db))));
    logger.info("Business referral expiry completed", {
        scanned: snapshot.size,
        expired: outcomes.filter(Boolean).length,
        maxPerRun: MAX_REFERRAL_EXPIRATIONS_PER_RUN,
        storageGrantsScanned: storageGrantSnapshot.size,
        storageGrantsRemoved: storageGrantOutcomes.filter(Boolean).length,
    });
});
