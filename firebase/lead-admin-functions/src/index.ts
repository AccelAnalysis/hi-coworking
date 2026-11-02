/**
 * Deploy entry for the admin Leads page's intake callables and the intake
 * new-lead alert trigger.
 *
 * These are default-codebase functions that are also exported from
 * apps/functions/src/main.ts. This entry loads leadAdmin.ts and
 * leadAlertTriggers.ts and nothing else, so the only secret it declares is the
 * existing HI_COWORKING_RESEND_API_KEY. Always deploy with --only, e.g.
 *   --only functions:leadsAdmin_listIntake,functions:leadsAdmin_setIntakeNotes,functions:intake_onNewLead
 * and never --force, or the CLI treats every other default function as one to
 * delete.
 */
export { leadsAdmin_listIntake, leadsAdmin_setIntakeNotes } from "../../../apps/functions/src/leadAdmin";
export { intake_onNewLead } from "../../../apps/functions/src/leadAlertTriggers";
