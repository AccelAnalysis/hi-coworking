import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { handleExpoLeadHttp } from "../../apps/functions/src/expo/nasaLeadIngest";
import {
  EXPO_CONSENT_CATALOG,
  EXPO_CONSENT_KEYS,
  EXPO_DESCRIPTION_MARKER,
  EXPO_LIST,
  EXPO_SOURCE,
  INTAKE_PRIVACY_NOTICE,
  NASA_EXPO_EVENT,
  formatIsoEastern,
  resolveIntakeProfile,
  validateExpoLeadPayload,
  type ExpoLeadPayload,
} from "../../apps/functions/src/expo/nasaLeadModel";
import { decideLeadSubmitOutcome, EXPO_OFFLINE_SAVED_MESSAGE, toVisitorError } from "../../apps/web/src/lib/expoLeadQueue";

const NOW = new Date("2026-10-20T18:05:00.000Z");
const CAPTURED_AT_ET = "2026-10-20T14:05:00-04:00";
const API_KEY = "test-key";

type StoredRecord = {
  id: string;
  values: Record<string, unknown[]>;
};

type MockState = {
  people: StoredRecord[];
  companies: StoredRecord[];
  notes: Array<{ parent: string; title: string; content: string }>;
  entries: Array<{ parent: string; listId: string; slug: string }>;
  calls: Array<{ method: string; path: string; body?: unknown; authorization?: string }>;
  listStatus: number;
  listMessage: string;
  failPersonWrite?: { status: number; code?: string; message?: string };
};

function createAttio(state: MockState): typeof fetch {
  let sequence = 0;
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : undefined;
    const headers = new Headers(init?.headers);
    state.calls.push({
      method,
      path: `${url.pathname}${url.search}`,
      body,
      authorization: headers.get("authorization") ?? undefined,
    });
    if (headers.get("authorization") !== `Bearer ${API_KEY}`) {
      return json(401, { message: "unauthorized" });
    }

    if (method === "POST" && url.pathname === "/v2/objects/companies/records/query") {
      const wanted = String(body?.filter?.name ?? "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
      const matched = state.companies.filter((company) => text(company, "name").toLocaleLowerCase("en-US") === wanted);
      return json(200, { data: matched.map(toApi) });
    }

    if (method === "POST" && url.pathname === "/v2/objects/companies/records") {
      const company = { id: `company-${++sequence}`, values: body?.data?.values ?? {} };
      state.companies.push(company);
      return json(200, { data: toApi(company) });
    }

    if (method === "POST" && url.pathname === "/v2/objects/people/records/query") {
      const filter = body?.filter ?? {};
      let matched = state.people;
      if (typeof filter.email_addresses === "string") {
        const email = filter.email_addresses.toLowerCase();
        matched = state.people.filter((person) => emails(person).includes(email));
      } else if (filter.phone_numbers) {
        const digits = String(filter.phone_numbers).replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
        matched = state.people.filter((person) => phones(person).some((phone) => phone.endsWith(digits)));
      }
      return json(200, { data: matched.map(toApi) });
    }

    if (method === "PUT" && url.pathname === "/v2/objects/people/records") {
      if (state.failPersonWrite) {
        return json(state.failPersonWrite.status, {
          code: state.failPersonWrite.code,
          message: state.failPersonWrite.message ?? "person write failed",
        });
      }
      const companies = body?.data?.values?.company;
      if (Array.isArray(companies) && companies.length > 1) {
        return json(400, {
          code: "validation_type",
          message: "The company attribute is not multiselect.",
        });
      }
      const email = String(body?.data?.values?.email_addresses?.[0]?.email_address ?? "").toLowerCase();
      let person = state.people.find((item) => emails(item).includes(email));
      if (!person) {
        person = { id: `person-${++sequence}`, values: body?.data?.values ?? {} };
        state.people.push(person);
      } else {
        person.values = body?.data?.values ?? {};
      }
      return json(200, { data: toApi(person) });
    }

    if (method === "POST" && url.pathname === "/v2/objects/people/records") {
      const person = { id: `person-${++sequence}`, values: body?.data?.values ?? {} };
      state.people.push(person);
      return json(200, { data: toApi(person) });
    }

    const personPath = url.pathname.match(/^\/v2\/objects\/people\/records\/([^/]+)$/);
    if (personPath && method === "PATCH") {
      if (state.failPersonWrite) {
        return json(state.failPersonWrite.status, {
          code: state.failPersonWrite.code,
          message: state.failPersonWrite.message ?? "person write failed",
        });
      }
      const companies = body?.data?.values?.company;
      if (Array.isArray(companies) && companies.length > 1) {
        return json(400, {
          code: "validation_type",
          message: "The company attribute is not multiselect.",
        });
      }
      const person = state.people.find((item) => item.id === personPath[1]);
      if (!person) return json(404, { message: "not found" });
      person.values = { ...person.values, ...(body?.data?.values ?? {}) };
      return json(200, { data: toApi(person) });
    }

    const entriesPath = url.pathname.match(/^\/v2\/objects\/people\/records\/([^/]+)\/entries$/);
    if (entriesPath && method === "GET") {
      const data = state.entries
        .filter((entry) => entry.parent === entriesPath[1])
        .map((entry) => ({
          list_id: entry.listId,
          list_api_slug: entry.slug,
          entry_id: `entry-${entry.parent}`,
        }));
      return json(200, { data });
    }

    if (method === "POST" && url.pathname === `/v2/lists/${EXPO_LIST.apiSlug}/entries`) {
      if (state.listStatus >= 400) {
        return json(state.listStatus, { message: state.listMessage });
      }
      state.entries.push({
        parent: body?.data?.parent_record_id,
        listId: EXPO_LIST.listId,
        slug: EXPO_LIST.apiSlug,
      });
      return json(200, { data: { entry_id: "entry-new" } });
    }

    if (method === "GET" && url.pathname === "/v2/notes") {
      const parent = url.searchParams.get("parent_record_id");
      return json(200, {
        data: state.notes.filter((note) => note.parent === parent),
      });
    }

    if (method === "POST" && url.pathname === "/v2/notes") {
      state.notes.push({
        parent: body?.data?.parent_record_id,
        title: body?.data?.title,
        content: body?.data?.content,
      });
      return json(200, { data: { id: { note_id: `note-${++sequence}` } } });
    }

    return json(500, { message: `Unhandled ${method} ${url.pathname}` });
  };
}

function emptyState(): MockState {
  return {
    people: [],
    companies: [],
    notes: [],
    entries: [],
    calls: [],
    listStatus: 200,
    listMessage: "",
  };
}

function payload(overrides: Partial<ExpoLeadPayload> = {}): ExpoLeadPayload {
  return {
    fullName: "Jordan Hale",
    organization: "Example Dynamics",
    roleTitle: "Capture Manager",
    email: "expo-fake-jordan@example.com",
    phone: "202-555-0147",
    orgType: "prime",
    need: "A faster way to staff surge proposals.",
    timing: "FY27",
    interests: { powerNow: false, hiCoworkingEarlyAccess: false },
    consent: { email: false, sms: false, phone: false },
    submittedAt: NOW.toISOString(),
    clientSubmissionId: "11111111-1111-4111-8111-111111111111",
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

async function submit(state: MockState, body: unknown, extra: Partial<Parameters<typeof handleExpoLeadHttp>[0]> = {}) {
  return handleExpoLeadHttp({
    method: "POST",
    origin: "https://hi-coworking.com",
    body,
    apiKey: API_KEY,
    fetchImpl: createAttio(state),
    now: NOW,
    ...extra,
  });
}

describe("NASA expo lead capture", () => {
  it("formats booth time in Eastern Time", () => {
    expect(formatIsoEastern(NOW)).toBe(CAPTURED_AT_ET);
    expect(formatIsoEastern(new Date("2026-01-15T17:00:00.000Z"))).toBe("2026-01-15T12:00:00-05:00");
  });

  it("stores three fake leads without duplicating the emailed person or company", async () => {
    const state = emptyState();
    const fetchImpl = createAttio(state);
    const first = await handleExpoLeadHttp({
      method: "POST",
      body: payload({
        consent: { email: false, sms: true, phone: true },
      }),
      apiKey: API_KEY,
      fetchImpl,
      now: NOW,
    });
    const second = await handleExpoLeadHttp({
      method: "POST",
      body: payload({
        clientSubmissionId: "22222222-2222-4222-8222-222222222222",
        organization: "  Example   Dynamics ",
        consent: { email: true, sms: false, phone: false },
        interests: { powerNow: true, hiCoworkingEarlyAccess: false },
      }),
      apiKey: API_KEY,
      fetchImpl,
      now: NOW,
    });
    const third = await handleExpoLeadHttp({
      method: "POST",
      body: payload({
        fullName: "Priya Shah",
        organization: "Northstar Sub Co",
        roleTitle: "Owner",
        email: "",
        phone: "757-555-0199",
        orgType: "sub_small_business",
        need: "Introductions to a prime for a NASA subcontract.",
        timing: "",
        clientSubmissionId: "33333333-3333-4333-8333-333333333333",
        interests: { powerNow: false, hiCoworkingEarlyAccess: true },
      }),
      apiKey: API_KEY,
      fetchImpl,
      now: NOW,
    });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, action: "created", companyStatus: "created", listStatus: "added", noteStatus: "created" });
    expect(second.body).toMatchObject({ ok: true, action: "updated", companyStatus: "existing", listStatus: "already_listed", noteStatus: "created" });
    expect(third.body).toMatchObject({ ok: true, action: "created", companyStatus: "created", listStatus: "added", noteStatus: "created" });
    expect(state.people).toHaveLength(2);
    expect(state.companies.map((company) => text(company, "name"))).toEqual(["Example Dynamics", "Northstar Sub Co"]);
    expect(state.entries).toHaveLength(2);
    expect(state.notes).toHaveLength(3);
    expect(JSON.stringify(first.body)).not.toContain(API_KEY);

    const jordan = state.people.find((person) => emails(person).includes("expo-fake-jordan@example.com"));
    const priya = state.people.find((person) => !emails(person).length);
    expect(text(jordan, "description")).toContain(`[${EXPO_DESCRIPTION_MARKER} |`);
    expect(text(jordan, "description")).toContain("org:prime");
    expect(text(jordan, "description")).toContain("consent:sms,phone");
    expect(text(jordan, "description")).toContain("consent:email");
    expect(text(jordan, "description")).toContain("interests:power_now");
    expect(text(jordan, "description").match(/22222222-2222-4222-8222-222222222222/g)).toHaveLength(1);
    expect(jordan?.values.company).toEqual([
      { target_object: "companies", target_record_id: state.companies[0]?.id },
    ]);
    expect(priya?.values.email_addresses).toBeUndefined();
    expect(priya?.values.phone_numbers).toEqual([
      { original_phone_number: "+17575550199", country_code: "US" },
    ]);
    expect(state.calls.some((call) => call.method === "POST" && call.path === "/v2/objects/people/records/query")).toBe(true);
    expect(state.calls.filter((call) => call.method === "PUT")).toHaveLength(2);
    expect(state.calls.filter((call) => call.method === "POST" && call.path === "/v2/objects/people/records")).toHaveLength(1);

    const smsNote = state.notes[0]?.content ?? "";
    expect(smsNote).toContain("Text (SMS): yes");
    expect(smsNote).toContain("Phone: yes");
    expect(smsNote).toContain("Email: no");
    expect(smsNote).toContain(`Version: ${EXPO_CONSENT_CATALOG.sms.version}`);
    expect(smsNote).toContain(`At (ET): ${CAPTURED_AT_ET}`);
    expect(smsNote).toContain(`Source: ${EXPO_SOURCE}`);
    expect(smsNote).toContain(`Wording: "${EXPO_CONSENT_CATALOG.sms.wording}"`);
    expect(smsNote).not.toContain(EXPO_CONSENT_CATALOG.email.wording);
    expect(smsNote).toContain("Captured by: NASA Expo booth");

    const priyaNote = state.notes[2]?.content ?? "";
    expect(priyaNote).toContain("Email: none");
    expect(priyaNote).toContain("Text (SMS): no");
    expect(priyaNote).toContain("Phone: no");
    expect(priyaNote).toContain("Hi Coworking Early Access: yes");
    expect(priyaNote).not.toContain("Wording:");
    expect(priyaNote).not.toContain(EXPO_CONSENT_CATALOG.phone.wording);
  });

  it("keeps an existing company when a booth visitor submits a different organization", async () => {
    const state = emptyState();
    state.companies.push(
      { id: "company-existing", values: { name: [{ value: "Example Dynamics" }] } },
      { id: "company-named", values: { name: [{ value: "Northstar Sub Co" }] } },
    );
    state.people.push({
      id: "person-existing",
      values: {
        email_addresses: [{ email_address: "expo-fake-jordan@example.com" }],
        name: [{ first_name: "Jordan", last_name: "Hale", full_name: "Jordan Hale" }],
        description: [{ value: "Earlier booth note" }],
        company: [
          {
            target_object: "companies",
            target_record_id: "company-retired",
            active_until: "2020-01-01T00:00:00.000Z",
          },
          { target_object: "companies", target_record_id: "company-existing" },
        ],
      },
    });

    const result = await submit(state, payload({ organization: "Northstar Sub Co" }));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      action: "updated",
      companyStatus: "existing",
      noteStatus: "created",
    });
    expect(state.calls.some((call) => call.method === "POST" && call.path === "/v2/objects/companies/records")).toBe(false);
    expect(state.calls.some((call) => call.method === "POST" && call.path === "/v2/objects/companies/records/query")).toBe(false);
    expect(state.companies.map((company) => company.id)).toEqual(["company-existing", "company-named"]);
    expect(state.people).toHaveLength(1);
    expect(state.people[0]?.values.company).toEqual([
      { target_object: "companies", target_record_id: "company-existing" },
    ]);
    const description = text(state.people[0], "description");
    expect(description).toContain("Earlier booth note");
    expect(description).toContain("submitted-org:Northstar Sub Co");
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]?.content).toContain("Organization: Northstar Sub Co");
    expect(state.notes[0]?.content).toContain("Submitted organization: Northstar Sub Co");
    expect(state.notes[0]?.parent).toBe("person-existing");
  });

  it("logs the Attio status, code, and message when a booth send fails", async () => {
    const state = emptyState();
    const recordId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    state.failPersonWrite = {
      status: 400,
      code: "validation_type",
      message: `Invalid company for expo-fake-jordan@example.com on record ${recordId}. Call 202-555-0147.`,
    };
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message) => {
      errors.push(String(message));
    });
    try {
      const result = await submit(state, payload());
      expect(result.status).toBe(502);
      expect(result.body).toEqual({ ok: false, error: "Attio could not save this lead yet." });
      expect(JSON.stringify(result.body)).not.toContain("expo-fake-jordan@example.com");
      const line = errors.find((message) => message.includes("Expo lead send failed"));
      expect(line).toContain("HTTP 400");
      expect(line).toContain("Attio error code: validation_type");
      expect(line).toContain("Invalid company for [redacted]");
      expect(line).toContain(recordId);
      expect(line).not.toContain("expo-fake-jordan@example.com");
      expect(line).not.toContain("202-555-0147");
      expect(line).not.toContain("Example Dynamics");
      expect(line).not.toContain("Jordan Hale");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not duplicate a note or description tag when the same submission retries", async () => {
    const state = emptyState();
    const fetchImpl = createAttio(state);
    const body = payload();
    await handleExpoLeadHttp({ method: "POST", body, apiKey: API_KEY, fetchImpl, now: NOW });
    const retry = await handleExpoLeadHttp({ method: "POST", body, apiKey: API_KEY, fetchImpl, now: NOW });
    expect(retry.body).toMatchObject({ action: "updated", noteStatus: "already_recorded", listStatus: "already_listed" });
    expect(state.people).toHaveLength(1);
    expect(state.notes).toHaveLength(1);
    expect(text(state.people[0], "description").match(/11111111-1111-4111-8111-111111111111/g)).toHaveLength(1);
  });

  it("keeps the person and note when the expo list rejects custom attributes", async () => {
    const state = emptyState();
    state.listStatus = 400;
    state.listMessage = "Unknown attribute on list entry";
    const result = await submit(state, payload());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ listStatus: "skipped", noteStatus: "created" });
    expect(state.people).toHaveLength(1);
    expect(state.notes).toHaveLength(1);
    expect(state.entries).toHaveLength(0);
    const listCall = state.calls.find((call) => call.path.includes("/lists/"));
    expect(listCall?.body).toMatchObject({ data: { entry_values: {}, parent_object: "people" } });
  });

  it("ignores forged consent wording and keeps unchecked boxes as no consent", async () => {
    const state = emptyState();
    const result = await submit(state, {
      ...payload(),
      consentWording: "FORGED WORDING",
      consent: { email: false, sms: false, phone: false },
    });
    expect(result.status).toBe(200);
    expect(state.notes[0]?.content).not.toContain("FORGED WORDING");
    expect(state.notes[0]?.content).not.toContain("Wording:");
    expect(state.notes[0]?.content).toContain("Text (SMS): no");
    expect(state.notes[0]?.content).toContain(`Version: ${EXPO_CONSENT_CATALOG.sms.version}`);
  });

  it("rejects an incomplete lead before calling Attio", async () => {
    const state = emptyState();
    const missingContact = await submit(state, payload({ email: "", phone: "" }));
    const smsWithoutPhone = await submit(state, payload({
      phone: "",
      consent: { email: false, sms: true, phone: false },
    }));
    const phoneWithoutPhone = await submit(state, payload({
      phone: "",
      consent: { email: false, sms: false, phone: true },
    }));
    const emailWithoutEmail = await submit(state, payload({
      email: "",
      consent: { email: true, sms: false, phone: false },
    }));
    expect(missingContact.status).toBe(400);
    expect(smsWithoutPhone.status).toBe(400);
    expect(phoneWithoutPhone.status).toBe(400);
    expect(emailWithoutEmail.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("drops a honeypot submission without writing to Attio", async () => {
    const state = emptyState();
    const result = await submit(state, { ...payload(), expo_hp: "https://spam.example" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, accepted: true });
    expect(state.calls).toHaveLength(0);
  });

  it("asks for an email when several people share a phone", async () => {
    const state = emptyState();
    state.people.push(
      {
        id: "person-a",
        values: { phone_numbers: [{ original_phone_number: "+12025550147", country_code: "US" }] },
      },
      {
        id: "person-b",
        values: { phone_numbers: [{ original_phone_number: "2025550147" }] },
      },
    );
    const result = await submit(state, payload({
      email: "",
      fullName: "Alex Kim",
      clientSubmissionId: "44444444-4444-4444-8444-444444444444",
    }));
    expect(result.status).toBe(409);
    expect(state.people).toHaveLength(2);
    expect(state.notes).toHaveLength(0);
  });

  it("does not expose the Attio token and refuses other websites", async () => {
    const missingKey = await handleExpoLeadHttp({
      method: "POST",
      body: payload(),
      apiKey: "",
      now: NOW,
    });
    expect(missingKey.status).toBe(500);
    expect(JSON.stringify(missingKey.body)).not.toContain("ATTIO_API_KEY");

    const blocked = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://evil.example",
      body: payload(),
      apiKey: API_KEY,
      now: NOW,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.headers["Access-Control-Allow-Origin"]).toBeUndefined();

    const formsHostBooth = await handleExpoLeadHttp({
      method: "POST",
      origin: "https://forms.accelanalysis.com",
      body: payload(),
      apiKey: API_KEY,
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
      apiKey: API_KEY,
      fetchImpl: createAttio(emptyState()),
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

  it("routes a named event onto the NASA list and leaves a general intake off that list", async () => {
    const nasaState = emptyState();
    const nasa = await submit(nasaState, payload({
      event: NASA_EXPO_EVENT,
      eventId: "",
      list: "",
    }));
    expect(nasa.status).toBe(200);
    expect(nasa.body).toMatchObject({ listStatus: "added" });
    expect(nasaState.notes[0]?.content).toContain(`Event: ${NASA_EXPO_EVENT}`);
    expect(nasaState.notes[0]?.content).toContain("Captured by: NASA Expo booth");
    expect(nasaState.entries).toHaveLength(1);

    const generalState = emptyState();
    const general = await submit(generalState, payload({
      fullName: "Casey Quinn",
      email: "casey.quinn@example.com",
      orgType: "",
      event: "chamber-breakfast",
      eventId: "",
      list: "some-other-list",
      clientSubmissionId: "55555555-5555-4555-8555-555555555555",
    }));
    expect(general.status).toBe(200);
    expect(general.body).toMatchObject({ listStatus: "skipped", noteStatus: "created" });
    expect(generalState.entries).toHaveLength(0);
    expect(generalState.notes[0]?.content).toContain("Source: chamber-breakfast");
    expect(generalState.notes[0]?.content).toContain("Captured by: Accel Analysis intake");
    expect(generalState.notes[0]?.content).toContain("List: some-other-list");
    expect(generalState.notes[0]?.content).toContain("Org type: Not asked");
    expect(resolveIntakeProfile({ explicit: false })).toMatchObject({
      fieldSet: "nasa-expo",
      source: EXPO_SOURCE,
      attioList: EXPO_LIST,
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
    expect(toVisitorError("Attio could not save this lead yet.")).toBe("We couldn't send this just now. Please try again.");
    expect(toVisitorError("The booth could not save this lead (502).")).toBe("We couldn't send this. Please try again.");
    expect(toVisitorError("More than one Attio person matches this phone. Add an email so the booth does not merge the wrong people.")).toBe(
      "Add your email so we follow up with the right person.",
    );
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
    expect(aliasPage).not.toContain("intake…");
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
    expect(form).toContain("How should we follow up?");
    expect(form).toContain("About you");
    expect(form).toContain("What you need");
    expect(form).toContain("In your words");
    expect(form).toContain("I'd like to hear about Power NOW.");
    expect(form).toContain("I'd like to hear about Hi Coworking early access.");
    expect(form).toContain("email: false");
    expect(EXPO_CONSENT_CATALOG.email.version).toBe("intake-consent-v1-email");
    expect(EXPO_CONSENT_CATALOG.sms.version).toBe("intake-consent-v1-sms");
    expect(EXPO_CONSENT_CATALOG.phone.version).toBe("intake-consent-v1-phone");
    expect(firebase).toContain('"/api/expo/nasa-lead"');
    expect(firebase).toContain('"functionId": "expo_submitNasaLead"');
    expect(main).toContain("expo_submitNasaLead");
    expect(handler).toContain("ATTIO_API_KEY");
    expect(handler).not.toContain("getUserMedia");

    for (const item of Object.values(EXPO_CONSENT_CATALOG)) {
      expect(doc).toContain(item.version);
      expect(doc).toContain(item.wording);
    }
    expect(doc).toContain(INTAKE_PRIVACY_NOTICE);
    expect(doc).toContain("ATTIO_API_KEY");
    expect(doc).toContain("/intake");
  });
});

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
