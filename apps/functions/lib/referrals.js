"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referral_createPayoutCheckout = exports.referral_markPaid = exports.referral_convert = exports.referral_decline = exports.referral_contact = exports.referral_accept = exports.referral_create = exports.legacyBusinessReferral_listReceived = exports.platformInvite_listReceived = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const config_1 = require("./config");
const contracts_1 = require("./exchange/contracts");
const security_1 = require("./exchange/security");
const legacySettlementInputSchema = zod_1.z
    .object({
    referralId: zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    idempotencyKey: contracts_1.idempotencyKeySchema,
    settlementReference: zod_1.z
        .string()
        .trim()
        .min(3)
        .max(160)
        .regex(/^[A-Za-z0-9_.:@\-/ ]+$/)
        .refine((value) => !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) && !/^www\./i.test(value), "A ledger reference, not a URL, is required"),
    note: zod_1.z.string().trim().max(2000).optional(),
})
    .strict();
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
async function hasLegacyOrgAuthority(transaction, orgId, actor) {
    if (typeof orgId !== "string" || !orgId)
        return false;
    try {
        await (0, security_1.loadOrgAuthority)(transaction, (0, security_1.getDb)(), orgId, actor.uid);
        return true;
    }
    catch {
        return false;
    }
}
async function requireLegacyProviderAuthority(transaction, referral, actor) {
    if (Object.prototype.hasOwnProperty.call(referral, "providerOrgId")) {
        if (await hasLegacyOrgAuthority(transaction, referral.providerOrgId, actor))
            return;
    }
    else if (referral.providerUid === actor.uid) {
        return;
    }
    throw new https_1.HttpsError("permission-denied", "Only the receiving provider may perform this action");
}
function requireLegacyBusinessReferral(referral) {
    if (getLegacyReferralDomain(referral) !== "business_intro") {
        throw new https_1.HttpsError("failed-precondition", "This record is not an unambiguous legacy business referral");
    }
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function getLegacyReferralDomain(referral) {
    const platformIdentityFields = [
        "referredEmail",
        "invitedEmail",
        "inviteeUid",
        "referredUid",
    ];
    const platformFields = [
        ...platformIdentityFields,
        "claimedByUid",
        "cancelledByUid",
    ];
    const businessFields = [
        "providerUid",
        "providerOrgId",
        "clientName",
        "clientEmail",
        "clientPhone",
        "clientCompany",
    ];
    const hasField = (field) => (Object.prototype.hasOwnProperty.call(referral, field));
    const malformedIdentityField = [...platformFields, ...businessFields]
        .some((field) => hasField(field) && !nonEmptyString(referral[field]));
    if (malformedIdentityField)
        return "unknown";
    const hasPlatformIdentity = platformIdentityFields
        .some((field) => nonEmptyString(referral[field]));
    const hasPlatformField = platformFields.some(hasField);
    const hasBusinessIdentity = businessFields.some((field) => nonEmptyString(referral[field]));
    if (!hasPlatformIdentity && !hasBusinessIdentity)
        return "unknown";
    if ((hasPlatformField && hasBusinessIdentity) || (hasPlatformIdentity && hasBusinessIdentity)) {
        return "unknown";
    }
    const inferred = hasPlatformIdentity ? "platform_invite" : "business_intro";
    return referral.type && referral.type !== inferred ? "unknown" : inferred;
}
function safePlatformInvitePayload(id, referral) {
    const payload = {
        id,
        type: "platform_invite",
        referrerUid: referral.referrerUid,
        status: referral.status,
        createdAt: referral.createdAt,
    };
    const optionalFields = [
        "referredEmail",
        "invitedEmail",
        "referredName",
        "invitedName",
        "inviteStatus",
        "inviteeUid",
        "referredUid",
        "claimedByUid",
        "cancelledByUid",
        "claimedAt",
        "cancelledAt",
        "note",
        "updatedAt",
        "acceptedAt",
        "expiresAt",
    ];
    for (const field of optionalFields) {
        if (referral[field] !== undefined)
            payload[field] = referral[field];
    }
    return payload;
}
function legacyBusinessContactMayBeDisclosed(referral) {
    return referral.consentStatus === "confirmed" || referral.recipientDisclosureAllowed === true;
}
function safeLegacyBusinessPayload(id, referral) {
    const payload = {
        id,
        type: "business_intro",
        referrerUid: referral.referrerUid,
        providerUid: referral.providerUid,
        status: referral.status,
        createdAt: referral.createdAt,
    };
    const alwaysVisible = [
        "referrerOrgId",
        "providerOrgId",
        "note",
        "updatedAt",
        "acceptedAt",
        "convertedAt",
        "paidAt",
        "policySnapshot",
        "consentStatus",
        "recipientDisclosureAllowed",
    ];
    for (const field of alwaysVisible) {
        if (referral[field] !== undefined)
            payload[field] = referral[field];
    }
    if (legacyBusinessContactMayBeDisclosed(referral)) {
        const contactFields = [
            "clientName",
            "clientEmail",
            "clientPhone",
            "clientCompany",
        ];
        for (const field of contactFields) {
            if (referral[field] !== undefined)
                payload[field] = referral[field];
        }
    }
    else {
        payload.contactRedacted = true;
    }
    return payload;
}
async function activeActorOrgIds(db, actorUid) {
    const membershipSnapshot = await db.collection("orgMembers")
        .where("uid", "==", actorUid)
        .limit(100)
        .get();
    const candidates = membershipSnapshot.docs
        .map((document) => {
        const data = document.data();
        return {
            documentId: document.id,
            uid: data.uid,
            orgId: data.orgId,
            status: data.status,
        };
    })
        .filter((membership) => (membership.uid === actorUid
        && typeof membership.orgId === "string"
        && membership.orgId.length > 0
        && membership.documentId === `${membership.orgId}_${actorUid}`))
        .filter((membership) => membership.status === undefined || membership.status === "active")
        .map((membership) => membership.orgId)
        .filter((orgId, index, all) => all.indexOf(orgId) === index);
    if (candidates.length === 0)
        return [];
    const orgSnapshots = await db.getAll(...candidates.map((orgId) => db.collection("orgs").doc(orgId)));
    return orgSnapshots
        .filter((snapshot) => snapshot.exists && snapshot.get("status") === "active")
        .map((snapshot) => snapshot.id);
}
/**
 * Server-mediated inbox for typed and safely inferred legacy platform invites.
 * A direct Firestore query cannot prove that an email-matched document lacks
 * business-referral fields, so filtering happens at this trusted boundary.
 */
exports.platformInvite_listReceived = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const db = (0, security_1.getDb)();
    const queries = [
        db.collection("referrals").where("inviteeUid", "==", actor.uid).limit(200).get(),
        db.collection("referrals").where("referredUid", "==", actor.uid).limit(200).get(),
        db.collection("referrals").where("claimedByUid", "==", actor.uid).limit(200).get(),
    ];
    const email = actor.email?.trim().toLowerCase();
    if (request.auth?.token.email_verified === true && email) {
        queries.push(db.collection("referrals").where("referredEmail", "==", email).limit(200).get(), db.collection("referrals").where("invitedEmail", "==", email).limit(200).get());
    }
    const snapshots = await Promise.all(queries);
    const invitations = new Map();
    for (const snapshot of snapshots) {
        for (const document of snapshot.docs) {
            const referral = document.data();
            if (getLegacyReferralDomain(referral) !== "platform_invite")
                continue;
            const boundUid = referral.claimedByUid
                ?? referral.cancelledByUid
                ?? referral.inviteeUid
                ?? referral.referredUid;
            const invitedEmail = (referral.invitedEmail ?? referral.referredEmail)?.trim().toLowerCase();
            const uidMatch = nonEmptyString(boundUid) && boundUid === actor.uid;
            const emailMatch = request.auth?.token.email_verified === true
                && Boolean(email)
                && invitedEmail === email;
            if (!uidMatch && !emailMatch)
                continue;
            invitations.set(document.id, safePlatformInvitePayload(document.id, referral));
        }
    }
    return {
        invitations: [...invitations.values()]
            .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
            .slice(0, 200),
    };
});
/**
 * Server-mediated legacy business-introduction inbox. Inline third-party
 * contact fields are removed unless the legacy record proves disclosure
 * consent; the primary Run 1 business-referral domain stores contacts in its
 * separate consent-gated collection.
 */
exports.legacyBusinessReferral_listReceived = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const db = (0, security_1.getDb)();
    const orgIds = await activeActorOrgIds(db, actor.uid);
    const snapshots = await Promise.all([
        db.collection("referrals").where("providerUid", "==", actor.uid).limit(200).get(),
        ...orgIds.map((orgId) => db.collection("referrals")
            .where("providerOrgId", "==", orgId)
            .limit(200)
            .get()),
    ]);
    const referrals = new Map();
    for (const snapshot of snapshots) {
        for (const document of snapshot.docs) {
            const referral = document.data();
            if (getLegacyReferralDomain(referral) !== "business_intro")
                continue;
            const hasProviderOrgScope = Object.prototype.hasOwnProperty.call(referral, "providerOrgId");
            const individuallyAuthorized = !hasProviderOrgScope && referral.providerUid === actor.uid;
            const organizationallyAuthorized = hasProviderOrgScope
                && nonEmptyString(referral.providerOrgId)
                && orgIds.includes(referral.providerOrgId);
            if (!individuallyAuthorized && !organizationallyAuthorized)
                continue;
            referrals.set(document.id, safeLegacyBusinessPayload(document.id, referral));
        }
    }
    return {
        referrals: [...referrals.values()]
            .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
            .slice(0, 200),
    };
});
function requirePlatformInviteeAuthority(request, referral, actor) {
    const boundUid = referral.claimedByUid
        ?? referral.cancelledByUid
        ?? referral.inviteeUid
        ?? referral.referredUid;
    if (nonEmptyString(boundUid)) {
        if (boundUid === actor.uid)
            return;
        throw new https_1.HttpsError("permission-denied", "Only the invited account may respond");
    }
    const invitedEmail = referral.invitedEmail ?? referral.referredEmail;
    const actorEmail = actor.email?.trim().toLowerCase();
    const emailVerified = request.auth?.token.email_verified === true;
    if (!emailVerified || !actorEmail || !nonEmptyString(invitedEmail)
        || invitedEmail.trim().toLowerCase() !== actorEmail) {
        throw new https_1.HttpsError("permission-denied", "A verified invited email is required to respond");
    }
}
async function transitionLegacyReferral(request, params) {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.legacyReferralActionInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const referralRef = db.collection("referrals").doc(input.referralId);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(referralRef);
        if (!snapshot.exists)
            throw new https_1.HttpsError("not-found", "Referral not found");
        const referral = snapshot.data();
        const domain = getLegacyReferralDomain(referral);
        if (domain === "unknown") {
            throw new https_1.HttpsError("failed-precondition", "The legacy referral domain is ambiguous");
        }
        if (domain === "platform_invite") {
            if (params.targetStatus !== "accepted" && params.targetStatus !== "declined") {
                throw new https_1.HttpsError("failed-precondition", "Platform membership invitations cannot enter the business-referral lifecycle");
            }
            requirePlatformInviteeAuthority(request, referral, actor);
        }
        else {
            await requireLegacyProviderAuthority(transaction, referral, actor);
        }
        if (referral.status === params.targetStatus) {
            return { success: true, idempotent: true };
        }
        if (!params.allowedStatuses.includes(referral.status)) {
            throw new https_1.HttpsError("failed-precondition", `Referral cannot transition from ${referral.status} to ${params.targetStatus}`);
        }
        const now = Date.now();
        if (domain === "platform_invite" && typeof referral.expiresAt === "number" && referral.expiresAt <= now) {
            transaction.update(referralRef, {
                status: "expired",
                inviteStatus: "expired",
                updatedAt: now,
                lifecycleVersion: typeof snapshot.get("lifecycleVersion") === "number"
                    ? snapshot.get("lifecycleVersion") + 1
                    : 1,
            });
            (0, security_1.writeExchangeAudit)(transaction, db, {
                actorUid: actor.uid,
                actorRole: actor.role,
                action: "platform_invite.expired_on_response",
                entityType: "platformInvite",
                entityId: input.referralId,
                previousStatus: referral.status,
                newStatus: "expired",
                createdAt: now,
            });
            return { success: false, expired: true };
        }
        const updates = {
            status: params.targetStatus,
            viewedByProvider: true,
            updatedAt: now,
            lifecycleVersion: typeof snapshot.get("lifecycleVersion") === "number"
                ? snapshot.get("lifecycleVersion") + 1
                : 1,
        };
        if (params.timestampField)
            updates[params.timestampField] = now;
        if (domain === "platform_invite") {
            if (params.targetStatus === "accepted") {
                updates.inviteStatus = "claimed";
                updates.claimedByUid = actor.uid;
                updates.claimedAt = now;
            }
            else {
                updates.inviteStatus = "cancelled";
                updates.cancelledByUid = actor.uid;
                updates.cancelledAt = now;
            }
            if (input.note)
                updates.inviteeResponseNote = input.note;
        }
        else if (params.responseNoteField && input.note) {
            updates[params.responseNoteField] = input.note;
        }
        transaction.update(referralRef, updates);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: domain === "platform_invite"
                ? `platform_invite.${params.targetStatus === "accepted" ? "claimed" : "cancelled"}`
                : params.action,
            entityType: domain === "platform_invite" ? "platformInvite" : "legacyBusinessReferral",
            entityId: input.referralId,
            orgId: domain === "business_intro" ? referral.providerOrgId : undefined,
            previousStatus: referral.status,
            newStatus: params.targetStatus,
            createdAt: now,
        });
        return { success: true };
    });
}
/**
 * Creates only platform membership invitations in the legacy collection.
 * New commercial referrals must use businessReferral_create.
 */
exports.referral_create = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.legacyReferralCreateInputSchema, request.data);
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const db = (0, security_1.getDb)();
    const action = "platform_invite.create";
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const inviteRef = db.collection("referrals").doc();
    const normalizedEmail = input.referredEmail.trim().toLowerCase();
    if (actor.email?.trim().toLowerCase() === normalizedEmail) {
        throw new https_1.HttpsError("invalid-argument", "You cannot invite your own account email");
    }
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, userSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(db.collection("users").doc(actor.uid)),
        ]);
        const priorResult = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (priorResult)
            return { ...priorResult, idempotent: true };
        if (!userSnapshot.exists)
            throw new https_1.HttpsError("failed-precondition", "Account state is unavailable");
        const user = userSnapshot.data() ?? {};
        if (!actor.isAdmin && user.membershipStatus !== "active" && user.membershipStatus !== "trial") {
            throw new https_1.HttpsError("failed-precondition", "An active membership is required to invite members");
        }
        const now = Date.now();
        const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
        const sentQuery = db
            .collection("referrals")
            .where("referrerUid", "==", actor.uid)
            .where("type", "==", "platform_invite")
            .where("createdAt", ">=", monthStart);
        const sentSnapshot = await transaction.get(sentQuery);
        if (!actor.isAdmin) {
            const tier = config_1.MEMBERSHIP_TIERS.find((candidate) => candidate.id === user.plan);
            const included = tier?.limits.referralsSentPerMonth ?? 0;
            if (sentSnapshot.size >= included) {
                const cost = config_1.CREDIT_COSTS.REFERRAL_SEND_EXTRA;
                const credits = typeof user.credits === "number" ? user.credits : 0;
                if (credits < cost) {
                    throw new https_1.HttpsError("resource-exhausted", `The monthly invite allowance is exhausted and ${cost} credits are required`);
                }
                transaction.update(userSnapshot.ref, { credits: credits - cost, updatedAt: now });
                const creditRef = db.collection("creditTransactions").doc();
                transaction.create(creditRef, {
                    id: creditRef.id,
                    userId: actor.uid,
                    amount: -cost,
                    type: "usage",
                    referenceId: inviteRef.id,
                    description: "Platform membership invitation",
                    createdAt: now,
                });
            }
        }
        const invite = {
            id: inviteRef.id,
            schemaVersion: 1,
            type: "platform_invite",
            referrerUid: actor.uid,
            inviterUid: actor.uid,
            referredEmail: normalizedEmail,
            invitedEmail: normalizedEmail,
            status: "pending",
            viewedByProvider: false,
            createdAt: now,
            updatedAt: now,
            expiresAt: now + 30 * 24 * 60 * 60 * 1000,
        };
        if (input.referredName) {
            invite.referredName = input.referredName;
            invite.invitedName = input.referredName;
        }
        if (input.note)
            invite.note = input.note;
        transaction.create(inviteRef, invite);
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: inviteRef.id,
            result: { id: inviteRef.id },
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "platformInvite",
            entityId: inviteRef.id,
            newStatus: "pending",
            createdAt: now,
        });
        return { id: inviteRef.id };
    });
});
exports.referral_accept = (0, https_1.onCall)((request) => transitionLegacyReferral(request, {
    targetStatus: "accepted",
    allowedStatuses: ["pending", "contacted"],
    action: "legacy_business_referral.accept",
    timestampField: "acceptedAt",
    responseNoteField: "providerResponseNote",
}));
exports.referral_contact = (0, https_1.onCall)((request) => transitionLegacyReferral(request, {
    targetStatus: "contacted",
    allowedStatuses: ["pending"],
    action: "legacy_business_referral.contact",
    timestampField: "contactedAt",
    responseNoteField: "providerContactNote",
}));
exports.referral_decline = (0, https_1.onCall)((request) => transitionLegacyReferral(request, {
    targetStatus: "declined",
    allowedStatuses: ["pending", "contacted"],
    action: "legacy_business_referral.decline",
    responseNoteField: "providerResponseNote",
}));
exports.referral_convert = (0, https_1.onCall)((request) => transitionLegacyReferral(request, {
    targetStatus: "converted",
    allowedStatuses: ["accepted"],
    action: "legacy_business_referral.convert",
    timestampField: "convertedAt",
    responseNoteField: "conversionNote",
}));
/**
 * Settlement is a financial assertion. Only a true admin/master claim may verify it.
 * The endpoint accepts a bounded ledger reference and never accepts a URL.
 */
exports.referral_markPaid = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireAdmin)(actor);
    const input = (0, contracts_1.parseCallableInput)(legacySettlementInputSchema, request.data);
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    const db = (0, security_1.getDb)();
    const action = "legacy_business_referral.verify_settlement";
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const referralRef = db.collection("referrals").doc(input.referralId);
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, referralSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(referralRef),
        ]);
        const priorResult = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
        if (priorResult)
            return { ...priorResult, success: true, idempotent: true };
        if (!referralSnapshot.exists)
            throw new https_1.HttpsError("not-found", "Referral not found");
        const referral = referralSnapshot.data();
        requireLegacyBusinessReferral(referral);
        if (referral.status !== "converted" && referral.status !== "paid") {
            throw new https_1.HttpsError("failed-precondition", "Only a converted referral may be settled");
        }
        const now = Date.now();
        if (referral.status === "paid") {
            if (referral.settlementReference !== input.settlementReference) {
                throw new https_1.HttpsError("failed-precondition", "The settlement is already verified and cannot be rewritten");
            }
            (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
                uid: actor.uid,
                action,
                entityId: input.referralId,
                result: { referralId: input.referralId, success: true },
                requestFingerprint,
                createdAt: now,
            });
            return { success: true, referralId: input.referralId, idempotent: true };
        }
        const updates = {
            status: "paid",
            payoutMethod: "manual",
            settlementReference: input.settlementReference,
            settlementVerifiedAt: now,
            settlementVerifiedByUid: actor.uid,
            updatedAt: now,
        };
        updates.paidAt = now;
        if (input.note)
            updates.settlementVerificationNote = input.note;
        transaction.update(referralRef, updates);
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: input.referralId,
            result: { referralId: input.referralId, success: true },
            requestFingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "legacyBusinessReferral",
            entityId: input.referralId,
            previousStatus: referral.status,
            newStatus: "paid",
            metadata: { settlementReference: input.settlementReference },
            createdAt: now,
        });
        return { success: true, referralId: input.referralId };
    });
});
/**
 * The prior checkout collected funds without proving disbursement to the referrer.
 * It remains exported for compatibility but fails closed until a reviewed settlement
 * provider is implemented against the corrected business-referral compensation model.
 */
exports.referral_createPayoutCheckout = (0, https_1.onCall)((request) => {
    (0, security_1.getAuthorizedActor)(request);
    throw new https_1.HttpsError("failed-precondition", "Legacy referral checkout is disabled; compensation settlement requires the reviewed business-referral flow");
});
