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
exports.referralIntelligence_getReciprocalPatterns = exports.referralIntelligence_getEconomicImpact = exports.referralIntelligence_getGapAnalysis = exports.referralIntelligence_listRelationships = exports.referralIntelligence_getOverview = exports.businessReferral_suggestRecipients = exports.businessReferral_reviewTransaction = exports.businessReferral_reportTransaction = exports.businessReferral_listTimeline = exports.businessReferral_getDetail = exports.businessReferral_listMine = void 0;
exports.sanitizeBusinessReferralSummary = sanitizeBusinessReferralSummary;
exports.sanitizeReferralTransactionReport = sanitizeReferralTransactionReport;
exports.calculateRun3ReferralCompensation = calculateRun3ReferralCompensation;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const referralAnalytics_1 = require("./referralAnalytics");
const security_1 = require("./exchange/security");
const SAFE_ID = /^[A-Za-z0-9_.:@-]+$/;
const BUSINESS_REFERRAL_TYPES = new Set([
    "customer_introduction",
    "business_lead",
    "project_opportunity",
    "service_need",
    "partner_introduction",
    "other",
]);
const BUSINESS_REFERRAL_STATUSES = new Set([
    "draft",
    "sent",
    "accepted",
    "declined",
    "in_progress",
    "converted",
    "closed",
    "withdrawn",
    "expired",
]);
const REFERRAL_TRANSACTION_REPORT_STATUSES = new Set([
    "transaction_reported",
    "awaiting_confirmation",
    "transaction_confirmed",
    "payout_calculated",
    "payout_due",
    "settlement_unavailable",
    "disputed",
    "cancelled",
    "reversed",
    "refunded",
]);
const MAX_ACTIVE_ORGANIZATIONS = 20;
const MAX_LIST_SCAN_PER_QUERY = 200;
const MAX_ANALYTICS_REFERRALS = 250;
const MAX_PLATFORM_ANALYTICS_REFERRALS = 1000;
const MAX_ANALYTICS_REPORTS_PER_CHUNK = 250;
const MAX_DISCOVERABLE_OFFERS = 200;
const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
]);
const trimmedId = zod_1.z.string().trim().min(1).max(128).regex(SAFE_ID);
const idempotencyKey = zod_1.z.string().trim().min(8).max(128).regex(SAFE_ID);
const currencyCode = zod_1.z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());
const listCursorSchema = zod_1.z.object({
    createdAt: zod_1.z.number().int().nonnegative(),
    id: trimmedId,
}).strict();
const listMineInputSchema = zod_1.z.object({
    direction: zod_1.z.enum(["all", "sent", "received"]).default("all"),
    scope: zod_1.z.enum(["all", "individual", "organization"]).default("all"),
    actorOrganizationId: trimmedId.optional(),
    statuses: zod_1.z.array(zod_1.z.enum([
        "draft", "sent", "accepted", "declined", "in_progress", "converted",
        "closed", "withdrawn", "expired",
    ])).max(9).default([]),
    industry: zod_1.z.string().trim().min(1).max(160).optional(),
    territoryFips: zod_1.z.string().trim().regex(/^\d{5}$/).optional(),
    compensationPresent: zod_1.z.boolean().optional(),
    search: zod_1.z.string().trim().max(160).optional(),
    limit: zod_1.z.number().int().min(1).max(100).default(50),
    cursor: listCursorSchema.optional(),
}).strict().superRefine((value, context) => {
    if (value.scope === "organization" && !value.actorOrganizationId) {
        context.addIssue({
            code: "custom",
            path: ["actorOrganizationId"],
            message: "Organization scope requires actorOrganizationId",
        });
    }
    if (value.scope !== "organization" && value.actorOrganizationId) {
        context.addIssue({
            code: "custom",
            path: ["actorOrganizationId"],
            message: "actorOrganizationId is valid only for organization scope",
        });
    }
});
const detailInputSchema = zod_1.z.object({
    referralId: trimmedId,
    actorOrganizationId: trimmedId.optional(),
}).strict();
const timelineInputSchema = zod_1.z.object({
    referralId: trimmedId,
    actorOrganizationId: trimmedId.optional(),
    limit: zod_1.z.number().int().min(1).max(100).default(50),
    before: zod_1.z.number().int().nonnegative().optional(),
}).strict();
const reportTransactionInputSchema = zod_1.z.object({
    referralId: trimmedId,
    actorOrganizationId: trimmedId.optional(),
    idempotencyKey,
    expectedReferralVersion: zod_1.z.number().int().nonnegative(),
    serviceOfferId: trimmedId.optional(),
    contractReference: zod_1.z.string().trim().min(1).max(160).optional(),
    qualifyingTransactionCents: zod_1.z.number().int().positive().max(1000000000000),
    collectedTransactionCents: zod_1.z.number().int().positive().max(1000000000000),
    collectedAt: zod_1.z.number().int().positive(),
    currency: currencyCode,
    evidenceStoragePaths: zod_1.z.array(zod_1.z.string().trim().min(1).max(1024)).max(10).default([]),
}).strict().superRefine((value, context) => {
    if (value.collectedTransactionCents > value.qualifyingTransactionCents) {
        context.addIssue({
            code: "custom",
            path: ["collectedTransactionCents"],
            message: "Collected amount cannot exceed the qualifying amount",
        });
    }
});
const reviewTransactionInputSchema = zod_1.z.object({
    reportId: trimmedId,
    actorOrganizationId: trimmedId.optional(),
    action: zod_1.z.enum(["confirm", "dispute", "clarify"]),
    idempotencyKey,
    expectedVersion: zod_1.z.number().int().nonnegative(),
    note: zod_1.z.string().trim().min(3).max(2000).optional(),
}).strict().superRefine((value, context) => {
    if (value.action !== "confirm" && !value.note) {
        context.addIssue({ code: "custom", path: ["note"], message: "A private review note is required" });
    }
});
const suggestionInputSchema = zod_1.z.object({
    referralId: trimmedId.optional(),
    actorOrganizationId: trimmedId.optional(),
    referrerOrgId: trimmedId.optional(),
    serviceCategory: zod_1.z.string().trim().min(1).max(160).optional(),
    naicsCodes: zod_1.z.array(zod_1.z.string().trim().regex(/^\d{2,6}$/)).max(25).default([]),
    territoryFips: zod_1.z.string().trim().regex(/^\d{5}$/).optional(),
    limit: zod_1.z.number().int().min(1).max(25).default(12),
}).strict().superRefine((value, context) => {
    if (!value.referralId && !value.serviceCategory && !value.naicsCodes.length && !value.territoryFips) {
        context.addIssue({ code: "custom", message: "A referral or capability requirement is required" });
    }
    if (value.actorOrganizationId !== value.referrerOrgId) {
        context.addIssue({
            code: "custom",
            path: ["actorOrganizationId"],
            message: "The selected actor organization must match the referring organization",
        });
    }
});
const intelligenceScopeSchema = zod_1.z.object({
    scope: zod_1.z.enum(["individual", "organization", "platform"]).default("individual"),
    orgId: trimmedId.optional(),
    windowDays: zod_1.z.union([zod_1.z.literal(30), zod_1.z.literal(90), zod_1.z.literal(365)]).default(90),
}).strict().superRefine((value, context) => {
    if (value.scope === "organization" && !value.orgId) {
        context.addIssue({ code: "custom", path: ["orgId"], message: "Organization scope requires orgId" });
    }
    if (value.scope !== "organization" && value.orgId) {
        context.addIssue({ code: "custom", path: ["orgId"], message: "orgId is valid only for organization scope" });
    }
});
const relationshipInputSchema = intelligenceScopeSchema.extend({
    limit: zod_1.z.number().int().min(1).max(50).default(25),
}).strict();
const reciprocalInputSchema = intelligenceScopeSchema.extend({
    limit: zod_1.z.number().int().min(1).max(50).default(25),
}).strict();
function parseInput(schema, data) {
    const parsed = schema.safeParse(data ?? {});
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", "Invalid request data", {
            issues: parsed.error.issues.slice(0, 8).map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        });
    }
    return parsed.data;
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value, maxLength = 10000) {
    return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : undefined;
}
function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (value && typeof value === "object" && "toMillis" in value) {
        const toMillis = value.toMillis;
        if (typeof toMillis === "function") {
            const result = toMillis.call(value);
            return typeof result === "number" && Number.isFinite(result) ? result : undefined;
        }
    }
    return undefined;
}
function stringArray(value, maxItems = 50, maxLength = 160) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === "string")
            .slice(0, maxItems)
            .map((item) => item.slice(0, maxLength))
        : [];
}
function hasField(record, field) {
    return Object.prototype.hasOwnProperty.call(record, field);
}
function isCanonicalBusinessReferral(record) {
    const referralType = stringValue(record.referralType, 64);
    return (record.schemaVersion === 1 || record.schemaVersion === 2)
        && Boolean(referralType && BUSINESS_REFERRAL_TYPES.has(referralType))
        && BUSINESS_REFERRAL_STATUSES.has(stringValue(record.status, 32) ?? "")
        && typeof record.referrerUid === "string";
}
async function loadActorScope(db, actorUid) {
    const memberships = await db.collection("orgMembers")
        .where("uid", "==", actorUid)
        .limit(MAX_ACTIVE_ORGANIZATIONS + 1)
        .get();
    if (memberships.size > MAX_ACTIVE_ORGANIZATIONS) {
        throw new https_1.HttpsError("resource-exhausted", "Organization count exceeds the bounded referral limit");
    }
    const candidates = memberships.docs.flatMap((document) => {
        const member = asRecord(document.data());
        const orgId = stringValue(member.orgId, 128);
        const role = stringValue(member.role, 32);
        if (!orgId
            || document.id !== `${orgId}_${actorUid}`
            || member.uid !== actorUid
            || !role
            || !["owner", "admin", "member"].includes(role)
            || member.status !== "active")
            return [];
        return [{ id: orgId, role: role }];
    });
    const organizationSnapshots = candidates.length
        ? await db.getAll(...candidates.map(({ id }) => db.collection("orgs").doc(id)))
        : [];
    const organizations = organizationSnapshots.flatMap((snapshot, index) => {
        const organization = asRecord(snapshot.data());
        if (!snapshot.exists || organization.status !== "active" || snapshot.id !== candidates[index].id)
            return [];
        const name = stringValue(organization.name, 200);
        return [{ ...candidates[index], ...(name ? { name } : {}) }];
    });
    return {
        organizations,
        organizationById: new Map(organizations.map((organization) => [organization.id, organization])),
    };
}
function isAssignedStaff(referral, actor) {
    return actor.role === "staff" && stringArray(referral.assignedStaffUids, 100, 128).includes(actor.uid);
}
function isReferrer(referral, actor, scope) {
    if (hasField(referral, "referrerOrgId")) {
        const orgId = stringValue(referral.referrerOrgId, 128);
        return Boolean(orgId && scope.organizationById.has(orgId));
    }
    return referral.referrerUid === actor.uid;
}
function isRecipient(referral, actor, scope) {
    if (hasField(referral, "recipientOrgId")) {
        const orgId = stringValue(referral.recipientOrgId, 128);
        return Boolean(orgId && scope.organizationById.has(orgId));
    }
    return referral.recipientUid === actor.uid;
}
function mayReadReferral(referral, actor, scope) {
    return isCanonicalBusinessReferral(referral)
        && (actor.isAdmin || isAssignedStaff(referral, actor)
            || isReferrer(referral, actor, scope) || isRecipient(referral, actor, scope));
}
function requireReadableReferral(referral, actor, scope) {
    if (!mayReadReferral(referral, actor, scope)) {
        throw new https_1.HttpsError("permission-denied", "Business-referral authority is required");
    }
}
async function requireReferralActorSide(db, referral, actor, actorOrganizationId) {
    if (!isCanonicalBusinessReferral(referral)) {
        throw new https_1.HttpsError("failed-precondition", "Unsupported business-referral record");
    }
    if (actorOrganizationId) {
        await (0, security_1.requireActiveOrgAuthority)(db, actorOrganizationId, actor.uid);
        if (referral.referrerOrgId === actorOrganizationId)
            return "referrer";
        if (referral.recipientOrgId === actorOrganizationId)
            return "recipient";
        throw new https_1.HttpsError("permission-denied", "The selected organization is not a party to this referral");
    }
    if (!hasField(referral, "referrerOrgId") && referral.referrerUid === actor.uid) {
        return "referrer";
    }
    if (!hasField(referral, "recipientOrgId") && referral.recipientUid === actor.uid) {
        return "recipient";
    }
    throw new https_1.HttpsError("permission-denied", "Select an active referral-party organization before accessing this referral");
}
function subjectKeyForSide(referral, side) {
    const orgId = stringValue(referral[`${side}OrgId`], 128);
    if (orgId && hasField(referral, `${side}OrgId`))
        return `org:${orgId}`;
    return `uid:${stringValue(referral[`${side}Uid`], 128) ?? "unknown"}`;
}
function compensationType(referral) {
    const snapshot = asRecord(referral.acceptedTermsSnapshot);
    const policy = asRecord(referral.compensationPolicy);
    return stringValue(snapshot.compensationType, 32)
        ?? stringValue(policy.type, 32)
        ?? "none";
}
function sanitizeBusinessReferralSummary(id, referral) {
    const result = {
        id,
        schemaVersion: numberValue(referral.schemaVersion) ?? 1,
        referrerUid: stringValue(referral.referrerUid, 128),
        referralType: stringValue(referral.referralType, 64),
        title: stringValue(referral.title, 200) ?? "Business referral",
        needSummary: stringValue(referral.needSummary, 2000) ?? "",
        consentStatus: stringValue(referral.consentStatus, 32) ?? "unknown_legacy",
        status: stringValue(referral.status, 32),
        compensationType: compensationType(referral),
        compensationStatus: stringValue(asRecord(referral.compensationPolicy).status, 32) ?? "none",
        commerceStatus: stringValue(referral.commerceStatus, 48) ?? "none",
        activeDispute: Boolean(referral.activeDisputeId || referral.commerceStatus === "disputed"),
        version: numberValue(referral.version) ?? 0,
        createdAt: numberValue(referral.createdAt) ?? 0,
        updatedAt: numberValue(referral.updatedAt) ?? numberValue(referral.createdAt) ?? 0,
    };
    const optionalStrings = [
        "referrerOrgId", "recipientUid", "recipientOrgId", "category", "territoryFips",
        "relatedRfxId", "relatedTeamId", "relatedOpportunityId", "serviceOfferId",
        "latestTransactionReportId",
    ];
    optionalStrings.forEach((field) => {
        const value = stringValue(referral[field], 200);
        if (value)
            result[field] = value;
    });
    const optionalNumbers = [
        "sentAt", "expiresAt", "acceptedAt", "respondedAt", "inProgressAt", "closedAt",
        "withdrawnAt", "expiredAt", "serviceOfferVersion",
    ];
    optionalNumbers.forEach((field) => {
        const value = numberValue(referral[field]);
        if (value !== undefined)
            result[field] = value;
    });
    result.naicsCodes = stringArray(referral.naicsCodes, 25, 16);
    return result;
}
function sanitizePrimitiveMap(value) {
    const source = asRecord(value);
    const output = {};
    const forbidden = /(contact|email|phone|evidence|invoice|note|narrative|customer|client|path|url)/i;
    for (const [key, child] of Object.entries(source).slice(0, 30)) {
        if (forbidden.test(key))
            continue;
        if (typeof child === "string")
            output[key] = child.slice(0, 240);
        else if (typeof child === "number" && Number.isFinite(child))
            output[key] = child;
        else if (typeof child === "boolean" || child === null)
            output[key] = child;
    }
    return Object.keys(output).length ? output : undefined;
}
function sanitizeContact(contact) {
    const output = {
        id: stringValue(contact.id, 128) ?? stringValue(contact.referralId, 128),
        type: stringValue(contact.type, 32),
        consentStatus: stringValue(contact.consentStatus, 32),
        recipientDisclosureAllowed: contact.recipientDisclosureAllowed === true,
    };
    for (const [field, maxLength] of [["name", 160], ["companyName", 200], ["email", 320], ["phone", 40]]) {
        const value = stringValue(contact[field], maxLength);
        if (value)
            output[field] = value;
    }
    return output;
}
function sanitizeReferralTransactionReport(id, report) {
    const result = {
        id,
        referralId: stringValue(report.referralId, 128),
        status: stringValue(report.status, 48),
        qualifyingTransactionCents: numberValue(report.qualifyingTransactionCents),
        collectedTransactionCents: numberValue(report.collectedTransactionCents),
        currency: stringValue(report.currency, 3),
        collectionDate: numberValue(report.collectionDate) ?? numberValue(report.collectedAt),
        version: numberValue(report.version) ?? 0,
        createdAt: numberValue(report.createdAt) ?? 0,
        updatedAt: numberValue(report.updatedAt) ?? 0,
        evidenceCount: stringArray(report.evidenceStoragePaths, 10, 1024).length,
        referrerDecision: stringValue(report.referrerDecision, 48),
        refundStatus: stringValue(report.refundStatus, 48) ?? "none",
    };
    for (const field of ["serviceOfferId", "reportedByUid", "reportedByOrgId", "confirmedByUid"]) {
        const value = stringValue(report[field], 160);
        if (value)
            result[field] = value;
    }
    for (const field of ["serviceOfferVersion", "confirmedAt", "refundAmountCents"]) {
        const value = numberValue(report[field]);
        if (value !== undefined)
            result[field] = value;
    }
    const calculation = Object.keys(asRecord(report.financials)).length
        ? asRecord(report.financials)
        : asRecord(report.calculation);
    if (Object.keys(calculation).length) {
        result.calculation = {
            qualifyingTransactionCents: numberValue(calculation.qualifyingTransactionCents),
            collectedTransactionCents: numberValue(calculation.collectedTransactionCents),
            grossReferralPayoutCents: numberValue(calculation.grossReferralPayoutCents),
            platformFeeBasisPointsSnapshot: numberValue(calculation.platformFeeBasisPointsSnapshot),
            platformFeeCents: numberValue(calculation.platformFeeCents),
            netReferrerPayoutCents: numberValue(calculation.netReferrerPayoutCents),
            calculationVersion: numberValue(calculation.calculationVersion),
        };
    }
    return result;
}
function completedIdempotentResult(snapshot, actorUid, action, requestFingerprint) {
    if (!snapshot.exists)
        return null;
    const data = asRecord(snapshot.data());
    if (data.uid !== actorUid || data.action !== action || data.status !== "completed") {
        throw new https_1.HttpsError("already-exists", "The idempotency key is already in use");
    }
    if (data.requestFingerprint !== requestFingerprint) {
        throw new https_1.HttpsError("already-exists", "The idempotency key belongs to a different request");
    }
    return asRecord(data.result);
}
function queryDirectionMatches(referral, actor, scope, direction) {
    if (direction === "sent")
        return isReferrer(referral, actor, scope);
    if (direction === "received")
        return isRecipient(referral, actor, scope);
    return isReferrer(referral, actor, scope) || isRecipient(referral, actor, scope)
        || isAssignedStaff(referral, actor) || actor.isAdmin;
}
function listFiltersMatch(referral, input) {
    const status = stringValue(referral.status, 32) ?? "";
    if (input.statuses.length && !input.statuses.includes(status))
        return false;
    if (input.industry) {
        const needle = input.industry.toLowerCase();
        const category = stringValue(referral.category, 160)?.toLowerCase();
        const naics = stringArray(referral.naicsCodes, 25, 16).map((code) => code.toLowerCase());
        if (category !== needle && !naics.includes(needle))
            return false;
    }
    if (input.territoryFips && referral.territoryFips !== input.territoryFips)
        return false;
    if (input.compensationPresent !== undefined) {
        const present = compensationType(referral) !== "none";
        if (present !== input.compensationPresent)
            return false;
    }
    if (input.search) {
        const needle = input.search.toLowerCase();
        const haystack = [referral.title, referral.needSummary, referral.category]
            .filter((value) => typeof value === "string")
            .join(" ")
            .toLowerCase();
        if (!haystack.includes(needle))
            return false;
    }
    return true;
}
async function listMine(request) {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(listMineInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const actorScope = await loadActorScope(db, actor.uid);
    if (input.actorOrganizationId
        && !actorScope.organizationById.has(input.actorOrganizationId)) {
        throw new https_1.HttpsError("permission-denied", "Current organization membership is required");
    }
    const scanLimit = Math.min(MAX_LIST_SCAN_PER_QUERY, input.limit * 4) + 1;
    const referrals = db.collection("businessReferrals");
    const queries = [];
    const addQuery = (field, value, operator = "==") => {
        let query = referrals
            .where(field, operator, value)
            .orderBy("createdAt", "desc")
            .orderBy(firestore_1.FieldPath.documentId(), "asc");
        if (input.cursor)
            query = query.startAfter(input.cursor.createdAt, input.cursor.id);
        queries.push(query.limit(scanLimit));
    };
    if (actor.isAdmin && input.scope === "all") {
        let query = referrals
            .orderBy("createdAt", "desc")
            .orderBy(firestore_1.FieldPath.documentId(), "asc");
        if (input.cursor)
            query = query.startAfter(input.cursor.createdAt, input.cursor.id);
        queries.push(query.limit(scanLimit));
    }
    else {
        const includeIndividual = input.scope === "all" || input.scope === "individual";
        const organizations = input.scope === "organization"
            ? actorScope.organizations.filter((organization) => organization.id === input.actorOrganizationId)
            : input.scope === "all" ? actorScope.organizations : [];
        if (includeIndividual && input.direction !== "received")
            addQuery("referrerUid", actor.uid);
        if (includeIndividual && input.direction !== "sent")
            addQuery("recipientUid", actor.uid);
        for (const organization of organizations) {
            if (input.direction !== "received")
                addQuery("referrerOrgId", organization.id);
            if (input.direction !== "sent")
                addQuery("recipientOrgId", organization.id);
        }
        if (actor.role === "staff" && input.scope === "all") {
            addQuery("assignedStaffUids", actor.uid, "array-contains");
        }
    }
    const snapshots = await Promise.all(queries.map((query) => query.get()));
    const byId = new Map();
    for (const snapshot of snapshots) {
        for (const document of snapshot.docs.slice(0, scanLimit - 1)) {
            const referral = asRecord(document.data());
            if (!mayReadReferral(referral, actor, actorScope))
                continue;
            if (input.scope === "individual") {
                const individualSide = (!hasField(referral, "referrerOrgId") && referral.referrerUid === actor.uid)
                    || (!hasField(referral, "recipientOrgId") && referral.recipientUid === actor.uid);
                if (!individualSide)
                    continue;
            }
            if (input.scope === "organization") {
                if (referral.referrerOrgId !== input.actorOrganizationId
                    && referral.recipientOrgId !== input.actorOrganizationId)
                    continue;
            }
            if (!queryDirectionMatches(referral, actor, actorScope, input.direction))
                continue;
            if (!listFiltersMatch(referral, input))
                continue;
            byId.set(document.id, referral);
        }
    }
    const sorted = [...byId.entries()].sort((left, right) => {
        const time = (numberValue(right[1].createdAt) ?? 0) - (numberValue(left[1].createdAt) ?? 0);
        return time || left[0].localeCompare(right[0]);
    });
    const page = sorted.slice(0, input.limit);
    const last = page.at(-1);
    const truncated = sorted.length > input.limit || snapshots.some((snapshot) => snapshot.size >= scanLimit);
    return {
        referrals: page.map(([id, referral]) => sanitizeBusinessReferralSummary(id, referral)),
        truncated,
        ...(truncated && last ? { nextCursor: { createdAt: numberValue(last[1].createdAt) ?? 0, id: last[0] } } : {}),
        scope: {
            organizations: actorScope.organizations
                .filter(({ id }) => input.scope === "organization" && id === input.actorOrganizationId)
                .map(({ id, role, name }) => ({ id, role, ...(name ? { name } : {}) })),
        },
    };
}
exports.businessReferral_listMine = (0, https_1.onCall)((request) => listMine(request));
exports.businessReferral_getDetail = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(detailInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const referralSnapshot = await db.collection("businessReferrals").doc(input.referralId).get();
    if (!referralSnapshot.exists)
        throw new https_1.HttpsError("not-found", "Business referral not found");
    const referral = asRecord(referralSnapshot.data());
    const actorSide = await requireReferralActorSide(db, referral, actor, input.actorOrganizationId);
    const [contactSnapshot, reportSnapshot] = await Promise.all([
        db.collection("businessReferralContacts").doc(input.referralId).get(),
        db.collection("referralTransactionReports")
            .where("referralId", "==", input.referralId)
            .orderBy("createdAt", "desc")
            .limit(50)
            .get(),
    ]);
    const mayReadContact = actorSide === "referrer"
        || (actorSide === "recipient" && contactSnapshot.get("recipientDisclosureAllowed") === true);
    const detail = sanitizeBusinessReferralSummary(input.referralId, referral);
    const outcome = asRecord(referral.outcome);
    if (Object.keys(outcome).length) {
        detail.outcome = {
            type: stringValue(outcome.type, 64),
            summary: stringValue(outcome.summary, 2000),
            recordedAt: numberValue(outcome.recordedAt),
            recordedByUid: stringValue(outcome.recordedByUid, 128),
        };
    }
    const acceptedTerms = asRecord(referral.acceptedTermsSnapshot);
    if (Object.keys(acceptedTerms).length)
        detail.acceptedTermsSnapshot = sanitizeAcceptedTerms(acceptedTerms);
    const responseNote = stringValue(referral.recipientResponseNote, 2000);
    if (responseNote)
        detail.recipientResponseNote = responseNote;
    return {
        referral: detail,
        contact: mayReadContact && contactSnapshot.exists ? sanitizeContact(asRecord(contactSnapshot.data())) : null,
        contactRedacted: contactSnapshot.exists && !mayReadContact,
        transactionReports: reportSnapshot.docs.map((document) => (sanitizeReferralTransactionReport(document.id, asRecord(document.data())))),
    };
});
exports.businessReferral_listTimeline = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(timelineInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const referralSnapshot = await db.collection("businessReferrals").doc(input.referralId).get();
    if (!referralSnapshot.exists)
        throw new https_1.HttpsError("not-found", "Business referral not found");
    await requireReferralActorSide(db, asRecord(referralSnapshot.data()), actor, input.actorOrganizationId);
    let query = db.collection("businessReferralTimeline")
        .where("referralId", "==", input.referralId)
        .orderBy("occurredAt", "desc");
    if (input.before !== undefined)
        query = query.where("occurredAt", "<", input.before);
    const snapshot = await query.limit(input.limit + 1).get();
    const documents = snapshot.docs.slice(0, input.limit);
    return {
        events: documents.map((document) => {
            const event = asRecord(document.data());
            const result = {
                id: document.id,
                referralId: input.referralId,
                eventType: stringValue(event.eventType, 80) ?? "updated",
                occurredAt: numberValue(event.occurredAt) ?? 0,
            };
            for (const field of ["actorUid", "actorOrgId", "actorRole", "transactionReportId"]) {
                const value = stringValue(event[field], 128);
                if (value)
                    result[field] = value;
            }
            const referralVersion = numberValue(event.referralVersion);
            if (referralVersion !== undefined)
                result.referralVersion = referralVersion;
            const metadata = sanitizePrimitiveMap(event.metadata);
            if (metadata)
                result.metadata = metadata;
            return result;
        }),
        truncated: snapshot.size > input.limit,
        ...(snapshot.size > input.limit && documents.length
            ? { nextBefore: numberValue(documents.at(-1)?.get("occurredAt")) ?? 0 }
            : {}),
    };
});
function sanitizeAcceptedTerms(terms) {
    const result = {
        compensationType: stringValue(terms.compensationType, 32) ?? "none",
        currency: stringValue(terms.currency, 3)?.toUpperCase() ?? "USD",
        attributionWindowDays: numberValue(terms.attributionWindowDays) ?? 0,
        platformFeeBasisPoints: numberValue(terms.platformFeeBasisPoints) ?? 100,
        platformFeeConfigVersion: numberValue(terms.platformFeeConfigVersion) ?? 1,
        acceptedByUid: stringValue(terms.acceptedByUid, 128),
        acceptedAt: numberValue(terms.acceptedAt),
        calculationVersion: numberValue(terms.calculationVersion) ?? 1,
    };
    for (const field of ["serviceOfferId", "percentageBasis", "payoutTrigger", "refundTreatment", "benefitDescription"]) {
        const value = stringValue(terms[field], 1000);
        if (value)
            result[field] = value;
    }
    for (const field of [
        "serviceOfferVersion", "fixedCompensationCents", "compensationRateBasisPoints",
        "paymentDeadlineDays",
    ]) {
        const value = numberValue(terms[field]);
        if (value !== undefined)
            result[field] = value;
    }
    return result;
}
async function requireRecipientFinanceAuthority(transaction, db, referral, actor, actorOrganizationId) {
    if (actorOrganizationId) {
        if (referral.recipientOrgId !== actorOrganizationId) {
            throw new https_1.HttpsError("permission-denied", "The selected organization is not the referral recipient");
        }
        await (0, security_1.loadOrgAuthority)(transaction, db, actorOrganizationId, actor.uid, {
            managementRequired: true,
        });
        return actorOrganizationId;
    }
    if (hasField(referral, "recipientOrgId")) {
        throw new https_1.HttpsError("permission-denied", "Select the referral's recipient organization before reporting a transaction");
    }
    if (referral.recipientUid !== actor.uid) {
        throw new https_1.HttpsError("permission-denied", "Recipient authority is required");
    }
    return undefined;
}
async function requireReferrerFinanceAuthority(transaction, db, referral, actor, actorOrganizationId) {
    if (actorOrganizationId) {
        if (referral.referrerOrgId !== actorOrganizationId) {
            throw new https_1.HttpsError("permission-denied", "The selected organization is not the referral referrer");
        }
        await (0, security_1.loadOrgAuthority)(transaction, db, actorOrganizationId, actor.uid, {
            managementRequired: true,
        });
        return actorOrganizationId;
    }
    if (hasField(referral, "referrerOrgId")) {
        throw new https_1.HttpsError("permission-denied", "Select the referral's referrer organization before reviewing a transaction");
    }
    if (referral.referrerUid !== actor.uid) {
        throw new https_1.HttpsError("permission-denied", "Referrer authority is required");
    }
    return undefined;
}
function canonicalEvidencePaths(referralId, actorUid, paths) {
    if (new Set(paths).size !== paths.length) {
        throw new https_1.HttpsError("invalid-argument", "Evidence paths must be unique");
    }
    const prefix = `businessReferralEvidence/${referralId}/${actorUid}/`;
    if (paths.some((path) => (!path.startsWith(prefix)
        || path.length <= prefix.length
        || path.startsWith("/")
        || path.includes("\\")
        || path.includes("\0")
        || /^(?:https?:|gs:)/i.test(path)
        || /%(?:2f|5c|2e)/i.test(path)
        || path.split("/").some((segment) => !segment || segment === "." || segment === "..")))) {
        throw new https_1.HttpsError("invalid-argument", "Evidence must use the authorized referral path");
    }
}
async function verifyEvidenceObjects(paths) {
    await Promise.all(paths.map(async (path) => {
        try {
            const [metadata] = await admin.storage().bucket().file(path).getMetadata();
            const size = Number(metadata.size ?? 0);
            const contentType = typeof metadata.contentType === "string"
                ? metadata.contentType.toLowerCase()
                : "";
            if (!Number.isSafeInteger(size)
                || size <= 0
                || size > MAX_EVIDENCE_BYTES
                || !ALLOWED_EVIDENCE_TYPES.has(contentType)) {
                throw new https_1.HttpsError("failed-precondition", "Transaction evidence has invalid stored metadata");
            }
        }
        catch (error) {
            if (error instanceof https_1.HttpsError)
                throw error;
            throw new https_1.HttpsError("failed-precondition", "Transaction evidence could not be verified in Storage");
        }
    }));
}
function acceptedTermsForReferral(referral) {
    const acceptedTerms = asRecord(referral.acceptedTermsSnapshot);
    if (Object.keys(acceptedTerms).length)
        return acceptedTerms;
    return asRecord(referral.termsSnapshot);
}
function calculateRun3ReferralCompensation(params) {
    const compensationType = stringValue(params.terms.compensationType, 32)
        ?? stringValue(params.terms.type, 32)
        ?? "none";
    const termsCurrency = stringValue(params.terms.currency, 3)?.toUpperCase();
    if (!termsCurrency || termsCurrency !== params.currency.toUpperCase()) {
        throw new https_1.HttpsError("failed-precondition", "Transaction currency does not match the accepted terms");
    }
    const platformFeeBasisPoints = numberValue(params.terms.platformFeeBasisPoints);
    if (platformFeeBasisPoints === undefined
        || !Number.isSafeInteger(platformFeeBasisPoints)
        || platformFeeBasisPoints < 0
        || platformFeeBasisPoints > 10000) {
        throw new https_1.HttpsError("failed-precondition", "The accepted platform-fee snapshot is invalid");
    }
    try {
        return { ...(0, referralAnalytics_1.calculateReferralFinancials)({
                qualifyingTransactionCents: params.qualifyingTransactionCents,
                collectedTransactionCents: params.collectedTransactionCents,
                compensationType: compensationType,
                ...(numberValue(params.terms.fixedCompensationCents) !== undefined
                    ? { fixedCompensationCents: numberValue(params.terms.fixedCompensationCents) }
                    : {}),
                ...(numberValue(params.terms.compensationRateBasisPoints) !== undefined
                    ? { compensationRateBasisPoints: numberValue(params.terms.compensationRateBasisPoints) }
                    : {}),
                platformFeeBasisPoints,
                currency: params.currency.toUpperCase(),
                termsCurrency,
            }) };
    }
    catch (error) {
        throw new https_1.HttpsError("failed-precondition", error instanceof Error ? error.message : "Referral calculation failed");
    }
}
function createTimelineEvent(transaction, db, params) {
    const ref = db.collection("businessReferralTimeline").doc(params.id);
    transaction.create(ref, {
        id: params.id,
        referralId: params.referralId,
        eventType: params.eventType,
        actorUid: params.actor.uid,
        actorRole: params.actor.role,
        ...(params.actorOrgId ? { actorOrgId: params.actorOrgId } : {}),
        ...(params.transactionReportId ? { transactionReportId: params.transactionReportId } : {}),
        referralVersion: params.referralVersion,
        ...(params.metadata ? { metadata: params.metadata } : {}),
        occurredAt: params.occurredAt,
    });
}
exports.businessReferral_reportTransaction = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(reportTransactionInputSchema, request.data);
    if (input.collectedAt > Date.now() + 5 * 60000) {
        throw new https_1.HttpsError("invalid-argument", "Collection time cannot be in the future");
    }
    canonicalEvidencePaths(input.referralId, actor.uid, input.evidenceStoragePaths);
    await verifyEvidenceObjects(input.evidenceStoragePaths);
    const db = (0, security_1.getDb)();
    const action = "business_referral.transaction_report";
    const fingerprint = (0, security_1.fingerprintRequest)(input);
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const reportRef = db.collection("referralTransactionReports").doc();
    const referralRef = db.collection("businessReferrals").doc(input.referralId);
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, referralSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(referralRef),
        ]);
        const replay = completedIdempotentResult(dedupeSnapshot, actor.uid, action, fingerprint);
        if (!referralSnapshot.exists)
            throw new https_1.HttpsError("not-found", "Business referral not found");
        const referral = asRecord(referralSnapshot.data());
        if (!isCanonicalBusinessReferral(referral)) {
            throw new https_1.HttpsError("failed-precondition", "Unsupported business-referral record");
        }
        const actorOrgId = await requireRecipientFinanceAuthority(transaction, db, referral, actor, input.actorOrganizationId);
        if (replay) {
            const replayReportId = stringValue(replay.reportId, 128);
            if (!replayReportId) {
                throw new https_1.HttpsError("failed-precondition", "The completed transaction report identity is invalid");
            }
            const replayReportSnapshot = await transaction.get(db.collection("referralTransactionReports").doc(replayReportId));
            const replayReport = asRecord(replayReportSnapshot.data());
            if (!replayReportSnapshot.exists
                || replayReport.schemaVersion !== 1
                || replayReport.referralId !== input.referralId
                || replayReport.reportedByUid !== actor.uid
                || !REFERRAL_TRANSACTION_REPORT_STATUSES.has(String(replayReport.status))) {
                throw new https_1.HttpsError("failed-precondition", "The completed transaction report is no longer valid");
            }
            return { ...replay, idempotent: true };
        }
        const currentVersion = numberValue(referral.version) ?? 0;
        if (currentVersion !== input.expectedReferralVersion) {
            throw new https_1.HttpsError("aborted", "The referral changed; reload it and retry", {
                expectedVersion: input.expectedReferralVersion,
                currentVersion,
            });
        }
        if (!new Set(["accepted", "in_progress", "converted"]).has(String(referral.status))) {
            throw new https_1.HttpsError("failed-precondition", "The referral is not eligible for transaction reporting");
        }
        if (referral.activeDisputeId || referral.commerceStatus === "disputed") {
            throw new https_1.HttpsError("failed-precondition", "Resolve the active dispute before reporting a transaction");
        }
        const terms = acceptedTermsForReferral(referral);
        if (!Object.keys(terms).length) {
            throw new https_1.HttpsError("failed-precondition", "Accepted referral terms must be locked before transaction reporting");
        }
        const snapshottedOfferId = stringValue(terms.serviceOfferId, 128);
        if (input.serviceOfferId && input.serviceOfferId !== snapshottedOfferId) {
            throw new https_1.HttpsError("failed-precondition", "The transaction offer does not match the accepted terms");
        }
        const termsCurrency = stringValue(terms.currency, 3)?.toUpperCase();
        if (!termsCurrency || termsCurrency !== input.currency) {
            throw new https_1.HttpsError("failed-precondition", "Transaction currency does not match the accepted terms");
        }
        const now = Date.now();
        const nextReferralVersion = currentVersion + 1;
        const report = {
            id: reportRef.id,
            schemaVersion: 1,
            referralId: input.referralId,
            reportedByUid: actor.uid,
            ...(actorOrgId ? { reportedByOrgId: actorOrgId } : {}),
            ...(snapshottedOfferId ? { serviceOfferId: snapshottedOfferId } : {}),
            ...(numberValue(terms.serviceOfferVersion) !== undefined
                ? { serviceOfferVersion: numberValue(terms.serviceOfferVersion) }
                : {}),
            status: "transaction_reported",
            referrerDecision: "pending",
            qualifyingTransactionCents: input.qualifyingTransactionCents,
            collectedTransactionCents: input.collectedTransactionCents,
            collectionDate: input.collectedAt,
            currency: input.currency,
            ...(input.contractReference ? { contractReference: input.contractReference } : {}),
            evidenceStoragePaths: input.evidenceStoragePaths,
            refundStatus: "none",
            version: 0,
            createdAt: now,
            updatedAt: now,
        };
        transaction.create(reportRef, report);
        transaction.update(referralRef, {
            commerceStatus: "transaction_reported",
            latestTransactionReportId: reportRef.id,
            version: nextReferralVersion,
            updatedAt: now,
        });
        createTimelineEvent(transaction, db, {
            id: `${reportRef.id}_reported`,
            referralId: input.referralId,
            eventType: "transaction_reported",
            actor,
            actorOrgId,
            referralVersion: nextReferralVersion,
            transactionReportId: reportRef.id,
            occurredAt: now,
            metadata: { currency: input.currency, evidenceCount: input.evidenceStoragePaths.length },
        });
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: reportRef.id,
            result: { reportId: reportRef.id, referralVersion: nextReferralVersion, reportVersion: 0 },
            requestFingerprint: fingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "businessReferralTransaction",
            entityId: reportRef.id,
            orgId: actorOrgId,
            newStatus: "transaction_reported",
            metadata: { referralId: input.referralId, currency: input.currency, evidenceCount: input.evidenceStoragePaths.length },
            createdAt: now,
        });
        return { reportId: reportRef.id, referralVersion: nextReferralVersion, reportVersion: 0 };
    });
});
exports.businessReferral_reviewTransaction = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(reviewTransactionInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const action = `business_referral.transaction_${input.action}`;
    const fingerprint = (0, security_1.fingerprintRequest)(input);
    const dedupeRef = (0, security_1.idempotencyRef)(db, actor.uid, action, input.idempotencyKey);
    const reportRef = db.collection("referralTransactionReports").doc(input.reportId);
    return db.runTransaction(async (transaction) => {
        const [dedupeSnapshot, reportSnapshot] = await Promise.all([
            transaction.get(dedupeRef),
            transaction.get(reportRef),
        ]);
        const replay = completedIdempotentResult(dedupeSnapshot, actor.uid, action, fingerprint);
        if (!reportSnapshot.exists)
            throw new https_1.HttpsError("not-found", "Transaction report not found");
        const report = asRecord(reportSnapshot.data());
        const referralId = stringValue(report.referralId, 128);
        if (!referralId)
            throw new https_1.HttpsError("failed-precondition", "Transaction referral identity is invalid");
        const referralRef = db.collection("businessReferrals").doc(referralId);
        const referralSnapshot = await transaction.get(referralRef);
        if (!referralSnapshot.exists)
            throw new https_1.HttpsError("not-found", "Business referral not found");
        const referral = asRecord(referralSnapshot.data());
        if (!isCanonicalBusinessReferral(referral)) {
            throw new https_1.HttpsError("failed-precondition", "Unsupported business-referral record");
        }
        const actorOrgId = await requireReferrerFinanceAuthority(transaction, db, referral, actor, input.actorOrganizationId);
        if (report.schemaVersion !== 1
            || !REFERRAL_TRANSACTION_REPORT_STATUSES.has(String(report.status))) {
            throw new https_1.HttpsError("failed-precondition", "Unsupported transaction-report record");
        }
        if (replay)
            return { ...replay, idempotent: true };
        const reportVersion = numberValue(report.version) ?? 0;
        if (reportVersion !== input.expectedVersion) {
            throw new https_1.HttpsError("aborted", "The transaction report changed; reload it and retry", {
                expectedVersion: input.expectedVersion,
                currentVersion: reportVersion,
            });
        }
        if (!new Set(["transaction_reported", "awaiting_confirmation"]).has(String(report.status))) {
            throw new https_1.HttpsError("failed-precondition", `A ${String(report.status)} report cannot be reviewed`);
        }
        if (referral.activeDisputeId || referral.commerceStatus === "disputed") {
            throw new https_1.HttpsError("failed-precondition", "Resolve the active dispute before reviewing this transaction");
        }
        const now = Date.now();
        const nextReportVersion = reportVersion + 1;
        const nextReferralVersion = (numberValue(referral.version) ?? 0) + 1;
        let reportStatus;
        let referrerDecision;
        let commerceStatus;
        let calculation;
        if (input.action === "confirm") {
            const terms = acceptedTermsForReferral(referral);
            if (!Object.keys(terms).length) {
                throw new https_1.HttpsError("failed-precondition", "Accepted terms are unavailable for calculation");
            }
            const priorConfirmedCount = numberValue(referral.confirmedTransactionCount) ?? 0;
            const compensationType = stringValue(terms.compensationType, 32)
                ?? stringValue(terms.type, 32)
                ?? "none";
            const percentageBasis = stringValue(terms.percentageBasis, 64);
            if (priorConfirmedCount > 0 && (compensationType === "fixed" || percentageBasis === "first_collected_invoice")) {
                throw new https_1.HttpsError("failed-precondition", "The accepted terms permit only one confirmed payout calculation");
            }
            calculation = calculateRun3ReferralCompensation({
                qualifyingTransactionCents: numberValue(report.qualifyingTransactionCents) ?? -1,
                collectedTransactionCents: numberValue(report.collectedTransactionCents) ?? -1,
                currency: stringValue(report.currency, 3)?.toUpperCase() ?? "",
                terms,
            });
            const calculationStatus = stringValue(calculation.calculationStatus, 48);
            reportStatus = calculationStatus === "calculated"
                ? "settlement_unavailable"
                : "transaction_confirmed";
            referrerDecision = "confirmed";
            commerceStatus = reportStatus;
        }
        else if (input.action === "dispute") {
            reportStatus = "disputed";
            referrerDecision = "disputed";
            commerceStatus = "disputed";
        }
        else {
            reportStatus = "awaiting_confirmation";
            referrerDecision = "clarification_requested";
            commerceStatus = "awaiting_confirmation";
        }
        transaction.update(reportRef, {
            status: reportStatus,
            referrerDecision,
            ...(input.action === "confirm" ? { confirmedByUid: actor.uid, confirmedAt: now } : {}),
            ...(input.note ? { reviewNote: input.note } : {}),
            ...(calculation ? { financials: calculation } : {}),
            version: nextReportVersion,
            updatedAt: now,
        });
        transaction.update(referralRef, {
            commerceStatus,
            ...(input.action === "confirm"
                ? { confirmedTransactionCount: firestore_1.FieldValue.increment(1) }
                : {}),
            version: nextReferralVersion,
            updatedAt: now,
        });
        createTimelineEvent(transaction, db, {
            id: `${input.reportId}_${reportStatus}_${nextReportVersion}`,
            referralId,
            eventType: `transaction_${reportStatus}`,
            actor,
            actorOrgId,
            referralVersion: nextReferralVersion,
            transactionReportId: input.reportId,
            occurredAt: now,
            metadata: {
                reportStatus,
                ...(calculation ? {
                    calculationVersion: numberValue(calculation.calculationVersion) ?? 1,
                    settlementEnabled: false,
                } : {}),
            },
        });
        const result = {
            reportId: input.reportId,
            status: reportStatus,
            reportVersion: nextReportVersion,
            referralVersion: nextReferralVersion,
            settlementEnabled: false,
            ...(calculation ? { calculation } : {}),
        };
        (0, security_1.setCompletedIdempotency)(transaction, dedupeRef, {
            uid: actor.uid,
            action,
            entityId: input.reportId,
            result,
            requestFingerprint: fingerprint,
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action,
            entityType: "businessReferralTransaction",
            entityId: input.reportId,
            orgId: actorOrgId,
            previousStatus: String(report.status),
            newStatus: reportStatus,
            metadata: { referralId, settlementEnabled: false },
            createdAt: now,
        });
        return result;
    });
});
function overlap(values, requested) {
    const normalized = new Set(requested.map((value) => value.toLowerCase()));
    return values.filter((value) => normalized.has(value.toLowerCase()));
}
exports.businessReferral_suggestRecipients = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(suggestionInputSchema, request.data);
    const db = (0, security_1.getDb)();
    const scope = await loadActorScope(db, actor.uid);
    if (input.actorOrganizationId && !scope.organizationById.has(input.actorOrganizationId)) {
        throw new https_1.HttpsError("permission-denied", "Current referring-organization membership is required");
    }
    let serviceCategory = input.serviceCategory;
    let naicsCodes = input.naicsCodes;
    let territoryFips = input.territoryFips;
    if (input.referralId) {
        const referralSnapshot = await db.collection("businessReferrals").doc(input.referralId).get();
        if (!referralSnapshot.exists)
            throw new https_1.HttpsError("not-found", "Business referral not found");
        const referral = asRecord(referralSnapshot.data());
        const actorSide = await requireReferralActorSide(db, referral, actor, input.actorOrganizationId);
        if (actorSide !== "referrer") {
            throw new https_1.HttpsError("permission-denied", "Referral referrer authority is required");
        }
        serviceCategory ?? (serviceCategory = stringValue(referral.category, 160));
        if (!naicsCodes.length)
            naicsCodes = stringArray(referral.naicsCodes, 25, 16);
        territoryFips ?? (territoryFips = stringValue(referral.territoryFips, 5));
    }
    const offerSnapshot = await db.collection("referralServiceOffers")
        .where("status", "==", "published")
        .where("acceptingReferrals", "==", true)
        .limit(MAX_DISCOVERABLE_OFFERS + 1)
        .get();
    const now = Date.now();
    const actorOrgIds = new Set(input.actorOrganizationId ? [input.actorOrganizationId] : []);
    const candidates = offerSnapshot.docs.flatMap((document) => {
        const offer = asRecord(document.data());
        const providerUid = stringValue(offer.providerUid, 128);
        const providerOrgId = stringValue(offer.providerOrgId, 128);
        if ((!providerUid && !providerOrgId) || providerUid === actor.uid || (providerOrgId && actorOrgIds.has(providerOrgId))) {
            return [];
        }
        const effectiveAt = numberValue(offer.effectiveAt) ?? 0;
        if (effectiveAt > now || offer.deactivatedAt !== undefined)
            return [];
        return [{ id: document.id, offer, providerUid, providerOrgId }];
    });
    const orgIds = [...new Set(candidates.flatMap((candidate) => candidate.providerOrgId ? [candidate.providerOrgId] : []))];
    const profileUids = [...new Set(candidates.flatMap((candidate) => !candidate.providerOrgId && candidate.providerUid ? [candidate.providerUid] : []))];
    const [organizationSnapshots, profileSnapshots] = await Promise.all([
        orgIds.length ? db.getAll(...orgIds.map((id) => db.collection("orgs").doc(id))) : [],
        profileUids.length ? db.getAll(...profileUids.map((id) => db.collection("publicProfiles").doc(id))) : [],
    ]);
    const activeOrgIds = new Set(organizationSnapshots
        .filter((snapshot) => snapshot.exists && snapshot.get("status") === "active")
        .map((snapshot) => snapshot.id));
    const publicProfiles = new Map(profileSnapshots
        .filter((snapshot) => snapshot.exists && snapshot.get("published") === true)
        .map((snapshot) => [snapshot.id, asRecord(snapshot.data())]));
    const suggestions = candidates.flatMap((candidate) => {
        if (candidate.providerOrgId && !activeOrgIds.has(candidate.providerOrgId))
            return [];
        const profile = candidate.providerUid ? publicProfiles.get(candidate.providerUid) : undefined;
        if (!candidate.providerOrgId && !profile)
            return [];
        const offerCategory = stringValue(candidate.offer.serviceCategory, 160);
        const offerNaics = stringArray(candidate.offer.naicsCodes, 50, 16);
        const offerTerritories = stringArray(candidate.offer.territoryFips, 100, 5);
        const matchedNaics = overlap(offerNaics, naicsCodes);
        const categoryMatch = Boolean(serviceCategory && offerCategory
            && serviceCategory.toLowerCase() === offerCategory.toLowerCase());
        const territoryMatch = Boolean(territoryFips && offerTerritories.includes(territoryFips));
        let score = 0;
        const reasons = ["accepting_referrals"];
        if (categoryMatch) {
            score += 40;
            reasons.push("service_category_match");
        }
        if (matchedNaics.length) {
            score += Math.min(40, matchedNaics.length * 20);
            reasons.push("naics_match");
        }
        if (territoryMatch) {
            score += 20;
            reasons.push("territory_match");
        }
        if (profile?.verificationStatus === "verified") {
            score += 10;
            reasons.push("verified_published_profile");
        }
        if (score === 0)
            return [];
        const providerName = stringValue(candidate.offer.providerDisplayName, 200)
            ?? stringValue(profile?.businessName, 200)
            ?? (candidate.providerOrgId ? "Published organization offer" : "Published provider");
        const compensation = stringValue(candidate.offer.compensationType, 32) ?? "none";
        return [{
                providerUid: candidate.providerUid,
                providerOrgId: candidate.providerOrgId,
                providerName,
                serviceOfferId: candidate.id,
                serviceOfferVersion: numberValue(candidate.offer.version) ?? 1,
                serviceName: stringValue(candidate.offer.serviceName, 200) ?? "Referral service",
                serviceCategory: offerCategory,
                matchedNaicsCodes: matchedNaics,
                territoryMatch,
                acceptingReferrals: true,
                compensationType: compensation,
                compensationConfigured: compensation !== "none",
                score: Math.min(100, score),
                reasons,
            }];
    }).sort((left, right) => right.score - left.score
        || String(left.serviceOfferId).localeCompare(String(right.serviceOfferId)))
        .slice(0, input.limit);
    return {
        suggestions,
        truncated: offerSnapshot.size > MAX_DISCOVERABLE_OFFERS,
        algorithmVersion: 1,
        notice: "Suggestions use published capabilities and offers; they are not guarantees or authorization decisions.",
    };
});
function resolveAnalyticsScope(actor, actorScope, input) {
    const windowStart = Date.now() - input.windowDays * 86400000;
    if (input.scope === "organization") {
        if (!input.orgId || !actorScope.organizationById.has(input.orgId)) {
            throw new https_1.HttpsError("permission-denied", "Current organization membership is required");
        }
        return {
            scope: "organization",
            subjectKey: `org:${input.orgId}`,
            orgId: input.orgId,
            ownScope: true,
            windowStart,
        };
    }
    if (input.scope === "platform") {
        if (!actor.isAdmin) {
            throw new https_1.HttpsError("permission-denied", "Platform referral intelligence requires administrator access");
        }
        return { scope: "platform", ownScope: false, windowStart };
    }
    return {
        scope: "individual",
        subjectKey: `uid:${actor.uid}`,
        ownScope: true,
        windowStart,
    };
}
async function loadAnalyticsReferrals(db, actor, scope) {
    const collection = db.collection("businessReferrals");
    const limit = scope.scope === "platform"
        ? MAX_PLATFORM_ANALYTICS_REFERRALS
        : MAX_ANALYTICS_REFERRALS;
    const queries = [];
    if (scope.scope === "platform") {
        queries.push(collection
            .where("createdAt", ">=", scope.windowStart)
            .orderBy("createdAt", "desc")
            .limit(limit + 1));
    }
    else if (scope.scope === "organization") {
        queries.push(collection.where("referrerOrgId", "==", scope.orgId)
            .where("createdAt", ">=", scope.windowStart)
            .orderBy("createdAt", "desc").limit(limit + 1), collection.where("recipientOrgId", "==", scope.orgId)
            .where("createdAt", ">=", scope.windowStart)
            .orderBy("createdAt", "desc").limit(limit + 1));
    }
    else {
        queries.push(collection.where("referrerUid", "==", actor.uid)
            .where("createdAt", ">=", scope.windowStart)
            .orderBy("createdAt", "desc").limit(limit + 1), collection.where("recipientUid", "==", actor.uid)
            .where("createdAt", ">=", scope.windowStart)
            .orderBy("createdAt", "desc").limit(limit + 1));
    }
    const snapshots = await Promise.all(queries.map((query) => query.get()));
    const byId = new Map();
    for (const snapshot of snapshots) {
        for (const document of snapshot.docs.slice(0, limit)) {
            const referral = asRecord(document.data());
            if (!isCanonicalBusinessReferral(referral))
                continue;
            if (scope.scope === "individual") {
                const relevant = (!hasField(referral, "referrerOrgId") && referral.referrerUid === actor.uid)
                    || (!hasField(referral, "recipientOrgId") && referral.recipientUid === actor.uid);
                if (!relevant)
                    continue;
            }
            byId.set(document.id, referral);
        }
    }
    const referrals = [...byId.entries()]
        .sort((left, right) => (numberValue(right[1].createdAt) ?? 0) - (numberValue(left[1].createdAt) ?? 0))
        .slice(0, limit)
        .map(([id, data]) => ({ id, data }));
    return {
        referrals,
        truncated: byId.size > limit || snapshots.some((snapshot) => snapshot.size > limit),
    };
}
function chunks(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}
async function loadAnalyticsTransactions(db, referralIds) {
    if (!referralIds.length)
        return { reports: [], truncated: false };
    const snapshots = await Promise.all(chunks(referralIds, 30).map((ids) => (db.collection("referralTransactionReports")
        .where("referralId", "in", ids)
        .limit(MAX_ANALYTICS_REPORTS_PER_CHUNK + 1)
        .get())));
    const reports = snapshots.flatMap((snapshot) => snapshot.docs
        .slice(0, MAX_ANALYTICS_REPORTS_PER_CHUNK)
        .map((document) => ({ id: document.id, data: asRecord(document.data()) })));
    return {
        reports,
        truncated: snapshots.some((snapshot) => snapshot.size > MAX_ANALYTICS_REPORTS_PER_CHUNK),
    };
}
function toAnalyticsReferral(id, referral) {
    const relatedRfxId = stringValue(referral.relatedRfxId, 128)
        ?? stringValue(referral.linkedRfxId, 128);
    const relatedTeamId = stringValue(referral.relatedTeamId, 128)
        ?? stringValue(referral.linkedTeamId, 128);
    return {
        id,
        domain: "business_referral",
        type: stringValue(referral.referralType, 64),
        referrerSubjectKey: subjectKeyForSide(referral, "referrer"),
        recipientSubjectKey: subjectKeyForSide(referral, "recipient"),
        ...(stringValue(referral.referrerOrgId, 128) ? { referrerOrgId: String(referral.referrerOrgId) } : {}),
        ...(stringValue(referral.recipientOrgId, 128) ? { recipientOrgId: String(referral.recipientOrgId) } : {}),
        status: stringValue(referral.status, 32) ?? "unknown",
        createdAt: numberValue(referral.createdAt) ?? 0,
        ...(numberValue(referral.sentAt) !== undefined ? { sentAt: numberValue(referral.sentAt) } : {}),
        ...(numberValue(referral.respondedAt) !== undefined ? { respondedAt: numberValue(referral.respondedAt) } : {}),
        ...(numberValue(referral.acceptedAt) !== undefined ? { acceptedAt: numberValue(referral.acceptedAt) } : {}),
        ...(numberValue(referral.inProgressAt) !== undefined ? { inProgressAt: numberValue(referral.inProgressAt) } : {}),
        ...(numberValue(referral.closedAt) !== undefined ? { closedAt: numberValue(referral.closedAt) } : {}),
        ...(stringValue(referral.category, 160) ? { category: String(referral.category) } : {}),
        naicsCodes: stringArray(referral.naicsCodes, 25, 16),
        ...(stringValue(referral.territoryFips, 5) ? { territoryFips: String(referral.territoryFips) } : {}),
        compensationType: compensationType(referral),
        ...(relatedRfxId ? { linkedRfxId: relatedRfxId } : {}),
        ...(relatedTeamId ? { linkedTeamId: relatedTeamId } : {}),
    };
}
function toAnalyticsTransaction(id, report) {
    const referralId = stringValue(report.referralId, 128);
    const currency = stringValue(report.currency, 3)?.toUpperCase();
    const collected = numberValue(report.collectedTransactionCents);
    const status = stringValue(report.status, 48);
    if (!referralId || !currency || !/^[A-Z]{3}$/.test(currency) || collected === undefined || !status)
        return null;
    const calculation = Object.keys(asRecord(report.financials)).length
        ? asRecord(report.financials)
        : asRecord(report.calculation);
    return {
        id,
        referralId,
        status,
        currency,
        collectedTransactionCents: collected,
        ...(numberValue(report.refundAmountCents) !== undefined
            ? { refundCents: numberValue(report.refundAmountCents) }
            : numberValue(report.refundCents) !== undefined
                ? { refundCents: numberValue(report.refundCents) }
                : {}),
        ...(Object.keys(calculation).length ? {
            calculation: {
                grossReferralPayoutCents: numberValue(calculation.grossReferralPayoutCents),
                platformFeeCents: numberValue(calculation.platformFeeCents),
                netReferrerPayoutCents: numberValue(calculation.netReferrerPayoutCents),
            },
        } : {}),
    };
}
function platformOrganizationCount(referrals) {
    const organizations = new Set();
    for (const referral of referrals) {
        if (referral.referrerOrgId)
            organizations.add(referral.referrerOrgId);
        if (referral.recipientOrgId)
            organizations.add(referral.recipientOrgId);
    }
    return organizations.size;
}
function calculatePlatformNetworkMetrics(referrals, transactions) {
    const accepted = referrals.filter((record) => (["accepted", "in_progress", "converted"].includes(record.status)));
    const confirmedConversions = (0, referralAnalytics_1.countConfirmedReferralConversions)(referrals, transactions);
    const subjectCounts = new Map();
    for (const referral of referrals) {
        for (const subject of new Set([referral.referrerSubjectKey, referral.recipientSubjectKey])) {
            if (subject)
                subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
        }
    }
    const responseHours = referrals.flatMap((record) => (record.sentAt !== undefined && record.respondedAt !== undefined && record.respondedAt >= record.sentAt
        ? [(record.respondedAt - record.sentAt) / 3600000]
        : []));
    const conversionDays = referrals.flatMap((record) => (record.status === "converted" && record.acceptedAt !== undefined
        && record.closedAt !== undefined && record.closedAt >= record.acceptedAt
        ? [(record.closedAt - record.acceptedAt) / 86400000]
        : []));
    return {
        referralsSent: referrals.length,
        referralsReceived: referrals.length,
        acceptedReferrals: accepted.length,
        confirmedConversions,
        uniquePartners: subjectCounts.size,
        acceptanceRate: (0, referralAnalytics_1.calculateReferralRate)(accepted.length, referrals.length),
        conversionRate: (0, referralAnalytics_1.calculateReferralRate)(confirmedConversions, accepted.length),
        medianResponseTimeHours: (0, referralAnalytics_1.calculateReferralMedian)(responseHours),
        medianConversionTimeDays: (0, referralAnalytics_1.calculateReferralMedian)(conversionDays),
        repeatPartnerRate: (0, referralAnalytics_1.calculateReferralRate)([...subjectCounts.values()].filter((count) => count >= 2).length, subjectCounts.size),
        largestPartnerShare: (0, referralAnalytics_1.calculateReferralRate)(Math.max(0, ...subjectCounts.values()), referrals.length),
        calculationVersion: 1,
    };
}
async function loadIntelligenceData(actor, input) {
    if (input.scope === "platform" && !actor.isAdmin) {
        throw new https_1.HttpsError("permission-denied", "Platform referral intelligence requires administrator access");
    }
    const db = (0, security_1.getDb)();
    const actorScope = await loadActorScope(db, actor.uid);
    const scope = resolveAnalyticsScope(actor, actorScope, input);
    const loadedReferrals = await loadAnalyticsReferrals(db, actor, scope);
    const loadedTransactions = await loadAnalyticsTransactions(db, loadedReferrals.referrals.map(({ id }) => id));
    return {
        scope,
        referrals: loadedReferrals.referrals.map(({ id, data }) => toAnalyticsReferral(id, data)),
        rawReferrals: loadedReferrals.referrals,
        transactions: loadedTransactions.reports.flatMap(({ id, data }) => {
            const report = toAnalyticsTransaction(id, data);
            return report ? [report] : [];
        }),
        rawReports: loadedTransactions.reports,
        truncated: loadedReferrals.truncated || loadedTransactions.truncated,
    };
}
function privacyEnvelope(scope, referrals) {
    if (scope.ownScope) {
        return { privacyStatus: "own_exact", suppressed: false, distinctOrganizationCount: null };
    }
    const distinctOrganizationCount = platformOrganizationCount(referrals);
    const suppressed = (0, referralAnalytics_1.shouldSuppressReferralAggregate)(referrals.length, distinctOrganizationCount);
    return {
        privacyStatus: suppressed ? "suppressed" : "publishable",
        suppressed,
        distinctOrganizationCount: suppressed ? null : distinctOrganizationCount,
    };
}
exports.referralIntelligence_getOverview = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(intelligenceScopeSchema, request.data);
    const data = await loadIntelligenceData(actor, input);
    const privacy = privacyEnvelope(data.scope, data.referrals);
    if (privacy.suppressed) {
        return {
            scope: input.scope,
            privacyStatus: privacy.privacyStatus,
            metrics: null,
            minimumRecords: 5,
            minimumOrganizations: 5,
            truncated: data.truncated,
        };
    }
    const metrics = (0, referralAnalytics_1.calculateReferralNetworkMetrics)(data.referrals, data.scope.subjectKey ?? "platform", data.transactions);
    const platformMetrics = data.scope.scope === "platform"
        ? calculatePlatformNetworkMetrics(data.referrals, data.transactions)
        : metrics;
    return {
        scope: input.scope,
        privacyStatus: privacy.privacyStatus,
        metrics: platformMetrics,
        distinctOrganizationCount: privacy.distinctOrganizationCount,
        truncated: data.truncated,
        dataQualityNotice: data.truncated
            ? "The bounded source window was truncated; rates describe the returned window only."
            : "Metrics use server-authoritative business-referral records only.",
    };
});
exports.referralIntelligence_listRelationships = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(relationshipInputSchema, request.data);
    if (input.scope === "platform") {
        throw new https_1.HttpsError("permission-denied", "Relationship details require an own-user or organization scope");
    }
    const data = await loadIntelligenceData(actor, input);
    const subjectKey = data.scope.subjectKey;
    const accumulators = new Map();
    for (const referral of data.referrals) {
        const isSent = referral.referrerSubjectKey === subjectKey;
        const partnerSubjectKey = isSent ? referral.recipientSubjectKey : referral.referrerSubjectKey;
        if (!partnerSubjectKey || partnerSubjectKey === subjectKey)
            continue;
        const accumulator = accumulators.get(partnerSubjectKey) ?? {
            partnerSubjectKey,
            accepted: 0,
            converted: 0,
            responseHours: [],
            disputed: 0,
            reversals: 0,
        };
        if (["accepted", "in_progress", "converted"].includes(referral.status))
            accumulator.accepted += 1;
        if (referral.sentAt !== undefined && referral.respondedAt !== undefined && referral.respondedAt >= referral.sentAt) {
            accumulator.responseHours.push((referral.respondedAt - referral.sentAt) / 3600000);
        }
        const raw = data.rawReferrals.find(({ id }) => id === referral.id)?.data;
        if (raw?.activeDisputeId || raw?.commerceStatus === "disputed")
            accumulator.disputed += 1;
        const statuses = data.rawReports
            .filter(({ data: report }) => report.referralId === referral.id)
            .map(({ data: report }) => report.status);
        if (referral.status === "converted" && statuses.some((status) => (typeof status === "string" && (0, referralAnalytics_1.isConfirmedReferralConversionStatus)(status)))) {
            accumulator.converted += 1;
        }
        accumulator.reversals += statuses.filter((status) => status === "reversed" || status === "refunded").length;
        accumulators.set(partnerSubjectKey, accumulator);
    }
    const relationships = [...accumulators.values()].map((accumulator) => {
        // Organization verification is not inferred from private org data. Until a
        // published organization-verification domain exists, org relationships can
        // become established but cannot be automatically classified as trusted.
        const insight = (0, referralAnalytics_1.deriveReferralRelationshipInsight)({
            acceptedReferrals: accumulator.accepted,
            confirmedConversions: accumulator.converted,
            medianResponseTimeHours: (0, referralAnalytics_1.calculateReferralMedian)(accumulator.responseHours),
            disputesOpened: accumulator.disputed,
            disputesLost: 0,
            reversals: accumulator.reversals,
            verified: false,
        });
        return {
            partnerSubjectKey: accumulator.partnerSubjectKey,
            ...insight,
            notice: "Relationship classifications are contextual, not guarantees, credit ratings, or payout decisions.",
        };
    }).sort((left, right) => right.sampleSize - left.sampleSize
        || left.partnerSubjectKey.localeCompare(right.partnerSubjectKey))
        .slice(0, input.limit);
    return { relationships, truncated: data.truncated || accumulators.size > input.limit };
});
async function loadGapSupply(db) {
    const snapshot = await db.collection("referralServiceOffers")
        .where("status", "==", "published")
        .where("acceptingReferrals", "==", true)
        .limit(MAX_DISCOVERABLE_OFFERS + 1)
        .get();
    const supply = snapshot.docs.slice(0, MAX_DISCOVERABLE_OFFERS).flatMap((document) => {
        const offer = asRecord(document.data());
        const providerOrgId = stringValue(offer.providerOrgId, 128);
        const providerUid = stringValue(offer.providerUid, 128);
        if (!providerOrgId && !providerUid)
            return [];
        return [{
                id: document.id,
                ...(providerOrgId ? { providerOrgId } : {}),
                ...(providerUid ? { providerUid } : {}),
                ...(stringValue(offer.serviceCategory, 160) ? { category: String(offer.serviceCategory) } : {}),
                naicsCodes: stringArray(offer.naicsCodes, 50, 16),
                territoryFips: stringArray(offer.territoryFips, 100, 5),
                active: true,
            }];
    });
    return { supply, truncated: snapshot.size > MAX_DISCOVERABLE_OFFERS };
}
exports.referralIntelligence_getGapAnalysis = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(intelligenceScopeSchema, request.data);
    const data = await loadIntelligenceData(actor, input);
    const supply = await loadGapSupply((0, security_1.getDb)());
    const demand = data.referrals.map((referral) => ({
        id: referral.id,
        organizationIds: [referral.referrerOrgId, referral.recipientOrgId]
            .filter((value) => Boolean(value)),
        ...(referral.category ? { category: referral.category } : {}),
        naicsCodes: referral.naicsCodes,
        ...(referral.territoryFips ? { territoryFips: referral.territoryFips } : {}),
        status: referral.status,
    }));
    return {
        cells: (0, referralAnalytics_1.buildReferralGapAnalysis)(demand, supply.supply, { ownScope: data.scope.ownScope }),
        truncated: data.truncated || supply.truncated,
        privacyThreshold: data.scope.ownScope ? null : { minimumRecords: 5, minimumOrganizations: 5 },
    };
});
exports.referralIntelligence_getEconomicImpact = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(intelligenceScopeSchema, request.data);
    const data = await loadIntelligenceData(actor, input);
    const privacy = privacyEnvelope(data.scope, data.referrals);
    if (privacy.suppressed) {
        return {
            scope: input.scope,
            privacyStatus: "suppressed",
            impact: null,
            minimumRecords: 5,
            minimumOrganizations: 5,
            truncated: data.truncated,
        };
    }
    return {
        scope: input.scope,
        privacyStatus: privacy.privacyStatus,
        impact: (0, referralAnalytics_1.summarizeReferralEconomicImpact)(data.referrals, data.transactions),
        truncated: data.truncated,
        labels: {
            reportedTransactionValue: "Reported referred transaction value",
            confirmedTransactionValue: "Confirmed referred transaction value",
            compensation: "Calculated referral compensation",
        },
        settlementEnabled: false,
    };
});
exports.referralIntelligence_getReciprocalPatterns = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = parseInput(reciprocalInputSchema, request.data);
    if (input.scope === "platform") {
        throw new https_1.HttpsError("permission-denied", "Reciprocal relationship details require an own scope");
    }
    const data = await loadIntelligenceData(actor, input);
    const subjectKey = data.scope.subjectKey;
    const byPartner = new Map();
    for (const referral of data.referrals) {
        const sent = referral.referrerSubjectKey === subjectKey;
        const partner = sent ? referral.recipientSubjectKey : referral.referrerSubjectKey;
        if (!partner || partner === subjectKey)
            continue;
        const current = byPartner.get(partner) ?? { forward: 0, reverse: 0, referralIds: [] };
        if (sent)
            current.forward += 1;
        else
            current.reverse += 1;
        current.referralIds.push(referral.id);
        byPartner.set(partner, current);
    }
    const patterns = [...byPartner.entries()].map(([partnerSubjectKey, pair]) => {
        const relatedReports = data.rawReports.filter(({ data: report }) => (pair.referralIds.includes(String(report.referralId))));
        const disputedOrReversedCount = relatedReports.filter(({ data: report }) => (["disputed", "reversed", "refunded"].includes(String(report.status)))).length;
        const analysis = (0, referralAnalytics_1.analyzeReferralReciprocity)({
            forwardCount: pair.forward,
            reverseCount: pair.reverse,
            firstPartyTotal: data.referrals.length,
            secondPartyTotal: data.referrals.length,
            disputedOrReversedCount,
        });
        return {
            partnerSubjectKey,
            ...analysis,
            userNotice: analysis.classification === "review_recommended"
                ? "Additional verification may be required."
                : "Reciprocal referrals can be a normal business relationship pattern.",
        };
    }).sort((left, right) => right.sampleSize - left.sampleSize
        || left.partnerSubjectKey.localeCompare(right.partnerSubjectKey))
        .slice(0, input.limit);
    return {
        patterns,
        truncated: data.truncated || byPartner.size > input.limit,
        notice: "Patterns provide context only and do not alter calculations or accuse a business of misconduct.",
    };
});
