/**
 * Pure helpers for public lead capture and Nurture enrollment.
 *
 * Kept free of firebase-admin so tests can import them directly.
 */

/** Address the Coming Soon survey used to send before it had an email field. */
export const LEGACY_ANONYMOUS_SURVEY_EMAIL = "anonymous@survey.local";

/** Domain suffixes that can never receive mail (RFC 2606 / 6761 / 6762). */
export const RESERVED_EMAIL_SUFFIXES = [".local", ".localhost", ".invalid", ".test", ".example"] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LeadType = "early_access" | "survey";

export function normalizeLeadEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isWellFormedEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export function isReservedEmailDomain(email: string): boolean {
  const domain = email.split("@").pop() ?? "";
  return RESERVED_EMAIL_SUFFIXES.some((suffix) => domain === suffix.slice(1) || domain.endsWith(suffix));
}

/** True only for an address Nurture may actually email. */
export function isDeliverableLeadEmail(value: unknown): boolean {
  const email = normalizeLeadEmail(value);
  return email !== "" && isWellFormedEmail(email) && !isReservedEmailDomain(email);
}

export type LeadEnrollmentDecision =
  | { enroll: true; email: string }
  | { enroll: false; reason: "exempt" | "no_email" | "undeliverable" };

/**
 * Whether a new leads/{id} document should start a Nurture sequence.
 * Leads marked nurtureExempt (for example quiet imports) never enroll.
 */
export function leadEnrollmentDecision(data: Record<string, unknown> | undefined): LeadEnrollmentDecision {
  if (!data) return { enroll: false, reason: "no_email" };
  if (data.nurtureExempt === true) return { enroll: false, reason: "exempt" };
  const email = normalizeLeadEmail(data.email);
  if (!email) return { enroll: false, reason: "no_email" };
  if (!isDeliverableLeadEmail(email)) return { enroll: false, reason: "undeliverable" };
  return { enroll: true, email };
}

export type ParsedLeadSubmission =
  | { ok: true; type: LeadType; name: string; email: string }
  | { ok: false; error: string };

/**
 * Validates the contact fields of a Coming Soon submission.
 * Early Access needs a name and a real email. A survey may be anonymous:
 * no email (or the legacy placeholder) is stored as an empty email, and a
 * supplied email must be a real, deliverable address.
 */
export function parseLeadSubmission(body: Record<string, unknown> | undefined): ParsedLeadSubmission {
  const input = body ?? {};
  const type: LeadType = input.type === "survey" ? "survey" : "early_access";
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
  let email = normalizeLeadEmail(input.email);

  if (type === "survey") {
    if (email === LEGACY_ANONYMOUS_SURVEY_EMAIL) email = "";
    if (email && !isDeliverableLeadEmail(email)) return { ok: false, error: "Enter a valid email address or leave it blank" };
    const cleanName = name === "Survey Respondent" ? "" : name;
    return { ok: true, type, name: cleanName, email };
  }

  if (!name || !email) return { ok: false, error: "name and email are required" };
  if (!isDeliverableLeadEmail(email)) return { ok: false, error: "A valid email address is required" };
  return { ok: true, type, name, email };
}
