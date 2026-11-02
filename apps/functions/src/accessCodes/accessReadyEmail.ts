/**
 * "Your access code is ready" email, sent from the `mail` queue that
 * sendAccessReadyNotice (access.ts) writes.
 *
 * Transactional: no suppression check. The email never contains the door
 * code; it only links to SayHi, where the signed-in owner sees it.
 *
 * Pure (no Firebase imports): the Firestore store and the trigger live in
 * mailQueue.ts.
 */
import { EMAIL_BODY_FONT, EMAIL_BUTTON_STYLE, EMAIL_HEADLINE_FONT, EMAIL_LOGO_HTML, EMAIL_NAVY } from "../payments/emailBrand";
import { EmailSendError, type EmailProvider } from "../providers/emailProvider";
import { ACCESS_CODE_READY_TEMPLATE } from "./policy";

export const POSTAL_ADDRESS = "Hi Coworking · 15373 Carrollton Blvd, Carrollton, VA 23314";
export const ACCESS_READY_CATEGORY = "access_code_ready";
export const MAX_ATTEMPTS = 3;
export const STALE_CLAIM_MS = 10 * 60 * 1000;
/** Queue entries older than this are never sent (no surprise late mail). */
export const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type AccessReadyData = {
  doorName?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  sayHiUrl?: unknown;
};

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;
}

export function renderAccessReadyEmail(data: AccessReadyData) {
  const door = text(data.doorName, "the front door");
  const start = text(data.startTime, "");
  const end = text(data.endTime, "");
  const rawUrl = text(data.sayHiUrl, "https://hi-coworking.com/my-hi");
  const url = /^https:\/\//.test(rawUrl) ? rawUrl : "https://hi-coworking.com/my-hi";
  const when = start ? (end ? `${start} to ${end}` : start) : "";
  const subject = "Your Hi Coworking access code is ready";
  const lead = `Your door code for ${door}${when ? `, ${when} ET` : ""}, is ready on your SayHi page.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:${EMAIL_BODY_FONT}"><div style="max-width:620px;margin:0 auto;padding:40px 24px">${EMAIL_LOGO_HTML}<h1 style="margin:24px 0 12px;font-family:${EMAIL_HEADLINE_FONT};font-size:28px;font-weight:600;line-height:1.2;color:${EMAIL_NAVY}">Your access code is ready</h1><p style="margin:0;font-size:16px;line-height:1.7;color:#475569">${escapeHtml(lead)} Sign in to see it. For your security, we never send the code by email.</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="${EMAIL_BUTTON_STYLE}">Open SayHi</a></p><p style="margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.6;color:#64748b">You're receiving this because you booked at Hi Coworking.<br>${escapeHtml(POSTAL_ADDRESS)}</p></div></body></html>`;
  const plain = `${lead}\nSign in to see it. For your security, we never send the code by email.\n\nOpen SayHi: ${url}\n\n${POSTAL_ADDRESS}`;
  return { subject, html, text: plain };
}

export type MailDoc = {
  template?: unknown;
  to?: unknown;
  resolveEmail?: unknown;
  data?: AccessReadyData;
  createdAt?: unknown;
  endsAt?: unknown;
  status?: unknown;
  attempts?: unknown;
  claimedAt?: unknown;
};

export type ClaimDecision = "claim" | "done" | "busy" | "exhausted";

/** Whether this run may send the doc. One send per doc. */
export function claimDecision(doc: MailDoc, now: number): ClaimDecision {
  const status = typeof doc.status === "string" ? doc.status : "pending";
  if (status === "sent" || status === "skipped" || status === "expired") return "done";
  if (status === "sending" && now - Number(doc.claimedAt || 0) < STALE_CLAIM_MS) return "busy";
  if (Number(doc.attempts || 0) >= MAX_ATTEMPTS) return "exhausted";
  return "claim";
}

/** Reason a doc must not be sent at all, or null when it may go out. */
export function skipReason(doc: MailDoc, now: number): string | null {
  if (doc.template !== ACCESS_CODE_READY_TEMPLATE) return "unknown_template";
  // Defense in depth: the queue must never carry a door code.
  const keys = Object.keys(doc.data || {}).map((k) => k.toLowerCase());
  if (keys.some((k) => k === "code" || k === "pin" || k.includes("accesscode") || k.includes("doorcode"))) return "contains_code";
  const createdAt = Number(doc.createdAt || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0 || now - createdAt > MAX_QUEUE_AGE_MS) return "stale";
  const endsAt = Number(doc.endsAt || 0);
  if (endsAt && endsAt <= now) return "booking_ended";
  return null;
}

export interface MailQueueStore {
  /** Atomically moves the doc to "sending" when claimDecision allows it. */
  claim(id: string, now: number): Promise<{ doc: MailDoc } | null>;
  /** The recipient address for a uid (users doc, then Auth). */
  resolveEmail(uid: string): Promise<string | null>;
  finish(id: string, update: Record<string, unknown>): Promise<void>;
}

export type MailOutcome = "sent" | "skipped" | "expired" | "not_claimed" | "failed";

/** Process one queued doc. Never throws. Never logs or stores the address. */
export async function processMailDoc(
  id: string,
  store: MailQueueStore,
  provider: EmailProvider,
  now: () => number = Date.now,
): Promise<MailOutcome> {
  let claimed: { doc: MailDoc } | null;
  try {
    claimed = await store.claim(id, now());
  } catch {
    return "failed";
  }
  if (!claimed) return "not_claimed";
  const doc = claimed.doc;
  const reason = skipReason(doc, now());
  if (reason) {
    const status = reason === "unknown_template" || reason === "contains_code" ? "skipped" : "expired";
    await store.finish(id, { status, skipReason: reason, processedAt: now() }).catch(() => undefined);
    return status;
  }
  try {
    const uid = typeof doc.to === "string" ? doc.to : "";
    const resolved = doc.resolveEmail === true && uid ? await store.resolveEmail(uid) : null;
    const to = (resolved || "").trim();
    if (!EMAIL_RE.test(to)) {
      await store.finish(id, { status: "skipped", skipReason: "no_recipient", processedAt: now() });
      return "skipped";
    }
    const copy = renderAccessReadyEmail(doc.data || {});
    const { messageId } = await provider.send({
      to,
      subject: copy.subject,
      html: copy.html,
      text: copy.text,
      categories: [ACCESS_READY_CATEGORY, "transactional"],
      idempotencyKey: `mail/${id}`,
    });
    await store.finish(id, { status: "sent", messageId, sentAt: now(), errorCode: null });
    return "sent";
  } catch (error) {
    const code = error instanceof EmailSendError ? `${error.status ?? "network"}_${error.code}` : "unexpected_error";
    await store.finish(id, { status: "failed", errorCode: code, failedAt: now() }).catch(() => undefined);
    return "failed";
  }
}
