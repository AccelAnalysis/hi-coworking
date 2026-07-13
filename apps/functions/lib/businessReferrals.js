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
exports.businessReferral_expireSent = exports.businessReferral_resolveDispute = exports.businessReferral_createDispute = exports.businessReferral_withdrawConsent = exports.businessReferral_confirmConsent = exports.businessReferral_updateConsent = exports.businessReferral_progress = exports.businessReferral_respond = exports.businessReferral_send = exports.businessReferral_create = void 0;
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
const MAX_REFERRAL_EXPIRATIONS_PER_RUN = 200;
const ALLOWED_REFERRAL_EVIDENCE_CONTENT_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
]);
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
    catch {
        return false;
    }
}
async function requireReferrerAuthority(transaction, referral, actor) {
    if (referral.recipientUid === actor.uid) {
        throw new https_1.HttpsError("permission-denied", "The recipient cannot act as the referrer");
    }
    if (referral.referrerUid === actor.uid)
        return;
    if (await hasOrgAuthority(transaction, referral.recipientOrgId, actor)) {
        throw new https_1.HttpsError("permission-denied", "Recipient-organization authority cannot act for the referrer");
    }
    if (await hasOrgAuthority(transaction, referral.referrerOrgId, actor, true))
        return;
    throw new https_1.HttpsError("permission-denied", "Referrer authority is required");
}
async function requireRecipientAuthority(transaction, referral, actor) {
    if (referral.referrerUid === actor.uid) {
        throw new https_1.HttpsError("permission-denied", "The referrer cannot act as the recipient");
    }
    if (referral.recipientUid === actor.uid)
        return;
    if (await hasOrgAuthority(transaction, referral.referrerOrgId, actor)) {
        throw new https_1.HttpsError("permission-denied", "Referring-organization authority cannot act for the recipient");
    }
    if (await hasOrgAuthority(transaction, referral.recipientOrgId, actor))
        return;
    throw new https_1.HttpsError("permission-denied", "Recipient authority is required");
}
async function requirePartyAuthority(transaction, referral, actor) {
    if (referral.referrerUid === actor.uid
        || referral.recipientUid === actor.uid
        || (actor.role === "staff" && referral.assignedStaffUids?.includes(actor.uid)))
        return;
    if (await hasOrgAuthority(transaction, referral.referrerOrgId, actor))
        return;
    if (await hasOrgAuthority(transaction, referral.recipientOrgId, actor))
        return;
    throw new https_1.HttpsError("permission-denied", "Referral-party authority is required");
}
function requireReferralSnapshot(snapshot) {
    if (!snapshot.exists)
        throw new https_1.HttpsError("not-found", "Business referral not found");
    const referral = snapshot.data();
    if (referral.schemaVersion !== 1) {
        throw new https_1.HttpsError("failed-precondition", "Unsupported business-referral version");
    }
    return referral;
}
function compensationForCreate(policy) {
    if (!policy || policy.type === "none")
        return { type: "none", status: "none" };
    return { ...policy, status: "proposed" };
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
        const priorResult = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (priorResult)
            return { ...priorResult, idempotent: true };
        if (input.referrerOrgId) {
            await (0, security_1.loadOrgAuthority)(transaction, db, input.referrerOrgId, actor.uid, {
                managementRequired: true,
            });
        }
        const recipientUserRef = input.recipientUid ? db.collection("users").doc(input.recipientUid) : undefined;
        const recipientOrgRef = input.recipientOrgId ? db.collection("orgs").doc(input.recipientOrgId) : undefined;
        const recipientMemberRef = input.recipientUid && input.recipientOrgId
            ? db.collection("orgMembers").doc(`${input.recipientOrgId}_${input.recipientUid}`)
            : undefined;
        const relatedRfxRef = input.relatedRfxId ? db.collection("rfx").doc(input.relatedRfxId) : undefined;
        const relatedTeamRef = input.relatedTeamId ? db.collection("rfxTeams").doc(input.relatedTeamId) : undefined;
        const [recipientUserSnapshot, recipientOrgSnapshot, recipientMemberSnapshot, rfxSnapshot, teamSnapshot] = await Promise.all([
            recipientUserRef ? transaction.get(recipientUserRef) : Promise.resolve(undefined),
            recipientOrgRef ? transaction.get(recipientOrgRef) : Promise.resolve(undefined),
            recipientMemberRef ? transaction.get(recipientMemberRef) : Promise.resolve(undefined),
            relatedRfxRef ? transaction.get(relatedRfxRef) : Promise.resolve(undefined),
            relatedTeamRef ? transaction.get(relatedTeamRef) : Promise.resolve(undefined),
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
        if (relatedRfxRef && !rfxSnapshot?.exists)
            throw new https_1.HttpsError("not-found", "Related RFx not found");
        if (relatedTeamRef) {
            if (!teamSnapshot?.exists)
                throw new https_1.HttpsError("not-found", "Related team not found");
            const team = teamSnapshot.data();
            const isParticipant = team?.primeUid === actor.uid
                || (Array.isArray(team?.memberUids) && team.memberUids.includes(actor.uid));
            if (!isParticipant) {
                throw new https_1.HttpsError("permission-denied", "Related-team membership is required");
            }
            if (input.relatedRfxId && team?.rfxId !== input.relatedRfxId) {
                throw new https_1.HttpsError("invalid-argument", "The related team does not belong to the related RFx");
            }
        }
        const now = Date.now();
        const compensationPolicy = compensationForCreate(input.compensationPolicy);
        const referral = {
            id: referralRef.id,
            schemaVersion: 1,
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
        await requireReferrerAuthority(transaction, referral, actor);
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
        return { success: true, version };
    });
});
exports.businessReferral_respond = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.businessReferralRespondInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(referralRef);
        const referral = requireReferralSnapshot(snapshot);
        await requireRecipientAuthority(transaction, referral, actor);
        if (referral.status === input.response) {
            return { success: true, idempotent: true, version: getVersion(referral) };
        }
        requireExpectedVersion(referral, input.expectedVersion);
        if (referral.status !== "sent") {
            throw new https_1.HttpsError("failed-precondition", `A ${referral.status} referral cannot be answered`);
        }
        const now = Date.now();
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
            updates.acceptedAt = now;
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
            await requireReferrerAuthority(transaction, referral, actor);
        }
        else {
            await requireRecipientAuthority(transaction, referral, actor);
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
                updates.compensationPolicy = { ...referral.compensationPolicy, status: "due" };
            }
            else if (input.status === "closed" || input.status === "withdrawn") {
                updates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
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
        return { success: true, version, status: nextStatus };
    });
}
exports.businessReferral_updateConsent = (0, https_1.onCall)((request) => updateConsent(request));
exports.businessReferral_confirmConsent = (0, https_1.onCall)((request) => updateConsent(request, "confirmed"));
exports.businessReferral_withdrawConsent = (0, https_1.onCall)((request) => updateConsent(request, "withdrawn"));
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
        if (!["accepted", "in_progress", "converted", "closed"].includes(referral.status)) {
            throw new https_1.HttpsError("failed-precondition", "The referral is not in a disputable state");
        }
        if (referral.activeDisputeId) {
            throw new https_1.HttpsError("already-exists", "This referral already has an active dispute", {
                disputeId: referral.activeDisputeId,
            });
        }
        const now = Date.now();
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
            version: getVersion(referral) + 1,
            updatedAt: now,
        };
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
            : referral.status === "converted"
                ? "due"
                : "agreed";
        const compensationStatus = ["closed", "declined", "withdrawn", "expired"].includes(referral.status)
            || input.resolution === "upheld"
            ? "cancelled"
            : restoredCompensationStatus;
        const updates = {
            activeDisputeId: firestore_1.FieldValue.delete(),
            compensationStatusBeforeDispute: firestore_1.FieldValue.delete(),
            version: getVersion(referral) + 1,
            updatedAt: now,
        };
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
        const updates = {
            status: "expired",
            expiredAt: now,
            updatedAt: now,
            version: getVersion(referral) + 1,
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
    logger.info("Business referral expiry completed", {
        scanned: snapshot.size,
        expired: outcomes.filter(Boolean).length,
        maxPerRun: MAX_REFERRAL_EXPIRATIONS_PER_RUN,
    });
});
