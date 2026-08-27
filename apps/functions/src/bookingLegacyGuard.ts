import { onCall, HttpsError } from "firebase-functions/v2/https";

/**
 * Compatibility guard for the historical createBooking callable.
 *
 * The previous implementation could write a CONFIRMED booking with
 * paymentMethod=STRIPE before a Stripe payment existed. Keep the public
 * function name deployed so stale clients fail safely instead of reaching the
 * legacy implementation. New clients must use the authoritative
 * booking_beginCheckout lifecycle.
 */
export const createBooking = onCall(async () => {
  throw new HttpsError(
    "failed-precondition",
    "This booking endpoint has been retired. Refresh the site and start a new booking.",
  );
});
