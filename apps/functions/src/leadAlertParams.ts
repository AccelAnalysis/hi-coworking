/**
 * Deploy-time params for new-lead alerts. Values are not secrets; they are
 * exposed to the function as env vars of the same name, which leadAlerts.ts
 * reads. Both are also set in apps/functions/.env.hi-coworking-plat and
 * .env.demo-hi-coworking so deploys and emulators never prompt.
 *
 * Turn alerts on later with LEAD_ALERTS_ENABLED=true in .env.hi-coworking-plat
 * and a targeted redeploy of leads_onNewLead and intake_onNewLead.
 */
import { defineString } from "firebase-functions/params";
import { DEFAULT_LEAD_ALERT_TO, LEAD_ALERTS_ENABLED_PARAM, LEAD_ALERT_TO_PARAM } from "./leadAlerts";

export const leadAlertsEnabledParam = defineString(LEAD_ALERTS_ENABLED_PARAM, {
  default: "false",
  description: "Set to true to email the team when a new lead arrives. Anything else, including false, sends nothing.",
});

export const leadAlertToParam = defineString(LEAD_ALERT_TO_PARAM, {
  default: DEFAULT_LEAD_ALERT_TO,
  description: "Inbox that receives new-lead alerts.",
});
