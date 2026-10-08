import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { handleExpoLeadHttp } from "../../apps/functions/src/expo/nasaLeadIngest";
import {
  POWER_NOW_TASK_ASSIGNEE_DEFAULT_ID,
  createPowerNowRateLimiter,
} from "../../apps/functions/src/expo/powerNowIngest";
import {
  PITCH_COMPETITION_LIST,
  POWER_NOW_CONSENT_VERSION,
  POWER_NOW_SEND_ERROR,
  POWER_NOW_SOURCE,
  POWER_NOW_WATCH_CONSENT_ERROR,
  consentSentence,
  type PowerNowConsentRecord,
} from "../../apps/functions/src/expo/powerNowModel";

const NOW = new Date("2026-10-07T21:35:00.000Z");
const CAPTURED_AT_ET = "2026-10-07T17:35:00-04:00";
const API_KEY = "test-key";
const PITCH_ID = "11111111-1111-4111-8111-111111111111";
const WATCH_ID = "22222222-2222-4222-8222-222222222222";
const CONTRIB_ID = "33333333-3333-4333-8333-333333333333";

type StoredRecord = { id: string; values: Record<string, unknown[]> };
type MockState = {
  people: StoredRecord[];
  companies: StoredRecord[];
  notes: Array<{ parentObject: string; parent: string; title: string; content: string }>;
  entries: Array<{ parent: string; slug: string; listId: string; parentObject: string; entryValues: unknown }>;
  tasks: Array<{ id: string; content: string; linked: unknown; assignees?: unknown }>;
  calls: string[];
  failAssignee?: boolean;
  sequence: number;
};

function createAttio(state: MockState): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : undefined;
    const headers = new Headers(init?.headers);
    state.calls.push(`${method} ${url.pathname}`);
    if (headers.get("authorization") !== `Bearer ${API_KEY}`) return json(401, { message: "unauthorized" });

    if (method === "POST" && url.pathname === "/v2/objects/companies/records/query") {
      const wanted = String(body?.filter?.name ?? "").trim().toLocaleLowerCase("en-US");
      const matched = state.companies.filter((company) => text(company, "name").toLocaleLowerCase("en-US") === wanted);
      return json(200, { data: matched.map(toApi) });
    }
    if (method === "POST" && url.pathname === "/v2/objects/companies/records") {
      const company = { id: `company-${++state.sequence}`, values: body?.data?.values ?? {} };
      state.companies.push(company);
      return json(200, { data: toApi(company) });
    }
    if (method === "POST" && url.pathname === "/v2/objects/people/records/query") {
      const email = String(body?.filter?.email_addresses ?? "").toLowerCase();
      const matched = state.people.filter((person) => emails(person).includes(email));
      return json(200, { data: matched.map(toApi) });
    }
    if (method === "PUT" && url.pathname === "/v2/objects/people/records") {
      const email = String(body?.data?.values?.email_addresses?.[0]?.email_address ?? "").toLowerCase();
      let person = state.people.find((item) => emails(item).includes(email));
      if (!person) {
        person = { id: `person-${++state.sequence}`, values: {} };
        state.people.push(person);
      }
      person.values = body?.data?.values ?? {};
      return json(200, { data: toApi(person) });
    }
    const companyEntries = url.pathname.match(/^\/v2\/objects\/companies\/records\/([^/]+)\/entries$/);
    if (companyEntries && method === "GET") {
      const data = state.entries
        .filter((entry) => entry.parent === companyEntries[1])
        .map((entry) => ({ list_id: entry.listId, list_api_slug: entry.slug }));
      return json(200, { data });
    }
    if (method === "POST" && url.pathname === `/v2/lists/${PITCH_COMPETITION_LIST.apiSlug}/entries`) {
      state.entries.push({
        parent: body?.data?.parent_record_id,
        slug: PITCH_COMPETITION_LIST.apiSlug,
        listId: PITCH_COMPETITION_LIST.listId,
        parentObject: body?.data?.parent_object,
        entryValues: body?.data?.entry_values,
      });
      return json(200, { data: { entry_id: "entry-new" } });
    }
    if (method === "GET" && url.pathname === "/v2/notes") {
      const parent = url.searchParams.get("parent_record_id");
      const parentObject = url.searchParams.get("parent_object");
      return json(200, {
        data: state.notes.filter((note) => note.parent === parent && note.parentObject === parentObject),
      });
    }
    if (method === "POST" && url.pathname === "/v2/notes") {
      state.notes.push({
        parentObject: body?.data?.parent_object,
        parent: body?.data?.parent_record_id,
        title: body?.data?.title,
        content: body?.data?.content,
      });
      return json(200, { data: { id: { note_id: `note-${++state.sequence}` } } });
    }
    if (method === "GET" && url.pathname === "/v2/tasks") {
      const linked = url.searchParams.get("linked_record_id");
      return json(200, {
        data: state.tasks.filter((task) => JSON.stringify(task.linked).includes(linked ?? "")),
      });
    }
    if (method === "POST" && url.pathname === "/v2/tasks") {
      const id = `task-${++state.sequence}`;
      state.tasks.push({
        id,
        content: body?.data?.content,
        linked: body?.data?.linked_records,
        assignees: body?.data?.assignees,
      });
      return json(200, { data: { id: { task_id: id } } });
    }
    const taskUpdate = url.pathname.match(/^\/v2\/tasks\/([^/]+)$/);
    if (taskUpdate && method === "PATCH") {
      if (state.failAssignee) return json(500, { message: "assignee rejected" });
      const task = state.tasks.find((item) => item.id === taskUpdate[1]);
      if (!task) return json(404, { message: "missing task" });
      task.assignees = body?.data?.assignees;
      return json(200, { data: { id: { task_id: task.id } } });
    }
    return json(500, { message: `Unhandled ${method} ${url.pathname}` });
  };
}

function emptyState(): MockState {
  return { people: [], companies: [], notes: [], entries: [], tasks: [], calls: [], sequence: 0 };
}

function pitchBody(overrides: Record<string, unknown> = {}) {
  return {
    form: "power-now",
    path: "pitch",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "",
    businessName: "Analytical Engines",
    city: "Carrollton",
    businessStage: "Prototype or testing",
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
  state: MockState,
  body: Record<string, unknown>,
  extras: { limiter?: ReturnType<typeof createPowerNowRateLimiter>; logs?: unknown[] } = {},
) {
  const logs = extras.logs ?? [];
  return handleExpoLeadHttp({
    method: "POST",
    origin: "http://localhost:3000",
    body,
    apiKey: API_KEY,
    fetchImpl: createAttio(state),
    now: NOW,
    ip: "203.0.113.10",
    rateLimiter: extras.limiter ?? { allow: () => true },
    consentLog: async (entry) => {
      logs.push(entry);
    },
  });
}

describe("Power NOW path allow-list", () => {
  it("rejects a path outside pitch, watch, and contribute", async () => {
    const state = emptyState();
    const result = await submit(state, pitchBody({ path: "sponsor" }));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false, error: "Choose pitch, watch, or contribute." });
    expect(state.calls).toEqual([]);
    expect(state.people).toHaveLength(0);
  });

  it("accepts each allow-listed path, including a different case", async () => {
    const state = emptyState();
    const pitch = await submit(state, pitchBody({ path: "PITCH" }));
    const watch = await submit(state, watchBody());
    const contribute = await submit(state, contributeBody());
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
    const state = emptyState();
    const logs: Array<{ consent: PowerNowConsentRecord[]; capturedAtEt: string }> = [];
    const result = await submit(state, pitchBody(), { logs });
    expect(result.status).toBe(200);
    const note = state.notes.find((item) => item.parentObject === "people");
    expect(note?.content).toContain("email: no");
    expect(note?.content).toContain("sms: no");
    expect(note?.content).toContain("phone: no");
    expect(note?.content).toContain(`Version: ${POWER_NOW_CONSENT_VERSION.pitch}`);
    expect(note?.content).toContain(`At (ET): ${CAPTURED_AT_ET}`);
    expect(note?.content).toContain(`Source: ${POWER_NOW_SOURCE}`);
    expect(note?.content).toContain(consentSentence("pitch", "email"));
    expect(note?.content).not.toContain("FORGED WORDING");
    expect(logs[0]?.capturedAtEt).toBe(CAPTURED_AT_ET);
    expect(logs[0]?.consent.map((item) => item.optIn)).toEqual([false, false, false]);
    expect(logs[0]?.consent.map((item) => item.version)).toEqual([
      POWER_NOW_CONSENT_VERSION.pitch,
      POWER_NOW_CONSENT_VERSION.pitch,
      POWER_NOW_CONSENT_VERSION.pitch,
    ]);
  });

  it("requires a phone number when text or phone is checked, and at least one watch channel", async () => {
    const state = emptyState();
    const sms = await submit(state, pitchBody({ consent: { email: false, sms: true, phone: false } }));
    expect(sms.status).toBe(400);
    expect(sms.body).toMatchObject({ error: "Please add a phone number, or uncheck text and phone." });

    const watch = await submit(state, watchBody({ consent: { email: false, sms: false, phone: true } }));
    expect(watch.status).toBe(400);
    expect(watch.body).toMatchObject({ error: POWER_NOW_WATCH_CONSENT_ERROR });
    expect(state.people).toHaveLength(0);

    const watched = await submit(state, watchBody({
      consent: { email: false, sms: true, phone: false },
      phone: "757-555-0199",
    }));
    expect(watched.status).toBe(200);
    const note = state.notes.find((item) => item.content.includes(WATCH_ID));
    expect(note?.content).toContain("sms: yes");
    expect(note?.content).toContain(`Version: ${POWER_NOW_CONSENT_VERSION.watch}`);
    expect(note?.content).toContain("Phone: +17575550199");
    expect(note?.content).not.toContain("phone: yes");
    expect(note?.content).not.toContain("phone: no");
  });
});

describe("Power NOW Attio payload mapping", () => {
  it("maps a pitch onto a person, a company, and the existing Pitch Competition list", async () => {
    const state = emptyState();
    const logs: Array<{ flags: string[]; listStatus: string }> = [];
    const result = await submit(state, pitchBody(), { logs });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      companyStatus: "created",
      listStatus: "added",
      noteStatus: "created",
      taskStatus: "created",
    });

    const person = state.people[0];
    expect(emails(person!)).toEqual(["ada@example.com"]);
    expect(text(person!, "description")).toContain("PN | path:pitch | interest | src:power-now-interest-page");
    expect(text(person!, "description")).toContain("utm:source=linkedin,medium=social,campaign=interest,content=post");
    expect(text(person!, "description")).toContain("ref:/updates");
    expect(text(person!, "description")).toContain(CAPTURED_AT_ET);
    expect(text(person!, "description")).toContain(`sub:${PITCH_ID}`);
    expect(person?.values.company).toEqual([
      { target_object: "companies", target_record_id: state.companies[0]?.id },
    ]);
    expect(text(state.companies[0]!, "name")).toBe("Analytical Engines");

    expect(state.entries).toEqual([
      {
        parent: state.companies[0]?.id,
        slug: "pitch_competition",
        listId: PITCH_COMPETITION_LIST.listId,
        parentObject: "companies",
        entryValues: {},
      },
    ]);

    const personNote = state.notes.find((note) => note.parentObject === "people");
    const companyNote = state.notes.find((note) => note.parentObject === "companies");
    expect(personNote?.title).toBe(`Power NOW pitch interest ${CAPTURED_AT_ET}`);
    expect(companyNote?.title).toBe(personNote?.title);
    expect(companyNote?.content).toBe(personNote?.content);
    expect(personNote?.content).toContain("What would you pitch?: A workshop kit for first customers.");
    expect(POWER_NOW_TASK_ASSIGNEE_DEFAULT_ID).toBe("2029a271-1072-4dd9-849e-6a32fdb71df5");
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.assignees).toEqual([jonathanAssignee()]);
    expect(state.tasks[0]?.linked).toEqual([
      { target_object: "people", target_record_id: person?.id },
      { target_object: "companies", target_record_id: state.companies[0]?.id },
    ]);
    expect(state.tasks[0]?.content).toContain("Power NOW pitch interest for Jessica.");
    expect(state.tasks[0]?.content).toContain("Name: Ada Lovelace");
    expect(state.tasks[0]?.content).toContain("Company: Analytical Engines");
    expect(state.tasks[0]?.content).toContain(`https://app.attio.com/accel-analysis/person/${person?.id}/overview`);
    expect(logs[0]?.listStatus).toBe("added");
  });

  it("skips the company when a pitcher has not named it, and does not open a pitch-list entry", async () => {
    const state = emptyState();
    const result = await submit(state, pitchBody({ businessName: "Not named yet." }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ companyStatus: "skipped", listStatus: "skipped" });
    expect(state.companies).toHaveLength(0);
    expect(state.entries).toHaveLength(0);
    expect(state.notes[0]?.content).toContain("unnamed-business");
    expect(state.notes[0]?.content).toContain("pitch-list-not-added");
    expect(state.tasks[0]?.content).toContain("Flags: unnamed-business, pitch-list-not-added");
    expect(state.tasks[0]?.assignees).toEqual([jonathanAssignee()]);
    expect(state.tasks[0]?.linked).toEqual([
      { target_object: "people", target_record_id: state.people[0]?.id },
    ]);
  });

  it("maps watch and contribute without adding them to Pitch Competition", async () => {
    const state = emptyState();
    const watch = await submit(state, watchBody({ company: "Navy Yard Lab" }));
    const contribute = await submit(state, contributeBody());
    expect(watch.status).toBe(200);
    expect(contribute.status).toBe(200);
    expect(watch.body).toMatchObject({ listStatus: "not_applicable", companyStatus: "created" });
    expect(contribute.body).toMatchObject({ listStatus: "not_applicable", companyStatus: "created" });
    expect(state.entries).toHaveLength(0);
    expect(state.calls.filter((call) => call.includes("/v2/lists/"))).toEqual([]);

    const watchPerson = state.people.find((person) => emails(person).includes("grace@example.com"));
    const contributePerson = state.people.find((person) => emails(person).includes("katherine@example.com"));
    expect(text(watchPerson!, "description")).toContain("PN | path:watch | src:power-now-interest-page | utm:none");
    expect(text(watchPerson!, "description")).not.toContain("prize-offer");
    expect(text(contributePerson!, "description")).toContain("PN | path:contribute | prize-offer | src:power-now-interest-page");
    const contributeNote = state.notes.find((note) => note.content.includes(CONTRIB_ID) && note.parentObject === "people");
    expect(contributeNote?.content).toContain(`Version: ${POWER_NOW_CONSENT_VERSION.contribute}`);
    expect(contributeNote?.content).toContain("sms: yes");
    expect(contributeNote?.content).toContain("Approximate value: 80");
    expect(contributeNote?.content).toContain("Describe your offer: A studio tour for two");

    const watchTask = state.tasks.find((task) => task.content.startsWith("Power NOW watch"));
    const contributeTask = state.tasks.find((task) => task.content.startsWith("Power NOW contribute"));
    expect(watchTask?.assignees).toEqual([jonathanAssignee()]);
    expect(watchTask?.linked).toEqual([
      { target_object: "people", target_record_id: watchPerson?.id },
      { target_object: "companies", target_record_id: state.companies.find((company) => text(company, "name") === "Navy Yard Lab")?.id },
    ]);
    expect(contributeTask?.assignees).toEqual([jonathanAssignee()]);
    expect(contributeTask?.linked).toEqual([
      { target_object: "people", target_record_id: contributePerson?.id },
      { target_object: "companies", target_record_id: state.companies.find((company) => text(company, "name") === "Harbor Goods")?.id },
    ]);
  });

  it("keeps an earlier path tag when the same person joins a second path", async () => {
    const state = emptyState();
    await submit(state, pitchBody());
    const second = await submit(state, watchBody({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      clientSubmissionId: WATCH_ID,
    }));
    expect(second.body).toMatchObject({ action: "updated" });
    expect(state.people).toHaveLength(1);
    const description = text(state.people[0]!, "description");
    expect(description).toContain("path:pitch");
    expect(description).toContain("path:watch");
  });

  it("still saves the submission when assigning the task fails", async () => {
    const state = emptyState();
    state.failAssignee = true;
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message) => {
      errors.push(String(message));
    });
    try {
      const result = await submit(state, pitchBody());
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ ok: true, taskStatus: "created", noteStatus: "created" });
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0]?.assignees).toBeUndefined();
      expect(state.tasks[0]?.linked).toEqual([
        { target_object: "people", target_record_id: state.people[0]?.id },
        { target_object: "companies", target_record_id: state.companies[0]?.id },
      ]);
      expect(state.notes.filter((note) => note.parentObject === "people")).toHaveLength(1);
      expect(errors.some((message) => message.includes("left unassigned") && message.includes("assignee rejected"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("uses POWER_NOW_TASK_ASSIGNEE_ID when it is set", async () => {
    const override = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const previous = process.env.POWER_NOW_TASK_ASSIGNEE_ID;
    process.env.POWER_NOW_TASK_ASSIGNEE_ID = override;
    try {
      const state = emptyState();
      const result = await submit(state, watchBody());
      expect(result.status).toBe(200);
      expect(state.tasks[0]?.content).toContain("Power NOW watch interest for Jessica.");
      expect(state.tasks[0]?.assignees).toEqual([
        { referenced_actor_type: "workspace-member", referenced_actor_id: override },
      ]);
    } finally {
      if (previous === undefined) delete process.env.POWER_NOW_TASK_ASSIGNEE_ID;
      else process.env.POWER_NOW_TASK_ASSIGNEE_ID = previous;
    }
  });

  it("does not write a second note or task for the same submission", async () => {
    const state = emptyState();
    await submit(state, pitchBody());
    const again = await submit(state, pitchBody());
    expect(again.body).toMatchObject({ noteStatus: "already_recorded", taskStatus: "already_recorded" });
    expect(state.notes.filter((note) => note.parentObject === "people")).toHaveLength(1);
    expect(state.tasks).toHaveLength(1);
  });

  it("drops a honeypot and a burst over the rate limit before Attio", async () => {
    const state = emptyState();
    const honeypot = await submit(state, pitchBody({ expo_hp: "https://spam.example" }));
    expect(honeypot.status).toBe(200);
    expect(honeypot.body).toMatchObject({ ok: true, accepted: true });
    expect(state.calls).toEqual([]);

    const limiter = createPowerNowRateLimiter({ limit: 1, now: () => NOW.getTime() });
    const first = await submit(state, pitchBody(), { limiter });
    const second = await submit(state, pitchBody({ clientSubmissionId: WATCH_ID }), { limiter });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ ok: false });
    expect(state.people).toHaveLength(1);
  });

  it("leaves personal data out of the tag when a referrer tries to carry it", async () => {
    const state = emptyState();
    await submit(state, pitchBody({
      referrerPath: "/updates?email=ada@example.com",
      utmSource: "ada@example.com",
    }));
    const description = text(state.people[0]!, "description");
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
    expect(page).not.toMatch(/\bbookings\b/i);
    expect(page).not.toMatch(/\bfree\b/i);
    expect(page).not.toContain('type="date"');
    expect(page).not.toContain("hi-coworking.com");
    expect(`${page}\n${css}`).not.toMatch(/\$\d/);
    expect(firebase).toContain('"functionId": "expo_submitNasaLead"');
    expect(rules).toContain("powerNowConsentLog");
    expect(appEntries.some((name) => name.startsWith("sitemap"))).toBe(false);
    expect(POWER_NOW_SEND_ERROR).toContain("hello@accelanalysis.com");
  });
});

function jonathanAssignee() {
  return {
    referenced_actor_type: "workspace-member",
    referenced_actor_id: POWER_NOW_TASK_ASSIGNEE_DEFAULT_ID,
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

function text(record: StoredRecord, slug: string): string {
  const first = record.values[slug]?.[0] as { value?: string } | undefined;
  return first?.value ?? "";
}

function emails(record: StoredRecord | undefined): string[] {
  if (!record) return [];
  return (record.values.email_addresses ?? []).map((value) =>
    String((value as { email_address?: string }).email_address ?? ""),
  );
}
