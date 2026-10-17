/**
 * Optional Power NOW secrets for expo_submitNasaLead.
 *
 * These are not defineSecret() bindings. The isolated deploy entry
 * (firebase/expo-lead-functions, firebase.expo-lead.json) registers only
 * ATTIO_API_KEY, so a missing Resend or reCAPTCHA secret does not block
 * deploy. The function reads each value from the environment first, then
 * from Secret Manager as the runtime service account. A missing secret logs
 * a warning and the confirmation email is skipped. reCAPTCHA is not treated
 * as passed, and the origin, honeypot, and rate-limit checks still run.
 *
 * Microsoft Graph secrets are not read here. Add M365_TENANT_ID,
 * M365_CLIENT_ID, and M365_CLIENT_SECRET back to the function binding before
 * switching the provider to graph. This module never logs a secret value.
 */

export const POWER_NOW_OPTIONAL_SECRETS = [
  "RESEND_API_KEY",
  "RECAPTCHA_ENTERPRISE_API_KEY",
] as const;

const cache = new Map<string, string | null>();
const warned = new Set<string>();

export function resetOptionalPowerNowSecretCache(): void {
  cache.clear();
  warned.clear();
}

export function readPowerNowSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, name)) {
    return env[name]?.trim() || undefined;
  }
  if (env !== process.env) return undefined;
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  return cache.get(name) || undefined;
}

export async function loadOptionalPowerNowSecrets(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (env !== process.env) return;
  if (!process.env.K_SERVICE && !process.env.FUNCTION_TARGET) return;
  for (const name of POWER_NOW_OPTIONAL_SECRETS) {
    if (process.env[name]?.trim() || cache.has(name)) continue;
    cache.set(name, await accessOptionalSecret(name, fetchImpl));
  }
}

async function accessOptionalSecret(name: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const tokenResponse = await fetchImpl(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (!tokenResponse.ok) {
      warnOptionalSecret(name, String(tokenResponse.status));
      return null;
    }
    const tokenBody = await tokenResponse.json() as { access_token?: string };
    const token = tokenBody.access_token?.trim();
    if (!token) {
      warnOptionalSecret(name, "no-token");
      return null;
    }
    const project = process.env.GCLOUD_PROJECT
      || process.env.GCP_PROJECT
      || process.env.GOOGLE_CLOUD_PROJECT
      || "hi-coworking-plat";
    const response = await fetchImpl(
      `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(project)}/secrets/${encodeURIComponent(name)}/versions/latest:access`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await response.json().catch(() => null) as {
      error?: { status?: string };
      payload?: { data?: string };
    } | null;
    if (!response.ok) {
      warnOptionalSecret(name, body?.error?.status || String(response.status));
      return null;
    }
    const encoded = body?.payload?.data;
    if (typeof encoded !== "string" || !encoded) {
      warnOptionalSecret(name, "empty");
      return null;
    }
    const value = Buffer.from(encoded, "base64").toString("utf8").trim();
    if (!value) {
      warnOptionalSecret(name, "empty");
      return null;
    }
    return value;
  } catch (error) {
    warnOptionalSecret(name, error instanceof Error ? error.name : "unavailable");
    return null;
  }
}

function warnOptionalSecret(name: string, code: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(
    `Power NOW secret ${name} is unset (${code}). Confirmation email or reCAPTCHA Enterprise is skipped until the secret exists. The Attio submission is unchanged, and reCAPTCHA is not treated as passed.`,
  );
}
