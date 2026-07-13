import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import { CREDIT_COSTS, MEMBERSHIP_TIERS } from "./config";
import {
  parseCallableInput,
  rfxCancelInputSchema,
  rfxBackfillGeoInputSchema,
  rfxEvaluateResponseInputSchema,
  rfxModerateInputSchema,
  rfxPublishInputSchema,
  rfxPrepareResponseUploadsInputSchema,
  rfxSubmitResponseInputSchema,
  rfxUpdateInputSchema,
} from "./exchange/contracts";
import {
  getAuthorizedActor,
  getDb,
  fingerprintRequest,
  idempotencyRef,
  loadOrgAuthority,
  requireAdmin,
  setCompletedIdempotency,
  throwEligibilityFailure,
  writeExchangeAudit,
  evaluateTransactionEligibility,
  type AuthorizedActor,
} from "./exchange/security";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const RFx_SCHEMA_VERSION = 2;
const RESPONSE_SCHEMA_VERSION = 2;
const PUBLISH_ACTION = "rfx_publish";
const SUBMIT_RESPONSE_ACTION = "rfx_submitResponse";
const MAX_RESPONSES_PER_RFX = 400;
const RESPONSE_UPLOAD_GRANT_TTL_MS = 2 * 60 * 60 * 1_000;
const RESPONSE_READ_GRANT_TTL_MS = 60 * 1_000;
const RESPONSE_FILE_ACCESS_DENIED = "RFx response file access is required";
const MAX_UPLOAD_GRANT_PATHS = 26;
const MAX_UPLOAD_GRANT_CLEANUPS = 100;
const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
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

type RecordData = Record<string, unknown>;

const rfxPrepareResponseDownloadInputSchema = z
  .object({
    rfxId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    respondentUid: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    storagePath: z.string().trim().min(1).max(1_024),
  })
  .strict();

function encodeGeohash(lat: number, lng: number, precision = 9): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = "";

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        idx = idx * 2 + 1;
        lngMin = mid;
      } else {
        idx *= 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx *= 2;
        latMax = mid;
      }
    }

    evenBit = !evenBit;

    if (++bit === 5) {
      geohash += BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }

  return geohash;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireAdminOrMaster(request: { auth?: { token?: Record<string, unknown> } | null }) {
  const role = request.auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Only admin/master can run this operation");
  }
}

function asRecord(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function documentVersion(data: RecordData): number {
  return Number.isSafeInteger(data.version) && (data.version as number) >= 0
    ? data.version as number
    : 0;
}

function rfxOwnerUid(data: RecordData): string | undefined {
  return stringValue(data.ownerUid) ?? stringValue(data.createdBy);
}

function hasRfxOrganizationScope(data: RecordData): boolean {
  return Object.prototype.hasOwnProperty.call(data, "orgId");
}

function requireValidRfxOrganizationId(data: RecordData): string | undefined {
  if (!hasRfxOrganizationScope(data)) return undefined;
  const orgId = stringValue(data.orgId);
  if (!orgId) {
    throw new HttpsError(
      "failed-precondition",
      "RFx organization ownership is malformed and requires administrative review",
    );
  }
  return orgId;
}

function rfxStatus(data: RecordData): string {
  const status = stringValue(data.status) ?? "draft";
  return status === "pending" ? "under_review" : status;
}

function responseStatus(data: RecordData): string {
  const status = stringValue(data.status) ?? "pending";
  return status === "pending" ? "submitted" : status;
}

function assertExpectedVersion(data: RecordData, expectedVersion: number, entity: string): number {
  const currentVersion = documentVersion(data);
  if (currentVersion !== expectedVersion) {
    throw new HttpsError("aborted", `${entity} was changed by another request`, {
      expectedVersion,
      currentVersion,
    });
  }
  return currentVersion;
}

function setDefined(target: RecordData, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function requireUniqueIds(values: Array<{ id: string }>, field: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new HttpsError("invalid-argument", `${field} IDs must be unique`);
    }
    ids.add(value.id);
  }
}

function requireValidCriteria(
  criteria: Array<{ id: string; weight: number }>,
): void {
  requireUniqueIds(criteria, "Evaluation criterion");
  const totalWeight = criteria.reduce((total, criterion) => total + criterion.weight, 0);
  if (criteria.length > 0 && Math.abs(totalWeight - 100) > 0.001) {
    throw new HttpsError("invalid-argument", "Evaluation criteria weights must total 100");
  }
}

function requireActiveMembership(user: FirebaseFirestore.DocumentData | undefined, now: number) {
  if (!user || user.membershipStatus !== "active") {
    throw new HttpsError("failed-precondition", "An active membership is required", {
      reasonCode: "PLAN_REQUIRED",
    });
  }
  const expiresAt = user.expiresAt;
  if (typeof expiresAt === "number" && expiresAt <= now) {
    throw new HttpsError("failed-precondition", "Your membership has expired", {
      reasonCode: "PLAN_REQUIRED",
    });
  }
  const tier = MEMBERSHIP_TIERS.find((candidate) => candidate.id === user.plan);
  if (!tier) {
    throw new HttpsError("failed-precondition", "An eligible membership plan is required", {
      reasonCode: "PLAN_REQUIRED",
    });
  }
  return tier;
}

async function readActiveRfxUsage(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  ownerUid: string,
  orgId?: string,
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  activeCount: number;
  subjectType: "user" | "organization";
  subjectId: string;
}> {
  const subjectType = orgId ? "organization" : "user";
  const subjectId = orgId ?? ownerUid;
  // Preserve the established per-user document ID while using a distinct,
  // deterministic namespace for organization quota serialization.
  const ref = db.collection("exchangeUsage").doc(orgId ? `org:${orgId}` : ownerUid);
  const rfxQuery = orgId
    ? db.collection("rfx").where("orgId", "==", orgId)
    : db.collection("rfx").where("createdBy", "==", ownerUid);
  const [usageSnap, ownedRfxSnap] = await Promise.all([
    transaction.get(ref),
    transaction.get(rfxQuery),
  ]);
  // Reading the deterministic usage document makes quota decisions serialize,
  // while the query safely seeds or repairs the derived active count.
  void usageSnap;
  const activeCount = ownedRfxSnap.docs.filter((doc) => {
    const rfx = asRecord(doc.data());
    const status = rfxStatus(rfx);
    const belongsToSubject = orgId
      ? stringValue(rfx.orgId) === orgId
      : !hasRfxOrganizationScope(rfx);
    return belongsToSubject && (status === "open" || status === "under_review");
  }).length;
  return { ref, activeCount, subjectType, subjectId };
}

function writeActiveRfxUsage(
  transaction: FirebaseFirestore.Transaction,
  state: {
    ref: FirebaseFirestore.DocumentReference;
    activeCount: number;
    subjectType: "user" | "organization";
    subjectId: string;
  },
  nextActiveCount: number,
  now: number,
): void {
  transaction.set(state.ref, {
    subjectType: state.subjectType,
    subjectId: state.subjectId,
    ...(state.subjectType === "user"
      ? { uid: state.subjectId }
      : { orgId: state.subjectId }),
    schemaVersion: 2,
    rfxActivePosts: Math.max(0, nextActiveCount),
    mutationVersion: FieldValue.increment(1),
    updatedAt: now,
  }, { merge: true });
}

function completedIdempotencyResult(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  uid: string,
  action: string,
  requestFingerprint: string,
): RecordData | undefined {
  if (!snapshot.exists) return undefined;
  const data = asRecord(snapshot.data());
  if (data.status !== "completed" || data.uid !== uid || data.action !== action) {
    throw new HttpsError("failed-precondition", "The idempotency key is not reusable");
  }
  if (data.requestFingerprint !== requestFingerprint) {
    throw new HttpsError("already-exists", "The idempotency key belongs to a different request");
  }
  return asRecord(data.result);
}

async function requireRfxManager(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  actor: AuthorizedActor,
  rfx: RecordData,
  options: { allowStaff?: boolean } = {},
): Promise<void> {
  const orgId = requireValidRfxOrganizationId(rfx);
  if (actor.isAdmin || (options.allowStaff && actor.role === "staff")) return;
  if (orgId) {
    await loadOrgAuthority(transaction, db, orgId, actor.uid, { managementRequired: true });
    return;
  }
  if (rfxOwnerUid(rfx) === actor.uid) return;
  throw new HttpsError("permission-denied", "RFx owner authorization is required");
}

async function hasActiveOrgAuthority(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  orgId: string | undefined,
  uid: string,
  managementRequired = false,
): Promise<boolean> {
  if (!orgId) return false;
  try {
    await loadOrgAuthority(transaction, db, orgId, uid, { managementRequired });
    return true;
  } catch (error) {
    if (error instanceof HttpsError && error.code === "permission-denied") return false;
    throw error;
  }
}

function deterministicResponseId(rfxId: string, uid: string, orgId?: string): string {
  const subject = responseSubjectKey(uid, orgId);
  return createHash("sha256").update(`${rfxId}|${subject}`, "utf8").digest("hex").slice(0, 40);
}

function responseUploadGrantRef(
  db: FirebaseFirestore.Firestore,
  rfxId: string,
  uid: string,
): FirebaseFirestore.DocumentReference {
  return db.collection("rfxResponseUploadGrantScopes")
    .doc(rfxId)
    .collection("uploadGrants")
    .doc(uid);
}

function responseReadGrantRef(
  db: FirebaseFirestore.Firestore,
  rfxId: string,
  uid: string,
): FirebaseFirestore.DocumentReference {
  return db.collection("rfxResponseReadGrantScopes")
    .doc(rfxId)
    .collection("readGrants")
    .doc(uid);
}

function responseSubjectKey(uid: string, orgId?: string): string {
  return orgId ? `org:${orgId}` : `uid:${uid}`;
}

function assertResponseIdempotencyResult(
  result: RecordData,
  rfxId: string,
  responseId: string,
  subject: string,
): void {
  const storedSubject = stringValue(result.respondentSubject);
  if (
    result.rfxId !== rfxId
    || (storedSubject ? storedSubject !== subject : result.id !== responseId)
  ) {
    throw new HttpsError("already-exists", "The idempotency key was used for another response");
  }
}

function requireCanonicalStoragePath(path: string, rfxId: string, actorUid: string): void {
  const prefix = `rfxResponses/${rfxId}/${actorUid}/`;
  const lowered = path.toLowerCase();
  const segments = path.split("/");
  if (
    !path.startsWith(prefix)
    || path.length <= prefix.length
    || path.startsWith("/")
    || path.includes("\\")
    || path.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || /^(?:https?:|gs:)/i.test(path)
    || lowered.includes("%2f")
    || lowered.includes("%5c")
    || lowered.includes("%2e")
  ) {
    throw new HttpsError(
      "invalid-argument",
      `Attachment paths must use the private ${prefix} namespace`,
    );
  }
}

function requireReferencedResponseStoragePath(
  path: string,
  rfxId: string,
  respondentUid: string,
): void {
  const prefixes = [
    `rfxResponses/${rfxId}/${respondentUid}/`,
    `rfxProposals/${rfxId}/${respondentUid}/`,
    `rfxDocuments/${rfxId}/${respondentUid}/`,
  ];
  const lowered = path.toLowerCase();
  const segments = path.split("/");
  if (
    !prefixes.some((prefix) => path.startsWith(prefix) && path.length > prefix.length)
    || path.startsWith("/")
    || path.includes("\\")
    || path.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || /^(?:https?:|gs:)/i.test(path)
    || lowered.includes("%2f")
    || lowered.includes("%5c")
    || lowered.includes("%2e")
  ) {
    throw new HttpsError("invalid-argument", "The RFx response file path is not canonical");
  }
}

function validateResponseAttachments(
  input: {
    proposalText?: string;
    proposalStoragePath?: string;
    uploadedDocuments: Array<{
      requestedDocId?: string;
      label: string;
      storagePath: string;
      fileName: string;
      contentType?: string;
      size?: number;
    }>;
  },
  rfx: RecordData,
  rfxId: string,
  actorUid: string,
): void {
  if (
    !input.proposalText
    && !input.proposalStoragePath
    && input.uploadedDocuments.length === 0
  ) {
    throw new HttpsError("invalid-argument", "Proposal content or an attachment is required");
  }

  const requestedDocuments = Array.isArray(rfx.requestedDocuments)
    ? rfx.requestedDocuments.map(asRecord)
    : [];
  const requestedIds = new Set(
    requestedDocuments.map((document) => stringValue(document.id)).filter((id): id is string => Boolean(id)),
  );
  const requiredIds = new Set(
    requestedDocuments
      .filter((document) => document.required === true)
      .map((document) => stringValue(document.id))
      .filter((id): id is string => Boolean(id)),
  );
  const suppliedRequestedIds = new Set<string>();
  const storagePaths = new Set<string>();

  if (input.proposalStoragePath) {
    requireCanonicalStoragePath(input.proposalStoragePath, rfxId, actorUid);
    storagePaths.add(input.proposalStoragePath);
  }

  for (const attachment of input.uploadedDocuments) {
    requireCanonicalStoragePath(attachment.storagePath, rfxId, actorUid);
    if (storagePaths.has(attachment.storagePath)) {
      throw new HttpsError("invalid-argument", "Attachment storage paths must be unique");
    }
    storagePaths.add(attachment.storagePath);

    if (
      attachment.fileName.includes("/")
      || attachment.fileName.includes("\\")
      || attachment.fileName.includes("\0")
      || attachment.fileName === "."
      || attachment.fileName === ".."
    ) {
      throw new HttpsError("invalid-argument", "Attachment file names are invalid");
    }
    if (
      !attachment.contentType
      || !ALLOWED_ATTACHMENT_CONTENT_TYPES.has(attachment.contentType.toLowerCase())
      || !Number.isSafeInteger(attachment.size)
      || (attachment.size as number) <= 0
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Each uploaded document requires an allowed contentType and a positive size",
      );
    }

    if (attachment.requestedDocId) {
      if (!requestedIds.has(attachment.requestedDocId)) {
        throw new HttpsError("invalid-argument", "An attachment references an unknown requested document");
      }
      if (suppliedRequestedIds.has(attachment.requestedDocId)) {
        throw new HttpsError("invalid-argument", "Only one attachment may satisfy each requested document");
      }
      suppliedRequestedIds.add(attachment.requestedDocId);
    }
  }

  for (const requiredId of requiredIds) {
    if (!suppliedRequestedIds.has(requiredId)) {
      throw new HttpsError("failed-precondition", "All required RFx documents must be attached", {
        requestedDocId: requiredId,
      });
    }
  }
}

async function validateStoredResponseAttachments(
  input: {
    proposalStoragePath?: string;
    uploadedDocuments: Array<{
      storagePath: string;
      contentType?: string;
      size?: number;
    }>;
  },
  rfxId: string,
  actorUid: string,
): Promise<void> {
  const attachments = [
    ...(input.proposalStoragePath
      ? [{ storagePath: input.proposalStoragePath, contentType: undefined, size: undefined }]
      : []),
    ...input.uploadedDocuments,
  ];
  if (attachments.length === 0) return;

  await Promise.all(attachments.map(async (attachment) => {
    requireCanonicalStoragePath(attachment.storagePath, rfxId, actorUid);
    try {
      const [metadata] = await admin.storage().bucket().file(attachment.storagePath).getMetadata();
      const actualContentType = stringValue(metadata.contentType)?.toLowerCase();
      const actualSize = Number(metadata.size);
      if (
        !actualContentType
        || !ALLOWED_ATTACHMENT_CONTENT_TYPES.has(actualContentType)
        || !Number.isSafeInteger(actualSize)
        || actualSize <= 0
        || actualSize > 25 * 1024 * 1024
      ) {
        throw new HttpsError("failed-precondition", "An attachment has invalid stored metadata");
      }
      if (
        attachment.contentType
        && attachment.contentType.toLowerCase() !== actualContentType
      ) {
        throw new HttpsError("failed-precondition", "Attachment content type does not match Storage");
      }
      if (attachment.size !== undefined && attachment.size !== actualSize) {
        throw new HttpsError("failed-precondition", "Attachment size does not match Storage");
      }

      const customMetadata = asRecord(metadata.metadata);
      const metadataRfxId = stringValue(customMetadata.rfxId);
      const metadataOwnerUid = stringValue(customMetadata.ownerUid)
        ?? stringValue(customMetadata.respondentUid);
      if (metadataRfxId && metadataRfxId !== rfxId) {
        throw new HttpsError("failed-precondition", "Attachment RFx metadata is invalid");
      }
      if (metadataOwnerUid && metadataOwnerUid !== actorUid) {
        throw new HttpsError("failed-precondition", "Attachment owner metadata is invalid");
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("failed-precondition", "An attachment could not be verified in Storage");
    }
  }));
}

function submittedAttachmentStoragePaths(response: RecordData): string[] {
  const paths = new Set<string>();
  const proposalStoragePath = stringValue(response.proposalStoragePath);
  if (proposalStoragePath) paths.add(proposalStoragePath);
  if (Array.isArray(response.uploadedDocuments)) {
    for (const rawDocument of response.uploadedDocuments) {
      const storagePath = stringValue(asRecord(rawDocument).storagePath);
      if (storagePath) paths.add(storagePath);
    }
  }
  return [...paths];
}

function responseSubjectMatches(
  response: RecordData,
  uid: string,
  orgId?: string,
): boolean {
  const responseOrgId = requireValidResponseOrganizationId(response);
  if (orgId) return responseOrgId === orgId;
  return responseOrgId === undefined
    && (stringValue(response.respondentUid) ?? stringValue(response.createdBy)) === uid;
}

function responseSubmitterMatches(response: RecordData, uid: string): boolean {
  return (stringValue(response.respondentUid) ?? stringValue(response.createdBy)) === uid;
}

function hasResponseOrganizationScope(response: RecordData): boolean {
  return Object.prototype.hasOwnProperty.call(response, "respondentOrgId")
    || Object.prototype.hasOwnProperty.call(response, "orgId");
}

function requireValidResponseOrganizationId(response: RecordData): string | undefined {
  if (!hasResponseOrganizationScope(response)) return undefined;
  const hasCanonical = Object.prototype.hasOwnProperty.call(response, "respondentOrgId");
  const hasLegacy = Object.prototype.hasOwnProperty.call(response, "orgId");
  const canonicalOrgId = hasCanonical ? stringValue(response.respondentOrgId) : undefined;
  const legacyOrgId = hasLegacy ? stringValue(response.orgId) : undefined;
  if (
    (hasCanonical && !canonicalOrgId)
    || (hasLegacy && !legacyOrgId)
    || (canonicalOrgId && legacyOrgId && canonicalOrgId !== legacyOrgId)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "RFx response organization ownership is malformed and requires administrative review",
    );
  }
  return canonicalOrgId ?? legacyOrgId;
}

function requireValidResponseAccessOrganizationId(responseAccess: RecordData): string | undefined {
  return requireValidResponseOrganizationId(responseAccess);
}

function evaluationCriteriaFromRfx(rfx: RecordData): Array<{ id: string; weight: number }> {
  if (!Array.isArray(rfx.evaluationCriteria)) return [];
  const criteria = rfx.evaluationCriteria.map(asRecord).map((criterion) => ({
    id: stringValue(criterion.id),
    weight: isFiniteNumber(criterion.weight) ? criterion.weight : undefined,
  }));
  if (criteria.some((criterion) => !criterion.id || criterion.weight === undefined)) {
    throw new HttpsError("failed-precondition", "RFx evaluation criteria are invalid");
  }
  const normalized = criteria as Array<{ id: string; weight: number }>;
  requireValidCriteria(normalized);
  return normalized;
}

function computeWeightedScore(
  rfx: RecordData,
  rawScores: Record<string, number> | undefined,
  required: boolean,
): { criteriaScores?: Record<string, number>; totalScore?: number } {
  const criteria = evaluationCriteriaFromRfx(rfx);
  if (!rawScores) {
    if (required && criteria.length > 0) {
      throw new HttpsError("invalid-argument", "Every RFx criterion must be scored before acceptance");
    }
    return required ? { criteriaScores: {}, totalScore: 0 } : {};
  }

  const criterionIds = new Set(criteria.map((criterion) => criterion.id));
  const scoreIds = Object.keys(rawScores);
  if (
    scoreIds.some((id) => !criterionIds.has(id))
    || criteria.some((criterion) => !Object.prototype.hasOwnProperty.call(rawScores, criterion.id))
  ) {
    throw new HttpsError("invalid-argument", "Scores must match every RFx evaluation criterion exactly");
  }

  const totalScore = criteria.length === 0
    ? 0
    : criteria.reduce(
      (total, criterion) => total + rawScores[criterion.id] * criterion.weight,
      0,
    ) / 100;

  return {
    criteriaScores: Object.fromEntries(criteria.map((criterion) => [criterion.id, rawScores[criterion.id]])),
    totalScore: Math.round(totalScore * 100) / 100,
  };
}

function evaluationMatches(
  response: RecordData,
  scores: Record<string, number> | undefined,
  notes: string | undefined,
): boolean {
  if (scores !== undefined) {
    const storedScores = asRecord(response.criteriaScores);
    const keys = Object.keys(scores).sort();
    const storedKeys = Object.keys(storedScores).sort();
    if (
      keys.length !== storedKeys.length
      || keys.some((key, index) => key !== storedKeys[index] || storedScores[key] !== scores[key])
    ) return false;
  }
  return notes === undefined || response.evaluationNotes === notes;
}

/**
 * Publish an RFx after transactional authorization, eligibility, quota, and
 * idempotency checks. Ordinary users always enter moderation.
 */
export const rfx_publish = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxPublishInputSchema, request.data);
  const requestFingerprint = fingerprintRequest(input);
  if (input.adminOverrideReason && !actor.isAdmin) {
    throw new HttpsError("permission-denied", "Only administrators may provide an override reason");
  }
  requireValidCriteria(input.evaluationCriteria);
  requireUniqueIds(input.requestedDocuments, "Requested document");

  const db = getDb();
  const now = Date.now();
  const rfxRef = db.collection("rfx").doc();
  const requestRef = idempotencyRef(db, actor.uid, PUBLISH_ACTION, input.idempotencyKey);

  return db.runTransaction(async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    const priorResult = completedIdempotencyResult(
      requestSnap,
      actor.uid,
      PUBLISH_ACTION,
      requestFingerprint,
    );
    if (priorResult) return priorResult;

    const eligibility = await evaluateTransactionEligibility({
      transaction,
      db,
      actor,
      territoryFips: input.territoryFips,
      orgId: input.orgId,
      requireVerification: true,
      requirePlan: true,
      adminOverrideReason: input.adminOverrideReason,
    });
    if (!eligibility.result.allowed) throwEligibilityFailure(eligibility.result);

    const territoryCentroid = asRecord(eligibility.territory?.centroid);
    const hasAuthoritativeCentroid = isFiniteNumber(territoryCentroid.lat)
      && territoryCentroid.lat >= -90
      && territoryCentroid.lat <= 90
      && isFiniteNumber(territoryCentroid.lng)
      && territoryCentroid.lng >= -180
      && territoryCentroid.lng <= 180;
    if (!hasAuthoritativeCentroid && !(actor.isAdmin && input.adminOverrideReason)) {
      throw new HttpsError(
        "failed-precondition",
        "The transaction territory does not have verified map coordinates",
        { reasonCode: "TERRITORY_COORDINATES_UNVERIFIED" },
      );
    }
    // Ordinary publishers cannot pair a released FIPS code with arbitrary map
    // coordinates. Unknown-territory coordinates are accepted only through the
    // existing explicit, audited administrator override path.
    const geoLat = hasAuthoritativeCentroid ? territoryCentroid.lat as number : input.geoLat;
    const geoLng = hasAuthoritativeCentroid ? territoryCentroid.lng as number : input.geoLng;

    let creditCost = 0;
    let activeUsage: Awaited<ReturnType<typeof readActiveRfxUsage>> | undefined;
    if (!actor.isAdmin) {
      const tier = requireActiveMembership(eligibility.user, now);
      activeUsage = await readActiveRfxUsage(transaction, db, actor.uid, input.orgId);
      if (activeUsage.activeCount >= tier.limits.rfxActivePosts) {
        creditCost = CREDIT_COSTS.RFX_PUBLISH;
        const currentCredits = isFiniteNumber(eligibility.user?.credits)
          ? eligibility.user.credits
          : 0;
        if (currentCredits < creditCost) {
          throw new HttpsError(
            "resource-exhausted",
            `Publishing requires ${creditCost} credits after the active RFx limit is reached`,
            { reasonCode: "INSUFFICIENT_CREDITS" },
          );
        }
      }
    }

    const status = actor.isAdmin ? "open" : "under_review";
    const approvalStatus = actor.isAdmin ? "approved" : "pending";
    const rfxDocument: RecordData = {
      id: rfxRef.id,
      schemaVersion: RFx_SCHEMA_VERSION,
      version: 1,
      ownerUid: actor.uid,
      createdBy: actor.uid,
      title: input.title,
      description: input.description,
      territoryFips: input.territoryFips,
      geo: {
        lat: geoLat,
        lng: geoLng,
        geohash: encodeGeohash(geoLat, geoLng),
        source: hasAuthoritativeCentroid ? "territory_centroid" : "admin_override",
      },
      memberOnly: input.memberOnly,
      visibility: input.memberOnly ? "members" : "public",
      evaluationCriteria: input.evaluationCriteria,
      requestedDocuments: input.requestedDocuments,
      status,
      adminApprovalStatus: approvalStatus,
      responseCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    setDefined(rfxDocument, "orgId", input.orgId);
    setDefined(rfxDocument, "createdByName", stringValue(eligibility.user?.displayName));
    setDefined(rfxDocument, "naicsCodes", input.naicsCodes);
    setDefined(rfxDocument, "location", input.location);
    setDefined(rfxDocument, "dueDate", input.dueDate);
    setDefined(rfxDocument, "budget", input.budget);
    setDefined(rfxDocument, "template", input.template);
    if (actor.isAdmin) {
      rfxDocument.approvedAt = now;
      rfxDocument.approvedBy = actor.uid;
    }

    transaction.create(rfxRef, rfxDocument);
    if (activeUsage) {
      writeActiveRfxUsage(
        transaction,
        activeUsage,
        activeUsage.activeCount + 1,
        now,
      );
    }

    if (creditCost > 0) {
      const currentCredits = eligibility.user?.credits as number;
      transaction.update(db.collection("users").doc(actor.uid), {
        credits: currentCredits - creditCost,
        updatedAt: now,
      });
      const creditRef = db.collection("creditTransactions").doc(`${rfxRef.id}_rfx_publish`);
      transaction.create(creditRef, {
        id: creditRef.id,
        userId: actor.uid,
        amount: -creditCost,
        type: "usage",
        referenceId: rfxRef.id,
        description: "Publish RFx beyond active plan limit",
        createdAt: now,
      });
    }

    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_created",
      entityType: "rfx",
      entityId: rfxRef.id,
      orgId: input.orgId,
      newStatus: status,
      metadata: {
        approvalStatus,
        creditCost,
        territoryOverride: Boolean(input.adminOverrideReason),
        ...(input.adminOverrideReason ? { adminOverrideReason: input.adminOverrideReason } : {}),
      },
      createdAt: now,
    });

    const result = {
      id: rfxRef.id,
      status,
      adminApprovalStatus: approvalStatus,
      version: 1,
      creditCost,
    };
    setCompletedIdempotency(transaction, requestRef, {
      uid: actor.uid,
      action: PUBLISH_ACTION,
      entityId: rfxRef.id,
      result,
      requestFingerprint,
      createdAt: now,
    });
    return result;
  });
});

/** Update only owner-controlled, non-live RFx fields with optimistic concurrency. */
export const rfx_update = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxUpdateInputSchema, request.data);
  if (input.dueDate !== undefined && input.dueDate <= Date.now()) {
    throw new HttpsError("invalid-argument", "Due date must be in the future");
  }
  if (input.evaluationCriteria) requireValidCriteria(input.evaluationCriteria);
  if (input.requestedDocuments) requireUniqueIds(input.requestedDocuments, "Requested document");

  const db = getDb();
  const now = Date.now();
  const ref = db.collection("rfx").doc(input.rfxId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "RFx not found");
    const rfx = asRecord(snapshot.data());
    await requireRfxManager(transaction, db, actor, rfx);
    const currentVersion = assertExpectedVersion(rfx, input.expectedVersion, "RFx");

    const status = rfxStatus(rfx);
    if (status !== "draft" && status !== "under_review") {
      throw new HttpsError("failed-precondition", "Only draft or under-review RFx may be edited");
    }

    const patch: RecordData = {};
    setDefined(patch, "title", input.title);
    setDefined(patch, "description", input.description);
    setDefined(patch, "naicsCodes", input.naicsCodes);
    setDefined(patch, "location", input.location);
    setDefined(patch, "dueDate", input.dueDate);
    setDefined(patch, "budget", input.budget);
    setDefined(patch, "memberOnly", input.memberOnly);
    if (input.memberOnly !== undefined) {
      patch.visibility = input.memberOnly ? "members" : "public";
    }
    setDefined(patch, "evaluationCriteria", input.evaluationCriteria);
    setDefined(patch, "requestedDocuments", input.requestedDocuments);
    patch.version = currentVersion + 1;
    patch.updatedAt = now;
    transaction.update(ref, patch);

    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_updated",
      entityType: "rfx",
      entityId: input.rfxId,
      orgId: stringValue(rfx.orgId),
      previousStatus: stringValue(rfx.status),
      newStatus: stringValue(rfx.status),
      metadata: {
        fields: Object.keys(patch).filter((field) => !["version", "updatedAt"].includes(field)).sort().join(","),
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
      },
      createdAt: now,
    });
    return { id: input.rfxId, status: stringValue(rfx.status) ?? status, version: currentVersion + 1 };
  });
});

/** Approve or reject an RFx using claim-backed administrator authority. */
export const rfx_moderate = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  requireAdmin(actor);
  const input = parseCallableInput(rfxModerateInputSchema, request.data);
  const db = getDb();
  const now = Date.now();
  const ref = db.collection("rfx").doc(input.rfxId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "RFx not found");
    const rfx = asRecord(snapshot.data());
    const rfxOrgId = requireValidRfxOrganizationId(rfx);
    const currentVersion = assertExpectedVersion(rfx, input.expectedVersion, "RFx");
    if (rfxStatus(rfx) !== "under_review") {
      throw new HttpsError("failed-precondition", "Only under-review RFx may be moderated");
    }

    if (input.decision === "approve") {
      const territoryFips = stringValue(rfx.territoryFips);
      if (!territoryFips) {
        throw new HttpsError("failed-precondition", "RFx territory is unavailable");
      }
      const territorySnap = await transaction.get(db.collection("territories").doc(territoryFips));
      if (!territorySnap.exists || territorySnap.data()?.status !== "released") {
        throw new HttpsError("failed-precondition", "RFx territory is not released");
      }
      if (isFiniteNumber(rfx.dueDate) && rfx.dueDate <= now) {
        throw new HttpsError("failed-precondition", "An expired RFx cannot be approved");
      }
    }

    const approved = input.decision === "approve";
    const nextStatus = approved ? "open" : "rejected";
    const nextApprovalStatus = approved ? "approved" : "rejected";
    const ownerUid = rfxOwnerUid(rfx);
    const activeUsage = !approved && ownerUid
      ? await readActiveRfxUsage(transaction, db, ownerUid, rfxOrgId)
      : undefined;
    const update: RecordData = {
      status: nextStatus,
      adminApprovalStatus: nextApprovalStatus,
      adminReviewNote: input.reviewNote,
      reviewedBy: actor.uid,
      reviewedAt: now,
      version: currentVersion + 1,
      updatedAt: now,
    };
    if (approved) {
      update.approvedBy = actor.uid;
      update.approvedAt = now;
    } else {
      update.rejectedBy = actor.uid;
      update.rejectedAt = now;
    }
    transaction.update(ref, update);
    if (activeUsage && ownerUid) {
      writeActiveRfxUsage(
        transaction,
        activeUsage,
        activeUsage.activeCount - 1,
        now,
      );
    }

    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: approved ? "rfx_approved" : "rfx_rejected",
      entityType: "rfx",
      entityId: input.rfxId,
      orgId: stringValue(rfx.orgId),
      previousStatus: stringValue(rfx.status) ?? "under_review",
      newStatus: nextStatus,
      metadata: {
        reviewNote: input.reviewNote,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
      },
      createdAt: now,
    });
    return {
      id: input.rfxId,
      status: nextStatus,
      adminApprovalStatus: nextApprovalStatus,
      version: currentVersion + 1,
    };
  });
});

/** Cancel an RFx through an owner, organization manager, or administrator. */
export const rfx_cancel = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxCancelInputSchema, request.data);
  if (input.adminOverrideReason && !actor.isAdmin) {
    throw new HttpsError("permission-denied", "Only administrators may provide an override reason");
  }
  const db = getDb();
  const now = Date.now();
  const ref = db.collection("rfx").doc(input.rfxId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "RFx not found");
    const rfx = asRecord(snapshot.data());
    await requireRfxManager(transaction, db, actor, rfx);
    const rfxOrgId = requireValidRfxOrganizationId(rfx);
    const currentVersion = assertExpectedVersion(rfx, input.expectedVersion, "RFx");

    const currentStatus = rfxStatus(rfx);
    const normallyCancellable = new Set(["draft", "under_review", "open", "closed"]);
    const awardOverride = currentStatus === "awarded"
      && actor.isAdmin
      && Boolean(input.adminOverrideReason);
    if (!normallyCancellable.has(currentStatus) && !awardOverride) {
      throw new HttpsError("failed-precondition", "RFx cannot be cancelled from its current status");
    }

    const ownerUid = rfxOwnerUid(rfx);
    const wasActive = currentStatus === "under_review" || currentStatus === "open";
    const activeUsage = wasActive && ownerUid
      ? await readActiveRfxUsage(transaction, db, ownerUid, rfxOrgId)
      : undefined;

    const awardedResponsesSnap = awardOverride
      ? await transaction.get(db.collection("rfxResponses").where("rfxId", "==", input.rfxId))
      : undefined;
    const acceptedResponses = awardedResponsesSnap?.docs.filter((doc) => (
      responseStatus(asRecord(doc.data())) === "accepted"
    )) ?? [];
    if (awardOverride) {
      if (
        acceptedResponses.length !== 1
        || acceptedResponses[0].id !== stringValue(rfx.awardedResponseId)
      ) {
        throw new HttpsError("failed-precondition", "Awarded RFx response state is inconsistent");
      }
    }

    const update: RecordData = {
      status: "cancelled",
      cancellationReason: input.reason,
      cancelledBy: actor.uid,
      cancelledAt: now,
      version: currentVersion + 1,
      updatedAt: now,
    };
    if (awardOverride) {
      update.previousAwardedResponseId = rfx.awardedResponseId;
      update.awardedResponseId = FieldValue.delete();
      update.awardedBy = FieldValue.delete();
      update.awardedAt = FieldValue.delete();
    }
    transaction.update(ref, update);
    if (activeUsage && ownerUid) {
      writeActiveRfxUsage(
        transaction,
        activeUsage,
        activeUsage.activeCount - 1,
        now,
      );
    }
    for (const acceptedResponse of acceptedResponses) {
      const response = asRecord(acceptedResponse.data());
      transaction.update(acceptedResponse.ref, {
        status: "declined",
        awardRevokedBy: actor.uid,
        awardRevokedAt: now,
        version: documentVersion(response) + 1,
        updatedAt: now,
      });
      writeExchangeAudit(transaction, db, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "rfx_response_award_revoked",
        entityType: "rfxResponse",
        entityId: acceptedResponse.id,
        orgId: stringValue(rfx.orgId),
        previousStatus: "accepted",
        newStatus: "declined",
        metadata: { rfxId: input.rfxId, cancellationReason: input.reason },
        createdAt: now,
      });
    }
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_cancelled",
      entityType: "rfx",
      entityId: input.rfxId,
      orgId: stringValue(rfx.orgId),
      previousStatus: stringValue(rfx.status) ?? currentStatus,
      newStatus: "cancelled",
      metadata: {
        reason: input.reason,
        awardOverride,
        previousVersion: currentVersion,
        newVersion: currentVersion + 1,
        ...(input.adminOverrideReason ? { adminOverrideReason: input.adminOverrideReason } : {}),
      },
      createdAt: now,
    });
    return { id: input.rfxId, status: "cancelled", version: currentVersion + 1 };
  });
});

/**
 * Issue a short-lived, path-bounded upload grant after applying the same
 * eligibility and conflict checks used by response submission.
 */
export const rfx_prepareResponseUploads = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxPrepareResponseUploadsInputSchema, request.data);
  const db = getDb();
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const responseAccessRef = db.collection("rfxResponseAccess")
    .doc(input.rfxId)
    .collection("respondents")
    .doc(actor.uid);
  const grantRef = responseUploadGrantRef(db, input.rfxId, actor.uid);

  return db.runTransaction(async (transaction) => {
    const [rfxSnapshot, responseAccessSnapshot, grantSnapshot, responseQuerySnapshot] = await Promise.all([
      transaction.get(rfxRef),
      transaction.get(responseAccessRef),
      transaction.get(grantRef),
      transaction.get(db.collection("rfxResponses").where("rfxId", "==", input.rfxId)),
    ]);
    if (!rfxSnapshot.exists) throw new HttpsError("not-found", "RFx not found");
    if (responseAccessSnapshot.exists) {
      throw new HttpsError("failed-precondition", "This response is already submitted");
    }
    const rfx = asRecord(rfxSnapshot.data());
    const issuerOrgId = requireValidRfxOrganizationId(rfx);
    const actorResponseAlreadyExists = responseQuerySnapshot.docs.some((document) => (
      responseSubmitterMatches(asRecord(document.data()), actor.uid)
    ));
    if (actorResponseAlreadyExists) {
      throw new HttpsError(
        "already-exists",
        "This submitter has already submitted for this RFx",
      );
    }
    const now = Date.now();
    if (rfxStatus(rfx) !== "open" || rfx.adminApprovalStatus !== "approved") {
      throw new HttpsError("failed-precondition", "RFx is not open and approved for responses");
    }
    if (isFiniteNumber(rfx.dueDate) && rfx.dueDate <= now) {
      throw new HttpsError("failed-precondition", "The RFx response deadline has passed");
    }
    const territoryFips = stringValue(rfx.territoryFips);
    if (!territoryFips) throw new HttpsError("failed-precondition", "RFx territory is unavailable");
    const ownerUid = rfxOwnerUid(rfx);
    if (!ownerUid) throw new HttpsError("failed-precondition", "RFx ownership is unavailable");
    if (ownerUid === actor.uid) {
      throw new HttpsError("permission-denied", "RFx owners cannot respond to their own RFx");
    }
    if (issuerOrgId && issuerOrgId === input.orgId) {
      throw new HttpsError("permission-denied", "The issuing organization cannot respond to its own RFx");
    }

    const eligibility = await evaluateTransactionEligibility({
      transaction,
      db,
      actor,
      territoryFips,
      orgId: input.orgId,
      requireVerification: true,
      requirePlan: true,
    });
    if (!eligibility.result.allowed) throwEligibilityFailure(eligibility.result);
    if (!actor.isAdmin) requireActiveMembership(eligibility.user, now);
    const subjectResponseAlreadyExists = responseQuerySnapshot.docs.some((document) => (
      responseSubjectMatches(asRecord(document.data()), actor.uid, input.orgId)
    ));
    if (subjectResponseAlreadyExists) {
      throw new HttpsError(
        "already-exists",
        "This response subject has already submitted for this RFx",
      );
    }

    if (issuerOrgId) {
      const issuerMembership = await transaction.get(
        db.collection("orgMembers").doc(`${issuerOrgId}_${actor.uid}`),
      );
      const member = asRecord(issuerMembership.data());
      if (issuerMembership.exists && member.orgId === issuerOrgId && member.uid === actor.uid) {
        throw new HttpsError("permission-denied", "Members of the issuing organization cannot respond");
      }
    }

    const requestedPaths = input.attachments.map((attachment) => {
      requireCanonicalStoragePath(attachment.storagePath, input.rfxId, actor.uid);
      if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(attachment.contentType.toLowerCase())) {
        throw new HttpsError("invalid-argument", "Attachment content type is not allowed");
      }
      return attachment.storagePath;
    });
    if (new Set(requestedPaths).size !== requestedPaths.length) {
      throw new HttpsError("invalid-argument", "Upload grant paths must be unique");
    }

    const existing = asRecord(grantSnapshot.data());
    const existingExpiresAt = isFiniteNumber(existing.expiresAt) ? existing.expiresAt : 0;
    const existingPaths = grantSnapshot.exists
      && existing.rfxId === input.rfxId
      && existing.respondentUid === actor.uid
      && existingExpiresAt > now
      && Array.isArray(existing.allowedStoragePaths)
      ? existing.allowedStoragePaths.filter((path): path is string => typeof path === "string")
      : [];
    const allowedStoragePaths = [...new Set([...existingPaths, ...requestedPaths])];
    if (allowedStoragePaths.length > MAX_UPLOAD_GRANT_PATHS) {
      throw new HttpsError("resource-exhausted", "A response may prepare at most 26 attachment paths");
    }
    const expiresAt = existingPaths.length > 0
      ? existingExpiresAt
      : now + RESPONSE_UPLOAD_GRANT_TTL_MS;

    transaction.set(grantRef, {
      id: actor.uid,
      grantType: "rfx_response_upload",
      rfxId: input.rfxId,
      respondentUid: actor.uid,
      ...(input.orgId ? { respondentOrgId: input.orgId } : {}),
      allowedStoragePaths,
      createdAt: existingPaths.length > 0 && isFiniteNumber(existing.createdAt)
        ? existing.createdAt
        : now,
      updatedAt: now,
      expiresAt,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_response_upload_grant_prepared",
      entityType: "rfx",
      entityId: input.rfxId,
      metadata: { pathCount: allowedStoragePaths.length },
      createdAt: now,
    });
    return { success: true, expiresAt, allowedPathCount: allowedStoragePaths.length };
  });
});

/**
 * Issue a one-minute, exact-path read grant. Storage Rules consume only this
 * materialized decision, keeping their Firestore access budget bounded while
 * this callable evaluates current user, organization, and RFx authority.
 */
export const rfx_prepareResponseDownload = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxPrepareResponseDownloadInputSchema, request.data);
  requireReferencedResponseStoragePath(input.storagePath, input.rfxId, input.respondentUid);

  const db = getDb();
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const responseAccessRef = db.collection("rfxResponseAccess")
    .doc(input.rfxId)
    .collection("respondents")
    .doc(input.respondentUid);
  const grantRef = responseReadGrantRef(db, input.rfxId, actor.uid);

  return db.runTransaction(async (transaction) => {
    const [rfxSnapshot, responseAccessSnapshot] = await Promise.all([
      transaction.get(rfxRef),
      transaction.get(responseAccessRef),
    ]);
    if (!rfxSnapshot.exists) throw new HttpsError("not-found", "RFx not found");
    if (!responseAccessSnapshot.exists) {
      throw new HttpsError("permission-denied", RESPONSE_FILE_ACCESS_DENIED);
    }

    const rfx = asRecord(rfxSnapshot.data());
    requireValidRfxOrganizationId(rfx);
    const responseAccess = asRecord(responseAccessSnapshot.data());
    const paths = Array.isArray(responseAccess.attachmentStoragePaths)
      ? responseAccess.attachmentStoragePaths.filter(
        (path): path is string => typeof path === "string",
      )
      : [];
    if (
      responseAccess.rfxId !== input.rfxId
      || responseAccess.respondentUid !== input.respondentUid
      || (responseAccess.id !== undefined && responseAccess.id !== input.respondentUid)
      || !paths.includes(input.storagePath)
    ) {
      throw new HttpsError("permission-denied", RESPONSE_FILE_ACCESS_DENIED);
    }

    let authorized = actor.isAdmin || actor.role === "staff";
    const respondentOrgId = requireValidResponseAccessOrganizationId(responseAccess);
    if (!authorized) {
      authorized = respondentOrgId
        ? await hasActiveOrgAuthority(transaction, db, respondentOrgId, actor.uid)
        : input.respondentUid === actor.uid;
    }
    if (!authorized) {
      try {
        await requireRfxManager(transaction, db, actor, rfx);
        authorized = true;
      } catch (error) {
        if (!(error instanceof HttpsError) || error.code !== "permission-denied") throw error;
      }
    }
    if (!authorized) {
      throw new HttpsError("permission-denied", RESPONSE_FILE_ACCESS_DENIED);
    }

    const now = Date.now();
    const expiresAt = now + RESPONSE_READ_GRANT_TTL_MS;
    transaction.set(grantRef, {
      id: actor.uid,
      grantType: "rfx_response_read",
      rfxId: input.rfxId,
      accessorUid: actor.uid,
      allowedStoragePaths: [input.storagePath],
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_response_read_grant_prepared",
      entityType: "rfxResponse",
      entityId: stringValue(responseAccess.responseId) ?? input.respondentUid,
      orgId: stringValue(rfx.orgId),
      metadata: { rfxId: input.rfxId, storagePath: input.storagePath },
      createdAt: now,
    });
    return { success: true, expiresAt, storagePath: input.storagePath };
  });
});

/** Submit one immutable response per RFx and authenticated submitter UID. */
export const rfx_submitResponse = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxSubmitResponseInputSchema, request.data);
  const requestFingerprint = fingerprintRequest(input);
  const db = getDb();
  const responseId = deterministicResponseId(input.rfxId, actor.uid, input.orgId);
  const respondentSubject = responseSubjectKey(actor.uid, input.orgId);
  const responseRef = db.collection("rfxResponses").doc(responseId);
  const responseAccessRef = db.collection("rfxResponseAccess")
    .doc(input.rfxId)
    .collection("respondents")
    .doc(actor.uid);
  const requestRef = idempotencyRef(db, actor.uid, SUBMIT_RESPONSE_ACTION, input.idempotencyKey);
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const grantRef = responseUploadGrantRef(db, input.rfxId, actor.uid);
  const requestedAttachmentPaths = [
    ...(input.proposalStoragePath ? [input.proposalStoragePath] : []),
    ...input.uploadedDocuments.map((document) => document.storagePath),
  ];

  const [preflightRequestSnap, preflightRfxSnap] = await Promise.all([
    requestRef.get(),
    rfxRef.get(),
  ]);
  const preflightResult = completedIdempotencyResult(
    preflightRequestSnap,
    actor.uid,
    SUBMIT_RESPONSE_ACTION,
    requestFingerprint,
  );
  if (preflightResult) {
    assertResponseIdempotencyResult(
      preflightResult,
      input.rfxId,
      responseId,
      respondentSubject,
    );
    return preflightResult;
  }
  if (!preflightRfxSnap.exists) throw new HttpsError("not-found", "RFx not found");
  validateResponseAttachments(input, asRecord(preflightRfxSnap.data()), input.rfxId, actor.uid);
  await validateStoredResponseAttachments(input, input.rfxId, actor.uid);

  return db.runTransaction(async (transaction) => {
    const transactionStartedAt = Date.now();
    const requestSnap = await transaction.get(requestRef);
    const priorResult = completedIdempotencyResult(
      requestSnap,
      actor.uid,
      SUBMIT_RESPONSE_ACTION,
      requestFingerprint,
    );
    if (priorResult) {
      assertResponseIdempotencyResult(
        priorResult,
        input.rfxId,
        responseId,
        respondentSubject,
      );
      return priorResult;
    }

    const rfxSnap = await transaction.get(rfxRef);
    if (!rfxSnap.exists) throw new HttpsError("not-found", "RFx not found");
    const rfx = asRecord(rfxSnap.data());
    const issuerOrgId = requireValidRfxOrganizationId(rfx);
    if (rfxStatus(rfx) !== "open" || rfx.adminApprovalStatus !== "approved") {
      throw new HttpsError("failed-precondition", "RFx is not open and approved for responses");
    }
    if (isFiniteNumber(rfx.dueDate) && rfx.dueDate <= transactionStartedAt) {
      throw new HttpsError("failed-precondition", "The RFx response deadline has passed");
    }
    const territoryFips = stringValue(rfx.territoryFips);
    if (!territoryFips) {
      throw new HttpsError("failed-precondition", "RFx territory is unavailable");
    }

    const ownerUid = rfxOwnerUid(rfx);
    if (!ownerUid) throw new HttpsError("failed-precondition", "RFx ownership is unavailable");
    if (ownerUid === actor.uid) {
      throw new HttpsError("permission-denied", "RFx owners cannot respond to their own RFx");
    }
    if (issuerOrgId && issuerOrgId === input.orgId) {
      throw new HttpsError("permission-denied", "The issuing organization cannot respond to its own RFx");
    }

    const eligibility = await evaluateTransactionEligibility({
      transaction,
      db,
      actor,
      territoryFips,
      orgId: input.orgId,
      requireVerification: true,
      requirePlan: true,
    });
    if (!eligibility.result.allowed) throwEligibilityFailure(eligibility.result);
    if (!actor.isAdmin) requireActiveMembership(eligibility.user, transactionStartedAt);

    if (issuerOrgId) {
      const issuerMembership = await transaction.get(
        db.collection("orgMembers").doc(`${issuerOrgId}_${actor.uid}`),
      );
      const member = asRecord(issuerMembership.data());
      if (
        issuerMembership.exists
        && member.orgId === issuerOrgId
        && member.uid === actor.uid
      ) {
        throw new HttpsError("permission-denied", "Members of the issuing organization cannot respond");
      }
    }

    validateResponseAttachments(input, rfx, input.rfxId, actor.uid);

    const [responseQuerySnap, grantSnapshot, responseAccessSnapshot] = await Promise.all([
      transaction.get(db.collection("rfxResponses").where("rfxId", "==", input.rfxId)),
      transaction.get(grantRef),
      transaction.get(responseAccessRef),
    ]);
    const actorResponses = responseQuerySnap.docs.filter((doc) => (
      responseSubmitterMatches(asRecord(doc.data()), actor.uid)
    ));
    if (actorResponses.length > 1) {
      throw new HttpsError(
        "failed-precondition",
        "Multiple responses for this submitter require administrative review",
      );
    }
    const existing = actorResponses[0];
    if (existing) {
      const existingData = asRecord(existing.data());
      const existingResponseOrgId = requireValidResponseOrganizationId(existingData);
      if (
        !responseSubjectMatches(existingData, actor.uid, input.orgId)
        || existingData.idempotencyKey !== input.idempotencyKey
      ) {
        throw new HttpsError(
          "already-exists",
          "This submitter has already submitted a response for this RFx",
        );
      }
      if (
        responseAccessSnapshot.exists
        && stringValue(asRecord(responseAccessSnapshot.data()).responseId) !== existing.id
      ) {
        throw new HttpsError(
          "failed-precondition",
          "The response access marker requires administrative review",
        );
      }
      const existingResult = {
        id: existing.id,
        rfxId: input.rfxId,
        respondentSubject,
        status: stringValue(existingData.status) ?? "pending",
        version: documentVersion(existingData),
      };
      setCompletedIdempotency(transaction, requestRef, {
        uid: actor.uid,
        action: SUBMIT_RESPONSE_ACTION,
        entityId: existing.id,
        result: existingResult,
        requestFingerprint,
        createdAt: transactionStartedAt,
      });
      transaction.set(responseAccessRef, {
        id: actor.uid,
        rfxId: input.rfxId,
        respondentUid: actor.uid,
        responseId: existing.id,
        attachmentStoragePaths: submittedAttachmentStoragePaths(existingData),
        ...(existingResponseOrgId
          ? { respondentOrgId: existingResponseOrgId }
          : {}),
        submittedAt: existingData.submittedAt ?? transactionStartedAt,
      });
      if (grantSnapshot.exists) transaction.delete(grantRef);
      return existingResult;
    }
    const existingSubjectResponse = responseQuerySnap.docs.find((document) => (
      responseSubjectMatches(asRecord(document.data()), actor.uid, input.orgId)
    ));
    if (existingSubjectResponse) {
      throw new HttpsError(
        "already-exists",
        "This response subject has already submitted a response for this RFx",
      );
    }
    if (responseAccessSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "The response access marker requires administrative review",
      );
    }
    if (responseQuerySnap.size >= MAX_RESPONSES_PER_RFX) {
      throw new HttpsError(
        "resource-exhausted",
        "This RFx has reached its response capacity",
      );
    }

    // Re-evaluate immediately before staging the immutable write. Metadata
    // validation and transaction reads must not extend a response past its
    // deadline, and retries execute this check with a fresh clock value.
    const submittedAt = Date.now();
    if (isFiniteNumber(rfx.dueDate) && rfx.dueDate <= submittedAt) {
      throw new HttpsError("failed-precondition", "The RFx response deadline has passed");
    }
    if (requestedAttachmentPaths.length > 0) {
      const grant = asRecord(grantSnapshot.data());
      const allowedStoragePaths = Array.isArray(grant.allowedStoragePaths)
        ? grant.allowedStoragePaths.filter((path): path is string => typeof path === "string")
        : [];
      if (
        !grantSnapshot.exists
        || grant.grantType !== "rfx_response_upload"
        || grant.rfxId !== input.rfxId
        || grant.respondentUid !== actor.uid
        || !isFiniteNumber(grant.expiresAt)
        || grant.expiresAt <= submittedAt
        || requestedAttachmentPaths.some((path) => !allowedStoragePaths.includes(path))
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Attachments require a current path-bounded upload grant",
        );
      }
    }

    const responseDocument: RecordData = {
      id: responseId,
      schemaVersion: RESPONSE_SCHEMA_VERSION,
      version: 1,
      rfxId: input.rfxId,
      rfxOwnerUid: ownerUid,
      respondentUid: actor.uid,
      createdBy: actor.uid,
      status: "submitted",
      idempotencyKey: input.idempotencyKey,
      uploadedDocuments: input.uploadedDocuments,
      submittedAt,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    };
    setDefined(responseDocument, "respondentOrgId", input.orgId);
    setDefined(responseDocument, "respondentName", stringValue(eligibility.user?.displayName));
    setDefined(responseDocument, "respondentBusinessName", stringValue(eligibility.profile?.businessName));
    setDefined(responseDocument, "bidAmount", input.bidAmount);
    setDefined(responseDocument, "experience", input.experience);
    setDefined(responseDocument, "timeline", input.timeline);
    setDefined(responseDocument, "skills", input.skills);
    setDefined(responseDocument, "pastPerformance", input.pastPerformance);
    setDefined(responseDocument, "credentials", input.credentials);
    setDefined(responseDocument, "references", input.references);
    setDefined(responseDocument, "proposalText", input.proposalText);
    setDefined(responseDocument, "proposalStoragePath", input.proposalStoragePath);

    transaction.create(responseRef, responseDocument);
    transaction.create(responseAccessRef, {
      id: actor.uid,
      rfxId: input.rfxId,
      respondentUid: actor.uid,
      responseId,
      attachmentStoragePaths: submittedAttachmentStoragePaths(responseDocument),
      ...(input.orgId ? { respondentOrgId: input.orgId } : {}),
      submittedAt,
    });
    if (grantSnapshot.exists) transaction.delete(grantRef);
    transaction.update(rfxRef, {
      responseCount: FieldValue.increment(1),
      updatedAt: submittedAt,
    });
    transaction.set(db.collection("exchangeUsage").doc(actor.uid), {
      uid: actor.uid,
      schemaVersion: 1,
      rfxResponsesSubmitted: FieldValue.increment(1),
      lastRfxResponseAt: submittedAt,
      updatedAt: submittedAt,
    }, { merge: true });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_response_submitted",
      entityType: "rfxResponse",
      entityId: responseId,
      orgId: input.orgId,
      newStatus: "submitted",
      metadata: {
        rfxId: input.rfxId,
        attachmentCount: input.uploadedDocuments.length + (input.proposalStoragePath ? 1 : 0),
        organizationResponse: Boolean(input.orgId),
      },
      createdAt: submittedAt,
    });

    const result = {
      id: responseId,
      rfxId: input.rfxId,
      respondentSubject,
      status: "submitted",
      version: 1,
    };
    setCompletedIdempotency(transaction, requestRef, {
      uid: actor.uid,
      action: SUBMIT_RESPONSE_ACTION,
      entityId: responseId,
      result,
      requestFingerprint,
      createdAt: submittedAt,
    });
    return result;
  });
});

export async function cleanupExpiredResponseUploadGrantAt(
  grantRef: FirebaseFirestore.DocumentReference,
  now: number,
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const grantSnapshot = await transaction.get(grantRef);
    if (!grantSnapshot.exists) return false;
    const grant = asRecord(grantSnapshot.data());
    if (
      grant.grantType !== "rfx_response_upload"
      || !isFiniteNumber(grant.expiresAt)
      || grant.expiresAt > now
    ) return false;
    transaction.delete(grantRef);
    return true;
  });
}

export async function cleanupExpiredResponseReadGrantAt(
  grantRef: FirebaseFirestore.DocumentReference,
  now: number,
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(grantRef);
    if (!currentSnapshot.exists) return false;
    const current = asRecord(currentSnapshot.data());
    if (
      current.grantType !== "rfx_response_read"
      || !isFiniteNumber(current.expiresAt)
      || current.expiresAt > now
    ) return false;
    transaction.delete(grantRef);
    return true;
  });
}

/** Removes expired upload/read grants without racing a refreshed or submitted object. */
export const rfx_cleanupResponseUploadGrants = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getDb();
    const now = Date.now();
    const snapshot = await db.collectionGroup("uploadGrants")
      .where("grantType", "==", "rfx_response_upload")
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt", "asc")
      .limit(MAX_UPLOAD_GRANT_CLEANUPS)
      .get();
    const outcomes = await Promise.all(
      snapshot.docs.map((document) => cleanupExpiredResponseUploadGrantAt(document.ref, now, db)),
    );
    const readGrantSnapshot = await db.collectionGroup("readGrants")
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt", "asc")
      .limit(MAX_UPLOAD_GRANT_CLEANUPS)
      .get();
    const readGrantOutcomes = await Promise.all(
      readGrantSnapshot.docs.map((document) => (
        cleanupExpiredResponseReadGrantAt(document.ref, now, db)
      )),
    );
    logger.info("RFx response storage grant cleanup completed", {
      scanned: snapshot.size,
      removed: outcomes.filter(Boolean).length,
      readGrantsScanned: readGrantSnapshot.size,
      readGrantsRemoved: readGrantOutcomes.filter(Boolean).length,
    });
  },
);

/** Evaluate a response and atomically enforce a single RFx winner. */
export const rfx_evaluateResponse = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxEvaluateResponseInputSchema, request.data);
  const db = getDb();
  const now = Date.now();
  const responseRef = db.collection("rfxResponses").doc(input.responseId);

  return db.runTransaction(async (transaction) => {
    const responseSnap = await transaction.get(responseRef);
    if (!responseSnap.exists) throw new HttpsError("not-found", "RFx response not found");
    const response = asRecord(responseSnap.data());
    const rfxId = stringValue(response.rfxId);
    if (!rfxId) throw new HttpsError("failed-precondition", "Response RFx reference is unavailable");
    const rfxRef = db.collection("rfx").doc(rfxId);
    const rfxSnap = await transaction.get(rfxRef);
    if (!rfxSnap.exists) throw new HttpsError("not-found", "RFx not found");
    const rfx = asRecord(rfxSnap.data());

    await requireRfxManager(transaction, db, actor, rfx, { allowStaff: true });
    const issuerOrgId = requireValidRfxOrganizationId(rfx);
    const respondentUid = stringValue(response.respondentUid) ?? stringValue(response.createdBy);
    const respondentOrgId = requireValidResponseOrganizationId(response);
    if (respondentUid === actor.uid) {
      throw new HttpsError("permission-denied", "Respondents cannot evaluate their own response");
    }
    if (respondentOrgId && respondentOrgId === issuerOrgId) {
      throw new HttpsError("failed-precondition", "The issuing organization cannot evaluate a self-response");
    }
    if (respondentOrgId) {
      const evaluatorMembership = await transaction.get(
        db.collection("orgMembers").doc(`${respondentOrgId}_${actor.uid}`),
      );
      const membership = asRecord(evaluatorMembership.data());
      if (
        evaluatorMembership.exists
        && membership.orgId === respondentOrgId
        && membership.uid === actor.uid
      ) {
        throw new HttpsError(
          "permission-denied",
          "Members of the responding organization cannot evaluate its response",
        );
      }
    }
    const currentRfxVersion = documentVersion(rfx);
    const currentResponseStatus = responseStatus(response);
    const scoreResult = computeWeightedScore(
      rfx,
      input.criteriaScores,
      input.transition === "accepted",
    );

    if (input.transition === "accepted"
      && currentResponseStatus === "accepted"
      && rfx.status === "awarded"
      && rfx.awardedResponseId === input.responseId
      && evaluationMatches(response, scoreResult.criteriaScores, input.evaluationNotes)) {
      return {
        id: input.responseId,
        rfxId,
        status: "accepted",
        totalScore: isFiniteNumber(response.totalScore)
          ? response.totalScore
          : scoreResult.totalScore,
        version: documentVersion(response),
        rfxStatus: "awarded",
        rfxVersion: currentRfxVersion,
      };
    }

    if (
      input.transition === currentResponseStatus
      && input.transition !== "accepted"
      && evaluationMatches(response, scoreResult.criteriaScores, input.evaluationNotes)
    ) {
      return {
        id: input.responseId,
        rfxId,
        status: currentResponseStatus,
        totalScore: isFiniteNumber(response.totalScore)
          ? response.totalScore
          : scoreResult.totalScore,
        version: documentVersion(response),
        rfxStatus: stringValue(rfx.status) ?? rfxStatus(rfx),
        rfxVersion: currentRfxVersion,
      };
    }

    if (
      input.expectedRfxVersion !== undefined
      && input.expectedRfxVersion !== currentRfxVersion
    ) {
      throw new HttpsError("aborted", "RFx was changed by another request", {
        expectedVersion: input.expectedRfxVersion,
        currentVersion: currentRfxVersion,
      });
    }

    const activeResponseStatuses = new Set(["submitted", "under_review"]);
    if (!activeResponseStatuses.has(currentResponseStatus)) {
      throw new HttpsError("failed-precondition", "Response is already in a terminal state");
    }
    const currentRfxStatus = rfxStatus(rfx);
    if (rfx.adminApprovalStatus !== "approved") {
      throw new HttpsError("failed-precondition", "RFx is not approved for evaluation");
    }
    if (currentRfxStatus !== "open" && currentRfxStatus !== "closed") {
      throw new HttpsError("failed-precondition", "RFx is not in an evaluable state");
    }

    const responseVersion = documentVersion(response);
    if (input.transition !== "accepted") {
      const update: RecordData = {
        status: input.transition,
        evaluatedBy: actor.uid,
        evaluatedAt: now,
        version: responseVersion + 1,
        updatedAt: now,
      };
      setDefined(update, "criteriaScores", scoreResult.criteriaScores);
      setDefined(update, "totalScore", scoreResult.totalScore);
      setDefined(update, "evaluationNotes", input.evaluationNotes);
      transaction.update(responseRef, update);
      writeExchangeAudit(transaction, db, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: input.transition === "under_review"
          ? "rfx_response_reviewed"
          : "rfx_response_declined",
        entityType: "rfxResponse",
        entityId: input.responseId,
        orgId: stringValue(rfx.orgId),
        previousStatus: stringValue(response.status) ?? "pending",
        newStatus: input.transition,
        metadata: {
          rfxId,
          totalScore: scoreResult.totalScore ?? null,
        },
        createdAt: now,
      });
      return {
        id: input.responseId,
        rfxId,
        status: input.transition,
        totalScore: scoreResult.totalScore,
        version: responseVersion + 1,
        rfxStatus: stringValue(rfx.status) ?? currentRfxStatus,
        rfxVersion: currentRfxVersion,
      };
    }

    const ownerUid = rfxOwnerUid(rfx);
    const activeUsage = currentRfxStatus === "open" && ownerUid
      ? await readActiveRfxUsage(transaction, db, ownerUid, issuerOrgId)
      : undefined;
    const responsesSnap = await transaction.get(
      db.collection("rfxResponses").where("rfxId", "==", rfxId),
    );
    if (responsesSnap.size > MAX_RESPONSES_PER_RFX) {
      throw new HttpsError(
        "failed-precondition",
        "This legacy RFx exceeds the safe award capacity and requires administrative review",
      );
    }
    const otherWinner = responsesSnap.docs.find((doc) => (
      doc.id !== input.responseId && responseStatus(asRecord(doc.data())) === "accepted"
    ));
    if (otherWinner) {
      throw new HttpsError("failed-precondition", "RFx already has an accepted response");
    }
    if (stringValue(rfx.awardedResponseId) && rfx.awardedResponseId !== input.responseId) {
      throw new HttpsError("failed-precondition", "RFx already has a different awarded response");
    }

    const selectedUpdate: RecordData = {
      status: "accepted",
      evaluatedBy: actor.uid,
      evaluatedAt: now,
      acceptedAt: now,
      version: responseVersion + 1,
      updatedAt: now,
    };
    setDefined(selectedUpdate, "criteriaScores", scoreResult.criteriaScores);
    setDefined(selectedUpdate, "totalScore", scoreResult.totalScore);
    setDefined(selectedUpdate, "evaluationNotes", input.evaluationNotes);
    transaction.update(responseRef, selectedUpdate);

    let declinedCompetitors = 0;
    for (const competitor of responsesSnap.docs) {
      if (competitor.id === input.responseId) continue;
      const competitorData = asRecord(competitor.data());
      const competitorStatus = responseStatus(competitorData);
      if (competitorStatus !== "submitted" && competitorStatus !== "under_review") continue;
      transaction.update(competitor.ref, {
        status: "declined",
        evaluatedBy: actor.uid,
        evaluatedAt: now,
        autoDeclinedOnAward: true,
        version: documentVersion(competitorData) + 1,
        updatedAt: now,
      });
      declinedCompetitors += 1;
    }

    transaction.update(rfxRef, {
      status: "awarded",
      awardedResponseId: input.responseId,
      awardedBy: actor.uid,
      awardedAt: now,
      version: currentRfxVersion + 1,
      updatedAt: now,
    });
    if (activeUsage && ownerUid) {
      writeActiveRfxUsage(
        transaction,
        activeUsage,
        activeUsage.activeCount - 1,
        now,
      );
    }
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_response_accepted",
      entityType: "rfxResponse",
      entityId: input.responseId,
      orgId: stringValue(rfx.orgId),
      previousStatus: stringValue(response.status) ?? "pending",
      newStatus: "accepted",
      metadata: {
        rfxId,
        totalScore: scoreResult.totalScore ?? 0,
      },
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx_awarded",
      entityType: "rfx",
      entityId: rfxId,
      orgId: stringValue(rfx.orgId),
      previousStatus: stringValue(rfx.status) ?? currentRfxStatus,
      newStatus: "awarded",
      metadata: {
        acceptedResponseId: input.responseId,
        declinedCompetitors,
        previousVersion: currentRfxVersion,
        newVersion: currentRfxVersion + 1,
      },
      createdAt: now,
    });

    return {
      id: input.responseId,
      rfxId,
      status: "accepted",
      totalScore: scoreResult.totalScore,
      version: responseVersion + 1,
      rfxStatus: "awarded",
      rfxVersion: currentRfxVersion + 1,
      declinedCompetitors,
    };
  });
});

/**
 * Admin-only backfill for geo.geohash on existing RFx docs.
 * Uses only the authoritative released-territory centroid.
 */
export const rfx_backfillGeo = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }
  requireAdminOrMaster(request);

  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(rfxBackfillGeoInputSchema, request.data);
  const db = getDb();
  const configuredProject = String(
    admin.app().options.projectId
      ?? process.env.GCLOUD_PROJECT
      ?? process.env.GOOGLE_CLOUD_PROJECT
      ?? "unknown",
  );
  if (input.apply) {
    if (!input.projectId || input.projectId !== configuredProject) {
      throw new HttpsError("failed-precondition", `Apply requires projectId ${configuredProject}`);
    }
    if (input.confirmProject !== configuredProject) {
      throw new HttpsError("failed-precondition", `Apply requires confirmProject ${configuredProject}`);
    }
  }

  let rfxQuery: FirebaseFirestore.Query = db.collection("rfx")
    .orderBy(FieldPath.documentId(), "asc");
  if (input.afterId) rfxQuery = rfxQuery.startAfter(input.afterId);
  const [rfxSnap, territorySnap] = await Promise.all([
    rfxQuery.limit(input.maxDocs).get(),
    db.collection("territories").get(),
  ]);

  const territoryCentroidByFips = new Map<string, { lat: number; lng: number }>();
  let invalidTerritoryCentroids = 0;
  territorySnap.docs.forEach((docSnap) => {
    const row = docSnap.data() as { fips?: string; centroid?: { lat?: unknown; lng?: unknown } };
    if (!row.fips || !row.centroid) return;
    if (
      !isFiniteNumber(row.centroid.lat)
      || row.centroid.lat < -90
      || row.centroid.lat > 90
      || !isFiniteNumber(row.centroid.lng)
      || row.centroid.lng < -180
      || row.centroid.lng > 180
    ) {
      invalidTerritoryCentroids += 1;
      return;
    }
    territoryCentroidByFips.set(row.fips, { lat: row.centroid.lat, lng: row.centroid.lng });
  });

  const batch = db.batch();
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  rfxSnap.docs.forEach((docSnap) => {
    processed += 1;
    const row = docSnap.data() as {
      territoryFips?: string;
      geo?: { lat?: unknown; lng?: unknown; geohash?: unknown };
    };

    const hasGeohash = typeof row.geo?.geohash === "string" && row.geo.geohash.length > 0;
    if (hasGeohash) {
      skipped += 1;
      return;
    }

    const territoryFallback = row.territoryFips
      ? territoryCentroidByFips.get(row.territoryFips)
      : undefined;

    const lat = territoryFallback?.lat;
    const lng = territoryFallback?.lng;

    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
      skipped += 1;
      return;
    }

    batch.update(docSnap.ref, {
      geo: {
        lat,
        lng,
        geohash: encodeGeohash(lat, lng),
        source: "territory_centroid_backfill",
      },
      updatedAt: Date.now(),
    });
    updated += 1;
  });

  if (input.apply && updated > 0) {
    const auditRef = db.collection("exchangeAudit").doc();
    batch.create(auditRef, {
      id: auditRef.id,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "rfx.geo_backfill_applied",
      entityType: "migration",
      entityId: configuredProject,
      metadata: {
        processed,
        updated,
        skipped,
        maxDocs: input.maxDocs,
        ...(input.afterId ? { afterId: input.afterId } : {}),
      },
      createdAt: Date.now(),
    });
    await batch.commit();
  }

  logger.info("RFx geo backfill assessed", {
    projectId: configuredProject,
    dryRun: !input.apply,
    processed,
    wouldUpdate: updated,
    skipped,
    invalidTerritoryCentroids,
  });
  const nextAfterId = rfxSnap.size === input.maxDocs
    ? rfxSnap.docs[rfxSnap.docs.length - 1]?.id
    : undefined;
  return {
    success: true,
    projectId: configuredProject,
    dryRun: !input.apply,
    processed,
    wouldUpdate: updated,
    updated: input.apply ? updated : 0,
    skipped,
    invalidTerritoryCentroids,
    nextAfterId: nextAfterId ?? null,
    complete: nextAfterId === undefined,
  };
});
