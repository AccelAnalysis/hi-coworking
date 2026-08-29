import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type BeginEventRegistrationInput = {
  eventId: string;
  ticketTypeId?: string;
  quantity?: number;
  guest?: { name: string; email: string };
  successUrl?: string;
  cancelUrl?: string;
};

export type BeginEventRegistrationResult =
  | { kind: "confirmed"; registrationId: string; manageSecret: string }
  | { kind: "checkout"; holdId: string; holdSecret: string; expiresAt: number; paymentId: string; checkoutUrl: string };

export const beginEventRegistrationV2 = httpsCallable<BeginEventRegistrationInput, BeginEventRegistrationResult>(
  functions,
  "events_beginRegistration",
);

export const finalizeEventRegistrationV2 = httpsCallable<
  { holdId: string; holdSecret?: string },
  { status: string; registrationId?: string | null }
>(functions, "events_finalizeRegistration");

export const joinEventWaitlistV2 = httpsCallable<
  { eventId: string; quantity?: number; guest?: { name: string; email: string } },
  { success: boolean; waitlistEntryId: string; manageSecret: string }
>(functions, "events_joinWaitlistV2");

export const getEventCancellationQuoteV2 = httpsCallable<
  { registrationId: string; manageSecret?: string },
  { canCancel: boolean; refundEligible: boolean; refundCents: number; policyMessage: string }
>(functions, "events_getCancellationQuote");

export const cancelEventRegistrationV2 = httpsCallable<
  { registrationId: string; manageSecret?: string },
  { success: boolean; status: string; refundCents: number }
>(functions, "events_cancelRegistrationV2");

export const staffSetEventCheckInV2 = httpsCallable<
  { registrationId: string; checkedInQuantity: number },
  { success: boolean; checkedInQuantity: number }
>(functions, "events_staffSetCheckIn");
