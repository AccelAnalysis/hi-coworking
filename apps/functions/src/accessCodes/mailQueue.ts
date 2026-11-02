/**
 * Sends the `mail` queue (written by sendAccessReadyNotice in access.ts)
 * through Resend from hello@hi-coworking.com, Reply-To the monitored inbox.
 *
 * Firestore create triggers never replay, so only docs created after this
 * deploys are sent. Each doc is claimed in a transaction and sent with a
 * Resend idempotency key, so a doc goes out at most once. Logs carry only
 * the doc id and outcome, never the address.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { ResendEmailProvider } from "../providers/emailProvider";
import { resendApiKey } from "../providers/emailSecret";
import { claimDecision, processMailDoc, type MailDoc, type MailQueueStore } from "./accessReadyEmail";

export const MAIL_COLLECTION = "mail";

export function firestoreMailQueueStore(db: FirebaseFirestore.Firestore = admin.firestore()): MailQueueStore {
  const ref = (id: string) => db.collection(MAIL_COLLECTION).doc(id);
  return {
    async claim(id, now) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(id));
        if (!snap.exists) return null;
        const doc = (snap.data() || {}) as MailDoc;
        if (claimDecision(doc, now) !== "claim") return null;
        tx.set(ref(id), { status: "sending", claimedAt: now, attempts: Number(doc.attempts || 0) + 1 }, { merge: true });
        return { doc };
      });
    },
    async resolveEmail(uid) {
      const user = await db.collection("users").doc(uid).get();
      const email = user.exists ? user.data()?.email : undefined;
      if (typeof email === "string" && email.trim()) return email.trim();
      try {
        return (await admin.auth().getUser(uid)).email || null;
      } catch {
        return null;
      }
    },
    async finish(id, update) {
      await ref(id).set({ ...update, updatedAt: Date.now() }, { merge: true });
    },
  };
}

export const mail_sendQueued = onDocumentCreated(
  { document: `${MAIL_COLLECTION}/{mailId}`, secrets: [resendApiKey], retry: false },
  async (event) => {
    const id = event.params.mailId;
    const apiKey = resendApiKey.value();
    if (!apiKey) {
      logger.error("Queued mail not sent: HI_COWORKING_RESEND_API_KEY is unavailable", { mailId: id });
      return;
    }
    const outcome = await processMailDoc(id, firestoreMailQueueStore(), new ResendEmailProvider(apiKey));
    (outcome === "failed" ? logger.error : logger.info)("Queued mail processed", { mailId: id, outcome });
  },
);
