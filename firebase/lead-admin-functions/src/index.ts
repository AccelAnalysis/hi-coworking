/**
 * Deploy entry for the admin Leads page's intake callables only.
 *
 * These are default-codebase functions that are also exported from
 * apps/functions/src/main.ts. This entry loads leadAdmin.ts and nothing else,
 * so it declares no secrets. Always deploy with
 *   --only functions:leadsAdmin_listIntake,functions:leadsAdmin_setIntakeNotes
 * and never --force, or the CLI treats every other default function as one to
 * delete.
 */
export { leadsAdmin_listIntake, leadsAdmin_setIntakeNotes } from "../../../apps/functions/src/leadAdmin";
