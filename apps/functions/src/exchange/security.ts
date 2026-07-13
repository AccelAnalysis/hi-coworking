import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

export type PlatformRole =
  | "master"
  | "admin"
  | "staff"
  | "member"
  | "externalVendor"
  | "econPartner";

export type EligibilityReasonCode =
  | "ELIGIBLE"
  | "AUTH_REQUIRED"
  | "PROFILE_REQUIRED"
  | "VERIFICATION_REQUIRED"
  | "TERRITORY_UNKNOWN"
  | "TERRITORY_UNRELEASED"
  | "PLAN_REQUIRED"
  | "INSUFFICIENT_CREDITS"
  | "ORG_PERMISSION_REQUIRED"
  | "STATUS_NOT_ALLOWED";

export interface TransactionEligibility {
  allowed: boolean;
  reasonCode: EligibilityReasonCode;
  message: string;
}

export interface AuthorizedActor {
  uid: string;
  role: PlatformRole;
  isAdmin: boolean;
  email?: string;
}

export interface EligibilityContext {
  result: TransactionEligibility;
  user?: FirebaseFirestore.DocumentData;
  profile?: FirebaseFirestore.DocumentData;
  territory?: FirebaseFirestore.DocumentData;
  org?: FirebaseFirestore.DocumentData;
  orgMember?: FirebaseFirestore.DocumentData;
}

const PLATFORM_ROLES = new Set<PlatformRole>([
  "master",
  "admin",
  "staff",
  "member",
  "externalVendor",
  "econPartner",
]);

export function getAuthorizedActor(request: CallableRequest<unknown>): AuthorizedActor {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }

  const rawRole = request.auth.token.role;
  const role = typeof rawRole === "string" && PLATFORM_ROLES.has(rawRole as PlatformRole)
    ? (rawRole as PlatformRole)
    : "member";

  return {
    uid: request.auth.uid,
    role,
    isAdmin: role === "admin" || role === "master",
    email: typeof request.auth.token.email === "string" ? request.auth.token.email : undefined,
  };
}

export function requireStaffOrAdmin(actor: AuthorizedActor): void {
  if (!actor.isAdmin && actor.role !== "staff") {
    throw new HttpsError("permission-denied", "Staff authorization is required");
  }
}

export function requireAdmin(actor: AuthorizedActor): void {
  if (!actor.isAdmin) {
    throw new HttpsError("permission-denied", "Administrator authorization is required");
  }
}

export function isOrgManagementRole(role: unknown): boolean {
  return role === "owner" || role === "admin";
}

export async function loadOrgAuthority(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
  options: { managementRequired?: boolean } = {},
): Promise<{ org: FirebaseFirestore.DocumentData; member: FirebaseFirestore.DocumentData }> {
  const orgRef = db.collection("orgs").doc(orgId);
  const memberRef = db.collection("orgMembers").doc(`${orgId}_${uid}`);
  const [orgSnap, memberSnap] = await Promise.all([
    transaction.get(orgRef),
    transaction.get(memberRef),
  ]);

  const org = orgSnap.data();
  const member = memberSnap.data();
  if (!orgSnap.exists || !org || org.status !== "active" || !memberSnap.exists || !member) {
    throw new HttpsError("permission-denied", "Active organization membership is required");
  }
  if (member.orgId !== orgId || member.uid !== uid) {
    throw new HttpsError("permission-denied", "Organization membership is invalid");
  }
  if (options.managementRequired && !isOrgManagementRole(member.role)) {
    throw new HttpsError("permission-denied", "Organization owner or administrator access is required");
  }
  return { org, member };
}

export async function evaluateTransactionEligibility(params: {
  transaction: FirebaseFirestore.Transaction;
  db: FirebaseFirestore.Firestore;
  actor: AuthorizedActor;
  territoryFips: string;
  orgId?: string;
  requireVerification?: boolean;
  requirePlan?: boolean;
  requiredCredits?: number;
  permittedRoles?: PlatformRole[];
  adminOverrideReason?: string;
}): Promise<EligibilityContext> {
  const {
    transaction,
    db,
    actor,
    territoryFips,
    orgId,
    requireVerification = true,
    requirePlan = false,
    requiredCredits = 0,
    permittedRoles = ["member", "externalVendor", "econPartner"],
    adminOverrideReason,
  } = params;

  const userRef = db.collection("users").doc(actor.uid);
  const profileRef = db.collection("profiles").doc(actor.uid);
  const territoryRef = db.collection("territories").doc(territoryFips);
  const [userSnap, profileSnap, territorySnap] = await Promise.all([
    transaction.get(userRef),
    transaction.get(profileRef),
    transaction.get(territoryRef),
  ]);

  const user = userSnap.data();
  const profile = profileSnap.data();
  const territory = territorySnap.data();

  let org: FirebaseFirestore.DocumentData | undefined;
  let orgMember: FirebaseFirestore.DocumentData | undefined;
  if (orgId) {
    try {
      const authority = await loadOrgAuthority(transaction, db, orgId, actor.uid, {
        managementRequired: true,
      });
      org = authority.org;
      orgMember = authority.member;
    } catch {
      return {
        result: {
          allowed: false,
          reasonCode: "ORG_PERMISSION_REQUIRED",
          message: "Active organization authority is required",
        },
        user,
        profile,
        territory,
      };
    }
  }

  const overrideAllowed = actor.isAdmin && Boolean(adminOverrideReason?.trim());
  if (!territorySnap.exists || !territory) {
    if (!overrideAllowed) {
      return {
        result: {
          allowed: false,
          reasonCode: "TERRITORY_UNKNOWN",
          message: "The transaction territory could not be verified",
        },
        user,
        profile,
        org,
        orgMember,
      };
    }
  } else if (territory.status !== "released" && !overrideAllowed) {
    return {
      result: {
        allowed: false,
        reasonCode: "TERRITORY_UNRELEASED",
        message: "The transaction territory is not released",
      },
      user,
      profile,
      territory,
      org,
      orgMember,
    };
  }

  if (!userSnap.exists || !user) {
    return {
      result: { allowed: false, reasonCode: "AUTH_REQUIRED", message: "Account state is unavailable" },
      territory,
      org,
      orgMember,
    };
  }

  if (!actor.isAdmin && !permittedRoles.includes(actor.role)) {
    return {
      result: {
        allowed: false,
        reasonCode: "STATUS_NOT_ALLOWED",
        message: "Your account role cannot perform this action",
      },
      user,
      profile,
      territory,
      org,
      orgMember,
    };
  }

  if (requireVerification && !actor.isAdmin) {
    if (!profileSnap.exists || !profile) {
      return {
        result: {
          allowed: false,
          reasonCode: "PROFILE_REQUIRED",
          message: "A business profile is required",
        },
        user,
        territory,
        org,
        orgMember,
      };
    }
    if (profile.verificationStatus !== "verified") {
      return {
        result: {
          allowed: false,
          reasonCode: "VERIFICATION_REQUIRED",
          message: "Business verification is required",
        },
        user,
        profile,
        territory,
        org,
        orgMember,
      };
    }
  }

  if (requirePlan && !actor.isAdmin && typeof user.plan !== "string") {
    return {
      result: { allowed: false, reasonCode: "PLAN_REQUIRED", message: "An eligible plan is required" },
      user,
      profile,
      territory,
      org,
      orgMember,
    };
  }

  const credits = typeof user.credits === "number" ? user.credits : 0;
  if (!actor.isAdmin && requiredCredits > credits) {
    return {
      result: {
        allowed: false,
        reasonCode: "INSUFFICIENT_CREDITS",
        message: "Insufficient credits for this action",
      },
      user,
      profile,
      territory,
      org,
      orgMember,
    };
  }

  return {
    result: { allowed: true, reasonCode: "ELIGIBLE", message: "Eligible" },
    user,
    profile,
    territory,
    org,
    orgMember,
  };
}

export function throwEligibilityFailure(result: TransactionEligibility): never {
  const code = result.reasonCode === "INSUFFICIENT_CREDITS"
    ? "resource-exhausted"
    : result.reasonCode === "AUTH_REQUIRED"
      ? "unauthenticated"
      : "failed-precondition";
  throw new HttpsError(code, result.message, { reasonCode: result.reasonCode });
}

export interface ExchangeAuditInput {
  actorUid: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId: string;
  orgId?: string;
  previousStatus?: string;
  newStatus?: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt?: number;
}

export function writeExchangeAudit(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  input: ExchangeAuditInput,
): FirebaseFirestore.DocumentReference {
  const ref = db.collection("exchangeAudit").doc();
  const event: Record<string, unknown> = {
    id: ref.id,
    actorUid: input.actorUid,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    createdAt: input.createdAt ?? Date.now(),
  };
  if (input.actorRole) event.actorRole = input.actorRole;
  if (input.orgId) event.orgId = input.orgId;
  if (input.previousStatus) event.previousStatus = input.previousStatus;
  if (input.newStatus) event.newStatus = input.newStatus;
  if (input.metadata && Object.keys(input.metadata).length > 0) event.metadata = input.metadata;
  transaction.create(ref, event);
  return ref;
}

export function idempotencyRef(
  db: FirebaseFirestore.Firestore,
  uid: string,
  action: string,
  key: string,
): FirebaseFirestore.DocumentReference {
  const safeAction = action.replace(/[^A-Za-z0-9_-]/g, "_");
  return db.collection("exchangeIdempotency").doc(`${uid}:${safeAction}:${key}`);
}

function canonicalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeFingerprintValue(child)]),
    );
  }
  return value;
}

/** Bind an idempotency key to one normalized request, not merely one action. */
export function fingerprintRequest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeFingerprintValue(value)), "utf8")
    .digest("hex");
}

export function setCompletedIdempotency(
  transaction: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  params: {
    uid: string;
    action: string;
    entityId: string;
    result?: Record<string, unknown>;
    requestFingerprint?: string;
    createdAt: number;
  },
): void {
  transaction.create(ref, {
    uid: params.uid,
    action: params.action,
    entityId: params.entityId,
    result: params.result ?? { id: params.entityId },
    status: "completed",
    ...(params.requestFingerprint ? { requestFingerprint: params.requestFingerprint } : {}),
    createdAt: params.createdAt,
    expiresAt: params.createdAt + 7 * 24 * 60 * 60 * 1_000,
  });
}

export function getDb(): FirebaseFirestore.Firestore {
  return admin.firestore();
}
