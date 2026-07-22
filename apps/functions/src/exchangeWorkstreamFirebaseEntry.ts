import * as admin from "firebase-admin";

if (admin.apps.length === 0) admin.initializeApp();

export { rfx_listManaged } from "./rfxQueries";
export { territory_list_released } from "./territories";

export {
  businessReferral_create,
  businessReferral_send,
  businessReferral_respond,
  businessReferral_progress,
  businessReferral_updateConsent,
  businessReferral_confirmConsent,
  businessReferral_withdrawConsent,
  businessReferral_prepareEvidenceAccess,
  businessReferral_createDispute,
  businessReferral_resolveDispute,
} from "./businessReferrals";

export {
  businessReferral_listMine,
  businessReferral_getDetail,
  businessReferral_listTimeline,
  businessReferral_reportTransaction,
  businessReferral_reviewTransaction,
  businessReferral_suggestRecipients,
  referralIntelligence_getOverview,
  referralIntelligence_listRelationships,
  referralIntelligence_getGapAnalysis,
  referralIntelligence_getEconomicImpact,
  referralIntelligence_getReciprocalPatterns,
} from "./referralRun3";

export {
  referralServiceOffer_create,
  referralServiceOffer_publish,
  referralServiceOffer_createVersion,
  referralServiceOffer_deactivate,
  referralServiceOffer_listMine,
  referralServiceOffer_listDiscoverable,
} from "./referralServiceOffers";
