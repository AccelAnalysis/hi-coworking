import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { getPayment, updatePaymentStatus } from "../payments/ledger";
import { StripeProvider } from "../payments/stripeProvider";
import {
  asMoney,
  cancellationDecision,
  confirmedQuantity,
  db,
  hashSecret,
  publicEvent,
  unsellTicketInventory,
} from "./core";
import { enqueueNotification } from "./notifications";
import { promoteWaitlist } from "./registration";
import {
  type EventDocV2,
  type RegistrationDocV2,
  type RegistrationStatusV2,
} from "./types";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

async function authorizeRegistration(
  request: { auth?: { uid: string } | null },
  registrationId: string,
  manageToken?: string,
) {
  const ref = db().collection("eventRegistrations").doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration not found.");
  const registration = snap.data() as RegistrationDocV2;
  const authOwns = Boolean(request.auth?.uid && registration.uid === request.auth.uid);
  const tokenMatches = Boolean(manageToken && hashSecret(manageToken) === registration.manageSecretHash);
  if (!authOwns && !tokenMatches) {
    throw new HttpsError("permission-denied", "This registration does not belong to you.");
  }
  return { ref, registration };
}

export const events_v2GetRegistration = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const { registration } = await authorizeRegistration(request, registrationId, manageToken);
  const eventSnap = await db().collection("events").doc(registration.eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  return {
    registration,
    event: {
      ...publicEvent(event),
      ...(registration.status === "CONFIRMED" && event.virtualUrl ? { virtualUrl: event.virtualUrl } : {}),
    },
    cancellation: cancellationDecision(registration, event),
  };
});

export const events_v2GetCancellationQuote = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const { registration } = await authorizeRegistration(request, registrationId, manageToken);
  const eventSnap = await db().collection("events").doc(registration.eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  return cancellationDecision(registration, eventSnap.data() as EventDocV2);
});

export const events_v2CancelRegistration = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const authorized = await authorizeRegistration(request, registrationId, manageToken);
  const eventRef = db().collection("events").doc(authorized.registration.eventId);

  const result = await db().runTransaction(async (tx): Promise<{ refundCents: number; registration: RegistrationDocV2 }> => {
    const [registrationSnap, eventSnap] = await Promise.all([tx.get(authorized.ref), tx.get(eventRef)]);
    if (!registrationSnap.exists || !eventSnap.exists) {
      throw new HttpsError("not-found", "Registration or event not found.");
    }
    const registration = registrationSnap.data() as RegistrationDocV2;
    const event = eventSnap.data() as EventDocV2;
    const decision = cancellationDecision(registration, event);
    if (!decision.canCancel) {
      throw new HttpsError("failed-precondition", "This registration can no longer be cancelled.");
    }
    const nextConfirmed = Math.max(0, confirmedQuantity(event) - registration.quantity);
    const nextStatus: RegistrationStatusV2 = decision.refundCents > 0 ? "REFUND_PENDING" : "CANCELLED";
    const updatedRegistration: RegistrationDocV2 = {
      ...registration,
      status: nextStatus,
      cancelledAt: Date.now(),
    };
    tx.set(authorized.ref, updatedRegistration, { merge: true });
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: unsellTicketInventory(event, registration.ticketTypeId, registration.quantity),
      updatedAt: Date.now(),
    });
    if (decision.refundCents > 0 && registration.paymentId) {
      const refundRef = db().collection("eventRefundJobs").doc(`cancel_${registration.id}`);
      tx.set(refundRef, {
        id: refundRef.id,
        eventId: event.id,
        registrationId: registration.id,
        paymentId: registration.paymentId,
        amountCents: decision.refundCents,
        reason: "customer_cancellation",
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      }, { merge: true });
    }
    return { refundCents: decision.refundCents, registration: updatedRegistration };
  });

  await enqueueNotification({
    id: `event_cancel_${registrationId}`,
    type: "REGISTRATION_CANCELLED",
    eventId: result.registration.eventId,
    registrationId,
    email: result.registration.email,
    displayName: result.registration.displayName,
    manageToken,
  });
  await promoteWaitlist(result.registration.eventId);
  return { success: true, refundCents: result.refundCents, refundPending: result.refundCents > 0 };
});

export const events_v2ProcessRefundJobs = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async () => {
    const snap = await db().collection("eventRefundJobs")
      .where("status", "==", "pending")
      .limit(25)
      .get();
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    for (const doc of snap.docs) {
      const job = doc.data() as Record<string, unknown>;
      if (Number(job.nextAttemptAt || 0) > Date.now()) continue;
      const paymentId = String(job.paymentId || "");
      if (!paymentId) {
        await doc.ref.set({ status: "failed", error: "payment-missing", updatedAt: Date.now() }, { merge: true });
        continue;
      }
      try {
        const payment = await getPayment(paymentId);
        if (!payment) throw new Error("Payment ledger record not found");
        const refund = await provider.refundCheckoutPayment({
          checkoutSessionId: payment.providerRefs?.stripeCheckoutSessionId,
          ledgerPaymentId: paymentId,
          holdId: String(job.holdId || payment.providerRefs?.holdId || ""),
          amountCents: asMoney(job.amountCents),
          idempotencyKey: `event_refund_${doc.id}`,
          metadata: {
            eventId: String(job.eventId || ""),
            registrationId: String(job.registrationId || ""),
            reason: String(job.reason || "event_refund"),
          },
        });
        await updatePaymentStatus(paymentId, "refunded", {
          providerRefs: {
            stripeRefundId: refund.refundId,
            stripePaymentIntentId: refund.paymentIntentId,
          },
        });
        const registrationId = String(job.registrationId || "");
        if (registrationId) {
          const regRef = db().collection("eventRegistrations").doc(registrationId);
          const regSnap = await regRef.get();
          if (regSnap.exists) {
            const registration = regSnap.data() as RegistrationDocV2;
            await regRef.set({
              status: "REFUNDED",
              refundedAt: Date.now(),
              stripeRefundId: refund.refundId,
              updatedAt: Date.now(),
            }, { merge: true });
            await enqueueNotification({
              id: `event_refund_${registrationId}`,
              type: "REFUND_CONFIRMED",
              eventId: registration.eventId,
              registrationId,
              email: registration.email,
              displayName: registration.displayName,
            });
          }
        }
        await doc.ref.set({
          status: "completed",
          stripeRefundId: refund.refundId,
          completedAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true });
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        await doc.ref.set({
          attempts,
          nextAttemptAt: Date.now() + Math.min(60, Math.pow(2, attempts)) * 60 * 1000,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        }, { merge: true });
      }
    }
  },
);

export { events_v2AdminPublishEvent, events_v2AdminSaveEvent } from "./adminEventSave";

// Admin and staff operations live in adminEventOps.ts so the isolated
// admin-event-save codebase can deploy them (audit P0-4).
export {
  events_v2AdminCancelEvent,
  events_v2AdminCompleteEvent,
  events_v2StaffCheckIn,
  events_v2StaffGetRoster,
  events_v2StaffWalkIn,
} from "./adminEventOps";

export const events_v2ListMyRegistrations = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const snap = await db().collection("eventRegistrations")
    .where("uid", "==", request.auth.uid)
    .orderBy("registeredAt", "desc")
    .limit(100)
    .get();
  const registrations = snap.docs.map((doc) => doc.data() as RegistrationDocV2);
  const eventIds = [...new Set(registrations.map((registration) => registration.eventId))];
  const events = await Promise.all(eventIds.map(async (eventId) => {
    const eventSnap = await db().collection("events").doc(eventId).get();
    return eventSnap.exists ? publicEvent(eventSnap.data() as EventDocV2) : null;
  }));
  return { registrations, events: events.filter(Boolean) };
});
