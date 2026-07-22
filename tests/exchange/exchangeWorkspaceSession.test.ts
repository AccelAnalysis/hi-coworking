import { describe, expect, it } from "vitest";
import { exchangeWorkspaceActions as actions } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceActions";
import { exchangeWorkspaceReducer } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceReducer";
import {
  clearExchangeWorkspaceSession,
  getExchangeWorkspaceIdentityKey,
  getExchangeWorkspaceSessionKey,
  readExchangeWorkspaceSession,
  writeExchangeWorkspaceSession,
  type ExchangeWorkspaceSessionStorage,
} from "../../apps/web/src/features/exchange/state/exchangeWorkspaceSession";
import {
  createInitialExchangeWorkspaceState,
  type ExchangeWorkspaceState,
} from "../../apps/web/src/features/exchange/state/exchangeWorkspaceTypes";

class MemoryStorage implements ExchangeWorkspaceSessionStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function reduce(
  state: ExchangeWorkspaceState,
  ...workspaceActions: Parameters<typeof exchangeWorkspaceReducer>[1][]
): ExchangeWorkspaceState {
  return workspaceActions.reduce(exchangeWorkspaceReducer, state);
}

describe("Exchange workspace session persistence", () => {
  it("gives every resolved auth identity a remount boundary", () => {
    expect(getExchangeWorkspaceIdentityKey({
      demoMode: false,
      authLoading: true,
    })).toBe("exchange-auth-loading");
    expect(getExchangeWorkspaceIdentityKey({
      demoMode: false,
      authLoading: false,
      uid: "user/one",
    })).toBe("exchange-user:user%2Fone");
    expect(getExchangeWorkspaceIdentityKey({
      demoMode: false,
      authLoading: false,
    })).toBe("exchange-signed-out");
    expect(getExchangeWorkspaceIdentityKey({
      demoMode: true,
      authLoading: false,
    })).toBe("exchange-demo");
  });

  it("restores allowlisted global and per-mode continuity without restoring authority", () => {
    const storage = new MemoryStorage();
    const binding = { uid: "user-1", actorOrganizationId: "actor-1" };
    const state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setValidatedActorOrganization("actor-1"),
      actions.setSubjectOrganization("subject-1"),
      actions.setSearch("stormwater"),
      actions.setViewport({ longitude: -76.7, latitude: 36.9, zoom: 9 }),
      actions.selectEntity({ entityType: "rfx", entityId: "rfx-1" }),
      actions.setModeListScroll(650),
      actions.setModeDraftRefs({ opportunityResponseDraftId: "response-draft-1" }),
      actions.setView("referrals"),
      actions.setFilters({ referralStatusFilters: ["accepted"] }),
      actions.selectEntity({ entityType: "referral", entityId: "referral-1" }),
      actions.setModeDraftRefs({ referralDraftId: "referral-draft-1" }),
    );

    expect(writeExchangeWorkspaceSession(storage, binding, state, {
      now: 1_000,
      ttlMs: 60_000,
    })).toBe(true);
    const hydration = readExchangeWorkspaceSession(storage, binding, 2_000);
    expect(hydration).not.toBeNull();
    expect(hydration).not.toHaveProperty("actorOrganizationId");
    expect(hydration).not.toHaveProperty("requestedActorOrganizationId");

    const restored = exchangeWorkspaceReducer(
      exchangeWorkspaceReducer(
        createInitialExchangeWorkspaceState(),
        actions.setValidatedActorOrganization("actor-1"),
      ),
      actions.hydrateFromSession(hydration ?? {}),
    );
    expect(restored).toMatchObject({
      view: "referrals",
      actorOrganizationId: "actor-1",
      subjectOrganizationId: "subject-1",
      searchQuery: "stormwater",
      viewport: { longitude: -76.7, latitude: 36.9, zoom: 9 },
      referralStatusFilters: ["accepted"],
      secondaryContext: { entityType: "referral", entityId: "referral-1" },
    });
    expect(restored.modeStates.opportunities).toMatchObject({
      listScrollTop: 650,
      draftRefs: { opportunityResponseDraftId: "response-draft-1" },
      secondaryContext: { entityType: "rfx", entityId: "rfx-1" },
    });
    expect(restored.modeStates.referrals.draftRefs).toEqual({
      referralDraftId: "referral-draft-1",
    });
  });

  it("binds records to both UID and the already-validated actor", () => {
    const storage = new MemoryStorage();
    const state = exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      actions.setValidatedActorOrganization("actor-1"),
    );
    expect(writeExchangeWorkspaceSession(
      storage,
      { uid: "user-1", actorOrganizationId: "actor-1" },
      state,
    )).toBe(true);
    expect(readExchangeWorkspaceSession(
      storage,
      { uid: "user-2", actorOrganizationId: "actor-1" },
    )).toBeNull();
    expect(writeExchangeWorkspaceSession(
      storage,
      { uid: "user-1", actorOrganizationId: "actor-2" },
      state,
    )).toBe(false);
    expect(readExchangeWorkspaceSession(
      storage,
      { uid: "user-1", actorOrganizationId: "actor-2" },
    )).toBeNull();
    expect(readExchangeWorkspaceSession(
      storage,
      { uid: "user-1" },
    )).toBeNull();
  });

  it("rejects expired records and removes them", () => {
    const storage = new MemoryStorage();
    const binding = { uid: "user-1", actorOrganizationId: "actor-1" };
    const state = exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      actions.setValidatedActorOrganization("actor-1"),
    );
    expect(writeExchangeWorkspaceSession(
      storage,
      binding,
      state,
      { now: 5_000, ttlMs: 1_000 },
    )).toBe(true);
    const key = getExchangeWorkspaceSessionKey(binding);
    expect(key && storage.getItem(key)).not.toBeNull();
    expect(readExchangeWorkspaceSession(storage, binding, 6_001)).toBeNull();
    expect(key && storage.getItem(key)).toBeNull();
  });

  it("restores complete safe defaults so an actor-bound workspace can clear stale context", () => {
    const storage = new MemoryStorage();
    const binding = { uid: "individual-user" };
    expect(writeExchangeWorkspaceSession(
      storage,
      binding,
      createInitialExchangeWorkspaceState(),
      { now: 20_000, ttlMs: 60_000 },
    )).toBe(true);
    const hydration = readExchangeWorkspaceSession(storage, binding, 21_000);
    const stale = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setSubjectOrganization("old-subject"),
      actions.selectEntity({ entityType: "rfx", entityId: "old-rfx" }),
    );
    const restored = exchangeWorkspaceReducer(
      stale,
      actions.hydrateFromSession(hydration ?? {}),
    );
    expect(restored.subjectOrganizationId).toBeUndefined();
    expect(restored.secondaryContext).toBeNull();
    expect(restored.organizationDrawerOpen).toBe(false);
    expect(restored.rightPanelOpen).toBe(false);
  });

  it("drops injected private and authority fields through the read allowlist", () => {
    const storage = new MemoryStorage();
    const binding = { uid: "user-1", actorOrganizationId: "actor-1" };
    const runtimeState = {
      ...createInitialExchangeWorkspaceState(),
      actorOrganizationId: "actor-1",
      authToken: "private-token",
      userEmail: "person@example.test",
    } as ExchangeWorkspaceState;
    expect(writeExchangeWorkspaceSession(storage, binding, runtimeState, {
      now: 10_000,
      ttlMs: 60_000,
    })).toBe(true);
    const key = getExchangeWorkspaceSessionKey(binding);
    if (!key) throw new Error("expected a valid session key");
    const envelope = JSON.parse(storage.getItem(key) ?? "{}") as Record<string, unknown>;
    const persistedState = envelope.state as Record<string, unknown>;
    expect(persistedState.authToken).toBeUndefined();
    expect(persistedState.userEmail).toBeUndefined();
    persistedState.authToken = "injected";
    persistedState.actorOrganizationId = "attacker-controlled";
    storage.setItem(key, JSON.stringify(envelope));

    const hydration = readExchangeWorkspaceSession(storage, binding, 11_000);
    expect(hydration).not.toHaveProperty("authToken");
    expect(hydration).not.toHaveProperty("actorOrganizationId");
    expect(hydration).not.toHaveProperty("userEmail");
    expect(clearExchangeWorkspaceSession(storage, binding)).toBe(true);
    expect(storage.getItem(key)).toBeNull();
  });
});
