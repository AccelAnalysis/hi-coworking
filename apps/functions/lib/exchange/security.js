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
exports.getAuthorizedActor = getAuthorizedActor;
exports.requireStaffOrAdmin = requireStaffOrAdmin;
exports.requireAdmin = requireAdmin;
exports.isOrgManagementRole = isOrgManagementRole;
exports.loadOrgAuthority = loadOrgAuthority;
exports.requireActiveOrgAuthority = requireActiveOrgAuthority;
exports.evaluateTransactionEligibility = evaluateTransactionEligibility;
exports.throwEligibilityFailure = throwEligibilityFailure;
exports.writeExchangeAudit = writeExchangeAudit;
exports.idempotencyRef = idempotencyRef;
exports.fingerprintRequest = fingerprintRequest;
exports.setCompletedIdempotency = setCompletedIdempotency;
exports.getDb = getDb;
const admin = __importStar(require("firebase-admin"));
const node_crypto_1 = require("node:crypto");
const https_1 = require("firebase-functions/v2/https");
const PLATFORM_ROLES = new Set([
    "master",
    "admin",
    "staff",
    "member",
    "externalVendor",
    "econPartner",
]);
function getAuthorizedActor(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    const rawRole = request.auth.token.role;
    const role = typeof rawRole === "string" && PLATFORM_ROLES.has(rawRole)
        ? rawRole
        : "member";
    return {
        uid: request.auth.uid,
        role,
        isAdmin: role === "admin" || role === "master",
        email: typeof request.auth.token.email === "string" ? request.auth.token.email : undefined,
    };
}
function requireStaffOrAdmin(actor) {
    if (!actor.isAdmin && actor.role !== "staff") {
        throw new https_1.HttpsError("permission-denied", "Staff authorization is required");
    }
}
function requireAdmin(actor) {
    if (!actor.isAdmin) {
        throw new https_1.HttpsError("permission-denied", "Administrator authorization is required");
    }
}
function isOrgManagementRole(role) {
    return role === "owner" || role === "admin";
}
async function loadOrgAuthority(transaction, db, orgId, uid, options = {}) {
    const orgRef = db.collection("orgs").doc(orgId);
    const memberRef = db.collection("orgMembers").doc(`${orgId}_${uid}`);
    const [orgSnap, memberSnap] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(memberRef),
    ]);
    const org = orgSnap.data();
    const member = memberSnap.data();
    if (!orgSnap.exists
        || !org
        || org.status !== "active"
        || !memberSnap.exists
        || !member
        || member.status !== "active") {
        throw new https_1.HttpsError("permission-denied", "Active organization membership is required");
    }
    if (member.orgId !== orgId || member.uid !== uid) {
        throw new https_1.HttpsError("permission-denied", "Organization membership is invalid");
    }
    if (options.managementRequired && !isOrgManagementRole(member.role)) {
        throw new https_1.HttpsError("permission-denied", "Organization owner or administrator access is required");
    }
    return { org, member };
}
/**
 * Reusable exact-active authority check for read-oriented callables that do not
 * otherwise need a transaction. The transaction prevents authority and
 * organization status from being observed at different revisions.
 */
async function requireActiveOrgAuthority(db, orgId, uid, options = {}) {
    return db.runTransaction((transaction) => (loadOrgAuthority(transaction, db, orgId, uid, options)));
}
async function evaluateTransactionEligibility(params) {
    const { transaction, db, actor, territoryFips, orgId, requireVerification = true, requirePlan = false, requiredCredits = 0, permittedRoles = ["member", "externalVendor", "econPartner"], adminOverrideReason, } = params;
    const userRef = db.collection("users").doc(actor.uid);
    const profileRef = db.collection("profiles").doc(actor.uid);
    const territoryRef = db.collection("territories").doc(territoryFips);
    const [userSnap, profileSnap, territorySnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(profileRef),
        transaction.get(territoryRef),
    ]);
    const user = userSnap.data();
    const profile = profileSnap.data();
    const territory = territorySnap.data();
    let org;
    let orgMember;
    if (orgId) {
        try {
            const authority = await loadOrgAuthority(transaction, db, orgId, actor.uid, {
                managementRequired: true,
            });
            org = authority.org;
            orgMember = authority.member;
        }
        catch {
            return {
                result: {
                    allowed: false,
                    reasonCode: "ORG_PERMISSION_REQUIRED",
                    message: "Active organization authority is required",
                },
                user,
                profile,
                territory,
            };
        }
    }
    const overrideAllowed = actor.isAdmin && Boolean(adminOverrideReason?.trim());
    if (!territorySnap.exists || !territory) {
        if (!overrideAllowed) {
            return {
                result: {
                    allowed: false,
                    reasonCode: "TERRITORY_UNKNOWN",
                    message: "The transaction territory could not be verified",
                },
                user,
                profile,
                org,
                orgMember,
            };
        }
    }
    else if (territory.status !== "released" && !overrideAllowed) {
        return {
            result: {
                allowed: false,
                reasonCode: "TERRITORY_UNRELEASED",
                message: "The transaction territory is not released",
            },
            user,
            profile,
            territory,
            org,
            orgMember,
        };
    }
    if (!userSnap.exists || !user) {
        return {
            result: { allowed: false, reasonCode: "AUTH_REQUIRED", message: "Account state is unavailable" },
            territory,
            org,
            orgMember,
        };
    }
    if (!actor.isAdmin && !permittedRoles.includes(actor.role)) {
        return {
            result: {
                allowed: false,
                reasonCode: "STATUS_NOT_ALLOWED",
                message: "Your account role cannot perform this action",
            },
            user,
            profile,
            territory,
            org,
            orgMember,
        };
    }
    if (requireVerification && !actor.isAdmin) {
        if (!profileSnap.exists || !profile) {
            return {
                result: {
                    allowed: false,
                    reasonCode: "PROFILE_REQUIRED",
                    message: "A business profile is required",
                },
                user,
                territory,
                org,
                orgMember,
            };
        }
        if (profile.verificationStatus !== "verified") {
            return {
                result: {
                    allowed: false,
                    reasonCode: "VERIFICATION_REQUIRED",
                    message: "Business verification is required",
                },
                user,
                profile,
                territory,
                org,
                orgMember,
            };
        }
    }
    if (requirePlan && !actor.isAdmin && typeof user.plan !== "string") {
        return {
            result: { allowed: false, reasonCode: "PLAN_REQUIRED", message: "An eligible plan is required" },
            user,
            profile,
            territory,
            org,
            orgMember,
        };
    }
    const credits = typeof user.credits === "number" ? user.credits : 0;
    if (!actor.isAdmin && requiredCredits > credits) {
        return {
            result: {
                allowed: false,
                reasonCode: "INSUFFICIENT_CREDITS",
                message: "Insufficient credits for this action",
            },
            user,
            profile,
            territory,
            org,
            orgMember,
        };
    }
    return {
        result: { allowed: true, reasonCode: "ELIGIBLE", message: "Eligible" },
        user,
        profile,
        territory,
        org,
        orgMember,
    };
}
function throwEligibilityFailure(result) {
    const code = result.reasonCode === "INSUFFICIENT_CREDITS"
        ? "resource-exhausted"
        : result.reasonCode === "AUTH_REQUIRED"
            ? "unauthenticated"
            : "failed-precondition";
    throw new https_1.HttpsError(code, result.message, { reasonCode: result.reasonCode });
}
function writeExchangeAudit(transaction, db, input) {
    const ref = db.collection("exchangeAudit").doc();
    const event = {
        id: ref.id,
        actorUid: input.actorUid,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        createdAt: input.createdAt ?? Date.now(),
    };
    if (input.actorRole)
        event.actorRole = input.actorRole;
    if (input.orgId)
        event.orgId = input.orgId;
    if (input.actorOrganizationId)
        event.actorOrganizationId = input.actorOrganizationId;
    if (input.subjectOrganizationId)
        event.subjectOrganizationId = input.subjectOrganizationId;
    if (input.mode)
        event.mode = input.mode;
    if (input.previousStatus)
        event.previousStatus = input.previousStatus;
    if (input.newStatus)
        event.newStatus = input.newStatus;
    if (input.metadata && Object.keys(input.metadata).length > 0)
        event.metadata = input.metadata;
    transaction.create(ref, event);
    return ref;
}
function idempotencyRef(db, uid, action, key) {
    const safeAction = action.replace(/[^A-Za-z0-9_-]/g, "_");
    return db.collection("exchangeIdempotency").doc(`${uid}:${safeAction}:${key}`);
}
function canonicalizeFingerprintValue(value) {
    if (Array.isArray(value))
        return value.map(canonicalizeFingerprintValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, child]) => child !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonicalizeFingerprintValue(child)]));
    }
    return value;
}
/** Bind an idempotency key to one normalized request, not merely one action. */
function fingerprintRequest(value) {
    return (0, node_crypto_1.createHash)("sha256")
        .update(JSON.stringify(canonicalizeFingerprintValue(value)), "utf8")
        .digest("hex");
}
function setCompletedIdempotency(transaction, ref, params) {
    transaction.create(ref, {
        uid: params.uid,
        action: params.action,
        entityId: params.entityId,
        result: params.result ?? { id: params.entityId },
        status: "completed",
        ...(params.requestFingerprint ? { requestFingerprint: params.requestFingerprint } : {}),
        createdAt: params.createdAt,
        expiresAt: params.createdAt + 7 * 24 * 60 * 60 * 1000,
    });
}
function getDb() {
    return admin.firestore();
}
