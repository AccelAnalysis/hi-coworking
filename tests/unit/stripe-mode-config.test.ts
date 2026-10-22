import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { MEMBERSHIP_TIERS, TEST_STRIPE_PRICE_IDS, getCheckoutTier, getTierByPriceId, resolveStripeMode } from "../../apps/functions/src/payments/stripeConfig";
import { StripeProvider } from "../../apps/functions/src/payments/stripeProvider";
import { subscriptionMembership } from "../../apps/functions/src/payments/membership";

beforeEach(() => { vi.stubEnv("STRIPE_MODE", "test"); vi.stubEnv("GCLOUD_PROJECT", "demo-hi-coworking"); });
afterEach(() => vi.unstubAllEnvs());

describe("explicit Stripe mode and isolated price catalogs", () => {
  it("preserves all verified live IDs and maps every tier to a distinct test price", () => {
    expect(MEMBERSHIP_TIERS.map(t => t.stripePriceId)).toEqual([
      "price_1U9J0xAHu8lEXCs8UHv7AAiz", "price_1U9J1CAHu8lEXCs8X1o0O5hG", "price_1U9J1KAHu8lEXCs8xZETzk7F",
    ]);
    for (const tier of MEMBERSHIP_TIERS) {
      const test = getCheckoutTier(tier.id, "test");
      expect(test).toEqual({ ...tier, stripePriceId: TEST_STRIPE_PRICE_IDS[tier.id] });
      expect(getTierByPriceId(test.stripePriceId, "test")?.id).toBe(tier.id);
      expect(getTierByPriceId(test.stripePriceId, "live")).toBeUndefined();
      expect(getTierByPriceId(tier.stripePriceId, "test")).toBeUndefined();
    }
  });
  it("requires an explicit valid mode, matching key and isolated Firebase project", () => {
    expect(resolveStripeMode("sk_test_fake", "test", "demo-hi-coworking")).toBe("test");
    expect(resolveStripeMode("rk_live_fake", "live", "hi-coworking-plat")).toBe("live");
    for (const [key, mode, project] of [
      ["sk_test_fake", "", "demo-hi-coworking"], ["sk_test_fake", "sandbox", "demo-hi-coworking"],
      ["sk_live_fake", "test", "demo-hi-coworking"], ["sk_test_fake", "live", "hi-coworking-plat"],
      ["opaque", "test", "demo-hi-coworking"], ["sk_test_fake", "test", "hi-coworking-plat"],
      ["sk_live_fake", "live", "hi-coworking-staging"], ["sk_test_fake", "test", ""],
    ]) expect(() => resolveStripeMode(key, mode, project)).toThrow();
  });
  it("rejects unknown tiers, invalid mode and absent test mappings", () => {
    expect(() => getCheckoutTier("annual", "test")).toThrow(/mapping/);
    expect(() => getCheckoutTier("virtual", undefined as any)).toThrow(/mapping/);
    const old = TEST_STRIPE_PRICE_IDS.virtual;
    try { TEST_STRIPE_PRICE_IDS.virtual = ""; expect(() => getCheckoutTier("virtual", "test")).toThrow(/mapping/); }
    finally { TEST_STRIPE_PRICE_IDS.virtual = old; }
  });
  it("rejects opposite-mode or missing-mode signed events before fulfillment", async () => {
    const provider = new StripeProvider("sk_test_fake", "whsec_test");
    for (const livemode of [true, undefined]) {
      const payload = JSON.stringify({ id: "evt", livemode, type: "checkout.session.completed", data: { object: { payment_status: "paid" } } });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
      await expect(provider.handleWebhook(Buffer.from(payload), { "stripe-signature": signature })).rejects.toThrow(/mode mismatch/);
    }
  });
  it("cannot send a live or absent membership price through a test-mode provider", async () => {
    const provider = new StripeProvider("sk_test_fake", "whsec_test");
    const create = vi.spyOn((provider as any).stripe.checkout.sessions, "create").mockResolvedValue({ id: "cs_test", url: "https://checkout.stripe.com/test" });
    const tier = getCheckoutTier("coworking", "test");
    const input = { uid: "u", amount: tier.amountCents, currency: "usd", purpose: "membership" as const, successUrl: "https://example.test/success", cancelUrl: "https://example.test/cancel", metadata: { plan: tier.id, stripePriceId: MEMBERSHIP_TIERS[1].stripePriceId } };
    await expect(provider.createCheckoutSession(input)).rejects.toThrow(/catalog/);
    await expect(provider.createCheckoutSession({ ...input, metadata: { plan: tier.id } })).rejects.toThrow(/catalog/);
    expect(create).not.toHaveBeenCalled();
    await provider.createCheckoutSession({ ...input, metadata: { plan: tier.id, stripePriceId: tier.stripePriceId } });
    expect(create.mock.calls[0][0].line_items).toEqual([{ price: tier.stripePriceId, quantity: 1 }]);
  });
  it("grants only the configured mode's subscription price", () => {
    const sub = (price: string) => ({ id: "sub", customer: "cus", status: "active", items: { data: [{ price: { id: price }, current_period_end: 1900000000 }] } }) as any;
    expect(subscriptionMembership(sub(TEST_STRIPE_PRICE_IDS.coworking), "test")).toMatchObject({ plan: "coworking", membershipStatus: "active" });
    expect(subscriptionMembership(sub(MEMBERSHIP_TIERS[1].stripePriceId), "test").membershipStatus).not.toBe("active");
    expect(subscriptionMembership(sub(TEST_STRIPE_PRICE_IDS.coworking), "live").membershipStatus).not.toBe("active");
  });
  it("rejects wrong-mode retrieved sessions and subscriptions", async () => {
    const provider = new StripeProvider("sk_test_fake", "whsec_test");
    vi.spyOn((provider as any).stripe.subscriptions, "retrieve").mockResolvedValue({ id: "sub", livemode: true });
    vi.spyOn((provider as any).stripe.checkout.sessions, "retrieve").mockResolvedValue({ id: "cs", livemode: true });
    await expect(provider.retrieveSubscription("sub")).rejects.toThrow(/mode mismatch/);
    await expect(provider.retrieveCheckoutSession("cs")).rejects.toThrow(/mode mismatch/);
  });
});
