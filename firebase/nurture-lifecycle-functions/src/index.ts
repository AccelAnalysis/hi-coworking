// Isolated deploy source for the Nurture lifecycle functions (codebase
// "nurture-lifecycle"): enrollment triggers, the daily lifecycle scan, the
// admin overview/status callables and the preferences callables.
//
// nurture_process (the mail worker) stays in the default codebase and deploys
// from firebase/mail-functions; it is deliberately not exported here.
//
// The only secret this source declares is HI_COWORKING_RESEND_API_KEY (via
// providers/emailSecret.ts). Do not import main.ts, index.ts or
// eventMarketing.ts here: eventMarketing declares TWILIO_*, LINKEDIN_* and X_*
// secrets, and the Firebase CLI asks for every secret in the loaded source.
import "./bootstrap";

export {
  nurture_scanLifecycle,
  nurture_onLeadCreated,
  nurture_onBookingCreated,
  nurture_onMemberUpdated,
  nurture_adminOverview,
  nurture_adminSetCampaignStatus,
  nurture_unsubscribe,
  nurture_updateMyPreferences,
} from "../../../apps/functions/src/nurture";
