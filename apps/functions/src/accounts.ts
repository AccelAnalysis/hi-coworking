import * as admin from "firebase-admin";
import { createHash, randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { parseCallableInput } from "./exchange/contracts";
import { PROFILE_SCHEMA_VERSION } from "./profileModel";
import { deleteAccountForRequest } from "./accountDeletion";

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
  professionalTitle: z.string().trim().min(1).max(160).optional(),
  preferredPrivateEmail: z.string().trim().email().max(320).optional(),
  preferredPrivatePhone: z.string().trim().min(7).max(40).optional(),
  communicationPreferences: z.object({
    inApp: z.boolean().default(true),
    email: z.boolean().default(true),
    sms: z.boolean().default(false),
  }).strict().optional(),
  businessRepresentativeAttestation: z.boolean().optional(),
  termsAccepted: z.boolean().optional(),
  privacyAccepted: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
  registrationVersion: z.union([z.literal(1), z.literal(2)]).default(1),
}).strict().superRefine((input, context) => {
  if (input.registrationVersion !== 2) return;
  for (const [value, path, message] of [
    [input.displayName, "displayName", "First and last name are required"],
    [input.preferredPrivateEmail, "preferredPrivateEmail", "Email is required"],
  ] as const) {
    if (!value) context.addIssue({ code: "custom", path: [path], message });
  }
  if (input.businessRepresentativeAttestation !== true) {
    context.addIssue({
      code: "custom",
      path: ["businessRepresentativeAttestation"],
      message: "Business registration is required",
    });
  }
  if (input.termsAccepted !== true) {
    context.addIssue({ code: "custom", path: ["termsAccepted"], message: "Terms acceptance is required" });
  }
  if (input.privacyAccepted !== true) {
    context.addIssue({ code: "custom", path: ["privacyAccepted"], message: "Privacy acknowledgement is required" });
  }
});

type ProvisionAccountInput = {
  uid: string;
  email: string;
  displayName?: string;
  trustedRole?: string;
  idempotencyKey: string;
  registrationVersion: 1 | 2;
  professionalTitle?: string;
  preferredPrivateEmail?: string;
  preferredPrivatePhone?: string;
  communicationPreferences?: {
    inApp: boolean;
    email: boolean;
    sms: boolean;
  };
  businessRepresentativeAttestation?: boolean;
  termsAccepted?: boolean;
  privacyAccepted?: boolean;
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
 * non-published profile shell. Browser input can never grant role,
 * organization authority, founder status, or premium access.
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
    const registrationVersion = previousUser.registrationVersion === 2
      || input.registrationVersion === 2
      ? 2
      : 1;
    const idempotentReplay = previousUser.lastAccountInitializationKeyHash === requestHash;
    const profileVersion = Number.isInteger(previousProfile.profileVersion)
      ? Number(previousProfile.profileVersion)
      : 0;
    const firstInitialization = !previousUser.accountInitializedAt;

    transaction.set(userRef, {
      uid: input.uid,
      email: normalizeEmail(input.email),
      ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
      role,
      membershipStatus: previousUser.membershipStatus ?? "none",
      credits: previousUser.credits ?? 0,
      lifetimeCreditsPurchased: previousUser.lifetimeCreditsPurchased ?? 0,
      registrationVersion,
      ...(input.registrationVersion === 2 && input.businessRepresentativeAttestation === true
        ? {
          businessRepresentativeAttestedAt: previousUser.businessRepresentativeAttestedAt ?? now,
          businessRepresentativeAttestationVersion: 1,
        }
        : {}),
      ...(input.registrationVersion === 2 && input.termsAccepted === true
        ? {
          termsAcceptedAt: previousUser.termsAcceptedAt ?? now,
          termsVersion: previousUser.termsVersion ?? "current",
        }
        : {}),
      ...(input.registrationVersion === 2 && input.privacyAccepted === true
        ? {
          privacyAcknowledgedAt: previousUser.privacyAcknowledgedAt ?? now,
          privacyVersion: previousUser.privacyVersion ?? "current",
        }
        : {}),
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
      ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
      ...(input.professionalTitle ? { professionalTitle: input.professionalTitle.trim() } : {}),
      ...(input.preferredPrivateEmail
        ? { preferredPrivateEmail: normalizeEmail(input.preferredPrivateEmail) }
        : {}),
      ...(input.preferredPrivatePhone
        ? { preferredPrivatePhone: input.preferredPrivatePhone.trim() }
        : {}),
      ...(input.communicationPreferences
        ? { communicationPreferences: input.communicationPreferences }
        : {}),
      ...(input.registrationVersion === 2
        ? { schemaVersion: 2, personEssentialsCompletedAt: previousProfile.personEssentialsCompletedAt ?? now }
        : {}),
      ...(profileSnapshot.exists ? {} : { profileSchemaVersion: PROFILE_SCHEMA_VERSION }),
      profileVersion,
      createdAt: previousProfile.createdAt ?? now,
      updatedAt: now,
    }, { merge: true });

    if (firstInitialization) {
      for (const event of ["registration_started", "registration_completed"]) {
        const eventRef = db.collection("exchangeOnboardingEvents").doc();
        transaction.set(eventRef, {
          id: eventRef.id,
          event,
          uid: input.uid,
          createdAt: now,
        });
      }
    }

    return { idempotentReplay, role, profileVersion };
  });
}

export const account_initialize = onCall(async (request) => {
  if (
    request.data
    && typeof request.data === "object"
    && (request.data as { operation?: unknown }).operation === "delete_account"
  ) {
    return deleteAccountForRequest(request);
  }

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
    professionalTitle: input.professionalTitle,
    preferredPrivateEmail: input.preferredPrivateEmail,
    preferredPrivatePhone: input.preferredPrivatePhone,
    communicationPreferences: input.communicationPreferences,
    businessRepresentativeAttestation: input.businessRepresentativeAttestation,
    termsAccepted: input.termsAccepted,
    privacyAccepted: input.privacyAccepted,
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
