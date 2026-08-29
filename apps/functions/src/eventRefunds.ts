import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { getPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

function db() { return admin.firestore(); }

export async function queueEventRefund(input: {
  registrationId?: string;
  eventId: string;
  paymentId: string;
  amountCents: number;
  reason: string;
}) {
  const id = input.registrationId ? `event_${input.registrationId}` : `event_payment_${input.paymentId}`;
  await db().collection("eventRefundJobs").doc(id).set({
    id,
    ...input,
    amountCents: Math.max(0, Math.round(input.amountCents)),
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });
  return id;
}

export const events_processRefundJobs = onSchedule(
  {
    schedule: "*/10 * * * *",
    timeZone: "America/New_York",
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async () => {
    const snap = await db().collection("eventRefundJobs")
      .where("status", "==", "PENDING")
      .limit(50)
      .get();

    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    for (const doc of snap.docs) {
      const job = doc.data() as Record<string, any>;
      if (Number(job.nextAttemptAt || 0) > Date.now()) continue;
      try {
        const payment = await getPayment(String(job.paymentId));
        if (!payment) throw new Error("payment-not-found");
        const refund = await provider.refundCheckoutPayment({
          checkoutSessionId: payment.providerRefs?.stripeCheckoutSessionId,
          paymentIntentId: payment.providerRefs?.stripePaymentIntentId,
          ledgerPaymentId: payment.id,
          amountCents: Number(job.amountCents || payment.amount || 0),
          idempotencyKey: `event_refund_${doc.id}`,
          metadata: {
            eventId: String(job.eventId || ""),
            registrationId: String(job.registrationId || ""),
            reason: String(job.reason || "event_refund"),
          },
        });
        await updatePaymentStatus(payment.id, "refunded", {
          providerRefs: { ...payment.providerRefs, stripeRefundId: refund.refundId },
        });
        if (job.registrationId) {
          await db().collection("eventRegistrations").doc(String(job.registrationId)).set({
            status: "REFUNDED",
            refundedAt: Date.now(),
            stripeRefundId: refund.refundId,
            updatedAt: Date.now(),
          }, { merge: true });
        }
        await doc.ref.set({ status: "COMPLETED", completedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        const delayMinutes = Math.min(24 * 60, Math.pow(2, Math.min(attempts, 8)) * 5);
        logger.error("Event refund job failed", { jobId: doc.id, attempts, error });
        await doc.ref.set({
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: Date.now() + delayMinutes * 60 * 1000,
          updatedAt: Date.now(),
          ...(attempts >= 10 ? { status: "NEEDS_REVIEW" } : {}),
        }, { merge: true });
      }
    }
  }
);
