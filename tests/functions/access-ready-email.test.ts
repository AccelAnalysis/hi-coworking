import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import {
  MAX_ATTEMPTS,
  MAX_QUEUE_AGE_MS,
  STALE_CLAIM_MS,
  claimDecision,
  processMailDoc,
  renderAccessReadyEmail,
  skipReason,
  type MailDoc,
  type MailQueueStore,
} from "../../apps/functions/src/accessCodes/accessReadyEmail";
import { accessReadyMail, ACCESS_CODE_READY_TEMPLATE } from "../../apps/functions/src/accessCodes/policy";
import { EmailSendError, type EmailMessage, type EmailProvider } from "../../apps/functions/src/providers/emailProvider";

const NOW = Date.UTC(2026, 10, 3, 14, 0);
const queued = (extra: Partial<MailDoc> = {}): MailDoc => ({
  to: "uid-1",
  resolveEmail: true,
  ...accessReadyMail({ bookingId: "b1", doorName: "Front door", startsAt: NOW + 3_600_000, endsAt: NOW + 7_200_000, origin: "https://hi-coworking.com" }),
  endsAt: NOW + 7_200_000,
  status: "pending",
  attempts: 0,
  createdAt: NOW - 1000,
  ...extra,
});

function memoryStore(docs: Record<string, MailDoc>, email: string | null = "member@example.com") {
  const store: MailQueueStore & { docs: Record<string, MailDoc> } = {
    docs,
    async claim(id, now) {
      const doc = docs[id];
      if (!doc || claimDecision(doc, now) !== "claim") return null;
      docs[id] = { ...doc, status: "sending", claimedAt: now, attempts: Number(doc.attempts || 0) + 1 };
      return { doc };
    },
    async resolveEmail() { return email; },
    async finish(id, update) { docs[id] = { ...docs[id], ...update }; },
  };
  return store;
}

function provider(fail?: Error) {
  const sent: EmailMessage[] = [];
  const p: EmailProvider = {
    async send(message) {
      if (fail) throw fail;
      sent.push(message);
      return { messageId: `m${sent.length}` };
    },
    async sendBatch() { return []; },
  } as unknown as EmailProvider;
  return { p, sent };
}

describe("access-code-ready email", () => {
  it("renders branded, links to SayHi, has the postal address and no code", () => {
    const copy = renderAccessReadyEmail(queued().data!);
    expect(copy.subject).toBe("Your Hi Coworking access code is ready");
    expect(copy.html).toContain("#101D4B");
    expect(copy.html).toContain("Fraunces");
    expect(copy.html).toContain("DM Sans");
    expect(copy.html).toContain("hi-coworking-mark-256.png");
    expect(copy.html).toContain('href="https://hi-coworking.com/my-hi"');
    expect(copy.html).toContain("15373 Carrollton Blvd, Carrollton, VA 23314");
    expect(copy.text).toContain("15373 Carrollton Blvd, Carrollton, VA 23314");
    expect(copy.html).toContain("Front door");
    expect(copy.html).not.toMatch(/unsubscribe/i);
  });

  it("escapes values and refuses non-https links", () => {
    const copy = renderAccessReadyEmail({ doorName: "<b>x</b>", sayHiUrl: "javascript:alert(1)" });
    expect(copy.html).not.toContain("<b>x</b>");
    expect(copy.html).toContain('href="https://hi-coworking.com/my-hi"');
  });

  it("sends once per doc from the Resend provider with an idempotency key", async () => {
    const store = memoryStore({ d1: queued() });
    const { p, sent } = provider();
    expect(await processMailDoc("d1", store, p, () => NOW)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "member@example.com", idempotencyKey: "mail/d1", categories: ["access_code_ready", "transactional"] });
    expect(sent[0].from).toBeUndefined(); // provider default: hello@hi-coworking.com
    expect(sent[0].headers).toBeUndefined(); // transactional: no List-Unsubscribe
    expect(store.docs.d1).toMatchObject({ status: "sent", messageId: "m1", attempts: 1 });
    // A second trigger delivery does nothing.
    expect(await processMailDoc("d1", store, p, () => NOW + 1)).toBe("not_claimed");
    expect(sent).toHaveLength(1);
    // The stored doc never gains the recipient address.
    expect(JSON.stringify(store.docs.d1)).not.toContain("member@example.com");
  });

  it("never sends stale, ended, unknown or code-bearing docs", async () => {
    const { p, sent } = provider();
    const store = memoryStore({
      old: queued({ createdAt: NOW - MAX_QUEUE_AGE_MS - 1 }),
      ended: queued({ endsAt: NOW - 1 }),
      other: queued({ template: "something_else" }),
      code: queued({ data: { ...queued().data, pin: "1234" } }),
      nocreated: queued({ createdAt: undefined }),
    });
    expect(await processMailDoc("old", store, p, () => NOW)).toBe("expired");
    expect(await processMailDoc("ended", store, p, () => NOW)).toBe("expired");
    expect(await processMailDoc("other", store, p, () => NOW)).toBe("skipped");
    expect(await processMailDoc("code", store, p, () => NOW)).toBe("skipped");
    expect(await processMailDoc("nocreated", store, p, () => NOW)).toBe("expired");
    expect(sent).toHaveLength(0);
    expect(store.docs.code.skipReason).toBe("contains_code");
    expect(skipReason(queued(), NOW)).toBeNull();
    expect(queued().template).toBe(ACCESS_CODE_READY_TEMPLATE);
  });

  it("skips when no valid recipient resolves", async () => {
    const { p, sent } = provider();
    const store = memoryStore({ d: queued() }, null);
    expect(await processMailDoc("d", store, p, () => NOW)).toBe("skipped");
    expect(store.docs.d).toMatchObject({ status: "skipped", skipReason: "no_recipient" });
    expect(sent).toHaveLength(0);
  });

  it("records failures with a code, and stops after the attempt limit", async () => {
    const { p } = provider(new EmailSendError("rate", 429, "rate_limit_exceeded"));
    const store = memoryStore({ d: queued() });
    expect(await processMailDoc("d", store, p, () => NOW)).toBe("failed");
    expect(store.docs.d).toMatchObject({ status: "failed", attempts: 1 });
    expect(String(store.docs.d.errorCode)).toContain("429");
    expect(claimDecision({ status: "failed", attempts: MAX_ATTEMPTS }, NOW)).toBe("exhausted");
    expect(claimDecision({ status: "sending", claimedAt: NOW }, NOW + 1)).toBe("busy");
    expect(claimDecision({ status: "sending", claimedAt: NOW, attempts: 1 }, NOW + STALE_CLAIM_MS + 1)).toBe("claim");
    expect(claimDecision({ status: "sent" }, NOW)).toBe("done");
  });

  it("the trigger logs only the doc id and outcome, and access.ts queues with endsAt and status", () => {
    const queue = readFileSync("apps/functions/src/accessCodes/mailQueue.ts", "utf8");
    expect(queue).toContain('onDocumentCreated(\n  { document: `${MAIL_COLLECTION}/{mailId}`, secrets: [resendApiKey], retry: false }');
    for (const call of queue.match(/logger\.\w+\([^;]*\);/g) || []) {
      expect(call).not.toMatch(/email|to\b|data/i);
    }
    const access = readFileSync("apps/functions/src/access.ts", "utf8");
    expect(access).toMatch(/endsAt: params\.endsAt,\s*status: "pending",\s*attempts: 0,/);
  });
});
