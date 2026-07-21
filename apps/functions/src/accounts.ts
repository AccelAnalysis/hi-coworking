import * as admin from "firebase-admin";
import { createHash, randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { parseCallableInput } from "./exchange/contracts";
import { PROFILE_SCHEMA_VERSION } from "./profileModel";

const PLATFORM_ROLES = new Set([
  "master",
  "admin",
  "staff",
  "member",
  "externalVendor",
  "econPartner",
]);

const accountInitializeInputSchema = z.object({
  displayName: z.string().trim().min(1).max(160).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
  registrationVersion: z.literal(1).default(1),
}).strict();

type ProvisionAccountInput = {
  uid: string;
  email: string;
  displayName?: string;
  trustedRole?: string;
  idempotencyKey: string;
  registrationVersion: 1;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeRole(role: unknown): string {
  return typeof role === "string" && PLATFORM_ROLES.has(role) ? role : "member";
}

function keyHash(uid: string, key: string): string {
  return createHash("sha256").update(`${uid}:${key}`).digest("hex");
}

/**
 * Idempotently creates or repairs the authoritative account and its private,
 * non-published profile shell. The role is accepted only from a trusted server
 * caller; browser input can never grant role, organization, or marketing state.
 */
export async function provisionAccountDocuments(
  input: ProvisionAccountInput,
): Promise<{ idempotentReplay: boolean; role: string; profileVersion: number }> {
  const db = admin.firestore();
  const now = Date.now();
  const role = safeRole(input.trustedRole);
  const requestHash = keyHash(input.uid, input.idempotencyKey);

  return db.runTransaction(async (transaction) => {
    const userRef = db.collection("users").doc(input.uid);
    const profileRef = db.collection("profiles").doc(input.uid);
    const [userSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(profileRef),
    ]);
    const previousUser = userSnapshot.data() ?? {};
    const previousProfile = profileSnapshot.data() ?? {};
    const idempotentReplay = previousUser.lastAccountInitializationKeyHash === requestHash;
    const profileVersion = Number.isInteger(previousProfile.profileVersion)
      ? Number(previousProfile.profileVersion)
      : 0;

    transaction.set(userRef, {
      uid: input.uid,
      email: normalizeEmail(input.email),
      ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
      role,
      membershipStatus: previousUser.membershipStatus ?? "none",
      credits: previousUser.credits ?? 0,
      lifetimeCreditsPurchased: previousUser.lifetimeCreditsPurchased ?? 0,
      registrationVersion: input.registrationVersion,
      accountInitializedAt: previousUser.accountInitializedAt ?? now,
      lastAccountInitializationAt: now,
      lastAccountInitializationKeyHash: requestHash,
      createdAt: previousUser.createdAt ?? now,
      updatedAt: now,
    }, { merge: true });

    transaction.set(profileRef, {
      uid: input.uid,
      published: previousProfile.published === true,
      verificationStatus: previousProfile.verificationStatus ?? "none",
      badges: Array.isArray(previousProfile.badges) ? previousProfile.badges : [],
      ...(profileSnapshot.exists ? {} : { profileSchemaVersion: PROFILE_SCHEMA_VERSION }),
      profileVersion,
      createdAt: previousProfile.createdAt ?? now,
      updatedAt: previousProfile.updatedAt ?? now,
    }, { merge: true });

    return { idempotentReplay, role, profileVersion };
  });
}

export const account_initialize = onCall(async (request) => {
  const requestId = randomUUID();
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required", {
      diagnosticCode: "UNAUTHENTICATED",
      requestId,
    });
  }

  let input;
  try {
    input = parseCallableInput(accountInitializeInputSchema, request.data);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw new HttpsError(error.code, error.message, {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        diagnosticCode: "INVALID_ACCOUNT_DATA",
        requestId,
      });
    }
    throw error;
  }

  const auth = admin.auth();
  const authUser = await auth.getUser(request.auth.uid);
  const email = authUser.email;
  if (!email) {
    throw new HttpsError("failed-precondition", "The authenticated account has no email address", {
      diagnosticCode: "ACCOUNT_EMAIL_MISSING",
      requestId,
    });
  }

  const existingClaims = authUser.customClaims ?? {};
  const trustedRole = safeRole(existingClaims.role);
  const claimsRefreshRequired = existingClaims.role !== trustedRole;
  if (claimsRefreshRequired) {
    await auth.setCustomUserClaims(authUser.uid, { ...existingClaims, role: trustedRole });
  }

  const provisioned = await provisionAccountDocuments({
    uid: authUser.uid,
    email,
    displayName: authUser.displayName || input.displayName,
    trustedRole,
    idempotencyKey: input.idempotencyKey,
    registrationVersion: input.registrationVersion,
  });

  return {
    success: true,
    requestId,
    accountInitialized: true,
    idempotentReplay: provisioned.idempotentReplay,
    role: provisioned.role,
    profileVersion: provisioned.profileVersion,
    claimsRefreshRequired,
  };
});
