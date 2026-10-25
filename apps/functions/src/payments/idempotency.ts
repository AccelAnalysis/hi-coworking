/**
 * Webhook Idempotency Helper (PR-09)
 *
 * Uses webhookEvents/{eventId} to de-duplicate incoming webhook events.
 * If an event has already been processed, returns false so the caller
 * can skip re-processing.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import type { WebhookEventDocData } from "./types";

function getDb() { return admin.firestore(); }

/**
 * Ensure a webhook event is processed at most once.
 *
 * @returns `true` if this is a new event and the caller should proceed.
 *          `false` if it was already processed (caller should skip).
 */
export async function ensureIdempotent(
  eventId: string,
  provider: string
): Promise<boolean> {
  const db = getDb();
  const ref = db.collection("webhookEvents").doc(eventId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        logger.info(`Webhook event ${eventId} already processed, skipping`, {
          provider,
          processedAt: snap.data()?.processedAt,
        });
        return false;
      }

      const doc: WebhookEventDocData = {
        eventId,
        provider,
        processedAt: Date.now(),
      };

      tx.set(ref, doc);
      return true;
    });

    return result;
  } catch (err) {
    logger.error("ensureIdempotent transaction failed", { eventId, provider, err });
    throw err;
  }
}

/**
 * Mark a previously-claimed webhook event with a result string.
 * Call this after processing completes (success or error).
 */
export async function markWebhookResult(
  eventId: string,
  result: string
): Promise<void> {
  await getDb().collection("webhookEvents").doc(eventId).update({ result });
}

// ---------------------------------------------------------------------------
// Lease-based processing (stripe_webhook)
//
// ensureIdempotent() above marks an event as handled *before* it is
// processed, so a failure part-way through is never retried: Stripe's retry
// sees the doc and is skipped. The functions below fix that:
//
//   new event        -> status "processing" with a short lease, then process
//   all side effects -> status "success" (only now is the event "done")
//   any error        -> status "failed"; the next delivery processes it again
//   still processing -> a concurrent delivery gets "in_progress" (non-2xx, so
//                       Stripe retries later); an expired lease is taken over
//
// Every side effect a retried event can repeat must itself be idempotent
// (deterministic doc IDs, create(), per-invoice/per-refund markers).
// ---------------------------------------------------------------------------

/** How long one attempt may hold an event. stripe_webhook times out at 60 s. */
export const WEBHOOK_LEASE_MS = 3 * 60 * 1000;

/** Longest error text stored on the webhookEvents doc. */
const MAX_ERROR_LENGTH = 500;

export type WebhookClaim =
  | { outcome: "claimed"; leaseToken: string; attempt: number }
  | { outcome: "duplicate" }
  | { outcome: "in_progress"; leaseExpiresAt: number };

export type WebhookClaimDecision =
  | { outcome: "claim"; attempt: number }
  | { outcome: "duplicate" }
  | { outcome: "in_progress"; leaseExpiresAt: number };

/**
 * Pure decision for a delivery of an event whose webhookEvents doc is
 * `existing` (undefined when there is none). Handles the older docs written
 * by ensureIdempotent(), which have no status: `result: "success"` is done,
 * `result: "error: ..."` is retryable, and no result means an attempt was in
 * flight (or crashed) at processedAt.
 */
export function decideWebhookClaim(
  existing: Partial<WebhookEventDocData> | undefined,
  now: number,
  leaseMs: number = WEBHOOK_LEASE_MS,
): WebhookClaimDecision {
  if (!existing) return { outcome: "claim", attempt: 1 };

  const attempts = Number(existing.attempts) || 1;
  const status = existing.status;

  if (status === "success") return { outcome: "duplicate" };
  if (status === "failed") return { outcome: "claim", attempt: attempts + 1 };
  if (status === "processing") {
    const leaseExpiresAt = Number(existing.leaseExpiresAt) || 0;
    if (leaseExpiresAt > now) return { outcome: "in_progress", leaseExpiresAt };
    return { outcome: "claim", attempt: attempts + 1 };
  }

  // Legacy doc (no status).
  const result = typeof existing.result === "string" ? existing.result : "";
  if (result === "success") return { outcome: "duplicate" };
  if (result.startsWith("error")) return { outcome: "claim", attempt: attempts + 1 };
  const legacyExpiry = (Number(existing.processedAt) || 0) + leaseMs;
  if (legacyExpiry > now) return { outcome: "in_progress", leaseExpiresAt: legacyExpiry };
  return { outcome: "claim", attempt: attempts + 1 };
}

/**
 * Storage for webhookEvents docs. `transact` reads the doc, lets `mutate`
 * decide, and merges the returned patch atomically (a Firestore transaction
 * in production, a Map in tests).
 */
export interface WebhookEventStore {
  transact<T>(
    eventId: string,
    mutate: (existing: WebhookEventDocData | undefined) => { patch?: Partial<WebhookEventDocData>; value: T },
  ): Promise<T>;
}

export function firestoreWebhookEventStore(): WebhookEventStore {
  return {
    async transact(eventId, mutate) {
      const db = getDb();
      const ref = db.collection("webhookEvents").doc(eventId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as WebhookEventDocData) : undefined;
        const { patch, value } = mutate(existing);
        if (patch) tx.set(ref, patch, { merge: true });
        return value;
      });
    },
  };
}

function newLeaseToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Claim an event for processing (see decideWebhookClaim). */
export function claimWebhookEvent(
  store: WebhookEventStore,
  input: { eventId: string; provider: string; now: number; leaseMs: number; leaseToken: string },
): Promise<WebhookClaim> {
  return store.transact<WebhookClaim>(input.eventId, (existing) => {
    const decision = decideWebhookClaim(existing, input.now, input.leaseMs);
    if (decision.outcome !== "claim") return { value: decision };
    return {
      patch: {
        eventId: input.eventId,
        provider: input.provider,
        processedAt: existing?.processedAt || input.now,
        status: "processing",
        attempts: decision.attempt,
        leaseExpiresAt: input.now + input.leaseMs,
        leaseToken: input.leaseToken,
        startedAt: input.now,
      },
      value: { outcome: "claimed", leaseToken: input.leaseToken, attempt: decision.attempt },
    };
  });
}

/**
 * Finish an attempt. Writes only while this attempt still holds the lease, so
 * a slow attempt whose lease was taken over cannot overwrite the newer result.
 */
export function finishWebhookEvent(
  store: WebhookEventStore,
  input: { eventId: string; leaseToken: string; now: number; error?: string },
): Promise<boolean> {
  return store.transact<boolean>(input.eventId, (existing) => {
    if (existing?.leaseToken && existing.leaseToken !== input.leaseToken) {
      logger.warn("Webhook lease was taken over; leaving the newer attempt's result", {
        eventId: input.eventId,
      });
      return { value: false };
    }
    if (existing?.status === "success") return { value: false };
    if (input.error === undefined) {
      return {
        patch: { status: "success", result: "success", completedAt: input.now, leaseExpiresAt: null, leaseToken: null },
        value: true,
      };
    }
    const message = input.error.slice(0, MAX_ERROR_LENGTH);
    return {
      patch: {
        status: "failed",
        result: `error: ${message}`,
        lastError: message,
        failedAt: input.now,
        leaseExpiresAt: null,
        leaseToken: null,
      },
      value: true,
    };
  });
}

export type IdempotentRunResult =
  | { outcome: "processed"; attempt: number }
  | { outcome: "duplicate" }
  | { outcome: "in_progress" }
  | { outcome: "failed"; attempt: number; error: unknown };

/**
 * Process a webhook event at most once *successfully*: claim a lease, run
 * `process`, and mark success only after it resolves. A thrown error marks the
 * event failed so the provider's next retry processes it again.
 */
export async function runIdempotentWebhook(
  eventId: string,
  provider: string,
  process: () => Promise<void>,
  options: { store?: WebhookEventStore; now?: () => number; leaseMs?: number } = {},
): Promise<IdempotentRunResult> {
  const store = options.store || firestoreWebhookEventStore();
  const now = options.now || Date.now;
  const leaseMs = options.leaseMs ?? WEBHOOK_LEASE_MS;

  const claim = await claimWebhookEvent(store, {
    eventId,
    provider,
    now: now(),
    leaseMs,
    leaseToken: newLeaseToken(),
  });
  if (claim.outcome === "duplicate") {
    logger.info("Webhook event already processed, skipping", { eventId, provider });
    return { outcome: "duplicate" };
  }
  if (claim.outcome === "in_progress") {
    logger.info("Webhook event is being processed by another delivery", {
      eventId,
      provider,
      leaseExpiresAt: claim.leaseExpiresAt,
    });
    return { outcome: "in_progress" };
  }

  try {
    await process();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await finishWebhookEvent(store, { eventId, leaseToken: claim.leaseToken, now: now(), error: message });
    } catch (markError) {
      // The lease simply expires and a later retry takes over.
      logger.error("Could not mark webhook event failed", { eventId, provider, markError });
    }
    return { outcome: "failed", attempt: claim.attempt, error };
  }

  // If this write fails, the lease expires and a retry re-runs the (idempotent)
  // side effects, which is safe. Surface it as a failure so the provider retries.
  try {
    await finishWebhookEvent(store, { eventId, leaseToken: claim.leaseToken, now: now() });
  } catch (error) {
    logger.error("Could not mark webhook event processed", { eventId, provider, error });
    return { outcome: "failed", attempt: claim.attempt, error };
  }
  return { outcome: "processed", attempt: claim.attempt };
}
