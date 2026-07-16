import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  idempotencyKeySchema,
  parseCallableInput,
} from "./exchange/contracts";
import {
  fingerprintRequest,
  getAuthorizedActor,
  getDb,
  idempotencyRef,
  requireAdmin,
  setCompletedIdempotency,
  writeExchangeAudit,
} from "./exchange/security";

export interface ReferralCommerceConfigurationData {
  id: "referralCommerce";
  schemaVersion: 1;
  platformFeeBasisPoints: number;
  version: number;
  effectiveAt: number;
  updatedBy: string;
  updatedAt: number;
  payoutHoldDays?: number;
  manualEvidenceThresholdCents?: number;
  commerceEnabled: boolean;
  settlementEnabled: false;
}

const localReferralCommerceConfigurationSchema = z.object({
  id: z.literal("referralCommerce"),
  schemaVersion: z.literal(1),
  platformFeeBasisPoints: z.number().int().min(0).max(10_000),
  version: z.number().int().min(1),
  effectiveAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedBy: z.string().trim().min(1).max(128),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  payoutHoldDays: z.number().int().min(0).max(365).optional(),
  manualEvidenceThresholdCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  commerceEnabled: z.boolean(),
  settlementEnabled: z.literal(false),
}).strict();

export const referralCommerceUpdateConfigurationInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().min(1),
  platformFeeBasisPoints: z.number().int().min(0).max(10_000).optional(),
  payoutHoldDays: z.number().int().min(0).max(365).nullable().optional(),
  manualEvidenceThresholdCents: z.number().int().nonnegative()
    .max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  commerceEnabled: z.boolean().optional(),
  settlementEnabled: z.literal(false).optional(),
}).strict().superRefine((value, context) => {
  if (
    value.platformFeeBasisPoints === undefined
    && value.payoutHoldDays === undefined
    && value.manualEvidenceThresholdCents === undefined
    && value.commerceEnabled === undefined
    && value.settlementEnabled === undefined
  ) {
    context.addIssue({ code: "custom", message: "At least one prospective configuration change is required" });
  }
});

export const LOCAL_DEFAULT_REFERRAL_COMMERCE_CONFIG: ReferralCommerceConfigurationData = Object.freeze({
  id: "referralCommerce",
  schemaVersion: 1,
  platformFeeBasisPoints: 100,
  version: 1,
  effectiveAt: 0,
  updatedBy: "system:default",
  updatedAt: 0,
  commerceEnabled: true,
  settlementEnabled: false,
});

const CONFIG_COLLECTION = "platformConfiguration";
const CONFIG_DOCUMENT = "referralCommerce";
const CONFIG_VERSIONS_COLLECTION = "versions";

function parseConfiguration(value: unknown): ReferralCommerceConfigurationData {
  const parsed = localReferralCommerceConfigurationSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpsError("failed-precondition", "Referral commerce configuration is invalid");
  }
  return parsed.data;
}

function configurationOutput(config: ReferralCommerceConfigurationData): ReferralCommerceConfigurationData {
  return {
    id: config.id,
    schemaVersion: config.schemaVersion,
    platformFeeBasisPoints: config.platformFeeBasisPoints,
    version: config.version,
    effectiveAt: config.effectiveAt,
    updatedBy: config.updatedBy,
    updatedAt: config.updatedAt,
    ...(config.payoutHoldDays !== undefined ? { payoutHoldDays: config.payoutHoldDays } : {}),
    ...(config.manualEvidenceThresholdCents !== undefined
      ? { manualEvidenceThresholdCents: config.manualEvidenceThresholdCents }
      : {}),
    commerceEnabled: config.commerceEnabled,
    settlementEnabled: false,
  };
}

/**
 * Current configuration reader for other trusted Functions. The default is
 * code-versioned and settlement remains disabled even when no document exists.
 */
export async function loadReferralCommerceConfiguration(
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<ReferralCommerceConfigurationData> {
  const snapshot = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT).get();
  return snapshot.exists
    ? configurationOutput(parseConfiguration(snapshot.data()))
    : configurationOutput(LOCAL_DEFAULT_REFERRAL_COMMERCE_CONFIG);
}

function completedIdempotentResult(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  actorUid: string,
  action: string,
  requestFingerprint: string,
): Record<string, unknown> | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data?.uid !== actorUid || data.action !== action || data.status !== "completed") {
    throw new HttpsError("already-exists", "The idempotency key is already in use");
  }
  if (data.requestFingerprint !== requestFingerprint) {
    throw new HttpsError("already-exists", "The idempotency key belongs to a different request");
  }
  return (data.result as Record<string, unknown> | undefined) ?? { id: data.entityId };
}

export const referralCommerce_getConfiguration = onCall(async (request) => {
  getAuthorizedActor(request);
  return { configuration: await loadReferralCommerceConfiguration() };
});

export const referralCommerce_updateConfiguration = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  requireAdmin(actor);
  const input = parseCallableInput(referralCommerceUpdateConfigurationInputSchema, request.data);
  const db = getDb();
  const action = "referral_commerce.update_configuration";
  const requestFingerprint = fingerprintRequest(input);
  const dedupeRef = idempotencyRef(db, actor.uid, action, input.idempotencyKey);
  const configRef = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT);

  return db.runTransaction(async (transaction) => {
    const [dedupeSnapshot, configSnapshot] = await Promise.all([
      transaction.get(dedupeRef),
      transaction.get(configRef),
    ]);
    const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, requestFingerprint);
    if (prior) return { ...prior, idempotent: true };

    const current = configSnapshot.exists
      ? parseConfiguration(configSnapshot.data())
      : configurationOutput(LOCAL_DEFAULT_REFERRAL_COMMERCE_CONFIG);
    if (current.version !== input.expectedVersion) {
      throw new HttpsError("aborted", "The referral commerce configuration changed; reload it and retry", {
        expectedVersion: input.expectedVersion,
        currentVersion: current.version,
      });
    }

    const now = Date.now();
    const next: ReferralCommerceConfigurationData = {
      id: "referralCommerce",
      schemaVersion: 1,
      platformFeeBasisPoints: input.platformFeeBasisPoints ?? current.platformFeeBasisPoints,
      version: current.version + 1,
      effectiveAt: now,
      updatedBy: actor.uid,
      updatedAt: now,
      ...(input.payoutHoldDays === null
        ? {}
        : input.payoutHoldDays !== undefined
          ? { payoutHoldDays: input.payoutHoldDays }
          : current.payoutHoldDays !== undefined
            ? { payoutHoldDays: current.payoutHoldDays }
            : {}),
      ...(input.manualEvidenceThresholdCents === null
        ? {}
        : input.manualEvidenceThresholdCents !== undefined
          ? { manualEvidenceThresholdCents: input.manualEvidenceThresholdCents }
          : current.manualEvidenceThresholdCents !== undefined
            ? { manualEvidenceThresholdCents: current.manualEvidenceThresholdCents }
            : {}),
      commerceEnabled: input.commerceEnabled ?? current.commerceEnabled,
      settlementEnabled: false,
    };
    const validatedNext = parseConfiguration(next);
    const currentVersionRef = configRef.collection(CONFIG_VERSIONS_COLLECTION).doc(String(current.version));
    const nextVersionRef = configRef.collection(CONFIG_VERSIONS_COLLECTION).doc(String(validatedNext.version));
    const [currentVersionSnapshot, nextVersionSnapshot] = await Promise.all([
      transaction.get(currentVersionRef),
      transaction.get(nextVersionRef),
    ]);
    if (nextVersionSnapshot.exists) {
      throw new HttpsError("failed-precondition", "The next configuration version already exists");
    }
    if (!currentVersionSnapshot.exists) transaction.create(currentVersionRef, current);
    transaction.create(nextVersionRef, validatedNext);
    transaction.set(configRef, validatedNext);

    const result = { configuration: configurationOutput(validatedNext) };
    setCompletedIdempotency(transaction, dedupeRef, {
      uid: actor.uid,
      action,
      entityId: CONFIG_DOCUMENT,
      result,
      requestFingerprint,
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action,
      entityType: "referralCommerceConfiguration",
      entityId: CONFIG_DOCUMENT,
      previousStatus: current.commerceEnabled ? "commerce_enabled" : "commerce_disabled",
      newStatus: validatedNext.commerceEnabled ? "commerce_enabled" : "commerce_disabled",
      metadata: {
        previousVersion: current.version,
        newVersion: validatedNext.version,
        previousPlatformFeeBasisPoints: current.platformFeeBasisPoints,
        newPlatformFeeBasisPoints: validatedNext.platformFeeBasisPoints,
        settlementEnabled: false,
      },
      createdAt: now,
    });
    return result;
  });
});
