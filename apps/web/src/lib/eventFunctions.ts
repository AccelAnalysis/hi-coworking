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
  | { kind: "confirmed"; registrationId: string; manageToken?: string }
  | { kind: "checkout"; holdId: string; holdSecret: string; expiresAt: number; paymentId: string; checkoutUrl: string };

export const beginEventRegistrationV2 = httpsCallable<BeginEventRegistrationInput, BeginEventRegistrationResult>(
  functions,
  "events_beginRegistrationV2",
);

export const finalizeEventRegistrationV2 = httpsCallable<
  { holdId: string; holdSecret?: string },
  { status: string; registrationId?: string; manageToken?: string; refundRequired?: boolean }
>(functions, "events_finalizeRegistrationV2");

export const getEventCancellationQuoteV2 = httpsCallable<
  { registrationId: string; manageToken?: string },
  { canCancel: boolean; refundEligible: boolean; refundCents: number; policyMessage: string }
>(functions, "events_getCancellationQuoteV2");

export const cancelEventRegistrationV2 = httpsCallable<
  { registrationId: string; manageToken?: string },
  { success: boolean; status: string; refundCents: number; policyMessage: string }
>(functions, "events_cancelRegistrationV2");

export const joinEventWaitlistV2 = httpsCallable<
  { eventId: string; ticketTypeId?: string; quantity?: number; guest?: { name: string; email: string } },
  { success: boolean; waitlistEntryId: string; manageToken?: string }
>(functions, "events_joinWaitlistV2");

export const getEventRosterV2 = httpsCallable<
  { eventId: string },
  { registrations: Array<Record<string, unknown>> }
>(functions, "events_staffGetRosterV2");

export const checkInEventRegistrationV2 = httpsCallable<
  { registrationId: string; quantity?: number },
  { success: boolean; checkedInQuantity: number }
>(functions, "events_staffCheckInV2");

export const completeEventV2 = httpsCallable<
  { eventId: string },
  { success: boolean; registrationsReviewed: number }
>(functions, "events_adminCompleteV2");
