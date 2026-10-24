// Isolated deploy source for the campaign sender, events_processCampaignJobs.
//
// The main functions source (apps/functions) also loads eventMarketing.ts,
// which declares the LINKEDIN_* and X_* secrets. The Firebase CLI resolves
// every secret declared anywhere in the source it analyzes, even with --only,
// so a deploy from apps/functions fails until those exist.
//
// This entry imports only campaignJobs.ts. Its secrets are TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and HI_COWORKING_RESEND_API_KEY, plus
// the non-secret HI_COWORKING_SMS_ENABLED switch from .env.hi-coworking-plat
// (false: no texts until the A2P 10DLC campaign is approved). Do not import
// eventMarketing.ts, main.ts or index.ts here.
import "./bootstrap";

export { events_processCampaignJobs } from "../../../apps/functions/src/campaignJobs";
