import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({ info: () => {}, warn: () => {}, error: () => {} }));
vi.mock("firebase-admin", () => ({ firestore: () => { throw new Error("no firestore in tests"); } }));

import { runIdempotentWebhook, type WebhookEventStore } from "../../apps/functions/src/payments/idempotency";
import {
  handleQuickBooksPaymentsWebhook,
  nextQbPaymentStatus,
  parseIntuitPaymentEvents,
  verifyIntuitSignature,
  type QbWebhookDeps,
} from "../../apps/functions/src/payments/quickbooksWebhook";
import type { PaymentStatus, WebhookEventDocData } from "../../apps/functions/src/payments/types";

const TOKEN = "test-verifier-token";

function memoryStore() {
  const docs = new Map<string, WebhookEventDocData>();
  const store: WebhookEventStore = {
    async transact(eventId, mutate) {
      const existing = docs.get(eventId);
      const { patch, value } = mutate(existing ? { ...existing } : undefined);
      if (patch) docs.set(eventId, { ...(existing || {}), ...patch } as WebhookEventDocData);
      return value;
    },
  };
  return { docs, store };
}

function sign(body: Buffer, token = TOKEN) {
  return createHmac("sha256", token).update(body).digest("base64");
}

function notification(entities: Array<Record<string, string>>) {
  return Buffer.from(JSON.stringify({
    eventNotifications: [{ realmId: "realm-1", dataChangeEvent: { entities } }],
  }));
}

function harness(payments: Record<string, { id: string; status?: PaymentStatus }>, failOnce = new Set<string>()) {
  const { docs, store } = memoryStore();
  const writes: Array<[string, PaymentStatus]> = [];
  const deps: QbWebhookDeps = {
    async findPayment(chargeId) {
      return payments[chargeId] ? { ...payments[chargeId] } : null;
    },
    async setStatus(paymentId, status) {
      if (failOnce.has(paymentId)) {
        failOnce.delete(paymentId);
        throw new Error("ledger write failed");
      }
      writes.push([paymentId, status]);
      for (const p of Object.values(payments)) if (p.id === paymentId) p.status = status;
    },
    run: (eventId, process) => runIdempotentWebhook(eventId, "quickbooks_payments", process, { store }),
  };
  return { deps, docs, writes };
}

describe("QuickBooks webhook signature", () => {
  it("accepts only Intuit's HMAC of the exact body", () => {
    const body = Buffer.from('{"a":1}');
    expect(verifyIntuitSignature(body, sign(body), TOKEN)).toBe(true);
    expect(verifyIntuitSignature(Buffer.from('{"a":2}'), sign(body), TOKEN)).toBe(false);
    expect(verifyIntuitSignature(body, sign(body, "other"), TOKEN)).toBe(false);
    expect(verifyIntuitSignature(body, undefined, TOKEN)).toBe(false);
    expect(verifyIntuitSignature(body, sign(body), "")).toBe(false);
  });

  it("fails closed without a verifier token and rejects unsigned requests", async () => {
    const body = notification([{ name: "Payment", id: "ch1", operation: "Create", lastUpdated: "t1" }]);
    const { deps, writes } = harness({ ch1: { id: "pay1", status: "pending" } });
    expect((await handleQuickBooksPaymentsWebhook(body, { "intuit-signature": sign(body) }, "", deps)).status).toBe(503);
    expect((await handleQuickBooksPaymentsWebhook(body, {}, TOKEN, deps)).status).toBe(401);
    expect((await handleQuickBooksPaymentsWebhook(body, { "intuit-signature": sign(body, "forged") }, TOKEN, deps)).status).toBe(401);
    expect(writes).toEqual([]);
  });
});

describe("QuickBooks webhook processing", () => {
  it("parses every Payment/Charge entity, not just the first", () => {
    const events = parseIntuitPaymentEvents(JSON.parse(notification([
      { name: "Customer", id: "c1", operation: "Update" },
      { name: "Payment", id: "ch1", operation: "Create", lastUpdated: "t1" },
      { name: "Charge", id: "ch2", operation: "Void", lastUpdated: "t2" },
      { name: "Payment", id: "ch3", operation: "Merge" },
    ]).toString()));
    expect(events.map((e) => [e.entityId, e.status])).toEqual([["ch1", "paid"], ["ch2", "refunded"]]);
    expect(events[0].eventId).toBe("qbp_Payment_ch1_t1");
  });

  it("never turns a refund back into paid", () => {
    expect(nextQbPaymentStatus("refunded", "paid")).toBeNull();
    expect(nextQbPaymentStatus("paid", "paid")).toBeNull();
    expect(nextQbPaymentStatus("pending", "paid")).toBe("paid");
    expect(nextQbPaymentStatus("paid", "refunded")).toBe("refunded");
  });

  it("updates each payment once, and a redelivery is a no-op", async () => {
    const body = notification([
      { name: "Payment", id: "ch1", operation: "Create", lastUpdated: "t1" },
      { name: "Payment", id: "ch2", operation: "Create", lastUpdated: "t1" },
    ]);
    const { deps, writes } = harness({ ch1: { id: "pay1", status: "pending" }, ch2: { id: "pay2", status: "pending" } });
    const headers = { "intuit-signature": sign(body) };
    expect((await handleQuickBooksPaymentsWebhook(body, headers, TOKEN, deps)).status).toBe(200);
    expect((await handleQuickBooksPaymentsWebhook(body, headers, TOKEN, deps)).status).toBe(200);
    expect(writes).toEqual([["pay1", "paid"], ["pay2", "paid"]]);
  });

  it("returns 500 on a failed write so Intuit retries, then finishes only the failed entity", async () => {
    const body = notification([
      { name: "Payment", id: "ch1", operation: "Create", lastUpdated: "t1" },
      { name: "Payment", id: "ch2", operation: "Create", lastUpdated: "t1" },
    ]);
    const { deps, docs, writes } = harness(
      { ch1: { id: "pay1", status: "pending" }, ch2: { id: "pay2", status: "pending" } },
      new Set(["pay2"]),
    );
    const headers = { "intuit-signature": sign(body) };
    expect((await handleQuickBooksPaymentsWebhook(body, headers, TOKEN, deps)).status).toBe(500);
    expect(docs.get("qbp_Payment_ch2_t1")?.status).toBe("failed");
    expect((await handleQuickBooksPaymentsWebhook(body, headers, TOKEN, deps)).status).toBe(200);
    expect(writes).toEqual([["pay1", "paid"], ["pay2", "paid"]]);
  });

  it("acknowledges events for charges that are not in the ledger", async () => {
    const body = notification([{ name: "Payment", id: "unknown", operation: "Create", lastUpdated: "t1" }]);
    const { deps, writes } = harness({});
    expect((await handleQuickBooksPaymentsWebhook(body, { "intuit-signature": sign(body) }, TOKEN, deps)).status).toBe(200);
    expect(writes).toEqual([]);
  });
});

describe("Intuit OAuth source guards", () => {
  const source = readFileSync("apps/functions/src/index.ts", "utf8");
  const callback = source.slice(source.indexOf("export const intuit_oauthCallback"), source.indexOf("export const intuit_checkConnection"));
  const check = source.slice(source.indexOf("export const intuit_checkConnection"), source.indexOf("export const intuit_checkConnection") + 600);

  it("does not echo the OAuth error into HTML and checks the stored state", () => {
    expect(callback).not.toMatch(/\$\{error\}/);
    expect(callback).toContain("consumeIntuitOAuthState(state)");
    expect(source).toMatch(/collection\("intuitOAuthStates"\)\.doc\(state\)\.set/);
  });

  it("limits the connection check to admins", () => {
    expect(check).toMatch(/callerRole !== "admin" && callerRole !== "master"/);
  });

  it("routes qb_paymentsWebhook through the signed, idempotent handler", () => {
    const hook = source.slice(source.indexOf("export const qb_paymentsWebhook"), source.indexOf("// --- QBO Accounting Sync"));
    expect(hook).toContain("handleQuickBooksPaymentsWebhook(");
    expect(hook).not.toContain("ensureIdempotent");
  });
});
