/**
 * Firestore triggers for the SayHi follow-up emails. Deployed from the
 * isolated mail source (firebase/mail-functions) so the only secret bound is
 * the Resend key. Both are no-ops unless SAYHI_FLOW_ENABLED is exactly
 * "true" in that source's env. Wording approved Nov 1, 2026; deploy only
 * as part of the full go-live deploy order.
 */
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { resendApiKey } from "../providers/emailSecret";
import { sendExtraTimeEmail, sendNoCheckoutEmail } from "./followUpEmails";

/** After extra time is settled: covered by plan hours or charged. */
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
