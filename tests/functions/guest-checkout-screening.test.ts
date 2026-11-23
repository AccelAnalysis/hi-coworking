import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GUEST_TERMS_TEXT,
  INTENDED_USE_MAX,
  normalizeUsPhone,
  validateGuestScreening,
} from "../../apps/functions/src/providers/guestCheckoutScreening";
import {
  CALLABLE_TERMS_SOURCES,
  GUEST_CHECKOUT_TERMS_SOURCE,
  HI_TERMS_TEXT,
  HI_TERMS_VERSION,
  TERMS_ACCEPTANCE_SOURCES,
} from "../../apps/functions/src/providers/termsCompliance";
import { buildTermsAcceptance } from "../../apps/functions/src/eventsV2/termsAcceptance";

const read = (path: string) => readFileSync(path, "utf8");
const VALID = {
  phone: "(555) 010-0199",
  businessName: "  Sample  Studio ",
  isIndependent: false,
  intendedUse: "  Client calls and quiet work ",
  termsAccepted: true,
  termsVersion: HI_TERMS_VERSION,
};

describe("guest checkout screening rules", () => {
  it("normalizes a complete guest and builds a guest-checkout Terms record", () => {
    expect(validateGuestScreening(VALID, 42)).toEqual({
      ok: true,
      value: {
        phone: "+15550100199",
        businessName: "Sample Studio",
        isIndependent: false,
        intendedUse: "Client calls and quiet work",
        termsAcceptance: { version: HI_TERMS_VERSION, text: HI_TERMS_TEXT, source: "guest-checkout", acceptedAt: 42 },
      },
    });
  });

  it("requires a 10-digit phone", () => {
    expect(validateGuestScreening({ ...VALID, phone: "" }, 1)).toMatchObject({ ok: false, field: "phone" });
    expect(validateGuestScreening({ ...VALID, phone: "555-0100" }, 1)).toMatchObject({ ok: false, field: "phone" });
    expect(normalizeUsPhone("1 555 010 0199")).toBe("+15550100199");
  });

  it("requires a business name unless None / independent is chosen", () => {
    expect(validateGuestScreening({ ...VALID, businessName: "" }, 1)).toMatchObject({ ok: false, field: "businessName" });
    const independent = validateGuestScreening({ ...VALID, businessName: "ignored", isIndependent: true }, 1);
    expect(independent.ok && independent.value).toMatchObject({ businessName: "", isIndependent: true });
    expect(validateGuestScreening({ ...VALID, businessName: "x".repeat(121) }, 1)).toMatchObject({ ok: false, field: "businessName" });
  });

  it("requires a one-line intended use", () => {
    expect(validateGuestScreening({ ...VALID, intendedUse: " " }, 1)).toMatchObject({ ok: false, field: "intendedUse" });
    expect(validateGuestScreening({ ...VALID, intendedUse: "x".repeat(INTENDED_USE_MAX + 1) }, 1)).toMatchObject({ ok: false, field: "intendedUse" });
  });

  it("requires the Terms checkbox at the current version", () => {
    expect(validateGuestScreening({ ...VALID, termsAccepted: false }, 1)).toMatchObject({ ok: false, field: "terms" });
    expect(validateGuestScreening({ ...VALID, termsAccepted: "true" }, 1)).toMatchObject({ ok: false, field: "terms" });
    expect(validateGuestScreening({ ...VALID, termsVersion: "HC-TERMS-v0" }, 1)).toMatchObject({ ok: false, field: "terms", code: "stale-terms" });
    expect(GUEST_TERMS_TEXT).toBe(HI_TERMS_TEXT);
  });

  it("asks about business use only", () => {
    const code = read("apps/functions/src/providers/guestCheckoutScreening.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(age|birth|dob|gender|race|religion|nationality|ssn|license|passport|idNumber|idImage)\b/i);
  });
});

describe("Terms sources", () => {
  it("adds guest-checkout but keeps members_acceptTerms on member-signup only", () => {
    expect([...TERMS_ACCEPTANCE_SOURCES]).toEqual(["member-signup", "guest-checkout"]);
    expect(GUEST_CHECKOUT_TERMS_SOURCE).toBe("guest-checkout");
    expect([...CALLABLE_TERMS_SOURCES]).toEqual(["member-signup"]);
    expect(() => buildTermsAcceptance({ accepted: true, version: HI_TERMS_VERSION, source: "guest-checkout" }, 1)).toThrow(/Unknown acceptance source/);
  });
});

describe("booking_beginCheckout and finalize wiring", () => {
  const source = read("apps/functions/src/bookingFlexTransaction.ts");

  it("validates signed-out guests before quoting or holding a seat", () => {
    const body = source.slice(source.indexOf("export const booking_beginCheckout"));
    const validateAt = body.indexOf("validateGuestScreening(guest, Date.now())");
    expect(validateAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(body.indexOf("validateWindow(start, end)"));
    expect(validateAt).toBeLessThan(body.indexOf("createHoldAtomically("));
    expect(body).toMatch(/if \(!request\.auth\) \{\s*const checked = validateGuestScreening/);
  });

  it("stores screening answers and Terms on the hold for guests only", () => {
    expect(source).toContain("businessName: screening?.businessName ?? \"\",");
    expect(source).toContain("intendedUse: screening?.intendedUse ?? \"\",");
    expect(source).toContain("termsAcceptance: authenticatedUid ? null : screening?.termsAcceptance ?? null,");
  });

  it("copies to users/accountDetails only for accounts checkout just created (merges cleanly with PR #66)", () => {
    const helper = source.slice(source.indexOf("async function recordGuestScreening"), source.indexOf("async function issueAccessSafely"));
    expect(helper).toMatch(/if \(accountCreated\) \{[\s\S]*collection\("users"\)[\s\S]*collection\("accountDetails"\)/);
    expect(helper.indexOf('collection("bookings")')).toBeLessThan(helper.indexOf("if (accountCreated)"));
    expect(helper).toContain("{ merge: true }");
    // Logs carry the booking id only, never the guest's contact details.
    expect(helper).not.toMatch(/logger\.[a-z]+\([^)]*(email|phone|businessName|intendedUse)/);
    const finalize = source.slice(source.indexOf("export const booking_finalizeCheckout"));
    expect(finalize).toContain("await recordGuestScreening(hold, result.bookingId, guestAccount.uid, guestAccount.created);");
  });

  it("leaves ensureGuestAccount untouched so PR #66 applies without conflicts", () => {
    const fn = source.slice(source.indexOf("async function ensureGuestAccount"), source.indexOf("/**\n * Copies the guest's screening"));
    expect(fn).not.toMatch(/screening|termsAcceptance|businessName|intendedUse/);
  });

  it("does not touch Stripe pricing or door access for screening", () => {
    const helper = source.slice(source.indexOf("async function recordGuestScreening"), source.indexOf("async function issueAccessSafely"));
    expect(helper).not.toMatch(/createAccessGrant|StripeProvider|price/i);
  });
});

describe("/book guest form", () => {
  const form = read("apps/web/src/components/BookingExperienceWithDeskChange.tsx");

  it("requires phone, business name (or None / independent), intended use and the Terms checkbox", () => {
    expect(form).toMatch(/type="tel"[\s\S]{0,400}required/);
    expect(form).not.toContain("Phone <span className=\"font-normal text-slate-500\">(optional)</span>");
    expect(form).toContain("{INDEPENDENT_LABEL}");
    expect(form).toContain("What will you use the space for?");
    expect(form).toMatch(/id="guest-terms-acceptance"\s+type="checkbox"\s+required/);
    expect(form).toContain("<Link href={TERMS_PATH}");
    expect(form).toContain("<Link href={PRIVACY_PATH}");
    expect(form).toContain("disabled={checkingOut || authLoading || (!user && !guestTermsAccepted)}");
  });

  it("validates with the shared rules and sends the current terms version", () => {
    expect(form).toContain("validateGuestScreening({");
    expect(form).toContain("termsVersion: HI_TERMS_VERSION,");
    expect(form).toContain("TODO(jonathan-copy)");
  });

  it("keeps 44px targets and labelled inputs", () => {
    expect(form).toContain("min-h-11");
    expect(form).toContain('htmlFor="guest-business-name"');
    expect(form).toContain('htmlFor="guest-terms-acceptance"');
  });
});
