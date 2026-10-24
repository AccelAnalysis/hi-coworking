import * as logger from "firebase-functions/logger";
import { normalizeUsMobile, twilioOptOutUpdate } from "./smsCompliance";

type UpdatableDb = {
  collection(path: string): { doc(id: string): { update(data: Record<string, unknown>): Promise<unknown> } };
};

/**
 * Twilio error 21610 means the number replied STOP. Mark every matching
 * recipient as opted out (users/{uid}.smsConsent.optIn = false) so later
 * jobs skip them. Returns the uids that were updated.
 */
export async function recordSmsOptOuts(
  db: UpdatableDb,
  recipients: Array<{ uid?: string; phone?: string }>,
  optedOutPhones: string[],
  now = Date.now(),
): Promise<string[]> {
  if (optedOutPhones.length === 0) return [];
  const key = (phone: string) => normalizeUsMobile(phone) || phone.trim();
  const optedOut = new Set(optedOutPhones.map(key));
  const updated: string[] = [];
  for (const recipient of recipients) {
    if (!recipient.uid || !recipient.phone || !optedOut.has(key(recipient.phone))) continue;
    try {
      await db.collection("users").doc(recipient.uid).update(twilioOptOutUpdate(now));
      updated.push(recipient.uid);
    } catch (error) {
      logger.error("Could not record SMS opt-out", {
        uid: recipient.uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (updated.length) logger.info("Recorded SMS opt-outs from Twilio 21610", { count: updated.length });
  return updated;
}
