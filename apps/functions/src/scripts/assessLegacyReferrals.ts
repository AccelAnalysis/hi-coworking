import * as admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { getDb, writeExchangeAudit } from "../exchange/security";

if (!admin.apps.length) admin.initializeApp();

type Classification = "platform_invite" | "business_intro" | "ambiguous" | "invalid";

export interface AssessmentOptions {
  apply?: boolean;
  confirmProject?: string;
  limit?: number;
  pageSize?: number;
}

export interface LegacyReferralAssessmentReport {
  projectId: string;
  dryRun: boolean;
  totalScanned: number;
  platformInvite: number;
  businessIntro: number;
  inferredPlatformInvite: number;
  inferredBusinessIntro: number;
  ambiguous: number;
  invalid: number;
  eligibleForCopy: number;
  alreadyMapped: number;
  copied: number;
  failed: number;
  invalidReasons: Record<string, number>;
}

interface ClassificationResult {
  classification: Classification;
  eligibleForCopy: boolean;
  reason?: string;
  inferred?: boolean;
}

const LEGACY_STATUSES = new Set([
  "pending",
  "contacted",
  "accepted",
  "declined",
  "converted",
  "expired",
  "disputed",
  "paid",
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function classifyLegacyReferral(data: FirebaseFirestore.DocumentData): ClassificationResult {
  const platformSignals = nonEmptyString(data.referredEmail) || nonEmptyString(data.invitedEmail);
  const businessSignals = nonEmptyString(data.providerUid)
    || nonEmptyString(data.clientName)
    || nonEmptyString(data.clientEmail)
    || nonEmptyString(data.clientCompany);

  if (!nonEmptyString(data.referrerUid)) {
    return { classification: "invalid", eligibleForCopy: false, reason: "missing_referrer_uid" };
  }
  if (!LEGACY_STATUSES.has(data.status)) {
    return { classification: "invalid", eligibleForCopy: false, reason: "invalid_status" };
  }

  const missingType = data.type === undefined || data.type === null || data.type === "";
  if (missingType) {
    if (platformSignals && businessSignals) {
      return {
        classification: "ambiguous",
        eligibleForCopy: false,
        reason: "untyped_mixed_platform_and_business_fields",
      };
    }
    if (platformSignals) {
      return {
        classification: "platform_invite",
        eligibleForCopy: false,
        reason: "inferred_untyped_platform_invite",
        inferred: true,
      };
    }
    if (businessSignals) {
      if (!nonEmptyString(data.providerUid)) {
        return { classification: "invalid", eligibleForCopy: false, reason: "missing_recipient_uid" };
      }
      if (data.providerUid === data.referrerUid) {
        return { classification: "invalid", eligibleForCopy: false, reason: "self_referral" };
      }
      return {
        classification: "business_intro",
        eligibleForCopy: true,
        reason: "inferred_untyped_business_intro",
        inferred: true,
      };
    }
    return { classification: "invalid", eligibleForCopy: false, reason: "unrecognizable_shape" };
  }
  if (data.type !== "platform_invite" && data.type !== "business_intro") {
    return { classification: "ambiguous", eligibleForCopy: false, reason: "unknown_explicit_type" };
  }

  if (data.type === "platform_invite") {
    if (!platformSignals || businessSignals) {
      return {
        classification: platformSignals && businessSignals ? "ambiguous" : "invalid",
        eligibleForCopy: false,
        reason: platformSignals && businessSignals ? "mixed_platform_and_business_fields" : "missing_invited_email",
      };
    }
    return { classification: "platform_invite", eligibleForCopy: false };
  }

  if (platformSignals) {
    return {
      classification: "ambiguous",
      eligibleForCopy: false,
      reason: "business_intro_contains_platform_fields",
    };
  }
  if (!nonEmptyString(data.providerUid)) {
    return { classification: "invalid", eligibleForCopy: false, reason: "missing_recipient_uid" };
  }
  if (data.providerUid === data.referrerUid) {
    return { classification: "invalid", eligibleForCopy: false, reason: "self_referral" };
  }
  return { classification: "business_intro", eligibleForCopy: true };
}

function migratedStatus(status: string): {
  status: "draft" | "accepted" | "declined" | "converted" | "expired";
  outcome?: Record<string, unknown>;
} {
  switch (status) {
    case "accepted":
      return { status: "accepted" };
    case "declined":
      return { status: "declined" };
    case "converted":
    case "paid":
      return { status: "converted" };
    case "expired":
      return { status: "expired" };
    default:
      return { status: "draft" };
  }
}

function businessReferralPayload(
  legacyId: string,
  data: FirebaseFirestore.DocumentData,
  targetId: string,
  now: number,
): Record<string, unknown> {
  const status = migratedStatus(data.status);
  const createdAt = finiteTimestamp(data.createdAt, now);
  const payload: Record<string, unknown> = {
    id: targetId,
    schemaVersion: 1,
    referrerUid: data.referrerUid,
    recipientUid: data.providerUid,
    assignedStaffUids: [],
    referralType: "business_lead",
    title: "Legacy business referral",
    needSummary: "Imported legacy business referral; consent and commercial details require review.",
    consentStatus: "unknown_legacy",
    status: status.status,
    compensationPolicy: { type: "none", status: "none" },
    version: 0,
    createdAt,
    updatedAt: now,
    legacyReferralId: legacyId,
    legacyImportState: "needs_review",
    legacyStatus: data.status,
    legacyCompensationReviewRequired: Boolean(
      data.policySnapshot || data.payoutMethod || data.payoutPaymentId || data.payoutProofUrl,
    ),
  };
  if (nonEmptyString(data.clientCompany)) {
    payload.referredPartySummary = { type: "business" };
  } else if (data.clientName || data.clientEmail || data.clientPhone) {
    payload.referredPartySummary = { type: "person" };
  }
  if (status.status === "accepted") payload.acceptedAt = finiteTimestamp(data.acceptedAt, createdAt);
  if (status.status === "converted") {
    const recordedAt = finiteTimestamp(data.convertedAt ?? data.paidAt ?? data.updatedAt, createdAt);
    payload.acceptedAt = finiteTimestamp(data.acceptedAt, recordedAt);
    payload.closedAt = recordedAt;
    payload.outcome = {
      type: "converted",
      summary: "Imported from a legacy conversion state; requires administrative review.",
      recordedAt,
      recordedByUid: "system:legacy-referral-migration",
    };
  }
  return payload;
}

function contactPayload(
  legacyId: string,
  targetId: string,
  data: FirebaseFirestore.DocumentData,
  now: number,
): Record<string, unknown> | null {
  const hasContact = nonEmptyString(data.clientName)
    || nonEmptyString(data.clientCompany)
    || nonEmptyString(data.clientEmail)
    || nonEmptyString(data.clientPhone);
  if (!hasContact) return null;

  const payload: Record<string, unknown> = {
    id: targetId,
    referralId: targetId,
    type: nonEmptyString(data.clientCompany) ? "business" : "person",
    createdByUid: "system:legacy-referral-migration",
    referrerUid: data.referrerUid,
    recipientUid: data.providerUid,
    consentStatus: "unknown_legacy",
    recipientDisclosureAllowed: false,
    legacyReferralId: legacyId,
    createdAt: now,
    updatedAt: now,
  };
  if (nonEmptyString(data.clientName)) payload.name = data.clientName.trim().slice(0, 160);
  if (nonEmptyString(data.clientCompany)) payload.companyName = data.clientCompany.trim().slice(0, 200);
  if (nonEmptyString(data.clientEmail)) payload.email = data.clientEmail.trim().toLowerCase().slice(0, 320);
  if (nonEmptyString(data.clientPhone)) payload.phone = data.clientPhone.trim().slice(0, 40);
  return payload;
}

async function copyBusinessReferral(
  legacySnapshot: FirebaseFirestore.QueryDocumentSnapshot,
): Promise<"copied" | "already_mapped"> {
  const db = getDb();
  const legacyId = legacySnapshot.id;
  const targetId = `legacy_${legacyId}`;
  const mappingRef = db.collection("legacyReferralMappings").doc(legacyId);
  const targetRef = db.collection("businessReferrals").doc(targetId);
  const contactRef = db.collection("businessReferralContacts").doc(targetId);

  return db.runTransaction(async (transaction) => {
    const [sourceSnapshot, mappingSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(legacySnapshot.ref),
      transaction.get(mappingRef),
      transaction.get(targetRef),
    ]);
    if (mappingSnapshot.exists) return "already_mapped";
    if (!sourceSnapshot.exists) throw new Error(`Legacy referral ${legacyId} no longer exists`);
    if (targetSnapshot.exists) {
      throw new Error(`Target ${targetId} exists without an idempotency mapping`);
    }

    const now = Date.now();
    const data = sourceSnapshot.data() ?? {};
    if (!classifyLegacyReferral(data).eligibleForCopy) {
      throw new Error(`Legacy referral ${legacyId} is no longer eligible for copying`);
    }
    transaction.create(targetRef, businessReferralPayload(legacyId, data, targetId, now));
    const contact = contactPayload(legacyId, targetId, data, now);
    if (contact) transaction.create(contactRef, contact);
    transaction.create(mappingRef, {
      legacyReferralId: legacyId,
      classification: "business_intro",
      targetCollection: "businessReferrals",
      targetId,
      consentStatus: "unknown_legacy",
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: "system:legacy-referral-migration",
      actorRole: "system",
      action: "business_referral.legacy_copied",
      entityType: "businessReferral",
      entityId: targetId,
      metadata: { legacyReferralId: legacyId, consentStatus: "unknown_legacy" },
      createdAt: now,
    });
    return "copied";
  });
}

function incrementReason(report: LegacyReferralAssessmentReport, reason?: string): void {
  if (!reason) return;
  report.invalidReasons[reason] = (report.invalidReasons[reason] ?? 0) + 1;
}

export async function assessLegacyReferrals(
  options: AssessmentOptions = {},
): Promise<LegacyReferralAssessmentReport> {
  const db = getDb();
  const apply = options.apply === true;
  const pageSize = Math.min(Math.max(options.pageSize ?? 250, 1), 500);
  const limit = Math.max(options.limit ?? Number.MAX_SAFE_INTEGER, 0);
  const projectId = String(
    admin.app().options.projectId
      ?? process.env.GCLOUD_PROJECT
      ?? process.env.GOOGLE_CLOUD_PROJECT
      ?? "unknown",
  );

  if (apply && projectId === "unknown") {
    throw new Error("--apply requires a resolved Firebase project ID");
  }
  if (apply && (!options.confirmProject || options.confirmProject !== projectId)) {
    throw new Error(`--apply requires --confirm-project=${projectId}`);
  }

  const report: LegacyReferralAssessmentReport = {
    projectId,
    dryRun: !apply,
    totalScanned: 0,
    platformInvite: 0,
    businessIntro: 0,
    inferredPlatformInvite: 0,
    inferredBusinessIntro: 0,
    ambiguous: 0,
    invalid: 0,
    eligibleForCopy: 0,
    alreadyMapped: 0,
    copied: 0,
    failed: 0,
    invalidReasons: {},
  };

  let lastDocument: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (report.totalScanned < limit) {
    const remaining = limit - report.totalScanned;
    let query = db
      .collection("referrals")
      .orderBy(FieldPath.documentId())
      .limit(Math.min(pageSize, remaining));
    if (lastDocument) query = query.startAfter(lastDocument);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const document of snapshot.docs) {
      report.totalScanned += 1;
      const result = classifyLegacyReferral(document.data());
      if (result.classification === "platform_invite") report.platformInvite += 1;
      else if (result.classification === "business_intro") report.businessIntro += 1;
      else if (result.classification === "ambiguous") report.ambiguous += 1;
      else report.invalid += 1;
      if (result.inferred && result.classification === "platform_invite") {
        report.inferredPlatformInvite += 1;
      }
      if (result.inferred && result.classification === "business_intro") {
        report.inferredBusinessIntro += 1;
      }
      incrementReason(report, result.reason);

      if (result.eligibleForCopy) {
        report.eligibleForCopy += 1;
        const mappingSnapshot = await db.collection("legacyReferralMappings").doc(document.id).get();
        if (mappingSnapshot.exists) {
          report.alreadyMapped += 1;
        } else if (apply) {
          try {
            const outcome = await copyBusinessReferral(document);
            if (outcome === "already_mapped") report.alreadyMapped += 1;
            else report.copied += 1;
          } catch (error) {
            report.failed += 1;
            console.error("[assessLegacyReferrals] copy failed", {
              legacyReferralId: document.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    lastDocument = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < Math.min(pageSize, remaining)) break;
  }

  return report;
}

function parsePositiveIntegerFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const valueFor = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const options: AssessmentOptions = {
    apply: args.includes("--apply"),
    confirmProject: valueFor("--confirm-project"),
    limit: parsePositiveIntegerFlag(valueFor("--limit"), "--limit"),
    pageSize: parsePositiveIntegerFlag(valueFor("--page-size"), "--page-size"),
  };

  assessLegacyReferrals(options)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.failed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error("[assessLegacyReferrals] failed", error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
