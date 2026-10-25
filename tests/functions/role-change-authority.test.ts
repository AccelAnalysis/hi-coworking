import { describe, expect, it } from "vitest";
import { changeUserRole, RoleChangeError, type RoleChangeDeps, type RoleAuditRecord } from "../../apps/functions/src/roleAuthority";

function fake(claims: Record<string, unknown> | undefined, exists = true) {
  const state = { claims: claims ? { ...claims } : undefined, claimWrites: 0, docRole: "", audits: [] as RoleAuditRecord[] };
  const deps: RoleChangeDeps = {
    now: () => 42,
    getCustomClaims: async () => state.claims,
    setCustomClaims: async (_uid, next) => { state.claimWrites += 1; state.claims = next; },
    userExists: async () => exists,
    updateUserRole: async (_uid, role) => { state.docRole = role; },
    writeAudit: async (record) => { state.audits.push(record); return `a${state.audits.length}`; },
  };
  return { state, deps };
}

async function code(p: Promise<unknown>) {
  try { await p; return "ok"; } catch (e) { return e instanceof RoleChangeError ? e.code : String(e); }
}

describe("role change authority", () => {
  it("rejects callers who are not admin or master", async () => {
    const { deps } = fake({ role: "member" });
    expect(await code(changeUserRole({ actorUid: "s", actorRole: "staff", targetUid: "t", role: "admin" }, deps))).toBe("permission-denied");
  });

  it("rejects unknown roles and missing input", async () => {
    const { deps } = fake({ role: "member" });
    expect(await code(changeUserRole({ actorUid: "a", actorRole: "admin", targetUid: "t", role: "owner" }, deps))).toBe("invalid-argument");
    expect(await code(changeUserRole({ actorUid: "a", actorRole: "admin", targetUid: "", role: "staff" }, deps))).toBe("invalid-argument");
  });

  it("stops admins from demoting a master", async () => {
    const { state, deps } = fake({ role: "master" });
    expect(await code(changeUserRole({ actorUid: "a", actorRole: "admin", targetUid: "m", role: "member" }, deps))).toBe("permission-denied");
    expect(state.claimWrites).toBe(0);
    expect(state.audits).toHaveLength(0);
  });

  it("stops admins from assigning master", async () => {
    const { deps } = fake({ role: "admin" });
    expect(await code(changeUserRole({ actorUid: "a", actorRole: "admin", targetUid: "t", role: "master" }, deps))).toBe("permission-denied");
  });

  it("stops anyone changing their own role", async () => {
    const { deps } = fake({ role: "master" });
    expect(await code(changeUserRole({ actorUid: "m", actorRole: "master", targetUid: "m", role: "member" }, deps))).toBe("permission-denied");
  });

  it("returns not-found for a missing account", async () => {
    const { deps } = fake(undefined, false);
    expect(await code(changeUserRole({ actorUid: "a", actorRole: "admin", targetUid: "t", role: "staff" }, deps))).toBe("not-found");
  });

  it("keeps other claims, mirrors the role and writes an audit record", async () => {
    const { state, deps } = fake({ role: "member", orgId: "o1" });
    const result = await changeUserRole({ actorUid: "a", actorRole: "admin", targetUid: "t", role: "staff" }, deps);
    expect(result).toMatchObject({ success: true, uid: "t", role: "staff", fromRole: "member", auditId: "a1" });
    expect(state.claims).toEqual({ role: "staff", orgId: "o1" });
    expect(state.docRole).toBe("staff");
    expect(state.audits[0]).toEqual({
      action: "role_change", targetUid: "t", actorUid: "a", actorRole: "admin",
      fromRole: "member", toRole: "staff", createdAt: 42,
    });
  });

  it("lets a master change another master", async () => {
    const { state, deps } = fake({ role: "master" });
    await changeUserRole({ actorUid: "m1", actorRole: "master", targetUid: "m2", role: "admin" }, deps);
    expect(state.claims).toEqual({ role: "admin" });
  });
});
