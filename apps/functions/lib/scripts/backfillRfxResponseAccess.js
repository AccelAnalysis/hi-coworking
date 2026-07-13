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
exports.backfillRfxResponseAccess = backfillRfxResponseAccess;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const security_1 = require("../exchange/security");
const RESPONSE_COLLECTION = "rfxResponses";
const RESPONSE_ACCESS_COLLECTION = "rfxResponseAccess";
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const MAX_ATTACHMENT_PATHS = 26;
const MAX_REVIEW_ITEMS = 100;
const SYSTEM_ACTOR = "system:rfx-response-access-backfill";
function ensureAdmin(projectId) {
    if (admin.apps.length > 0)
        return;
    admin.initializeApp(projectId ? { projectId } : undefined);
}
function configuredProjectId() {
    return String(admin.app().options.projectId
        ?? process.env.GCLOUD_PROJECT
        ?? process.env.GOOGLE_CLOUD_PROJECT
        ?? "unknown");
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isSafeDocumentId(value) {
    return typeof value === "string"
        && value.length > 0
        && value.length <= 128
        && value.trim() === value
        && !value.includes("/")
        && !value.includes("\0")
        && !/[\u0000-\u001f\u007f]/.test(value);
}
function optionalSafeDocumentId(data, field, invalidReasons) {
    const value = data[field];
    if (value === undefined || value === null || value === "")
        return undefined;
    if (!isSafeDocumentId(value)) {
        invalidReasons.push(`invalid_${field}`);
        return undefined;
    }
    return value;
}
function toMillis(value) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        return value;
    if (value instanceof Date) {
        const millis = value.getTime();
        return Number.isFinite(millis) && millis >= 0 ? millis : undefined;
    }
    if (value && typeof value === "object" && "toMillis" in value) {
        const method = value.toMillis;
        if (typeof method === "function") {
            const millis = method.call(value);
            return typeof millis === "number" && Number.isFinite(millis) && millis >= 0
                ? millis
                : undefined;
        }
    }
    return undefined;
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function isCanonicalResponsePath(path, rfxId, respondentUid) {
    const acceptedPrefixes = [
        `rfxResponses/${rfxId}/${respondentUid}/`,
        `rfxProposals/${rfxId}/${respondentUid}/`,
        `rfxDocuments/${rfxId}/${respondentUid}/`,
    ];
    const prefix = acceptedPrefixes.find((candidate) => path.startsWith(candidate));
    const lowered = path.toLowerCase();
    const segments = path.split("/");
    return prefix !== undefined
        && path.length > prefix.length
        && path.length <= 1024
        && !path.startsWith("/")
        && !path.includes("\\")
        && !path.includes("\0")
        && !segments.some((segment) => !segment || segment === "." || segment === "..")
        && !/^(?:https?:|gs:)/i.test(path)
        && !lowered.includes("%2f")
        && !lowered.includes("%5c")
        && !lowered.includes("%2e");
}
function possibleRespondentUids(data) {
    return uniqueSorted([data.respondentUid, data.createdBy].filter(isSafeDocumentId));
}
function assessResponse(responseId, data) {
    const invalidReasons = [];
    const ambiguousReasons = [];
    if (!isSafeDocumentId(responseId))
        invalidReasons.push("invalid_response_document_id");
    if (data.id !== undefined && data.id !== responseId) {
        invalidReasons.push("response_identity_mismatch");
    }
    const rfxId = isSafeDocumentId(data.rfxId) ? data.rfxId : undefined;
    if (!rfxId)
        invalidReasons.push("invalid_rfx_id");
    const respondentUid = optionalSafeDocumentId(data, "respondentUid", invalidReasons);
    const createdBy = optionalSafeDocumentId(data, "createdBy", invalidReasons);
    if (respondentUid && createdBy && respondentUid !== createdBy) {
        ambiguousReasons.push("conflicting_respondent_identity");
    }
    const resolvedRespondentUid = respondentUid ?? createdBy;
    if (!resolvedRespondentUid)
        invalidReasons.push("missing_respondent_identity");
    const respondentOrgId = optionalSafeDocumentId(data, "respondentOrgId", invalidReasons);
    const legacyOrgId = optionalSafeDocumentId(data, "orgId", invalidReasons);
    if (respondentOrgId && legacyOrgId && respondentOrgId !== legacyOrgId) {
        ambiguousReasons.push("conflicting_respondent_organization");
    }
    const resolvedRespondentOrgId = respondentOrgId ?? legacyOrgId;
    if (ambiguousReasons.length > 0) {
        return { kind: "ambiguous", reasons: uniqueSorted(ambiguousReasons) };
    }
    if (invalidReasons.length > 0 || !rfxId || !resolvedRespondentUid) {
        return { kind: "invalid", reasons: uniqueSorted(invalidReasons) };
    }
    const attachmentStoragePaths = [];
    const proposalStoragePath = data.proposalStoragePath;
    if (proposalStoragePath !== undefined && proposalStoragePath !== null) {
        if (typeof proposalStoragePath !== "string" || proposalStoragePath.length === 0) {
            invalidReasons.push("invalid_proposal_storage_path");
        }
        else if (!isCanonicalResponsePath(proposalStoragePath, rfxId, resolvedRespondentUid)) {
            invalidReasons.push("noncanonical_proposal_storage_path");
        }
        else {
            attachmentStoragePaths.push(proposalStoragePath);
        }
    }
    else if (typeof data.proposalUrl === "string" && data.proposalUrl.length > 0) {
        // Download URLs can contain bearer tokens and are not a trustworthy source
        // from which to guess an authoritative Storage object path.
        invalidReasons.push("legacy_proposal_url_without_storage_path");
    }
    if (data.uploadedDocuments !== undefined && !Array.isArray(data.uploadedDocuments)) {
        invalidReasons.push("uploaded_documents_not_array");
    }
    else if (Array.isArray(data.uploadedDocuments)) {
        for (const rawDocument of data.uploadedDocuments) {
            if (!isRecord(rawDocument)) {
                invalidReasons.push("invalid_uploaded_document");
                continue;
            }
            const storagePath = rawDocument.storagePath;
            if (typeof storagePath !== "string" || storagePath.length === 0) {
                invalidReasons.push(typeof rawDocument.url === "string" && rawDocument.url.length > 0
                    ? "legacy_document_url_without_storage_path"
                    : "missing_document_storage_path");
                continue;
            }
            if (!isCanonicalResponsePath(storagePath, rfxId, resolvedRespondentUid)) {
                invalidReasons.push("noncanonical_document_storage_path");
                continue;
            }
            attachmentStoragePaths.push(storagePath);
        }
    }
    const uniquePaths = uniqueSorted(attachmentStoragePaths);
    if (uniquePaths.length !== attachmentStoragePaths.length) {
        invalidReasons.push("duplicate_attachment_storage_path");
    }
    if (uniquePaths.length > MAX_ATTACHMENT_PATHS) {
        invalidReasons.push("attachment_path_limit_exceeded");
    }
    if (invalidReasons.length > 0) {
        return { kind: "invalid", reasons: uniqueSorted(invalidReasons) };
    }
    const submittedAt = toMillis(data.submittedAt)
        ?? toMillis(data.createdAt)
        ?? toMillis(data.updatedAt);
    return {
        kind: "valid",
        candidate: {
            responseId,
            rfxId,
            respondentUid: resolvedRespondentUid,
            ...(resolvedRespondentOrgId ? { respondentOrgId: resolvedRespondentOrgId } : {}),
            attachmentStoragePaths: uniquePaths,
            ...(submittedAt !== undefined ? { submittedAt } : {}),
        },
    };
}
function matchingResponseIds(snapshot, candidate) {
    return snapshot.docs
        .filter((responseDoc) => (responseDoc.data().rfxId === candidate.rfxId
        && possibleRespondentUids(responseDoc.data()).includes(candidate.respondentUid)))
        .map((responseDoc) => responseDoc.id)
        .sort((left, right) => left.localeCompare(right));
}
function markerMatches(marker, candidate) {
    if (!marker)
        return false;
    if (marker.id !== candidate.respondentUid
        || marker.rfxId !== candidate.rfxId
        || marker.respondentUid !== candidate.respondentUid
        || marker.responseId !== candidate.responseId
        || !Array.isArray(marker.attachmentStoragePaths)
        || marker.attachmentStoragePaths.some((path) => typeof path !== "string")) {
        return false;
    }
    const markerPaths = marker.attachmentStoragePaths;
    const normalizedMarkerPaths = uniqueSorted(markerPaths);
    if (markerPaths.length !== candidate.attachmentStoragePaths.length
        || normalizedMarkerPaths.length !== markerPaths.length
        || normalizedMarkerPaths.some((path, index) => path !== candidate.attachmentStoragePaths[index])) {
        return false;
    }
    if (candidate.respondentOrgId)
        return marker.respondentOrgId === candidate.respondentOrgId;
    return !("respondentOrgId" in marker);
}
function markerRef(db, candidate) {
    return db.collection(RESPONSE_ACCESS_COLLECTION)
        .doc(candidate.rfxId)
        .collection("respondents")
        .doc(candidate.respondentUid);
}
async function applyResponseAccessMarker(responseId, expected) {
    const db = (0, security_1.getDb)();
    const responseRef = db.collection(RESPONSE_COLLECTION).doc(responseId);
    return db.runTransaction(async (transaction) => {
        const responseSnapshot = await transaction.get(responseRef);
        if (!responseSnapshot.exists)
            throw new Error("Response no longer exists");
        const assessment = assessResponse(responseSnapshot.id, responseSnapshot.data() ?? {});
        if (assessment.kind !== "valid") {
            throw new Error(`Response is now ${assessment.kind}: ${assessment.reasons.join(",")}`);
        }
        const candidate = assessment.candidate;
        if (candidate.rfxId !== expected.rfxId
            || candidate.respondentUid !== expected.respondentUid
            || candidate.responseId !== expected.responseId
            || candidate.respondentOrgId !== expected.respondentOrgId
            || candidate.attachmentStoragePaths.length !== expected.attachmentStoragePaths.length
            || candidate.attachmentStoragePaths.some((path, index) => path !== expected.attachmentStoragePaths[index])) {
            throw new Error("Response authority changed after assessment");
        }
        const siblingQuery = db.collection(RESPONSE_COLLECTION).where("rfxId", "==", candidate.rfxId);
        const siblingSnapshot = await transaction.get(siblingQuery);
        const matchingIds = matchingResponseIds(siblingSnapshot, candidate);
        if (matchingIds.length !== 1 || matchingIds[0] !== responseId) {
            throw new Error(`Ambiguous response authority: ${matchingIds.join(",")}`);
        }
        const accessRef = markerRef(db, candidate);
        const accessSnapshot = await transaction.get(accessRef);
        if (markerMatches(accessSnapshot.data(), candidate))
            return "already_current";
        const marker = {
            id: candidate.respondentUid,
            rfxId: candidate.rfxId,
            respondentUid: candidate.respondentUid,
            responseId: candidate.responseId,
            attachmentStoragePaths: candidate.attachmentStoragePaths,
        };
        if (candidate.respondentOrgId) {
            marker.respondentOrgId = candidate.respondentOrgId;
        }
        else if (accessSnapshot.exists && "respondentOrgId" in (accessSnapshot.data() ?? {})) {
            marker.respondentOrgId = firestore_1.FieldValue.delete();
        }
        if (candidate.submittedAt !== undefined)
            marker.submittedAt = candidate.submittedAt;
        // Merge preserves unknown legacy metadata. Every field used for Storage
        // authority is replaced from the immutable response source above.
        transaction.set(accessRef, marker, { merge: true });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: SYSTEM_ACTOR,
            actorRole: "system",
            action: "rfx_response_access_reconciled",
            entityType: "rfxResponse",
            entityId: candidate.responseId,
            orgId: candidate.respondentOrgId,
            metadata: {
                rfxId: candidate.rfxId,
                respondentUid: candidate.respondentUid,
                attachmentPathCount: candidate.attachmentStoragePaths.length,
            },
            createdAt: Date.now(),
        });
        return "updated";
    });
}
function incrementReasons(report, reasons) {
    for (const reason of reasons) {
        report.reasonCounts[reason] = (report.reasonCounts[reason] ?? 0) + 1;
    }
}
function addReview(report, responseId, classification, reasons) {
    incrementReasons(report, reasons);
    if (report.reviewRequired.length < MAX_REVIEW_ITEMS) {
        report.reviewRequired.push({ responseId, classification, reasons });
    }
}
function validatePositiveInteger(value, name, maximum) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new Error(`${name} must be an integer between 1 and ${maximum}`);
    }
    return value;
}
async function backfillRfxResponseAccess(options = {}) {
    ensureAdmin(options.projectId);
    const projectId = configuredProjectId();
    const apply = options.apply === true;
    const limit = validatePositiveInteger(options.limit ?? DEFAULT_LIMIT, "limit", MAX_LIMIT);
    const pageSize = validatePositiveInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, "pageSize", MAX_PAGE_SIZE);
    if (options.afterId !== undefined && !isSafeDocumentId(options.afterId)) {
        throw new Error("afterId must be a valid response document ID");
    }
    if (options.projectId && options.projectId !== projectId) {
        throw new Error(`Configured Firebase project ${projectId} does not match --project=${options.projectId}`);
    }
    if (apply && !options.projectId) {
        throw new Error("--apply requires an explicit --project=<project-id>");
    }
    if (apply && projectId === "unknown") {
        throw new Error("--apply requires a resolvable Firebase project ID");
    }
    if (apply && options.confirmProject !== projectId) {
        throw new Error(`--apply requires --confirm-project=${projectId}`);
    }
    const report = {
        projectId,
        dryRun: !apply,
        afterId: options.afterId ?? null,
        totalScanned: 0,
        alreadyValid: 0,
        resolved: 0,
        invalid: 0,
        ambiguous: 0,
        updatesApplied: 0,
        failed: 0,
        complete: true,
        nextAfterId: null,
        reasonCounts: {},
        reviewRequired: [],
    };
    const db = (0, security_1.getDb)();
    const siblingCache = new Map();
    const loadSiblings = (rfxId) => {
        let pending = siblingCache.get(rfxId);
        if (!pending) {
            pending = db.collection(RESPONSE_COLLECTION).where("rfxId", "==", rfxId).get();
            siblingCache.set(rfxId, pending);
        }
        return pending;
    };
    let lastScannedId = options.afterId;
    while (report.totalScanned < limit) {
        const remaining = limit - report.totalScanned;
        const queryLimit = Math.min(pageSize, remaining);
        let query = db.collection(RESPONSE_COLLECTION)
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(queryLimit);
        if (lastScannedId)
            query = query.startAfter(lastScannedId);
        const responseSnapshot = await query.get();
        if (responseSnapshot.empty)
            break;
        for (const responseDoc of responseSnapshot.docs) {
            report.totalScanned += 1;
            lastScannedId = responseDoc.id;
            const assessment = assessResponse(responseDoc.id, responseDoc.data());
            if (assessment.kind === "invalid") {
                report.invalid += 1;
                addReview(report, responseDoc.id, "invalid", assessment.reasons);
                continue;
            }
            if (assessment.kind === "ambiguous") {
                report.ambiguous += 1;
                addReview(report, responseDoc.id, "ambiguous", assessment.reasons);
                continue;
            }
            const candidate = assessment.candidate;
            try {
                const siblingSnapshot = await loadSiblings(candidate.rfxId);
                const matchingIds = matchingResponseIds(siblingSnapshot, candidate);
                if (matchingIds.length !== 1 || matchingIds[0] !== candidate.responseId) {
                    report.ambiguous += 1;
                    addReview(report, responseDoc.id, "ambiguous", [`duplicate_marker_key:${matchingIds.join("|")}`]);
                    continue;
                }
                const accessSnapshot = await markerRef(db, candidate).get();
                if (markerMatches(accessSnapshot.data(), candidate)) {
                    report.alreadyValid += 1;
                    continue;
                }
                report.resolved += 1;
                if (apply) {
                    const outcome = await applyResponseAccessMarker(responseDoc.id, candidate);
                    if (outcome === "updated")
                        report.updatesApplied += 1;
                    else {
                        report.alreadyValid += 1;
                        report.resolved -= 1;
                    }
                }
            }
            catch (error) {
                report.failed += 1;
                console.error("[backfillRfxResponseAccess] response reconciliation failed", {
                    responseId: responseDoc.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (responseSnapshot.size < queryLimit)
            break;
    }
    if (lastScannedId) {
        const remainingSnapshot = await db.collection(RESPONSE_COLLECTION)
            .orderBy(firestore_1.FieldPath.documentId())
            .startAfter(lastScannedId)
            .limit(1)
            .get();
        report.complete = remainingSnapshot.empty;
        report.nextAfterId = report.complete ? null : lastScannedId;
    }
    return report;
}
function parsePositiveIntegerFlag(value, flag, maximum) {
    if (value === undefined)
        return undefined;
    if (!/^\d+$/.test(value))
        throw new Error(`${flag} must be a positive integer`);
    const parsed = Number(value);
    return validatePositiveInteger(parsed, flag, maximum);
}
if (require.main === module) {
    const args = process.argv.slice(2);
    const allowedFlags = [
        "--apply",
        "--project=",
        "--confirm-project=",
        "--limit=",
        "--page-size=",
        "--after-id=",
    ];
    const unknownFlag = args.find((argument) => !allowedFlags.some((flag) => (flag === "--apply" ? argument === flag : argument.startsWith(flag))));
    if (unknownFlag) {
        console.error(`[backfillRfxResponseAccess] unknown argument: ${unknownFlag}`);
        process.exit(1);
    }
    const valueFor = (name) => args.find((argument) => argument.startsWith(`${name}=`))
        ?.slice(name.length + 1);
    const options = {
        apply: args.includes("--apply"),
        projectId: valueFor("--project"),
        confirmProject: valueFor("--confirm-project"),
        limit: parsePositiveIntegerFlag(valueFor("--limit"), "--limit", MAX_LIMIT),
        pageSize: parsePositiveIntegerFlag(valueFor("--page-size"), "--page-size", MAX_PAGE_SIZE),
        afterId: valueFor("--after-id"),
    };
    backfillRfxResponseAccess(options)
        .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.failed > 0 || report.invalid > 0 || report.ambiguous > 0 ? 1 : 0);
    })
        .catch((error) => {
        console.error("[backfillRfxResponseAccess] failed", error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
