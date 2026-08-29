import { onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as adminMemberOperations from "./adminMemberOperations";
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

export const admin_bookingForMemberGetAvailability = onCall(async (request) => {
  await validateRequestedWindow(request);
  return runCallable(adminMemberOperations.admin_bookingForMemberGetAvailability, request);
});

export const admin_bookingForMemberQuote = onCall(async (request) => {
  await validateRequestedWindow(request);
  return runCallable(adminMemberOperations.admin_bookingForMemberQuote, request);
});

export const admin_bookingForMemberBeginCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    await validateRequestedWindow(request);
    return runCallable(adminMemberOperations.admin_bookingForMemberBeginCheckout, request);
  },
);
