import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  parseCallableInput,
  verificationFlagInputSchema,
  verificationReviewInputSchema,
  verificationSubmitInputSchema,
} from "./exchange/contracts";
import {
  getAuthorizedActor,
  getDb,
  fingerprintRequest,
  idempotencyRef,
  requireStaffOrAdmin,
  setCompletedIdempotency,
  writeExchangeAudit,
} from "./exchange/security";

type VerificationDocumentStatus = "pending" | "approved" | "rejected";
type VerificationProfileStatus = "none" | "pending" | "verified" | "rejected";

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

function assertCanonicalStoragePath(uid: string, type: string, storagePath: string): void {
  const prefix = `verificationDocs/${uid}/${type}/`;
  const fileName = storagePath.slice(prefix.length);
  if (
    !storagePath.startsWith(prefix)
    || !fileName
    || fileName.includes("/")
    || fileName === "."
    || fileName === ".."
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Each verification document must use the authenticated account's canonical storage path",
    );
  }
}

async function verifyUploadedObject(storagePath: string): Promise<void> {
  try {
    const [metadata] = await admin.storage().bucket().file(storagePath).getMetadata();
    const size = Number(metadata.size ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_VERIFICATION_FILE_SIZE) {
      throw new HttpsError("invalid-argument", "A verification document has an invalid file size");
    }
    if (!metadata.contentType || !ALLOWED_CONTENT_TYPES.has(metadata.contentType)) {
      throw new HttpsError("invalid-argument", "A verification document has an unsupported file type");
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "failed-precondition",
      "An uploaded verification document could not be verified",
    );
  }
}

function writeVerificationAudit(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  params: {
    uid: string;
    action:
      | "doc_uploaded"
      | "doc_approved"
      | "doc_rejected"
      | "status_changed"
      | "flag_suspicious";
    performedBy: string;
    details: string;
    previousValue?: string;
    newValue?: string;
    createdAt: number;
  },
): void {
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

export const verification_submit = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(verificationSubmitInputSchema, request.data);
  const requestFingerprint = fingerprintRequest(input);

  for (const document of input.documents) {
    assertCanonicalStoragePath(actor.uid, document.type, document.storagePath);
  }
  await Promise.all(input.documents.map((document) => verifyUploadedObject(document.storagePath)));

  const db = getDb();
  const now = Date.now();
  const requestRef = idempotencyRef(db, actor.uid, "verification_submit", input.idempotencyKey);

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
      if (
        requestData?.uid !== actor.uid
        || requestData.action !== "verification_submit"
        || requestData.status !== "completed"
        || requestData.requestFingerprint !== requestFingerprint
      ) {
        throw new HttpsError("already-exists", "The idempotency key belongs to a different request");
      }
      const existing = requestData.result as
        | { documentIds?: string[]; verificationStatus?: string }
        | undefined;
      return {
        success: true,
        idempotentReplay: true,
        verificationStatus: existing?.verificationStatus ?? "pending",
        documentIds: existing?.documentIds ?? [],
      };
    }

    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists || !profile) {
      throw new HttpsError("failed-precondition", "Create a business profile before submitting verification");
    }

    const documentIds: string[] = [];
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

    const previousStatus = (profile.verificationStatus as VerificationProfileStatus | undefined) ?? "none";
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
    writeExchangeAudit(transaction, db, {
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
    setCompletedIdempotency(transaction, requestRef, {
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

export const verification_review = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  requireStaffOrAdmin(actor);
  const input = parseCallableInput(verificationReviewInputSchema, request.data);
  if (input.uid === actor.uid) {
    throw new HttpsError("permission-denied", "Reviewers cannot decide their own verification");
  }

  const db = getDb();
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
      throw new HttpsError("not-found", "Verification profile not found");
    }

    const currentVersion = Number(profile.verificationVersion ?? 0);
    if (
      input.expectedProfileVersion !== undefined
      && input.expectedProfileVersion !== currentVersion
    ) {
      throw new HttpsError("aborted", "Verification changed; reload before reviewing again");
    }

    if (documentRef) {
      const document = documentSnapshot?.data();
      if (!documentSnapshot?.exists || !document) {
        throw new HttpsError("not-found", "Verification document not found");
      }
      if (document.uid !== input.uid) {
        throw new HttpsError("permission-denied", "Verification document does not belong to that profile");
      }
      if (document.status !== "pending") {
        throw new HttpsError("failed-precondition", "Only pending verification documents may be reviewed");
      }
    }

    const documents = documentsSnapshot.docs.map((snapshot) => {
      const document = snapshot.data() as { type?: string; status?: VerificationDocumentStatus };
      return {
        id: snapshot.id,
        type: document.type,
        status: snapshot.id === input.documentId ? input.documentStatus : document.status,
      };
    });
    const requiredTypes = ["business_license", "ein_letter"];
    const requiredApproved = requiredTypes.every((type) =>
      documents.some((document) => document.type === type && document.status === "approved"),
    );
    const hasRejected = documents.some((document) => document.status === "rejected");

    if (input.finalStatus === "verified" && !requiredApproved) {
      throw new HttpsError(
        "failed-precondition",
        "Business-license and EIN evidence must be approved before verification",
      );
    }

    const computedStatus: VerificationProfileStatus = requiredApproved
      ? "verified"
      : hasRejected
        ? "rejected"
        : "pending";
    const nextStatus = input.finalStatus ?? computedStatus;
    const previousStatus = (profile.verificationStatus as VerificationProfileStatus | undefined) ?? "none";

    if (documentRef && input.documentStatus) {
      transaction.update(documentRef, {
        status: input.documentStatus,
        reviewNote: input.reviewNote ?? "",
        reviewedAt: now,
        reviewedBy: actor.uid,
        updatedAt: now,
        version: FieldValue.increment(1),
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
    writeExchangeAudit(transaction, db, {
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

export const verification_flag = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  requireStaffOrAdmin(actor);
  const input = parseCallableInput(verificationFlagInputSchema, request.data);
  if (input.uid === actor.uid) {
    throw new HttpsError("permission-denied", "Reviewers cannot flag their own account");
  }

  const db = getDb();
  const now = Date.now();
  const flagId = await db.runTransaction(async (transaction) => {
    const profileRef = db.collection("profiles").doc(input.uid);
    const profileSnapshot = await transaction.get(profileRef);
    if (!profileSnapshot.exists) {
      throw new HttpsError("not-found", "Verification profile not found");
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
    writeExchangeAudit(transaction, db, {
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
