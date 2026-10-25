// Authority for changing a user's platform role (admin "Roles" tool).
//
// Rules:
// - Only admin or master callers may change roles.
// - Only a master may assign the master role, or change the role of an
//   account that is currently master (admins cannot demote masters).
// - Nobody changes their own role here (prevents accidental self-lockout).
// - Existing custom claims are kept; only `role` changes.
// - Every change writes a roleAudit record with who, whom, from and to.

// MIRROR of @hi/shared userRoleSchema.
export const ROLE_VALUES = ["master", "admin", "staff", "member", "externalVendor", "econPartner"] as const;
export type PlatformRole = (typeof ROLE_VALUES)[number];

export class RoleChangeError extends Error {
  constructor(
    readonly code: "permission-denied" | "invalid-argument" | "not-found",
    message: string,
  ) {
    super(message);
  }
}

export type RoleChangeDeps = {
  getCustomClaims(uid: string): Promise<Record<string, unknown> | undefined | null>;
  setCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  userExists(uid: string): Promise<boolean>;
  updateUserRole(uid: string, role: PlatformRole, at: number): Promise<void>;
  writeAudit(record: RoleAuditRecord): Promise<string>;
  now?: () => number;
};

export type RoleAuditRecord = {
  action: "role_change";
  targetUid: string;
  actorUid: string;
  actorRole: string;
  fromRole: string | null;
  toRole: PlatformRole;
  createdAt: number;
};

export type RoleChangeInput = {
  actorUid: string;
  actorRole: string | undefined;
  targetUid: unknown;
  role: unknown;
};

export async function changeUserRole(input: RoleChangeInput, deps: RoleChangeDeps) {
  const { actorUid, actorRole } = input;
  if (actorRole !== "admin" && actorRole !== "master") {
    throw new RoleChangeError("permission-denied", "Only admin or master users can set roles.");
  }
  const targetUid = typeof input.targetUid === "string" ? input.targetUid.trim() : "";
  const role = typeof input.role === "string" ? input.role : "";
  if (!targetUid || !role) {
    throw new RoleChangeError("invalid-argument", "targetUid and role are required.");
  }
  if (!(ROLE_VALUES as readonly string[]).includes(role)) {
    throw new RoleChangeError("invalid-argument", `Invalid role: ${role}. Must be one of: ${ROLE_VALUES.join(", ")}.`);
  }
  const nextRole = role as PlatformRole;
  if (targetUid === actorUid) {
    throw new RoleChangeError("permission-denied", "You can't change your own role. Ask another admin or master.");
  }
  if (nextRole === "master" && actorRole !== "master") {
    throw new RoleChangeError("permission-denied", "Only master users can assign the master role.");
  }
  if (!(await deps.userExists(targetUid))) {
    throw new RoleChangeError("not-found", "Member account not found.");
  }

  const existingClaims = (await deps.getCustomClaims(targetUid)) ?? {};
  const fromRole = typeof existingClaims.role === "string" ? existingClaims.role : null;
  if (fromRole === "master" && actorRole !== "master") {
    throw new RoleChangeError("permission-denied", "Only master users can change a master account's role.");
  }

  const at = (deps.now ?? Date.now)();
  if (fromRole !== nextRole) {
    await deps.setCustomClaims(targetUid, { ...existingClaims, role: nextRole });
  }
  await deps.updateUserRole(targetUid, nextRole, at);
  const auditId = await deps.writeAudit({
    action: "role_change",
    targetUid,
    actorUid,
    actorRole,
    fromRole,
    toRole: nextRole,
    createdAt: at,
  });
  return { success: true as const, uid: targetUid, role: nextRole, fromRole, auditId };
}
