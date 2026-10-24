import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  failedPaymentUpdates,
  isFirstSubscriptionInvoice,
  paidPeriodEndMs,
  parseSubscriptionInvoice,
  renewalUpdates,
  subscriptionIdFromInvoice,
} from "../../apps/functions/src/payments/stripeInvoice";
import { StripeProvider } from "../../apps/functions/src/payments/stripeProvider";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_START = 1_793_000_000; // seconds
const PERIOD_END = PERIOD_START + 30 * 24 * 60 * 60;

/** invoice.payment_succeeded payload as sent on API version 2026-07-29.dahlia / 2026-01-28.clover. */
function dahliaInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_renew_1",
    object: "invoice",
    billing_reason: "subscription_cycle",
    customer: "cus_member_1",
    status: "paid",
    period_start: PERIOD_START - 30 * 24 * 60 * 60,
    period_end: PERIOD_START,
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: {
        metadata: { uid: "member-1", plan: "virtual" },
        subscription: "sub_member_1",
      },
    },
    lines: {
      object: "list",
      data: [
        {
          id: "il_1",
          object: "line_item",
          amount: 4900,
          metadata: {},
          period: { start: PERIOD_START, end: PERIOD_END },
          parent: {
            type: "subscription_item_details",
            invoice_item_details: null,
            subscription_item_details: {
              invoice_item: null,
              proration: false,
              proration_details: { credited_items: null },
              subscription: "sub_member_1",
              subscription_item: "si_1",
            },
          },
        },
      ],
      has_more: false,
    },
    ...overrides,
  };
}

describe("subscription lookup on post-basil invoices", () => {
  it("reads invoice.parent.subscription_details.subscription first", () => {
    expect(subscriptionIdFromInvoice(dahliaInvoice())).toBe("sub_member_1");
  });

  it("falls back to the line item parent when invoice.parent has no subscription", () => {
    const invoice = dahliaInvoice({ parent: null });
    invoice.lines.data[0].parent.subscription_item_details.subscription = "sub_from_line";
    expect(subscriptionIdFromInvoice(invoice)).toBe("sub_from_line");
  });

  it("falls back to legacy invoice.subscription (pre-basil payloads)", () => {
    expect(subscriptionIdFromInvoice({ subscription: "sub_legacy", lines: { data: [] } })).toBe("sub_legacy");
    expect(subscriptionIdFromInvoice({ subscription: { id: "sub_expanded" } })).toBe("sub_expanded");
  });

  it("returns empty for a one-off invoice", () => {
    expect(subscriptionIdFromInvoice({ parent: null, lines: { data: [{ period: { end: 1 } }] } })).toBe("");
  });

  it("parses uid, plan, and paid period end from the invoice", () => {
    expect(parseSubscriptionInvoice(dahliaInvoice())).toEqual({
      invoiceId: "in_renew_1",
      subscriptionId: "sub_member_1",
      customerId: "cus_member_1",
      billingReason: "subscription_cycle",
      uid: "member-1",
      plan: "virtual",
      periodEndMs: PERIOD_END * 1000,
    });
    // period_end on a renewal invoice is the start of the new period, not the paid end.
    expect(paidPeriodEndMs(dahliaInvoice())).not.toBe(PERIOD_START * 1000);
  });

  it("treats the first invoice as handled by checkout", () => {
    expect(isFirstSubscriptionInvoice("subscription_create")).toBe(true);
    expect(isFirstSubscriptionInvoice("subscription_cycle")).toBe(false);
  });
});

describe("renewal updates", () => {
  const now = PERIOD_START * 1000;
  const info = { invoiceId: "in_renew_1", subscriptionId: "sub_member_1", plan: "virtual", periodEndMs: PERIOD_END * 1000 };

  it("sets expiresAt to period end + 5 days, clears pastDue, keeps membership active", () => {
    const updates = renewalUpdates(
      { membershipStatus: "pastDue", plan: "virtual", expiresAt: now - DAY_MS, pastDue: true, pastDueAt: now - 2 * DAY_MS },
      info,
      now,
    );
    expect(updates).toMatchObject({
      membershipStatus: "active",
      expiresAt: PERIOD_END * 1000 + 5 * DAY_MS,
      pastDue: false,
      pastDueAt: null,
      lastPaidInvoiceId: "in_renew_1",
      "features.stripeSubscriptionId": "sub_member_1",
    });
    expect(updates).not.toHaveProperty("plan");
    // Consistent with the existing 35-day rule for a 30-day period.
    expect((updates!.expiresAt as number) - now).toBe(35 * DAY_MS);
  });

  it("is idempotent for the same invoice and never moves expiresAt backwards", () => {
    expect(renewalUpdates({ lastPaidInvoiceId: "in_renew_1" }, info, now)).toBeNull();
    const later = PERIOD_END * 1000 + 40 * DAY_MS;
    expect(renewalUpdates({ expiresAt: later }, info, now)!.expiresAt).toBe(later);
  });

  it("falls back to now + 35 days when the invoice has no line period", () => {
    expect(renewalUpdates({}, { ...info, periodEndMs: 0 }, now)!.expiresAt).toBe(now + 35 * DAY_MS);
  });

  it("restores the plan from subscription metadata only when the user has none", () => {
    expect(renewalUpdates({ plan: null }, info, now)).toMatchObject({ plan: "virtual" });
  });
});

describe("failed payment updates", () => {
  const now = 1_800_000_000_000;

  it("sets pastDue true with a timestamp and leaves membershipStatus (access kept during Stripe retries)", () => {
    const updates = failedPaymentUpdates({ membershipStatus: "active" }, { invoiceId: "in_2" }, now);
    expect(updates).not.toHaveProperty("membershipStatus");
    expect(updates).not.toHaveProperty("plan");
    expect(updates).not.toHaveProperty("expiresAt");
    expect(updates).toEqual({
      pastDue: true,
      pastDueAt: now,
      lastFailedInvoiceId: "in_2",
      updatedAt: now,
    });
  });

  it("keeps the first pastDueAt on Stripe retries and skips duplicates", () => {
    expect(failedPaymentUpdates({ pastDue: true, pastDueAt: now - DAY_MS, lastFailedInvoiceId: "in_1" }, { invoiceId: "in_2" }, now))
      .toMatchObject({ pastDueAt: now - DAY_MS });
    expect(failedPaymentUpdates({ pastDue: true, pastDueAt: now, lastFailedInvoiceId: "in_2" }, { invoiceId: "in_2" }, now)).toBeNull();
  });

  it("ignores a failure for an invoice that was already paid", () => {
    expect(failedPaymentUpdates({ lastPaidInvoiceId: "in_2" }, { invoiceId: "in_2" }, now)).toBeNull();
  });
});

describe("StripeProvider.handleWebhook with signed dahlia invoice events", () => {
  const secret = "whsec_test_fixture_only";

  function signed(type: string, invoice: unknown) {
    const payload = JSON.stringify({
      id: `evt_${type.replace(/\W/g, "_")}`,
      object: "event",
      api_version: "2026-07-29.dahlia",
      type,
      data: { object: invoice },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return { body: Buffer.from(payload), headers: { "stripe-signature": header } };
  }

  it("maps invoice.payment_succeeded to a renewal for the subscription member", async () => {
    const provider = new StripeProvider("sk_test_fixture_only", secret);
    const { body, headers } = signed("invoice.payment_succeeded", dahliaInvoice());
    const result = await provider.handleWebhook(body, headers);
    expect(result.action).toBe("subscription_invoice_paid");
    expect(result.metadata).toMatchObject({
      subscriptionId: "sub_member_1",
      uid: "member-1",
      invoiceId: "in_renew_1",
      billingReason: "subscription_cycle",
      periodEndMs: String(PERIOD_END * 1000),
    });
  });

  it("retrieves the subscription for metadata.uid when the invoice has none", async () => {
    const provider = new StripeProvider("sk_test_fixture_only", secret);
    const retrieve = vi.fn().mockResolvedValue({ id: "sub_member_1", metadata: { uid: "member-from-sub", plan: "virtual" } });
    (provider as unknown as { stripe: { subscriptions: { retrieve: typeof retrieve } } }).stripe.subscriptions.retrieve = retrieve;
    const invoice = dahliaInvoice();
    invoice.parent.subscription_details.metadata = {} as never;
    const { body, headers } = signed("invoice.payment_failed", invoice);
    const result = await provider.handleWebhook(body, headers);
    expect(retrieve).toHaveBeenCalledWith("sub_member_1");
    expect(result.action).toBe("subscription_invoice_failed");
    expect(result.metadata?.uid).toBe("member-from-sub");
  });

  it("ignores invoices that are not for a subscription", async () => {
    const provider = new StripeProvider("sk_test_fixture_only", secret);
    const { body, headers } = signed("invoice.payment_succeeded", { id: "in_oneoff", parent: null, lines: { data: [] } });
    expect((await provider.handleWebhook(body, headers)).action).toBe("unknown");
  });
});

describe("stripe_webhook wiring", () => {
  const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
  const provider = readFileSync("apps/functions/src/payments/stripeProvider.ts", "utf8");

  it("no longer reads the removed invoice.subscription field directly", () => {
    expect(provider).not.toContain("(invoice as unknown as Record<string, unknown>).subscription");
    expect(provider).toContain("parseSubscriptionInvoice");
  });

  it("routes invoice results through the transactional member update", () => {
    expect(webhook).toContain('case "subscription_invoice_paid":');
    expect(webhook).toContain("isFirstSubscriptionInvoice(meta.billingReason)");
    expect(webhook).toContain('where(field, "==", subscriptionId)');
    expect(webhook).toContain("runTransaction");
  });

  it("ends access only when Stripe deletes the subscription after its retries", () => {
    expect(provider).toContain('case "customer.subscription.deleted":');
    expect(provider).toContain('reason: "subscription_cancelled"');
    expect(webhook).toContain('updates.membershipStatus = "cancelled";');
  });
});
