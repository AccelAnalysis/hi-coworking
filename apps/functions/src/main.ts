import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as legacy from "./index";

export const allocateMonthlyCredits = legacy.allocateMonthlyCredits;
export const rfx_refreshSuggestions_scheduled = legacy.rfx_refreshSuggestions_scheduled;
export const team_expire_invites = legacy.team_expire_invites;
export const businessReferral_expireSent = legacy.businessReferral_expireSent;
export const rfx_cleanupResponseUploadGrants = legacy.rfx_cleanupResponseUploadGrants;
export const access_expireGrants = legacy.access_expireGrants;
export const access_noShowRevoke = legacy.access_noShowRevoke;
export const onReferralWritten = legacy.onReferralWritten;
export const access_getMyGrants = legacy.access_getMyGrants;
export const access_adminRevoke = legacy.access_adminRevoke;
export const access_adminUnlock = legacy.access_adminUnlock;
export const access_adminResendPin = legacy.access_adminResendPin;
export const access_adminGetDoorStatus = legacy.access_adminGetDoorStatus;
export const access_seamWebhook = legacy.access_seamWebhook;
export const rfx_publish = legacy.rfx_publish;
export const rfx_update = legacy.rfx_update;
export const rfx_moderate = legacy.rfx_moderate;
export const rfx_cancel = legacy.rfx_cancel;
export const rfx_submitResponse = legacy.rfx_submitResponse;
export const rfx_evaluateResponse = legacy.rfx_evaluateResponse;
export const rfx_prepareResponseUploads = legacy.rfx_prepareResponseUploads;
export const rfx_prepareResponseDownload = legacy.rfx_prepareResponseDownload;
export const rfx_backfillGeo = legacy.rfx_backfillGeo;
export const rfx_refreshSuggestions = legacy.rfx_refreshSuggestions;
export const rfx_listManaged = legacy.rfx_listManaged;
export const exchange_privateStorage = legacy.exchange_privateStorage;
export const exchange_normalizeSensitiveStorageMetadata = legacy.exchange_normalizeSensitiveStorageMetadata;
export const referral_create = legacy.referral_create;
export const referral_contact = legacy.referral_contact;
export const referral_convert = legacy.referral_convert;
export const referral_markPaid = legacy.referral_markPaid;
export const referral_accept = legacy.referral_accept;
export const referral_decline = legacy.referral_decline;
export const referral_createPayoutCheckout = legacy.referral_createPayoutCheckout;
export const platformInvite_listReceived = legacy.platformInvite_listReceived;
export const legacyBusinessReferral_listReceived = legacy.legacyBusinessReferral_listReceived;
export const businessReferral_create = legacy.businessReferral_create;
export const businessReferral_send = legacy.businessReferral_send;
export const businessReferral_respond = legacy.businessReferral_respond;
export const businessReferral_progress = legacy.businessReferral_progress;
export const businessReferral_updateConsent = legacy.businessReferral_updateConsent;
export const businessReferral_confirmConsent = legacy.businessReferral_confirmConsent;
export const businessReferral_withdrawConsent = legacy.businessReferral_withdrawConsent;
export const businessReferral_prepareEvidenceAccess = legacy.businessReferral_prepareEvidenceAccess;
export const businessReferral_createDispute = legacy.businessReferral_createDispute;
export const businessReferral_resolveDispute = legacy.businessReferral_resolveDispute;
export const events_createTicketCheckout = legacy.events_createTicketCheckout;
export const events_createSponsorshipCheckout = legacy.events_createSponsorshipCheckout;
export const events_registerFree = legacy.events_registerFree;
export const events_cancelRegistration = legacy.events_cancelRegistration;
export const events_joinWaitlist = legacy.events_joinWaitlist;
export const events_upsertSeries = legacy.events_upsertSeries;
export const events_extendHorizon = legacy.events_extendHorizon;
export const events_setSeriesOccurrenceOverride = legacy.events_setSeriesOccurrenceOverride;
export const events_enqueueCampaignJobs = legacy.events_enqueueCampaignJobs;
export const events_processCampaignJobs = legacy.events_processCampaignJobs;
export const events_generateShareKits = legacy.events_generateShareKits;
export const events_processSocialPosts = legacy.events_processSocialPosts;
export const events_onMediaUploaded = legacy.events_onMediaUploaded;
export const bookstore_createCheckoutSession = legacy.bookstore_createCheckoutSession;
export const bookstore_getDownloadLink = legacy.bookstore_getDownloadLink;
export const territory_create = legacy.territory_create;
export const territory_update = legacy.territory_update;
export const territory_list_released = legacy.territory_list_released;
export const territory_release_scheduled = legacy.territory_release_scheduled;
export const enrichment_search = legacy.enrichment_search;
export const enrichment_link = legacy.enrichment_link;
export const verification_submit = legacy.verification_submit;
export const verification_review = legacy.verification_review;
export const verification_flag = legacy.verification_flag;
export const profile_update = legacy.profile_update;
export const team_listMine = legacy.team_listMine;
export const team_create = legacy.team_create;
export const team_invite = legacy.team_invite;
export const team_respond_invite = legacy.team_respond_invite;
export const team_revoke_invite = legacy.team_revoke_invite;
export const team_manage_member = legacy.team_manage_member;
export const health = legacy.health;
export const authBeforeCreate = legacy.authBeforeCreate;
export const setUserRole = legacy.setUserRole;
export const leads_submitLead = legacy.leads_submitLead;
export const leads_onNewLead = legacy.leads_onNewLead;
export const leads_submitContact = legacy.leads_submitContact;
export const stripe_createCheckoutSession = legacy.stripe_createCheckoutSession;
export const stripe_webhook = legacy.stripe_webhook;
export const qb_createCheckout = legacy.qb_createCheckout;
export const admin_markPaymentStatus = legacy.admin_markPaymentStatus;
export const intuit_getAuthUrl = legacy.intuit_getAuthUrl;
export const intuit_oauthCallback = legacy.intuit_oauthCallback;
export const intuit_checkConnection = legacy.intuit_checkConnection;
export const payments_createQuickBooksInvoice = legacy.payments_createQuickBooksInvoice;
export const payments_pollQBInvoices = legacy.payments_pollQBInvoices;
export const qb_chargeCard = legacy.qb_chargeCard;
export const qb_refundCharge = legacy.qb_refundCharge;
export const qb_paymentsWebhook = legacy.qb_paymentsWebhook;
export const admin_syncPaymentToQBO = legacy.admin_syncPaymentToQBO;
export const admin_backfillQBO = legacy.admin_backfillQBO;
export const referral_onStatusChange = legacy.referral_onStatusChange;
export const org_create = legacy.org_create;
export const org_purchaseSeats = legacy.org_purchaseSeats;
export const notify_rfxCreated = legacy.notify_rfxCreated;
export const notify_rfxResponse = legacy.notify_rfxResponse;
export const notify_referralUpdate = legacy.notify_referralUpdate;
export const notify_eventRegistration = legacy.notify_eventRegistration;
export const notify_paymentCreated = legacy.notify_paymentCreated;

// The original direct-booking callables could create confirmed bookings without
// authoritative checkout. They remain deployed only as fail-closed compatibility
// shims so stale clients cannot bypass the current availability/hold/payment flow.
export const createBookingQuote = onCall(async () => {
  throw new HttpsError(
    "failed-precondition",
    "This quote endpoint has been retired. Start from Spaces and use the current booking checkout.",
  );
});

export const createBooking = onCall(async () => {
  throw new HttpsError(
    "failed-precondition",
    "This booking endpoint has been retired. Start from Spaces and use the current booking checkout.",
  );
});

export * from "./bookingJourney";
export * from "./bookingManagement";
export * from "./eventV2";
