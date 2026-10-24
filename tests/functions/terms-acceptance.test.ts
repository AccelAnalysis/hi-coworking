import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildTermsAcceptance, termsAcceptanceUpdate } from "../../apps/functions/src/eventsV2/termsAcceptance";
import { HI_TERMS_TEXT, HI_TERMS_VERSION, PRIVACY_PATH, TERMS_PATH } from "../../apps/functions/src/providers/termsCompliance";

describe("terms acceptance record", () => {
  it("records version, wording, source and server time", () => {
    expect(HI_TERMS_VERSION).toBe("HC-TERMS-v1");
    expect(buildTermsAcceptance({ accepted: true, version: HI_TERMS_VERSION, source: "member-signup" }, 42)).toEqual({
      version: "HC-TERMS-v1",
      text: HI_TERMS_TEXT,
      source: "member-signup",
      acceptedAt: 42,
    });
  });

  it("rejects missing acceptance, an old version and unknown sources", () => {
    expect(() => buildTermsAcceptance({ version: HI_TERMS_VERSION, source: "member-signup" }, 1)).toThrow("accept");
    expect(() => buildTermsAcceptance({ accepted: "yes", version: HI_TERMS_VERSION, source: "member-signup" }, 1)).toThrow("accept");
    expect(() => buildTermsAcceptance({ accepted: true, version: "HC-TERMS-v0", source: "member-signup" }, 1)).toThrow("reload");
    expect(() => buildTermsAcceptance({ accepted: true, version: HI_TERMS_VERSION, source: "admin" }, 1)).toThrow("source");
  });

  it("writes termsAcceptance with merge so authProvisionOnCreate can still fill missing fields", () => {
    const record = buildTermsAcceptance({ accepted: true, version: HI_TERMS_VERSION, source: "member-signup" }, 7);
    const update = termsAcceptanceUpdate(record, "u1", 7);
    expect(update.termsAcceptance).toEqual(record);
    expect(update).not.toHaveProperty("role");
    expect(update).not.toHaveProperty("membershipStatus");
    expect(update).not.toHaveProperty("createdAt");
    const source = readFileSync("apps/functions/src/eventsV2/termsAcceptance.ts", "utf8");
    expect(source).toContain("{ merge: true }");
    expect(source).toContain("request.auth?.uid");
    expect(source).toContain("onCall(adminEventCallableOptions");
    const provisioning = readFileSync("apps/functions/src/authProvisioning.ts", "utf8");
    expect(provisioning).not.toContain("termsAcceptance");
  });

  it("keeps termsAcceptance out of member-writable fields", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    expect(rules).not.toContain("termsAcceptance");
  });
});

describe("register clickwrap", () => {
  const register = readFileSync("apps/web/src/app/register/page.tsx", "utf8");

  it("requires the terms checkbox, links Terms and Privacy, and blocks sign-up unchecked", () => {
    expect(register).toContain("const [termsAccepted, setTermsAccepted] = useState(false);");
    expect(register).toMatch(/id="terms-acceptance"\s+type="checkbox"\s+required/);
    expect(register).toContain("<Link href={TERMS_PATH}");
    expect(register).toContain("<Link href={PRIVACY_PATH}");
    expect(TERMS_PATH).toBe("/terms");
    expect(PRIVACY_PATH).toBe("/privacy");
    expect(register).toContain("if (!termsAccepted) {");
    expect(register).toContain("disabled={loading || !termsAccepted}");
    // Visible wording matches the recorded text.
    expect(register).toMatch(/I agree to the\{" "\}[\s\S]*Terms of Service[\s\S]*and\{" "\}[\s\S]*Privacy Policy[\s\S]*\./);
    expect(HI_TERMS_TEXT).toBe("I agree to the Terms of Service and Privacy Policy.");
  });

  it("records acceptance on the server before SMS consent, and leaves the SMS checkbox optional", () => {
    const termsAt = register.indexOf("await recordTermsAcceptance(HI_TERMS_VERSION);");
    const createAt = register.indexOf("createUserWithEmailAndPassword(");
    const smsAt = register.indexOf("setMemberSmsConsent(");
    expect(termsAt).toBeGreaterThan(createAt);
    expect(smsAt).toBeGreaterThan(termsAt);
    expect(register).toContain("<SmsConsentCheckbox checked={smsConsent} onChange={setSmsConsent} />");

    const lib = readFileSync("apps/web/src/lib/termsAcceptance.ts", "utf8");
    expect(lib).toContain('httpsCallable<AcceptTermsInput, AcceptTermsResult>(functions, "members_acceptTerms")');
    expect(lib).toContain('source: "member-signup"');
    expect(lib).toContain('from "../../../functions/src/providers/termsCompliance"');
  });

  it("deploys members_acceptTerms with the admin-event bundle and checks its CORS", () => {
    const index = readFileSync("firebase/admin-event-functions/src/index.ts", "utf8");
    expect(index).toContain('export { members_acceptTerms } from "../../../apps/functions/src/eventsV2/termsAcceptance";');
    const workflow = readFileSync(".github/workflows/firebase-live-admin-event-functions.yml", "utf8");
    expect(workflow).toContain("cloudfunctions.net/members_acceptTerms");
    expect(workflow).toContain('"${terms_endpoint}"');
    expect(workflow).toContain('- "apps/functions/src/providers/termsCompliance.ts"');
  });
});
