import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleExpoLeadHttp } from "../../apps/functions/src/expo/nasaLeadIngest";
import {
  CONFIRMATION_FAILURE_PREFIX,
  CONFIRMATION_TEMPLATE_VERSION,
  POWER_NOW_DEFAULT_DAILY_CAP,
  POWER_NOW_DEFAULT_FROM,
  POWER_NOW_DEFAULT_REPLY_TO,
  buildPowerNowConfirmationMessage,
  confirmationDailyCap,
  confirmationDedupeKey,
  confirmationFrom,
  confirmationProvider,
  createMemoryConfirmationStore,
  decideReservation,
  listUnsubscribeValue,
  powerNowEmailHash,
  sendWithGraph,
  sendWithResend,
  verifyRecaptchaEnterprise,
  type MemoryConfirmationStore,
} from "../../apps/functions/src/expo/powerNowConfirmation";
import { PITCH_COMPETITION_LIST } from "../../apps/functions/src/expo/powerNowModel";

const NOW = new Date("2026-10-07T21:35:00.000Z");
const API_KEY = "test-key";
const PITCH_ID = "11111111-1111-4111-8111-111111111111";
const WATCH_ID = "22222222-2222-4222-8222-222222222222";
const CONTRIB_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_ID = "44444444-4444-4444-8444-444444444444";

type StoredRecord = { id: string; values: Record<string, unknown[]> };
type MockState = {
  people: StoredRecord[];
  companies: StoredRecord[];
  notes: Array<{ parentObject: string; parent: string; title: string; content: string }>;
  entries: unknown[];
  tasks: Array<{ id: string; content: string; linked: unknown; assignees?: unknown }>;
  sequence: number;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function createAttio(state: MockState): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : undefined;
    const headers = new Headers(init?.headers);
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
      const addresses = (body?.data?.values?.email_addresses ?? []) as Array<{ email_address?: string }>;
      const wanted = addresses.map((item) => String(item.email_address ?? "").toLowerCase());
      let person = state.people.find((item) => emails(item).some((email) => wanted.includes(email)));
      if (!person) {
        person = { id: `person-${++state.sequence}`, values: {} };
        state.people.push(person);
      }
      person.values = body?.data?.values ?? {};
      return json(200, { data: toApi(person) });
    }
    if (method === "GET" && url.pathname.includes("/entries")) return json(200, { data: [] });
    if (method === "POST" && url.pathname === `/v2/lists/${PITCH_COMPETITION_LIST.apiSlug}/entries`) {
      state.entries.push(body);
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
      state.tasks.push({ id, content: body?.data?.content, linked: body?.data?.linked_records });
      return json(200, { data: { id: { task_id: id } } });
    }
    const taskUpdate = url.pathname.match(/^\/v2\/tasks\/([^/]+)$/);
    if (taskUpdate && method === "PATCH") {
      const task = state.tasks.find((item) => item.id === taskUpdate[1]);
      if (!task) return json(404, { message: "missing task" });
      if (body?.data?.assignees) task.assignees = body.data.assignees;
      if (typeof body?.data?.content === "string") task.content = body.data.content;
      return json(200, { data: { id: { task_id: task.id } } });
    }
    return json(500, { message: `Unhandled ${method} ${url.pathname}` });
  };
}

function emptyState(): MockState {
  return { people: [], companies: [], notes: [], entries: [], tasks: [], sequence: 0 };
}

function text(record: StoredRecord, slug: string): string {
  const value = record.values[slug]?.[0] as { value?: string } | undefined;
  return value?.value ?? "";
}

function emails(record: StoredRecord): string[] {
  return (record.values.email_addresses ?? []).map((value) => String((value as { email_address?: string }).email_address ?? "").toLowerCase());
}

function toApi(record: StoredRecord) {
  return { id: { record_id: record.id }, values: record.values };
}

function enabledEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    POWER_NOW_CONFIRMATION_EMAIL_ENABLED: "true",
    RESEND_API_KEY: "test-resend-key",
    RECAPTCHA_ENTERPRISE_SITE_KEY: "site-key",
    RECAPTCHA_ENTERPRISE_API_KEY: "captcha-key",
    ...overrides,
  };
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
    progress: "",
    heardAbout: "",
    heardAboutOther: "",
    consent: { email: false, sms: false, phone: false },
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    referrerPath: "",
    submittedAt: NOW.toISOString(),
    clientSubmissionId: PITCH_ID,
    pnStartedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    recaptchaToken: "captcha-token",
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
    submittedAt: NOW.toISOString(),
    clientSubmissionId: WATCH_ID,
    pnStartedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    recaptchaToken: "captcha-token",
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
    website: "",
    heardAbout: "",
    consent: { email: false, sms: false, phone: false },
    submittedAt: NOW.toISOString(),
    clientSubmissionId: CONTRIB_ID,
    pnStartedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    recaptchaToken: "captcha-token",
    ...overrides,
  };
}

function mailRecorder(mode: "ok" | "fail" = "ok") {
  const calls: Array<{ url: string; headers: Headers; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    });
    if (mode === "fail") return json(500, { message: "provider down" });
    if (String(input).includes("graph.microsoft.com")) return json(202, {});
    if (String(input).includes("login.microsoftonline.com")) return json(200, { access_token: "graph-token" });
    return json(200, { id: "re_test_123" });
  };
  return { calls, fetchImpl };
}

async function submit(
  state: MockState,
  body: Record<string, unknown>,
  extras: {
    env?: NodeJS.ProcessEnv;
    store?: MemoryConfirmationStore;
    mail?: ReturnType<typeof mailRecorder>;
    ip?: string;
    verify?: boolean;
  } = {},
) {
  const mail = extras.mail ?? mailRecorder();
  const result = await handleExpoLeadHttp({
    method: "POST",
    origin: "http://localhost:3000",
    body,
    apiKey: API_KEY,
    fetchImpl: createAttio(state),
    now: NOW,
    ip: extras.ip ?? "203.0.113.10",
    rateLimiter: { allow: () => true },
    consentLog: async () => undefined,
    confirmation: {
      env: extras.env ?? enabledEnv(),
      mailFetch: mail.fetchImpl,
      store: extras.store ?? createMemoryConfirmationStore(),
      resolveMx: async () => [{ exchange: "mx.example.com", priority: 10 }],
      ...(extras.verify === false
        ? {}
        : { verifyCaptcha: async () => ({ ok: true as const }) }),
    },
  });
  return { result, mail };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Power NOW confirmation templates", () => {
  it("keeps each Step 1 subject, sentence, footer, and a small hosted image", () => {
    const cases = [
      {
        path: "pitch" as const,
        name: "Ada Lovelace",
        sentence: "Joining the list doesn't reserve a pitch slot.",
      },
      {
        path: "watch" as const,
        name: "Grace Hopper",
        sentence: "Upcoming pitch nights are held online through the year.",
      },
      {
        path: "contribute" as const,
        name: "Katherine Johnson",
        sentence: "Nothing is final until we've done that together.",
      },
    ];
    for (const item of cases) {
      const message = buildPowerNowConfirmationMessage({
        path: item.path,
        fullName: item.name,
        assetBaseUrl: "https://hi-coworking.com",
        replyTo: POWER_NOW_DEFAULT_REPLY_TO,
      });
      expect(message.subject).toBe(
        item.path === "pitch"
          ? "We got your Power NOW pitch interest"
          : item.path === "watch"
            ? "You're on the Power NOW audience list"
            : "Thanks for your Power NOW prize pack offer",
      );
      expect(message.version).toBe(CONFIRMATION_TEMPLATE_VERSION[item.path]);
      expect(message.text).toContain(`Hi ${item.name.split(" ")[0]},`);
      expect(message.text).toContain(item.sentence);
      expect(message.html).toContain(item.sentence);
      expect(message.text).toContain("Reply with 'unsubscribe' to stop Power NOW emails.");
      expect(message.text).toContain("15373 Carrollton Blvd, Carrollton, VA 23314");
      expect(message.text).not.toContain("Know a founder who should pitch at Power NOW?");
      expect(message.html).not.toContain("data:image");
      expect(message.html).toContain("https://hi-coworking.com/power-now/power-now-logo-lockup.jpg");
      expect(Buffer.byteLength(message.html, "utf8")).toBeLessThan(100_000);
      expect(message.listUnsubscribe).toBe("<mailto:hello@accelanalysis.com?subject=unsubscribe>");
    }
    const fallback = buildPowerNowConfirmationMessage({
      path: "pitch",
      fullName: "",
      assetBaseUrl: "https://hi-coworking.com",
      replyTo: POWER_NOW_DEFAULT_REPLY_TO,
    });
    expect(fallback.text.startsWith("Hi there,")).toBe(true);
  });
});

describe("Power NOW confirmation delivery", () => {
  it("sends nothing and leaves the person payload unchanged when the flag is off", async () => {
    const state = emptyState();
    state.people.push({
      id: "person-existing",
      values: {
        email_addresses: [
          { email_address: "old@example.com" },
          { email_address: "ada@example.com" },
        ],
        description: [{ value: "Existing" }],
      },
    });
    const mail = mailRecorder();
    const { result } = await submit(state, pitchBody({ recaptchaToken: "should-not-echo" }), {
      env: {},
      mail,
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain("ada@example.com");
    expect(mail.calls).toHaveLength(0);
    expect(emails(state.people[0]!)).toEqual(["ada@example.com"]);
    expect(state.notes.some((note) => note.title === "Power NOW confirmation email")).toBe(false);
    expect(state.tasks[0]?.content.startsWith(CONFIRMATION_FAILURE_PREFIX)).toBe(false);
    expect(state.notes.map((note) => note.content).join("\n")).not.toContain("should-not-echo");
  });

  it("sends each path's template and records it on the person without echoing the email", async () => {
    const state = emptyState();
    const store = createMemoryConfirmationStore();
    const mail = mailRecorder();
    const pitch = await submit(state, pitchBody(), { store, mail });
    const watch = await submit(state, watchBody(), { store, mail });
    const contribute = await submit(state, contributeBody(), { store, mail });
    expect(pitch.result.status).toBe(200);
    expect(watch.result.status).toBe(200);
    expect(contribute.result.status).toBe(200);
    expect(JSON.stringify(pitch.result.body)).not.toContain("ada@example.com");
    expect(mail.calls.map((call) => call.url)).toEqual([
      "https://api.resend.com/emails",
      "https://api.resend.com/emails",
      "https://api.resend.com/emails",
    ]);
    const subjects = mail.calls.map((call) => JSON.parse(call.body).subject);
    expect(subjects).toEqual([
      "We got your Power NOW pitch interest",
      "You're on the Power NOW audience list",
      "Thanks for your Power NOW prize pack offer",
    ]);
    const pitchCall = JSON.parse(mail.calls[0]!.body);
    expect(pitchCall.from).toBe(POWER_NOW_DEFAULT_FROM);
    expect(pitchCall.reply_to).toBe(POWER_NOW_DEFAULT_REPLY_TO);
    expect(pitchCall.to).toEqual(["ada@example.com"]);
    expect(pitchCall.text).toContain("Joining the list doesn't reserve a pitch slot.");
    expect(pitchCall.headers["List-Unsubscribe"]).toBe(listUnsubscribeValue(POWER_NOW_DEFAULT_REPLY_TO));
    expect(mail.calls[0]!.headers.get("authorization")).toBe("Bearer test-resend-key");
    expect(mail.calls[0]!.headers.get("idempotency-key")).toBe(confirmationDedupeKey("ada@example.com", "pitch", NOW));
    const notes = state.notes.filter((note) => note.title === "Power NOW confirmation email");
    expect(notes.map((note) => note.content)).toEqual([
      expect.stringContaining("Template: PN-CONFIRM-PITCH-v1"),
      expect.stringContaining("Template: PN-CONFIRM-WATCH-v1"),
      expect.stringContaining("Template: PN-CONFIRM-CONTRIB-v1"),
    ]);
    expect(notes[0]?.content).toContain("Provider message id: re_test_123");
    expect(notes[0]?.content).toContain("Sender: Accel Analysis <hello@accelanalysis.com>");
    expect(notes[0]?.content).toContain("Sent (ET):");
    expect(notes[0]?.content).toContain("Path: pitch");
    expect(notes[0]?.content).not.toContain("ada@example.com");
  });

  it("makes the submitted address the primary email when sending is on", async () => {
    const state = emptyState();
    state.people.push({
      id: "person-existing",
      values: {
        email_addresses: [
          { email_address: "old@example.com" },
          { email_address: "ada@example.com" },
        ],
        description: [{ value: "Existing" }],
      },
    });
    const { result } = await submit(state, pitchBody());
    expect(result.status).toBe(200);
    const addresses = state.people[0]!.values.email_addresses as Array<{ email_address: string }>;
    expect(addresses.map((item) => item.email_address)).toEqual(["ada@example.com", "old@example.com"]);
  });

  it("saves the submission and flags the task when the provider rejects the send", async () => {
    const state = emptyState();
    const mail = mailRecorder("fail");
    const { result } = await submit(state, pitchBody(), { mail });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, accepted: true, path: "pitch" });
    expect(JSON.stringify(result.body)).not.toContain("ada@example.com");
    expect(state.people).toHaveLength(1);
    expect(state.tasks[0]?.content.startsWith(CONFIRMATION_FAILURE_PREFIX)).toBe(true);
    expect(state.tasks[0]?.content).toContain("Power NOW pitch interest for Jessica.");
    const failure = state.notes.find((note) => note.title === "Power NOW confirmation email failed");
    expect(failure?.content).toContain("Error class: ResendRejected");
    expect(failure?.content).not.toContain("ada@example.com");
    const logged = vi.mocked(console.error).mock.calls.map((call) => JSON.stringify(call));
    expect(logged.some((line) => line.includes("ada@example.com"))).toBe(false);
    expect(logged.some((line) => line.includes("ResendRejected"))).toBe(true);
  });

  it("blocks a second confirmation for the same address and path, and a suppressed address", async () => {
    const state = emptyState();
    const store = createMemoryConfirmationStore();
    const mail = mailRecorder();
    const first = await submit(state, pitchBody(), { store, mail });
    const second = await submit(state, pitchBody({ clientSubmissionId: SECOND_ID }), { store, mail });
    expect(first.result.status).toBe(200);
    expect(second.result.status).toBe(200);
    expect(mail.calls).toHaveLength(1);
    expect(state.tasks.every((task) => !task.content.startsWith(CONFIRMATION_FAILURE_PREFIX))).toBe(true);

    const suppressed = createMemoryConfirmationStore();
    suppressed.suppress(powerNowEmailHash("ada@example.com"));
    const quiet = mailRecorder();
    const blocked = await submit(emptyState(), pitchBody({ clientSubmissionId: SECOND_ID }), {
      store: suppressed,
      mail: quiet,
    });
    expect(blocked.result.status).toBe(200);
    expect(quiet.calls).toHaveLength(0);
    expect(blocked.result.body).toMatchObject({ ok: true });
  });

  it("flags the task when Graph is selected without M365 secrets, and still saves the submission", async () => {
    const state = emptyState();
    const mail = mailRecorder();
    const { result } = await submit(state, pitchBody(), {
      env: enabledEnv({ POWER_NOW_EMAIL_PROVIDER: "graph" }),
      mail,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, accepted: true, path: "pitch" });
    expect(JSON.stringify(result.body)).not.toContain("ada@example.com");
    expect(state.people).toHaveLength(1);
    expect(mail.calls).toHaveLength(0);
    expect(state.tasks[0]?.content.startsWith(CONFIRMATION_FAILURE_PREFIX)).toBe(true);
    const failure = state.notes.find((note) => note.title === "Power NOW confirmation email failed");
    expect(failure?.content).toContain("Error class: ProviderUnconfigured");
    expect(failure?.content).not.toContain("ada@example.com");
  });

  it("flags the task the same way when the Resend key is missing", async () => {
    const state = emptyState();
    const mail = mailRecorder();
    const env = enabledEnv();
    delete env.RESEND_API_KEY;
    const { result } = await submit(state, pitchBody(), { env, mail });
    expect(result.status).toBe(200);
    expect(state.people).toHaveLength(1);
    expect(mail.calls).toHaveLength(0);
    expect(state.tasks[0]?.content.startsWith(CONFIRMATION_FAILURE_PREFIX)).toBe(true);
    expect(state.notes.find((note) => note.title === "Power NOW confirmation email failed")?.content).toContain(
      "Error class: ProviderUnconfigured",
    );
  });

  it("sends through Graph when the mailbox secrets are present in the environment", async () => {
    const state = emptyState();
    const mail = mailRecorder();
    const { result } = await submit(state, pitchBody(), {
      env: enabledEnv({
        POWER_NOW_EMAIL_PROVIDER: "graph",
        M365_TENANT_ID: "tenant-1",
        M365_CLIENT_ID: "client-1",
        M365_CLIENT_SECRET: "secret-1",
      }),
      mail,
    });
    expect(result.status).toBe(200);
    expect(mail.calls.map((call) => call.url)).toEqual([
      "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token",
      "https://graph.microsoft.com/v1.0/users/hello%40accelanalysis.com/sendMail",
    ]);
    expect(state.tasks[0]?.content.startsWith(CONFIRMATION_FAILURE_PREFIX)).toBe(false);
    expect(JSON.parse(mail.calls[1]!.body).saveToSentItems).toBe(true);
  });

  it("skips the email when captcha is not configured and still saves the submission", async () => {
    const state = emptyState();
    const mail = mailRecorder();
    const { result } = await submit(state, pitchBody(), {
      env: enabledEnv({
        RECAPTCHA_ENTERPRISE_SITE_KEY: "",
        RECAPTCHA_ENTERPRISE_API_KEY: "",
      }),
      mail,
      verify: false,
    });
    expect(result.status).toBe(200);
    expect(state.people).toHaveLength(1);
    expect(mail.calls).toHaveLength(0);
    expect(state.tasks[0]?.content.startsWith(CONFIRMATION_FAILURE_PREFIX)).toBe(false);
  });

  it("skips role addresses, disposable domains, a failed MX lookup, and a too-fast submit", async () => {
    const mail = mailRecorder();
    const role = await submit(emptyState(), pitchBody({ email: "info@example.com" }), { mail });
    const disposable = await submit(emptyState(), pitchBody({ email: "ada@mailinator.com", clientSubmissionId: SECOND_ID }), { mail });
    const fast = await submit(emptyState(), pitchBody({ clientSubmissionId: WATCH_ID, pnStartedAt: NOW.toISOString() }), { mail });
    expect(role.result.status).toBe(200);
    expect(disposable.result.status).toBe(200);
    expect(fast.result.status).toBe(200);
    expect(mail.calls).toHaveLength(0);

    const mxState = emptyState();
    const mxMail = mailRecorder();
    const mx = await handleExpoLeadHttp({
      method: "POST",
      origin: "http://localhost:3000",
      body: pitchBody({ clientSubmissionId: CONTRIB_ID }),
      apiKey: API_KEY,
      fetchImpl: createAttio(mxState),
      now: NOW,
      ip: "203.0.113.20",
      rateLimiter: { allow: () => true },
      consentLog: async () => undefined,
      confirmation: {
        env: enabledEnv(),
        mailFetch: mxMail.fetchImpl,
        store: createMemoryConfirmationStore(),
        resolveMx: async () => [],
        verifyCaptcha: async () => ({ ok: true }),
      },
    });
    expect(mx.status).toBe(200);
    expect(mxState.people).toHaveLength(1);
    expect(mxMail.calls).toHaveLength(0);
  });

  it("sends only to addresses on the test allow-list", async () => {
    const mail = mailRecorder();
    const store = createMemoryConfirmationStore();
    const env = enabledEnv({ POWER_NOW_CONFIRMATION_TEST_RECIPIENTS: "qa@example.com, other@example.com" });
    const skipped = await submit(emptyState(), pitchBody(), { mail, store, env });
    const allowed = await submit(emptyState(), pitchBody({
      email: "qa@example.com",
      fullName: "Quincy Adams",
      clientSubmissionId: SECOND_ID,
    }), { mail, store, env });
    expect(skipped.result.status).toBe(200);
    expect(allowed.result.status).toBe(200);
    expect(mail.calls).toHaveLength(1);
    expect(JSON.parse(mail.calls[0]!.body).to).toEqual(["qa@example.com"]);
    expect(skipped.result.body && JSON.stringify(skipped.result.body)).not.toContain("ada@example.com");
  });

  it("does not send when the honeypot is filled", async () => {
    const state = emptyState();
    const mail = mailRecorder();
    const { result } = await submit(state, pitchBody({ pn_hp: "http://spam.example" }), { mail });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, accepted: true });
    expect(state.people).toHaveLength(0);
    expect(mail.calls).toHaveLength(0);
  });
});

describe("Power NOW mail adapters", () => {
  it("posts to Resend with a bearer key and the dedupe key", async () => {
    const seen: Array<{ url: string; headers: Headers; body: string }> = [];
    const messageId = await sendWithResend(async (input, init) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return json(200, { id: "re_adapter" });
    }, "secret-key", {
      from: POWER_NOW_DEFAULT_FROM,
      to: "ada@example.com",
      replyTo: POWER_NOW_DEFAULT_REPLY_TO,
      subject: "We got your Power NOW pitch interest",
      html: "<p>Hi Ada,</p>",
      text: "Hi Ada,",
      listUnsubscribe: listUnsubscribeValue(POWER_NOW_DEFAULT_REPLY_TO),
      idempotencyKey: "pn-confirm:abc:pitch:2026-10-07",
    });
    expect(messageId).toBe("re_adapter");
    expect(seen[0]?.url).toBe("https://api.resend.com/emails");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer secret-key");
    expect(seen[0]?.headers.get("idempotency-key")).toBe("pn-confirm:abc:pitch:2026-10-07");
    expect(JSON.parse(seen[0]!.body).headers["List-Unsubscribe"]).toContain("mailto:hello@accelanalysis.com");
  });

  it("sends through Graph with client credentials and saveToSentItems", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const messageId = await sendWithGraph(async (input, init) => {
      seen.push({ url: String(input), body: String(init?.body ?? "") });
      if (String(input).includes("/token")) return json(200, { access_token: "token-1" });
      return json(202, {});
    }, {
      tenantId: "tenant-1",
      clientId: "client-1",
      clientSecret: "secret-1",
    }, {
      from: POWER_NOW_DEFAULT_FROM,
      to: "ada@example.com",
      replyTo: POWER_NOW_DEFAULT_REPLY_TO,
      subject: "We got your Power NOW pitch interest",
      html: "<p>Hi Ada,</p>",
      listUnsubscribe: "<mailto:hello@accelanalysis.com?subject=unsubscribe>",
      idempotencyKey: "pn-confirm:abc:pitch:2026-10-07",
    });
    expect(seen[0]?.url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(seen[0]?.body).toContain("client_id=client-1");
    expect(seen[0]?.body).toContain("grant_type=client_credentials");
    expect(seen[1]?.url).toBe("https://graph.microsoft.com/v1.0/users/hello%40accelanalysis.com/sendMail");
    const payload = JSON.parse(seen[1]!.body);
    expect(payload.saveToSentItems).toBe(true);
    expect(payload.message.from.emailAddress.address).toBe("hello@accelanalysis.com");
    expect(payload.message.internetMessageHeaders[0].value).toContain("mailto:hello@accelanalysis.com");
    expect(messageId).toBe("graph:pn-confirm:abc:pitch:2026-10-07");
  });

  it("treats a low captcha score as rejected and a missing config as unconfigured", async () => {
    const rejected = await verifyRecaptchaEnterprise({
      token: "token",
      env: {
        RECAPTCHA_ENTERPRISE_SITE_KEY: "site",
        RECAPTCHA_ENTERPRISE_API_KEY: "api",
        POWER_NOW_RECAPTCHA_MIN_SCORE: "0.5",
      },
      fetchImpl: async () => json(200, {
        tokenProperties: { valid: true, action: "power_now_submit" },
        riskAnalysis: { score: 0.1 },
      }),
    });
    expect(rejected).toEqual({ ok: false, errorClass: "CaptchaRejected" });
    const missing = await verifyRecaptchaEnterprise({
      token: "token",
      env: {},
      fetchImpl: async () => {
        throw new Error("should not call");
      },
    });
    expect(missing).toEqual({ ok: false, errorClass: "CaptchaUnconfigured" });
  });

  it("uses Resend, hello@, and a daily cap of 100 unless overridden", () => {
    expect(confirmationProvider({})).toBe("resend");
    expect(confirmationProvider({ POWER_NOW_EMAIL_PROVIDER: "graph" })).toBe("graph");
    expect(confirmationFrom({})).toBe(POWER_NOW_DEFAULT_FROM);
    expect(confirmationDailyCap({})).toBe(POWER_NOW_DEFAULT_DAILY_CAP);
    expect(POWER_NOW_DEFAULT_DAILY_CAP).toBe(100);
  });

  it("enforces the address window, the IP cap, and the global daily cap", () => {
    const windowMs = 24 * 60 * 60 * 1000;
    const now = NOW.getTime();
    const blocked = decideReservation(
      { addressSentAt: now - 60_000, ipHits: [], dailyCount: 0 },
      { nowMs: now, windowMs, ipCap: 20, dailyCap: 100 },
    );
    expect(blocked).toEqual({ allow: false, limit: "address" });
    const expired = decideReservation(
      { addressSentAt: now - windowMs - 1, ipHits: [], dailyCount: 0 },
      { nowMs: now, windowMs, ipCap: 20, dailyCap: 100 },
    );
    expect(expired.allow).toBe(true);
    const ip = decideReservation(
      { addressSentAt: null, ipHits: [now - 1000], dailyCount: 0 },
      { nowMs: now, windowMs, ipCap: 1, dailyCap: 100 },
    );
    expect(ip).toEqual({ allow: false, limit: "ip" });
    const daily = decideReservation(
      { addressSentAt: null, ipHits: [], dailyCount: 100 },
      { nowMs: now, windowMs, ipCap: 20, dailyCap: 100 },
    );
    expect(daily).toEqual({ allow: false, limit: "daily" });
  });
});

describe("Power NOW confirmation config surface", () => {
  it("documents the secret names and denies client access to the mail collections", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    expect(rules).toContain("powerNowEmailSuppression");
    expect(rules).toContain("powerNowEmailAddressWindow");
    expect(rules).toContain("powerNowEmailIpWindow");
    expect(rules).toContain("powerNowEmailDaily");
    const workflow = readFileSync(".github/workflows/firebase-live-expo-lead-function.yml", "utf8");
    const requiredSecrets = workflow.slice(workflow.indexOf("secrets=("), workflow.indexOf("for secret"));
    expect(requiredSecrets).toContain("RESEND_API_KEY");
    expect(requiredSecrets).toContain("RECAPTCHA_ENTERPRISE_API_KEY");
    expect(requiredSecrets).not.toContain("M365_");
    const bound = readFileSync("apps/functions/src/expo/powerNowConfirmationSecrets.ts", "utf8");
    expect(bound).toContain("RESEND_API_KEY");
    expect(bound).toContain("RECAPTCHA_ENTERPRISE_API_KEY");
    expect(bound).not.toContain('defineSecret("M365_TENANT_ID")');
    expect(bound).not.toContain('defineSecret("M365_CLIENT_ID")');
    expect(bound).not.toContain('defineSecret("M365_CLIENT_SECRET")');
    const docs = readFileSync("docs/POWER-NOW-CONFIRMATION-EMAIL.md", "utf8");
    expect(docs).toContain("shared mailbox");
    expect(docs).toContain("100 emails a day");
    expect(docs).toContain("DKIM");
    expect(docs).toContain("add those three secrets back to the function binding");
    expect(docs).toContain("optional and only for a later Graph switch");
  });
});
