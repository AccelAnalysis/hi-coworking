import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import {
  businessReferralConsentInputSchema,
  businessReferralCreateInputSchema,
  businessReferralProgressInputSchema,
  businessReferralRespondInputSchema,
  businessReferralSendInputSchema,
  parseCallableInput,
  referralDisputeCreateInputSchema,
  type BusinessReferralStatus,
} from "./exchange/contracts";
import {
  getAuthorizedActor,
  getDb,
  fingerprintRequest,
  idempotencyRef,
  loadOrgAuthority,
  requireStaffOrAdmin,
  setCompletedIdempotency,
  writeExchangeAudit,
  type AuthorizedActor,
} from "./exchange/security";

interface BusinessReferralDocData {
  id: string;
  schemaVersion: 1 | 2;
  referrerUid: string;
  referrerOrgId?: string;
  recipientUid?: string;
  recipientOrgId?: string;
  assignedStaffUids?: string[];
  status: BusinessReferralStatus;
  consentStatus: "not_required" | "pending" | "confirmed" | "withdrawn" | "unknown_legacy";
  compensationPolicy: {
    type: "none" | "fixed" | "percentage" | "custom" | "benefit";
    amountCents?: number;
    percentageBasisPoints?: number;
    percentageBasis?: "first_collected_invoice" | "total_collected_contract";
    currency?: string;
    benefitDescription?: string;
    terms?: string;
    status: "none" | "proposed" | "agreed" | "due" | "processing" | "settled" | "disputed" | "cancelled";
    lockedAt?: number;
  };
  referralType: string;
  serviceOfferId?: string;
  serviceOfferVersion?: number;
  acceptedTermsSnapshot?: Record<string, unknown>;
  commerceStatus?: string;
  version: number;
  activeDisputeId?: string;
  [key: string]: unknown;
}

const MAX_REFERRAL_EVIDENCE_FILE_SIZE = 15 * 1024 * 1024;
const BUSINESS_REFERRAL_SENT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const BUSINESS_REFERRAL_STORAGE_GRANT_TTL_MS = 60 * 1_000;
const MAX_REFERRAL_EXPIRATIONS_PER_RUN = 200;
const DEFAULT_PLATFORM_FEE_BASIS_POINTS = 100;
const DEFAULT_PLATFORM_FEE_CONFIG_VERSION = 1;
const REFERRAL_CALCULATION_VERSION = 1;
const ALLOWED_REFERRAL_EVIDENCE_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface ReferralServiceOfferData {
  id: string;
  offerId?: string;
  version: number;
  providerUid?: string;
  providerOrgId?: string;
  status: "draft" | "published" | "inactive";
  acceptingReferrals: boolean;
  compensationType: "none" | "fixed" | "percentage" | "custom" | "benefit";
  fixedCompensationCents?: number;
  compensationRateBasisPoints?: number;
  percentageBasis?: "first_collected_invoice" | "total_collected_contract";
  currency: string;
  benefitDescription?: string;
  customTerms?: string;
  attributionWindowDays: number;
  payoutTrigger?: string;
  paymentDeadlineDays?: number;
  refundTreatment?: string;
  includedCharges?: string[];
  excludedCharges?: string[];
}

function writeReferralTimeline(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  params: {
    referralId: string;
    eventType: string;
    actor: AuthorizedActor | { uid: string; role: string };
    actorOrgId?: string;
    referralVersion: number;
    occurredAt: number;
    transactionReportId?: string;
    metadata?: Record<string, string | number | boolean | null>;
  },
): void {
  const eventId = `${params.referralId}_${params.referralVersion}_${params.eventType}`;
  const event: Record<string, unknown> = {
    id: eventId,
    referralId: params.referralId,
    eventType: params.eventType,
    actorUid: params.actor.uid,
    actorRole: params.actor.role,
    referralVersion: params.referralVersion,
    occurredAt: params.occurredAt,
  };
  if (params.actorOrgId) event.actorOrgId = params.actorOrgId;
  if (params.transactionReportId) event.transactionReportId = params.transactionReportId;
  if (params.metadata && Object.keys(params.metadata).length > 0) event.metadata = params.metadata;
  transaction.create(db.collection("businessReferralTimeline").doc(eventId), event);
}

function assertCanonicalDisputeEvidencePaths(
  referralId: string,
  actorUid: string,
  paths: string[],
): void {
  const expectedPrefix = `businessReferralDisputeEvidence/${referralId}/${actorUid}/`;
  if (new Set(paths).size !== paths.length) {
    throw new HttpsError("invalid-argument", "Dispute evidence paths must be unique");
  }
  if (paths.some((path) => {
    const suffix = path.slice(expectedPrefix.length);
    return !path.startsWith(expectedPrefix)
      || !suffix
      || path.includes("..")
      || path.includes("\\")
      || path.includes("\0");
  })) {
    throw new HttpsError("invalid-argument", "Dispute evidence must use the authorized referral path");
  }
}

async function verifyDisputeEvidence(paths: string[]): Promise<void> {
  await Promise.all(paths.map(async (storagePath) => {
    try {
      const [metadata] = await admin.storage().bucket().file(storagePath).getMetadata();
      const size = Number(metadata.size ?? 0);
      const contentType = typeof metadata.contentType === "string"
        ? metadata.contentType.toLowerCase()
        : "";
      if (
        !Number.isSafeInteger(size)
        || size <= 0
        || size > MAX_REFERRAL_EVIDENCE_FILE_SIZE
        || !ALLOWED_REFERRAL_EVIDENCE_CONTENT_TYPES.has(contentType)
      ) {
        throw new HttpsError("failed-precondition", "Dispute evidence has invalid stored metadata");
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("failed-precondition", "Dispute evidence could not be verified in Storage");
    }
  }));
}

const disputeResolveInputSchema = z
  .object({
    disputeId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    resolution: z.enum(["upheld", "dismissed", "agreement"]),
    note: z.string().trim().min(3).max(5_000),
  })
  .strict();

const referralEvidenceAccessInputSchema = z
  .object({
    referralId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    operation: z.enum(["upload", "read"]),
    storagePaths: z.array(z.string().trim().min(1).max(1_024)).min(1).max(10),
  })
  .strict();

const RESTORABLE_COMPENSATION_STATUSES = new Set<BusinessReferralDocData["compensationPolicy"]["status"]>([
  "none",
  "proposed",
  "agreed",
  "due",
  "processing",
  "settled",
  "cancelled",
]);

function getVersion(referral: BusinessReferralDocData): number {
  return Number.isInteger(referral.version) && referral.version >= 0 ? referral.version : 0;
}

function requireExpectedVersion(referral: BusinessReferralDocData, expectedVersion: number): void {
  if (getVersion(referral) !== expectedVersion) {
    throw new HttpsError("aborted", "The referral changed; reload it and retry", {
      expectedVersion,
      currentVersion: getVersion(referral),
    });
  }
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

async function hasOrgAuthority(
  transaction: FirebaseFirestore.Transaction,
  orgId: unknown,
  actor: AuthorizedActor,
  managementRequired = false,
): Promise<boolean> {
  if (typeof orgId !== "string" || !orgId) return false;
  try {
    await loadOrgAuthority(transaction, getDb(), orgId, actor.uid, { managementRequired });
    return true;
  } catch (error) {
    if (error instanceof HttpsError && error.code === "permission-denied") return false;
    throw error;
  }
}

function hasOrganizationScope(
  referral: BusinessReferralDocData,
  field: "referrerOrgId" | "recipientOrgId",
): boolean {
  return Object.prototype.hasOwnProperty.call(referral, field);
}

function isIndividualReferrer(referral: BusinessReferralDocData, actorUid: string): boolean {
  return !hasOrganizationScope(referral, "referrerOrgId")
    && referral.referrerUid === actorUid;
}

function isIndividualRecipient(referral: BusinessReferralDocData, actorUid: string): boolean {
  return !hasOrganizationScope(referral, "recipientOrgId")
    && referral.recipientUid === actorUid;
}

async function requireReferrerAuthority(
  transaction: FirebaseFirestore.Transaction,
  referral: BusinessReferralDocData,
  actor: AuthorizedActor,
  actorOrganizationId?: string,
): Promise<void> {
  if (actorOrganizationId) {
    if (referral.referrerOrgId !== actorOrganizationId) {
      throw new HttpsError(
        "permission-denied",
        "The selected organization is not the referral referrer",
      );
    }
    await loadOrgAuthority(transaction, getDb(), actorOrganizationId, actor.uid, {
      managementRequired: true,
    });
    return;
  }
  if (hasOrganizationScope(referral, "referrerOrgId")) {
    throw new HttpsError(
      "permission-denied",
      "Select the referral's referrer organization before acting",
    );
  }
  if (isIndividualReferrer(referral, actor.uid)) return;
  throw new HttpsError("permission-denied", "Referrer authority is required");
}

async function requireRecipientAuthority(
  transaction: FirebaseFirestore.Transaction,
  referral: BusinessReferralDocData,
  actor: AuthorizedActor,
  managementRequired = false,
  actorOrganizationId?: string,
): Promise<void> {
  if (actorOrganizationId) {
    if (referral.recipientOrgId !== actorOrganizationId) {
      throw new HttpsError(
        "permission-denied",
        "The selected organization is not the referral recipient",
      );
    }
    await loadOrgAuthority(transaction, getDb(), actorOrganizationId, actor.uid, {
      managementRequired,
    });
    return;
  }
  if (hasOrganizationScope(referral, "recipientOrgId")) {
    throw new HttpsError(
      "permission-denied",
      "Select the referral's recipient organization before acting",
    );
  }
  if (isIndividualRecipient(referral, actor.uid)) return;
  throw new HttpsError("permission-denied", "Recipient authority is required");
}

async function requirePartyAuthority(
  transaction: FirebaseFirestore.Transaction,
  referral: BusinessReferralDocData,
  actor: AuthorizedActor,
): Promise<void> {
  if (actor.role === "staff" && referral.assignedStaffUids?.includes(actor.uid)) return;
  const referrerAuthorized = hasOrganizationScope(referral, "referrerOrgId")
    ? await hasOrgAuthority(transaction, referral.referrerOrgId, actor)
    : isIndividualReferrer(referral, actor.uid);
  if (referrerAuthorized) return;
  const recipientAuthorized = hasOrganizationScope(referral, "recipientOrgId")
    ? await hasOrgAuthority(transaction, referral.recipientOrgId, actor)
    : isIndividualRecipient(referral, actor.uid);
  if (recipientAuthorized) return;
  throw new HttpsError("permission-denied", "Referral-party authority is required");
}

async function hasReferralOrgAuthority(
  transaction: FirebaseFirestore.Transaction,
  orgId: string | undefined,
  actor: AuthorizedActor,
): Promise<boolean> {
  if (!orgId) return false;
  try {
    await loadOrgAuthority(transaction, getDb(), orgId, actor.uid);
    return true;
  } catch (error) {
    if (error instanceof HttpsError && error.code === "permission-denied") return false;
    throw error;
  }
}

function requireReferralEvidenceGrantPaths(
  referralId: string,
  actorUid: string,
  operation: "upload" | "read",
  paths: string[],
): void {
  if (new Set(paths).size !== paths.length) {
    throw new HttpsError("invalid-argument", "Referral evidence paths must be unique");
  }
  const basePrefixes = [
    `businessReferralEvidence/${referralId}/`,
    `businessReferralDisputeEvidence/${referralId}/`,
  ];
  const uploadPrefixes = basePrefixes.map((prefix) => `${prefix}${actorUid}/`);
  const validPrefixes = operation === "upload" ? uploadPrefixes : basePrefixes;
  if (paths.some((path) => {
    const segments = path.split("/");
    const matchedPrefix = validPrefixes.find(
      (prefix) => path.startsWith(prefix) && path.length > prefix.length,
    );
    const lowered = path.toLowerCase();
    return !matchedPrefix
      || path.startsWith("/")
      || path.includes("\\")
      || path.includes("\0")
      || segments.some((segment) => !segment || segment === "." || segment === "..")
      || /^(?:https?:|gs:)/i.test(path)
      || lowered.includes("%2f")
      || lowered.includes("%5c")
      || lowered.includes("%2e");
  })) {
    throw new HttpsError("invalid-argument", "Referral evidence path is not canonical");
  }
}

function referralStorageGrantRef(
  db: FirebaseFirestore.Firestore,
  referralId: string,
  uid: string,
): FirebaseFirestore.DocumentReference {
  return db.collection("businessReferralStorageGrantScopes")
    .doc(referralId)
    .collection("storageGrants")
    .doc(uid);
}

function requireReferralSnapshot(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): BusinessReferralDocData {
  if (!snapshot.exists) throw new HttpsError("not-found", "Business referral not found");
  const referral = snapshot.data() as BusinessReferralDocData;
  if (referral.schemaVersion !== 1 && referral.schemaVersion !== 2) {
    throw new HttpsError("failed-precondition", "Unsupported business-referral version");
  }
  return referral;
}

function referralCommerceConfig(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): { platformFeeBasisPoints: number; version: number; commerceEnabled: boolean } {
  if (!snapshot.exists) {
    return {
      platformFeeBasisPoints: DEFAULT_PLATFORM_FEE_BASIS_POINTS,
      version: DEFAULT_PLATFORM_FEE_CONFIG_VERSION,
      commerceEnabled: true,
    };
  }
  const config = snapshot.data() ?? {};
  if (
    !Number.isInteger(config.platformFeeBasisPoints)
    || config.platformFeeBasisPoints < 0
    || config.platformFeeBasisPoints > 10_000
    || !Number.isInteger(config.version)
    || config.version < 1
    || typeof config.commerceEnabled !== "boolean"
  ) {
    throw new HttpsError("failed-precondition", "Referral commerce configuration is invalid");
  }
  return {
    platformFeeBasisPoints: config.platformFeeBasisPoints as number,
    version: config.version as number,
    commerceEnabled: config.commerceEnabled as boolean,
  };
}

function compensationForCreate(
  policy: {
    type: "none" | "fixed" | "percentage" | "custom" | "benefit";
    amountCents?: number;
    percentageBasisPoints?: number;
    percentageBasis?: "first_collected_invoice" | "total_collected_contract";
    currency?: string;
    terms?: string;
    benefitDescription?: string;
  } | undefined,
): BusinessReferralDocData["compensationPolicy"] {
  if (!policy || policy.type === "none") return { type: "none", status: "none" };
  return { ...policy, status: "proposed" };
}

function compensationForOffer(
  offer: ReferralServiceOfferData,
): BusinessReferralDocData["compensationPolicy"] {
  if (offer.compensationType === "none") return { type: "none", status: "none" };
  const policy: BusinessReferralDocData["compensationPolicy"] = {
    type: offer.compensationType,
    status: "proposed",
    currency: offer.currency,
  };
  if (offer.fixedCompensationCents !== undefined) policy.amountCents = offer.fixedCompensationCents;
  if (offer.compensationRateBasisPoints !== undefined) {
    policy.percentageBasisPoints = offer.compensationRateBasisPoints;
  }
  if (offer.percentageBasis) policy.percentageBasis = offer.percentageBasis;
  if (offer.benefitDescription) policy.benefitDescription = offer.benefitDescription;
  if (offer.customTerms) policy.terms = offer.customTerms;
  return policy;
}

function requirePublishedOffer(
  snapshot: FirebaseFirestore.DocumentSnapshot | undefined,
  expectedId: string,
): ReferralServiceOfferData {
  if (!snapshot?.exists) throw new HttpsError("not-found", "Referral service offer not found");
  const offer = snapshot.data() as ReferralServiceOfferData;
  if (
    offer.id !== expectedId
    || !Number.isInteger(offer.version)
    || offer.version < 1
    || offer.status !== "published"
    || offer.acceptingReferrals !== true
  ) {
    throw new HttpsError("failed-precondition", "The referral service offer is not currently available");
  }
  return offer;
}

function offerMatchesRecipient(
  offer: ReferralServiceOfferData,
  recipientUid: string | undefined,
  recipientOrgId: string | undefined,
): boolean {
  if (offer.providerOrgId) return offer.providerOrgId === recipientOrgId;
  return Boolean(offer.providerUid && offer.providerUid === recipientUid && !recipientOrgId);
}

function acceptedTermsSnapshot(params: {
  referral: BusinessReferralDocData;
  offer?: ReferralServiceOfferData;
  platformFeeBasisPoints: number;
  platformFeeConfigVersion: number;
  acceptedByUid: string;
  acceptedByOrgId?: string;
  acceptedAt: number;
}): Record<string, unknown> {
  const compensationType = params.offer?.compensationType ?? params.referral.compensationPolicy.type;
  const snapshot: Record<string, unknown> = {
    schemaVersion: 1,
    compensationType,
    currency: params.offer?.currency ?? params.referral.compensationPolicy.currency ?? "USD",
    attributionWindowDays: params.offer?.attributionWindowDays ?? 30,
    platformFeeBasisPoints: params.platformFeeBasisPoints,
    platformFeeConfigVersion: params.platformFeeConfigVersion,
    acceptedByUid: params.acceptedByUid,
    acceptedAt: params.acceptedAt,
    calculationVersion: REFERRAL_CALCULATION_VERSION,
  };
  if (params.offer) {
    snapshot.serviceOfferId = params.offer.offerId ?? params.offer.id;
    snapshot.serviceOfferVersionId = params.offer.id;
    snapshot.serviceOfferVersion = params.offer.version;
  }
  if (params.acceptedByOrgId) snapshot.acceptedByOrgId = params.acceptedByOrgId;
  const fixedCents = params.offer?.fixedCompensationCents ?? params.referral.compensationPolicy.amountCents;
  const rate = params.offer?.compensationRateBasisPoints
    ?? params.referral.compensationPolicy.percentageBasisPoints;
  if (fixedCents !== undefined) snapshot.fixedCompensationCents = fixedCents;
  if (rate !== undefined) snapshot.compensationRateBasisPoints = rate;
  const percentageBasis = params.offer?.percentageBasis ?? params.referral.compensationPolicy.percentageBasis;
  if (percentageBasis) snapshot.percentageBasis = percentageBasis;
  if (params.offer?.payoutTrigger) snapshot.payoutTrigger = params.offer.payoutTrigger;
  if (params.offer?.paymentDeadlineDays !== undefined) {
    snapshot.paymentDeadlineDays = params.offer.paymentDeadlineDays;
  }
  if (params.offer?.refundTreatment) snapshot.refundTreatment = params.offer.refundTreatment;
  if (params.offer?.includedCharges) snapshot.includedCharges = params.offer.includedCharges;
  if (params.offer?.excludedCharges) snapshot.excludedCharges = params.offer.excludedCharges;
  const benefitDescription = params.offer?.benefitDescription
    ?? params.referral.compensationPolicy.benefitDescription;
  const customTerms = params.offer?.customTerms
    ?? (params.referral.compensationPolicy.type === "custom"
      ? params.referral.compensationPolicy.terms
      : undefined);
  if (benefitDescription) snapshot.benefitDescription = benefitDescription;
  if (customTerms) snapshot.customTerms = customTerms;
  return snapshot;
}

function contactPayload(params: {
  referralId: string;
  actorUid: string;
  now: number;
  contact: {
    type: "person" | "business";
    name?: string;
    companyName?: string;
    email?: string;
    phone?: string;
  };
  consentStatus: "not_required" | "pending" | "confirmed";
  referrerOrgId?: string;
  recipientUid?: string;
  recipientOrgId?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: params.referralId,
    referralId: params.referralId,
    type: params.contact.type,
    createdByUid: params.actorUid,
    referrerUid: params.actorUid,
    consentStatus: params.consentStatus,
    recipientDisclosureAllowed: params.consentStatus === "confirmed",
    createdAt: params.now,
    updatedAt: params.now,
  };
  if (params.contact.name) payload.name = params.contact.name;
  if (params.contact.companyName) payload.companyName = params.contact.companyName;
  if (params.contact.email) payload.email = params.contact.email.trim().toLowerCase();
  if (params.contact.phone) payload.phone = params.contact.phone;
  if (params.referrerOrgId) payload.referrerOrgId = params.referrerOrgId;
  if (params.recipientUid) payload.recipientUid = params.recipientUid;
  if (params.recipientOrgId) payload.recipientOrgId = params.recipientOrgId;
  return payload;
}

export const businessReferral_create = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(businessReferralCreateInputSchema, request.data);
  const requestFingerprint = fingerprintRequest(input);
  const db = getDb();
  const action = "business_referral.create";
  const dedupeRef = idempotencyRef(db, actor.uid, action, input.idempotencyKey);
  const referralRef = db.collection("businessReferrals").doc();
  const contactRef = db.collection("businessReferralContacts").doc(referralRef.id);

  if (
    input.recipientUid === actor.uid
    || (input.referrerOrgId && input.referrerOrgId === input.recipientOrgId)
  ) {
    throw new HttpsError("invalid-argument", "A business referral requires a distinct recipient");
  }

  return db.runTransaction(async (transaction) => {
    const dedupeSnapshot = await transaction.get(dedupeRef);
    if (input.actorOrganizationId) {
      await loadOrgAuthority(transaction, db, input.actorOrganizationId, actor.uid, {
        managementRequired: true,
      });
    }
    const priorResult = completedIdempotentResult(
      dedupeSnapshot,
      actor.uid,
      action,
      requestFingerprint,
    );
    if (priorResult) return { ...priorResult, idempotent: true };

    const recipientUserRef = input.recipientUid ? db.collection("users").doc(input.recipientUid) : undefined;
    const recipientOrgRef = input.recipientOrgId ? db.collection("orgs").doc(input.recipientOrgId) : undefined;
    const recipientMemberRef = input.recipientUid && input.recipientOrgId
      ? db.collection("orgMembers").doc(`${input.recipientOrgId}_${input.recipientUid}`)
      : undefined;
    const recipientInReferrerOrgRef = input.referrerOrgId && input.recipientUid
      ? db.collection("orgMembers").doc(`${input.referrerOrgId}_${input.recipientUid}`)
      : undefined;
    const referrerInRecipientOrgRef = input.recipientOrgId
      ? db.collection("orgMembers").doc(`${input.recipientOrgId}_${actor.uid}`)
      : undefined;
    const relatedRfxRef = input.relatedRfxId ? db.collection("rfx").doc(input.relatedRfxId) : undefined;
    const relatedTeamRef = input.relatedTeamId ? db.collection("rfxTeams").doc(input.relatedTeamId) : undefined;
    const relatedTeamActorGuardRef = input.relatedTeamId
      ? db.collection("rfxTeamMemberships").doc(input.relatedTeamId).collection("members").doc(actor.uid)
      : undefined;
    const relatedTeamRecipientGuardRef = input.relatedTeamId && input.recipientUid
      ? db.collection("rfxTeamMemberships").doc(input.relatedTeamId).collection("members").doc(input.recipientUid)
      : undefined;
    const serviceOfferRef = input.serviceOfferId
      ? db.collection("referralServiceOffers").doc(input.serviceOfferId)
      : undefined;

    const [
      recipientUserSnapshot,
      recipientOrgSnapshot,
      recipientMemberSnapshot,
      recipientInReferrerOrgSnapshot,
      referrerInRecipientOrgSnapshot,
      rfxSnapshot,
      teamSnapshot,
      teamActorGuardSnapshot,
      teamRecipientGuardSnapshot,
      serviceOfferSnapshot,
    ] = await Promise.all([
      recipientUserRef ? transaction.get(recipientUserRef) : Promise.resolve(undefined),
      recipientOrgRef ? transaction.get(recipientOrgRef) : Promise.resolve(undefined),
      recipientMemberRef ? transaction.get(recipientMemberRef) : Promise.resolve(undefined),
      recipientInReferrerOrgRef
        ? transaction.get(recipientInReferrerOrgRef)
        : Promise.resolve(undefined),
      referrerInRecipientOrgRef
        ? transaction.get(referrerInRecipientOrgRef)
        : Promise.resolve(undefined),
      relatedRfxRef ? transaction.get(relatedRfxRef) : Promise.resolve(undefined),
      relatedTeamRef ? transaction.get(relatedTeamRef) : Promise.resolve(undefined),
      relatedTeamActorGuardRef
        ? transaction.get(relatedTeamActorGuardRef)
        : Promise.resolve(undefined),
      relatedTeamRecipientGuardRef
        ? transaction.get(relatedTeamRecipientGuardRef)
        : Promise.resolve(undefined),
      serviceOfferRef ? transaction.get(serviceOfferRef) : Promise.resolve(undefined),
    ]);

    if (recipientUserRef && !recipientUserSnapshot?.exists) {
      throw new HttpsError("not-found", "Recipient account not found");
    }
    if (recipientOrgRef && (!recipientOrgSnapshot?.exists || recipientOrgSnapshot.data()?.status !== "active")) {
      throw new HttpsError("failed-precondition", "Recipient organization is unavailable");
    }
    if (recipientMemberRef) {
      const member = recipientMemberSnapshot?.data();
      if (!recipientMemberSnapshot?.exists || member?.uid !== input.recipientUid || member?.orgId !== input.recipientOrgId) {
        throw new HttpsError("invalid-argument", "Recipient user is not a member of the recipient organization");
      }
    }
    if (recipientInReferrerOrgSnapshot?.exists || referrerInRecipientOrgSnapshot?.exists) {
      throw new HttpsError("invalid-argument", "A business referral cannot be made within the same organization");
    }
    if (input.relatedOpportunityId && input.relatedOpportunityId !== input.relatedRfxId) {
      throw new HttpsError(
        "invalid-argument",
        "Only an authorized RFx may currently be used as a related opportunity",
      );
    }
    if (relatedRfxRef) {
      if (!rfxSnapshot?.exists) throw new HttpsError("not-found", "Related RFx not found");
      const rfx = rfxSnapshot.data() ?? {};
      const discoverable = rfx.status === "open" && rfx.adminApprovalStatus === "approved";
      let manageable = !Object.prototype.hasOwnProperty.call(rfx, "orgId")
        && (rfx.ownerUid === actor.uid || rfx.createdBy === actor.uid);
      if (!discoverable && typeof rfx.orgId === "string" && rfx.orgId) {
        manageable = await hasOrgAuthority(transaction, rfx.orgId, actor, true);
      }
      if (!discoverable && !manageable) {
        throw new HttpsError("permission-denied", "The related RFx is not visible to this referrer");
      }
    }
    if (relatedTeamRef) {
      if (!teamSnapshot?.exists) throw new HttpsError("not-found", "Related team not found");
      const team = teamSnapshot.data();
      const actorGuard = teamActorGuardSnapshot?.data();
      if (
        !teamActorGuardSnapshot?.exists
        || actorGuard?.teamId !== input.relatedTeamId
        || actorGuard?.uid !== actor.uid
      ) {
        throw new HttpsError("permission-denied", "Related-team membership is required");
      }
      if (input.recipientUid) {
        const recipientGuard = teamRecipientGuardSnapshot?.data();
        if (
          !teamRecipientGuardSnapshot?.exists
          || recipientGuard?.teamId !== input.relatedTeamId
          || recipientGuard?.uid !== input.recipientUid
        ) {
          throw new HttpsError(
            "failed-precondition",
            "The individual referral recipient is not a current member of the related team",
          );
        }
      }
      if (input.relatedRfxId && team?.rfxId !== input.relatedRfxId) {
        throw new HttpsError("invalid-argument", "The related team does not belong to the related RFx");
      }
    }

    const serviceOffer = input.serviceOfferId
      ? requirePublishedOffer(serviceOfferSnapshot, input.serviceOfferId)
      : undefined;
    if (serviceOffer && !offerMatchesRecipient(serviceOffer, input.recipientUid, input.recipientOrgId)) {
      throw new HttpsError(
        "invalid-argument",
        "The service offer does not belong to the selected referral recipient",
      );
    }

    const now = Date.now();
    const compensationPolicy = serviceOffer
      ? compensationForOffer(serviceOffer)
      : compensationForCreate(input.compensationPolicy);
    const referral: Record<string, unknown> = {
      id: referralRef.id,
      schemaVersion: 2,
      referrerUid: actor.uid,
      assignedStaffUids: [],
      referralType: input.referralType,
      title: input.title,
      needSummary: input.needSummary,
      consentStatus: input.consentStatus,
      status: "draft",
      compensationPolicy,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (input.referrerOrgId) referral.referrerOrgId = input.referrerOrgId;
    if (input.recipientUid) referral.recipientUid = input.recipientUid;
    if (input.recipientOrgId) referral.recipientOrgId = input.recipientOrgId;
    if (input.category) referral.category = input.category;
    if (input.naicsCodes) referral.naicsCodes = input.naicsCodes;
    if (input.territoryFips) referral.territoryFips = input.territoryFips;
    if (input.relatedRfxId) referral.relatedRfxId = input.relatedRfxId;
    if (input.relatedTeamId) referral.relatedTeamId = input.relatedTeamId;
    if (input.relatedOpportunityId) referral.relatedOpportunityId = input.relatedOpportunityId;
    if (serviceOffer) {
      referral.serviceOfferId = serviceOffer.id;
      referral.serviceOfferVersion = serviceOffer.version;
    }
    if (input.referredParty) {
      // Explicit referred-party identity stays in the separately authorized contact document.
      referral.referredPartySummary = { type: input.referredParty.type };
    }
    if (input.consentStatus === "confirmed") {
      referral.consentConfirmedAt = now;
      referral.consentConfirmedByUid = actor.uid;
    }

    transaction.create(referralRef, referral);
    if (input.referredParty) {
      transaction.create(contactRef, contactPayload({
        referralId: referralRef.id,
        actorUid: actor.uid,
        now,
        contact: input.referredParty,
        consentStatus: input.consentStatus,
        referrerOrgId: input.referrerOrgId,
        recipientUid: input.recipientUid,
        recipientOrgId: input.recipientOrgId,
      }));
    }
    setCompletedIdempotency(transaction, dedupeRef, {
      uid: actor.uid,
      action,
      entityId: referralRef.id,
      result: { referralId: referralRef.id },
      requestFingerprint,
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action,
      entityType: "businessReferral",
      entityId: referralRef.id,
      orgId: input.referrerOrgId,
      newStatus: "draft",
      metadata: {
        referralType: input.referralType,
        consentStatus: input.consentStatus,
        compensationType: compensationPolicy.type,
        hasContact: Boolean(input.referredParty),
      },
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: referralRef.id,
      eventType: "draft_created",
      actor,
      actorOrgId: input.referrerOrgId,
      referralVersion: 0,
      occurredAt: now,
      metadata: {
        referralType: input.referralType,
        compensationType: compensationPolicy.type,
        hasServiceOffer: Boolean(serviceOffer),
      },
    });
    return { referralId: referralRef.id, version: 0 };
  });
});

export const businessReferral_send = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(businessReferralSendInputSchema, request.data);
  const db = getDb();
  const referralRef = db.collection("businessReferrals").doc(input.referralId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(referralRef);
    const referral = requireReferralSnapshot(snapshot);
    await requireReferrerAuthority(
      transaction,
      referral,
      actor,
      input.actorOrganizationId,
    );
    if (referral.status === "sent") return { success: true, idempotent: true, version: getVersion(referral) };
    requireExpectedVersion(referral, input.expectedVersion);
    if (referral.status !== "draft") {
      throw new HttpsError("failed-precondition", `A ${referral.status} referral cannot be sent`);
    }
    if (referral.consentStatus === "withdrawn" || referral.consentStatus === "unknown_legacy") {
      throw new HttpsError("failed-precondition", "Consent state does not permit sending this referral");
    }

    const now = Date.now();
    const version = getVersion(referral) + 1;
    transaction.update(referralRef, {
      status: "sent",
      sentAt: now,
      expiresAt: now + BUSINESS_REFERRAL_SENT_TTL_MS,
      updatedAt: now,
      version,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "business_referral.send",
      entityType: "businessReferral",
      entityId: input.referralId,
      orgId: referral.referrerOrgId,
      previousStatus: "draft",
      newStatus: "sent",
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: input.referralId,
      eventType: "referral_sent",
      actor,
      actorOrgId: referral.referrerOrgId,
      referralVersion: version,
      occurredAt: now,
    });
    return { success: true, version };
  });
});

export const businessReferral_respond = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(businessReferralRespondInputSchema, request.data);
  const db = getDb();
  const referralRef = db.collection("businessReferrals").doc(input.referralId);
  const commerceConfigRef = db.collection("platformConfiguration").doc("referralCommerce");

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(referralRef);
    const referral = requireReferralSnapshot(snapshot);
    const financialAcceptance = input.response === "accepted"
      && (referral.compensationPolicy.type !== "none" || Boolean(referral.serviceOfferId));
    await requireRecipientAuthority(
      transaction,
      referral,
      actor,
      financialAcceptance,
      input.actorOrganizationId,
    );
    if (referral.status === input.response) {
      return { success: true, idempotent: true, version: getVersion(referral) };
    }
    requireExpectedVersion(referral, input.expectedVersion);
    if (referral.status !== "sent") {
      throw new HttpsError("failed-precondition", `A ${referral.status} referral cannot be answered`);
    }

    const now = Date.now();
    if (
      typeof referral.expiresAt !== "number"
      || !Number.isFinite(referral.expiresAt)
      || referral.expiresAt <= now
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This referral has expired or has an invalid expiration and cannot be answered",
      );
    }
    const version = getVersion(referral) + 1;
    const updates: Record<string, unknown> = {
      status: input.response,
      updatedAt: now,
      version,
      respondedAt: now,
      respondedByUid: actor.uid,
    };
    if (input.note) updates.recipientResponseNote = input.note;
    if (input.response === "accepted") {
      if (referral.schemaVersion >= 2 && input.acceptTerms?.acknowledged !== true) {
        throw new HttpsError(
          "failed-precondition",
          "The recipient must explicitly accept the locked referral terms",
        );
      }
      if (referral.acceptedTermsSnapshot) {
        throw new HttpsError("failed-precondition", "Accepted referral terms are already locked");
      }

      const [configSnapshot, offerSnapshot] = await Promise.all([
        transaction.get(commerceConfigRef),
        referral.serviceOfferId
          ? transaction.get(db.collection("referralServiceOffers").doc(referral.serviceOfferId))
          : Promise.resolve(undefined),
      ]);
      const config = referralCommerceConfig(configSnapshot);
      const offer = referral.serviceOfferId
        ? requirePublishedOffer(offerSnapshot, referral.serviceOfferId)
        : undefined;
      if (offer) {
        if (
          offer.version !== referral.serviceOfferVersion
          || input.acceptTerms?.serviceOfferId !== offer.id
          || input.acceptTerms.serviceOfferVersion !== offer.version
          || !offerMatchesRecipient(offer, referral.recipientUid, referral.recipientOrgId)
        ) {
          throw new HttpsError(
            "failed-precondition",
            "The accepted service-offer version does not match this referral",
          );
        }
      } else if (input.acceptTerms?.serviceOfferId || input.acceptTerms?.serviceOfferVersion) {
        throw new HttpsError("invalid-argument", "This referral does not use a service offer");
      }
      if (!config.commerceEnabled && referral.compensationPolicy.type !== "none") {
        throw new HttpsError("failed-precondition", "Referral commerce is not currently enabled");
      }

      updates.acceptedAt = now;
      updates.acceptedTermsSnapshot = acceptedTermsSnapshot({
        referral,
        offer,
        platformFeeBasisPoints: config.platformFeeBasisPoints,
        platformFeeConfigVersion: config.version,
        acceptedByUid: actor.uid,
        acceptedByOrgId: referral.recipientOrgId,
        acceptedAt: now,
      });
      updates.commerceStatus = "none";
      updates.compensationPolicy = {
        ...referral.compensationPolicy,
        status: referral.compensationPolicy.type === "none" ? "none" : "agreed",
        lockedAt: now,
      };
    } else if (referral.compensationPolicy.type !== "none") {
      updates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
    }

    transaction.update(referralRef, updates);
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: `business_referral.${input.response}`,
      entityType: "businessReferral",
      entityId: input.referralId,
      orgId: referral.recipientOrgId,
      previousStatus: "sent",
      newStatus: input.response,
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: input.referralId,
      eventType: input.response === "accepted" ? "recipient_accepted" : "recipient_declined",
      actor,
      actorOrgId: referral.recipientOrgId,
      referralVersion: version,
      occurredAt: now,
    });
    if (input.response === "accepted") {
      writeReferralTimeline(transaction, db, {
        referralId: input.referralId,
        eventType: "terms_snapshot_locked",
        actor,
        actorOrgId: referral.recipientOrgId,
        referralVersion: version,
        occurredAt: now,
        metadata: {
          compensationType: referral.compensationPolicy.type,
          platformFeeBasisPoints: (
            updates.acceptedTermsSnapshot as Record<string, number>
          ).platformFeeBasisPoints,
        },
      });
    }
    return { success: true, version };
  });
});

export const businessReferral_progress = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(businessReferralProgressInputSchema, request.data);
  const db = getDb();
  const referralRef = db.collection("businessReferrals").doc(input.referralId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(referralRef);
    const referral = requireReferralSnapshot(snapshot);
    if (input.status === "withdrawn") {
      await requireReferrerAuthority(
        transaction,
        referral,
        actor,
        input.actorOrganizationId,
      );
    } else {
      await requireRecipientAuthority(
        transaction,
        referral,
        actor,
        false,
        input.actorOrganizationId,
      );
    }
    if (referral.status === input.status) {
      return { success: true, idempotent: true, version: getVersion(referral) };
    }
    requireExpectedVersion(referral, input.expectedVersion);
    if (referral.activeDisputeId) {
      throw new HttpsError("failed-precondition", "Resolve the active dispute before progressing the referral");
    }

    const allowed = input.status === "in_progress"
      ? referral.status === "accepted"
      : input.status === "withdrawn"
        ? referral.status === "draft" || referral.status === "sent"
        : input.status === "closed"
          ? referral.status === "accepted" || referral.status === "in_progress"
          : referral.status === "in_progress";
    if (!allowed) {
      throw new HttpsError(
        "failed-precondition",
        `Referral cannot transition from ${referral.status} to ${input.status}`,
      );
    }

    const now = Date.now();
    const version = getVersion(referral) + 1;
    const updates: Record<string, unknown> = { status: input.status, updatedAt: now, version };
    if (input.status === "in_progress") updates.inProgressAt = now;
    if (input.status === "converted" || input.status === "closed") {
      updates.closedAt = now;
      if (input.status === "converted") updates.convertedAt = now;
      updates.outcome = {
        ...input.outcome!,
        recordedAt: now,
        recordedByUid: actor.uid,
      };
    }
    if (input.status === "withdrawn") {
      updates.withdrawnAt = now;
      updates.withdrawnByUid = actor.uid;
    }

    if (referral.compensationPolicy.type !== "none") {
      if (input.status === "converted" && referral.compensationPolicy.status === "agreed") {
        updates.commerceStatus = referral.compensationPolicy.type === "benefit"
          ? "none"
          : "awaiting_transaction";
      } else if (input.status === "closed" || input.status === "withdrawn") {
        updates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
        updates.commerceStatus = "cancelled";
      }
    }

    transaction.update(referralRef, updates);
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: `business_referral.${input.status}`,
      entityType: "businessReferral",
      entityId: input.referralId,
      orgId: input.status === "withdrawn" ? referral.referrerOrgId : referral.recipientOrgId,
      previousStatus: referral.status,
      newStatus: input.status,
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: input.referralId,
      eventType: input.status === "converted"
        ? "referral_converted"
        : input.status === "closed"
          ? "referral_closed"
          : input.status === "withdrawn"
            ? "referral_withdrawn"
            : "progress_changed",
      actor,
      actorOrgId: input.status === "withdrawn" ? referral.referrerOrgId : referral.recipientOrgId,
      referralVersion: version,
      occurredAt: now,
      metadata: { status: input.status },
    });
    return { success: true, version };
  });
});

async function updateConsent(
  request: CallableRequest<unknown>,
  forcedStatus?: "confirmed" | "withdrawn",
): Promise<{ success: true; version: number; status: BusinessReferralStatus }> {
  const actor = getAuthorizedActor(request);
  const raw = typeof request.data === "object" && request.data !== null
    ? { ...(request.data as Record<string, unknown>), ...(forcedStatus ? { consentStatus: forcedStatus } : {}) }
    : request.data;
  const input = parseCallableInput(businessReferralConsentInputSchema, raw);
  const db = getDb();
  const referralRef = db.collection("businessReferrals").doc(input.referralId);
  const contactRef = db.collection("businessReferralContacts").doc(input.referralId);

  return db.runTransaction(async (transaction) => {
    const [referralSnapshot, contactSnapshot] = await Promise.all([
      transaction.get(referralRef),
      transaction.get(contactRef),
    ]);
    const referral = requireReferralSnapshot(referralSnapshot);
    await requireReferrerAuthority(transaction, referral, actor);
    if (!contactSnapshot.exists) {
      throw new HttpsError("failed-precondition", "This referral has no third-party contact record");
    }
    if (referral.consentStatus === input.consentStatus) {
      return { success: true, version: getVersion(referral), status: referral.status };
    }
    requireExpectedVersion(referral, input.expectedVersion);
    if (input.consentStatus === "confirmed" && referral.consentStatus !== "pending") {
      throw new HttpsError("failed-precondition", "Only pending consent can be confirmed");
    }
    if (
      input.consentStatus === "confirmed"
      && !["draft", "sent", "accepted", "in_progress"].includes(referral.status)
    ) {
      throw new HttpsError("failed-precondition", "Consent cannot disclose contact details after referral closure");
    }
    if (
      input.consentStatus === "withdrawn"
      && referral.consentStatus !== "pending"
      && referral.consentStatus !== "confirmed"
    ) {
      throw new HttpsError("failed-precondition", "Consent cannot be withdrawn from its current state");
    }

    const now = Date.now();
    const version = getVersion(referral) + 1;
    let nextStatus = referral.status;
    const referralUpdates: Record<string, unknown> = {
      consentStatus: input.consentStatus,
      updatedAt: now,
      version,
    };
    if (input.consentStatus === "confirmed") {
      referralUpdates.consentConfirmedAt = now;
      referralUpdates.consentConfirmedByUid = actor.uid;
    } else {
      referralUpdates.consentWithdrawnAt = now;
      referralUpdates.consentWithdrawnByUid = actor.uid;
      if (["draft", "sent", "accepted", "in_progress"].includes(referral.status)) {
        nextStatus = "withdrawn";
        referralUpdates.status = "withdrawn";
        referralUpdates.withdrawnAt = now;
        referralUpdates.withdrawnByUid = actor.uid;
        if (referral.compensationPolicy.type !== "none") {
          referralUpdates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
        }
      }
    }

    transaction.update(referralRef, referralUpdates);
    transaction.update(contactRef, {
      consentStatus: input.consentStatus,
      recipientDisclosureAllowed: input.consentStatus === "confirmed",
      updatedAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: `business_referral.consent_${input.consentStatus}`,
      entityType: "businessReferral",
      entityId: input.referralId,
      orgId: referral.referrerOrgId,
      previousStatus: referral.status,
      newStatus: nextStatus,
      metadata: { previousConsent: referral.consentStatus, newConsent: input.consentStatus },
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: input.referralId,
      eventType: input.consentStatus === "confirmed" ? "consent_confirmed" : "consent_withdrawn",
      actor,
      actorOrgId: referral.referrerOrgId,
      referralVersion: version,
      occurredAt: now,
      metadata: { disclosureAllowed: input.consentStatus === "confirmed" },
    });
    return { success: true, version, status: nextStatus };
  });
}

export const businessReferral_updateConsent = onCall((request) => updateConsent(request));
export const businessReferral_confirmConsent = onCall((request) => updateConsent(request, "confirmed"));
export const businessReferral_withdrawConsent = onCall((request) => updateConsent(request, "withdrawn"));

/**
 * Materialize a one-minute, exact-path Storage decision after evaluating the
 * full current referral and organization authority graph server-side.
 */
export const businessReferral_prepareEvidenceAccess = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(referralEvidenceAccessInputSchema, request.data);
  requireReferralEvidenceGrantPaths(
    input.referralId,
    actor.uid,
    input.operation,
    input.storagePaths,
  );

  const db = getDb();
  const referralRef = db.collection("businessReferrals").doc(input.referralId);
  const grantRef = referralStorageGrantRef(db, input.referralId, actor.uid);
  return db.runTransaction(async (transaction) => {
    const referralSnapshot = await transaction.get(referralRef);
    const referral = requireReferralSnapshot(referralSnapshot);

    if (input.operation === "upload") {
      await requirePartyAuthority(transaction, referral, actor);
    } else {
      let mayReadWithoutConsent = actor.isAdmin
        || (actor.role === "staff" && referral.assignedStaffUids?.includes(actor.uid))
        || isIndividualReferrer(referral, actor.uid);
      if (!mayReadWithoutConsent) {
        mayReadWithoutConsent = await hasReferralOrgAuthority(
          transaction,
          referral.referrerOrgId,
          actor,
        );
      }
      if (!mayReadWithoutConsent) {
        if (!(["confirmed", "not_required"] as string[]).includes(referral.consentStatus)) {
          throw new HttpsError(
            "permission-denied",
            "Confirmed referral consent is required to read this evidence",
          );
        }
        await requirePartyAuthority(transaction, referral, actor);
      }
    }

    const now = Date.now();
    const expiresAt = now + BUSINESS_REFERRAL_STORAGE_GRANT_TTL_MS;
    transaction.set(grantRef, {
      id: actor.uid,
      grantType: "business_referral_storage",
      referralId: input.referralId,
      accessorUid: actor.uid,
      allowedReadStoragePaths: input.operation === "read" ? input.storagePaths : [],
      allowedCreateStoragePaths: input.operation === "upload" ? input.storagePaths : [],
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: `business_referral.evidence_${input.operation}_grant_prepared`,
      entityType: "businessReferral",
      entityId: input.referralId,
      metadata: { pathCount: input.storagePaths.length },
      createdAt: now,
    });
    return {
      success: true,
      operation: input.operation,
      expiresAt,
      allowedPathCount: input.storagePaths.length,
    };
  });
});

export const businessReferral_createDispute = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(referralDisputeCreateInputSchema, request.data);
  assertCanonicalDisputeEvidencePaths(input.referralId, actor.uid, input.evidenceStoragePaths);
  await verifyDisputeEvidence(input.evidenceStoragePaths);

  const db = getDb();
  const referralRef = db.collection("businessReferrals").doc(input.referralId);
  const disputeRef = db.collection("businessReferralDisputes").doc();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(referralRef);
    const referral = requireReferralSnapshot(snapshot);
    await requirePartyAuthority(transaction, referral, actor);
    if (input.expectedVersion !== undefined) {
      requireExpectedVersion(referral, input.expectedVersion);
    }
    if (!["accepted", "in_progress", "converted", "closed"].includes(referral.status)) {
      throw new HttpsError("failed-precondition", "The referral is not in a disputable state");
    }
    if (referral.activeDisputeId) {
      throw new HttpsError("already-exists", "This referral already has an active dispute", {
        disputeId: referral.activeDisputeId,
      });
    }

    const now = Date.now();
    const version = getVersion(referral) + 1;
    transaction.create(disputeRef, {
      id: disputeRef.id,
      referralId: input.referralId,
      openerUid: actor.uid,
      referrerUid: referral.referrerUid,
      recipientUid: referral.recipientUid ?? null,
      referrerOrgId: referral.referrerOrgId ?? null,
      recipientOrgId: referral.recipientOrgId ?? null,
      assignedStaffUids: referral.assignedStaffUids ?? [],
      reason: input.reason,
      evidenceStoragePaths: input.evidenceStoragePaths,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    const referralUpdates: Record<string, unknown> = {
      activeDisputeId: disputeRef.id,
      version,
      updatedAt: now,
    };
    if (typeof referral.commerceStatus === "string") {
      referralUpdates.commerceStatusBeforeDispute = referral.commerceStatus;
      referralUpdates.commerceStatus = "disputed";
    }
    if (referral.compensationPolicy.type !== "none") {
      referralUpdates.compensationStatusBeforeDispute = referral.compensationPolicy.status;
      referralUpdates.compensationPolicy = { ...referral.compensationPolicy, status: "disputed" };
    }
    transaction.update(referralRef, referralUpdates);
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "business_referral.dispute_opened",
      entityType: "businessReferral",
      entityId: input.referralId,
      metadata: { disputeId: disputeRef.id, evidenceCount: input.evidenceStoragePaths.length },
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: input.referralId,
      eventType: "dispute_opened",
      actor,
      actorOrgId: isIndividualReferrer(referral, actor.uid)
        ? referral.referrerOrgId
        : referral.recipientOrgId,
      referralVersion: version,
      occurredAt: now,
      metadata: { evidenceCount: input.evidenceStoragePaths.length },
    });
    return { success: true, disputeId: disputeRef.id };
  });
});

export const businessReferral_resolveDispute = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  requireStaffOrAdmin(actor);
  const input = parseCallableInput(disputeResolveInputSchema, request.data);
  const db = getDb();
  const disputeRef = db.collection("businessReferralDisputes").doc(input.disputeId);

  return db.runTransaction(async (transaction) => {
    const disputeSnapshot = await transaction.get(disputeRef);
    if (!disputeSnapshot.exists) throw new HttpsError("not-found", "Dispute not found");
    const dispute = disputeSnapshot.data() ?? {};
    if (typeof dispute.referralId !== "string") {
      throw new HttpsError("failed-precondition", "Dispute referral identity is invalid");
    }
    const referralRef = db.collection("businessReferrals").doc(dispute.referralId);
    const referralSnapshot = await transaction.get(referralRef);
    const referral = requireReferralSnapshot(referralSnapshot);
    if (!actor.isAdmin && !referral.assignedStaffUids?.includes(actor.uid)) {
      throw new HttpsError("permission-denied", "The dispute must be assigned to this staff member");
    }
    if (!actor.isAdmin && dispute.openerUid === actor.uid) {
      throw new HttpsError("permission-denied", "The dispute opener cannot resolve their own dispute");
    }
    if (dispute.status !== "open" && dispute.status !== "under_review") {
      return { success: true, idempotent: true, status: dispute.status as string };
    }
    if (referral.activeDisputeId !== input.disputeId) {
      throw new HttpsError(
        "failed-precondition",
        "This dispute is not the referral's current active dispute",
      );
    }

    const now = Date.now();
    const resolutionStatus = `resolved_${input.resolution}`;
    transaction.update(disputeRef, {
      status: resolutionStatus,
      resolutionNote: input.note,
      resolvedAt: now,
      resolvedByUid: actor.uid,
      updatedAt: now,
    });

    const storedCompensationStatus = referral.compensationStatusBeforeDispute;
    const restoredCompensationStatus = typeof storedCompensationStatus === "string"
      && RESTORABLE_COMPENSATION_STATUSES.has(
        storedCompensationStatus as BusinessReferralDocData["compensationPolicy"]["status"],
      )
      ? storedCompensationStatus
      : "agreed";
    const compensationStatus = ["closed", "declined", "withdrawn", "expired"].includes(referral.status)
      || input.resolution === "upheld"
      ? "cancelled"
      : restoredCompensationStatus;
    const version = getVersion(referral) + 1;
    const updates: Record<string, unknown> = {
      activeDisputeId: FieldValue.delete(),
      compensationStatusBeforeDispute: FieldValue.delete(),
      commerceStatusBeforeDispute: FieldValue.delete(),
      version,
      updatedAt: now,
    };
    const priorCommerceStatus = typeof referral.commerceStatusBeforeDispute === "string"
      ? referral.commerceStatusBeforeDispute
      : undefined;
    if (typeof referral.commerceStatus === "string") {
      updates.commerceStatus = input.resolution === "upheld"
        ? "cancelled"
        : priorCommerceStatus ?? "settlement_unavailable";
    }
    if (referral.compensationPolicy.type !== "none") {
      updates.compensationPolicy = {
        ...referral.compensationPolicy,
        status: compensationStatus,
      };
    }
    transaction.update(referralRef, updates);
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "business_referral.dispute_resolved",
      entityType: "businessReferral",
      entityId: dispute.referralId,
      metadata: { disputeId: input.disputeId, resolution: input.resolution },
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: dispute.referralId,
      eventType: "dispute_resolved",
      actor,
      referralVersion: version,
      occurredAt: now,
      metadata: { resolution: input.resolution },
    });
    return { success: true, status: resolutionStatus };
  });
});

async function expireSentReferral(
  referralRef: FirebaseFirestore.DocumentReference,
  now: number,
): Promise<boolean> {
  const db = getDb();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(referralRef);
    if (!snapshot.exists) return false;
    const referral = requireReferralSnapshot(snapshot);
    const expiresAt = typeof referral.expiresAt === "number" ? referral.expiresAt : null;
    if (referral.status !== "sent" || expiresAt === null || expiresAt > now) return false;

    const version = getVersion(referral) + 1;
    const updates: Record<string, unknown> = {
      status: "expired",
      expiredAt: now,
      updatedAt: now,
      version,
    };
    if (referral.compensationPolicy.type !== "none") {
      updates.compensationPolicy = { ...referral.compensationPolicy, status: "cancelled" };
    }
    transaction.update(referralRef, updates);
    writeExchangeAudit(transaction, db, {
      actorUid: "system",
      actorRole: "system",
      action: "business_referral.expired",
      entityType: "businessReferral",
      entityId: referralRef.id,
      previousStatus: "sent",
      newStatus: "expired",
      createdAt: now,
    });
    writeReferralTimeline(transaction, db, {
      referralId: referralRef.id,
      eventType: "referral_expired",
      actor: { uid: "system", role: "system" },
      referralVersion: version,
      occurredAt: now,
    });
    return true;
  });
}

export async function cleanupExpiredBusinessReferralStorageGrantAt(
  grantRef: FirebaseFirestore.DocumentReference,
  now: number,
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(grantRef);
    if (!currentSnapshot.exists) return false;
    const current = currentSnapshot.data() ?? {};
    if (
      current.grantType !== "business_referral_storage"
      || typeof current.expiresAt !== "number"
      || !Number.isFinite(current.expiresAt)
      || current.expiresAt > now
    ) return false;
    transaction.delete(grantRef);
    return true;
  });
}

/** Bounded expiry worker for unanswered business introductions. */
export const businessReferral_expireSent = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getDb();
    const now = Date.now();
    const snapshot = await db.collection("businessReferrals")
      .where("status", "==", "sent")
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt", "asc")
      .limit(MAX_REFERRAL_EXPIRATIONS_PER_RUN)
      .get();
    const outcomes = await Promise.all(
      snapshot.docs.map((document) => expireSentReferral(document.ref, now)),
    );
    const storageGrantSnapshot = await db.collectionGroup("storageGrants")
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt", "asc")
      .limit(MAX_REFERRAL_EXPIRATIONS_PER_RUN)
      .get();
    const storageGrantOutcomes = await Promise.all(
      storageGrantSnapshot.docs.map((document) => (
        cleanupExpiredBusinessReferralStorageGrantAt(document.ref, now, db)
      )),
    );
    logger.info("Business referral expiry completed", {
      scanned: snapshot.size,
      expired: outcomes.filter(Boolean).length,
      maxPerRun: MAX_REFERRAL_EXPIRATIONS_PER_RUN,
      storageGrantsScanned: storageGrantSnapshot.size,
      storageGrantsRemoved: storageGrantOutcomes.filter(Boolean).length,
    });
  },
);
