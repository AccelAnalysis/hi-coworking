import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as admin from "../../apps/functions/node_modules/firebase-admin";
import { db } from "../../apps/functions/src/eventsV2/core";
import { HI_SMS_CONSENT_TEXT, HI_SMS_CONSENT_VERSION } from "../../apps/functions/src/providers/smsCompliance";

const PROJECT_ID = "demo-hi-coworking";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

type Callable = { run: (request: unknown) => Promise<{ interestId?: string }> };
let submit: Callable;
const eventId = `evt_sms_optional_${Date.now()}`;

function request(data: Record<string, unknown>) {
  return { data, rawRequest: { headers: {} }, acceptsStreaming: false };
}

const pitch = {
  eventId,
  kind: "pitch",
  firstName: "Avery",
  lastName: "Tester",
  email: "avery@example.test",
  phone: "(757) 555-0101",
  businessName: "Avery Labs",
  businessDescription: "We test things.",
  website: "https://example.test",
  advertisingConsent: true,
};

beforeAll(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  await db().collection("events").doc(eventId).set({
    id: eventId,
    title: "SMS optional test",
    status: "published",
    format: "virtual",
    startTime: Date.now() + 7 * 24 * 60 * 60 * 1000,
    endTime: Date.now() + 7 * 24 * 60 * 60 * 1000 + 3_600_000,
  });
  ({ events_v2SubmitEventInterest: submit } = (await import("../../apps/functions/src/eventsV2/publicRegistration")) as unknown as { events_v2SubmitEventInterest: Callable });
});

afterAll(async () => {
  await db().collection("events").doc(eventId).delete();
});

async function interest(id: string) {
  return (await db().collection("eventInterests").doc(id).get()).data() as Record<string, any>;
}

describe("pitch and prize forms: SMS consent is optional", () => {
  it("accepts an application with the SMS box unchecked and stores no opt-in", async () => {
    const result = await submit.run(request({ ...pitch }));
    const doc = await interest(String(result.interestId));
    expect(doc.smsConsent.optIn).toBe(false);
    expect(doc.smsConsent.consentedAt).toBeUndefined();
    expect(doc.advertisingConsentExcludes).toEqual(["phone", "smsConsent"]);
  });

  it("records the opt-in with time, source, phone and consent version when checked", async () => {
    const before = Date.now();
    const result = await submit.run(request({ ...pitch, smsConsent: true }));
    const doc = await interest(String(result.interestId));
    expect(doc.smsConsent).toMatchObject({
      optIn: true,
      phone: "+17575550101",
      source: "event-pitch-form",
      textVersion: HI_SMS_CONSENT_VERSION,
      consentText: HI_SMS_CONSENT_TEXT,
    });
    expect(doc.smsConsent.consentedAt).toBeGreaterThanOrEqual(before);
  });

  it("still requires the separate sharing consent", async () => {
    await expect(submit.run(request({ ...pitch, advertisingConsent: false, smsConsent: true }))).rejects.toThrow(/share your business contact details/);
  });
});
