import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BILLING_PORTAL_RETURN_URL,
  NO_BILLING_ACCOUNT_MESSAGE,
  resolveBillingCustomerId,
  resolvePortalConfigurationId,
  type BillingLookupDeps,
} from "../../apps/functions/src/memberBillingPortal";

function deps(overrides: Partial<BillingLookupDeps> = {}): BillingLookupDeps {
  return {
    getUser: vi.fn().mockResolvedValue({ membershipStatus: "active" }),
    listMembershipPaymentRefs: vi.fn().mockResolvedValue([]),
    retrieveSubscription: vi.fn().mockRejectedValue(new Error("not called")),
    ...overrides,
  };
}

describe("resolveBillingCustomerId", () => {
  it("prefers the current subscription's customer over a cached one", async () => {
    const d = deps({
      getUser: vi.fn().mockResolvedValue({ stripeCustomerId: "cus_old", features: { stripeSubscriptionId: "sub_new" } }),
      retrieveSubscription: vi.fn().mockResolvedValue({ customer: "cus_new", metadata: { uid: "u1" } }),
      listMembershipPaymentRefs: vi.fn().mockResolvedValue([{ stripeCustomerId: "cus_older" }]),
    });
    expect(await resolveBillingCustomerId("u1", d)).toBe("cus_new");
    expect(d.retrieveSubscription).toHaveBeenCalledWith("sub_new");
  });

  it("uses the cached customer only when no subscription or payment names one", async () => {
    const d = deps({ getUser: vi.fn().mockResolvedValue({ stripeCustomerId: "cus_user" }) });
    expect(await resolveBillingCustomerId("u1", d)).toBe("cus_user");
    const f = deps({ getUser: vi.fn().mockResolvedValue({ features: { stripeCustomerId: "cus_feat" } }) });
    expect(await resolveBillingCustomerId("u1", f)).toBe("cus_feat");
  });

  it("falls back to the stored subscription's customer when it belongs to this member", async () => {
    const d = deps({
      getUser: vi.fn().mockResolvedValue({ features: { stripeSubscriptionId: "sub_1" } }),
      retrieveSubscription: vi.fn().mockResolvedValue({ customer: "cus_from_sub", metadata: { uid: "u1" } }),
    });
    expect(await resolveBillingCustomerId("u1", d)).toBe("cus_from_sub");
  });

  it("refuses a subscription whose metadata names another member", async () => {
    const d = deps({
      getUser: vi.fn().mockResolvedValue({ features: { stripeSubscriptionId: "sub_1" } }),
      retrieveSubscription: vi.fn().mockResolvedValue({ customer: "cus_other", metadata: { uid: "someone-else" } }),
    });
    expect(await resolveBillingCustomerId("u1", d)).toBe("");
  });

  it("then uses the newest membership payment's customer, ahead of a cached one", async () => {
    const d = deps({
      getUser: vi.fn().mockResolvedValue({ stripeCustomerId: "cus_old" }),
      listMembershipPaymentRefs: vi.fn().mockResolvedValue([{ stripeCustomerId: "" }, { stripeCustomerId: "cus_payment" }]),
    });
    expect(await resolveBillingCustomerId("u1", d)).toBe("cus_payment");
  });

  it("returns empty when there is no customer or no user doc", async () => {
    expect(await resolveBillingCustomerId("u1", deps())).toBe("");
    expect(await resolveBillingCustomerId("u1", deps({ getUser: vi.fn().mockResolvedValue(null) }))).toBe("");
  });

  it("ignores values that are not Stripe customer IDs", async () => {
    const d = deps({ getUser: vi.fn().mockResolvedValue({ stripeCustomerId: "someone@example.com" }) });
    expect(await resolveBillingCustomerId("u1", d)).toBe("");
  });
});

describe("resolvePortalConfigurationId", () => {
  it("uses the env configuration ID first", async () => {
    const list = vi.fn();
    expect(await resolvePortalConfigurationId(" bpc_env ", list)).toBe("bpc_env");
    expect(list).not.toHaveBeenCalled();
  });

  it("otherwise picks the active configuration marked for members", async () => {
    const list = vi.fn().mockResolvedValue([
      { id: "bpc_other", metadata: {} },
      { id: "bpc_member", metadata: { hi_coworking_portal: "member" } },
    ]);
    expect(await resolvePortalConfigurationId(undefined, list)).toBe("bpc_member");
  });

  it("falls back to the account default when none is marked or listing fails", async () => {
    expect(await resolvePortalConfigurationId("", vi.fn().mockResolvedValue([]))).toBeUndefined();
    expect(await resolvePortalConfigurationId("", vi.fn().mockRejectedValue(new Error("x")))).toBeUndefined();
  });
});

describe("members_createBillingPortalSession", () => {
  const source = readFileSync("apps/functions/src/memberBillingPortal.ts", "utf8");

  it("requires sign-in, returns to /my-hi, and gives a safe error without a customer", () => {
    expect(BILLING_PORTAL_RETURN_URL).toBe("https://hi-coworking.com/my-hi");
    expect(source).toContain('throw new HttpsError("unauthenticated"');
    expect(source).toContain('throw new HttpsError("failed-precondition", NO_BILLING_ACCOUNT_MESSAGE)');
    expect(NO_BILLING_ACCOUNT_MESSAGE).toContain("hicoworking@accelanalysis.com");
    expect(source).toContain("return_url: BILLING_PORTAL_RETURN_URL");
    expect(source).toContain("{ secrets: [stripeSecretKey] }");
  });

  it("never looks customers up by email and writes nothing", () => {
    expect(source).not.toMatch(/customers\.(list|search)/);
    expect(source).not.toMatch(/\.(set|update|add)\(/);
  });

  it("is exported from index and main for the core bundle", () => {
    expect(readFileSync("apps/functions/src/index.ts", "utf8")).toContain('export { members_createBillingPortalSession } from "./memberBillingPortal";');
    expect(readFileSync("apps/functions/src/main.ts", "utf8")).toContain("export const members_createBillingPortalSession = legacy.members_createBillingPortalSession;");
    expect(readFileSync("firebase/core-functions/src/index.ts", "utf8")).toContain("  members_createBillingPortalSession,\n");
  });
});
