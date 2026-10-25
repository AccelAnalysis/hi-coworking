/**
 * QuickBooks Payments webhook (qb_paymentsWebhook), retry-safe.
 *
 * - Every request must carry a valid `intuit-signature` (HMAC-SHA256 of the
 *   raw body with the Intuit webhook verifier token, base64). Without a
 *   configured verifier token the endpoint refuses all events (fail closed):
 *   an unsigned request could otherwise mark a payment paid or refunded.
 * - Each Payment/Charge entity in the notification is its own event, run
 *   through the same lease as stripe_webhook (runIdempotentWebhook): "success"
 *   only after the ledger update, a failure is retryable, and a non-2xx tells
 *   Intuit to deliver again.
 * - The payment is found by its QuickBooks charge id directly (not by
 *   scanning the 10 newest QuickBooks payments), and a late "paid" event
 *   never overwrites a refund.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { runIdempotentWebhook, type IdempotentRunResult } from "./idempotency";
import { updatePaymentStatus } from "./ledger";
import type { PaymentStatus } from "./types";

export interface QbPaymentEvent {
  eventId: string;
  entityName: string;
  entityId: string;
  realmId: string;
  operation: string;
  status: PaymentStatus;
}

/** Constant-time check of Intuit's base64 HMAC-SHA256 signature. */
export function verifyIntuitSignature(rawBody: Buffer, signature: string | undefined, verifierToken: string): boolean {
  if (!verifierToken || !signature) return false;
  const expected = createHmac("sha256", verifierToken).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Every Payment/Charge change in an Intuit notification, one event each. */
export function parseIntuitPaymentEvents(payload: unknown): QbPaymentEvent[] {
  const notifications = (payload as { eventNotifications?: unknown })?.eventNotifications;
  if (!Array.isArray(notifications)) return [];
  const events: QbPaymentEvent[] = [];
  for (const notification of notifications) {
    const realmId = String(notification?.realmId || "");
    const entities = notification?.dataChangeEvent?.entities;
    if (!Array.isArray(entities)) continue;
    for (const entity of entities) {
      const entityName = String(entity?.name || "");
      const entityId = String(entity?.id || "");
      const operation = String(entity?.operation || "");
      if ((entityName !== "Payment" && entityName !== "Charge") || !entityId) continue;
      let status: PaymentStatus;
      if (operation === "Create" || operation === "Update") status = "paid";
      else if (operation === "Void" || operation === "Delete") status = "refunded";
      else continue;
      events.push({
        eventId: `qbp_${entityName}_${entityId}_${String(entity?.lastUpdated || "")}`,
        entityName,
        entityId,
        realmId,
        operation,
        status,
      });
    }
  }
  return events;
}

/** The status to write, or null to leave the payment as it is. */
export function nextQbPaymentStatus(current: PaymentStatus | undefined, incoming: PaymentStatus): PaymentStatus | null {
  if (current === incoming) return null;
  // Events can arrive out of order: a refund is final.
  if (current === "refunded") return null;
  return incoming;
}

export interface QbWebhookDeps {
  findPayment(chargeId: string): Promise<{ id: string; status?: PaymentStatus } | null>;
  setStatus(paymentId: string, status: PaymentStatus): Promise<void>;
  run(eventId: string, process: () => Promise<void>): Promise<IdempotentRunResult>;
}

function firestoreDeps(): QbWebhookDeps {
  return {
    async findPayment(chargeId) {
      const snap = await admin.firestore().collection("payments")
        .where("provider", "==", "quickbooks_payments")
        .where("providerRefs.qbChargeId", "==", chargeId)
        .limit(1)
        .get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, status: doc.data().status as PaymentStatus | undefined };
    },
    setStatus: (paymentId, status) => updatePaymentStatus(paymentId, status),
    run: (eventId, process) => runIdempotentWebhook(eventId, "quickbooks_payments", process),
  };
}

export async function handleQuickBooksPaymentsWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  verifierToken: string,
  deps: QbWebhookDeps = firestoreDeps(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!verifierToken) {
    logger.error("QB Payments webhook refused: no Intuit webhook verifier token is configured");
    return { status: 503, body: { error: "Webhook not configured" } };
  }
  const signatureHeader = headers["intuit-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!verifyIntuitSignature(rawBody, signature, verifierToken)) {
    logger.warn("QB Payments webhook rejected: bad or missing signature");
    return { status: 401, body: { error: "Invalid signature" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Invalid webhook" } };
  }

  const events = parseIntuitPaymentEvents(payload);
  if (events.length === 0) return { status: 200, body: { received: true, skipped: true } };

  let failed = 0;
  let inProgress = 0;
  for (const event of events) {
    const run = await deps.run(event.eventId, async () => {
      const payment = await deps.findPayment(event.entityId);
      if (!payment) {
        logger.info("QB webhook: no ledger payment for this charge", { eventId: event.eventId });
        return;
      }
      const next = nextQbPaymentStatus(payment.status, event.status);
      if (!next) return;
      await deps.setStatus(payment.id, next);
      logger.info("QB webhook updated payment", { paymentId: payment.id, newStatus: next });
    });
    if (run.outcome === "failed") {
      failed += 1;
      logger.error("QB webhook processing error", { eventId: event.eventId, err: run.error });
    } else if (run.outcome === "in_progress") {
      inProgress += 1;
    }
  }

  // Non-2xx makes Intuit deliver the notification again; events that already
  // succeeded are skipped as duplicates on that retry.
  if (failed > 0) return { status: 500, body: { error: "Processing failed" } };
  if (inProgress > 0) return { status: 409, body: { error: "Event is already being processed" } };
  return { status: 200, body: { received: true } };
}
