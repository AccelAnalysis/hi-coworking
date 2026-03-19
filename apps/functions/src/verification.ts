import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

type VerificationDocStatus = "pending" | "approved" | "rejected";
type VerificationDocType = "business_license" | "ein_letter" | "utility_bill" | "government_id" | "other";
type VerificationProfileStatus = "none" | "pending" | "verified" | "rejected";

function getDb() {
  return admin.firestore();
}

function requireAdminRole(request: { auth?: { token?: Record<string, unknown> } | null }) {
  const role = request.auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master" && role !== "staff") {
    throw new HttpsError("permission-denied", "Only staff/admin/master users can perform this action");
  }
}

async function writeVerificationAudit(params: {
  uid: string;
  action:
    | "enrichment_linked"
    | "attestation_signed"
    | "doc_uploaded"
    | "doc_approved"
    | "doc_rejected"
    | "status_changed"
    | "flag_suspicious";
  performedBy: string;
  details?: string;
  previousValue?: string;
  newValue?: string;
}) {
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

export const verification_submit = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const uid = request.auth.uid;
  const { documents } = request.data as {
    documents?: Array<{
      id?: string;
      type: VerificationDocType;
      label: string;
      storagePath: string;
      downloadUrl?: string;
    }>;
  };

  if (!documents || documents.length === 0) {
    throw new HttpsError("invalid-argument", "At least one verification document is required");
  }

  const now = Date.now();
  const db = getDb();
  const batch = db.batch();
  const savedDocIds: string[] = [];

  for (const doc of documents) {
    if (!doc.type || !doc.label?.trim() || !doc.storagePath?.trim()) {
      throw new HttpsError("invalid-argument", "Each document must include type, label, and storagePath");
    }

    const ref = doc.id
      ? db.collection("verificationDocuments").doc(doc.id)
      : db.collection("verificationDocuments").doc();

    savedDocIds.push(ref.id);
    batch.set(
      ref,
      {
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
      },
      { merge: true }
    );
  }

  const profileRef = db.collection("profiles").doc(uid);
  batch.set(
    profileRef,
    {
      uid,
      verificationStatus: "pending",
      verificationSubmittedAt: now,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

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

export const verification_review = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }
  requireAdminRole(request);

  const { uid, documentId, status, reviewNote, finalStatus } = request.data as {
    uid?: string;
    documentId?: string;
    status?: VerificationDocStatus;
    reviewNote?: string;
    finalStatus?: VerificationProfileStatus;
  };

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required");
  }

  const now = Date.now();
  const db = getDb();

  if (documentId) {
    if (!status || (status !== "approved" && status !== "rejected")) {
      throw new HttpsError("invalid-argument", "status must be approved or rejected when documentId is provided");
    }

    const docRef = db.collection("verificationDocuments").doc(documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new HttpsError("not-found", "Verification document not found");
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
  const docs = docsSnap.docs.map((d) => d.data() as {
    type?: VerificationDocType;
    status?: VerificationDocStatus;
  });

  const requiredTypes: VerificationDocType[] = ["business_license", "ein_letter"];
  const requiredApproved = requiredTypes.every((requiredType) =>
    docs.some((doc) => doc.type === requiredType && doc.status === "approved")
  );
  const hasRejected = docs.some((doc) => doc.status === "rejected");

  let nextStatus: VerificationProfileStatus = "pending";
  if (finalStatus && ["pending", "verified", "rejected", "none"].includes(finalStatus)) {
    nextStatus = finalStatus;
  } else if (requiredApproved) {
    nextStatus = "verified";
  } else if (hasRejected) {
    nextStatus = "rejected";
  }

  const profileRef = db.collection("profiles").doc(uid);
  const profileSnap = await profileRef.get();
  const previousStatus = (profileSnap.data()?.verificationStatus as VerificationProfileStatus | undefined) ?? "none";

  await profileRef.set(
    {
      uid,
      verificationStatus: nextStatus,
      verificationReviewedAt: now,
      verificationReviewedBy: request.auth.uid,
      verificationRejectionReason: nextStatus === "rejected" ? reviewNote?.trim() || "Verification requirements not met" : "",
      updatedAt: now,
      createdAt: profileSnap.exists ? profileSnap.data()?.createdAt : now,
    },
    { merge: true }
  );

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

export const verification_flag = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }
  requireAdminRole(request);

  const { uid, reason } = request.data as { uid?: string; reason?: string };
  if (!uid || !reason?.trim()) {
    throw new HttpsError("invalid-argument", "uid and reason are required");
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
