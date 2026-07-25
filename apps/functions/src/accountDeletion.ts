import * as admin from "firebase-admin";
import { createHash, randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import { parseCallableInput } from "./exchange/contracts";

const deleteAccountInputSchema = z.object({
  confirmation: z.literal("DELETE"),
  reason: z.string().trim().max(500).optional(),
}).strict();

const RECENT_AUTH_WINDOW_SECONDS = 10 * 60;
const PROTECTED_ROLES = new Set(["master", "admin"]);

const DIRECT_USER_DOCUMENTS = [
  "users",
  "profiles",
  "publicProfiles",
  "exchangeWorkspacePreferences",
  "referralPolicies",
  "userSuggestions",
  "exchangeUsage",
  "emailPreferences",
  "marketingPreferences",
] as const;

const USER_OWNED_QUERIES = [
  ["orgMembers", "uid"],
  ["organizationClaims", "uid"],
  ["organizationClaims", "requesterUid"],
  ["organizationClaims", "requestedByUid"],
  ["exchangeSavedOrganizations", "uid"],
  ["opportunitySavedItems", "uid"],
  ["opportunityRecentViews", "uid"],
  ["opportunitySavedSearches", "uid"],
  ["opportunityRecentSearches", "uid"],
  ["notifications", "uid"],
  ["savedExchangeItems", "uid"],
  ["exchangeOnboardingEvents", "uid"],
  ["verificationDocuments", "uid"],
  ["verificationAuditLog", "uid"],
  ["verificationFlags", "uid"],
  ["organizationSearchRateLimits", "uid"],
  ["organizationGeocodeRateLimits", "uid"],
] as const;

type FirestoreData = FirebaseFirestore.DocumentData;

function accountHash(uid: string): string {
  return createHash("sha256").update(`deleted-account:${uid}`).digest("hex");
}

function collectStoragePaths(value: unknown, uid: string, paths: Set<string>): void {
  if (typeof value === "string") {
    if (value.includes(uid) && !value.startsWith("http://") && !value.startsWith("https://")) {
      paths.add(value.replace(/^\/+/, ""));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStoragePaths(entry, uid, paths);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStoragePaths(entry, uid, paths);
    }
  }
}

async function findSoleOwnedOrganizations(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<Array<{ id: string; name: string }>> {
  const memberships = await db.collection("orgMembers").where("uid", "==", uid).get();
  const owned = memberships.docs.filter((document) => {
    const data = document.data();
    return data.status === "active" && data.role === "owner" && typeof data.orgId === "string";
  });
  const blocked: Array<{ id: string; name: string }> = [];
  for (const membership of owned) {
    const orgId = String(membership.data().orgId);
    const organizationMemberships = await db.collection("orgMembers").where("orgId", "==", orgId).get();
    const otherOwners = organizationMemberships.docs.some((document) => {
      const data = document.data();
      return data.uid !== uid && data.status === "active" && data.role === "owner";
    });
    if (!otherOwners) {
      const organization = await db.collection("orgs").doc(orgId).get();
      blocked.push({ id: orgId, name: String(organization.data()?.name || "Unnamed organization") });
    }
  }
  return blocked;
}

async function collectUserOwnedReferences(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<Map<string, FirebaseFirestore.DocumentReference>> {
  const references = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const collection of DIRECT_USER_DOCUMENTS) {
    const reference = db.collection(collection).doc(uid);
    references.set(reference.path, reference);
  }
  for (const [collection, field] of USER_OWNED_QUERIES) {
    const snapshot = await db.collection(collection).where(field, "==", uid).get();
    for (const document of snapshot.docs) references.set(document.ref.path, document.ref);
  }
  return references;
}

async function deleteReferences(
  db: FirebaseFirestore.Firestore,
  references: Iterable<FirebaseFirestore.DocumentReference>,
): Promise<number> {
  const writer = db.bulkWriter();
  let count = 0;
  for (const reference of references) {
    writer.delete(reference);
    count += 1;
  }
  await writer.close();
  return count;
}

async function deletePrivateStorage(uid: string, explicitPaths: Set<string>): Promise<number> {
  const bucket = admin.storage().bucket();
  const files = new Map<string, ReturnType<typeof bucket.file>>();
  for (const path of explicitPaths) files.set(path, bucket.file(path));
  for (const prefix of [`profiles/${uid}/`, `verification/${uid}/`, `users/${uid}/`, `exchange/${uid}/`]) {
    try {
      const [found] = await bucket.getFiles({ prefix });
      for (const file of found) files.set(file.name, file);
    } catch (error) {
      logger.warn("Account deletion could not list a private storage prefix", { prefix, error });
    }
  }
  let deleted = 0;
  await Promise.all(Array.from(files.values()).map(async (file) => {
    try {
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    } catch (error) {
      logger.warn("Account deletion could not remove a private storage object", { path: file.name, error });
    }
  }));
  return deleted;
}

export const account_delete = onCall(async (request) => {
  const requestId = randomUUID();
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required", {
      diagnosticCode: "UNAUTHENTICATED",
      requestId,
    });
  }

  const input = parseCallableInput(deleteAccountInputSchema, request.data);
  const uid = request.auth.uid;
  const role = typeof request.auth.token.role === "string" ? request.auth.token.role : "member";
  if (PROTECTED_ROLES.has(role)) {
    throw new HttpsError("failed-precondition", "Administrator accounts must be removed by another authorized administrator.", {
      diagnosticCode: "PROTECTED_ADMIN_ACCOUNT",
      requestId,
    });
  }

  const authTime = typeof request.auth.token.auth_time === "number" ? request.auth.token.auth_time : 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authTime || nowSeconds - authTime > RECENT_AUTH_WINDOW_SECONDS) {
    throw new HttpsError("failed-precondition", "Sign in again before deleting your account.", {
      diagnosticCode: "RECENT_AUTH_REQUIRED",
      requestId,
    });
  }

  const db = admin.firestore();
  const soleOwnedOrganizations = await findSoleOwnedOrganizations(db, uid);
  if (soleOwnedOrganizations.length > 0) {
    throw new HttpsError("failed-precondition", "Transfer ownership of each organization before deleting your personal account.", {
      diagnosticCode: "SOLE_ORGANIZATION_OWNER",
      organizations: soleOwnedOrganizations,
      requestId,
    });
  }

  const [profileSnapshot, verificationSnapshot] = await Promise.all([
    db.collection("profiles").doc(uid).get(),
    db.collection("verificationDocuments").where("uid", "==", uid).get(),
  ]);
  const storagePaths = new Set<string>();
  collectStoragePaths(profileSnapshot.data(), uid, storagePaths);
  for (const document of verificationSnapshot.docs) collectStoragePaths(document.data(), uid, storagePaths);

  const references = await collectUserOwnedReferences(db, uid);
  const firestoreRecordsDeleted = await deleteReferences(db, references.values());
  const storageObjectsDeleted = await deletePrivateStorage(uid, storagePaths);

  await db.collection("accountDeletionReceipts").doc().set({
    accountHash: accountHash(uid),
    completedAt: Date.now(),
    firestoreRecordsDeleted,
    storageObjectsDeleted,
    reasonProvided: Boolean(input.reason),
    requestId,
  });

  await admin.auth().deleteUser(uid);
  logger.info("Account deleted", {
    accountHash: accountHash(uid),
    firestoreRecordsDeleted,
    storageObjectsDeleted,
    requestId,
  });

  return {
    success: true,
    firestoreRecordsDeleted,
    storageObjectsDeleted,
  };
});
