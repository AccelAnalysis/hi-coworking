import { createHash } from "node:crypto";
import * as logger from "firebase-functions/logger";

/**
 * Outbound email for the Hi Coworking app. Resend is the only provider.
 *
 * The API key comes from the Secret Manager secret named by
 * RESEND_API_KEY_SECRET_NAME (see ./emailSecret.ts). It is never read from
 * git, an .env file, or logs. The sender defaults to hello@hi-coworking.com
 * and can be overridden with the HI_COWORKING_EMAIL_FROM env var.
 *
 * The Power NOW confirmation mail for expo_submitNasaLead has its own Resend
 * client in ../expo/powerNowConfirmation.ts and does not use this module.
 */

export const RESEND_API_KEY_SECRET_NAME = "HI_COWORKING_RESEND_API_KEY";
export const DEFAULT_EMAIL_FROM = "Hi Coworking <hello@hi-coworking.com>";
export const RESEND_API_BASE_URL = "https://api.resend.com";
export const RESEND_BATCH_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface EmailMessage {
  to: string;
  /** Optional. Defaults to the configured sender. */
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Sent to Resend as tags so the dashboard can filter by stream. */
  categories?: string[];
  /**
   * Stable id for this message (for example a delivery or job id). The
   * provider adds a hash of the payload, so a retry of the same content is
   * deduplicated by Resend for 24 hours and edited content is not blocked.
   */
  idempotencyKey?: string;
  /**
   * Extra MIME headers, for example List-Unsubscribe and
   * List-Unsubscribe-Post on marketing mail. Resend passes them through.
   */
  headers?: Record<string, string>;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ messageId: string }>;
  sendBatch(messages: EmailMessage[]): Promise<{ sent: number; failed: number }>;
}

export class EmailSendError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number | null, code: string) {
    super(`Resend send failed: ${status ?? "network"} ${code}`.trim());
    this.name = "EmailSendError";
    this.status = status;
    this.code = code;
    this.retryable = status === null || status === 429 || status >= 500;
  }
}

/** Sender for app mail. HI_COWORKING_EMAIL_FROM may be a bare address or "Name <address>". */
export function emailFrom(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HI_COWORKING_EMAIL_FROM?.trim();
  if (!raw) return DEFAULT_EMAIL_FROM;
  if (raw.includes("<") && raw.includes(">")) return raw;
  return `Hi Coworking <${raw}>`;
}

/** Optional Reply-To for app mail. Unset by default, matching the previous provider. */
export function emailReplyTo(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HI_COWORKING_EMAIL_REPLY_TO?.trim() || undefined;
}

/** Resend tag names and values allow only ASCII letters, digits, "_" and "-". */
export function categoryTags(categories: string[] | undefined): Array<{ name: string; value: string }> {
  const seen = new Set<string>();
  const tags: Array<{ name: string; value: string }> = [];
  for (const category of categories || []) {
    const name = category.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    tags.push({ name, value: "true" });
  }
  return tags;
}

export type ResendProviderOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
};

type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  tags?: Array<{ name: string; value: string }>;
  headers?: Record<string, string>;
};

/**
 * Resend REST client. Uses fetch so there is no SDK dependency, and so tests
 * can pass a mocked fetch. Logs never include the API key, recipient
 * addresses, or Resend's error message text (which can echo addresses).
 */
export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly baseUrl: string;

  constructor(apiKey: string, options: ResendProviderOptions = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.env = options.env ?? process.env;
    this.baseUrl = options.baseUrl ?? RESEND_API_BASE_URL;
  }

  private payload(message: EmailMessage): ResendPayload {
    const replyTo = message.replyTo || emailReplyTo(this.env);
    const tags = categoryTags(message.categories);
    return {
      from: message.from || emailFrom(this.env),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(tags.length ? { tags } : {}),
      ...(message.headers && Object.keys(message.headers).length ? { headers: { ...message.headers } } : {}),
    };
  }

  private async post(path: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const code = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "timeout"
        : "network_error";
      throw new EmailSendError(null, code);
    }

    const parsed = await response.json().catch(() => null) as { name?: unknown } | null;
    if (!response.ok) {
      const code = typeof parsed?.name === "string" && /^[a-z_]{1,64}$/.test(parsed.name) ? parsed.name : "error";
      throw new EmailSendError(response.status, code);
    }
    return parsed;
  }

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    if (!this.apiKey) throw new EmailSendError(null, "missing_api_key");
    const payload = this.payload(message);
    const idempotencyKey = message.idempotencyKey ? idempotencyKeyFor(message.idempotencyKey, payload) : undefined;
    try {
      const body = await this.post("/emails", payload, idempotencyKey) as { id?: unknown } | null;
      const messageId = typeof body?.id === "string" && body.id.trim() ? body.id.trim() : `resend_${Date.now()}`;
      logger.info("Resend email sent", { messageId, tags: payload.tags?.map((tag) => tag.name) });
      return { messageId };
    } catch (error) {
      logSendError("Resend send failed", error);
      throw error;
    }
  }

  async sendBatch(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    if (!this.apiKey) return { sent: 0, failed: messages.length };

    // Resend's batch endpoint takes up to 100 messages, each with its own
    // subject and body, so every recipient gets their own rendered copy.
    for (let i = 0; i < messages.length; i += RESEND_BATCH_LIMIT) {
      const batch = messages.slice(i, i + RESEND_BATCH_LIMIT);
      if (batch.length === 0) continue;
      try {
        const body = await this.post("/emails/batch", batch.map((message) => this.payload(message))) as { data?: unknown } | null;
        const ids = Array.isArray(body?.data) ? body.data.length : batch.length;
        sent += Math.min(ids, batch.length);
        failed += batch.length - Math.min(ids, batch.length);
      } catch (error) {
        logSendError("Resend batch send failed", error, { batchSize: batch.length });
        failed += batch.length;
      }
    }

    return { sent, failed };
  }
}

function idempotencyKeyFor(prefix: string, payload: ResendPayload): string {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
  return `${prefix.slice(0, 200)}/${digest}`;
}

function logSendError(label: string, error: unknown, extra: Record<string, unknown> = {}) {
  if (error instanceof EmailSendError) {
    logger.error(label, { status: error.status, code: error.code, retryable: error.retryable, ...extra });
  } else {
    logger.error(label, { code: "unexpected", ...extra });
  }
}
