import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFirestoreIntakeLeadStore, readIntakeLeadForTests, resetIntakeLeadMemoryForTests } from "../../apps/functions/src/expo/intakeLeadStore";
import { handleExpoLeadHttp } from "../../apps/functions/src/expo/nasaLeadIngest";
import { EXPO_CONSENT_CATALOG, NASA_EXPO_EVENT, type ExpoLeadPayload } from "../../apps/functions/src/expo/nasaLeadModel";
import { createMemoryConfirmationStore } from "../../apps/functions/src/expo/powerNowConfirmation";
import { POWER_NOW_CONSENT_VERSION } from "../../apps/functions/src/expo/powerNowModel";
import { decideLeadSubmitOutcome, enqueueExpoLead, flushExpoLeads, listExpoLeads } from "../../apps/web/src/lib/expoLeadQueue";
import { enqueuePowerNow, flushPowerNowQueue, listPowerNowQueue, type PowerNowSubmission } from "../../apps/web/src/lib/powerNowQueue";
import { leadsToCsv } from "../../scripts/export-intake-leads.mjs";

const NOW = new Date("2026-10-20T18:05:00.000Z");
const BOOTH_ID = "11111111-1111-4111-8111-111111111111";
const PITCH_ID = "22222222-2222-4222-8222-222222222222";
const CONTRIB_ID = "33333333-3333-4333-8333-333333333333";
const WATCH_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  delete process.env.ATTIO_INTAKE_ENABLED;
  resetIntakeLeadMemoryForTests();
});

describe("Firestore intake leads", () => {
  it("saves a booth lead with consent, event, interests, and submittedAt, and ignores Attio", async () => {
    let attioCalled = false;
    const result = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://hi-coworking.com",
      body: boothPayload(),
      apiKey: "live-key",
      now: NOW,
      fetchImpl: async () => {
        attioCalled = true;
        return json(403, { message: "workspace does not have an active subscription" });
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, accepted: true, stored: true, duplicate: false, attioStatus: "disabled" });
    expect(attioCalled).toBe(false);
    const saved = readIntakeLeadForTests(BOOTH_ID);
    expect(saved).toMatchObject({
      kind: "expo",
      clientSubmissionId: BOOTH_ID,
      submittedAt: NOW.toISOString(),
      event: NASA_EXPO_EVENT,
      fullName: "Jordan Hale",
      organization: "Example Dynamics",
      interests: { powerNow: true, hiCoworkingEarlyAccess: false },
    });
    expect(saved?.consent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "sms",
        optIn: true,
        version: EXPO_CONSENT_CATALOG.sms.version,
        wording: EXPO_CONSENT_CATALOG.sms.wording,
        capturedAtEt: expect.stringMatching(/^2026-10-20T14:05:00/),
      }),
      expect.objectContaining({ key: "email", optIn: false, version: EXPO_CONSENT_CATALOG.email.version }),
    ]));
  });

  it("accepts an older queued booth payload that omits event keys", async () => {
    const body = boothPayload();
    delete body.event;
    delete body.eventId;
    delete body.list;
    const result = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://hi-coworking.com",
      body,
      now: NOW,
    });
    expect(result.status).toBe(200);
    expect(readIntakeLeadForTests(BOOTH_ID)).toMatchObject({
      event: NASA_EXPO_EVENT,
      source: "EXPO-NASA-2026-10-20",
    });
  });

  it("returns success for a duplicate clientSubmissionId and keeps one document", async () => {
    const first = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://hi-coworking.com",
      body: boothPayload(),
      now: NOW,
    });
    const second = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://hi-coworking.com",
      body: boothPayload(),
      now: NOW,
    });
    expect(first.body).toMatchObject({ duplicate: false });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, stored: true, duplicate: true });
    expect(readIntakeLeadForTests(BOOTH_ID)?.fullName).toBe("Jordan Hale");
  });

  it("keeps the lead when Attio is enabled and returns the subscription 403", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message) => {
      errors.push(String(message));
    });
    try {
      const result = await handleExpoLeadHttp({
        method: "POST",
        origin: "https://hi-coworking.com",
        body: boothPayload(),
        apiKey: "live-key",
        now: NOW,
        attioEnabled: true,
        fetchImpl: async () => json(403, {
          code: "workspace_authorization",
          message: "workspace does not have an active subscription for expo-fake-jordan@example.com",
        }),
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ ok: true, stored: true, attioStatus: "failed" });
      expect(JSON.stringify(result.body)).not.toContain("expo-fake-jordan@example.com");
      expect(readIntakeLeadForTests(BOOTH_ID)?.email).toBe("expo-fake-jordan@example.com");
      const line = errors.find((message) => message.includes("Expo lead send failed"));
      expect(line).toContain("HTTP 403");
      expect(line).not.toContain("expo-fake-jordan@example.com");
    } finally {
      spy.mockRestore();
    }
  });

  it("queues a storage failure and does not call Attio", async () => {
    let attioCalled = false;
    const result = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://hi-coworking.com",
      body: boothPayload(),
      apiKey: "live-key",
      now: NOW,
      leadStore: { save: async () => { throw new Error("firestore down"); } },
      fetchImpl: async () => {
        attioCalled = true;
        return json(200, {});
      },
    });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ ok: false, error: "Could not save this lead." });
    expect(attioCalled).toBe(false);
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 502 })).toBe("queue");
    expect(readIntakeLeadForTests(BOOTH_ID)).toBeNull();
  });

  it("treats an existing Firestore document as a duplicate", async () => {
    const seen = new Set<string>();
    const store = createFirestoreIntakeLeadStore({
      collection() {
        return {
          doc(id: string) {
            return {
              async create() {
                if (seen.has(id)) {
                  const error = new Error("already exists") as Error & { code: number };
                  error.code = 6;
                  throw error;
                }
                seen.add(id);
              },
            };
          },
        };
      },
    });
    const lead = readIntakeLeadForTests(BOOTH_ID);
    expect(lead).toBeNull();
    const record = {
      kind: "expo" as const,
      storedAt: NOW.toISOString(),
      clientSubmissionId: BOOTH_ID,
      submittedAt: NOW.toISOString(),
      event: NASA_EXPO_EVENT,
      interests: { powerNow: false },
      consent: [],
    };
    expect(await store.save(record)).toEqual({ created: true });
    expect(await store.save(record)).toEqual({ created: false });
  });

  it("saves pitch, contribute, and watch through the booth function", async () => {
    for (const body of [pitchPayload(), contributePayload(), watchPayload()]) {
      const result = await handleExpoLeadHttp({
        method: "POST",
        origin: "https://forms.accelanalysis.com",
        body,
        now: NOW,
        ip: "203.0.113.10",
        rateLimiter: { allow: () => true },
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ ok: true, stored: true, path: body.path });
    }

    expect(readIntakeLeadForTests(PITCH_ID)).toMatchObject({
      kind: "power-now",
      path: "pitch",
      submittedAt: NOW.toISOString(),
      interests: { pitch: true, watch: false, contribute: false },
      companyName: "Analytical Engines",
    });
    expect(readIntakeLeadForTests(PITCH_ID)?.consent).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "email", version: POWER_NOW_CONSENT_VERSION.pitch }),
    ]));
    expect(readIntakeLeadForTests(CONTRIB_ID)).toMatchObject({
      path: "contribute",
      interests: { pitch: false, watch: false, contribute: true },
    });
    expect(readIntakeLeadForTests(CONTRIB_ID)?.consent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "sms",
        optIn: true,
        version: POWER_NOW_CONSENT_VERSION.contribute,
        capturedAtEt: expect.stringMatching(/^2026-10-20T14:05:00/),
      }),
    ]));
    expect(readIntakeLeadForTests(WATCH_ID)).toMatchObject({ path: "watch" });
  });

  it("still sends confirmation mail from the allow-list when Attio is off", async () => {
    const calls: string[] = [];
    const env = {
      POWER_NOW_CONFIRMATION_EMAIL_ENABLED: "true",
      POWER_NOW_CONFIRMATION_TEST_RECIPIENTS: "jholman@accelanalysis.com",
      RESEND_API_KEY: "re_test",
    };
    const confirmation = {
      env,
      store: createMemoryConfirmationStore(),
      resolveMx: async () => [{ exchange: "mx.example.com", priority: 10 }],
      verifyCaptcha: async () => ({ ok: true as const }),
      readSecret: (name: string) => (name === "RESEND_API_KEY" ? "re_test" : undefined),
      mailFetch: async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return json(200, { id: "re_test_123" });
      },
    };
    const allowed = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://forms.accelanalysis.com",
      body: pitchPayload({
        email: "jholman@accelanalysis.com",
        pnStartedAt: "2026-10-20T18:04:00.000Z",
      }),
      now: NOW,
      ip: "203.0.113.10",
      rateLimiter: { allow: () => true },
      confirmation,
      fetchImpl: async () => {
        throw new Error("Attio should not be called");
      },
    });
    const blocked = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://forms.accelanalysis.com",
      body: pitchPayload({
        email: "ada@example.com",
        clientSubmissionId: WATCH_ID,
        pnStartedAt: "2026-10-20T18:04:00.000Z",
      }),
      now: NOW,
      ip: "203.0.113.11",
      rateLimiter: { allow: () => true },
      confirmation,
    });
    expect(allowed.status).toBe(200);
    expect(blocked.status).toBe(200);
    expect(calls.some((url) => url.includes("api.resend.com"))).toBe(true);
    expect(calls.filter((url) => url.includes("api.resend.com"))).toHaveLength(1);
    expect(readIntakeLeadForTests(WATCH_ID)?.email).toBe("ada@example.com");
  });

  it("flushes a queued booth lead and a queued pitch into one document each", async () => {
    await drainQueues();
    const booth = boothPayload({ clientSubmissionId: "55555555-5555-4555-8555-555555555555" });
    delete booth.event;
    delete booth.eventId;
    delete booth.list;
    await enqueueExpoLead(booth);
    await enqueuePowerNow(pitchPayload({ clientSubmissionId: "66666666-6666-4666-8666-666666666666" }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const origin = body.form === "power-now" ? "https://forms.accelanalysis.com" : "https://hi-coworking.com";
      const result = await handleExpoLeadHttp({
        method: "POST",
        origin,
        body,
        now: NOW,
        ip: "203.0.113.10",
        rateLimiter: { allow: () => true },
      });
      return json(result.status, result.body);
    }) as typeof fetch;

    try {
      const expo = await flushExpoLeads({ force: true });
      const power = await flushPowerNowQueue({ force: true });
      expect(expo.syncedIds).toEqual(["55555555-5555-4555-8555-555555555555"]);
      expect(power.syncedIds).toEqual(["66666666-6666-4666-8666-666666666666"]);
      expect(await listExpoLeads()).toEqual([]);
      expect(await listPowerNowQueue()).toEqual([]);
      expect(readIntakeLeadForTests("55555555-5555-4555-8555-555555555555")).toMatchObject({
        kind: "expo",
        event: NASA_EXPO_EVENT,
      });
      expect(readIntakeLeadForTests("66666666-6666-4666-8666-666666666666")).toMatchObject({
        kind: "power-now",
        path: "pitch",
      });

      await enqueueExpoLead(booth);
      const again = await flushExpoLeads({ force: true });
      expect(again.syncedIds).toEqual(["55555555-5555-4555-8555-555555555555"]);
      expect(await listExpoLeads()).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("locks intakeLeads to the Admin SDK and exports consent columns", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    const block = rules.slice(rules.indexOf("match /intakeLeads/"));
    expect(block.startsWith("match /intakeLeads/{leadId}")).toBe(true);
    expect(block.slice(0, block.indexOf("match /", 10))).toContain("allow read, write: if false");
    expect(block.slice(0, 240)).not.toContain("allow read: if true");

    const page = readFileSync("apps/web/src/app/power-now/PowerNowPage.tsx", "utf8");
    const queue = readFileSync("apps/web/src/lib/powerNowQueue.ts", "utf8");
    expect(page).toContain("postPowerNow");
    expect(page).toContain("enqueuePowerNow");
    expect(queue).toContain("EXPO_LEAD_ENDPOINT");
    expect(page).not.toContain("cloudfunctions.net");

    const csv = leadsToCsv([readIntakeLeadForTests(BOOTH_ID) ?? {
      kind: "expo",
      clientSubmissionId: BOOTH_ID,
      submittedAt: NOW.toISOString(),
      storedAt: NOW.toISOString(),
      event: NASA_EXPO_EVENT,
      fullName: "Jordan Hale",
      consent: [{
        key: "sms",
        optIn: true,
        version: EXPO_CONSENT_CATALOG.sms.version,
        wording: EXPO_CONSENT_CATALOG.sms.wording,
        capturedAtEt: "2026-10-20T14:05:00-04:00",
        source: "EXPO-NASA-2026-10-20",
      }],
    }]);
    expect(csv).toContain("clientSubmissionId");
    expect(csv).toContain("consent.sms.version");
    expect(csv).toContain(EXPO_CONSENT_CATALOG.sms.version);
    expect(csv).toContain("submittedAt");
    const script = readFileSync("scripts/export-intake-leads.mjs", "utf8");
    expect(script).toContain("INTAKE_LEADS_COLLECTION");
    expect(script).toContain(".collection(INTAKE_LEADS_COLLECTION)");
    expect(script).toContain("hi-coworking-plat");
  });
});

function boothPayload(overrides: Partial<ExpoLeadPayload> = {}): ExpoLeadPayload {
  return {
    fullName: "Jordan Hale",
    organization: "Example Dynamics",
    roleTitle: "Capture Manager",
    email: "expo-fake-jordan@example.com",
    phone: "202-555-0147",
    orgType: "prime",
    need: "A faster way to staff surge proposals.",
    timing: "FY27",
    interests: { powerNow: true, hiCoworkingEarlyAccess: false },
    consent: { email: false, sms: true, phone: false },
    submittedAt: NOW.toISOString(),
    clientSubmissionId: BOOTH_ID,
    event: NASA_EXPO_EVENT,
    eventId: "",
    list: "",
    ...overrides,
  };
}

function pitchPayload(overrides: Record<string, unknown> = {}): PowerNowSubmission {
  return {
    form: "power-now",
    path: "pitch",
    fullName: "Ada Lovelace",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "",
    businessName: "Analytical Engines",
    company: "",
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
    offerType: "",
    offerDescription: "",
    approximateValue: "",
    website: "",
    consent: { email: true, sms: false, phone: false },
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    referrerPath: "",
    submittedAt: NOW.toISOString(),
    clientSubmissionId: PITCH_ID,
    expo_hp: "",
    ...overrides,
  } as PowerNowSubmission;
}

function contributePayload(): PowerNowSubmission {
  return {
    ...pitchPayload(),
    path: "contribute",
    fullName: "Katherine Johnson",
    email: "katherine@example.com",
    phone: "757-555-0100",
    businessName: "Harbor Goods",
    offerType: "Experience",
    offerDescription: "A studio tour for two.",
    approximateValue: "80",
    consent: { email: false, sms: true, phone: false },
    clientSubmissionId: CONTRIB_ID,
  };
}

function watchPayload(): PowerNowSubmission {
  return {
    ...pitchPayload(),
    path: "watch",
    fullName: "Grace Hopper",
    email: "grace@example.com",
    businessName: "",
    consent: { email: true, sms: false, phone: false },
    clientSubmissionId: WATCH_ID,
  };
}

async function drainQueues(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => json(200, { ok: true })) as typeof fetch;
  try {
    await flushExpoLeads({ force: true });
    await flushPowerNowQueue({ force: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(body == null ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
