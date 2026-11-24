/**
 * Guest checkout screening (renter screening, Nov 2026).
 *
 * Pure module (no Firebase imports) shared by booking_beginCheckout and the
 * /book guest form. A signed-out guest must give a phone number, a business
 * name (or "None / independent"), a one-line answer on what they'll use the
 * space for, and tick the Terms checkbox.
 *
 * Business use only, the same questions for everyone. No personal traits, no
 * ID image and no ID number.
 *
 * TODO(jonathan-copy): the checkbox currently covers the existing Terms of
 * Service and Privacy Policy (HC-TERMS-v1). When Jonathan approves the house
 * rules and member agreement wording, bump HI_TERMS_VERSION in
 * termsCompliance.ts (or add HOUSE_RULES_VERSION / MEMBER_AGREEMENT_VERSION)
 * and update GUEST_TERMS_TEXT here and in the /book form together.
 */
import { BUSINESS_LIMITS, INDEPENDENT_LABEL } from "./businessProfile";
import {
  GUEST_CHECKOUT_TERMS_SOURCE,
  HI_TERMS_TEXT,
  HI_TERMS_VERSION,
  type TermsAcceptanceRecord,
} from "./termsCompliance";

export const INTENDED_USE_MAX = 140;

/** What the guest ticks at checkout. Same wording as sign-up until final copy lands. */
export const GUEST_TERMS_TEXT = HI_TERMS_TEXT;

export type GuestScreeningInput = {
  phone?: unknown;
  businessName?: unknown;
  isIndependent?: unknown;
  intendedUse?: unknown;
  termsAccepted?: unknown;
  termsVersion?: unknown;
};

export type GuestScreening = {
  /** E.164 US number. */
  phone: string;
  /** Business name, or "" when isIndependent is true. */
  businessName: string;
  isIndependent: boolean;
  intendedUse: string;
  termsAcceptance: TermsAcceptanceRecord;
};

export type GuestScreeningResult =
  | { ok: true; value: GuestScreening }
  | { ok: false; field: "phone" | "businessName" | "intendedUse" | "terms"; message: string; code?: "stale-terms" };

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

export function normalizeUsPhone(raw: unknown): string | null {
  const digits = clean(raw).replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length === 10 ? `+1${national}` : null;
}

export function validateGuestScreening(input: GuestScreeningInput | null | undefined, now: number): GuestScreeningResult {
  const data = input || {};
  const phone = normalizeUsPhone(data.phone);
  if (!phone) return { ok: false, field: "phone", message: "Enter a 10-digit phone number." };

  const isIndependent = data.isIndependent === true;
  const businessName = isIndependent ? "" : clean(data.businessName);
  if (!isIndependent && !businessName) {
    return { ok: false, field: "businessName", message: `Enter your business name, or choose "${INDEPENDENT_LABEL}".` };
  }
  if (businessName.length > BUSINESS_LIMITS.company) {
    return { ok: false, field: "businessName", message: "Use a shorter business name." };
  }

  const intendedUse = clean(data.intendedUse);
  if (!intendedUse) return { ok: false, field: "intendedUse", message: "Tell us in one line what you'll use the space for." };
  if (intendedUse.length > INTENDED_USE_MAX) {
    return { ok: false, field: "intendedUse", message: `Keep it to one line (${INTENDED_USE_MAX} characters).` };
  }

  if (data.termsAccepted !== true) {
    return { ok: false, field: "terms", message: "Please agree to the Terms of Service and Privacy Policy to book." };
  }
  if (data.termsVersion !== HI_TERMS_VERSION) {
    return { ok: false, field: "terms", code: "stale-terms", message: "Please reload the page and try again." };
  }

  return {
    ok: true,
    value: {
      phone,
      businessName,
      isIndependent,
      intendedUse,
      termsAcceptance: {
        version: HI_TERMS_VERSION,
        text: GUEST_TERMS_TEXT,
        source: GUEST_CHECKOUT_TERMS_SOURCE,
        acceptedAt: now,
      },
    },
  };
}
