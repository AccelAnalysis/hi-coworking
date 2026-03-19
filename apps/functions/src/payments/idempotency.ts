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
