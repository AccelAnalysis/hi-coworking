import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEGACY_ANONYMOUS_SURVEY_EMAIL,
  isDeliverableLeadEmail,
  leadEnrollmentDecision,
  parseLeadSubmission,
} from "../../apps/functions/src/leadContact";

const read = (path: string) => readFileSync(path, "utf8");

describe("survey email is optional (leads_submitLead)", () => {
  it("accepts a survey with no name or email and stores an empty email", () => {
    expect(parseLeadSubmission({ type: "survey", answers: { 1: "From home" } })).toEqual({
      ok: true,
      type: "survey",
      name: "",
      email: "",
    });
  });

  it("drops the legacy placeholder address instead of storing it", () => {
    const parsed = parseLeadSubmission({
      type: "survey",
      name: "Survey Respondent",
      email: LEGACY_ANONYMOUS_SURVEY_EMAIL,
    });
    expect(parsed).toEqual({ ok: true, type: "survey", name: "", email: "" });
  });

  it("keeps a real survey email, normalized", () => {
    expect(parseLeadSubmission({ type: "survey", email: "  Person@Example.COM " })).toEqual({
      ok: true,
      type: "survey",
      name: "",
      email: "person@example.com",
    });
  });

  it("rejects a malformed or reserved survey email", () => {
    expect(parseLeadSubmission({ type: "survey", email: "not-an-email" }).ok).toBe(false);
    expect(parseLeadSubmission({ type: "survey", email: "someone@office.local" }).ok).toBe(false);
  });

  it("still requires name and a real email for Early Access", () => {
    expect(parseLeadSubmission({ type: "early_access", email: "a@b.co" }).ok).toBe(false);
    expect(parseLeadSubmission({ type: "early_access", name: "A" }).ok).toBe(false);
    expect(parseLeadSubmission({ name: "A", email: "a@survey.local" }).ok).toBe(false);
    expect(parseLeadSubmission({ name: " A ", email: "A@B.co" })).toEqual({
      ok: true,
      type: "early_access",
      name: "A",
      email: "a@b.co",
    });
  });

  it("is wired into leads_submitLead", () => {
    const source = read("apps/functions/src/index.ts");
    expect(source).toContain("parseLeadSubmission(body)");
    expect(source).not.toContain('if (!body.email || !body.name)');
    expect(source).toMatch(/email: parsed\.email/);
  });
});

describe("Nurture skips leads without a deliverable email", () => {
  it("skips missing, empty and .local addresses", () => {
    expect(leadEnrollmentDecision({ type: "survey" })).toEqual({ enroll: false, reason: "no_email" });
    expect(leadEnrollmentDecision({ email: "" })).toEqual({ enroll: false, reason: "no_email" });
    expect(leadEnrollmentDecision({ email: LEGACY_ANONYMOUS_SURVEY_EMAIL })).toEqual({
      enroll: false,
      reason: "undeliverable",
    });
    expect(leadEnrollmentDecision({ email: "x@host.localhost" }).enroll).toBe(false);
    expect(leadEnrollmentDecision({ email: "x@domain.test" }).enroll).toBe(false);
    expect(leadEnrollmentDecision({ email: "x@local" }).enroll).toBe(false);
  });

  it("skips quiet imports marked nurtureExempt even with a real email", () => {
    expect(leadEnrollmentDecision({ email: "a@b.co", nurtureExempt: true })).toEqual({
      enroll: false,
      reason: "exempt",
    });
  });

  it("enrolls a real address", () => {
    expect(leadEnrollmentDecision({ email: " A@B.co " })).toEqual({ enroll: true, email: "a@b.co" });
    expect(isDeliverableLeadEmail("someone@hi-coworking.com")).toBe(true);
    expect(isDeliverableLeadEmail("someone@survey.local")).toBe(false);
  });

  it("nurture_onLeadCreated uses the decision and every path rejects reserved domains", () => {
    const source = read("apps/functions/src/nurture.ts");
    const trigger = source.slice(source.indexOf("export const nurture_onLeadCreated"));
    expect(trigger.slice(0, 900)).toContain("leadEnrollmentDecision(data)");
    expect(source).toMatch(/function isValidEmail\(value: string\) \{\s*return isDeliverableLeadEmail\(value\);/);
  });
});

describe("Coming Soon survey form", () => {
  const source = read("apps/web/src/components/ComingSoonExperience.tsx");

  it("never sends a placeholder identity", () => {
    expect(source).not.toContain("anonymous@survey.local");
    expect(source).not.toContain('"Survey Respondent"');
  });

  it("offers a labelled, optional email field and only sends it when filled", () => {
    expect(source).toContain('htmlFor="survey-email"');
    expect(source).toContain("(optional)");
    expect(source).toContain("...(email ? { email } : {})");
  });
});
