/**
 * Terms of Service and Privacy Policy acceptance (sign-up clickwrap).
 *
 * Shared by the /register page and the members_acceptTerms callable, so the
 * wording the member sees and the version the server records cannot drift.
 * Bump HI_TERMS_VERSION whenever /terms or /privacy changes in a way members
 * must accept again.
 */
export const HI_TERMS_VERSION = "HC-TERMS-v1";
export const HI_TERMS_TEXT = "I agree to the Terms of Service and Privacy Policy.";
export const TERMS_PATH = "/terms";
export const PRIVACY_PATH = "/privacy";

export const TERMS_ACCEPTANCE_SOURCES = ["member-signup"] as const;
export type TermsAcceptanceSource = (typeof TERMS_ACCEPTANCE_SOURCES)[number];

export type TermsAcceptanceRecord = {
  version: string;
  text: string;
  source: TermsAcceptanceSource;
  /** Server time (ms since epoch) when the callable recorded acceptance. */
  acceptedAt: number;
};
