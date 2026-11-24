import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EARLY_ACCESS_CONSENT_VERSION,
  LEAD_MARKETING_CONSENT_TEXT,
  SURVEY_EMAIL_CONSENT_VERSION,
  leadEnrollmentDecision,
  leadMarketingConsent,
} from "../../apps/functions/src/leadContact";
import {
  EARLY_ACCESS_CONSENT_TEXT as WEB_EARLY_ACCESS_TEXT,
  EARLY_ACCESS_CONSENT_VERSION as WEB_EARLY_ACCESS_VERSION,
  SURVEY_EMAIL_CONSENT_TEXT as WEB_SURVEY_TEXT,
  SURVEY_EMAIL_CONSENT_VERSION as WEB_SURVEY_VERSION,
} from "../../apps/web/src/lib/earlyAccessLead";

const read = (path: string) => readFileSync(path, "utf8");
const NOW = 1_795_000_000_000;
const earlyAccess = { type: "early_access" as const, email: "person@example.com" };

describe("Early Access marketing consent is affirmative", () => {
  it("records no consent unless the visitor explicitly opted in", () => {
    const none = {
      marketingConsent: false,
      marketingConsentAt: null,
      marketingConsentVersion: null,
      marketingConsentText: null,
    };
    expect(leadMarketingConsent({}, earlyAccess, NOW)).toEqual(none);
    expect(leadMarketingConsent({ intent: "updates" }, earlyAccess, NOW)).toEqual(none);
    expect(leadMarketingConsent({ marketingConsent: "true", consentVersion: EARLY_ACCESS_CONSENT_VERSION }, earlyAccess, NOW)).toEqual(none);
    expect(leadMarketingConsent({ marketingConsent: true }, earlyAccess, NOW)).toEqual(none);
    expect(leadMarketingConsent({ marketingConsent: true, consentVersion: "made-up" }, earlyAccess, NOW)).toEqual(none);
    expect(leadMarketingConsent({ marketingConsent: true, consentVersion: SURVEY_EMAIL_CONSENT_VERSION }, earlyAccess, NOW)).toEqual(none);
    expect(leadMarketingConsent(
      { marketingConsent: true, consentVersion: SURVEY_EMAIL_CONSENT_VERSION },
      { type: "survey", email: "" },
      NOW,
    )).toEqual(none);
  });

  it("stores the server's canonical text, version and timestamp on opt-in", () => {
    expect(leadMarketingConsent(
      { marketingConsent: true, consentVersion: EARLY_ACCESS_CONSENT_VERSION, consentText: "Anything the browser says" },
      earlyAccess,
      NOW,
    )).toEqual({
      marketingConsent: true,
      marketingConsentAt: NOW,
      marketingConsentVersion: EARLY_ACCESS_CONSENT_VERSION,
      marketingConsentText: LEAD_MARKETING_CONSENT_TEXT[EARLY_ACCESS_CONSENT_VERSION],
    });
    expect(leadMarketingConsent(
      { marketingConsent: true, consentVersion: SURVEY_EMAIL_CONSENT_VERSION },
      { type: "survey", email: "person@example.com" },
      NOW,
    )).toMatchObject({ marketingConsent: true, marketingConsentVersion: SURVEY_EMAIL_CONSENT_VERSION });
  });

  it("keeps the web wording and versions identical to the server's record", () => {
    expect(WEB_EARLY_ACCESS_VERSION).toBe(EARLY_ACCESS_CONSENT_VERSION);
    expect(WEB_SURVEY_VERSION).toBe(SURVEY_EMAIL_CONSENT_VERSION);
    expect(WEB_EARLY_ACCESS_TEXT).toBe(LEAD_MARKETING_CONSENT_TEXT[EARLY_ACCESS_CONSENT_VERSION]);
    expect(WEB_SURVEY_TEXT).toBe(LEAD_MARKETING_CONSENT_TEXT[SURVEY_EMAIL_CONSENT_VERSION]);
  });

  it("Nurture enrolls only leads with recorded consent", () => {
    expect(leadEnrollmentDecision({ email: "person@example.com" })).toEqual({ enroll: false, reason: "no_consent" });
    expect(leadEnrollmentDecision({ email: "person@example.com", marketingConsent: false })).toEqual({ enroll: false, reason: "no_consent" });
    expect(leadEnrollmentDecision({ email: "person@example.com", marketingConsent: "yes" })).toEqual({ enroll: false, reason: "no_consent" });
    expect(leadEnrollmentDecision({ email: "person@example.com", marketingConsent: true })).toEqual({ enroll: true, email: "person@example.com" });
    expect(leadEnrollmentDecision({ email: "person@example.com", marketingConsent: true, nurtureExempt: true }))
      .toEqual({ enroll: false, reason: "exempt" });
  });

  it("leads_submitLead records consent and staff alerts do not depend on it", () => {
    const source = read("apps/functions/src/index.ts");
    expect(source).toContain("...leadMarketingConsent(body, parsed, createdAt)");
    const alert = source.slice(source.indexOf("export const leads_onNewLead"), source.indexOf("export const leads_submitContact"));
    expect(alert).toContain("sendLeadAlert(");
    expect(alert).not.toContain("marketingConsent");
    expect(source).not.toMatch(/Contact form lead created", \{[^}]*email/);
  });
});

describe("Coming Soon Early Access form", () => {
  const source = read("apps/web/src/components/ComingSoonExperience.tsx");

  it("does not pre-select launch updates", () => {
    expect(source).not.toContain('intent: "updates",\n    interests');
    expect(source).toMatch(/intent: "",\s*\n\s*interests: \[\] as string\[\],\s*\n\s*marketingConsent: false,/);
  });

  it("shows an unchecked, labelled opt-in and sends consent only when ticked", () => {
    expect(source).toContain('id="early-access-consent"');
    expect(source).toContain('htmlFor="early-access-consent"');
    expect(source).toContain("checked={formData.marketingConsent}");
    expect(source).toContain("{EARLY_ACCESS_CONSENT_TEXT}");
    expect(source).toContain("...(marketingConsent ? { marketingConsent: true, consentVersion: EARLY_ACCESS_CONSENT_VERSION } : {})");
  });

  it("survey consent rides only with an entered email", () => {
    expect(source).toContain("...(email ? { marketingConsent: true, consentVersion: SURVEY_EMAIL_CONSENT_VERSION } : {})");
    expect(source).toContain("{SURVEY_EMAIL_CONSENT_TEXT}");
  });
});
