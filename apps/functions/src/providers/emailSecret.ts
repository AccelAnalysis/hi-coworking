import { defineSecret } from "firebase-functions/params";
import { RESEND_API_KEY_SECRET_NAME } from "./emailProvider";

/**
 * Secret Manager binding for the Hi Coworking Resend key. Only functions that
 * send app mail list it in their `secrets`: the mail workers (nurture_process,
 * events_v2ProcessNotificationJobs, events_processCampaignJobs), stripe_webhook,
 * and the booking callables for the booking confirmation email. It is separate from
 * RESEND_API_KEY, which the Power NOW form uses for accelanalysis.com mail.
 *
 * Set it with:
 *   firebase functions:secrets:set HI_COWORKING_RESEND_API_KEY --project hi-coworking-plat
 */
export const resendApiKey = defineSecret(RESEND_API_KEY_SECRET_NAME);
