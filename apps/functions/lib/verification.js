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
exports.verification_flag = exports.verification_review = exports.verification_submit = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const contracts_1 = require("./exchange/contracts");
const security_1 = require("./exchange/security");
const MAX_VERIFICATION_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
]);
function assertCanonicalStoragePath(uid, type, storagePath) {
    const prefix = `verificationDocs/${uid}/${type}/`;
    const fileName = storagePath.slice(prefix.length);
    if (!storagePath.startsWith(prefix)
        || !fileName
        || fileName.includes("/")
        || fileName === "."
        || fileName === "..") {
        throw new https_1.HttpsError("invalid-argument", "Each verification document must use the authenticated account's canonical storage path");
    }
}
async function verifyUploadedObject(storagePath) {
    try {
        const [metadata] = await admin.storage().bucket().file(storagePath).getMetadata();
        const size = Number(metadata.size ?? 0);
        if (!Number.isFinite(size) || size <= 0 || size > MAX_VERIFICATION_FILE_SIZE) {
            throw new https_1.HttpsError("invalid-argument", "A verification document has an invalid file size");
        }
        if (!metadata.contentType || !ALLOWED_CONTENT_TYPES.has(metadata.contentType)) {
            throw new https_1.HttpsError("invalid-argument", "A verification document has an unsupported file type");
        }
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError("failed-precondition", "An uploaded verification document could not be verified");
    }
}
function writeVerificationAudit(transaction, db, params) {
    const ref = db.collection("verificationAuditLog").doc();
    transaction.create(ref, {
        id: ref.id,
        uid: params.uid,
        action: params.action,
        performedBy: params.performedBy,
        details: params.details,
        previousValue: params.previousValue ?? "",
        newValue: params.newValue ?? "",
        createdAt: params.createdAt,
    });
}
exports.verification_submit = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.verificationSubmitInputSchema, request.data);
    const requestFingerprint = (0, security_1.fingerprintRequest)(input);
    for (const document of input.documents) {
        assertCanonicalStoragePath(actor.uid, document.type, document.storagePath);
    }
    await Promise.all(input.documents.map((document) => verifyUploadedObject(document.storagePath)));
    const db = (0, security_1.getDb)();
    const now = Date.now();
    const requestRef = (0, security_1.idempotencyRef)(db, actor.uid, "verification_submit", input.idempotencyKey);
    const result = await db.runTransaction(async (transaction) => {
        const profileRef = db.collection("profiles").doc(actor.uid);
        const publicProfileRef = db.collection("publicProfiles").doc(actor.uid);
        const [requestSnapshot, profileSnapshot, publicProfileSnapshot] = await Promise.all([
            transaction.get(requestRef),
            transaction.get(profileRef),
            transaction.get(publicProfileRef),
        ]);
        if (requestSnapshot.exists) {
            const requestData = requestSnapshot.data();
            if (requestData?.uid !== actor.uid
                || requestData.action !== "verification_submit"
                || requestData.status !== "completed"
                || requestData.requestFingerprint !== requestFingerprint) {
                throw new https_1.HttpsError("already-exists", "The idempotency key belongs to a different request");
            }
            const existing = requestData.result;
            return {
                success: true,
                idempotentReplay: true,
                verificationStatus: existing?.verificationStatus ?? "pending",
                documentIds: existing?.documentIds ?? [],
            };
        }
        const profile = profileSnapshot.data();
        if (!profileSnapshot.exists || !profile) {
            throw new https_1.HttpsError("failed-precondition", "Create a business profile before submitting verification");
        }
        const documentIds = [];
        for (const document of input.documents) {
            const documentId = `${actor.uid}:${input.idempotencyKey}:${document.type}`;
            const documentRef = db.collection("verificationDocuments").doc(documentId);
            const evidenceLockRef = db.collection("verificationEvidenceLocks")
                .doc(`${actor.uid}_${document.type}`);
            documentIds.push(documentId);
            transaction.create(documentRef, {
                id: documentId,
                uid: actor.uid,
                type: document.type,
                label: document.label,
                storagePath: document.storagePath,
                status: "pending",
                reviewNote: "",
                uploadedAt: now,
                updatedAt: now,
                version: 0,
            });
            transaction.set(evidenceLockRef, {
                id: evidenceLockRef.id,
                uid: actor.uid,
                documentType: document.type,
                storagePath: document.storagePath,
                documentId,
                lockedAt: now,
            });
            writeVerificationAudit(transaction, db, {
                uid: actor.uid,
                action: "doc_uploaded",
                performedBy: actor.uid,
                details: `Submitted ${document.type} evidence`,
                createdAt: now,
            });
        }
        const previousStatus = profile.verificationStatus ?? "none";
        const verificationVersion = Number(profile.verificationVersion ?? 0) + 1;
        transaction.update(profileRef, {
            verificationStatus: "pending",
            verificationSubmittedAt: now,
            verificationRejectionReason: "",
            verificationVersion,
            updatedAt: now,
        });
        if (publicProfileSnapshot.exists) {
            transaction.update(publicProfileRef, {
                verificationStatus: "pending",
                updatedAt: now,
            });
        }
        writeVerificationAudit(transaction, db, {
            uid: actor.uid,
            action: "status_changed",
            performedBy: actor.uid,
            details: "Submitted verification package",
            previousValue: previousStatus,
            newValue: "pending",
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: "verification.submitted",
            entityType: "profile",
            entityId: actor.uid,
            previousStatus,
            newStatus: "pending",
            metadata: { documentCount: documentIds.length },
            createdAt: now,
        });
        (0, security_1.setCompletedIdempotency)(transaction, requestRef, {
            uid: actor.uid,
            action: "verification_submit",
            entityId: actor.uid,
            result: { documentIds, verificationStatus: "pending" },
            requestFingerprint,
            createdAt: now,
        });
        return {
            success: true,
            idempotentReplay: false,
            verificationStatus: "pending",
            documentIds,
        };
    });
    logger.info("Verification package submitted", {
        uid: actor.uid,
        documentCount: result.documentIds.length,
        idempotentReplay: result.idempotentReplay,
    });
    return result;
});
exports.verification_review = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireStaffOrAdmin)(actor);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.verificationReviewInputSchema, request.data);
    if (input.uid === actor.uid) {
        throw new https_1.HttpsError("permission-denied", "Reviewers cannot decide their own verification");
    }
    const db = (0, security_1.getDb)();
    const now = Date.now();
    const result = await db.runTransaction(async (transaction) => {
        const profileRef = db.collection("profiles").doc(input.uid);
        const publicProfileRef = db.collection("publicProfiles").doc(input.uid);
        const documentRef = input.documentId
            ? db.collection("verificationDocuments").doc(input.documentId)
            : undefined;
        const documentsQuery = db.collection("verificationDocuments").where("uid", "==", input.uid);
        const [profileSnapshot, publicProfileSnapshot, documentsSnapshot, documentSnapshot] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(publicProfileRef),
            transaction.get(documentsQuery),
            documentRef ? transaction.get(documentRef) : Promise.resolve(undefined),
        ]);
        const profile = profileSnapshot.data();
        if (!profileSnapshot.exists || !profile) {
            throw new https_1.HttpsError("not-found", "Verification profile not found");
        }
        const currentVersion = Number(profile.verificationVersion ?? 0);
        if (input.expectedProfileVersion !== undefined
            && input.expectedProfileVersion !== currentVersion) {
            throw new https_1.HttpsError("aborted", "Verification changed; reload before reviewing again");
        }
        if (documentRef) {
            const document = documentSnapshot?.data();
            if (!documentSnapshot?.exists || !document) {
                throw new https_1.HttpsError("not-found", "Verification document not found");
            }
            if (document.uid !== input.uid) {
                throw new https_1.HttpsError("permission-denied", "Verification document does not belong to that profile");
            }
            if (document.status !== "pending") {
                throw new https_1.HttpsError("failed-precondition", "Only pending verification documents may be reviewed");
            }
        }
        const documents = documentsSnapshot.docs.map((snapshot) => {
            const document = snapshot.data();
            return {
                id: snapshot.id,
                type: document.type,
                status: snapshot.id === input.documentId ? input.documentStatus : document.status,
            };
        });
        const requiredTypes = ["business_license", "ein_letter"];
        const requiredApproved = requiredTypes.every((type) => documents.some((document) => document.type === type && document.status === "approved"));
        const hasRejected = documents.some((document) => document.status === "rejected");
        if (input.finalStatus === "verified" && !requiredApproved) {
            throw new https_1.HttpsError("failed-precondition", "Business-license and EIN evidence must be approved before verification");
        }
        const computedStatus = requiredApproved
            ? "verified"
            : hasRejected
                ? "rejected"
                : "pending";
        const nextStatus = input.finalStatus ?? computedStatus;
        const previousStatus = profile.verificationStatus ?? "none";
        if (documentRef && input.documentStatus) {
            transaction.update(documentRef, {
                status: input.documentStatus,
                reviewNote: input.reviewNote ?? "",
                reviewedAt: now,
                reviewedBy: actor.uid,
                updatedAt: now,
                version: firestore_1.FieldValue.increment(1),
            });
            writeVerificationAudit(transaction, db, {
                uid: input.uid,
                action: input.documentStatus === "approved" ? "doc_approved" : "doc_rejected",
                performedBy: actor.uid,
                details: `${input.documentStatus === "approved" ? "Approved" : "Rejected"} verification evidence`,
                createdAt: now,
            });
        }
        transaction.update(profileRef, {
            verificationStatus: nextStatus,
            verificationReviewedAt: now,
            verificationReviewedBy: actor.uid,
            verificationRejectionReason: nextStatus === "rejected" ? input.reviewNote ?? "Requirements not met" : "",
            verificationVersion: currentVersion + 1,
            updatedAt: now,
        });
        if (publicProfileSnapshot.exists) {
            transaction.update(publicProfileRef, {
                verificationStatus: nextStatus,
                updatedAt: now,
            });
        }
        if (previousStatus !== nextStatus) {
            writeVerificationAudit(transaction, db, {
                uid: input.uid,
                action: "status_changed",
                performedBy: actor.uid,
                details: "Verification status updated by reviewer",
                previousValue: previousStatus,
                newValue: nextStatus,
                createdAt: now,
            });
        }
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: nextStatus === "verified" ? "verification.approved" : nextStatus === "rejected" ? "verification.rejected" : "verification.reviewed",
            entityType: "profile",
            entityId: input.uid,
            previousStatus,
            newStatus: nextStatus,
            metadata: { documentReviewed: Boolean(input.documentId) },
            createdAt: now,
        });
        return {
            success: true,
            uid: input.uid,
            verificationStatus: nextStatus,
            verificationVersion: currentVersion + 1,
        };
    });
    logger.info("Verification reviewed", {
        uid: input.uid,
        reviewedBy: actor.uid,
        resultingStatus: result.verificationStatus,
    });
    return result;
});
exports.verification_flag = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireStaffOrAdmin)(actor);
    const input = (0, contracts_1.parseCallableInput)(contracts_1.verificationFlagInputSchema, request.data);
    if (input.uid === actor.uid) {
        throw new https_1.HttpsError("permission-denied", "Reviewers cannot flag their own account");
    }
    const db = (0, security_1.getDb)();
    const now = Date.now();
    const flagId = await db.runTransaction(async (transaction) => {
        const profileRef = db.collection("profiles").doc(input.uid);
        const profileSnapshot = await transaction.get(profileRef);
        if (!profileSnapshot.exists) {
            throw new https_1.HttpsError("not-found", "Verification profile not found");
        }
        const flagRef = db.collection("verificationFlags").doc();
        transaction.create(flagRef, {
            id: flagRef.id,
            uid: input.uid,
            reason: input.reason,
            flaggedBy: actor.uid,
            status: "open",
            createdAt: now,
            updatedAt: now,
        });
        writeVerificationAudit(transaction, db, {
            uid: input.uid,
            action: "flag_suspicious",
            performedBy: actor.uid,
            details: "Verification account flagged for staff review",
            createdAt: now,
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: "verification.flagged",
            entityType: "profile",
            entityId: input.uid,
            metadata: { flagId: flagRef.id },
            createdAt: now,
        });
        return flagRef.id;
    });
    logger.warn("Verification account flagged", {
        uid: input.uid,
        flaggedBy: actor.uid,
        flagId,
    });
    return { success: true, flagId };
});
