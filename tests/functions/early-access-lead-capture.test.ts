import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LEAD_RECAPTCHA_HOSTS,
  LEAD_RECAPTCHA_MIN_SCORE,
  leadCaptchaFailureResponse,
  leadRecaptchaAction,
  verifyLeadRecaptcha,
} from "../../apps/functions/src/leadRecaptcha";
import { RECAPTCHA_ENTERPRISE_PUBLIC_SITE_KEY } from "../../apps/functions/src/recaptchaEnterpriseSiteKey";
import { POWER_NOW_RECAPTCHA_SITE_KEY } from "../../apps/functions/src/expo/powerNowConfirmation";
import {
  LEAD_ERROR_MESSAGES,
  leadsSubmitUrl,
  outcomeForStatus,
  submitLeadRequest,
} from "../../apps/web/src/lib/earlyAccessLead";

const read = (path: string) => readFileSync(path, "utf8");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function assessment(overrides: { valid?: boolean; action?: string; hostname?: string; score?: number } = {}) {
  return {
    tokenProperties: {
      valid: overrides.valid ?? true,
      action: overrides.action ?? "early_access",
      hostname: overrides.hostname ?? "hi-coworking.com",
    },
    riskAnalysis: { score: overrides.score ?? 0.9 },
  };
}

const enterpriseBody = { recaptchaToken: "tok", recaptchaProvider: "enterprise", type: "early_access" };

describe("Coming Soon lead endpoint (web)", () => {
  it("defaults to the hi-coworking-plat function, not the retired ops project", () => {
    expect(leadsSubmitUrl({})).toBe("https://us-central1-hi-coworking-plat.cloudfunctions.net/leads_submitLead");
    expect(leadsSubmitUrl({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hi-coworking-plat" })).toBe(
      "https://us-central1-hi-coworking-plat.cloudfunctions.net/leads_submitLead",
    );
    expect(leadsSubmitUrl({ NEXT_PUBLIC_LEADS_SUBMIT_URL: " https://example.test/lead " })).toBe(
      "https://example.test/lead",
    );
    const source = read("apps/web/src/components/ComingSoonExperience.tsx");
    expect(source).not.toContain("hi-coworking-ops");
    expect(source).not.toContain("recaptcha/api.js");
    expect(source).not.toContain("NEXT_PUBLIC_RECAPTCHA_SITE_KEY");
    expect(source).toContain("process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID");
    expect(source).toContain("enterpriseRecaptchaToken");
  });

  it("sends an Enterprise token with the matching action", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "success", id: "x" }));
    const getToken = vi.fn(async () => "token-123");
    const outcome = await submitLeadRequest(
      { type: "survey", name: "Survey Respondent", email: "anonymous@survey.local" },
      { url: "https://lead.test", fetchImpl: fetchImpl as unknown as typeof fetch, getToken },
    );
    expect(outcome).toEqual({ ok: true });
    expect(getToken).toHaveBeenCalledWith("survey");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      recaptchaToken: "token-123",
      recaptchaProvider: "enterprise",
      recaptchaAction: "survey",
      type: "survey",
    });
  });

  it("does not post without a token and reports a spam-check failure", async () => {
    const fetchImpl = vi.fn();
    const outcome = await submitLeadRequest(
      { type: "early_access", name: "A", email: "a@example.test" },
      { url: "https://lead.test", fetchImpl: fetchImpl as unknown as typeof fetch, getToken: async () => "" },
    );
    expect(outcome).toEqual({ ok: false, reason: "spam_check" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps statuses and network failures to visitor messages", async () => {
    expect(outcomeForStatus(200)).toEqual({ ok: true });
    expect(outcomeForStatus(400)).toEqual({ ok: false, reason: "invalid" });
    expect(outcomeForStatus(403)).toEqual({ ok: false, reason: "spam_check" });
    expect(outcomeForStatus(404)).toEqual({ ok: false, reason: "server" });
    expect(outcomeForStatus(503)).toEqual({ ok: false, reason: "server" });
    const outcome = await submitLeadRequest(
      { type: "early_access" },
      {
        url: "https://lead.test",
        fetchImpl: (async () => {
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch,
        getToken: async () => "t",
      },
    );
    expect(outcome).toEqual({ ok: false, reason: "network" });
    for (const message of Object.values(LEAD_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/error code|exception|undefined/i);
    }
  });

  it("announces errors and success accessibly and keeps typed values", () => {
    const source = read("apps/web/src/components/ComingSoonExperience.tsx");
    expect(source).toContain('role="alert"');
    expect(source).toContain('role="status"');
    expect(source).toContain("errorRef.current?.focus()");
    expect(source).toContain("successRef.current?.focus()");
    expect(source).toContain('aria-describedby={formStatus === "error" ? "early-access-error" : undefined}');
    expect(source).toContain("htmlFor={id}");
    expect(source).toContain('htmlFor="early-access-message"');
    expect(source).toContain('aria-label="Close survey"');
    expect(source).toContain("setSurveyError(LEAD_ERROR_MESSAGES[outcome.reason])");
    // The form is not reset on failure.
    const failureBranch = source.slice(source.indexOf("if (outcome.ok) {"), source.indexOf('setFormStatus("error")'));
    expect(failureBranch).not.toContain("setFormData");
  });
});

describe("leads_submitLead reCAPTCHA (functions)", () => {
  const legacySecret = () => "legacy-secret";

  it("uses the same public Enterprise site key as the web build", () => {
    expect(POWER_NOW_RECAPTCHA_SITE_KEY).toBe(RECAPTCHA_ENTERPRISE_PUBLIC_SITE_KEY);
    expect(read("apps/web/.env.production")).toContain(
      `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=${RECAPTCHA_ENTERPRISE_PUBLIC_SITE_KEY}`,
    );
  });

  it("accepts a valid Enterprise assessment using a bearer token, not an API key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, assessment()));
    const verdict = await verifyLeadRecaptcha({
      body: enterpriseBody,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => "sa-token",
      legacySecret,
      env: {},
    });
    expect(verdict).toEqual({ ok: true, score: 0.9, provider: "enterprise" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://recaptchaenterprise.googleapis.com/v1/projects/hi-coworking-plat/assessments");
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sa-token");
    expect(JSON.parse(String(init.body))).toEqual({
      event: { token: "tok", siteKey: RECAPTCHA_ENTERPRISE_PUBLIC_SITE_KEY, expectedAction: "early_access" },
    });
  });

  it.each([
    [{ valid: false }, "invalid_token"],
    [{ action: "power_now_submit" }, "action_mismatch"],
    [{ hostname: "evil.example" }, "host_not_allowed"],
    [{ score: LEAD_RECAPTCHA_MIN_SCORE - 0.1 }, "low_score"],
  ] as const)("rejects %o as %s with a 403", async (overrides, reason) => {
    const verdict = await verifyLeadRecaptcha({
      body: enterpriseBody,
      fetchImpl: (async () => jsonResponse(200, assessment(overrides))) as unknown as typeof fetch,
      getAccessToken: async () => "sa-token",
      legacySecret,
      env: {},
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe(reason);
      expect(leadCaptchaFailureResponse(verdict).status).toBe(403);
    }
  });

  it("requires the survey action for survey submissions", async () => {
    expect(leadRecaptchaAction("survey")).toBe("survey");
    expect(leadRecaptchaAction(undefined)).toBe("early_access");
    const verdict = await verifyLeadRecaptcha({
      body: { ...enterpriseBody, type: "survey" },
      fetchImpl: (async () => jsonResponse(200, assessment({ action: "early_access" }))) as unknown as typeof fetch,
      getAccessToken: async () => "sa-token",
      legacySecret,
      env: {},
    });
    expect(verdict).toMatchObject({ ok: false, reason: "action_mismatch" });
  });

  it("returns 400 for a missing token and 503 when Google cannot be reached", async () => {
    const missing = await verifyLeadRecaptcha({
      body: { recaptchaProvider: "enterprise" },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      getAccessToken: async () => "sa-token",
      legacySecret,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(leadCaptchaFailureResponse(missing)).toEqual({ status: 400, error: "reCAPTCHA token is required" });

    const down = await verifyLeadRecaptcha({
      body: enterpriseBody,
      fetchImpl: (async () => jsonResponse(500, {})) as unknown as typeof fetch,
      getAccessToken: async () => "sa-token",
      legacySecret,
      env: {},
    });
    expect(down).toMatchObject({ ok: false, reason: "verify_unavailable" });
    if (!down.ok) expect(leadCaptchaFailureResponse(down).status).toBe(503);

    const noCredential = await verifyLeadRecaptcha({
      body: enterpriseBody,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      getAccessToken: async () => {
        throw new Error("no ADC");
      },
      legacySecret,
      env: {},
    });
    expect(noCredential).toMatchObject({ ok: false, reason: "unconfigured" });
  });

  it("keeps legacy v3 tokens working through siteverify", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true, score: 0.7 }));
    const verdict = await verifyLeadRecaptcha({
      body: { recaptchaToken: "v3-token" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => "unused",
      legacySecret,
    });
    expect(verdict).toEqual({ ok: true, score: 0.7, provider: "v3" });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://www.google.com/recaptcha/api/siteverify");
  });

  it("allows only Hi Coworking hosts", () => {
    expect([...LEAD_RECAPTCHA_HOSTS]).toEqual(["hi-coworking.com", "www.hi-coworking.com", "hi-coworking-plat.web.app"]);
  });

  it("does not log visitor email or name from the lead functions", () => {
    const source = read("apps/functions/src/index.ts");
    const start = source.indexOf("export const leads_submitLead");
    const end = source.indexOf("export const leads_submitContact");
    const leadsSection = source.slice(start, end);
    expect(leadsSection).toContain("verifyLeadRecaptcha");
    expect(leadsSection).not.toMatch(/logger\.\w+\([^)]*email/s);
    expect(leadsSection).not.toMatch(/logger\.\w+\([^)]*lead\.name/s);
    expect(leadsSection).not.toMatch(/logger\.\w+\([^)]*body\.name/s);
  });
});
