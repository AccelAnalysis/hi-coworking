/**
 * Early Access and survey lead capture for the Coming Soon page.
 *
 * Posts to the hi-coworking-plat `leads_submitLead` HTTP function with a
 * reCAPTCHA Enterprise token. The site key is the public
 * NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY value; no secret lives here.
 */

export const LEAD_RECAPTCHA_PROVIDER = "enterprise";
export const DEFAULT_LEADS_PROJECT_ID = "hi-coworking-plat";
export const LEADS_FUNCTION_REGION = "us-central1";

export type LeadAction = "early_access" | "survey";

export type LeadSubmitOutcome =
  | { ok: true }
  | { ok: false; reason: "invalid" | "spam_check" | "server" | "network" };

export const LEAD_ERROR_MESSAGES: Record<Exclude<LeadSubmitOutcome, { ok: true }>["reason"], string> = {
  invalid: "Please enter your name and a valid email address, then try again.",
  spam_check:
    "We couldn't confirm this request came from a person. Please wait a moment and try again.",
  server:
    "Something went wrong on our side and your request was not saved. Please try again in a few minutes.",
  network:
    "We couldn't reach our server. Check your connection and try again. Your details are still in the form.",
};

export function leadsSubmitUrl(env: {
  NEXT_PUBLIC_LEADS_SUBMIT_URL?: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
}): string {
  const explicit = env.NEXT_PUBLIC_LEADS_SUBMIT_URL?.trim();
  if (explicit) return explicit;
  const project = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || DEFAULT_LEADS_PROJECT_ID;
  return `https://${LEADS_FUNCTION_REGION}-${project}.cloudfunctions.net/leads_submitLead`;
}

export function leadActionFor(payload: { type?: unknown }): LeadAction {
  return payload.type === "survey" ? "survey" : "early_access";
}

export function outcomeForStatus(status: number): LeadSubmitOutcome {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 403) return { ok: false, reason: "spam_check" };
  if (status === 400) return { ok: false, reason: "invalid" };
  return { ok: false, reason: "server" };
}

export async function submitLeadRequest(
  payload: Record<string, unknown>,
  deps: {
    url: string;
    fetchImpl: typeof fetch;
    getToken: (action: LeadAction) => Promise<string>;
  },
): Promise<LeadSubmitOutcome> {
  const action = leadActionFor(payload);
  let token = "";
  try {
    token = await deps.getToken(action);
  } catch {
    token = "";
  }
  if (!token) return { ok: false, reason: "spam_check" };
  let response: Response;
  try {
    response = await deps.fetchImpl(deps.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        recaptchaToken: token,
        recaptchaProvider: LEAD_RECAPTCHA_PROVIDER,
        recaptchaAction: action,
      }),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  return outcomeForStatus(response.status);
}
