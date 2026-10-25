import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: [] as unknown[][], error: [] as unknown[][], warn: [] as unknown[][] }));
vi.mock("firebase-functions/logger", () => ({
  info: (...args: unknown[]) => { logs.info.push(args); },
  warn: (...args: unknown[]) => { logs.warn.push(args); },
  error: (...args: unknown[]) => { logs.error.push(args); },
}));

import {
  buildRefundSnapshot,
  memberRefundSummary,
  refundDestination,
  refundLedgerUpdates,
} from "../../apps/functions/src/payments/stripeRefund";
import {
  COMPANY_NAME,
  renderCancellationScheduledEmail,
  renderMembershipEndedEmail,
  renderRefundEmail,
  sendCancellationScheduledEmail,
  sendMembershipEndedEmail,
  sendRefundEmail,
  type NoticeMember,
  type NoticeStore,
} from "../../apps/functions/src/payments/memberNoticeEmails";
import { CONTACT_EMAIL, STALE_CLAIM_MS } from "../../apps/functions/src/payments/membershipWelcomeEmail";
import { refundNotification } from "../../apps/functions/src/payments/stripeRefundHandler";
import { StripeProvider } from "../../apps/functions/src/payments/stripeProvider";
import { EmailSendError, type EmailMessage, type EmailProvider } from "../../apps/functions/src/providers/emailProvider";
import type { StripeRefundSnapshot } from "../../apps/functions/src/payments/types";

const ORIGIN = "https://hi-coworking.com";
const REFUND_AT = 1_792_879_273; // seconds

function charge(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch_test_1",
    amount: 4900,
    amount_captured: 4900,
    amount_refunded: 4900,
    currency: "usd",
    customer: "cus_test_1",
    payment_intent: "pi_test_1",
    metadata: {},
    payment_method_details: { type: "link", link: {} },
    ...overrides,
  };
}

const membershipInvoice = {
  invoiceId: "in_test_1",
  billingReason: "subscription_create",
  subscriptionId: "sub_test_1",
  uid: "member-1",
  plan: "virtual",
};

function snapshot(overrides: Partial<StripeRefundSnapshot> = {}): StripeRefundSnapshot {
  return {
    ...buildRefundSnapshot({
      charge: charge(),
      refunds: [{ id: "re_test_1", amount: 4900, status: "succeeded", created: REFUND_AT }],
      invoice: membershipInvoice,
    }),
    ...overrides,
  };
}

function memoryStore(member: NoticeMember | null) {
  const docs = new Map<string, Record<string, unknown>>();
  const store: NoticeStore = {
    async claim(key, data, now) {
      const existing = docs.get(key);
      if (existing?.status === "sent") return false;
      if (existing?.status === "sending" && now - Number(existing.claimedAt) < STALE_CLAIM_MS) return false;
      docs.set(key, { ...existing, ...data, status: "sending", claimedAt: now });
      return true;
    },
    async markSent(key, messageId, now) {
      docs.set(key, { ...docs.get(key), status: "sent", messageId, sentAt: now });
    },
    async markFailed(key, code, now) {
      docs.set(key, { ...docs.get(key), status: "failed", errorCode: code, failedAt: now });
    },
    async loadMember() {
      return member;
    },
  };
  return { store, docs };
}

function fakeProvider(fail?: Error) {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    async send(message) {
      sent.push(message);
      if (fail) throw fail;
      return { messageId: `msg_${sent.length}` };
    },
    async sendBatch() {
      return { sent: 0, failed: 0 };
    },
  };
  return { provider, sent };
}

const member: NoticeMember = {
  email: "member@example.com",
  displayName: "Jordan Smith",
  membershipStatus: "active",
  plan: "coworking",
  features: { stripeSubscriptionId: "sub_test_1" },
};

beforeEach(() => {
  logs.info.length = 0;
  logs.warn.length = 0;
  logs.error.length = 0;
});

describe("refund snapshot and ledger", () => {
  it("reads a Link-paid membership charge with no card details", () => {
    const snap = snapshot();
    expect(snap).toMatchObject({
      refundId: "re_test_1",
      chargeId: "ch_test_1",
      paymentIntentId: "pi_test_1",
      amountCents: 4900,
      amountRefundedCents: 4900,
      subscriptionId: "sub_test_1",
      uid: "member-1",
      billingReason: "subscription_create",
    });
    expect(snap.cardLast4).toBeUndefined();
    expect(refundDestination(snap)).toBe("your original payment method");
  });

  it("names the card when Stripe gives last4 and brand", () => {
    const snap = buildRefundSnapshot({
      charge: charge({ payment_method_details: { card: { last4: "4242", brand: "visa" } } }),
      refunds: [],
    });
    expect(refundDestination(snap)).toBe("your Visa card ending in 4242");
    expect(refundDestination({ cardLast4: "1881" })).toBe("your card ending in 1881");
  });

  it("marks a full refund refunded and records the amount, time and refund IDs", () => {
    const { status, updates } = refundLedgerUpdates({ status: "paid" }, snapshot(), 1);
    expect(status).toBe("refunded");
    expect(updates).toMatchObject({
      status: "refunded",
      amountRefunded: 4900,
      refundedAt: REFUND_AT * 1000,
      stripeRefundIds: ["re_test_1"],
      "providerRefs.stripeChargeId": "ch_test_1",
      "providerRefs.stripePaymentIntentId": "pi_test_1",
    });
  });

  it("is idempotent: the same charge state gives the same update", () => {
    const first = refundLedgerUpdates({ status: "paid" }, snapshot(), 1);
    const again = refundLedgerUpdates({ status: first.status, amountRefunded: 4900 }, snapshot(), 1);
    expect(again.updates).toEqual(first.updates);
  });

  it("marks a partial refund partially_refunded, but keeps an app-set refunded", () => {
    const partial = buildRefundSnapshot({
      charge: charge({ amount_refunded: 2000 }),
      refunds: [{ id: "re_part", amount: 2000, status: "succeeded", created: REFUND_AT }],
    });
    expect(refundLedgerUpdates({ status: "paid" }, partial, 1).status).toBe("partially_refunded");
    expect(refundLedgerUpdates({ status: "refunded" }, partial, 1).status).toBe("refunded");
  });

  it("returns a payment to paid when its only refund failed", () => {
    const failed = buildRefundSnapshot({
      charge: charge({ amount_refunded: 0 }),
      refunds: [{ id: "re_failed", amount: 4900, status: "failed", created: REFUND_AT }],
    });
    const { updates } = refundLedgerUpdates({ status: "refunded" }, failed, 1);
    expect(updates).toMatchObject({ status: "paid", amountRefunded: 0, refundedAt: null });
    expect(refundLedgerUpdates({ status: "failed" }, failed, 1).status).toBe("failed");
  });
});

describe("My Hi refund summary and notification", () => {
  it("summarizes the newest issued refund and flags a failed one", () => {
    const summary = memberRefundSummary(null, snapshot())!;
    expect(summary).toMatchObject({ refundId: "re_test_1", amountCents: 4900, full: true, status: "issued" });
    const failed = buildRefundSnapshot({
      charge: charge({ amount_refunded: 0 }),
      refunds: [{ id: "re_test_1", amount: 4900, status: "failed", created: REFUND_AT }],
    });
    expect(memberRefundSummary(summary, failed)?.status).toBe("failed");
    expect(memberRefundSummary(null, failed)).toBeNull();
  });

  it("does not replace a newer refund with an older charge's", () => {
    const newer = { ...memberRefundSummary(null, snapshot())!, chargeId: "ch_newer", refundedAt: REFUND_AT * 1000 + 10 };
    expect(memberRefundSummary(newer, snapshot())).toBeNull();
  });

  it("builds an bell-feed refund notification linking to My Hi", () => {
    const snap = snapshot();
    const note = refundNotification("member-1", snap, snap.refunds[0], 5);
    expect(note).toMatchObject({ id: "membership_refund_re_test_1", type: "membership_refund", linkTo: "/my-hi", read: false });
    expect(note.body).toBe(
      "We've refunded $49.00 to your original payment method. Refunds usually take 5–10 business days to appear on your statement.",
    );
  });
});

describe("member notice email copy", () => {
  const all = [
    renderRefundEmail({ amountCents: 4900, cardLast4: "4242", cardBrand: "visa", firstName: "Jordan", origin: ORIGIN }),
    renderCancellationScheduledEmail({ activeUntilMs: Date.UTC(2026, 10, 24, 15), planId: "coworking", firstName: "Jordan", origin: ORIGIN }),
    renderMembershipEndedEmail({ endedAtMs: Date.UTC(2026, 9, 24, 22), planId: "virtual", origin: ORIGIN }),
  ];

  it("has the refund amount, card, timing and My Hi link", () => {
    const copy = all[0];
    expect(copy.subject).toBe("Your Hi Coworking refund of $49.00 is on its way");
    expect(copy.text).toContain("We've refunded $49.00 to your Visa card ending in 4242.");
    expect(copy.text).toContain("5–10 business days");
    expect(renderRefundEmail({ amountCents: 2000, chargeAmountCents: 4900, origin: ORIGIN }).text)
      .toContain("This is a partial refund of your $49.00 payment.");
  });

  it("states the date a scheduled cancellation stays active until", () => {
    expect(all[1].subject).toBe("Your Hi Coworking membership is active until November 24, 2026");
    expect(all[1].text).toContain("Your membership stays active until November 24, 2026");
    expect(all[1].text).toContain("cancel your Coworking membership.");
  });

  it("confirms the membership ended", () => {
    expect(all[2].subject).toBe("Your Hi Coworking membership has ended");
    expect(all[2].text).toContain("Your Virtual Office membership ended on October 24, 2026");
    expect(all[2].text).toContain("Hi there,");
  });

  it("names Accel Analysis, links My Hi and has no marketing footer", () => {
    for (const copy of all) {
      for (const body of [copy.html, copy.text]) {
        expect(body).toContain(COMPANY_NAME);
        expect(body).toContain(`${ORIGIN}/my-hi`);
        expect(body).toContain(CONTACT_EMAIL);
        expect(body).not.toMatch(/undefined|NaN|null/);
        expect(body).not.toMatch(/unsubscribe/i);
      }
      expect(copy.html).toContain('<html lang="en">');
      expect(copy.text).not.toMatch(/<[a-z]/i);
    }
  });
});

describe("member notice sending", () => {
  it("sends the refund confirmation once per refund", async () => {
    const { store, docs } = memoryStore(member);
    const { provider, sent } = fakeProvider();
    const snap = snapshot();
    const opts = { store, provider, origin: ORIGIN, now: () => 10 };
    expect(await sendRefundEmail("member-1", snap, snap.refunds[0], opts)).toBe("sent");
    expect(await sendRefundEmail("member-1", snap, snap.refunds[0], opts)).toBe("skipped_already_sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "member@example.com", idempotencyKey: "refund_confirmation/refund_re_test_1" });
    expect(docs.get("refund_re_test_1")).toMatchObject({ status: "sent", type: "refund_confirmation" });
    expect(JSON.stringify(logs)).not.toContain("member@example.com");
  });

  it("never throws when the send fails, and records the error code", async () => {
    const { store, docs } = memoryStore(member);
    const { provider } = fakeProvider(new EmailSendError(422, "validation_error"));
    const snap = snapshot();
    await expect(sendRefundEmail("member-1", snap, snap.refunds[0], { store, provider })).resolves.toBe("failed");
    expect(docs.get("refund_re_test_1")).toMatchObject({ status: "failed", errorCode: "422_validation_error" });
    const broken: NoticeStore = { ...store, claim: async () => { throw new Error("firestore down"); } };
    await expect(sendRefundEmail("member-1", snap, snap.refunds[0], { store: broken, provider })).resolves.toBe("failed");
  });

  it("skips without a Resend key", async () => {
    const snap = snapshot();
    expect(await sendRefundEmail("member-1", snap, snap.refunds[0], {})).toBe("skipped_no_api_key");
  });

  it("sends the scheduled cancellation once per end date, never for comp members", async () => {
    const { store } = memoryStore(member);
    const { provider, sent } = fakeProvider();
    const input = { uid: "member-1", subscriptionId: "sub_test_1", activeUntilMs: Date.UTC(2026, 10, 24, 15) };
    expect(await sendCancellationScheduledEmail(input, { store, provider })).toBe("sent");
    expect(await sendCancellationScheduledEmail(input, { store, provider })).toBe("skipped_already_sent");
    expect(sent).toHaveLength(1);

    const comp = memoryStore({ ...member, membershipSource: "comp" });
    expect(await sendCancellationScheduledEmail(input, { store: comp.store, provider })).toBe("skipped_comp_membership");
    const other = memoryStore({ ...member, features: { stripeSubscriptionId: "sub_other" } });
    expect(await sendCancellationScheduledEmail(input, { store: other.store, provider })).toBe("skipped_different_subscription");
    expect(sent).toHaveLength(1);
  });

  it("sends membership ended only when the membership was actually cancelled", async () => {
    const { provider, sent } = fakeProvider();
    const input = { uid: "member-1", subscriptionId: "sub_test_1", endedAtMs: REFUND_AT * 1000, planId: "virtual" };
    const active = memoryStore(member);
    expect(await sendMembershipEndedEmail(input, { store: active.store, provider })).toBe("skipped_not_cancelled");
    const comp = memoryStore({ ...member, membershipStatus: "cancelled", membershipSource: "comp" });
    expect(await sendMembershipEndedEmail(input, { store: comp.store, provider })).toBe("skipped_comp_membership");
    const ended = memoryStore({ ...member, membershipStatus: "cancelled", plan: null });
    expect(await sendMembershipEndedEmail(input, { store: ended.store, provider })).toBe("sent");
    expect(await sendMembershipEndedEmail(input, { store: ended.store, provider })).toBe("skipped_already_sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Your Hi Coworking membership has ended");
  });
});

describe("Stripe refund events", () => {
  const secret = "whsec_test_fixture_only";

  function signed(type: string, object: unknown) {
    const payload = JSON.stringify({
      id: `evt_${type.replace(/\W/g, "_")}`,
      object: "event",
      api_version: "2026-07-29.dahlia",
      type,
      created: REFUND_AT,
      data: { object },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return { body: Buffer.from(payload), headers: { "stripe-signature": header } };
  }

  function stubbed() {
    const provider = new StripeProvider("sk_test_fixture_only", secret);
    const stripe = (provider as unknown as { stripe: Record<string, Record<string, unknown>> }).stripe;
    stripe.charges.retrieve = vi.fn().mockResolvedValue(charge());
    stripe.refunds.list = vi.fn().mockResolvedValue({
      data: [{ id: "re_test_1", amount: 4900, status: "succeeded", created: REFUND_AT }],
    });
    stripe.paymentIntents.retrieve = vi.fn().mockResolvedValue({ id: "pi_test_1", metadata: {} });
    stripe.invoicePayments.list = vi.fn().mockResolvedValue({
      data: [{
        invoice: {
          id: "in_test_1",
          billing_reason: "subscription_create",
          parent: {
            type: "subscription_details",
            subscription_details: { metadata: { uid: "member-1", plan: "virtual" }, subscription: "sub_test_1" },
          },
          lines: { data: [] },
        },
      }],
    });
    return { provider, stripe };
  }

  for (const [type, object] of [
    ["charge.refunded", charge()],
    ["refund.updated", { id: "re_test_1", object: "refund", charge: "ch_test_1", status: "succeeded" }],
    ["refund.failed", { id: "re_test_1", object: "refund", charge: "ch_test_1", status: "failed" }],
  ] as const) {
    it(`maps ${type} to a refund with the charge's current state`, async () => {
      const { provider, stripe } = stubbed();
      const { body, headers } = signed(type, object);
      const result = await provider.handleWebhook(body, headers);
      expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_test_1");
      expect(result.action).toBe("refund");
      expect(result.refund).toMatchObject({
        chargeId: "ch_test_1",
        refundId: "re_test_1",
        subscriptionId: "sub_test_1",
        uid: "member-1",
        amountRefundedCents: 4900,
      });
    });
  }

  it("throws on a Stripe API error so the event is retried", async () => {
    const { provider, stripe } = stubbed();
    stripe.charges.retrieve = vi.fn().mockRejectedValue(new Error("stripe down"));
    const { body, headers } = signed("charge.refunded", charge());
    await expect(provider.handleWebhook(body, headers)).rejects.toThrow();
  });

  it("passes the end date and plan on customer.subscription.deleted", async () => {
    const provider = new StripeProvider("sk_test_fixture_only", secret);
    const { body, headers } = signed("customer.subscription.deleted", {
      id: "sub_test_1",
      object: "subscription",
      status: "canceled",
      ended_at: REFUND_AT + 2,
      metadata: { uid: "member-1", plan: "virtual" },
    });
    const result = await provider.handleWebhook(body, headers);
    expect(result.metadata).toMatchObject({
      reason: "subscription_cancelled",
      plan: "virtual",
      endedAtMs: String((REFUND_AT + 2) * 1000),
    });
  });
});

describe("stripe_webhook refund and cancellation wiring", () => {
  const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
  const handler = readFileSync("apps/functions/src/payments/stripeRefundHandler.ts", "utf8");

  it("routes refunds to the refund handler and sends the cancellation notices", () => {
    expect(webhook).toContain("await handleStripeRefund(result, resendApiKey)");
    expect(webhook).toContain("await sendCancellationScheduledEmail(");
    expect(webhook).toContain("await sendMembershipEndedEmail(");
    expect(webhook).toContain("handleSubscriptionUpdated(result, resendApiKey)");
  });

  it("never changes membership on a refund", () => {
    expect(handler).not.toMatch(/membershipStatus\s*:/);
    expect(handler).not.toContain("expiresAt");
  });
});
