import { onCall, HttpsError } from "firebase-functions/v2/https";

// Retired booking endpoints. They stay deployed so old clients get a clear
// error. Exported by main.ts and by firebase/core-functions.
export const createBookingQuote = onCall(async () => {
  throw new HttpsError(
    "failed-precondition",
    "This quote endpoint has been retired. Start from Spaces and use the current booking checkout.",
  );
});

export const createBooking = onCall(async () => {
  throw new HttpsError(
    "failed-precondition",
    "This booking endpoint has been retired. Start from Spaces and use the current booking checkout.",
  );
});
