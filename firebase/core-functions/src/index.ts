// Isolated deploy source for the 45 default-codebase functions that main
// exports and that are deployed in hi-coworking-plat today.
//
// apps/functions/src/main.ts also loads eventMarketing.ts, which declares the
// TWILIO_*, LINKEDIN_* and X_* secrets. The Firebase CLI asks for every secret
// declared in the source it loads, even with --only, so a deploy from
// apps/functions fails until those exist. This entry loads
// apps/functions/src/index.ts (which no longer imports eventMarketing) and
// re-exports the same function objects main.ts exports, so each function's
// code, trigger, options and bound secrets are unchanged.
//
// Keep it that way: do not import main.ts or eventMarketing.ts here.
//
// This shares the default codebase with firebase.json, firebase.mail.json,
// firebase.expo-lead.json and firebase.payment-status-guard.json. Always
// deploy with --only functions:<name>,... and never --force, or the CLI
// treats every other default function as one to delete.
export {
  admin_backfillQBO,
  admin_syncPaymentToQBO,
  authProvisionOnCreate,
  businessReferral_confirmConsent,
  businessReferral_create,
  businessReferral_createDispute,
  businessReferral_prepareEvidenceAccess,
  businessReferral_progress,
  businessReferral_resolveDispute,
  businessReferral_respond,
  businessReferral_send,
  businessReferral_updateConsent,
  businessReferral_withdrawConsent,
  enrichment_link,
  enrichment_search,
  health,
  intuit_checkConnection,
  intuit_getAuthUrl,
  intuit_oauthCallback,
  leads_onNewLead,
  leads_submitContact,
  leads_submitLead,
  members_createBillingPortalSession,
  notify_eventRegistration,
  notify_paymentCreated,
  notify_referralUpdate,
  notify_rfxCreated,
  notify_rfxResponse,
  org_create,
  org_purchaseSeats,
  payments_createQuickBooksInvoice,
  payments_pollQBInvoices,
  profile_update,
  qb_chargeCard,
  qb_createCheckout,
  qb_paymentsWebhook,
  qb_refundCharge,
  referral_onStatusChange,
  rfx_listManaged,
  setUserRole,
  stripe_createCheckoutSession,
  stripe_webhook,
  territory_list_released,
} from "../../../apps/functions/src/index";

export { createBooking, createBookingQuote } from "../../../apps/functions/src/retiredBookingEndpoints";
