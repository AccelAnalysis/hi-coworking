import { defineSecret, type SecretParam } from "firebase-functions/params";

/**
 * Bound on expo_submitNasaLead so Cloud Functions can mount them.
 * Deploy of that function fails until each secret exists in Secret Manager.
 * Microsoft Graph secrets are not bound. Add M365_TENANT_ID, M365_CLIENT_ID,
 * and M365_CLIENT_SECRET back to this list before switching the provider to graph.
 * This module never logs a secret value.
 */
export const resendApiKey = defineSecret("RESEND_API_KEY");
export const recaptchaEnterpriseApiKey = defineSecret("RECAPTCHA_ENTERPRISE_API_KEY");

export const POWER_NOW_CONFIRMATION_SECRETS: SecretParam[] = [
  resendApiKey,
  recaptchaEnterpriseApiKey,
];

const SECRET_PARAMS: Record<string, SecretParam> = {
  RESEND_API_KEY: resendApiKey,
  RECAPTCHA_ENTERPRISE_API_KEY: recaptchaEnterpriseApiKey,
};

export function readPowerNowSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env[name]?.trim();
  if (fromEnv) return fromEnv;
  if (env !== process.env) return undefined;
  const param = SECRET_PARAMS[name];
  if (!param) return undefined;
  try {
    const value = param.value()?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}
