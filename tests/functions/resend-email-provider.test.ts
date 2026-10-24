import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: [] as unknown[][], error: [] as unknown[][], warn: [] as unknown[][] }));
vi.mock("firebase-functions/logger", () => ({
  info: (...args: unknown[]) => { logs.info.push(args); },
  warn: (...args: unknown[]) => { logs.warn.push(args); },
  error: (...args: unknown[]) => { logs.error.push(args); },
}));

import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_REPLY_TO,
  EmailSendError,
  RESEND_API_KEY_SECRET_NAME,
  ResendEmailProvider,
  categoryTags,
  emailFrom,
  emailReplyTo,
} from "../../apps/functions/src/providers/emailProvider";

const API_KEY = "test-key";
const RECIPIENT = "member@example.com";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    const next = responses[Math.min(index++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function body(call: Call) {
  return JSON.parse(String(call.init.body));
}

function header(call: Call, name: string) {
  return (call.init.headers as Record<string, string>)[name];
}

function allLogText() {
  return JSON.stringify([...logs.info, ...logs.warn, ...logs.error]);
}

beforeEach(() => {
  logs.info.length = 0;
  logs.warn.length = 0;
  logs.error.length = 0;
});

describe("ResendEmailProvider", () => {
  it("sends one message from hello@hi-coworking.com, Reply-To hicoworking@accelanalysis.com, with the bearer key, tags and timeout", async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { id: "re_123" } }]);
    const provider = new ResendEmailProvider(API_KEY, { fetchImpl, env: {} });

    const result = await provider.send({
      to: RECIPIENT,
      subject: "Welcome",
      html: "<p>Hi</p>",
      text: "Hi",
      categories: ["hi-coworking-nurture", "acquisition", "bad value!"],
    });

    expect(result).toEqual({ messageId: "re_123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(header(calls[0], "Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(header(calls[0], "Idempotency-Key")).toBeUndefined();
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(body(calls[0])).toEqual({
      from: "Hi Coworking <hello@hi-coworking.com>",
      reply_to: "hicoworking@accelanalysis.com",
      to: [RECIPIENT],
      subject: "Welcome",
      html: "<p>Hi</p>",
      text: "Hi",
      tags: [
        { name: "hi-coworking-nurture", value: "true" },
        { name: "acquisition", value: "true" },
        { name: "bad_value_", value: "true" },
      ],
    });
    expect(allLogText()).not.toContain(RECIPIENT);
    expect(allLogText()).not.toContain(API_KEY);
  });

  it("uses the env sender and reply-to overrides, and an explicit replyTo wins", async () => {
    expect(emailFrom({})).toBe(DEFAULT_EMAIL_FROM);
    expect(emailFrom({ HI_COWORKING_EMAIL_FROM: "team@hi-coworking.com" })).toBe("Hi Coworking <team@hi-coworking.com>");
    expect(emailFrom({ HI_COWORKING_EMAIL_FROM: "Events <events@hi-coworking.com>" })).toBe("Events <events@hi-coworking.com>");
    expect(emailReplyTo({})).toBe(DEFAULT_EMAIL_REPLY_TO);
    expect(DEFAULT_EMAIL_REPLY_TO).toBe("hicoworking@accelanalysis.com");
    expect(emailReplyTo({ HI_COWORKING_EMAIL_REPLY_TO: "   " })).toBe("hicoworking@accelanalysis.com");
    expect(emailReplyTo({ HI_COWORKING_EMAIL_REPLY_TO: " help@hi-coworking.com " })).toBe("help@hi-coworking.com");

    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { id: "a" } }, { status: 200, body: { id: "b" } }]);
    const env = { HI_COWORKING_EMAIL_FROM: "Hi <ops@hi-coworking.com>", HI_COWORKING_EMAIL_REPLY_TO: "help@hi-coworking.com" };
    const provider = new ResendEmailProvider(API_KEY, { fetchImpl, env });
    await provider.send({ to: RECIPIENT, subject: "s", html: "h" });
    await provider.send({ to: RECIPIENT, subject: "s", html: "h", replyTo: "owner@hi-coworking.com" });

    expect(body(calls[0]).from).toBe("Hi <ops@hi-coworking.com>");
    expect(body(calls[0]).reply_to).toBe("help@hi-coworking.com");
    expect(body(calls[0])).not.toHaveProperty("text");
    expect(body(calls[0])).not.toHaveProperty("tags");
    expect(body(calls[1]).reply_to).toBe("owner@hi-coworking.com");
  });

  it("derives a stable idempotency key from the job id and payload", async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { id: "x" } }]);
    const provider = new ResendEmailProvider(API_KEY, { fetchImpl, env: {} });
    const message = { to: RECIPIENT, subject: "s", html: "h", idempotencyKey: "event-notification/event_confirm_abc" };
    await provider.send(message);
    await provider.send(message);
    await provider.send({ ...message, subject: "edited" });

    const keys = calls.map((call) => header(call, "Idempotency-Key"));
    expect(keys[0]).toMatch(/^event-notification\/event_confirm_abc\/[0-9a-f]{24}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]).not.toContain(RECIPIENT);
  });

  it("throws a typed error and logs only status and code when Resend rejects a send", async () => {
    const { fetchImpl } = mockFetch([{
      status: 422,
      body: { statusCode: 422, name: "validation_error", message: `Invalid \`to\` field: ${RECIPIENT}` },
    }]);
    const provider = new ResendEmailProvider(API_KEY, { fetchImpl, env: {} });

    const error = await provider.send({ to: RECIPIENT, subject: "s", html: "h" }).catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(error.message).toBe("Resend send failed: 422 validation_error");
    expect(error.status).toBe(422);
    expect(error.retryable).toBe(false);
    expect(logs.error).toHaveLength(1);
    expect(logs.error[0][1]).toEqual({ status: 422, code: "validation_error", retryable: false });
    expect(allLogText()).not.toContain(RECIPIENT);
    expect(allLogText()).not.toContain(API_KEY);
    expect(error.message).not.toContain(RECIPIENT);
  });

  it("marks rate limits, server errors and timeouts as retryable", async () => {
    const rateLimited = new ResendEmailProvider(API_KEY, { fetchImpl: mockFetch([{ status: 429, body: { name: "rate_limit_exceeded" } }]).fetchImpl, env: {} });
    await expect(rateLimited.send({ to: RECIPIENT, subject: "s", html: "h" })).rejects.toMatchObject({ status: 429, retryable: true });

    const serverError = new ResendEmailProvider(API_KEY, { fetchImpl: mockFetch([{ status: 500, body: "<html>oops</html>" }]).fetchImpl, env: {} });
    await expect(serverError.send({ to: RECIPIENT, subject: "s", html: "h" })).rejects.toMatchObject({ status: 500, code: "error", retryable: true });

    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const timedOut = new ResendEmailProvider(API_KEY, { fetchImpl: mockFetch([timeout]).fetchImpl, env: {} });
    await expect(timedOut.send({ to: RECIPIENT, subject: "s", html: "h" })).rejects.toMatchObject({ status: null, code: "timeout", retryable: true });
  });

  it("refuses to send without a key and never calls Resend", async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { id: "x" } }]);
    const provider = new ResendEmailProvider("", { fetchImpl, env: {} });
    await expect(provider.send({ to: RECIPIENT, subject: "s", html: "h" })).rejects.toMatchObject({ code: "missing_api_key" });
    await expect(provider.sendBatch([{ to: RECIPIENT, subject: "s", html: "h" }])).resolves.toEqual({ sent: 0, failed: 1 });
    expect(calls).toHaveLength(0);
  });

  it("batches in chunks of 100 and keeps each recipient's own content", async () => {
    const ok = (n: number) => ({ status: 200, body: { data: Array.from({ length: n }, (_, i) => ({ id: `id_${i}` })) } });
    const { fetchImpl, calls } = mockFetch([ok(100), ok(50)]);
    const provider = new ResendEmailProvider(API_KEY, { fetchImpl, env: {} });
    const messages = Array.from({ length: 150 }, (_, i) => ({
      to: `person${i}@example.com`,
      subject: `Subject ${i}`,
      html: `<p>Hello ${i}</p>`,
      categories: ["event-campaign"],
    }));

    await expect(provider.sendBatch(messages)).resolves.toEqual({ sent: 150, failed: 0 });
    expect(calls.map((call) => call.url)).toEqual(["https://api.resend.com/emails/batch", "https://api.resend.com/emails/batch"]);
    const first = body(calls[0]);
    expect(first).toHaveLength(100);
    expect(body(calls[1])).toHaveLength(50);
    expect(first[7]).toEqual({
      from: DEFAULT_EMAIL_FROM,
      reply_to: DEFAULT_EMAIL_REPLY_TO,
      to: ["person7@example.com"],
      subject: "Subject 7",
      html: "<p>Hello 7</p>",
      tags: [{ name: "event-campaign", value: "true" }],
    });
  });

  it("counts a rejected batch as failed without logging recipients", async () => {
    const { fetchImpl } = mockFetch([{ status: 403, body: { name: "invalid_from_address", message: "person0@example.com" } }]);
    const provider = new ResendEmailProvider(API_KEY, { fetchImpl, env: {} });
    const result = await provider.sendBatch([{ to: "person0@example.com", subject: "s", html: "h" }, { to: "person1@example.com", subject: "s", html: "h" }]);
    expect(result).toEqual({ sent: 0, failed: 2 });
    expect(logs.error[0][1]).toEqual({ status: 403, code: "invalid_from_address", retryable: false, batchSize: 2 });
    expect(allLogText()).not.toContain("@example.com");
  });

  it("dedupes tag names", () => {
    expect(categoryTags(["a", "a", " ", "b.c"])).toEqual([{ name: "a", value: "true" }, { name: "b_c", value: "true" }]);
  });
});

describe("Hi Coworking mail wiring", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("binds the dedicated Resend secret only on the three mail workers and stripe_webhook", () => {
    expect(RESEND_API_KEY_SECRET_NAME).toBe("HI_COWORKING_RESEND_API_KEY");
    const secretModule = read("apps/functions/src/providers/emailSecret.ts");
    expect(secretModule).toContain("defineSecret(RESEND_API_KEY_SECRET_NAME)");

    const nurture = read("apps/functions/src/nurture.ts");
    const notifications = read("apps/functions/src/eventsV2/notifications.ts");
    const marketing = read("apps/functions/src/campaignJobs.ts");
    for (const source of [nurture, notifications, marketing]) {
      expect(source).toMatch(/import \{ resendApiKey \} from "\.\.?\/providers\/emailSecret"/);
      expect(source).toContain("new ResendEmailProvider(");
      expect(source).toMatch(/secrets: \[resendApiKey/);
      expect(source).not.toContain("FROM_EMAIL");
    }
    expect(nurture).toContain("idempotencyKey: `nurture/${deliveryId}`");
    expect(notifications).toContain("idempotencyKey: `event-notification/${doc.id}`");

    const users = walk("apps/functions/src").filter((file) => read(file).includes("providers/emailSecret"));
    expect(users.map((file) => file.replace(/\\/g, "/")).sort()).toEqual([
      "apps/functions/src/campaignJobs.ts",
      "apps/functions/src/eventsV2/notifications.ts",
      "apps/functions/src/index.ts",
      "apps/functions/src/nurture.ts",
    ]);
    // stripe_webhook (core bundle) binds it for the membership welcome email.
    const index = read("apps/functions/src/index.ts");
    expect(index).toContain('import { resendApiKey } from "./providers/emailSecret";');
    expect(index).toContain("secrets: [stripeSecretKey, stripeWebhookSecret, intuitClientId, intuitClientSecret, resendApiKey]");
  });

  it("leaves no SendGrid code, config or docs behind", () => {
    const roots = ["apps/functions/src", "apps/web/src", "packages", "firebase", "docs", ".github", "scripts", "package.json", "apps/functions/package.json"];
    // The email runbook's one-time cleanup section names the retired secret on purpose.
    const offenders = roots.flatMap((root) => walk(root))
      .filter((file) => !file.replace(/\\/g, "/").endsWith("docs/HI-COWORKING-EMAIL.md"))
      .filter((file) => /sendgrid/i.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("keeps the Power NOW Resend key separate from the Hi Coworking key", () => {
    const powerNow = read("apps/functions/src/expo/powerNowConfirmationSecrets.ts");
    expect(powerNow).toContain("RESEND_API_KEY");
    expect(powerNow).not.toContain("HI_COWORKING_RESEND_API_KEY");
    expect(read("apps/functions/src/expo/powerNowConfirmation.ts")).not.toContain("providers/emailProvider");
  });
});

function walk(root: string): string[] {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    return [];
  }
  if (stat.isFile()) return [root];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name === "lib" || name === ".next" || name === "out" || name === ".git") continue;
    out.push(...walk(join(root, name)));
  }
  return out.filter((file) => /\.(ts|tsx|js|mjs|cjs|json|md|ya?ml|txt|env)$|\.env\./.test(file) || file.endsWith("package.json"));
}
