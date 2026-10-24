import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  parseSubscriptionUpdate,
  subscriptionUpdatedUpdates,
  type SubscriptionUpdateInfo,
} from "../../apps/functions/src/payments/stripeSubscription";
import { StripeProvider } from "../../apps/functions/src/payments/stripeProvider";

const VIRTUAL = "price_1U9J0xAHu8lEXCs8UHv7AAiz";
const COWORKING = "price_1U9J1CAHu8lEXCs8X1o0O5hG";
const PLUS = "price_1U9J1KAHu8lEXCs8xZETzk7F";
const PERIOD_END = 1_795_600_000; // seconds
const CREATED = 1_793_100_000; // seconds
const now = 1_793_200_000_000;

/** customer.subscription.updated payload shape on 2026-07-29.dahlia. */
function dahliaSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_member_1",
    object: "subscription",
    customer: "cus_member_1",
    status: "active",
    metadata: { uid: "member-1", plan: "virtual" },
    cancel_at_period_end: false,
    cancel_at: null,
    items: {
      object: "list",
      data: [{ id: "si_1", price: { id: VIRTUAL }, current_period_start: PERIOD_END - 30 * 86400, current_period_end: PERIOD_END }],
    },
    ...overrides,
  };
}

function info(overrides: Partial<SubscriptionUpdateInfo> = {}): SubscriptionUpdateInfo {
  return {
    subscriptionId: "sub_member_1",
    customerId: "cus_member_1",
    uid: "member-1",
    status: "active",
    priceId: VIRTUAL,
    cancelAtPeriodEnd: false,
    cancelAtMs: 0,
    eventCreatedMs: CREATED * 1000,
    ...overrides,
  };
}

const member = {
  membershipStatus: "active",
  plan: "virtual",
  features: { stripeSubscriptionId: "sub_member_1" },
  stripeCustomerId: "cus_member_1",
};

describe("parseSubscriptionUpdate", () => {
  it("reads price, customer, uid and the scheduled end from a dahlia payload", () => {
    const parsed = parseSubscriptionUpdate(dahliaSubscription({ cancel_at_period_end: true, cancel_at: PERIOD_END }) as never, CREATED);
    expect(parsed).toEqual({
      subscriptionId: "sub_member_1",
      customerId: "cus_member_1",
      uid: "member-1",
      status: "active",
      priceId: VIRTUAL,
      cancelAtPeriodEnd: true,
      cancelAtMs: PERIOD_END * 1000,
      eventCreatedMs: CREATED * 1000,
    });
  });

  it("falls back to the item period end when only cancel_at_period_end is set", () => {
    const parsed = parseSubscriptionUpdate(dahliaSubscription({ cancel_at_period_end: true, cancel_at: null }) as never, CREATED);
    expect(parsed.cancelAtMs).toBe(PERIOD_END * 1000);
  });

  it("accepts an expanded customer object", () => {
    expect(parseSubscriptionUpdate(dahliaSubscription({ customer: { id: "cus_x" } }) as never, CREATED).customerId).toBe("cus_x");
  });
});

describe("subscriptionUpdatedUpdates", () => {
  it("switches the plan when the portal changes the price", () => {
    const decision = subscriptionUpdatedUpdates(member, info({ priceId: PLUS }), now);
    expect(decision).toEqual({
      apply: true,
      unknownPrice: false,
      updates: { plan: "coworking_plus", lastSubscriptionEventAt: CREATED * 1000, updatedAt: now },
    });
    expect(subscriptionUpdatedUpdates(member, info({ priceId: COWORKING }), now))
      .toMatchObject({ apply: true, updates: { plan: "coworking" } });
  });

  it("records a cancellation at period end for the Ends on display, and clears it on renew", () => {
    const cancelAtMs = PERIOD_END * 1000;
    const scheduled = subscriptionUpdatedUpdates(member, info({ cancelAtPeriodEnd: true, cancelAtMs }), now);
    expect(scheduled).toMatchObject({ apply: true, updates: { cancelAtPeriodEnd: true, cancelAt: cancelAtMs } });
    if (!scheduled.apply) throw new Error("expected apply");
    expect(scheduled.updates).not.toHaveProperty("membershipStatus");
    expect(scheduled.updates).not.toHaveProperty("expiresAt");

    const cancelled = { ...member, cancelAtPeriodEnd: true, cancelAt: cancelAtMs, lastSubscriptionEventAt: CREATED * 1000 };
    const resumed = subscriptionUpdatedUpdates(cancelled, info({ eventCreatedMs: (CREATED + 60) * 1000 }), now);
    expect(resumed).toMatchObject({ apply: true, updates: { cancelAtPeriodEnd: false, cancelAt: null } });
  });

  it("is idempotent: the same state again changes nothing", () => {
    const cancelAtMs = PERIOD_END * 1000;
    const applied = { ...member, cancelAtPeriodEnd: true, cancelAt: cancelAtMs, lastSubscriptionEventAt: CREATED * 1000 };
    expect(subscriptionUpdatedUpdates(applied, info({ cancelAtPeriodEnd: true, cancelAtMs }), now))
      .toEqual({ apply: false, reason: "no_change", unknownPrice: false });
  });

  it("never revives or touches a cancelled, expired or non-member", () => {
    for (const membershipStatus of ["cancelled", "expired", "none", undefined]) {
      expect(subscriptionUpdatedUpdates({ ...member, membershipStatus }, info({ priceId: PLUS }), now))
        .toEqual({ apply: false, reason: "member_not_current" });
    }
  });

  it("leaves ended or unfinished subscriptions to the deleted and Checkout paths", () => {
    for (const status of ["canceled", "incomplete", "incomplete_expired"]) {
      expect(subscriptionUpdatedUpdates(member, info({ status, priceId: PLUS }), now))
        .toMatchObject({ apply: false, reason: `subscription_${status}` });
    }
    // past_due still follows plan changes; payment state is owned by invoice events.
    expect(subscriptionUpdatedUpdates(member, info({ status: "past_due", priceId: PLUS }), now)).toMatchObject({ apply: true });
  });

  it("ignores events for a different subscription than the one on file", () => {
    expect(subscriptionUpdatedUpdates(member, info({ subscriptionId: "sub_old", priceId: PLUS }), now))
      .toEqual({ apply: false, reason: "different_subscription" });
    expect(subscriptionUpdatedUpdates({ ...member, features: {}, stripeSubscriptionId: "sub_member_1" }, info({ subscriptionId: "sub_old" }), now))
      .toMatchObject({ apply: false, reason: "different_subscription" });
  });

  it("ignores an older event that arrives after a newer one", () => {
    const user = { ...member, plan: "coworking_plus", lastSubscriptionEventAt: (CREATED + 100) * 1000 };
    expect(subscriptionUpdatedUpdates(user, info({ priceId: VIRTUAL }), now)).toEqual({ apply: false, reason: "stale_event" });
  });

  it("keeps the plan for an unknown price and flags it", () => {
    const decision = subscriptionUpdatedUpdates(member, info({ priceId: "price_unknown", cancelAtPeriodEnd: true, cancelAtMs: PERIOD_END * 1000 }), now);
    expect(decision).toMatchObject({ apply: true, unknownPrice: true });
    if (!decision.apply) throw new Error("expected apply");
    expect(decision.updates).not.toHaveProperty("plan");
  });

  it("records the Stripe customer and subscription when they are missing", () => {
    const decision = subscriptionUpdatedUpdates({ membershipStatus: "active", plan: "virtual" }, info(), now);
    expect(decision).toMatchObject({
      apply: true,
      updates: { stripeCustomerId: "cus_member_1", "features.stripeSubscriptionId": "sub_member_1" },
    });
  });
});

describe("StripeProvider.handleWebhook with a signed customer.subscription.updated", () => {
  const secret = "whsec_test_fixture_only";

  it("maps the event to subscription_updated with string metadata", async () => {
    const provider = new StripeProvider("sk_test_fixture_only", secret);
    const payload = JSON.stringify({
      id: "evt_sub_updated_1",
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: CREATED,
      type: "customer.subscription.updated",
      data: { object: dahliaSubscription({ cancel_at_period_end: true, cancel_at: PERIOD_END, items: { data: [{ price: { id: PLUS }, current_period_end: PERIOD_END }] } }) },
    });
    const headers = { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret }) };
    const result = await provider.handleWebhook(Buffer.from(payload), headers);
    expect(result).toEqual({
      eventId: "evt_sub_updated_1",
      action: "subscription_updated",
      metadata: {
        subscriptionId: "sub_member_1",
        customerId: "cus_member_1",
        uid: "member-1",
        status: "active",
        priceId: PLUS,
        cancelAtPeriodEnd: "true",
        cancelAtMs: String(PERIOD_END * 1000),
        eventCreatedMs: String(CREATED * 1000),
      },
    });
  });
});

describe("subscription.updated webhook wiring", () => {
  const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
  it("applies the decision in a transaction and resolves the member like invoices do", () => {
    expect(webhook).toContain('case "subscription_updated":');
    const handler = webhook.slice(webhook.indexOf("async function handleSubscriptionUpdated"));
    expect(handler).toContain("resolveSubscriptionMember(meta.uid, subscriptionId)");
    expect(handler).toContain("runTransaction");
    expect(handler).toContain("subscriptionUpdatedUpdates(user, info, Date.now())");
    expect(handler).not.toContain("membershipStatus");
  });
});
