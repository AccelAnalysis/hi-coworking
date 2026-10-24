import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
}));

import {
  HI_SMS_CONSENT_TEXT,
  HI_SMS_CONSENT_VERSION,
  SMS_OPT_OUT_FOOTER,
  enforceSmsCompliance,
  hasSmsOptIn,
  normalizeUsMobile,
  smsEligibleRecipients,
} from "../../apps/functions/src/providers/smsCompliance";
import { SmsSendError, TwilioSmsProvider } from "../../apps/functions/src/providers/smsProvider";
import { recordSmsOptOuts } from "../../apps/functions/src/providers/smsOptOut";
import { renderSmsBody, type CampaignContext } from "../../apps/functions/src/providers/campaignRenderer";
import { buildMemberSmsConsent } from "../../apps/functions/src/eventsV2/memberSmsConsent";

const DOC_CONSENT =
  "I agree to receive event invitations, reminders and updates by text from Hi Coworking (Accel Analysis LLC). Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of membership or purchase. See SMS Terms and Privacy Policy.";

function footerCount(text: string) {
  return text.split("Reply STOP to opt out.").length - 1;
}

const ctx: CampaignContext = {
  eventTitle: "Power NOW Pitch Night",
  eventDate: "Thursday, November 5",
  eventLocation: "Carrollton, VA",
  eventUrl: "https://hi-coworking.com/events/detail?id=evt_1",
};

describe("SMS sender name and opt-out footer", () => {
  it("uses the registered consent wording verbatim", () => {
    expect(HI_SMS_CONSENT_TEXT).toBe(DOC_CONSENT);
    expect(HI_SMS_CONSENT_VERSION).toBe("HC-SMS-CONSENT-v1");
  });

  it("adds the sender name and footer when missing", () => {
    expect(enforceSmsCompliance("You're invited to Pitch Night!")).toBe(
      `Hi Coworking: You're invited to Pitch Night! ${SMS_OPT_OUT_FOOTER}`,
    );
  });

  it("does not duplicate a footer or sender name that is already there", () => {
    const body = `Hi Coworking: See you tonight. ${SMS_OPT_OUT_FOOTER}`;
    expect(enforceSmsCompliance(body)).toBe(body);
    expect(enforceSmsCompliance(enforceSmsCompliance("Hello"))).toBe(enforceSmsCompliance("Hello"));
    const lowerCase = "hi coworking: hello. reply stop to opt out. msg and data rates may apply.";
    const result = enforceSmsCompliance(lowerCase);
    expect(footerCount(result.toLowerCase().replace(/reply stop/g, "Reply STOP"))).toBe(1);
    expect(result.endsWith(SMS_OPT_OUT_FOOTER)).toBe(true);
  });

  it("moves a buried footer to the end", () => {
    const result = enforceSmsCompliance(`Hi Coworking: ${SMS_OPT_OUT_FOOTER} Doors open at 6.`);
    expect(result).toBe(`Hi Coworking: Doors open at 6. ${SMS_OPT_OUT_FOOTER}`);
  });

  it("applies to every campaign type, including admin overrides", () => {
    for (const type of ["announce", "reminder", "starting_soon", "follow_up"]) {
      const body = renderSmsBody(type, ctx);
      expect(body.startsWith("Hi Coworking")).toBe(true);
      expect(body.endsWith(SMS_OPT_OUT_FOOTER)).toBe(true);
      expect(footerCount(body)).toBe(1);
    }
    const override = renderSmsBody("announce", { ...ctx, copyVariants: { smsAnnounce: "Big night! Come by." } });
    expect(override).toBe(`Hi Coworking: Big night! Come by. ${SMS_OPT_OUT_FOOTER}`);
  });

  it("enforces the footer in the Twilio provider at send time", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    const provider = new TwilioSmsProvider("AC1", "token", "+17575550100", fetchImpl as unknown as typeof fetch);
    await provider.send({ to: "+17575550123", body: "Doors open at 6." });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const params = new URLSearchParams(String(init.body));
    expect(params.get("Body")).toBe(`Hi Coworking: Doors open at 6. ${SMS_OPT_OUT_FOOTER}`);
  });
});

describe("SMS consent gating at send time", () => {
  const recipients = [
    { uid: "a", email: "a@x.test", phone: "+17575550001", smsConsent: { optIn: true, phone: "(757) 555-0101" } },
    { uid: "b", email: "b@x.test", phone: "+17575550002" },
    { uid: "c", email: "c@x.test", phone: "+17575550003", smsConsent: { optIn: false, phone: "+17575550003" } },
    { uid: "d", email: "d@x.test", phone: "+17575550004", smsConsent: { optIn: true } },
    { uid: "e", email: "e@x.test", smsConsent: { optIn: true, phone: "+17575550101" } },
  ];

  it("texts only opted-in recipients, at the number they consented with", () => {
    const eligible = smsEligibleRecipients(recipients);
    expect(eligible.map((r) => r.uid)).toEqual(["a"]);
    expect(eligible[0].phone).toBe("+17575550101");
  });

  it("treats a profile phone without consent as not opted in", () => {
    expect(hasSmsOptIn(undefined)).toBe(false);
    expect(hasSmsOptIn({ optIn: "true", phone: "+17575550101" })).toBe(false);
    expect(hasSmsOptIn({ optIn: true, phone: "+17575550101" })).toBe(true);
  });

  it("routes every SMS job through the consent gate and the opt-out recorder", () => {
    const source = readFileSync("apps/functions/src/campaignJobs.ts", "utf8");
    expect(source).toContain("smsEligibleRecipients(recipients)");
    expect(source).toContain("recordSmsOptOuts(db, smsRecipients, result.optedOut)");
    expect(source).not.toContain("recipients.filter((r) => r.phone)");
    const resolver = readFileSync("apps/functions/src/providers/recipientResolver.ts", "utf8");
    expect(resolver).toContain("smsConsent: userData.smsConsent");
    expect(resolver).toContain("smsConsent: data.smsConsent");
    // Twilio is the only SMS path in Functions.
    const providers = readFileSync("apps/functions/src/providers/smsProvider.ts", "utf8");
    expect(providers).toContain('params.set("Body", enforceSmsCompliance(message.body))');
  });

  it("normalizes US mobile numbers", () => {
    expect(normalizeUsMobile("(757) 555-0101")).toBe("+17575550101");
    expect(normalizeUsMobile("1-757-555-0101")).toBe("+17575550101");
    expect(normalizeUsMobile("555-0101")).toBeNull();
  });
});

describe("Twilio 21610 opt-outs", () => {
  it("reports 21610 as an opted-out recipient", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const to = new URLSearchParams(String(init?.body)).get("To");
      if (to === "+17575550101") {
        return new Response(JSON.stringify({ code: 21610, message: "Attempt to send to unsubscribed recipient", status: 400 }), { status: 400 });
      }
      if (to === "+17575550102") {
        return new Response(JSON.stringify({ code: 21211, message: "Invalid To", status: 400 }), { status: 400 });
      }
      return new Response(JSON.stringify({ sid: "SM2" }), { status: 201 });
    });
    const provider = new TwilioSmsProvider("AC1", "token", "+17575550100", fetchImpl as unknown as typeof fetch);

    await expect(provider.send({ to: "+17575550101", body: "Hi" })).rejects.toMatchObject({ code: 21610, recipientOptedOut: true });
    const error = await provider.send({ to: "+17575550102", body: "Hi" }).catch((e) => e);
    expect(error).toBeInstanceOf(SmsSendError);
    expect(error.recipientOptedOut).toBe(false);

    const result = await provider.sendBatch([
      { to: "+17575550101", body: "Hi" },
      { to: "+17575550102", body: "Hi" },
      { to: "+17575550103", body: "Hi" },
    ]);
    expect(result).toEqual({ sent: 1, failed: 2, optedOut: ["+17575550101"] });
  });

  it("marks matching members as opted out", async () => {
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const db = {
      collection: (path: string) => {
        expect(path).toBe("users");
        return { doc: (id: string) => ({ update: async (data: Record<string, unknown>) => { updates.push({ id, data }); } }) };
      },
    };
    const updated = await recordSmsOptOuts(
      db,
      [
        { uid: "a", phone: "+17575550101" },
        { uid: "b", phone: "+17575550102" },
        { phone: "+17575550101" },
      ],
      ["(757) 555-0101"],
      1_000,
    );
    expect(updated).toEqual(["a"]);
    expect(updates).toEqual([{
      id: "a",
      data: {
        "smsConsent.optIn": false,
        "smsConsent.optedOutAt": 1_000,
        "smsConsent.optOutReason": "twilio-21610",
        "smsConsent.updatedAt": 1_000,
      },
    }]);
    expect(await recordSmsOptOuts(db, [{ uid: "a", phone: "+17575550101" }], [])).toEqual([]);
  });
});

describe("member SMS opt-in record", () => {
  it("stores timestamp, source, phone and consent version on opt-in", () => {
    const record = buildMemberSmsConsent({ optIn: true, phone: "757-555-0101", source: "member-signup", textVersion: HI_SMS_CONSENT_VERSION }, 42);
    expect(record).toEqual({
      optIn: true,
      phone: "+17575550101",
      source: "member-signup",
      textVersion: HI_SMS_CONSENT_VERSION,
      consentText: DOC_CONSENT,
      consentedAt: 42,
      updatedAt: 42,
    });
  });

  it("records opt-out from preferences and rejects bad input", () => {
    const record = buildMemberSmsConsent({ optIn: false, source: "preferences" }, 50, { optIn: true, phone: "+17575550101", consentedAt: 42 });
    expect(record).toMatchObject({ optIn: false, phone: "+17575550101", optedOutAt: 50, consentedAt: 42, source: "preferences" });
    expect(() => buildMemberSmsConsent({ optIn: true, phone: "555", source: "preferences", textVersion: HI_SMS_CONSENT_VERSION }, 1)).toThrow("US mobile");
    expect(() => buildMemberSmsConsent({ optIn: true, phone: "7575550101", source: "preferences", textVersion: "old" }, 1)).toThrow("reload");
    expect(() => buildMemberSmsConsent({ optIn: true, phone: "7575550101", source: "admin", textVersion: HI_SMS_CONSENT_VERSION }, 1)).toThrow("source");
  });
});

describe("optional SMS checkboxes on public forms", () => {
  it("never requires SMS consent and links SMS Terms next to it", () => {
    const checkbox = readFileSync("apps/web/src/components/sms/SmsConsentCheckbox.tsx", "utf8");
    expect(checkbox).not.toMatch(/\brequired\b(?!\s*\.)/);
    expect(checkbox).toContain("SMS_TERMS_PATH");
    expect(checkbox).toContain('href="/privacy"');

    const actions = readFileSync("apps/web/src/components/events/PitchEventActions.tsx", "utf8");
    expect(actions).toContain("const [smsConsent, setSmsConsent] = useState(false);");
    expect(actions).toContain("<SmsConsentCheckbox checked={smsConsent} onChange={onSms} />");
    expect(actions).toContain("My mobile number and text message consent are never shared.");

    for (const page of ["apps/web/src/app/register/page.tsx", "apps/web/src/app/preferences/page.tsx"]) {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("<SmsConsentCheckbox");
      expect(source).toContain("HI_SMS_CONSENT_VERSION");
    }
    const register = readFileSync("apps/web/src/app/register/page.tsx", "utf8");
    expect(register).toContain("const [smsConsent, setSmsConsent] = useState(false);");
    expect(register).toContain('source: "member-signup"');

    const powerNow = readFileSync("apps/web/src/app/power-now/PowerNowPage.tsx", "utf8");
    expect(powerNow).toContain('href="/sms-terms"');
    const intake = readFileSync("apps/web/src/app/intake/IntakeForm.tsx", "utf8");
    expect(intake).toContain('href="/sms-terms"');
  });

  it("publishes SMS terms and the privacy SMS section", () => {
    const smsTerms = readFileSync("apps/web/src/app/sms-terms/page.tsx", "utf8");
    for (const text of ["Hi Coworking event texts", "Message frequency varies", "Msg &amp; data rates may apply", '<strong>STOP</strong>{" "}to any message', "<strong>HELP</strong>", "hicoworking@accelanalysis.com", "Carriers are not liable for delayed or undelivered messages.", 'href="/privacy#sms"', 'href="/terms"']) {
      expect(smsTerms).toContain(text);
    }
    const privacy = readFileSync("apps/web/src/app/privacy/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(privacy).toContain("Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes.");
    expect(privacy).toContain("Text messaging originator opt-in data and consent will not be shared with any third parties.");
    expect(readFileSync("apps/web/src/app/terms/page.tsx", "utf8")).toContain('href="/sms-terms"');
    expect(readFileSync("apps/web/src/lib/publicSite.ts", "utf8")).toContain('"/sms-terms"');
  });

  it("names Hi Coworking (Accel Analysis LLC) as the sender on expo and Power NOW forms", async () => {
    const { POWER_NOW_CONSENT_CATALOG } = await import("../../apps/functions/src/expo/powerNowModel");
    const { EXPO_CONSENT_CATALOG } = await import("../../apps/functions/src/expo/nasaLeadModel");
    for (const path of ["pitch", "watch", "contribute"] as const) {
      const channels = POWER_NOW_CONSENT_CATALOG[path].channels as Record<string, { wording: string } | undefined>;
      expect(channels.sms?.wording).toContain("Hi Coworking (Accel Analysis LLC) may send text messages");
      expect(POWER_NOW_CONSENT_CATALOG[path].version).toMatch(/-v0\.3$/);
    }
    expect(EXPO_CONSENT_CATALOG.sms.wording).toContain("from Hi Coworking (Accel Analysis LLC)");
  });
});
