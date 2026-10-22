import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const memory = vi.hoisted(() => ({ docs: new Map<string, any>(), sequence: 0, queue: Promise.resolve(), finalize: vi.fn() }));
vi.mock("../../apps/functions/node_modules/firebase-admin", () => ({ firestore: () => {
  const doc = (path: string): any => ({ path,
    id: path.split("/").at(-1),
    get: async () => ({ exists: memory.docs.has(path), data: () => memory.docs.get(path) }),
    set: async (data: any, options?: any) => { memory.docs.set(path, options?.merge ? { ...memory.docs.get(path), ...data } : data); },
    update: async (data: any) => {
      const next = structuredClone(memory.docs.get(path) || {});
      for (const [key, value] of Object.entries(data)) {
        const parts = key.split(".");
        let target = next;
        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)!] = value;
      }
      memory.docs.set(path, next);
    },
  });
  return { collection: (name: string) => ({ doc: (id = `id${++memory.sequence}`) => doc(`${name}/${id}`) }),
    runTransaction: (fn: any) => {
      const result = memory.queue.then(() => fn({
        get: (ref: any) => ref.get(), set: (ref: any, data: any, options?: any) => ref.set(data, options),
        update: (ref: any, data: any) => ref.update(data), delete: (ref: any) => memory.docs.delete(ref.path),
      }));
      memory.queue = result.catch(() => {});
      return result;
    },
  };
} }));
import { hasActiveMembership, invoiceSubscriptionId, subscriptionMembership } from "../../apps/functions/src/payments/membership";
import { MEMBERSHIP_TIERS } from "../../apps/functions/src/payments/stripeConfig";
import { StripeProvider } from "../../apps/functions/src/payments/stripeProvider";
import { createMembershipCheckout } from "../../apps/functions/src/payments/membershipCheckout";
vi.mock("../../apps/functions/src/bookingFlexTransaction.js", () => ({ finalizePaidBooking: memory.finalize }));
vi.mock("../../apps/functions/src/eventWebhookBridge", () => ({ maybeFinalizeEventV2Checkout: async () => false }));
import { handleStripeWebhook, syncMembership } from "../../apps/functions/src/payments/stripeWebhook";
import { ensureIdempotent, markWebhookResult } from "../../apps/functions/src/payments/idempotency";

const subscription = (overrides: any = {}) => ({
  id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false,
  metadata: { uid: "user1", plan: "virtual" },
  items: { data: [{ price: { id: MEMBERSHIP_TIERS[1].stripePriceId }, current_period_end: 1900000000 }] },
  ...overrides,
}) as Stripe.Subscription;
const input = { uid: "user1", email: "a@example.com", tierId: "coworking", successUrl: "https://example.com/success", cancelUrl: "https://example.com/cancel" };
beforeEach(() => { memory.docs.clear(); memory.sequence = 0; memory.queue = Promise.resolve(); memory.finalize.mockReset(); memory.finalize.mockResolvedValue({ success: true }); });

describe("membership authority", () => {
  it("fails closed for expired, missing, malformed, and inactive entitlement dates", () => {
    for (const expiresAt of [undefined, 99, 100, NaN, "101"]) {
      expect(hasActiveMembership({ membershipStatus: "active", plan: "coworking", expiresAt }, 100)).toBe(false);
    }
    expect(hasActiveMembership({ membershipStatus: "active", plan: "coworking", expiresAt: 101 }, 100)).toBe(true);
    expect(hasActiveMembership({ membershipStatus: "pastDue", plan: "coworking", expiresAt: 101 }, 100)).toBe(false);
  });
  it("uses actual price and billing period, not stale plan metadata or a fixed 35 days", () => {
    expect(subscriptionMembership(subscription())).toMatchObject({ plan: "coworking", membershipStatus: "active", expiresAt: 1900000000000 });
    expect(subscriptionMembership(subscription({ cancel_at_period_end: true })).membershipStatus).toBe("active");
    expect(subscriptionMembership(subscription({ status: "past_due" }))).toMatchObject({ membershipStatus: "pastDue", expiresAt: 0 });
    expect(subscriptionMembership(subscription({ status: "canceled" }))).toMatchObject({ membershipStatus: "cancelled", expiresAt: 0 });
    expect(subscriptionMembership(subscription({ items: { data: [{ price: { id: "unknown" }, current_period_end: 1900000000 }] } })).membershipStatus).not.toBe("active");
  });
  it("maps current and legacy invoices to subscriptions", () => {
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: "sub_new" } } } } as any)).toBe("sub_new");
    expect(invoiceSubscriptionId({ subscription: "sub_old" } as any)).toBe("sub_old");
    expect(invoiceSubscriptionId({} as any)).toBe("");
  });
});

describe("Stripe webhook parsing", () => {
  async function parse(type: string, object: any) {
    const provider = new StripeProvider("sk_test_fake", "whsec_test");
    const payload = JSON.stringify({ id: "evt_1", type, data: { object } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
    return provider.handleWebhook(Buffer.from(payload), { "stripe-signature": signature });
  }
  it("does not fulfill unpaid completed sessions; accepts delayed payment success", async () => {
    expect((await parse("checkout.session.completed", { payment_status: "unpaid" })).action).toBe("unknown");
    expect(await parse("checkout.session.async_payment_succeeded", { id: "cs_1", payment_status: "paid", amount_total: 12900, currency: "usd", mode: "subscription", metadata: { paymentId: "pay1" } })).toMatchObject({ action: "payment_succeeded", metadata: { amountTotal: "12900", checkoutMode: "subscription", currency: "usd" } });
    expect((await parse("checkout.session.async_payment_failed", { metadata: { paymentId: "pay1" } })).action).toBe("payment_failed");
  });
  it("routes renewal failure and plan changes for authoritative reconciliation", async () => {
    expect((await parse("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_1" } } })).metadata?.subscriptionId).toBe("sub_1");
    expect((await parse("customer.subscription.updated", subscription())).metadata?.subscriptionId).toBe("sub_1");
  });
});

describe("checkout duplicate protection", () => {
  function provider() { return {
    createCheckoutSession: vi.fn(async () => ({ sessionId: "cs_1", url: "https://checkout.stripe.com/test" })),
    retrieveCheckoutSession: vi.fn(async () => ({ id: "cs_1", status: "open", url: "https://checkout.stripe.com/test" })),
    retrieveSubscription: vi.fn(async () => subscription()),
  }; }
  it("concurrent attempts share a ledger and Stripe idempotency key", async () => {
    memory.docs.set("users/user1", { membershipStatus: "none" });
    const p = provider();
    const results = await Promise.all([createMembershipCheckout(p as any, input), createMembershipCheckout(p as any, input)]);
    expect(results[0].paymentId).toBe(results[1].paymentId);
    expect([...memory.docs.keys()].filter((key) => key.startsWith("payments/"))).toHaveLength(1);
    expect(new Set(p.createCheckoutSession.mock.calls.map((call: any) => call[0].metadata.checkoutAttemptId)).size).toBe(1);
  });
  it("reuses open checkout and rejects a second plan", async () => {
    memory.docs.set("users/user1", { membershipStatus: "none" });
    const p = provider();
    await createMembershipCheckout(p as any, input);
    await createMembershipCheckout(p as any, input);
    expect(p.createCheckoutSession).toHaveBeenCalledTimes(1);
    await expect(createMembershipCheckout(p as any, { ...input, tierId: "virtual" })).rejects.toThrow(/existing/);
  });
  it("blocks active and past-due subscriptions rather than creating another", async () => {
    memory.docs.set("users/user1", { features: { stripeSubscriptionId: "sub_1" } });
    const p = provider();
    for (const status of ["active", "past_due", "unpaid", "incomplete", "trialing"]) {
      p.retrieveSubscription.mockResolvedValue(subscription({ status }));
      await expect(createMembershipCheckout(p as any, input)).rejects.toThrow(/already have/);
    }
    expect(p.createCheckoutSession).not.toHaveBeenCalled();
  });
  it("leaves uncertain stale attempts blocked instead of reusing an expired idempotency key", async () => {
    memory.docs.set("users/user1", { membershipStatus: "none" });
    memory.docs.set("membershipCheckouts/user1", { ...input, paymentId: "old", createdAt: Date.now() - 25 * 3600000 });
    const p = provider();
    await expect(createMembershipCheckout(p as any, input)).rejects.toThrow(/reconciliation/);
    expect(p.createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe("webhook retry claims", () => {
  it("retries failed work, skips success, and does not acknowledge in-flight work", async () => {
    const first = await ensureIdempotent("evt_1", "stripe");
    expect(first).toBeTypeOf("string");
    await expect(ensureIdempotent("evt_1", "stripe")).rejects.toThrow(/processing/);
    await markWebhookResult("evt_1", "error: transient", first as string);
    const second = await ensureIdempotent("evt_1", "stripe");
    expect(second).toBeTypeOf("string");
    await expect(markWebhookResult("evt_1", "success", first as string)).rejects.toThrow(/claim lost/);
    await markWebhookResult("evt_1", "success", second as string);
    expect(await ensureIdempotent("evt_1", "stripe")).toBe(false);
  });
  it("recovers crashed and legacy claims without success markers", async () => {
    memory.docs.set("webhookEvents/evt_old", { processedAt: 1 });
    expect(await ensureIdempotent("evt_old", "stripe")).toBeTypeOf("string");
    memory.docs.set("webhookEvents/evt_crash", { result: "processing", leaseExpiresAt: 1 });
    expect(await ensureIdempotent("evt_crash", "stripe")).toBeTypeOf("string");
  });
});


describe("membership lifecycle reconciliation", () => {
  it("renews dates, applies actual plan changes, revokes failed/cancelled subscriptions", async () => {
    memory.docs.set("users/user1", { membershipStatus: "active", plan: "virtual", expiresAt: 1 });
    const provider = { retrieveSubscription: vi.fn(async () => subscription()) };
    const result = { eventId: "evt", action: "payment_succeeded" as const, metadata: { subscriptionId: "sub_1" } };
    await syncMembership(result, provider as any);
    expect(memory.docs.get("users/user1")).toMatchObject({ membershipStatus: "active", plan: "coworking", expiresAt: 1900000000000 });
    expect(memory.docs.get("stripeSubscriptions/sub_1").uid).toBe("user1");
    provider.retrieveSubscription.mockResolvedValue(subscription({ items: { data: [{ price: { id: MEMBERSHIP_TIERS[2].stripePriceId }, current_period_end: 2000000000 }] } }));
    await syncMembership(result, provider as any);
    expect(memory.docs.get("users/user1")).toMatchObject({ plan: "coworking_plus", expiresAt: 2000000000000 });
    provider.retrieveSubscription.mockResolvedValue(subscription({ status: "past_due" }));
    await syncMembership(result, provider as any);
    expect(memory.docs.get("users/user1")).toMatchObject({ membershipStatus: "pastDue", expiresAt: 0 });
    provider.retrieveSubscription.mockResolvedValue(subscription({ status: "canceled" }));
    await syncMembership(result, provider as any);
    expect(memory.docs.get("users/user1")).toMatchObject({ membershipStatus: "cancelled", expiresAt: 0 });
  });
  it("uses mapped owner when Stripe metadata is absent and rejects conflicting ownership", async () => {
    memory.docs.set("users/user1", { membershipStatus: "none" });
    memory.docs.set("stripeSubscriptions/sub_1", { uid: "user1" });
    const provider = { retrieveSubscription: vi.fn(async () => subscription({ metadata: {} })) };
    const result = { eventId: "evt", action: "payment_succeeded" as const, metadata: { subscriptionId: "sub_1" } };
    await syncMembership(result, provider as any);
    expect(memory.docs.get("users/user1").membershipStatus).toBe("active");
    provider.retrieveSubscription.mockResolvedValue(subscription({ metadata: { uid: "other" } }));
    await expect(syncMembership(result, provider as any)).rejects.toThrow(/ownership/);
  });
  it("old cancellation cannot revoke a replacement subscription", async () => {
    memory.docs.set("users/user1", { membershipStatus: "active", plan: "coworking_plus", expiresAt: 2000000000000, features: { stripeSubscriptionId: "sub_new" } });
    const provider = { retrieveSubscription: vi.fn(async () => subscription({ status: "canceled" })) };
    await syncMembership({ eventId: "evt", action: "payment_failed", metadata: { subscriptionId: "sub_1" } }, provider as any);
    expect(memory.docs.get("users/user1")).toMatchObject({ membershipStatus: "active", plan: "coworking_plus", expiresAt: 2000000000000 });
  });
  it("late invoice failure follows latest Stripe state rather than stale event action", async () => {
    memory.docs.set("users/user1", { membershipStatus: "pastDue" });
    const provider = { retrieveSubscription: vi.fn(async () => subscription()) };
    await syncMembership({ eventId: "evt", action: "payment_failed", metadata: { subscriptionId: "sub_1" } }, provider as any);
    expect(memory.docs.get("users/user1").membershipStatus).toBe("active");
  });
});


describe("signed Stripe webhook to durable booking finalization", () => {
  function seed(status = "pending") {
    memory.docs.set("payments/pay1", { id: "pay1", uid: "user1", provider: "stripe", amount: 1750, currency: "usd", purpose: "booking", purposeRefId: "hold1", status, providerRefs: { stripeCheckoutSessionId: "cs_1" } });
  }
  async function deliver(eventId: string, overrides: any = {}, type = "checkout.session.completed") {
    const object = { id: "cs_1", payment_status: "paid", mode: "payment", amount_total: 1750, currency: "usd", payment_intent: "pi_1", metadata: { uid: "user1", paymentId: "pay1", purpose: "booking", purposeRefId: "hold1", holdId: "hold1" }, ...overrides };
    const payload = JSON.stringify({ id: eventId, type, data: { object } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
    return handleStripeWebhook(Buffer.from(payload), { "stripe-signature": signature }, "sk_test_fake", "whsec_test");
  }
  it("marks verified payment paid before awaiting finalizer, and duplicate delivery skips", async () => {
    seed();
    memory.finalize.mockImplementation(async () => {
      expect(memory.docs.get("payments/pay1").status).toBe("paid");
      return { success: true, bookingId: "booking1" };
    });
    expect((await deliver("evt_paid")).status).toBe(200);
    expect(memory.finalize).toHaveBeenCalledWith("hold1", "pay1");
    expect(memory.docs.get("payments/pay1").providerRefs.stripePaymentIntentId).toBe("pi_1");
    expect((await deliver("evt_paid")).body.skipped).toBe(true);
    expect(memory.finalize).toHaveBeenCalledTimes(1);
  });
  it("retries a transient finalization failure rather than swallowing paid recovery", async () => {
    seed();
    memory.finalize.mockRejectedValueOnce(new Error("temporary outage"));
    expect((await deliver("evt_retry")).status).toBe(500);
    expect((await deliver("evt_retry")).status).toBe(200);
    expect(memory.finalize).toHaveBeenCalledTimes(2);
  });
  it("acknowledges durable recovery only after finalizer returns", async () => {
    seed();
    memory.finalize.mockImplementation(async () => {
      memory.docs.set("bookingPaymentRecoveries/pay1", { status: "recovery_required" });
      return { success: false, status: "recovery_required", recoveryId: "pay1" };
    });
    expect((await deliver("evt_recovery")).status).toBe(200);
    expect(memory.docs.has("bookingPaymentRecoveries/pay1")).toBe(true);
  });
  it("rejects mismatched signed amount/currency and ignores unpaid completion", async () => {
    seed();
    expect((await deliver("evt_wrong_amount", { amount_total: 1 })).status).toBe(500);
    expect((await deliver("evt_wrong_currency", { currency: "eur" })).status).toBe(500);
    expect((await deliver("evt_unpaid", { payment_status: "unpaid" })).status).toBe(200);
    expect(memory.docs.get("payments/pay1").status).toBe("pending");
    expect(memory.finalize).not.toHaveBeenCalled();
  });
  it("never regresses terminal refunded/cancelled payments on distinct late paid events", async () => {
    for (const status of ["refunded", "cancelled", "canceled"]) {
      seed(status);
      expect((await deliver(`evt_late_${status}`)).status).toBe(200);
      expect(memory.docs.get("payments/pay1").status).toBe(status);
    }
    expect(memory.finalize).not.toHaveBeenCalled();
  });
});

describe("subscription concurrency fencing", () => {
  it("rejects overlapping live reads and fences an expired worker's stale active response", async () => {
    memory.docs.set("users/user1", { membershipStatus: "active", features: { stripeSubscriptionId: "sub_1" } });
    let resolveOld!: (value: Stripe.Subscription) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const providerOld = { retrieveSubscription: vi.fn(() => { signalStarted(); return new Promise<Stripe.Subscription>((resolve) => { resolveOld = resolve; }); }) };
    const result = { eventId: "evt", action: "payment_succeeded" as const, metadata: { subscriptionId: "sub_1" } };
    const oldWork = syncMembership(result, providerOld as any);
    await started;
    const providerNew = { retrieveSubscription: vi.fn(async () => subscription({ status: "canceled" })) };
    await expect(syncMembership(result, providerNew as any)).rejects.toThrow(/in progress/);
    expect(providerNew.retrieveSubscription).not.toHaveBeenCalled();
    memory.docs.get("stripeSubscriptions/sub_1").syncLeaseExpiresAt = 0;
    await syncMembership(result, providerNew as any);
    resolveOld(subscription());
    await expect(oldWork).rejects.toThrow(/claim lost/);
    expect(memory.docs.get("users/user1")).toMatchObject({ membershipStatus: "cancelled", expiresAt: 0 });
  });
});
