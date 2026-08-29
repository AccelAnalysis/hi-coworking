import { onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as bookingTransaction from "./bookingFlexTransaction";
import * as bookingManagement from "./bookingManagement";
import { seamApiKey } from "./access";
import { assertWindowWithinOperatingCalendar } from "./bookingOperatingCalendar";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

type RunnableCallable = {
  run: (request: unknown) => Promise<unknown>;
};

async function runCallable(callable: unknown, request: unknown) {
  return (callable as RunnableCallable).run(request);
}

async function validateRequestedWindow(request: { data?: unknown }) {
  const data = (request.data || {}) as { start?: number; end?: number };
  await assertWindowWithinOperatingCalendar(Number(data.start), Number(data.end));
}

export const booking_beginCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    await validateRequestedWindow(request);
    return runCallable(bookingTransaction.booking_beginCheckout, request);
  },
);

// Finalization intentionally honors an already-created 15-minute hold. A
// schedule change after checkout starts should not strand a paid customer.
export const booking_finalizeCheckout = bookingTransaction.booking_finalizeCheckout;
export const booking_onDeskChangeBookingUpdated = bookingTransaction.booking_onDeskChangeBookingUpdated;

export const booking_getCancellationPreview = bookingManagement.booking_getCancellationPreview;
export const booking_cancel = bookingManagement.booking_cancel;

export const booking_reschedule = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    await validateRequestedWindow(request);
    return runCallable(bookingManagement.booking_reschedule, request);
  },
);
