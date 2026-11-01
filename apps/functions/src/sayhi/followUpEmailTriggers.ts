/**
 * Firestore triggers for the SayHi follow-up emails. Deployed from the
 * isolated mail source (firebase/mail-functions) so the only secret bound is
 * the Resend key. Both are no-ops unless SAYHI_FLOW_ENABLED is exactly
 * "true" in that source's env, and the wording needs Jonathan's approval
 * before they are deployed at all.
 */
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { resendApiKey } from "../providers/emailSecret";
import { sendExtraTimeEmail, sendNoCheckoutEmail } from "./followUpEmails";

/** After an extra-time charge lands on the next bill or the booking card. */
export const sayhi_sendExtraTimeEmail = onDocumentUpdated(
  { document: "kioskVisits/{visitId}", secrets: [resendApiKey] },
  async (event) => {
    await sendExtraTimeEmail(
      { visitId: event.params.visitId, before: event.data?.before.data(), after: event.data?.after.data() },
      { apiKey: resendApiKey.value() },
    );
  },
);

/** When a visit with no check-out is flagged for staff review. */
export const sayhi_sendNoCheckoutEmail = onDocumentCreated(
  { document: "staffFollowUps/{followUpId}", secrets: [resendApiKey] },
  async (event) => {
    await sendNoCheckoutEmail({ followUp: event.data?.data() }, { apiKey: resendApiKey.value() });
  },
);
