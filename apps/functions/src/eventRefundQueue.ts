import * as admin from "firebase-admin";

function db() { return admin.firestore(); }

export async function queueEventRefundRecovery(input: {
  eventId: string;
  paymentId: string;
  registrationId?: string;
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
