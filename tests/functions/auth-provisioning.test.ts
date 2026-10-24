import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { provisionAuthUser, type ProvisioningDeps } from "../../apps/functions/src/authProvisioning";

function fakeDeps(initialDoc?: Record<string, unknown>, initialClaims?: Record<string, unknown>) {
  const state = {
    doc: initialDoc ? { ...initialDoc } : undefined as Record<string, unknown> | undefined,
    claims: initialClaims ? { ...initialClaims } : undefined as Record<string, unknown> | undefined,
    writes: [] as Record<string, unknown>[],
    claimWrites: 0,
  };
  const deps: ProvisioningDeps = {
    now: () => 1_000,
    userRef: (uid) => `users/${uid}`,
    runTransaction: async (fn) => fn({
      get: async () => ({ exists: state.doc !== undefined, data: () => state.doc }),
      set: (_ref, data) => {
        state.writes.push(data);
        state.doc = { ...(state.doc ?? {}), ...data };
      },
    }),
    getCustomClaims: async () => state.claims,
    setCustomClaims: async (_uid, claims) => {
      state.claimWrites += 1;
      state.claims = claims;
    },
  };
  return { state, deps };
}

const user = { uid: "u1", email: "New.Member@Example.com", displayName: "New Member" };

describe("authProvisionOnCreate provisioning", () => {
  it("creates users/{uid} as a member with no membership and sets the role claim", async () => {
    const { state, deps } = fakeDeps();
    const result = await provisionAuthUser(user, deps);
    expect(state.doc).toEqual({
      uid: "u1",
      email: "new.member@example.com",
      displayName: "New Member",
      role: "member",
      membershipStatus: "none",
      createdAt: 1_000,
    });
    expect(state.claims).toEqual({ role: "member" });
    expect(result).toMatchObject({ createdDoc: true, claimsUpdated: true, role: "member" });
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { state, deps } = fakeDeps();
    await provisionAuthUser(user, deps);
    const before = { doc: { ...state.doc }, writes: state.writes.length, claimWrites: state.claimWrites };
    const result = await provisionAuthUser(user, deps);
    expect(state.doc).toEqual(before.doc);
    expect(state.writes).toHaveLength(before.writes);
    expect(state.claimWrites).toBe(before.claimWrites);
    expect(result).toMatchObject({ createdDoc: false, filledFields: [], claimsUpdated: false });
  });

  it("never overwrites fields account_initialize already wrote", async () => {
    const existing = {
      uid: "u1",
      email: "chosen@example.com",
      displayName: "Chosen Name",
      role: "staff",
      membershipStatus: "active",
      credits: 4,
      registrationVersion: 2,
      createdAt: 500,
    };
    const { state, deps } = fakeDeps(existing, { role: "staff", orgAdmin: true });
    const result = await provisionAuthUser(user, deps);
    expect(state.doc).toEqual(existing);
    expect(state.writes).toHaveLength(0);
    expect(state.claims).toEqual({ role: "staff", orgAdmin: true });
    expect(result).toMatchObject({ createdDoc: false, claimsUpdated: false, role: "staff" });
  });

  it("fills only missing fields on a partial doc and keeps existing values", async () => {
    const { state, deps } = fakeDeps({ uid: "u1", membershipStatus: "active", credits: 2 });
    await provisionAuthUser(user, deps);
    expect(state.writes).toEqual([{
      email: "new.member@example.com",
      displayName: "New Member",
      role: "member",
      createdAt: 1_000,
      updatedAt: 1_000,
    }]);
    expect(state.doc).toMatchObject({ membershipStatus: "active", credits: 2, role: "member" });
  });

  it("preserves other custom claims and uses the doc's existing role for a missing role claim", async () => {
    const { state, deps } = fakeDeps({ uid: "u1", role: "admin", membershipStatus: "none" }, { betaTester: true });
    await provisionAuthUser(user, deps);
    expect(state.claims).toEqual({ betaTester: true, role: "admin" });
  });

  it("keeps an existing valid role claim untouched", async () => {
    const { state, deps } = fakeDeps(undefined, { role: "econPartner", tier: 2 });
    await provisionAuthUser(user, deps);
    expect(state.claimWrites).toBe(0);
    expect(state.claims).toEqual({ role: "econPartner", tier: 2 });
  });

  it("replaces the blocking authBeforeCreate in every export and the core deploy", () => {
    const index = readFileSync("apps/functions/src/index.ts", "utf8");
    const main = readFileSync("apps/functions/src/main.ts", "utf8");
    const core = readFileSync("firebase/core-functions/src/index.ts", "utf8");
    const workflow = readFileSync(".github/workflows/firebase-live-core-functions.yml", "utf8");
    for (const source of [index, main, core, workflow]) expect(source).not.toContain("authBeforeCreate");
    expect(index).not.toContain("beforeUserCreated");
    expect(index).toContain("auth.user().onCreate(");
    expect(main).toContain("export const authProvisionOnCreate = legacy.authProvisionOnCreate;");
    expect(core).toContain("authProvisionOnCreate,");
    expect(workflow).toContain("functions:authProvisionOnCreate,");
  });
});
