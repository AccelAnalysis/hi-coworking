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
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() {
    return admin.firestore();
}
function requireAdminRole(request) {
    const role = request.auth?.token?.role;
    if (role !== "admin" && role !== "master" && role !== "staff") {
        throw new https_1.HttpsError("permission-denied", "Only staff/admin/master users can perform this action");
    }
}
async function writeVerificationAudit(params) {
    const db = getDb();
    const ref = db.collection("verificationAuditLog").doc();
    await ref.set({
        id: ref.id,
        uid: params.uid,
        action: params.action,
        performedBy: params.performedBy,
        details: params.details || "",
        previousValue: params.previousValue || "",
        newValue: params.newValue || "",
        createdAt: Date.now(),
    });
}
exports.verification_submit = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const uid = request.auth.uid;
    const { documents } = request.data;
    if (!documents || documents.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "At least one verification document is required");
    }
    const now = Date.now();
    const db = getDb();
    const batch = db.batch();
    const savedDocIds = [];
    for (const doc of documents) {
        if (!doc.type || !doc.label?.trim() || !doc.storagePath?.trim()) {
            throw new https_1.HttpsError("invalid-argument", "Each document must include type, label, and storagePath");
        }
        const ref = doc.id
            ? db.collection("verificationDocuments").doc(doc.id)
            : db.collection("verificationDocuments").doc();
        savedDocIds.push(ref.id);
        batch.set(ref, {
            id: ref.id,
            uid,
            type: doc.type,
            label: doc.label.trim(),
            storagePath: doc.storagePath.trim(),
            downloadUrl: doc.downloadUrl?.trim() || "",
            status: "pending",
            reviewNote: "",
            uploadedAt: now,
            updatedAt: now,
        }, { merge: true });
    }
    const profileRef = db.collection("profiles").doc(uid);
    batch.set(profileRef, {
        uid,
        verificationStatus: "pending",
        verificationSubmittedAt: now,
        updatedAt: now,
        createdAt: now,
    }, { merge: true });
    await batch.commit();
    for (const id of savedDocIds) {
        await writeVerificationAudit({
            uid,
            action: "doc_uploaded",
            performedBy: uid,
            details: `Uploaded verification document ${id}`,
        });
    }
    await writeVerificationAudit({
        uid,
        action: "status_changed",
        performedBy: uid,
        newValue: "pending",
        details: "Submitted verification package",
    });
    logger.info("Verification documents submitted", { uid, count: savedDocIds.length });
    return {
        success: true,
        verificationStatus: "pending",
        documentIds: savedDocIds,
    };
});
exports.verification_review = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    requireAdminRole(request);
    const { uid, documentId, status, reviewNote, finalStatus } = request.data;
    if (!uid) {
        throw new https_1.HttpsError("invalid-argument", "uid is required");
    }
    const now = Date.now();
    const db = getDb();
    if (documentId) {
        if (!status || (status !== "approved" && status !== "rejected")) {
            throw new https_1.HttpsError("invalid-argument", "status must be approved or rejected when documentId is provided");
        }
        const docRef = db.collection("verificationDocuments").doc(documentId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            throw new https_1.HttpsError("not-found", "Verification document not found");
        }
        await docRef.update({
            status,
            reviewNote: reviewNote?.trim() || "",
            reviewedAt: now,
            reviewedBy: request.auth.uid,
            updatedAt: now,
        });
        await writeVerificationAudit({
            uid,
            action: status === "approved" ? "doc_approved" : "doc_rejected",
            performedBy: request.auth.uid,
            details: `Document ${documentId} ${status}`,
        });
    }
    const docsSnap = await db.collection("verificationDocuments").where("uid", "==", uid).get();
    const docs = docsSnap.docs.map((d) => d.data());
    const requiredTypes = ["business_license", "ein_letter"];
    const requiredApproved = requiredTypes.every((requiredType) => docs.some((doc) => doc.type === requiredType && doc.status === "approved"));
    const hasRejected = docs.some((doc) => doc.status === "rejected");
    let nextStatus = "pending";
    if (finalStatus && ["pending", "verified", "rejected", "none"].includes(finalStatus)) {
        nextStatus = finalStatus;
    }
    else if (requiredApproved) {
        nextStatus = "verified";
    }
    else if (hasRejected) {
        nextStatus = "rejected";
    }
    const profileRef = db.collection("profiles").doc(uid);
    const profileSnap = await profileRef.get();
    const previousStatus = profileSnap.data()?.verificationStatus ?? "none";
    await profileRef.set({
        uid,
        verificationStatus: nextStatus,
        verificationReviewedAt: now,
        verificationReviewedBy: request.auth.uid,
        verificationRejectionReason: nextStatus === "rejected" ? reviewNote?.trim() || "Verification requirements not met" : "",
        updatedAt: now,
        createdAt: profileSnap.exists ? profileSnap.data()?.createdAt : now,
    }, { merge: true });
    if (previousStatus !== nextStatus) {
        await writeVerificationAudit({
            uid,
            action: "status_changed",
            performedBy: request.auth.uid,
            previousValue: previousStatus,
            newValue: nextStatus,
            details: "Verification status updated by reviewer",
        });
    }
    logger.info("Verification reviewed", {
        uid,
        documentId: documentId || null,
        resultingStatus: nextStatus,
        reviewedBy: request.auth.uid,
    });
    return {
        success: true,
        uid,
        verificationStatus: nextStatus,
    };
});
exports.verification_flag = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    requireAdminRole(request);
    const { uid, reason } = request.data;
    if (!uid || !reason?.trim()) {
        throw new https_1.HttpsError("invalid-argument", "uid and reason are required");
    }
    const db = getDb();
    const now = Date.now();
    const flagRef = db.collection("verificationFlags").doc();
    await flagRef.set({
        id: flagRef.id,
        uid,
        reason: reason.trim(),
        flaggedBy: request.auth.uid,
        status: "open",
        createdAt: now,
        updatedAt: now,
    });
    await writeVerificationAudit({
        uid,
        action: "flag_suspicious",
        performedBy: request.auth.uid,
        details: reason.trim(),
    });
    logger.warn("Verification account flagged", {
        uid,
        reason: reason.trim(),
        flaggedBy: request.auth.uid,
    });
    return {
        success: true,
        flagId: flagRef.id,
    };
});
