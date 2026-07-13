import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import type { Response } from "express";
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onObjectFinalized } from "firebase-functions/v2/storage";

type RecordData = Record<string, unknown>;

const PRIVATE_CACHE_CONTROL = "private, no-store, max-age=0, must-revalidate";
const MAX_RFX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_REFERRAL_EVIDENCE_BYTES = 15 * 1024 * 1024;
const MAX_PRIVATE_OBJECT_BYTES = MAX_RFX_ATTACHMENT_BYTES;

const RFx_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
]);

const REFERRAL_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SENSITIVE_STORAGE_PREFIXES = [
  "capabilityStatements/",
  "profilePhotos/",
  "profileVideos/",
  "verificationDocs/",
  "rfxResponses/",
  "rfxProposals/",
  "rfxDocuments/",
  "teamDocuments/",
  "businessReferralEvidence/",
  "businessReferralDisputeEvidence/",
] as const;

function asRecord(value: unknown): RecordData {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function canonicalStoragePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 4 || value.length > 1_024) return undefined;
  if (
    value.startsWith("/")
    || value.includes("\\")
    || value.includes("\0")
    || /[\u0000-\u001f\u007f]/.test(value)
    || /^(?:https?:|gs:)/i.test(value)
    || /%(?:2f|5c|2e)/i.test(value)
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) return undefined;
  return value;
}

function parseRfxPath(path: string): {
  namespace: "rfxResponses" | "rfxProposals" | "rfxDocuments";
  rfxId: string;
  respondentUid: string;
} | null {
  const match = path.match(/^(rfxResponses|rfxProposals|rfxDocuments)\/([^/]+)\/([^/]+)\/.+$/);
  if (!match) return null;
  return {
    namespace: match[1] as "rfxResponses" | "rfxProposals" | "rfxDocuments",
    rfxId: match[2],
    respondentUid: match[3],
  };
}

function parseReferralPath(path: string): {
  namespace: "businessReferralEvidence" | "businessReferralDisputeEvidence";
  referralId: string;
  uploaderUid: string;
} | null {
  const match = path.match(
    /^(businessReferralEvidence|businessReferralDisputeEvidence)\/([^/]+)\/([^/]+)\/.+$/,
  );
  if (!match) return null;
  return {
    namespace: match[1] as "businessReferralEvidence" | "businessReferralDisputeEvidence",
    referralId: match[2],
    uploaderUid: match[3],
  };
}

function activeRfxUploadGrant(
  grant: RecordData,
  uid: string,
  rfxId: string,
  storagePath: string,
  now: number,
): boolean {
  return grant.grantType === "rfx_response_upload"
    && grant.rfxId === rfxId
    && grant.respondentUid === uid
    && finiteNumber(grant.expiresAt) !== undefined
    && (finiteNumber(grant.expiresAt) as number) > now
    && stringList(grant.allowedStoragePaths).includes(storagePath);
}

function activeRfxReadGrant(
  grant: RecordData,
  uid: string,
  rfxId: string,
  storagePath: string,
  now: number,
): boolean {
  return grant.grantType === "rfx_response_read"
    && grant.rfxId === rfxId
    && grant.accessorUid === uid
    && finiteNumber(grant.expiresAt) !== undefined
    && (finiteNumber(grant.expiresAt) as number) > now
    && stringList(grant.allowedStoragePaths).includes(storagePath);
}

function activeReferralGrant(
  grant: RecordData,
  uid: string,
  referralId: string,
  storagePath: string,
  operation: "upload" | "download",
  now: number,
): boolean {
  const pathField = operation === "upload"
    ? "allowedCreateStoragePaths"
    : "allowedReadStoragePaths";
  return grant.grantType === "business_referral_storage"
    && grant.referralId === referralId
    && grant.accessorUid === uid
    && finiteNumber(grant.expiresAt) !== undefined
    && (finiteNumber(grant.expiresAt) as number) > now
    && stringList(grant[pathField]).includes(storagePath);
}

async function authorizeUpload(uid: string, storagePath: string): Promise<{
  entityType: "rfx" | "businessReferral";
  entityId: string;
  maxBytes: number;
  allowedContentTypes: Set<string>;
}> {
  const db = admin.firestore();
  const now = Date.now();
  const rfxPath = parseRfxPath(storagePath);
  if (rfxPath) {
    if (rfxPath.namespace !== "rfxResponses" || rfxPath.respondentUid !== uid) {
      throw new Error("permission-denied");
    }
    const [grantSnapshot, rfxSnapshot, responseAccessSnapshot] = await Promise.all([
      db.collection("rfxResponseUploadGrantScopes").doc(rfxPath.rfxId)
        .collection("uploadGrants").doc(uid).get(),
      db.collection("rfx").doc(rfxPath.rfxId).get(),
      db.collection("rfxResponseAccess").doc(rfxPath.rfxId)
        .collection("respondents").doc(uid).get(),
    ]);
    const grant = asRecord(grantSnapshot.data());
    const rfx = asRecord(rfxSnapshot.data());
    if (
      !grantSnapshot.exists
      || !rfxSnapshot.exists
      || responseAccessSnapshot.exists
      || !activeRfxUploadGrant(grant, uid, rfxPath.rfxId, storagePath, now)
      || rfx.status !== "open"
      || rfx.adminApprovalStatus !== "approved"
      || (finiteNumber(rfx.dueDate) !== undefined && (finiteNumber(rfx.dueDate) as number) <= now)
    ) throw new Error("permission-denied");
    return {
      entityType: "rfx",
      entityId: rfxPath.rfxId,
      maxBytes: MAX_RFX_ATTACHMENT_BYTES,
      allowedContentTypes: RFx_CONTENT_TYPES,
    };
  }

  const referralPath = parseReferralPath(storagePath);
  if (referralPath) {
    if (referralPath.uploaderUid !== uid) throw new Error("permission-denied");
    const [grantSnapshot, referralSnapshot] = await Promise.all([
      db.collection("businessReferralStorageGrantScopes").doc(referralPath.referralId)
        .collection("storageGrants").doc(uid).get(),
      db.collection("businessReferrals").doc(referralPath.referralId).get(),
    ]);
    if (
      !grantSnapshot.exists
      || !referralSnapshot.exists
      || !activeReferralGrant(
        asRecord(grantSnapshot.data()),
        uid,
        referralPath.referralId,
        storagePath,
        "upload",
        now,
      )
    ) throw new Error("permission-denied");
    return {
      entityType: "businessReferral",
      entityId: referralPath.referralId,
      maxBytes: MAX_REFERRAL_EVIDENCE_BYTES,
      allowedContentTypes: REFERRAL_CONTENT_TYPES,
    };
  }

  throw new Error("permission-denied");
}

async function authorizeDownload(uid: string, storagePath: string): Promise<void> {
  const db = admin.firestore();
  const now = Date.now();
  const rfxPath = parseRfxPath(storagePath);
  if (rfxPath) {
    const grantSnapshot = await db.collection("rfxResponseReadGrantScopes").doc(rfxPath.rfxId)
      .collection("readGrants").doc(uid).get();
    if (
      grantSnapshot.exists
      && activeRfxReadGrant(asRecord(grantSnapshot.data()), uid, rfxPath.rfxId, storagePath, now)
    ) return;
    throw new Error("permission-denied");
  }

  const referralPath = parseReferralPath(storagePath);
  if (referralPath) {
    const grantSnapshot = await db.collection("businessReferralStorageGrantScopes")
      .doc(referralPath.referralId).collection("storageGrants").doc(uid).get();
    if (
      grantSnapshot.exists
      && activeReferralGrant(
        asRecord(grantSnapshot.data()),
        uid,
        referralPath.referralId,
        storagePath,
        "download",
        now,
      )
    ) return;
    throw new Error("permission-denied");
  }

  throw new Error("permission-denied");
}

async function authenticatedUid(authorization: string | undefined): Promise<{
  uid: string;
  role?: string;
}> {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) throw new Error("unauthenticated");
  const token = await admin.auth().verifyIdToken(match[1]);
  if (!token.uid) throw new Error("unauthenticated");
  return {
    uid: token.uid,
    role: typeof token.role === "string" ? token.role : undefined,
  };
}

function safeContentType(value: string | undefined): string {
  return (value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function sendFailure(
  response: Response,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : "internal";
  if (message === "unauthenticated") {
    response.status(401).json({ error: "Authentication is required" });
    return;
  }
  if (message === "permission-denied") {
    response.status(403).json({ error: "Private object access is not authorized" });
    return;
  }
  if (message === "invalid-request") {
    response.status(400).json({ error: "The private object request is invalid" });
    return;
  }
  if (message === "already-exists") {
    response.status(409).json({ error: "The private object already exists" });
    return;
  }
  logger.error("Private Exchange Storage request failed", {
    error: error instanceof Error ? error.name : "unknown",
  });
  response.status(500).json({ error: "Private object processing failed" });
}

/**
 * Authenticated byte transfer for private RFx and business-referral objects.
 * New sensitive objects are written through the Admin GCS API without Firebase
 * bearer download tokens; callers receive bytes, never a durable object URL.
 */
export const exchange_privateStorage = onRequest(
  { cors: true, timeoutSeconds: 300, memory: "512MiB" },
  async (request, response) => {
    response.set("Cache-Control", PRIVATE_CACHE_CONTROL);
    response.set("X-Content-Type-Options", "nosniff");
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const actor = await authenticatedUid(request.get("authorization"));
      const operation = request.get("x-exchange-storage-operation");
      const storagePath = canonicalStoragePath(request.get("x-storage-path"));
      if (!storagePath || (operation !== "upload" && operation !== "download")) {
        throw new Error("invalid-request");
      }

      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);
      if (operation === "upload") {
        const authorization = await authorizeUpload(actor.uid, storagePath);
        const contentType = safeContentType(request.get("content-type"));
        const body = request.rawBody;
        if (
          !Buffer.isBuffer(body)
          || body.length < 1
          || body.length > authorization.maxBytes
          || !authorization.allowedContentTypes.has(contentType)
          || body.length > MAX_PRIVATE_OBJECT_BYTES
        ) throw new Error("invalid-request");

        const sha256 = createHash("sha256").update(body).digest("hex");
        const uploadReceiptId = createHash("sha256").update(storagePath).digest("hex");
        const uploadReceiptRef = admin.firestore().collection("privateStorageUploads")
          .doc(uploadReceiptId);
        const idempotentReservation = await admin.firestore().runTransaction(async (transaction) => {
          const receiptSnapshot = await transaction.get(uploadReceiptRef);
          if (receiptSnapshot.exists) {
            const receipt = asRecord(receiptSnapshot.data());
            if (
              receipt.uid !== actor.uid
              || receipt.storagePathHash !== uploadReceiptId
              || receipt.sha256 !== sha256
              || receipt.contentType !== contentType
              || receipt.size !== body.length
            ) throw new Error("already-exists");
            return true;
          }
          transaction.create(uploadReceiptRef, {
            id: uploadReceiptId,
            uid: actor.uid,
            storagePathHash: uploadReceiptId,
            sha256,
            contentType,
            size: body.length,
            status: "reserved",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          return false;
        });

        let idempotent = false;
        if (idempotentReservation) {
          try {
            const [existingMetadata] = await file.getMetadata();
            if (
              Number(existingMetadata.size) !== body.length
              || safeContentType(existingMetadata.contentType) !== contentType
              || existingMetadata.metadata?.exchangeSha256 !== sha256
            ) throw new Error("already-exists");
            idempotent = true;
          } catch (error) {
            if (asRecord(error).code !== 404) throw error;
          }
        }
        if (!idempotent) {
          try {
            await file.save(body, {
              resumable: false,
              validation: "crc32c",
              preconditionOpts: { ifGenerationMatch: 0 },
              metadata: {
                contentType,
                cacheControl: PRIVATE_CACHE_CONTROL,
                contentDisposition: "attachment",
                metadata: {
                  exchangeAccessModel: "server-mediated-v1",
                  exchangeSha256: sha256,
                },
              },
            });
          } catch (error) {
            if (asRecord(error).code !== 412) throw error;
            const [existingMetadata] = await file.getMetadata();
            if (
              Number(existingMetadata.size) !== body.length
              || safeContentType(existingMetadata.contentType) !== contentType
              || existingMetadata.metadata?.exchangeSha256 !== sha256
            ) throw new Error("already-exists");
            idempotent = true;
          }
        }
        await uploadReceiptRef.update({ status: "complete", updatedAt: Date.now() });

        const auditId = createHash("sha256")
          .update(`${actor.uid}\0${storagePath}\0${sha256}`)
          .digest("hex");
        const auditRef = admin.firestore().collection("exchangeAudit").doc(auditId);
        try {
          await auditRef.create({
            id: auditRef.id,
            actorUid: actor.uid,
            ...(actor.role ? { actorRole: actor.role } : {}),
            action: "private_storage.uploaded",
            entityType: authorization.entityType,
            entityId: authorization.entityId,
            metadata: { contentType, size: body.length },
            createdAt: Date.now(),
          });
        } catch (error) {
          if (asRecord(error).code !== 6 && asRecord(error).code !== "already-exists") throw error;
        }
        response.status(idempotent ? 200 : 201).json({
          success: true,
          idempotent,
          storagePath,
          contentType,
          size: body.length,
        });
        return;
      }

      await authorizeDownload(actor.uid, storagePath);
      let metadata: RecordData;
      try {
        [metadata] = await file.getMetadata() as unknown as [RecordData];
      } catch (error) {
        if (asRecord(error).code === 404) {
          response.status(404).json({ error: "Private object not found" });
          return;
        }
        throw error;
      }
      const contentType = safeContentType(stringValue(metadata.contentType));
      const allowedType = RFx_CONTENT_TYPES.has(contentType) || REFERRAL_CONTENT_TYPES.has(contentType);
      const fileName = storagePath.split("/").at(-1)?.replace(/["\r\n]/g, "_")
        ?? "exchange-document";
      response.set("Content-Type", allowedType ? contentType : "application/octet-stream");
      response.set("Content-Disposition", `attachment; filename="${fileName}"`);
      await new Promise<void>((resolve, reject) => {
        const stream = file.createReadStream();
        stream.on("end", resolve);
        stream.on("error", reject);
        stream.pipe(response);
      });
    } catch (error) {
      if (!response.headersSent) sendFailure(response, error);
    }
  },
);

export function isSensitiveExchangeStoragePath(path: string): boolean {
  return SENSITIVE_STORAGE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Defense in depth for other legacy client upload surfaces. Production GCS
 * stores Firebase download tokens as custom metadata, so clearing that field
 * revokes any generated bearer URL and normalizes cache/disposition metadata.
 */
export const exchange_normalizeSensitiveStorageMetadata = onObjectFinalized(
  { retry: true },
  async (event) => {
    const storagePath = event.data.name;
    if (!storagePath || !isSensitiveExchangeStoragePath(storagePath)) return;
    const customMetadata = event.data.metadata ?? {};
    const clearedMetadata: Record<string, string | null> = {
      firebaseStorageDownloadTokens: null,
      exchangeAccessModel: "server-mediated-v1",
    };
    for (const key of Object.keys(customMetadata)) {
      if (key === "exchangeSha256") {
        clearedMetadata[key] = customMetadata[key];
      } else if (key !== "exchangeAccessModel") {
        clearedMetadata[key] = null;
      }
    }
    const inline = storagePath.startsWith("profilePhotos/")
      || storagePath.startsWith("profileVideos/");
    try {
      await admin.storage().bucket(event.data.bucket).file(storagePath).setMetadata({
        cacheControl: PRIVATE_CACHE_CONTROL,
        contentDisposition: inline ? "inline" : "attachment",
        contentEncoding: null,
        metadata: clearedMetadata,
      } as never);
    } catch (error) {
      // A client or retention job can delete the object between finalization and
      // this retryable trigger. A missing object is already in the safe state.
      if (finiteNumber(asRecord(error).code) === 404) return;
      throw error;
    }
  },
);
