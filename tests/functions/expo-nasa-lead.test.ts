import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { readIntakeLeadForTests, resetIntakeLeadMemoryForTests } from "../../apps/functions/src/expo/intakeLeadStore";
import { handleExpoLeadHttp } from "../../apps/functions/src/expo/nasaLeadIngest";
import {
  EXPO_CONSENT_CATALOG,
  EXPO_CONSENT_KEYS,
  EXPO_LIST,
  EXPO_SOURCE,
  INTAKE_PRIVACY_NOTICE,
  NASA_EXPO_EVENT,
  formatIsoEastern,
  resolveIntakeProfile,
  validateExpoLeadPayload,
  type ExpoLeadPayload,
} from "../../apps/functions/src/expo/nasaLeadModel";
import { BOOTH_MANIFEST, boothFullscreenApiAvailable, boothHrefStaysInFlow, requestBoothFullscreen } from "../../apps/web/src/lib/boothKiosk";
import { expoAliasBootScript } from "../../apps/web/src/lib/expoAliasBoot";
import { collectIntakeFieldErrors, firstIntakeField } from "../../apps/web/src/lib/intakeFieldErrors";
import { attentionForActiveReceipt, decideLeadSubmitOutcome, EXPO_OFFLINE_SAVED_MESSAGE, toVisitorError, type QueuedExpoLead } from "../../apps/web/src/lib/expoLeadQueue";

const NOW = new Date("2026-10-20T18:05:00.000Z");
const CAPTURED_AT_ET = "2026-10-20T14:05:00-04:00";
const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ID = "33333333-3333-4333-8333-333333333333";

function payload(overrides: Partial<ExpoLeadPayload> & Record<string, unknown> = {}): ExpoLeadPayload {
  return {
    fullName: "Jordan Hale",
    organization: "Example Dynamics",
    roleTitle: "Proposal lead",
    email: "expo-fake-jordan@example.com",
    phone: "202-555-0147",
    orgType: "prime",
    need: "A faster way to staff surge proposals.",
    timing: "FY27",
    interests: { powerNow: false, hiCoworkingEarlyAccess: false },
    consent: { email: false, sms: false, phone: false },
    submittedAt: NOW.toISOString(),
    clientSubmissionId: FIRST_ID,
    ...overrides,
    interests: { powerNow: false, hiCoworkingEarlyAccess: false, ...overrides.interests },
    consent: {
      email: false,
      sms: false,
      phone: false,
      ...overrides.consent,
    },
  };
}

async function submit(body: unknown, extra: Partial<Parameters<typeof handleExpoLeadHttp>[0]> = {}) {
  return handleExpoLeadHttp({
    method: "POST",
    origin: "https://hi-coworking.com",
    body,
    now: NOW,
    ...extra,
  });
}

beforeEach(() => {
  resetIntakeLeadMemoryForTests();
});

describe("NASA expo lead capture", () => {
  it("formats booth time in Eastern Time", () => {
    expect(formatIsoEastern(NOW)).toBe(CAPTURED_AT_ET);
    expect(formatIsoEastern(new Date("2026-01-15T17:00:00.000Z"))).toBe("2026-01-15T12:00:00-05:00");
  });

  it("stores three fake leads as separate Firestore documents", async () => {
    const first = await submit(payload({
      consent: { email: false, sms: true, phone: true },
    }));
    const second = await submit(payload({
      clientSubmissionId: SECOND_ID,
      organization: "  Example   Dynamics ",
      consent: { email: true, sms: false, phone: false },
      interests: { powerNow: true, hiCoworkingEarlyAccess: false },
    }));
    const third = await submit(payload({
      fullName: "Priya Shah",
      organization: "Northstar Sub Co",
      roleTitle: "Owner",
      email: "",
      phone: "757-555-0199",
      orgType: "sub_small_business",
      need: "Introductions to a prime for a NASA subcontract.",
      timing: "",
      clientSubmissionId: THIRD_ID,
      interests: { powerNow: false, hiCoworkingEarlyAccess: true },
    }));

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, stored: true, duplicate: false, action: "stored" });
    expect(second.body).toMatchObject({ ok: true, stored: true, duplicate: false, action: "stored" });
    expect(third.body).toMatchObject({ ok: true, stored: true, duplicate: false, action: "stored" });
    expect(JSON.stringify(first.body)).not.toContain("ATTIO_API_KEY");

    const jordanFirst = readIntakeLeadForTests(FIRST_ID);
    const jordanSecond = readIntakeLeadForTests(SECOND_ID);
    const priya = readIntakeLeadForTests(THIRD_ID);
    expect(jordanFirst).toMatchObject({
      kind: "expo",
      fullName: "Jordan Hale",
      organization: "Example Dynamics",
      event: NASA_EXPO_EVENT,
    });
    expect(jordanSecond).toMatchObject({
      organization: "Example Dynamics",
      interests: { powerNow: true, hiCoworkingEarlyAccess: false },
    });
    expect(String(jordanFirst?.note ?? "")).toContain("Text (SMS): yes");
    expect(String(jordanFirst?.note ?? "")).toContain("Phone: yes");
    expect(String(jordanFirst?.note ?? "")).toContain("Email: no");
    expect(String(jordanFirst?.note ?? "")).toContain(`Version: ${EXPO_CONSENT_CATALOG.sms.version}`);
    expect(String(jordanFirst?.note ?? "")).toContain(`At (ET): ${CAPTURED_AT_ET}`);
    expect(String(jordanFirst?.note ?? "")).toContain(`Source: ${EXPO_SOURCE}`);
    expect(String(jordanFirst?.note ?? "")).toContain(`Wording: "${EXPO_CONSENT_CATALOG.sms.wording}"`);
    expect(String(jordanFirst?.note ?? "")).not.toContain(EXPO_CONSENT_CATALOG.email.wording);
    expect(String(jordanFirst?.note ?? "")).toContain("Captured by: NASA Expo booth");
    expect(String(priya?.note ?? "")).toContain("Email: none");
    expect(String(priya?.note ?? "")).toContain("Text (SMS): no");
    expect(String(priya?.note ?? "")).toContain("Phone: no");
    expect(String(priya?.note ?? "")).toContain("Hi Coworking Early Access: yes");
    expect(String(priya?.note ?? "")).not.toContain("Wording:");
    expect(String(priya?.note ?? "")).not.toContain(EXPO_CONSENT_CATALOG.phone.wording);
  });

  it("ignores forged consent wording and keeps unchecked boxes as no consent", async () => {
    const result = await submit({
      ...payload(),
      consentWording: "FORGED WORDING",
      consent: { email: false, sms: false, phone: false },
    });
    expect(result.status).toBe(200);
    const note = String(readIntakeLeadForTests(FIRST_ID)?.note ?? "");
    expect(note).not.toContain("FORGED WORDING");
    expect(note).not.toContain("Wording:");
    expect(note).toContain("Text (SMS): no");
    expect(note).toContain(`Version: ${EXPO_CONSENT_CATALOG.sms.version}`);
  });

  it("rejects an incomplete lead before writing", async () => {
    const missingContact = await submit(payload({ email: "", phone: "" }));
    const smsWithoutPhone = await submit(payload({
      phone: "",
      consent: { email: false, sms: true, phone: false },
    }));
    const phoneWithoutPhone = await submit(payload({
      phone: "",
      consent: { email: false, sms: false, phone: true },
    }));
    const emailWithoutEmail = await submit(payload({
      email: "",
      consent: { email: true, sms: false, phone: false },
    }));
    expect(missingContact.status).toBe(400);
    expect(smsWithoutPhone.status).toBe(400);
    expect(phoneWithoutPhone.status).toBe(400);
    expect(emailWithoutEmail.status).toBe(400);
    expect(readIntakeLeadForTests(FIRST_ID)).toBeNull();
  });

  it("drops a honeypot submission without writing a lead", async () => {
    const result = await submit({ ...payload(), expo_hp: "https://spam.example" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, accepted: true });
    expect(readIntakeLeadForTests(FIRST_ID)).toBeNull();
  });

  it("refuses other websites and does not expose internal secret names", async () => {
    const stored = await submit(payload());
    expect(stored.status).toBe(200);
    expect(stored.body).toMatchObject({ ok: true, stored: true });
    expect(JSON.stringify(stored.body)).not.toContain("ATTIO_API_KEY");

    const blocked = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://evil.example",
      body: payload(),
      now: NOW,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.headers["Access-Control-Allow-Origin"]).toBeUndefined();

    const formsHostBooth = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://forms.accelanalysis.com",
      body: payload(),
      now: NOW,
    });
    expect(formsHostBooth.status).toBe(403);
    expect(formsHostBooth.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(formsHostBooth.body).toMatchObject({
      error: "This booth form cannot be submitted from that site.",
    });

    const hiCoworking = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://www.hi-coworking.com",
      body: payload({
        email: "www@example.com",
        clientSubmissionId: "66666666-6666-4666-8666-666666666666",
      }),
      now: NOW,
    });
    expect(hiCoworking.status).toBe(200);
    expect(hiCoworking.headers["Access-Control-Allow-Origin"]).toBe("https://www.hi-coworking.com");
  });

  it("queues network and server failures and keeps validation errors on screen", () => {
    expect(decideLeadSubmitOutcome({ online: false, networkError: false, httpStatus: null })).toBe("queue");
    expect(decideLeadSubmitOutcome({ online: true, networkError: true, httpStatus: null })).toBe("queue");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 200 })).toBe("saved");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 404 })).toBe("queue");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 429 })).toBe("queue");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 503 })).toBe("queue");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 400 })).toBe("rejected");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 409 })).toBe("rejected");
  });

  it("routes a named event as a NASA Expo lead and leaves a general intake off that event", async () => {
    const nasa = await submit(payload({
      event: NASA_EXPO_EVENT,
      eventId: "",
      list: "",
    }));
    expect(nasa.status).toBe(200);
    expect(nasa.body).toMatchObject({ ok: true, stored: true, action: "stored" });
    const nasaLead = readIntakeLeadForTests(FIRST_ID);
    expect(String(nasaLead?.note ?? "")).toContain(`Event: ${NASA_EXPO_EVENT}`);
    expect(String(nasaLead?.note ?? "")).toContain("Captured by: NASA Expo booth");
    expect(nasaLead).toMatchObject({ event: NASA_EXPO_EVENT, source: EXPO_SOURCE });

    const general = await submit(payload({
      fullName: "Casey Quinn",
      email: "casey.quinn@example.com",
      orgType: "",
      event: "chamber-breakfast",
      eventId: "",
      list: "some-other-list",
      clientSubmissionId: "55555555-5555-4555-8555-555555555555",
    }));
    expect(general.status).toBe(200);
    const generalLead = readIntakeLeadForTests("55555555-5555-4555-8555-555555555555");
    expect(String(generalLead?.note ?? "")).toContain("Source: chamber-breakfast");
    expect(String(generalLead?.note ?? "")).toContain("Captured by: Accel Analysis intake");
    expect(String(generalLead?.note ?? "")).toContain("List: some-other-list");
    expect(String(generalLead?.note ?? "")).toContain("Org type: Not asked");
    expect(resolveIntakeProfile({ explicit: false })).toMatchObject({
      fieldSet: "nasa-expo",
      source: EXPO_SOURCE,
      requestedList: EXPO_LIST.apiSlug,
    });
  });

  it("keeps three unchecked consents, the intake form, and the hosting rewrite in sync", () => {
    expect(EXPO_CONSENT_KEYS).toEqual(["email", "sms", "phone"]);
    expect(EXPO_CONSENT_CATALOG.sms.wording).toContain("Accel Analysis");
    expect(EXPO_CONSENT_CATALOG.sms.wording).toContain("Message frequency varies");
    expect(EXPO_CONSENT_CATALOG.sms.wording).toContain("Msg & data rates may apply");
    expect(EXPO_CONSENT_CATALOG.sms.wording).toContain("STOP");
    expect(EXPO_CONSENT_CATALOG.sms.wording).toContain("HELP");
    expect(EXPO_LIST.listId).toBe("e799de65-f5ad-4def-b9b6-abb0c680d84a");

    const form = readFileSync("apps/web/src/app/intake/IntakeForm.tsx", "utf8");
    const queue = readFileSync("apps/web/src/lib/expoLeadQueue.ts", "utf8");
    const firebase = readFileSync("firebase.json", "utf8");
    const main = readFileSync("apps/functions/src/main.ts", "utf8");
    const handler = readFileSync("apps/functions/src/expo/submitNasaLead.ts", "utf8");
    const doc = readFileSync("docs/EXPO-NASA-2026-LEAD-CAPTURE.md", "utf8");

    expect(form).toContain("EXPO_CONSENT_CATALOG");
    expect(form).toContain("INTAKE_PRIVACY_NOTICE");
    expect(form).toContain("EXPO_OFFLINE_SAVED_MESSAGE");
    expect(form).toContain("email: false");
    expect(form).toContain("sms: false");
    expect(form).toContain("phone: false");
    expect(form).not.toContain("marketing");
    expect(form).not.toContain("NASA");
    expect(readFileSync("apps/web/src/app/expo/nasa-2026/page.tsx", "utf8")).toContain("NASA_EXPO_EVENT");
    expect(form).not.toContain("getUserMedia");
    expect(form).not.toContain("SpeechRecognition");
    expect(form).not.toContain("webkitSpeechRecognition");
    expect(queue).toContain("indexedDB.open");
    expect(queue).toContain('"/api/expo/nasa-lead"');
    expect(EXPO_OFFLINE_SAVED_MESSAGE).toBe("Thanks, we've got it");
    expect(toVisitorError("Attio could not save this lead yet.")).toBe("We couldn't send this. Please try again.");
    expect(toVisitorError("The booth could not save this lead (502).")).toBe("We couldn't send this. Please try again.");
    expect(toVisitorError("Enter your full name.")).toBe("Enter your full name.");
    const invalid = validateExpoLeadPayload({});
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toBe("Enter your full name.");

    const intakeLayout = readFileSync("apps/web/src/app/intake/layout.tsx", "utf8");
    const aliasLayout = readFileSync("apps/web/src/app/expo/nasa-2026/layout.tsx", "utf8");
    const aliasPage = readFileSync("apps/web/src/app/expo/nasa-2026/page.tsx", "utf8");
    expect(intakeLayout).toContain("Follow up · Accel Analysis");
    expect(intakeLayout).toContain("Tell Accel Analysis how we should follow up with you.");
    expect(intakeLayout).not.toContain("Lead intake");
    expect(intakeLayout).not.toContain("Accel Intake");
    expect(aliasLayout).not.toContain("Lead intake");
    expect(aliasLayout).not.toContain("lead intake");
    expect(aliasPage).toContain("Opening Accel Analysis…");
    expect(aliasPage).toContain("expoAliasBootScript");
    expect(aliasPage).toContain('id="expo-form"');
    expect(aliasPage).toContain("Continue to the form");
    expect(aliasPage.indexOf("Continue to the form")).toBeLessThan(aliasPage.indexOf('id="expo-form"'));
    expect(aliasPage).not.toContain("<noscript>");
    expect(aliasPage).not.toContain("http-equiv");
    expect(aliasPage).toContain("presetEvent={NASA_EXPO_EVENT}");
    expect(aliasPage).not.toContain("intake…");
    expect(aliasLayout).not.toContain("httpEquiv");
    expect(aliasLayout).not.toContain("refresh");
    expect(aliasPage).toContain("href={`/intake?event=${NASA_EXPO_EVENT}`}");
    expect(expoAliasBootScript()).toContain("location.replace");
    expect(expoAliasBootScript()).toContain("setTimeout(reveal");
    expect(expoAliasBootScript()).not.toContain("</");
    for (const phrase of [
      "Save lead",
      "Lead saved",
      "Next person",
      "What they need",
      "In their words",
      "Only if they ask",
      "the person agrees",
      "the person asks",
      "They asked about",
      "this device",
      "waiting to sync",
      "Sync now",
      "A saved lead",
      "Needs a correction",
      ">Selected<",
      "Unchecked",
      "Checked<",
    ]) {
      expect(form).not.toContain(phrase);
    }
    expect(form).toContain("attentionForActiveReceipt");
    expect(form).not.toContain("payload.fullName");
    expect(form).not.toContain("needsAttention");
    expect(form).not.toContain("The follow-up boxes");
    expect(form).not.toContain("follow-up boxes");
    expect(form).toContain("VisitorConfirmation");
    const confirmation = readFileSync("apps/web/src/lib/visitorConfirmation.tsx", "utf8");
    expect(confirmation).toContain("Thanks, you're all set.");
    expect(confirmation).toContain("We've saved your info, and someone from Accel Analysis will follow up.");
    expect(confirmation).toContain("Start a new entry");
    expect(confirmation).toContain('role="status"');
    expect(confirmation).toContain("headingRef.current?.focus()");
    expect(confirmation).toContain("VISITOR_CONFIRM_IDLE_MS = 30_000");
    expect(form).toContain("How should we follow up?");
    expect(form).toContain("About you");
    expect(form).toContain("What you need");
    expect(form).toContain("In your words");
    expect(form).toContain("I'd like to hear about Power NOW.");
    expect(form).toContain("I'd like to hear about Hi Coworking early access.");
    expect(form).toContain("email: false");
    expect(EXPO_CONSENT_CATALOG.email.version).toBe("intake-consent-v1-email");
    expect(EXPO_CONSENT_CATALOG.sms.version).toBe("intake-consent-v2-sms");
    expect(EXPO_CONSENT_CATALOG.phone.version).toBe("intake-consent-v1-phone");
    expect(firebase).toContain('"/api/expo/nasa-lead"');
    expect(firebase).toContain('"functionId": "expo_submitNasaLead"');
    expect(main).toContain("expo_submitNasaLead");
    expect(handler).not.toContain("ATTIO_API_KEY");
    expect(handler).not.toContain("getUserMedia");

    for (const item of Object.values(EXPO_CONSENT_CATALOG)) {
      expect(doc).toContain(item.version);
      expect(doc).toContain(item.wording);
    }
    expect(doc).toContain(INTAKE_PRIVACY_NOTICE);
    expect(INTAKE_PRIVACY_NOTICE).toBe(
      "We'll use your information only to follow up on what you asked about. Check a box only if you'd like that kind of update. You can unsubscribe anytime.",
    );
    expect(doc).not.toContain("ATTIO_API_KEY");
    expect(doc).toContain("/intake");
    expect(form).not.toContain("start unchecked");
    expect(form).not.toContain("mailto:");
    expect(form).not.toContain("tel:");
    expect(form).toContain("aria-invalid");
    expect(form).toContain("aria-describedby");
    expect(form).toContain('aria-required="true"');
    expect(form).toContain("required");
    expect(form).toContain("focus-visible:outline-4");
    expect(form).not.toContain("outline-none");
    expect(handler).not.toContain("INTAKE_PRIVACY_NOTICE");

    const powerNow = readFileSync("apps/web/src/app/power-now/PowerNowPage.tsx", "utf8");
    const powerCss = readFileSync("apps/web/src/app/power-now/power-now.css", "utf8");
    for (const phrase of ["start unchecked", "only if they ask", "Save lead", "Next person", "the person agrees", "boxes start unchecked"]) {
      expect(form).not.toContain(phrase);
      expect(powerNow).not.toContain(phrase);
    }
    expect(powerNow).toContain('required={required}');
    expect(powerNow).toContain("aria-required={required || undefined}");
    expect(powerCss).toContain("outline: 4px solid var(--midnight)");
    expect(powerCss).toContain(".pn textarea:focus-visible");
    expect(powerCss).toContain(".pn select:focus-visible");
  });

  it("reveals the booth form when the redirect never leaves the loader", () => {
    const elements: Record<string, { hidden: boolean; setAttribute: (name: string) => void; removeAttribute: (name: string) => void }> = {
      "expo-opening": {
        hidden: false,
        setAttribute(name: string) {
          if (name === "hidden") this.hidden = true;
        },
        removeAttribute(name: string) {
          if (name === "hidden") this.hidden = false;
        },
      },
      "expo-form": {
        hidden: true,
        setAttribute(name: string) {
          if (name === "hidden") this.hidden = true;
        },
        removeAttribute(name: string) {
          if (name === "hidden") this.hidden = false;
        },
      },
    };
    const documentStub = {
      getElementById(id: string) {
        return elements[id] ?? null;
      },
    };
    const historyCalls: unknown[][] = [];
    const historyStub = {
      replaceState(...args: unknown[]) {
        historyCalls.push(args);
      },
    };
    const locationStub = {
      pathname: "/expo/nasa-2026",
      search: "?utm_source=qr",
      replace(url: string) {
        locationStub.replaced = url;
        throw new Error("navigation blocked");
      },
      replaced: "",
    };
    const timers: Array<() => void> = [];
    const setTimeoutStub = (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    };
    const run = new Function(
      "location",
      "document",
      "history",
      "setTimeout",
      "URLSearchParams",
      expoAliasBootScript(),
    );
    run(locationStub, documentStub, historyStub, setTimeoutStub, URLSearchParams);

    expect(locationStub.replaced).toBe("/intake?utm_source=qr&event=nasa-expo-2026-10-20");
    expect(elements["expo-form"]?.hidden).toBe(true);
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(elements["expo-opening"]?.hidden).toBe(true);
    expect(elements["expo-form"]?.hidden).toBe(false);
    expect(String(historyCalls[0]?.[2])).toContain("utm_source=qr");
    expect(String(historyCalls[0]?.[2])).toContain("event=nasa-expo-2026-10-20");

    locationStub.pathname = "/intake";
    locationStub.search = "?event=nasa-expo-2026-10-20";
    elements["expo-form"]!.hidden = true;
    elements["expo-opening"]!.hidden = false;
    timers[0]?.();
    expect(elements["expo-form"]?.hidden).toBe(true);
    expect(elements["expo-opening"]?.hidden).toBe(false);
  });

  it("lists every missing booth field and keeps kiosk navigation on the form", () => {
    const missing = collectIntakeFieldErrors({
      fullName: "",
      email: "",
      phone: "",
      organization: "",
      roleTitle: "",
      orgType: "",
      need: "",
      timing: "",
      nasaFields: true,
      consent: { email: false, sms: false, phone: false },
    });
    expect(missing).toMatchObject({
      fullName: "Enter your full name.",
      email: "Enter your email or phone number.",
      phone: "Enter your email or phone number.",
      organization: "Enter your organization.",
      roleTitle: "Enter your role or title.",
      orgType: "Choose your organization type.",
      need: "Tell us what you need, in your words.",
    });
    expect(missing.timing).toBeUndefined();
    expect(firstIntakeField(missing)).toBe("fullName");
    expect(JSON.parse(readFileSync("apps/web/public/expo/accel-analysis.webmanifest", "utf8"))).toEqual(BOOTH_MANIFEST);
    expect(BOOTH_MANIFEST.display_override).toEqual(["fullscreen"]);
    expect(BOOTH_MANIFEST.display).toBe("standalone");
    expect(BOOTH_MANIFEST.name).toBe("Accel Analysis");
    expect(BOOTH_MANIFEST.start_url).toBe("/intake?event=nasa-expo-2026-10-20");
    const page = "https://hi-coworking.com/intake?event=nasa-expo-2026-10-20";
    expect(boothHrefStaysInFlow("/intake?event=nasa-expo-2026-10-20", page)).toBe(true);
    expect(boothHrefStaysInFlow("/expo/nasa-2026", page)).toBe(true);
    expect(boothHrefStaysInFlow("https://accelanalysis.com", page)).toBe(false);
    expect(boothHrefStaysInFlow("mailto:JHolman@AccelAnalysis.com", page)).toBe(false);
    expect(boothHrefStaysInFlow("tel:+17572360651", page)).toBe(false);
    const calls: string[] = [];
    requestBoothFullscreen({
      requestFullscreen() {
        calls.push("standard");
      },
      webkitRequestFullscreen() {
        calls.push("webkit");
      },
    });
    expect(calls).toEqual(["standard"]);
    requestBoothFullscreen({
      webkitRequestFullscreen() {
        calls.push("webkit");
      },
    });
    expect(calls).toEqual(["standard", "webkit"]);
    expect(boothFullscreenApiAvailable({})).toBe(false);
  });

  it("shows a correction only for the response still on screen", () => {
    const earlier = queuedLead("earlier-id", "needs_attention", "Priya Shah", "Add your email so we follow up with the right person.");
    const current = queuedLead("current-id", "needs_attention", "Jordan Hale", "Add your phone number to agree to texts.");
    const waiting = queuedLead("waiting-id", "pending", "Alex Kim", null);

    expect(attentionForActiveReceipt([earlier, current, waiting], null)).toBeNull();
    expect(attentionForActiveReceipt([earlier, current, waiting], "missing")).toBeNull();
    expect(attentionForActiveReceipt([earlier, current, waiting], "waiting-id")).toBeNull();
    expect(attentionForActiveReceipt([earlier, current, waiting], "current-id")).toBe(current);
    expect(attentionForActiveReceipt([earlier, current, waiting], "current-id")?.payload.fullName).toBe("Jordan Hale");
    expect(attentionForActiveReceipt([earlier], "current-id")).toBeNull();
  });
});

function queuedLead(
  id: string,
  status: QueuedExpoLead["status"],
  fullName: string,
  lastError: string | null,
): QueuedExpoLead {
  return {
    clientSubmissionId: id,
    payload: {
      fullName,
      organization: "Example Dynamics",
      roleTitle: "Owner",
      email: "",
      phone: "2025550147",
      orgType: "other",
      need: "A private note that should stay off the next screen.",
      timing: "",
      interests: { powerNow: false, hiCoworkingEarlyAccess: false },
      consent: { email: false, sms: false, phone: false },
      submittedAt: "2026-10-20T18:05:00.000Z",
      clientSubmissionId: id,
    },
    status,
    attempts: 1,
    lastError,
    queuedAt: "2026-10-20T18:05:00.000Z",
    lastAttemptAt: "2026-10-20T18:06:00.000Z",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toApi(record: StoredRecord) {
  return { id: { record_id: record.id }, values: record.values };
}

function text(record: StoredRecord | undefined, slug: string): string {
  const value = record?.values[slug]?.[0] as { value?: string } | undefined;
  return value?.value ?? "";
}

function emails(record: StoredRecord): string[] {
  return (record.values.email_addresses ?? [])
    .map((value) => String((value as { email_address?: string }).email_address ?? "").toLowerCase())
    .filter(Boolean);
}

function phones(record: StoredRecord): string[] {
  return (record.values.phone_numbers ?? [])
    .map((value) => String((value as { original_phone_number?: string }).original_phone_number ?? "").replace(/\D/g, ""));
}
