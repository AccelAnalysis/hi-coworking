import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readIntakeLeadForTests, resetIntakeLeadMemoryForTests } from "../../apps/functions/src/expo/intakeLeadStore";
import { handleExpoLeadHttp } from "../../apps/functions/src/expo/nasaLeadIngest";
import {
  CONFIRMATION_TEMPLATE_VERSION,
  POWER_NOW_CONFIRMATION_TEST_RECIPIENT,
  POWER_NOW_DEFAULT_DAILY_CAP,
  POWER_NOW_DEFAULT_FROM,
  POWER_NOW_DEFAULT_REPLY_TO,
  POWER_NOW_RECAPTCHA_HOSTS,
  POWER_NOW_RECAPTCHA_SITE_KEY,
  buildPowerNowConfirmationMessage,
  confirmationDailyCap,
  confirmationDedupeKey,
  confirmationEmailEnabled,
  confirmationFrom,
  confirmationProvider,
  confirmationTestRecipients,
  createMemoryConfirmationStore,
  decideReservation,
  listUnsubscribeValue,
  powerNowEmailHash,
  sendWithGraph,
  sendWithResend,
  verifyRecaptchaEnterprise,
  type MemoryConfirmationStore,
} from "../../apps/functions/src/expo/powerNowConfirmation";
import {
  loadOptionalPowerNowSecrets,
  readPowerNowSecret,
  resetOptionalPowerNowSecretCache,
} from "../../apps/functions/src/expo/powerNowConfirmationSecrets";

const NOW = new Date("2026-10-07T21:35:00.000Z");
const PITCH_ID = "11111111-1111-4111-8111-111111111111";
const WATCH_ID = "22222222-2222-4222-8222-222222222222";
const CONTRIB_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_ID = "44444444-4444-4444-8444-444444444444";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function parseEnvFile(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
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
    state: "VA",
    businessStage: "Prototype or testing",
    businessStageOther: "",
    opportunityType: "starting_a_new_business",
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
    now: NOW,
    ip: extras.ip ?? "203.0.113.10",
    rateLimiter: { allow: () => true },
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
  resetIntakeLeadMemoryForTests();
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
  it("sends nothing when the flag is off and still saves the lead", async () => {
    const mail = mailRecorder();
    const { result } = await submit(pitchBody({ recaptchaToken: "should-not-echo" }), {
      env: {},
      mail,
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain("ada@example.com");
    expect(mail.calls).toHaveLength(0);
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
  });

  it("sends each path's template without echoing the email", async () => {
    const store = createMemoryConfirmationStore();
    const mail = mailRecorder();
    const pitch = await submit(pitchBody(), { store, mail });
    const watch = await submit(watchBody(), { store, mail });
    const contribute = await submit(contributeBody(), { store, mail });
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
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
    expect(readIntakeLeadForTests(WATCH_ID)?.email).toBe("grace@example.com");
    expect(readIntakeLeadForTests(CONTRIB_ID)?.email).toBe("katherine@example.com");
  });

  it("saves the submission when the provider rejects the send", async () => {
    const mail = mailRecorder("fail");
    const { result } = await submit(pitchBody(), { mail });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, accepted: true, path: "pitch" });
    expect(JSON.stringify(result.body)).not.toContain("ada@example.com");
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
    const logged = vi.mocked(console.error).mock.calls.map((call) => JSON.stringify(call));
    expect(logged.some((line) => line.includes("ada@example.com"))).toBe(false);
    expect(logged.some((line) => line.includes("ResendRejected"))).toBe(true);
  });

  it("blocks a second confirmation for the same address and path, and a suppressed address", async () => {
    const store = createMemoryConfirmationStore();
    const mail = mailRecorder();
    const first = await submit(pitchBody(), { store, mail });
    const second = await submit(pitchBody({ clientSubmissionId: SECOND_ID }), { store, mail });
    expect(first.result.status).toBe(200);
    expect(second.result.status).toBe(200);
    expect(mail.calls).toHaveLength(1);

    const suppressed = createMemoryConfirmationStore();
    suppressed.suppress(powerNowEmailHash("ada@example.com"));
    const quiet = mailRecorder();
    const blocked = await submit(pitchBody({ clientSubmissionId: SECOND_ID }), {
      store: suppressed,
      mail: quiet,
    });
    expect(blocked.result.status).toBe(200);
    expect(quiet.calls).toHaveLength(0);
    expect(blocked.result.body).toMatchObject({ ok: true });
  });

  it("still saves the submission when Graph is selected without M365 secrets", async () => {
    const mail = mailRecorder();
    const { result } = await submit(pitchBody(), {
      env: enabledEnv({ POWER_NOW_EMAIL_PROVIDER: "graph" }),
      mail,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, accepted: true, path: "pitch" });
    expect(JSON.stringify(result.body)).not.toContain("ada@example.com");
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
    expect(mail.calls).toHaveLength(0);
    const logged = vi.mocked(console.error).mock.calls.map((call) => JSON.stringify(call));
    expect(logged.some((line) => line.includes("ada@example.com"))).toBe(false);
  });

  it("still saves the submission when the Resend key is missing", async () => {
    const mail = mailRecorder();
    const env = enabledEnv();
    delete env.RESEND_API_KEY;
    const { result } = await submit(pitchBody(), { env, mail });
    expect(result.status).toBe(200);
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
    expect(mail.calls).toHaveLength(0);
  });

  it("sends through Graph when the mailbox secrets are present in the environment", async () => {
    const mail = mailRecorder();
    const { result } = await submit(pitchBody(), {
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
    expect(JSON.parse(mail.calls[1]!.body).saveToSentItems).toBe(true);
  });

  it("skips the email when captcha is not configured and still saves the submission", async () => {
    const mail = mailRecorder();
    const { result } = await submit(pitchBody(), {
      env: enabledEnv({
        RECAPTCHA_ENTERPRISE_SITE_KEY: "",
        RECAPTCHA_ENTERPRISE_API_KEY: "",
      }),
      mail,
      verify: false,
    });
    expect(result.status).toBe(200);
    expect(readIntakeLeadForTests(PITCH_ID)?.email).toBe("ada@example.com");
    expect(mail.calls).toHaveLength(0);
  });

  it("skips role addresses, disposable domains, a failed MX lookup, and a too-fast submit", async () => {
    const mail = mailRecorder();
    const role = await submit(pitchBody({ email: "info@example.com" }), { mail });
    const disposable = await submit(pitchBody({ email: "ada@mailinator.com", clientSubmissionId: SECOND_ID }), { mail });
    const fast = await submit(pitchBody({ clientSubmissionId: WATCH_ID, pnStartedAt: NOW.toISOString() }), { mail });
    expect(role.result.status).toBe(200);
    expect(disposable.result.status).toBe(200);
    expect(fast.result.status).toBe(200);
    expect(mail.calls).toHaveLength(0);

    const mxMail = mailRecorder();
    const mx = await handleExpoLeadHttp({
      method: "POST",
      origin: "http://localhost:3000",
      body: pitchBody({ clientSubmissionId: CONTRIB_ID }),
      now: NOW,
      ip: "203.0.113.20",
      rateLimiter: { allow: () => true },
      confirmation: {
        env: enabledEnv(),
        mailFetch: mxMail.fetchImpl,
        store: createMemoryConfirmationStore(),
        resolveMx: async () => [],
        verifyCaptcha: async () => ({ ok: true }),
      },
    });
    expect(mx.status).toBe(200);
    expect(readIntakeLeadForTests(CONTRIB_ID)?.email).toBe("ada@example.com");
    expect(mxMail.calls).toHaveLength(0);
  });

  it("sends only to addresses on the test allow-list", async () => {
    const mail = mailRecorder();
    const store = createMemoryConfirmationStore();
    const env = enabledEnv({ POWER_NOW_CONFIRMATION_TEST_RECIPIENTS: "qa@example.com, other@example.com" });
    const skipped = await submit(pitchBody(), { mail, store, env });
    const allowed = await submit(pitchBody({
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

  it("keeps the deployed expo-lead confirmation flag off and the jholman@ allow-list", async () => {
    const env = parseEnvFile("firebase/expo-lead-functions/.env.hi-coworking-plat");
    env.RESEND_API_KEY = "test-resend-key";
    env.RECAPTCHA_ENTERPRISE_API_KEY = "captcha-key";
    expect(env.POWER_NOW_CONFIRMATION_EMAIL_ENABLED).toBe("false");
    expect(confirmationEmailEnabled(env)).toBe(false);
    expect(confirmationTestRecipients(env)).toEqual(["jholman@accelanalysis.com"]);

    const mail = mailRecorder();
    const store = createMemoryConfirmationStore();
    const other = await submit(pitchBody(), { mail, store, env });
    const jonathan = await submit(pitchBody({
      email: "JHolman@AccelAnalysis.com",
      fullName: "Jonathan Holman",
      clientSubmissionId: "55555555-5555-4555-8555-555555555555",
    }), { mail, store, env });
    const secondOther = await submit(watchBody({
      email: "grace@example.com",
      clientSubmissionId: WATCH_ID,
    }), { mail, store, env });
    expect(other.result.status).toBe(200);
    expect(jonathan.result.status).toBe(200);
    expect(secondOther.result.status).toBe(200);
    expect(mail.calls).toHaveLength(0);
    expect(JSON.stringify(other.result.body)).not.toContain("ada@example.com");
    expect(JSON.stringify(secondOther.result.body)).not.toContain("grace@example.com");
  });

  it("sends a flag-on test only to jholman@accelanalysis.com", async () => {
    const mail = mailRecorder();
    const store = createMemoryConfirmationStore();
    const env = enabledEnv({
      POWER_NOW_CONFIRMATION_TEST_RECIPIENTS: POWER_NOW_CONFIRMATION_TEST_RECIPIENT,
    });
    const other = await submit(pitchBody(), { mail, store, env });
    const jonathan = await submit(pitchBody({
      email: "JHolman@AccelAnalysis.com",
      fullName: "Jonathan Holman",
      clientSubmissionId: "55555555-5555-4555-8555-555555555555",
    }), { mail, store, env });
    expect(other.result.status).toBe(200);
    expect(jonathan.result.status).toBe(200);
    expect(mail.calls).toHaveLength(1);
    expect(JSON.parse(mail.calls[0]!.body).to).toEqual(["jholman@accelanalysis.com"]);
  });

  it("does not send when the honeypot is filled", async () => {
    const mail = mailRecorder();
    const { result } = await submit(pitchBody({ pn_hp: "http://spam.example" }), { mail });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, accepted: true });
    expect(readIntakeLeadForTests(PITCH_ID)).toBeNull();
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
    for (const hostname of POWER_NOW_RECAPTCHA_HOSTS) {
      const accepted = await verifyRecaptchaEnterprise({
        token: "token",
        env: {
          RECAPTCHA_ENTERPRISE_SITE_KEY: "site",
          RECAPTCHA_ENTERPRISE_API_KEY: "api",
        },
        fetchImpl: async () => json(200, {
          tokenProperties: { valid: true, action: "power_now_submit", hostname },
          riskAnalysis: { score: 0.9 },
        }),
      });
      expect(accepted, hostname).toEqual({ ok: true });
    }
    const foreignHost = await verifyRecaptchaEnterprise({
      token: "token",
      env: {
        RECAPTCHA_ENTERPRISE_SITE_KEY: "site",
        RECAPTCHA_ENTERPRISE_API_KEY: "api",
      },
      fetchImpl: async () => json(200, {
        tokenProperties: { valid: true, action: "power_now_submit", hostname: "evil.example" },
        riskAnalysis: { score: 0.9 },
      }),
    });
    expect(foreignHost).toEqual({ ok: false, errorClass: "CaptchaRejected" });
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
    const optionalSecrets = workflow.slice(workflow.indexOf("secrets=("), workflow.indexOf("for secret"));
    expect(optionalSecrets).toContain("RESEND_API_KEY");
    expect(optionalSecrets).toContain("RECAPTCHA_ENTERPRISE_API_KEY");
    expect(optionalSecrets).not.toContain("exit 1");
    expect(optionalSecrets).not.toContain("M365_");
    expect(workflow).toContain("--config firebase.expo-lead.json");
    const bound = readFileSync("apps/functions/src/expo/powerNowConfirmationSecrets.ts", "utf8");
    expect(bound).toContain("RESEND_API_KEY");
    expect(bound).toContain("RECAPTCHA_ENTERPRISE_API_KEY");
    expect(bound).not.toMatch(/defineSecret\(\s*["']/);
    expect(bound).not.toContain('defineSecret("M365_TENANT_ID")');
    expect(bound).not.toContain('defineSecret("M365_CLIENT_ID")');
    expect(bound).not.toContain('defineSecret("M365_CLIENT_SECRET")');
    const docs = readFileSync("docs/POWER-NOW-CONFIRMATION-EMAIL.md", "utf8");
    expect(docs).toContain("shared mailbox");
    expect(docs).toContain("100 emails a day");
    expect(docs).toContain("DKIM");
    expect(docs).toContain("add those three secrets back to the function binding");
    expect(docs).toContain("optional and only for a later Graph switch");
    expect(docs).toContain("## Jonathan checklist");
    expect(docs).toContain("### 1. Resend DNS");
    expect(docs).toContain("### 2. Keys");
    expect(docs).toContain("### 3. reCAPTCHA Enterprise");
    expect(docs).toContain("### 4. Flag-on test to jholman@ only");
    expect(docs).toContain("POWER_NOW_CONFIRMATION_EMAIL_ENABLED=");
    expect(docs).toContain(`POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=${POWER_NOW_CONFIRMATION_TEST_RECIPIENT}`);
    expect(docs).toContain("RECAPTCHA_ENTERPRISE_SITE_KEY");
    expect(docs).toContain("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY");
    expect(docs).toContain("power_now_submit");
  });

  it("keeps the flag off and wires the flag-on test to jholman@ only", () => {
    expect(POWER_NOW_CONFIRMATION_TEST_RECIPIENT).toBe("jholman@accelanalysis.com");
    expect(confirmationEmailEnabled({})).toBe(false);
    expect(confirmationEmailEnabled({ POWER_NOW_CONFIRMATION_EMAIL_ENABLED: "true" })).toBe(true);
    expect(confirmationEmailEnabled({ POWER_NOW_CONFIRMATION_EMAIL_ENABLED: "" })).toBe(false);
    expect(confirmationTestRecipients({})).toBeNull();
    expect(confirmationTestRecipients({
      POWER_NOW_CONFIRMATION_TEST_RECIPIENTS: POWER_NOW_CONFIRMATION_TEST_RECIPIENT,
    })).toEqual(["jholman@accelanalysis.com"]);
    expect(confirmationTestRecipients({
      POWER_NOW_CONFIRMATION_TEST_RECIPIENTS: "JHolman@AccelAnalysis.com",
    })).toEqual(["jholman@accelanalysis.com"]);

    for (const envPath of [
      "apps/functions/.env.hi-coworking-plat",
      "apps/functions/.env.demo-hi-coworking",
    ]) {
      const envFile = readFileSync(envPath, "utf8");
      expect(envFile).toMatch(/^POWER_NOW_CONFIRMATION_EMAIL_ENABLED=$/m);
      expect(envFile).not.toMatch(/ATTIO_INTAKE_ENABLED/);
      expect(envFile).toMatch(/^POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=jholman@accelanalysis\.com$/m);
      expect(envFile).not.toMatch(/POWER_NOW_CONFIRMATION_EMAIL_ENABLED=true/);
      expect(envFile).not.toMatch(/^RESEND_API_KEY=/m);
      expect(envFile).not.toMatch(/^RECAPTCHA_ENTERPRISE_API_KEY=/m);
      expect(envFile).toMatch(new RegExp(`^RECAPTCHA_ENTERPRISE_SITE_KEY=${POWER_NOW_RECAPTCHA_SITE_KEY}$`, "m"));
      expect(envFile).not.toMatch(/^NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=/m);
    }

    const expoLeadEnv = readFileSync("firebase/expo-lead-functions/.env.hi-coworking-plat", "utf8");
    expect(expoLeadEnv).toMatch(/^POWER_NOW_CONFIRMATION_EMAIL_ENABLED=false$/m);
    expect(expoLeadEnv).not.toMatch(/POWER_NOW_CONFIRMATION_EMAIL_ENABLED=true/);
    expect(expoLeadEnv).not.toMatch(/TEMPORARY INBOX TEST/);
    expect(expoLeadEnv).not.toMatch(/ATTIO_INTAKE_ENABLED/);
    expect(expoLeadEnv).toMatch(/^POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=jholman@accelanalysis\.com$/m);
    expect(expoLeadEnv).toMatch(new RegExp(`^RECAPTCHA_ENTERPRISE_SITE_KEY=${POWER_NOW_RECAPTCHA_SITE_KEY}$`, "m"));
    expect(expoLeadEnv).not.toMatch(/^RESEND_API_KEY=/m);
    expect(expoLeadEnv).not.toMatch(/^RECAPTCHA_ENTERPRISE_API_KEY=/m);

    const webEnv = readFileSync("apps/web/.env.production", "utf8");
    const nextConfig = readFileSync("apps/web/next.config.ts", "utf8");
    expect(webEnv).toContain(`NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=${POWER_NOW_RECAPTCHA_SITE_KEY}`);
    expect(nextConfig).toContain(POWER_NOW_RECAPTCHA_SITE_KEY);
    expect(webEnv).not.toMatch(/^RESEND_API_KEY=/m);
    expect(webEnv).not.toMatch(/^RECAPTCHA_ENTERPRISE_API_KEY=/m);
    expect(POWER_NOW_RECAPTCHA_HOSTS).toEqual([
      "forms.accelanalysis.com",
      "hi-coworking.com",
      "www.hi-coworking.com",
    ]);

    const source = readFileSync("apps/functions/src/expo/powerNowConfirmation.ts", "utf8");
    expect(source).toContain('defineString("POWER_NOW_CONFIRMATION_EMAIL_ENABLED"');
    expect(source).toContain('default: ""');
    expect(source).toContain('defineString("POWER_NOW_CONFIRMATION_TEST_RECIPIENTS"');
    expect(source).toContain("default: POWER_NOW_CONFIRMATION_TEST_RECIPIENT");
    expect(source).toContain('defineString("RECAPTCHA_ENTERPRISE_SITE_KEY"');
    expect(source).toContain("default: POWER_NOW_RECAPTCHA_SITE_KEY");
  });

  it("reads an optional secret when it exists and warns with the Secret Manager code when it does not", async () => {
    const previousService = process.env.K_SERVICE;
    const previousResend = process.env.RESEND_API_KEY;
    const previousCaptcha = process.env.RECAPTCHA_ENTERPRISE_API_KEY;
    process.env.K_SERVICE = "expo_submitNasaLead";
    delete process.env.RESEND_API_KEY;
    delete process.env.RECAPTCHA_ENTERPRISE_API_KEY;
    resetOptionalPowerNowSecretCache();
    const warnings: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((message) => {
      warnings.push(String(message));
    });
    try {
      await loadOptionalPowerNowSecrets(process.env, async (input) => {
        const url = String(input);
        if (url.includes("metadata.google.internal")) {
          return json(200, { access_token: "ya29.test-token" });
        }
        if (url.includes("/secrets/RESEND_API_KEY/")) {
          return json(200, { payload: { data: Buffer.from("re_test_secret").toString("base64") } });
        }
        if (url.includes("/secrets/RECAPTCHA_ENTERPRISE_API_KEY/")) {
          return json(404, { error: { status: "NOT_FOUND" } });
        }
        return json(500, { error: { status: "INTERNAL" } });
      });
      expect(readPowerNowSecret("RESEND_API_KEY")).toBe("re_test_secret");
      expect(readPowerNowSecret("RECAPTCHA_ENTERPRISE_API_KEY")).toBeUndefined();
      expect(warnings.some((message) =>
        message.includes("RECAPTCHA_ENTERPRISE_API_KEY") && message.includes("NOT_FOUND"),
      )).toBe(true);
      expect(warnings.join("\n")).not.toContain("re_test_secret");
      expect(warnings.join("\n")).not.toContain("ya29.test-token");
    } finally {
      spy.mockRestore();
      resetOptionalPowerNowSecretCache();
      if (previousService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = previousService;
      if (previousResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResend;
      if (previousCaptcha === undefined) delete process.env.RECAPTCHA_ENTERPRISE_API_KEY;
      else process.env.RECAPTCHA_ENTERPRISE_API_KEY = previousCaptcha;
    }
  });
});
