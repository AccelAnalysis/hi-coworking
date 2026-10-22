import { randomUUID } from "node:crypto";
/**
 * Webhook Idempotency Helper (PR-09)
 *
 * Uses webhookEvents/{eventId} to de-duplicate incoming webhook events.
 * Completed work is skipped; failed or expired claims can be retried.
 * Handlers must keep side effects idempotent because delivery is at least once.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import type { WebhookEventDocData } from "./types";

function getDb() { return admin.firestore(); }

/**
 * Claim a webhook attempt with a bounded lease and fenced completion.
 *
 * @returns a fencing token if this event was claimed and the caller should proceed.
 *          `false` if it was already processed (caller should skip).
 */
export async function ensureIdempotent(
  eventId: string,
  provider: string
): Promise<string | false> {
  const db = getDb();
  const ref = db.collection("webhookEvents").doc(eventId);

  const attemptToken = randomUUID();
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const previous = snap.data()!;
        if (previous.result === "success") return false;
        // A concurrent delivery must be retried, not acknowledged as complete.
        if (previous.result === "processing" && previous.leaseExpiresAt > Date.now()) {
          throw new Error(`Webhook ${eventId} is still processing`);
        }
      }

      const doc: WebhookEventDocData = {
        eventId,
        provider,
        processedAt: Date.now(),
      };

      tx.set(ref, { ...doc, result: "processing", attemptToken, leaseExpiresAt: Date.now() + 5 * 60_000 });
      return attemptToken;
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
  result: string,
  attemptToken: string
): Promise<void> {
  const ref = getDb().collection("webhookEvents").doc(eventId);
  await getDb().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current?.attemptToken !== attemptToken) throw new Error(`Webhook claim lost: ${eventId}`);
    tx.update(ref, { result, leaseExpiresAt: 0, completedAt: Date.now() });
  });
}
