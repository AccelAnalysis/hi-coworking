import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeProvider } from "../../apps/functions/src/payments/stripeProvider";

const webhookSecret = "whsec_exchange_run4_test";
const provider = new StripeProvider("sk_test_not_used", webhookSecret);

async function parse(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: webhookSecret });
  return provider.handleWebhook(Buffer.from(raw), { "stripe-signature": signature });
}

describe("Run 4 Stripe Exchange webhook contracts", () => {
  it("requires a valid Stripe signature", async () => {
    await expect(provider.handleWebhook(Buffer.from("{}"), { "stripe-signature": "bad" })).rejects.toThrow(/invalid webhook signature/i);
    await expect(provider.handleWebhook(Buffer.from("{}"), {})).rejects.toThrow(/missing stripe-signature/i);
  });

  it("preserves authoritative Exchange checkout metadata for idempotent fulfillment", async () => {
    const result = await parse({
      id: "evt_checkout",
      object: "event",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_test_exchange",
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: "pi_test_exchange",
        subscription: null,
        customer: "cus_test_exchange",
        metadata: {
          commercialDomain: "exchange",
          exchangeProductType: "credit_pack",
          organizationId: "acme",
          creditPackKey: "exchange_credits_25",
          credits: "25",
          paymentId: "payment-one",
          policyVersion: "exchange-launch-v1",
        },
      } },
    });
    expect(result).toMatchObject({
      eventId: "evt_checkout",
      action: "payment_succeeded",
      paymentId: "payment-one",
      status: "paid",
      metadata: {
        eventType: "checkout.session.completed",
        sessionId: "cs_test_exchange",
        paymentIntentId: "pi_test_exchange",
        organizationId: "acme",
        credits: "25",
      },
    });
  });

  it("maps subscription periods from verified Stripe state rather than synthetic expiration", async () => {
    const result = await parse({
      id: "evt_subscription",
      object: "event",
      type: "customer.subscription.updated",
      data: { object: {
        id: "sub_test_exchange",
        object: "subscription",
        status: "active",
        created: 1_700_000_000,
        customer: "cus_test_exchange",
        cancel_at_period_end: false,
        metadata: { commercialDomain: "exchange", organizationId: "acme", pricingVersion: "founding-v1" },
        items: { data: [{ current_period_start: 1_710_000_000, current_period_end: 1_712_592_000, price: { id: "price_approved" } }] },
      } },
    });
    expect(result.metadata).toMatchObject({
      subscriptionId: "sub_test_exchange",
      subscriptionStatus: "active",
      currentPeriodStart: String(1_710_000_000 * 1_000),
      currentPeriodEnd: String(1_712_592_000 * 1_000),
      stripePriceId: "price_approved",
    });
  });

  it("routes refund and dispute events to preserved payment-intent correlation", async () => {
    const refund = await parse({
      id: "evt_refund",
      object: "event",
      type: "charge.refunded",
      data: { object: { id: "ch_test", object: "charge", payment_intent: "pi_test_exchange", metadata: {} } },
    });
    const dispute = await parse({
      id: "evt_dispute",
      object: "event",
      type: "charge.dispute.created",
      data: { object: { id: "dp_test", object: "dispute", payment_intent: "pi_test_exchange", metadata: {} } },
    });
    expect(refund).toMatchObject({ action: "refund", status: "refunded", metadata: { paymentIntentId: "pi_test_exchange" } });
    expect(dispute).toMatchObject({ action: "refund", status: "refunded", metadata: { eventType: "charge.dispute.created" } });
  });
});
