import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { finalizeEventHoldFromPaymentMetadata } from "./eventJourney";

/**
 * Finalize Events v2 registrations whenever Stripe moves the unified payment
 * ledger entry to paid. This keeps event fulfillment independent of the
 * customer's browser returning from Checkout and avoids coupling the new event
 * lifecycle to the legacy event-commerce webhook implementation.
 */
export const events_onPaymentPaid = onDocumentUpdated("payments/{paymentId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || after.status !== "paid" || before?.status === "paid") return;
  if (after.purpose !== "event") return;
  const holdId = after.providerRefs?.holdId || after.purposeRefId;
  const eventId = after.providerRefs?.eventId;
  if (!holdId || !eventId) return;

  try {
    await finalizeEventHoldFromPaymentMetadata({
      purpose: "event",
      eventFlowVersion: "2",
      eventId,
      holdId,
    });
  } catch (error) {
    logger.error("Events v2 payment finalization failed", {
      paymentId: event.params.paymentId,
      holdId,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});
