import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  fingerprintRequest,
  getAuthorizedActor,
  getDb,
  idempotencyRef,
  loadOrgAuthority,
  setCompletedIdempotency,
  writeExchangeAudit,
  type AuthorizedActor,
} from "./exchange/security";
import { ensureOpportunityProjection } from "./opportunityDiscoveryFallback";

type RecordData = Record<string, unknown>;

const MAX_ADDENDA = 100;
const MAX_QUESTIONS = 200;

const addendumCreateSchema = z.object({
  rfxId: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(5_000),
  materialChanges: z.array(z.string().trim().min(1).max(1_000)).min(1).max(30),
  deadlineChanged: z.boolean().default(false),
  previousDeadline: z.number().int().nonnegative().optional(),
  newDeadline: z.number().int().nonnegative().optional(),
  acknowledgmentRequired: z.boolean().default(false),
  idempotencyKey: z.string().min(12).max(160),
}).strict().superRefine((value, context) => {
  if (value.deadlineChanged && value.newDeadline === undefined) {
    context.addIssue({
      code: "custom",
      path: ["newDeadline"],
      message: "A new deadline is required when the deadline changed",
    });
  }
});

const acknowledgmentSchema = z.object({
  rfxId: z.string().min(1).max(160),
  addendumId: z.string().min(1).max(160),
  organizationId: z.string().min(1).max(160).optional(),
  idempotencyKey: z.string().min(12).max(160),
}).strict();

const questionSubmitSchema = z.object({
  rfxId: z.string().min(1).max(160),
  question: z.string().trim().min(5).max(3_000),
  visibilityRequested: z.enum(["public", "private"]).default("public"),
  organizationId: z.string().min(1).max(160).optional(),
  idempotencyKey: z.string().min(12).max(160),
}).strict();

const questionAnswerSchema = z.object({
  rfxId: z.string().min(1).max(160),
  questionId: z.string().min(1).max(160),
  answer: z.string().trim().min(1).max(6_000),
  visibility: z.enum(["public", "private"]),
  idempotencyKey: z.string().min(12).max(160),
}).strict();

const governanceListSchema = z.object({
  rfxId: z.string().min(1).max(160),
  includePrivate: z.boolean().default(true),
}).strict();

function asRecord(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      const converted = toMillis.call(value);
      if (typeof converted === "number" && Number.isFinite(converted)) return converted;
    }
  }
  return undefined;
}

function canReadOpportunity(rfx: RecordData, actor?: AuthorizedActor): boolean {
  if (actor?.isAdmin || actor?.role === "staff") return true;
  if (actor && (
    stringValue(rfx.ownerUid) === actor.uid
    || stringValue(rfx.createdBy) === actor.uid
  )) return true;
  const status = stringValue(rfx.status);
  const approval = stringValue(rfx.adminApprovalStatus);
  if (status !== "open" || approval !== "approved") {
    return Boolean(actor && (
      stringValue(rfx.ownerUid) === actor.uid
      || stringValue(rfx.createdBy) === actor.uid
    ));
  }
  if (rfx.memberOnly === true || stringValue(rfx.visibility) === "members") {
    return Boolean(actor);
  }
  if (stringValue(rfx.visibility) === "restricted") return false;
  return true;
}

async function requireOpportunityReader(
  transaction: FirebaseFirestore.Transaction,
  rfx: RecordData,
  actor?: AuthorizedActor,
): Promise<void> {
  if (canReadOpportunity(rfx, actor)) return;
  const orgId = stringValue(rfx.orgId);
  if (actor && orgId && stringValue(rfx.visibility) === "restricted") {
    await loadOrgAuthority(transaction, getDb(), orgId, actor.uid, {
      managementRequired: true,
    });
    return;
  }
  throw new HttpsError("permission-denied", "Opportunity access is required");
}

async function requireOpportunityManager(
  transaction: FirebaseFirestore.Transaction,
  rfx: RecordData,
  actor: AuthorizedActor,
): Promise<void> {
  if (actor.isAdmin || actor.role === "staff") return;
  const orgId = stringValue(rfx.orgId);
  if (orgId) {
    await loadOrgAuthority(transaction, getDb(), orgId, actor.uid, {
      managementRequired: true,
    });
    return;
  }
  if (
    stringValue(rfx.ownerUid) !== actor.uid
    && stringValue(rfx.createdBy) !== actor.uid
  ) {
    throw new HttpsError(
      "permission-denied",
      "Opportunity manager authority is required",
    );
  }
}

async function activeOrganizationManagerIds(uid: string): Promise<Set<string>> {
  const snapshot = await getDb().collection("orgMembers")
    .where("uid", "==", uid)
    .limit(100)
    .get();
  const ids = snapshot.docs.flatMap((document) => {
    const member = asRecord(document.data());
    const orgId = stringValue(member.orgId);
    const status = stringValue(member.status);
    const role = stringValue(member.role);
    if (
      !orgId
      || document.id !== `${orgId}_${uid}`
      || member.uid !== uid
      || (status && status !== "active")
      || (role !== "owner" && role !== "admin")
    ) return [];
    return [orgId];
  });
  return new Set(ids);
}

function sanitizeAddendum(document: FirebaseFirestore.QueryDocumentSnapshot): RecordData {
  const source = asRecord(document.data());
  return {
    id: document.id,
    rfxId: stringValue(source.rfxId),
    version: numberValue(source.version) ?? 0,
    title: stringValue(source.title) ?? "Addendum",
    summary: stringValue(source.summary) ?? "",
    materialChanges: Array.isArray(source.materialChanges)
      ? source.materialChanges.filter((value): value is string => typeof value === "string").slice(0, 30)
      : [],
    deadlineChanged: source.deadlineChanged === true,
    previousDeadline: numberValue(source.previousDeadline),
    newDeadline: numberValue(source.newDeadline),
    acknowledgmentRequired: source.acknowledgmentRequired === true,
    publishedAt: numberValue(source.publishedAt) ?? 0,
  };
}

function sanitizeQuestion(
  document: FirebaseFirestore.QueryDocumentSnapshot,
  canSeePrivate: boolean,
  actorUid?: string,
): RecordData | null {
  const source = asRecord(document.data());
  const visibility = stringValue(source.visibility) ?? "private";
  const askerUid = stringValue(source.askerUid);
  if (visibility !== "public" && !canSeePrivate && askerUid !== actorUid) return null;
  return {
    id: document.id,
    rfxId: stringValue(source.rfxId),
    question: stringValue(source.question) ?? "",
    answer: stringValue(source.answer),
    status: stringValue(source.status) ?? "pending",
    visibility,
    submittedAt: numberValue(source.submittedAt) ?? 0,
    answeredAt: numberValue(source.answeredAt),
    isMine: Boolean(actorUid && askerUid === actorUid),
    // The public discovery response intentionally excludes asker identity.
  };
}

async function createAddendum(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<unknown> {
  const actor = getAuthorizedActor(request);
  const parsed = addendumCreateSchema.safeParse(payload);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Invalid addendum", {
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const input = parsed.data;
  const db = getDb();
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const addendumRef = db.collection("rfxAddenda").doc();
  const idempotency = idempotencyRef(db, actor.uid, "rfx_addendum_create", input.idempotencyKey);
  const requestFingerprint = fingerprintRequest(input);
  const result = await db.runTransaction(async (transaction) => {
    const [rfxSnapshot, replaySnapshot] = await Promise.all([
      transaction.get(rfxRef),
      transaction.get(idempotency),
    ]);
    if (replaySnapshot.exists) {
      const replay = asRecord(replaySnapshot.data());
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new HttpsError("already-exists", "Idempotency key was used for a different addendum");
      }
      return { id: stringValue(asRecord(replay.result).id) ?? "", replayed: true };
    }
    if (!rfxSnapshot.exists) throw new HttpsError("not-found", "Opportunity not found");
    const rfx = asRecord(rfxSnapshot.data());
    await requireOpportunityManager(transaction, rfx, actor);
    const previousCount = Math.max(0, Math.trunc(numberValue(rfx.addendumCount) ?? 0));
    const version = previousCount + 1;
    const now = Date.now();
    transaction.create(addendumRef, {
      id: addendumRef.id,
      rfxId: input.rfxId,
      version,
      title: input.title,
      summary: input.summary,
      materialChanges: input.materialChanges,
      deadlineChanged: input.deadlineChanged,
      ...(input.previousDeadline !== undefined ? { previousDeadline: input.previousDeadline } : {}),
      ...(input.newDeadline !== undefined ? { newDeadline: input.newDeadline } : {}),
      acknowledgmentRequired: input.acknowledgmentRequired,
      publishedByUid: actor.uid,
      publishedAt: now,
      immutable: true,
    });
    transaction.update(rfxRef, {
      addendumCount: version,
      updatedAt: now,
      addendumUpdatedAt: now,
      ...(input.newDeadline !== undefined ? { dueDate: input.newDeadline } : {}),
    });
    const notificationJob = db.collection("opportunityNotificationJobs").doc();
    transaction.create(notificationJob, {
      id: notificationJob.id,
      kind: "opportunity_addendum_published",
      rfxId: input.rfxId,
      addendumId: addendumRef.id,
      audience: ["saved", "responded"],
      status: "pending",
      externalDeliveryEnabled: false,
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "opportunity.addendum.created",
      entityType: "rfxAddendum",
      entityId: addendumRef.id,
      orgId: stringValue(rfx.orgId),
      metadata: {
        rfxId: input.rfxId,
        version,
        deadlineChanged: input.deadlineChanged,
        acknowledgmentRequired: input.acknowledgmentRequired,
      },
      createdAt: now,
    });
    setCompletedIdempotency(transaction, idempotency, {
      uid: actor.uid,
      action: "rfx_addendum_create",
      entityId: addendumRef.id,
      result: { id: addendumRef.id, version },
      requestFingerprint,
      createdAt: now,
    });
    return { id: addendumRef.id, version, replayed: false };
  });
  await ensureOpportunityProjection(input.rfxId);
  return result;
}

async function acknowledgeAddendum(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<unknown> {
  const actor = getAuthorizedActor(request);
  const parsed = acknowledgmentSchema.safeParse(payload);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid addendum acknowledgment");
  const input = parsed.data;
  const db = getDb();
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const addendumRef = db.collection("rfxAddenda").doc(input.addendumId);
  const acknowledgmentRef = db.collection("rfxAddendumAcknowledgments")
    .doc(`${input.addendumId}_${input.organizationId ?? actor.uid}`);
  const idempotency = idempotencyRef(db, actor.uid, "rfx_addendum_acknowledge", input.idempotencyKey);
  const fingerprint = fingerprintRequest(input);
  return db.runTransaction(async (transaction) => {
    const [rfxSnapshot, addendumSnapshot, replaySnapshot] = await Promise.all([
      transaction.get(rfxRef),
      transaction.get(addendumRef),
      transaction.get(idempotency),
    ]);
    if (replaySnapshot.exists) return { success: true, replayed: true };
    if (!rfxSnapshot.exists || !addendumSnapshot.exists) {
      throw new HttpsError("not-found", "Opportunity or addendum not found");
    }
    const rfx = asRecord(rfxSnapshot.data());
    await requireOpportunityReader(transaction, rfx, actor);
    if (input.organizationId) {
      await loadOrgAuthority(transaction, db, input.organizationId, actor.uid);
    }
    const now = Date.now();
    transaction.set(acknowledgmentRef, {
      id: acknowledgmentRef.id,
      rfxId: input.rfxId,
      addendumId: input.addendumId,
      acknowledgedByUid: actor.uid,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      acknowledgedAt: now,
    }, { merge: false });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "opportunity.addendum.acknowledged",
      entityType: "rfxAddendum",
      entityId: input.addendumId,
      orgId: input.organizationId,
      metadata: { rfxId: input.rfxId },
      createdAt: now,
    });
    setCompletedIdempotency(transaction, idempotency, {
      uid: actor.uid,
      action: "rfx_addendum_acknowledge",
      entityId: input.addendumId,
      result: { success: true },
      requestFingerprint: fingerprint,
      createdAt: now,
    });
    return { success: true, replayed: false };
  });
}

async function submitQuestion(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<unknown> {
  const actor = getAuthorizedActor(request);
  const parsed = questionSubmitSchema.safeParse(payload);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid opportunity question");
  const input = parsed.data;
  const db = getDb();
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const questionRef = db.collection("rfxQuestions").doc();
  const idempotency = idempotencyRef(db, actor.uid, "rfx_question_submit", input.idempotencyKey);
  const fingerprint = fingerprintRequest(input);
  return db.runTransaction(async (transaction) => {
    const [rfxSnapshot, replaySnapshot] = await Promise.all([
      transaction.get(rfxRef),
      transaction.get(idempotency),
    ]);
    if (replaySnapshot.exists) {
      const replay = asRecord(replaySnapshot.data());
      if (replay.requestFingerprint !== fingerprint) {
        throw new HttpsError("already-exists", "Idempotency key was used for a different question");
      }
      return { id: stringValue(asRecord(replay.result).id) ?? "", replayed: true };
    }
    if (!rfxSnapshot.exists) throw new HttpsError("not-found", "Opportunity not found");
    const rfx = asRecord(rfxSnapshot.data());
    await requireOpportunityReader(transaction, rfx, actor);
    const questionDeadline = numberValue(rfx.questionDeadline);
    if (questionDeadline !== undefined && questionDeadline < Date.now()) {
      throw new HttpsError("failed-precondition", "The opportunity question deadline has passed");
    }
    if (input.organizationId) {
      await loadOrgAuthority(transaction, db, input.organizationId, actor.uid);
    }
    const now = Date.now();
    transaction.create(questionRef, {
      id: questionRef.id,
      rfxId: input.rfxId,
      question: input.question,
      status: "pending",
      visibilityRequested: input.visibilityRequested,
      visibility: "private",
      askerUid: actor.uid,
      ...(input.organizationId ? { askerOrganizationId: input.organizationId } : {}),
      submittedAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "opportunity.question.submitted",
      entityType: "rfxQuestion",
      entityId: questionRef.id,
      orgId: input.organizationId,
      metadata: {
        rfxId: input.rfxId,
        visibilityRequested: input.visibilityRequested,
      },
      createdAt: now,
    });
    setCompletedIdempotency(transaction, idempotency, {
      uid: actor.uid,
      action: "rfx_question_submit",
      entityId: questionRef.id,
      result: { id: questionRef.id },
      requestFingerprint: fingerprint,
      createdAt: now,
    });
    return { id: questionRef.id, replayed: false };
  });
}

async function answerQuestion(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<unknown> {
  const actor = getAuthorizedActor(request);
  const parsed = questionAnswerSchema.safeParse(payload);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid opportunity answer");
  const input = parsed.data;
  const db = getDb();
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const questionRef = db.collection("rfxQuestions").doc(input.questionId);
  const idempotency = idempotencyRef(db, actor.uid, "rfx_question_answer", input.idempotencyKey);
  const fingerprint = fingerprintRequest(input);
  const result = await db.runTransaction(async (transaction) => {
    const [rfxSnapshot, questionSnapshot, replaySnapshot] = await Promise.all([
      transaction.get(rfxRef),
      transaction.get(questionRef),
      transaction.get(idempotency),
    ]);
    if (replaySnapshot.exists) return { success: true, replayed: true };
    if (!rfxSnapshot.exists || !questionSnapshot.exists) {
      throw new HttpsError("not-found", "Opportunity or question not found");
    }
    const rfx = asRecord(rfxSnapshot.data());
    await requireOpportunityManager(transaction, rfx, actor);
    const question = asRecord(questionSnapshot.data());
    if (stringValue(question.rfxId) !== input.rfxId) {
      throw new HttpsError("failed-precondition", "Question does not belong to this opportunity");
    }
    const now = Date.now();
    transaction.update(questionRef, {
      answer: input.answer,
      status: "answered",
      visibility: input.visibility,
      answeredByUid: actor.uid,
      answeredAt: now,
      answerVersion: Math.max(0, Math.trunc(numberValue(question.answerVersion) ?? 0)) + 1,
    });
    transaction.update(rfxRef, {
      qAndAStatus: "open",
      updatedAt: now,
      qAndAUpdatedAt: now,
    });
    const notificationJob = db.collection("opportunityNotificationJobs").doc();
    transaction.create(notificationJob, {
      id: notificationJob.id,
      kind: "opportunity_question_answered",
      rfxId: input.rfxId,
      questionId: input.questionId,
      audience: input.visibility === "public" ? ["saved", "responded"] : ["asker"],
      status: "pending",
      externalDeliveryEnabled: false,
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "opportunity.question.answered",
      entityType: "rfxQuestion",
      entityId: input.questionId,
      orgId: stringValue(rfx.orgId),
      metadata: { rfxId: input.rfxId, visibility: input.visibility },
      createdAt: now,
    });
    setCompletedIdempotency(transaction, idempotency, {
      uid: actor.uid,
      action: "rfx_question_answer",
      entityId: input.questionId,
      result: { success: true },
      requestFingerprint: fingerprint,
      createdAt: now,
    });
    return { success: true, replayed: false };
  });
  await ensureOpportunityProjection(input.rfxId);
  return result;
}

async function listGovernance(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<unknown> {
  const parsed = governanceListSchema.safeParse(payload);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid governance request");
  const input = parsed.data;
  const db = getDb();
  const rfxSnapshot = await db.collection("rfx").doc(input.rfxId).get();
  if (!rfxSnapshot.exists) throw new HttpsError("not-found", "Opportunity not found");
  const rfx = asRecord(rfxSnapshot.data());
  const actor = request.auth ? getAuthorizedActor(request) : undefined;
  let readable = canReadOpportunity(rfx, actor);
  if (!readable && actor && stringValue(rfx.visibility) === "restricted") {
    const orgId = stringValue(rfx.orgId);
    readable = Boolean(orgId && (await activeOrganizationManagerIds(actor.uid)).has(orgId));
  }
  if (!readable) throw new HttpsError("permission-denied", "Opportunity access is required");
  let canSeePrivate = Boolean(actor?.isAdmin || actor?.role === "staff");
  if (actor && !canSeePrivate) {
    const orgId = stringValue(rfx.orgId);
    if (stringValue(rfx.ownerUid) === actor.uid || stringValue(rfx.createdBy) === actor.uid) {
      canSeePrivate = true;
    } else if (orgId) {
      canSeePrivate = (await activeOrganizationManagerIds(actor.uid)).has(orgId);
    }
  }
  const [addendaSnapshot, questionSnapshot] = await Promise.all([
    db.collection("rfxAddenda")
      .where("rfxId", "==", input.rfxId)
      .orderBy("version", "asc")
      .limit(MAX_ADDENDA)
      .get(),
    db.collection("rfxQuestions")
      .where("rfxId", "==", input.rfxId)
      .orderBy("submittedAt", "asc")
      .limit(MAX_QUESTIONS)
      .get(),
  ]);
  const questions = questionSnapshot.docs
    .map((document) => sanitizeQuestion(
      document,
      input.includePrivate && canSeePrivate,
      actor?.uid,
    ))
    .filter((question): question is RecordData => Boolean(question));
  return {
    addenda: addendaSnapshot.docs.map(sanitizeAddendum),
    questions,
    questionDeadline: numberValue(rfx.questionDeadline),
    preBidMeeting: stringValue(rfx.preBidMeeting),
    siteVisit: stringValue(rfx.siteVisit),
    submissionInstructions: stringValue(rfx.submissionInstructions),
    addendaTruncated: addendaSnapshot.size === MAX_ADDENDA,
    questionsTruncated: questionSnapshot.size === MAX_QUESTIONS,
    canManage: canSeePrivate,
    canAsk: Boolean(actor && stringValue(rfx.status) === "open"),
  };
}

export const OPPORTUNITY_GOVERNANCE_OPERATIONS = new Set([
  "governanceList",
  "addendumCreate",
  "addendumAcknowledge",
  "questionSubmit",
  "questionAnswer",
]);

export async function handleOpportunityGovernanceOperation(
  request: CallableRequest<unknown>,
  operation: unknown,
  payload: unknown,
): Promise<unknown> {
  switch (operation) {
    case "governanceList": return listGovernance(request, payload);
    case "addendumCreate": return createAddendum(request, payload);
    case "addendumAcknowledge": return acknowledgeAddendum(request, payload);
    case "questionSubmit": return submitQuestion(request, payload);
    case "questionAnswer": return answerQuestion(request, payload);
    default: throw new HttpsError("invalid-argument", "Unsupported opportunity governance operation");
  }
}
