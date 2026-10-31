import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { buildFollowUp, FOLLOW_UPS_COLLECTION, type FollowUpType } from "./policy";

/**
 * Adds an item to Jessica's follow-up queue. Idempotent: the doc id is
 * derived from the type and the visit, booking or member id, and an existing
 * item (open or done) is left as it is. Never throws; a failed write is
 * logged with ids only so the calling task is not retried for it.
 */
export async function queueFollowUp(input: {
  type: FollowUpType;
  memberId: string;
  bookingId?: string | null;
  visitId?: string | null;
  billingCapAt?: number | null;
  now?: number;
}): Promise<"created" | "exists" | "failed"> {
  try {
    const doc = buildFollowUp({ ...input, now: input.now ?? Date.now() });
    await admin.firestore().collection(FOLLOW_UPS_COLLECTION).doc(doc.id).create(doc);
    return "created";
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 6 || code === "already-exists") return "exists";
    logger.error("staff follow-up write failed", {
      type: input.type,
      bookingId: input.bookingId ?? null,
      visitId: input.visitId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}
