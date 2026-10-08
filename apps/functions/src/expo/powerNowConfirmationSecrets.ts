import { defineSecret, type SecretParam } from "firebase-functions/params";

/**
 * Bound on expo_submitNasaLead so Cloud Functions can mount them.
 * Deploy of that function fails until each secret exists in Secret Manager.
 * This module never logs a secret value.
 */
export const resendApiKey = defineSecret("RESEND_API_KEY");
export const m365TenantId = defineSecret("M365_TENANT_ID");
export const m365ClientId = defineSecret("M365_CLIENT_ID");
export const m365ClientSecret = defineSecret("M365_CLIENT_SECRET");
export const recaptchaEnterpriseApiKey = defineSecret("RECAPTCHA_ENTERPRISE_API_KEY");

export const POWER_NOW_CONFIRMATION_SECRETS: SecretParam[] = [
  resendApiKey,
  m365TenantId,
  m365ClientId,
  m365ClientSecret,
  recaptchaEnterpriseApiKey,
];

const SECRET_PARAMS: Record<string, SecretParam> = {
  RESEND_API_KEY: resendApiKey,
  M365_TENANT_ID: m365TenantId,
  M365_CLIENT_ID: m365ClientId,
  M365_CLIENT_SECRET: m365ClientSecret,
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
