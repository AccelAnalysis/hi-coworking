/**
 * Deploy entry for expo_submitNasaLead only.
 *
 * firebase deploy loads the whole codebase entry before --only filters
 * functions. defineSecret() calls that run during that load are resolved for
 * every deploy of the codebase. This entry imports the Attio intake function
 * and nothing else, so the only registered secret is ATTIO_API_KEY.
 * RESEND_API_KEY and RECAPTCHA_ENTERPRISE_API_KEY are optional runtime reads.
 * They are not defineSecret bindings, so a missing secret does not block deploy.
 *
 * The function stays exported from apps/functions/src/main.ts as well. Deploy
 * this directory with firebase.expo-lead.json and
 * --only functions:expo_submitNasaLead so the existing default-codebase
 * function is updated and every other function is left in place.
 */
export { expo_submitNasaLead } from "../../../apps/functions/src/expo/submitNasaLead";
