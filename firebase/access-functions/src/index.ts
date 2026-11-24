// Seam door-code functions in their own deploy source (Jonathan, Oct 31, 2026,
// Option A). They stay in the default codebase where they already run, but
// this source loads only the access module, so the deploy asks for the two
// Seam secrets and nothing else (no Twilio, LinkedIn, X or Stripe).
// Deployed by .github/workflows/firebase-live-access-functions.yml.
import "./bootstrap";

export {
  access_getMyGrants,
  access_adminResendPin,
  access_adminRevoke,
  access_adminUnlock,
  access_adminGetDoorStatus,
  access_adminRetryCode,
  access_adminResolveAlert,
  access_onRevokeRequested,
  access_seamWebhook,
} from "../../../apps/functions/src/access";

// No-show sweep (Jonathan, Nov 3, 2026): revokes a code only when the member
// clearly never arrived; it needs only the Seam API key. The expiry sweep
// also removes codes a refund asked to revoke.
export { access_expireGrants, access_noShowRevoke } from "../../../apps/functions/src/scheduled/accessCleanup";
