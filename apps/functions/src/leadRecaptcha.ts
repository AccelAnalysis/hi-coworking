/**
 * reCAPTCHA checks for the Coming Soon `leads_submitLead` endpoint.
 *
 * The web client sends a reCAPTCHA Enterprise token made with the public site key
 * (NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY). It is verified with the Enterprise
 * assessments API using the function's own service-account credential, so no API key
 * or new secret is needed. Tokens without `recaptchaProvider: "enterprise"` still go
 * through the legacy v3 siteverify path with RECAPTCHA_SECRET_KEY.
 *
 * Verdicts carry a score and a reason code only, never the visitor's email or name.
 */

import { RECAPTCHA_ENTERPRISE_PUBLIC_SITE_KEY } from "./recaptchaEnterpriseSiteKey";

export const LEAD_RECAPTCHA_PROJECT = "hi-coworking-plat";
export const LEAD_RECAPTCHA_MIN_SCORE = 0.3;
export const LEAD_RECAPTCHA_ACTIONS = ["early_access", "survey"] as const;
export type LeadRecaptchaAction = (typeof LEAD_RECAPTCHA_ACTIONS)[number];
export const LEAD_RECAPTCHA_HOSTS = [
  "hi-coworking.com",
  "www.hi-coworking.com",
  "hi-coworking-plat.web.app",
] as const;

export type LeadCaptchaVerdict =
  | { ok: true; score: number; provider: "enterprise" | "v3" }
  | {
      ok: false;
      score: number;
      provider: "enterprise" | "v3";
      reason:
        | "missing_token"
        | "unconfigured"
        | "verify_unavailable"
        | "invalid_token"
        | "action_mismatch"
        | "host_not_allowed"
        | "low_score";
    };

export function leadRecaptchaAction(type: unknown): LeadRecaptchaAction {
  return type === "survey" ? "survey" : "early_access";
}

export function leadRecaptchaSiteKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.RECAPTCHA_ENTERPRISE_SITE_KEY?.trim() || RECAPTCHA_ENTERPRISE_PUBLIC_SITE_KEY;
}

export async function verifyLeadRecaptcha(input: {
  body: { recaptchaToken?: unknown; recaptchaProvider?: unknown; type?: unknown };
  fetchImpl: typeof fetch;
  getAccessToken: () => Promise<string>;
  legacySecret: () => string;
  env?: NodeJS.ProcessEnv;
}): Promise<LeadCaptchaVerdict> {
  const token = typeof input.body.recaptchaToken === "string" ? input.body.recaptchaToken.trim() : "";
  const provider = input.body.recaptchaProvider === "enterprise" ? "enterprise" : "v3";
  if (!token) return { ok: false, score: 0, provider, reason: "missing_token" };
  if (provider === "enterprise") {
    return verifyEnterprise({
      token,
      expectedAction: leadRecaptchaAction(input.body.type),
      fetchImpl: input.fetchImpl,
      getAccessToken: input.getAccessToken,
      env: input.env ?? process.env,
    });
  }
  return verifyLegacyV3(token, input.legacySecret, input.fetchImpl);
}

async function verifyEnterprise(input: {
  token: string;
  expectedAction: LeadRecaptchaAction;
  fetchImpl: typeof fetch;
  getAccessToken: () => Promise<string>;
  env: NodeJS.ProcessEnv;
}): Promise<LeadCaptchaVerdict> {
  const base = { provider: "enterprise" as const };
  const siteKey = leadRecaptchaSiteKey(input.env);
  const project = input.env.RECAPTCHA_ENTERPRISE_PROJECT?.trim() || LEAD_RECAPTCHA_PROJECT;
  let accessToken = "";
  try {
    accessToken = await input.getAccessToken();
  } catch {
    accessToken = "";
  }
  if (!siteKey || !accessToken) return { ...base, ok: false, score: 0, reason: "unconfigured" };

  let response: Response;
  try {
    response = await input.fetchImpl(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(project)}/assessments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          event: { token: input.token, siteKey, expectedAction: input.expectedAction },
        }),
      },
    );
  } catch {
    return { ...base, ok: false, score: 0, reason: "verify_unavailable" };
  }
  if (!response.ok) return { ...base, ok: false, score: 0, reason: "verify_unavailable" };

  const assessment = (await response.json().catch(() => null)) as {
    tokenProperties?: { valid?: boolean; action?: string; hostname?: string };
    riskAnalysis?: { score?: number };
  } | null;
  const score = typeof assessment?.riskAnalysis?.score === "number" ? assessment.riskAnalysis.score : 0;
  const props = assessment?.tokenProperties;
  if (props?.valid !== true) return { ...base, ok: false, score, reason: "invalid_token" };
  if (props.action !== input.expectedAction) return { ...base, ok: false, score, reason: "action_mismatch" };
  const hostname = props.hostname?.trim().toLowerCase() ?? "";
  if (!(LEAD_RECAPTCHA_HOSTS as readonly string[]).includes(hostname)) {
    return { ...base, ok: false, score, reason: "host_not_allowed" };
  }
  if (score < LEAD_RECAPTCHA_MIN_SCORE) return { ...base, ok: false, score, reason: "low_score" };
  return { ...base, ok: true, score };
}

async function verifyLegacyV3(
  token: string,
  legacySecret: () => string,
  fetchImpl: typeof fetch,
): Promise<LeadCaptchaVerdict> {
  const base = { provider: "v3" as const };
  let secret = "";
  try {
    secret = legacySecret().trim();
  } catch {
    secret = "";
  }
  if (!secret) return { ...base, ok: false, score: 0, reason: "unconfigured" };
  let data: { success?: boolean; score?: number } | null;
  try {
    const params = new URLSearchParams({ secret, response: token });
    const response = await fetchImpl("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    data = (await response.json().catch(() => null)) as { success?: boolean; score?: number } | null;
  } catch {
    return { ...base, ok: false, score: 0, reason: "verify_unavailable" };
  }
  const score = typeof data?.score === "number" ? data.score : 0;
  if (data?.success !== true) return { ...base, ok: false, score, reason: "invalid_token" };
  if (score < LEAD_RECAPTCHA_MIN_SCORE) return { ...base, ok: false, score, reason: "low_score" };
  return { ...base, ok: true, score };
}

/** HTTP status and visitor-safe message for a failed verdict. */
export function leadCaptchaFailureResponse(verdict: Extract<LeadCaptchaVerdict, { ok: false }>): {
  status: number;
  error: string;
} {
  if (verdict.reason === "missing_token") return { status: 400, error: "reCAPTCHA token is required" };
  if (verdict.reason === "unconfigured" || verdict.reason === "verify_unavailable") {
    return { status: 503, error: "Spam check is unavailable. Please try again shortly." };
  }
  return { status: 403, error: "Spam check failed. Please try again." };
}
