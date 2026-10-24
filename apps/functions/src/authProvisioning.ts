// Non-blocking account provisioning for new Firebase Auth users.
//
// Replaces the blocking authBeforeCreate trigger. It runs after the user is
// created, so a failure here can never block sign-up. It is safe to run
// alongside the account_initialize callable: both write users/{uid} inside a
// transaction, and this one only fills fields that are missing. It never
// overwrites an existing role, membershipStatus, or any other field, and it
// keeps every existing custom claim.

// MIRROR of @hi/shared userRoleSchema (see VALID_ROLES in index.ts).
const PLATFORM_ROLES = new Set(["master", "admin", "staff", "member", "externalVendor", "econPartner"]);

export type ProvisionAuthUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
};

type Snapshot = { exists: boolean; data(): Record<string, unknown> | undefined };

export type ProvisioningTransaction = {
  get(ref: unknown): Promise<Snapshot>;
  set(ref: unknown, data: Record<string, unknown>, options: { merge: true }): unknown;
};

export type ProvisioningDeps = {
  userRef(uid: string): unknown;
  runTransaction<T>(fn: (transaction: ProvisioningTransaction) => Promise<T>): Promise<T>;
  getCustomClaims(uid: string): Promise<Record<string, unknown> | undefined>;
  setCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  now?: () => number;
};

export type ProvisionResult = {
  createdDoc: boolean;
  filledFields: string[];
  role: string;
  claimsUpdated: boolean;
};

export function isPlatformRole(role: unknown): role is string {
  return typeof role === "string" && PLATFORM_ROLES.has(role);
}

export async function provisionAuthUser(user: ProvisionAuthUser, deps: ProvisioningDeps): Promise<ProvisionResult> {
  const now = (deps.now ?? Date.now)();
  const ref = deps.userRef(user.uid);

  const { createdDoc, filledFields, role } = await deps.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = (snapshot.exists ? snapshot.data() : undefined) ?? {};
    const defaults: Record<string, unknown> = {
      uid: user.uid,
      email: (user.email || "").trim().toLowerCase(),
      displayName: user.displayName || "",
      role: "member",
      membershipStatus: "none",
      createdAt: now,
    };
    const missing: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (existing[key] === undefined) missing[key] = value;
    }
    const filled = Object.keys(missing);
    if (filled.length > 0) {
      if (snapshot.exists) missing.updatedAt = now;
      transaction.set(ref, missing, { merge: true });
    }
    const docRole = existing.role !== undefined ? existing.role : "member";
    return { createdDoc: !snapshot.exists, filledFields: filled, role: isPlatformRole(docRole) ? docRole : "member" };
  });

  const claims = (await deps.getCustomClaims(user.uid)) ?? {};
  let claimsUpdated = false;
  if (!isPlatformRole(claims.role)) {
    await deps.setCustomClaims(user.uid, { ...claims, role });
    claimsUpdated = true;
  }
  return { createdDoc, filledFields, role: isPlatformRole(claims.role) ? claims.role : role, claimsUpdated };
}
