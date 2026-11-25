/**
 * Post-attendance visit feedback flags. Both stay off unless the env value
 * is exactly "true" (any casing). They are read from the environment, not
 * declared as Firebase params, so a deploy never prompts for them.
 *
 * VISIT_FEEDBACK_ENABLED gates the daily invitation job. The public form
 * still accepts a valid single-use token so a manual test invitation can be
 * submitted without turning sends on.
 *
 * VISIT_FEEDBACK_SENDS_ENABLED must also be true before the job creates
 * invitations or sends email.
 */
export const VISIT_FEEDBACK_ENABLED_PARAM = "VISIT_FEEDBACK_ENABLED";
export const VISIT_FEEDBACK_SENDS_ENABLED_PARAM = "VISIT_FEEDBACK_SENDS_ENABLED";

export function isFlagOn(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export function visitFeedbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isFlagOn(env[VISIT_FEEDBACK_ENABLED_PARAM]);
}

export function visitFeedbackSendsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isFlagOn(env[VISIT_FEEDBACK_SENDS_ENABLED_PARAM]);
}

/** The job only sends when both flags are on. */
export function visitFeedbackJobMaySend(env: NodeJS.ProcessEnv = process.env): boolean {
  return visitFeedbackEnabled(env) && visitFeedbackSendsEnabled(env);
}
