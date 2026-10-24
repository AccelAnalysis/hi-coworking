import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: [] as unknown[][], error: [] as unknown[][], warn: [] as unknown[][] }));
vi.mock("firebase-functions/logger", () => ({
  info: (...args: unknown[]) => { logs.info.push(args); },
  warn: (...args: unknown[]) => { logs.warn.push(args); },
  error: (...args: unknown[]) => { logs.error.push(args); },
}));

import {
  CONTACT_EMAIL,
  SPACE_ADDRESS,
  STALE_CLAIM_MS,
  planHighlights,
  renderMembershipWelcomeEmail,
  sendMembershipWelcomeEmail,
  type WelcomeEmailStore,
} from "../../apps/functions/src/payments/membershipWelcomeEmail";
import { EmailSendError, ResendEmailProvider, type EmailMessage, type EmailProvider } from "../../apps/functions/src/providers/emailProvider";
import { MEMBERSHIP_TIERS, getTierById } from "../../apps/functions/src/payments/stripeConfig";
import type { WebhookResult } from "../../apps/functions/src/payments/types";

const ORIGIN = "https://hi-coworking.com";

function checkoutResult(overrides: Record<string, string> = {}): WebhookResult {
  return {
    eventId: "evt_1",
    action: "payment_succeeded",
    paymentId: "pay_1",
    status: "paid",
    metadata: {
      uid: "member-1",
      plan: "virtual",
      purpose: "membership",
      purposeRefId: "virtual",
      email: "member@example.com",
      checkoutSessionId: "cs_test_1",
      subscriptionId: "sub_1",
      ...overrides,
    },
  };
}

/** In-memory twin of firestoreWelcomeEmailStore, with the same claim rules. */
function memoryStore(user: { email?: string; displayName?: string } | null = { displayName: "Jordan Smith" }) {
  const docs = new Map<string, Record<string, unknown>>();
  const store: WelcomeEmailStore = {
    async claim(sessionId, data, now) {
      const existing = docs.get(sessionId);
      if (existing?.status === "sent") return false;
      if (existing?.status === "sending" && now - Number(existing.claimedAt) < STALE_CLAIM_MS) return false;
      docs.set(sessionId, { ...existing, ...data, status: "sending", claimedAt: now });
      return true;
    },
    async markSent(sessionId, messageId, now) {
      docs.set(sessionId, { ...docs.get(sessionId), status: "sent", messageId, sentAt: now });
    },
    async markFailed(sessionId, code, now) {
      docs.set(sessionId, { ...docs.get(sessionId), status: "failed", errorCode: code, failedAt: now });
    },
    async loadUser() {
      return user;
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

beforeEach(() => {
  logs.info.length = 0;
  logs.warn.length = 0;
  logs.error.length = 0;
});

describe("membership welcome email copy", () => {
  it("renders every plan from the plan definitions, with HTML and plain text", () => {
    for (const tier of MEMBERSHIP_TIERS) {
      const copy = renderMembershipWelcomeEmail({ planId: tier.id, firstName: "Jordan", origin: ORIGIN })!;
      expect(copy.subject).toBe(`Welcome to Hi Coworking. Your ${tier.name} plan is active`);
      for (const body of [copy.html, copy.text]) {
        expect(body).toContain(tier.name);
        expect(body).toContain(`$${tier.amountCents / 100}/month`);
        expect(body).toContain(`${ORIGIN}/book`);
        expect(body).toContain(`${ORIGIN}/my-hi`);
        expect(body).not.toContain("/account/bookings");
        expect(body).not.toContain("billing.stripe.com");
        expect(body).toContain(CONTACT_EMAIL);
        expect(body).not.toContain("hello@hi-coworking.com");
        expect(body).toContain(SPACE_ADDRESS);
        expect(body).toContain("Monday to Friday, 8 AM to 5 PM");
        expect(body).toContain("update your payment method, view invoices, change your plan, or cancel");
        expect(body).toContain("Manage membership &");
        expect(body).toContain("Hi Jordan,");
        expect(body).toContain(`Book up to ${tier.bookingWindowDays} days ahead`);
      }
      expect(copy.html).toContain('<html lang="en">');
      expect(copy.html).toContain(`href="mailto:${CONTACT_EMAIL}"`);
      expect(copy.text).not.toMatch(/<[a-z]/i);
    }
  });

  it("states Virtual Office pricing exactly and never claims included desk hours", () => {
    const tier = getTierById("virtual")!;
    const copy = renderMembershipWelcomeEmail({ planId: "virtual", origin: ORIGIN })!;
    expect(copy.text).toContain("A coworking desk whenever you need one, at $17.50/hr");
    expect(copy.text).not.toMatch(/hours included/i);
    expect(copy.text).not.toMatch(/included hours/i);
    expect(copy.text).toContain("Hi there,");
    expect(planHighlights(tier)).toHaveLength(3);
  });

  it("states included hours and the member rate for coworking plans", () => {
    expect(renderMembershipWelcomeEmail({ planId: "coworking", origin: ORIGIN })!.text)
      .toContain("10 coworking desk hours included every month");
    expect(renderMembershipWelcomeEmail({ planId: "coworking", origin: ORIGIN })!.text)
      .toContain("member rate of $14/hr");
    expect(renderMembershipWelcomeEmail({ planId: "coworking_plus", origin: ORIGIN })!.text)
      .toContain("member rate of $12.25/hr");
  });

  it("has no unsubscribe link or marketing footer, because it is transactional", () => {
    const copy = renderMembershipWelcomeEmail({ planId: "coworking", origin: ORIGIN })!;
    expect(copy.html).not.toMatch(/unsubscribe|preferences\?token/i);
    expect(copy.text).not.toMatch(/unsubscribe/i);
  });

  it("escapes the member's name in HTML", () => {
    const copy = renderMembershipWelcomeEmail({ planId: "virtual", firstName: "<b>x</b>", origin: ORIGIN })!;
    expect(copy.html).not.toContain("<b>x</b>");
    expect(copy.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("returns null for an unknown plan", () => {
    expect(renderMembershipWelcomeEmail({ planId: "gold", origin: ORIGIN })).toBeNull();
  });
});

describe("sendMembershipWelcomeEmail", () => {
  it("sends once per Checkout session through Resend with a stable idempotency key", async () => {
    const { store, docs } = memoryStore();
    const { provider, sent } = fakeProvider();
    const result = checkoutResult();

    expect(await sendMembershipWelcomeEmail(result, { provider, store, origin: ORIGIN })).toBe("sent");
    expect(await sendMembershipWelcomeEmail(result, { provider, store, origin: ORIGIN })).toBe("skipped_already_sent");
    // A different Stripe event for the same session (redelivery under a new id) is still one email.
    expect(await sendMembershipWelcomeEmail({ ...result, eventId: "evt_2" }, { provider, store, origin: ORIGIN })).toBe("skipped_already_sent");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "member@example.com",
      subject: "Welcome to Hi Coworking. Your Virtual Office plan is active",
      idempotencyKey: "membership-welcome/cs_test_1",
      categories: ["membership_welcome", "transactional"],
    });
    expect(sent[0].text).toContain("Hi Jordan,");
    expect(docs.get("cs_test_1")).toMatchObject({
      status: "sent",
      messageId: "msg_1",
      type: "membership_welcome",
      uid: "member-1",
      plan: "virtual",
      paymentId: "pay_1",
    });
  });

  it("ignores non-membership checkouts", async () => {
    const { store } = memoryStore();
    const { provider, sent } = fakeProvider();
    for (const purpose of ["booking", "event", "referral", ""]) {
      expect(await sendMembershipWelcomeEmail(checkoutResult({ purpose }), { provider, store })).toBe("skipped_not_membership");
    }
    expect(sent).toHaveLength(0);
  });

  it("falls back to the users doc email and skips when there is no valid recipient", async () => {
    const fromUser = memoryStore({ email: "doc@example.com" });
    const first = fakeProvider();
    expect(await sendMembershipWelcomeEmail(checkoutResult({ email: "" }), { provider: first.provider, store: fromUser.store })).toBe("sent");
    expect(first.sent[0].to).toBe("doc@example.com");

    const none = memoryStore({});
    const second = fakeProvider();
    expect(await sendMembershipWelcomeEmail(checkoutResult({ email: "not-an-email" }), { provider: second.provider, store: none.store })).toBe("skipped_no_recipient");
    expect(second.sent).toHaveLength(0);
    expect(none.docs.size).toBe(0);
  });

  it("skips when the session, uid, plan, or API key is missing, or the plan is unknown", async () => {
    const { store } = memoryStore();
    const { provider } = fakeProvider();
    expect(await sendMembershipWelcomeEmail(checkoutResult({ checkoutSessionId: "" }), { provider, store })).toBe("skipped_missing_data");
    expect(await sendMembershipWelcomeEmail(checkoutResult({ uid: "" }), { provider, store })).toBe("skipped_missing_data");
    expect(await sendMembershipWelcomeEmail(checkoutResult({ plan: "gold" }), { provider, store })).toBe("skipped_unknown_plan");
    expect(await sendMembershipWelcomeEmail(checkoutResult(), { store })).toBe("skipped_no_api_key");
  });

  it("never throws on a provider failure, records it, and lets a later redelivery retry", async () => {
    const { store, docs } = memoryStore();
    const failing = fakeProvider(new EmailSendError(503, "internal_server_error"));
    await expect(sendMembershipWelcomeEmail(checkoutResult(), { provider: failing.provider, store })).resolves.toBe("failed");
    expect(docs.get("cs_test_1")).toMatchObject({ status: "failed", errorCode: "503_internal_server_error" });
    expect(logs.error.length).toBeGreaterThan(0);

    const working = fakeProvider();
    expect(await sendMembershipWelcomeEmail(checkoutResult(), { provider: working.provider, store })).toBe("sent");
    expect(working.sent).toHaveLength(1);
  });

  it("never throws when the store itself fails", async () => {
    const { provider, sent } = fakeProvider();
    const broken: WelcomeEmailStore = {
      claim: async () => { throw new Error("firestore unavailable"); },
      markSent: async () => undefined,
      markFailed: async () => undefined,
      loadUser: async () => { throw new Error("firestore unavailable"); },
    };
    await expect(sendMembershipWelcomeEmail(checkoutResult(), { provider, store: broken })).resolves.toBe("failed");
    expect(sent).toHaveLength(0);
  });

  it("does not resend while another delivery holds a fresh claim, but recovers a stale one", async () => {
    const { store } = memoryStore();
    const { provider, sent } = fakeProvider();
    let clock = 1_000_000;
    await store.claim("cs_test_1", {}, clock);
    expect(await sendMembershipWelcomeEmail(checkoutResult(), { provider, store, now: () => clock })).toBe("skipped_already_sent");
    clock += STALE_CLAIM_MS + 1;
    expect(await sendMembershipWelcomeEmail(checkoutResult(), { provider, store, now: () => clock })).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("sends from hello@hi-coworking.com with Reply-To hicoworking@accelanalysis.com via the Resend REST API, without logging the recipient", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    const provider = new ResendEmailProvider("test-key", { fetchImpl, env: {} });
    const { store } = memoryStore();
    expect(await sendMembershipWelcomeEmail(checkoutResult(), { provider, store, origin: ORIGIN })).toBe("sent");
    const payload = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(payload.from).toBe("Hi Coworking <hello@hi-coworking.com>");
    expect(payload.reply_to).toBe("hicoworking@accelanalysis.com");
    expect(payload.to).toEqual(["member@example.com"]);
    expect(payload.html).toContain("Welcome to Hi Coworking");
    expect(payload.text).toContain("Virtual Office");
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^membership-welcome\/cs_test_1/);
    expect(JSON.stringify([...logs.info, ...logs.warn, ...logs.error])).not.toContain("member@example.com");
  });
});

describe("stripe_webhook wiring", () => {
  const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
  const index = readFileSync("apps/functions/src/index.ts", "utf8");

  it("sends after provisioning a membership, only for purpose=membership", () => {
    const provision = webhook.indexOf("await provisionMembership(uid, plan, subscriptionId);");
    const send = webhook.indexOf("await sendMembershipWelcomeEmail(result, { apiKey: resendApiKey });");
    expect(provision).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(provision);
    expect(webhook.slice(provision, send)).toContain('result.metadata?.purpose === "membership"');
  });

  it("passes the bound Resend key from the stripe_webhook function", () => {
    expect(index).toMatch(/intuitClientSecret\.value\(\),\s*resendApiKey\.value\(\)\s*\);/);
  });

  it("does not bind the Resend secret in the payments module graph", () => {
    expect(webhook).not.toContain("providers/emailSecret");
    expect(readFileSync("apps/functions/src/payments/membershipWelcomeEmail.ts", "utf8")).not.toContain("providers/emailSecret");
  });
});
