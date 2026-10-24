"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resendApiKey = void 0;
const params_1 = require("firebase-functions/params");
const emailProvider_1 = require("./emailProvider");
/**
 * Secret Manager binding for the Hi Coworking Resend key. Only the mail
 * workers (nurture_process, events_v2ProcessNotificationJobs,
 * events_processCampaignJobs) list it in their `secrets`. It is separate from
 * RESEND_API_KEY, which the Power NOW form uses for accelanalysis.com mail.
 *
 * Set it with:
 *   firebase functions:secrets:set HI_COWORKING_RESEND_API_KEY --project hi-coworking-plat
 */
exports.resendApiKey = (0, params_1.defineSecret)(emailProvider_1.RESEND_API_KEY_SECRET_NAME);
