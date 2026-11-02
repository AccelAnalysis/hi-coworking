/**
 * Seam webhook verification (Jonathan, Nov 2, 2026). Seam delivers webhooks
 * through Svix: each request carries svix-id, svix-timestamp and
 * svix-signature headers, and the signature is
 * base64(HMAC-SHA256(secret, `${id}.${timestamp}.${rawBody}`)) where the
 * secret is the base64 part after "whsec_". svix-signature is a
 * space-separated list of "v1,<sig>" entries; any one match is enough.
 *
 * Fail closed: no secret, a missing header, a stale timestamp or a bad
 * signature is rejected before the body is even parsed. Each svix-id is
 * processed at most once (replays are ignored). Only the event type and the
 * outcome are ever logged, never the body.
 *
 * Pure (no Firebase imports) so it is unit-tested.
 */
import * as crypto from "crypto";

export const SEAM_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type SeamHeaders = Record<string, string | string[] | undefined>;

export type SeamVerifyResult =
  | { ok: true; id: string }
  | { ok: false; status: 401; reason: "no_secret" | "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" };

function header(headers: SeamHeaders, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

function secretBytes(secret: string): Buffer | null {
  const trimmed = secret.trim();
  if (!trimmed) return null;
  const encoded = trimmed.startsWith("whsec_") ? trimmed.slice("whsec_".length) : trimmed;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length ? bytes : null;
}

/** The Svix v1 signature for a payload (exported for tests). */
export function signSeamPayload(secret: string, id: string, timestamp: string, rawBody: Buffer | string): string {
  const key = secretBytes(secret);
  if (!key) throw new Error("no secret");
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  return crypto
    .createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), body]))
    .digest("base64");
}

export function verifySeamWebhook(input: {
  headers: SeamHeaders;
  rawBody: Buffer | string | undefined;
  secret: string | undefined;
  nowSeconds: number;
}): SeamVerifyResult {
  if (!input.secret || !secretBytes(input.secret)) return { ok: false, status: 401, reason: "no_secret" };
  const id = header(input.headers, "svix-id");
  const timestamp = header(input.headers, "svix-timestamp");
  const signatures = header(input.headers, "svix-signature");
  if (!id || !timestamp || !signatures || input.rawBody === undefined) {
    return { ok: false, status: 401, reason: "missing_headers" };
  }
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, status: 401, reason: "bad_timestamp" };
  if (Math.abs(input.nowSeconds - Number(timestamp)) > SEAM_WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, status: 401, reason: "stale_timestamp" };
  }

  const expected = Buffer.from(signSeamPayload(input.secret, id, timestamp, input.rawBody), "base64");
  let matched = false;
  for (const entry of signatures.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0 || entry.slice(0, comma) !== "v1") continue;
    const given = Buffer.from(entry.slice(comma + 1), "base64");
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) matched = true;
  }
  return matched ? { ok: true, id } : { ok: false, status: 401, reason: "bad_signature" };
}

export type SeamEvent = {
  event_type: string;
  event_id?: string;
  device_id?: string;
  access_code_id?: string;
  properties?: Record<string, unknown>;
};

export type SeamRunOutcome = "processed" | "duplicate" | "in_progress" | "failed";

export type SeamWebhookOutcome = "rejected" | "bad_payload" | SeamRunOutcome;

export interface SeamWebhookDeps {
  secret: string | undefined;
  nowSeconds: number;
  /** Runs `process` at most once successfully per svix-id. */
  runOnce(svixId: string, process: () => Promise<void>): Promise<SeamRunOutcome>;
  /** Applies a verified event. */
  handle(event: SeamEvent): Promise<void>;
}

export type SeamWebhookResponse = {
  status: number;
  body: Record<string, unknown>;
  outcome: SeamWebhookOutcome;
  reason?: string;
  eventType?: string;
};

/** Verify, dedupe and apply one webhook request. Never throws. */
export async function handleSeamWebhookRequest(
  request: { method: string; headers: SeamHeaders; rawBody: Buffer | string | undefined },
  deps: SeamWebhookDeps,
): Promise<SeamWebhookResponse> {
  if (request.method !== "POST") return { status: 405, body: { error: "method_not_allowed" }, outcome: "rejected", reason: "method" };

  const verified = verifySeamWebhook({ headers: request.headers, rawBody: request.rawBody, secret: deps.secret, nowSeconds: deps.nowSeconds });
  if (!verified.ok) return { status: verified.status, body: { error: "unauthorized" }, outcome: "rejected", reason: verified.reason };

  let event: SeamEvent;
  try {
    const raw = Buffer.isBuffer(request.rawBody) ? request.rawBody.toString("utf8") : String(request.rawBody);
    event = JSON.parse(raw) as SeamEvent;
    if (!event || typeof event !== "object" || typeof event.event_type !== "string") throw new Error("shape");
  } catch {
    return { status: 400, body: { error: "bad_payload" }, outcome: "bad_payload" };
  }

  let outcome: SeamRunOutcome;
  try {
    outcome = await deps.runOnce(verified.id, () => deps.handle(event));
  } catch {
    outcome = "failed";
  }
  const eventType = event.event_type;
  if (outcome === "processed") return { status: 200, body: { ok: true }, outcome, eventType };
  if (outcome === "duplicate") return { status: 200, body: { ok: true, duplicate: true }, outcome, eventType };
  // Non-2xx so Svix retries later.
  if (outcome === "in_progress") return { status: 409, body: { error: "in_progress" }, outcome, eventType };
  return { status: 500, body: { error: "internal" }, outcome, eventType };
}
