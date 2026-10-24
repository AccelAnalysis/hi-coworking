// Isolated deploy source for the Resend mail workers.
//
// The main functions source (apps/functions) also loads eventMarketing.ts,
// which declares TWILIO_*, LINKEDIN_* and X_* secrets. The Firebase CLI asks
// for every secret declared anywhere in the source it analyzes, even with
// --only, so a deploy from apps/functions fails until those are set.
//
// This entry imports only the two mail workers. The only secret it declares
// is HI_COWORKING_RESEND_API_KEY. Keep it that way: do not import
// eventMarketing.ts (or main.ts / index.ts) here.
//
// events_processCampaignJobs is left out on purpose. It binds the Twilio
// secrets and deploys from firebase/campaign-functions instead.
import "./bootstrap";

export { nurture_process } from "../../../apps/functions/src/nurture";
export { events_v2ProcessNotificationJobs } from "../../../apps/functions/src/eventsV2/notifications";
