import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { readIntakeLeadForTests, resetIntakeLeadMemoryForTests } from "../../apps/functions/src/expo/intakeLeadStore";
import { handleExpoLeadHttp } from "../../apps/functions/src/expo/nasaLeadIngest";
import { createPowerNowRateLimiter } from "../../apps/functions/src/expo/powerNowIngest";
import {
  POWER_NOW_CONSENT_VERSION,
  POWER_NOW_SEND_ERROR,
  POWER_NOW_SOURCE,
  POWER_NOW_WATCH_CONSENT_ERROR,
  consentSentence,
} from "../../apps/functions/src/expo/powerNowModel";

const NOW = new Date("2026-10-07T21:35:00.000Z");
const CAPTURED_AT_ET = "2026-10-07T17:35:00-04:00";
const PITCH_ID = "11111111-1111-4111-8111-111111111111";
const WATCH_ID = "22222222-2222-4222-8222-222222222222";
const CONTRIB_ID = "33333333-3333-4333-8333-333333333333";

function pitchBody(overrides: Record<string, unknown> = {}) {
  return {
    form: "power-now",
    path: "pitch",
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "",
    businessName: "Analytical Engines",
    city: "Carrollton",
    state: "VA",
    businessStage: "development_testing",
    opportunityType: "growing_an_existing_business",
    businessStageOther: "",
    businessDescription: "We help local makers test a first product.",
    pitchTopic: "A workshop kit for first customers.",
    progress: "Ten customer conversations.",
    heardAbout: "LinkedIn",
    heardAboutOther: "",
    consent: { email: false, sms: false, phone: false },
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "interest",
    utmContent: "post",
    referrerPath: "/updates",
    submittedAt: NOW.toISOString(),
    clientSubmissionId: PITCH_ID,
    consentWording: "FORGED WORDING",
    ...overrides,
  };
}

function watchBody(overrides: Record<string, unknown> = {}) {
  return {
    form: "power-now",
    path: "watch",
    fullName: "Grace Hopper",
    email: "grace@example.com",
    phone: "",
    company: "",
    consent: { email: true, sms: false, phone: false },
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    referrerPath: "",
    submittedAt: NOW.toISOString(),
    clientSubmissionId: WATCH_ID,
    ...overrides,
  };
}

function contributeBody(overrides: Record<string, unknown> = {}) {
  return {
    form: "power-now",
    path: "contribute",
    fullName: "Katherine Johnson",
    email: "katherine@example.com",
    phone: "757-555-0100",
    businessName: "Harbor Goods",
    offerType: "Experience",
    offerDescription: "A studio tour for two, local pickup, expires after the night we agree on.",
    approximateValue: "80",
    website: "https://harbor.example",
    heardAbout: "Friend or colleague",
    consent: { email: false, sms: true, phone: false },
    submittedAt: NOW.toISOString(),
    clientSubmissionId: CONTRIB_ID,
    ...overrides,
  };
}

async function submit(
  body: Record<string, unknown>,
  extras: { limiter?: ReturnType<typeof createPowerNowRateLimiter> } = {},
) {
  return handleExpoLeadHttp({
    method: "POST",
    origin: "http://localhost:3000",
    body,
    now: NOW,
    ip: "203.0.113.10",
    rateLimiter: extras.limiter ?? { allow: () => true },
  });
}

beforeEach(() => {
  resetIntakeLeadMemoryForTests();
});

describe("Power NOW forms host origin", () => {
  it("accepts pitch, watch, and contribute from https://forms.accelanalysis.com", async () => {
    for (const body of [pitchBody(), watchBody(), contributeBody()]) {
      const result = await handleExpoLeadHttp({
        method: "POST",
        origin: "https://forms.accelanalysis.com",
        body,
        now: NOW,
        ip: "203.0.113.10",
        rateLimiter: { allow: () => true },
      });
      expect(result.status, String(body.path)).toBe(200);
      expect(result.headers["Access-Control-Allow-Origin"]).toBe("https://forms.accelanalysis.com");
      expect(result.body).toMatchObject({ ok: true, path: body.path });
    }
  });

  it("answers the forms-host preflight and still rejects other sites and the booth form", async () => {
    const preflight = await handleExpoLeadHttp({
      method: "OPTIONS",
      origin: "https://forms.accelanalysis.com",
      body: null,
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers["Access-Control-Allow-Origin"]).toBe("https://forms.accelanalysis.com");

    const booth = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://forms.accelanalysis.com",
      body: { fullName: "Booth Visitor", email: "booth@example.com" },
      now: NOW,
    });
    expect(booth.status).toBe(403);
    expect(booth.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(booth.body).toMatchObject({ error: "This booth form cannot be submitted from that site." });

    const lookalike = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://forms.accelanalysis.com.evil.example",
      body: pitchBody({ clientSubmissionId: "44444444-4444-4444-8444-444444444444" }),
      now: NOW,
    });
    expect(lookalike.status).toBe(403);
    expect(lookalike.headers["Access-Control-Allow-Origin"]).toBeUndefined();

    const hi = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://hi-coworking.com",
      body: pitchBody({ clientSubmissionId: "55555555-5555-4555-8555-555555555555", email: "hi@example.com" }),
      now: NOW,
      ip: "203.0.113.11",
      rateLimiter: { allow: () => true },
    });
    expect(hi.status).toBe(200);
    expect(hi.headers["Access-Control-Allow-Origin"]).toBe("https://hi-coworking.com");
  });
});

describe("Power NOW path allow-list", () => {
  it("rejects a path outside pitch, watch, and contribute", async () => {
    const result = await submit(pitchBody({ path: "sponsor" }));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false, error: "Choose pitch, watch, or contribute." });
    expect(readIntakeLeadForTests(PITCH_ID)).toBeNull();
  });

  it("accepts each allow-listed path, including a different case", async () => {
    const pitch = await submit(pitchBody({ path: "PITCH" }));
    const watch = await submit(watchBody());
    const contribute = await submit(contributeBody());
    expect(pitch.status).toBe(200);
    expect(watch.status).toBe(200);
    expect(contribute.status).toBe(200);
    expect(pitch.body).toMatchObject({ path: "pitch" });
    expect(watch.body).toMatchObject({ path: "watch" });
    expect(contribute.body).toMatchObject({ path: "contribute" });
  });
});

describe("Power NOW consent capture", () => {
  it("stores unchecked boxes as no, with the path wording version and Eastern timestamp", async () => {
    const result = await submit(pitchBody());
    expect(result.status).toBe(200);
    const saved = readIntakeLeadForTests(PITCH_ID);
    expect(saved?.consent).toEqual([
      expect.objectContaining({
        key: "email",
        optIn: false,
        version: POWER_NOW_CONSENT_VERSION.pitch,
        capturedAtEt: CAPTURED_AT_ET,
        source: POWER_NOW_SOURCE,
      }),
      expect.objectContaining({ key: "sms", optIn: false, version: POWER_NOW_CONSENT_VERSION.pitch }),
      expect.objectContaining({ key: "phone", optIn: false, version: POWER_NOW_CONSENT_VERSION.pitch }),
    ]);
    expect(JSON.stringify(saved)).not.toContain("FORGED WORDING");
    expect(consentSentence("pitch", "email")).toContain("Email me about future Power NOW");
  });

  it("requires a phone number when text or phone is checked, and at least one watch channel", async () => {
    const sms = await submit(pitchBody({ consent: { email: false, sms: true, phone: false } }));
    expect(sms.status).toBe(400);
    expect(sms.body).toMatchObject({ error: "Please add a phone number, or uncheck text and phone." });

    const watch = await submit(watchBody({ consent: { email: false, sms: false, phone: true } }));
    expect(watch.status).toBe(400);
    expect(watch.body).toMatchObject({ error: POWER_NOW_WATCH_CONSENT_ERROR });
    expect(readIntakeLeadForTests(WATCH_ID)).toBeNull();

    const watched = await submit(watchBody({
      consent: { email: false, sms: true, phone: false },
      phone: "757-555-0199",
    }));
    expect(watched.status).toBe(200);
    const saved = readIntakeLeadForTests(WATCH_ID);
    expect(saved).toMatchObject({ phoneE164: "+17575550199" });
    expect(saved?.consent).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "sms", optIn: true, phone: "+17575550199", version: POWER_NOW_CONSENT_VERSION.watch }),
      expect.objectContaining({ key: "email", optIn: false }),
    ]));
    expect(saved?.consent?.some((item: { key: string }) => item.key === "phone")).toBe(false);
  });
});

describe("Power NOW intake storage", () => {
  it("returns a duplicate for the same submission id", async () => {
    const first = await submit(pitchBody());
    const again = await submit(pitchBody());
    expect(first.body).toMatchObject({ ok: true, stored: true, duplicate: false, action: "stored" });
    expect(again.body).toMatchObject({ ok: true, stored: true, duplicate: true });
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
  });

  it("drops a honeypot and a burst over the rate limit before writing", async () => {
    const honeypot = await submit(pitchBody({ expo_hp: "https://spam.example" }));
    expect(honeypot.status).toBe(200);
    expect(honeypot.body).toMatchObject({ ok: true, accepted: true });
    expect(readIntakeLeadForTests(PITCH_ID)).toBeNull();

    const limiter = createPowerNowRateLimiter({ limit: 1, now: () => NOW.getTime() });
    const first = await submit(pitchBody(), { limiter });
    const second = await submit(pitchBody({ clientSubmissionId: WATCH_ID }), { limiter });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ ok: false });
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
    expect(readIntakeLeadForTests(WATCH_ID)).toBeNull();
  });

  it("leaves personal data out of the tag when a referrer tries to carry it", async () => {
    await submit(pitchBody({
      referrerPath: "/updates?email=ada@example.com",
      utmSource: "ada@example.com",
    }));
    const description = String(readIntakeLeadForTests(PITCH_ID)?.descriptionTag ?? "");
    expect(description).toContain("ref:/updates");
    expect(description).not.toContain("ada@example.com");
    expect(description).not.toContain("utm:source=");
  });
});

describe("Power NOW page boundaries", () => {
  it("keeps the page noindex, on the shared function, and free of dates, prices, and Bookings", () => {
    const page = readFileSync("apps/web/src/app/power-now/PowerNowPage.tsx", "utf8");
    const layout = readFileSync("apps/web/src/app/power-now/layout.tsx", "utf8");
    const css = readFileSync("apps/web/src/app/power-now/power-now.css", "utf8");
    const firebase = readFileSync("firebase.json", "utf8");
    const rules = readFileSync("firestore.rules", "utf8");
    const appEntries = readdirSync("apps/web/src/app");

    expect(layout).toContain("index: false");
    expect(layout).toContain("follow: false");
    expect(page).toContain("Join the Power NOW list");
    expect(page).toContain("POWER_NOW_CONSENT_CATALOG");
    expect(page).toContain("Apply to pitch");
    expect(page).toContain("Get pitch-night updates");
    expect(page).toContain("Contribute to the prize pack");
    expect(page).toContain("/power-now/${item.id}#form-${item.id}");
    expect(page).toContain("VisitorConfirmation");
    expect(page).toContain("initialPath");
    expect(readFileSync("apps/web/src/app/power-now/[path]/page.tsx", "utf8")).toContain("canonicalizePowerNowPath");
    const confirmation = readFileSync("apps/web/src/lib/visitorConfirmation.tsx", "utf8");
    expect(confirmation).toContain("Thanks, you're all set.");
    expect(confirmation).toContain("Start a new entry");
    expect(confirmation).toContain('role="status"');
    expect(page).not.toMatch(/\bbookings\b/i);
    expect(page).not.toMatch(/\bfree\b/i);
    expect(page).not.toContain('type="date"');
    expect(page).not.toContain("hi-coworking.com");
    expect(`${page}\n${css}`).not.toMatch(/\$\d/);
    expect(firebase).toContain('"functionId": "expo_submitNasaLead"');
    expect(rules).toContain("powerNowConsentLog");
    const sitemap = readFileSync("apps/web/src/app/sitemap.ts", "utf8");
    expect(sitemap).toContain("PUBLIC_HI_PAGES");
    expect(sitemap).not.toMatch(/power-now|Power NOW/);
    expect(appEntries).toContain("sitemap.ts");
    expect(POWER_NOW_SEND_ERROR).toContain("hello@accelanalysis.com");
  });
});
