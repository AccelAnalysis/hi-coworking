/**
 * Power NOW confirmation mail. Off unless POWER_NOW_CONFIRMATION_EMAIL_ENABLED is "true".
 * A skip or a provider error never fails the Attio submission.
 * Logs include the person record id and an error class, not the visitor's email.
 */

import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import * as admin from "firebase-admin";
import { formatIsoEastern, splitPersonName } from "./nasaLeadModel";
import { readPowerNowSecret } from "./powerNowConfirmationSecrets";
import type { NormalizedPowerNow, PowerNowPath } from "./powerNowModel";

export const POWER_NOW_DEFAULT_FROM = "Accel Analysis <hello@accelanalysis.com>";
export const POWER_NOW_DEFAULT_REPLY_TO = "hello@accelanalysis.com";
export const POWER_NOW_DEFAULT_DAILY_CAP = 100;
export const POWER_NOW_DEFAULT_IP_DAILY_CAP = 20;
export const POWER_NOW_DEFAULT_ASSET_BASE = "https://hi-coworking.com";
export const POWER_NOW_MIN_SUBMIT_MS_DEFAULT = 3000;
export const POWER_NOW_RECAPTCHA_MIN_SCORE_DEFAULT = 0.5;
export const POWER_NOW_RECAPTCHA_ACTION = "power_now_submit";
export const POWER_NOW_RECAPTCHA_PROJECT = "hi-coworking-plat";
export const CONFIRMATION_ADDRESS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CONFIRMATION_FAILURE_PREFIX = "[CONFIRMATION EMAIL FAILED]";

export const CONFIRMATION_TEMPLATE_VERSION: Record<PowerNowPath, string> = {
  pitch: "PN-CONFIRM-PITCH-v1",
  watch: "PN-CONFIRM-WATCH-v1",
  contribute: "PN-CONFIRM-CONTRIB-v1",
};

const SIGNATURE_LINES = [
  "Jonathan Z. Holman | Founder & CEO",
  "Accel Analysis",
  "(757) 236-0651 | hello@accelanalysis.com",
  "15373 Carrollton Blvd, Carrollton, VA 23314",
  "accelanalysis.com",
  "Clarity. Strategy. Execution.",
];

const FOOTER_LINES = [
  "This is an automatic confirmation because you submitted the Power NOW form.",
  "Accel Analysis · 15373 Carrollton Blvd, Carrollton, VA 23314 · hello@accelanalysis.com",
  "Reply with 'unsubscribe' to stop Power NOW emails.",
];

const TEMPLATES: Record<PowerNowPath, { subject: string; paragraphs: string[]; signoff: string }> = {
  pitch: {
    subject: "We got your Power NOW pitch interest",
    paragraphs: [
      "Thanks for telling us about your business. You're on the Power NOW pitch interest list. We look forward to learning more about what you're building.",
      "Here's what happens next. We'll reach out to set up a short conversation about your business, fit, and timing. Every pitch starts with that conversation. Joining the list doesn't reserve a pitch slot.",
      "If something changes before we talk, or you have a question, reply to this email or write to hello@accelanalysis.com. You can also call (757) 236-0651.",
    ],
    signoff: "Thanks again,",
  },
  watch: {
    subject: "You're on the Power NOW audience list",
    paragraphs: [
      "Thanks for signing up. You're on the Power NOW audience list.",
      "Power NOW is a virtual pitch competition for local entrepreneurs who are building a business, presented by Accel Analysis. Upcoming pitch nights are held online through the year.",
      "We'll send you details about upcoming pitch nights, including how to join online, in the ways you chose on the form. You can change how you hear from us at any time.",
      "Questions? Reply to this email, write to hello@accelanalysis.com, or call (757) 236-0651.",
    ],
    signoff: "Thanks,",
  },
  contribute: {
    subject: "Thanks for your Power NOW prize pack offer",
    paragraphs: [
      "Thank you for offering a product, service, or experience to the Power NOW prize pack. We received your offer, and we appreciate you supporting local entrepreneurs.",
      "There's nothing else you need to do right now. We'll be in touch to talk through the details and confirm them in writing. Nothing is final until we've done that together.",
      "If you have a question in the meantime, reply to this email or write to hello@accelanalysis.com. You can also call (757) 236-0651.",
    ],
    signoff: "Thank you,",
  },
};

const ROLE_LOCAL_PARTS = new Set([
  "abuse",
  "admin",
  "administrator",
  "billing",
  "compliance",
  "contact",
  "help",
  "hostmaster",
  "info",
  "inquiries",
  "inquiry",
  "marketing",
  "media",
  "news",
  "newsletter",
  "no-reply",
  "noreply",
  "office",
  "postmaster",
  "privacy",
  "root",
  "sales",
  "security",
  "spam",
  "support",
  "team",
  "webmaster",
]);

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "burnermail.io",
  "discard.email",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxkitten.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailforspam.com",
  "mailinator.com",
  "mailnesia.com",
  "mailnull.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "safetymail.info",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempr.email",
  "throwawaymail.com",
  "tmpmail.net",
  "tmpmail.org",
  "trash-mail.com",
  "trashmail.com",
  "trashmail.de",
  "yopmail.com",
  "yopmail.fr",
]);

export type ConfirmationMessage = {
  version: string;
  subject: string;
  html: string;
  text: string;
  listUnsubscribe: string;
};

export type CaptchaVerdict =
  | { ok: true }
  | { ok: false; errorClass: "CaptchaUnconfigured" | "CaptchaMissing" | "CaptchaRejected" };

export type ReservationSnapshot = {
  addressSentAt: number | null;
  ipHits: number[];
  dailyCount: number;
};

export type ReservationInput = {
  nowMs: number;
  windowMs: number;
  ipCap: number;
  dailyCap: number;
};

export type ReservationDecision =
  | { allow: true; addressSentAt: number; ipHits: number[]; dailyCount: number }
  | { allow: false; limit: "address" | "ip" | "daily" };

export type ConfirmationStore = {
  suppressed(emailHash: string): Promise<boolean>;
  reserve(input: {
    addressKey: string;
    ipKey: string;
    dayKey: string;
    nowMs: number;
    ipCap: number;
    dailyCap: number;
  }): Promise<"ok" | "address" | "ip" | "daily">;
};

export type MemoryConfirmationStore = ConfirmationStore & {
  suppress(emailHash: string): void;
};

export type MxLookup = (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;

export type PowerNowConfirmationOptions = {
  env?: NodeJS.ProcessEnv;
  mailFetch?: typeof fetch;
  store?: ConfirmationStore;
  resolveMx?: MxLookup;
  verifyCaptcha?: (input: {
    token: string;
    env: NodeJS.ProcessEnv;
    fetchImpl: typeof fetch;
  }) => Promise<CaptchaVerdict>;
  now?: Date;
  ip?: string;
  startedAt?: string | null;
  captchaToken?: string | null;
  readSecret?: (name: string) => string | undefined;
};

type SendFailureClass = "ResendRejected" | "GraphRejected" | "GraphAuthFailed" | "SendFailed" | "ProviderUnconfigured";

export function confirmationEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.POWER_NOW_CONFIRMATION_EMAIL_ENABLED === "true";
}

export function confirmationProvider(env: NodeJS.ProcessEnv): "resend" | "graph" | "invalid" {
  const raw = env.POWER_NOW_EMAIL_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === "resend") return "resend";
  if (raw === "graph") return "graph";
  return "invalid";
}

export function confirmationFrom(env: NodeJS.ProcessEnv): string {
  const raw = env.POWER_NOW_SENDER?.trim();
  if (!raw) return POWER_NOW_DEFAULT_FROM;
  if (raw.includes("<") && raw.includes(">")) return raw;
  return `Accel Analysis <${raw}>`;
}

export function confirmationReplyTo(env: NodeJS.ProcessEnv): string {
  return env.POWER_NOW_REPLY_TO?.trim() || POWER_NOW_DEFAULT_REPLY_TO;
}

export function mailboxAddress(value: string): string {
  const wrapped = value.match(/<([^>]+)>/);
  return (wrapped?.[1] ?? value).trim();
}

export function confirmationDailyCap(env: NodeJS.ProcessEnv): number {
  return positiveInt(env.POWER_NOW_CONFIRMATION_DAILY_CAP, POWER_NOW_DEFAULT_DAILY_CAP);
}

export function confirmationIpCap(env: NodeJS.ProcessEnv): number {
  return positiveInt(env.POWER_NOW_CONFIRMATION_IP_DAILY_CAP, POWER_NOW_DEFAULT_IP_DAILY_CAP);
}

export function confirmationMinSubmitMs(env: NodeJS.ProcessEnv): number {
  const raw = env.POWER_NOW_MIN_SUBMIT_MS?.trim();
  if (!raw) return POWER_NOW_MIN_SUBMIT_MS_DEFAULT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return POWER_NOW_MIN_SUBMIT_MS_DEFAULT;
  return value;
}

export function confirmationAssetBase(env: NodeJS.ProcessEnv): string {
  const raw = env.POWER_NOW_EMAIL_ASSET_BASE_URL?.trim() || POWER_NOW_DEFAULT_ASSET_BASE;
  return raw.replace(/\/+$/, "");
}

export function powerNowEmailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export function confirmationDedupeKey(email: string, path: PowerNowPath, now: Date): string {
  return `pn-confirm:${powerNowEmailHash(email)}:${path}:${now.toISOString().slice(0, 10)}`;
}

export function listUnsubscribeValue(replyTo: string): string {
  return `<mailto:${mailboxAddress(replyTo)}?subject=unsubscribe>`;
}

export function prefixConfirmationFailure(content: string): string {
  if (content.startsWith(CONFIRMATION_FAILURE_PREFIX)) return content.slice(0, 2000);
  return `${CONFIRMATION_FAILURE_PREFIX}\n${content}`.slice(0, 2000);
}

export function confirmationFailureNote(errorClass: string): string {
  return `Confirmation email failed.\nError class: ${errorClass}`;
}

export function confirmationSuccessNote(input: {
  subject: string;
  sentAtEt: string;
  version: string;
  sender: string;
  messageId: string;
  path: PowerNowPath;
}): string {
  return [
    `Subject: ${input.subject}`,
    `Sent (ET): ${input.sentAtEt}`,
    `Template: ${input.version}`,
    `Sender: ${input.sender}`,
    `Provider message id: ${input.messageId}`,
    `Path: ${input.path}`,
  ].join("\n");
}

export function confirmationGreetingName(fullName: string): string {
  const first = splitPersonName(fullName).first_name.trim();
  return first || "there";
}

export function buildPowerNowConfirmationMessage(input: {
  path: PowerNowPath;
  fullName: string;
  assetBaseUrl: string;
  replyTo: string;
}): ConfirmationMessage {
  const template = TEMPLATES[input.path];
  const name = confirmationGreetingName(input.fullName);
  const text = [
    `Hi ${name},`,
    "",
    ...template.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    template.signoff,
    "Jonathan",
    "",
    ...SIGNATURE_LINES,
    "",
    ...FOOTER_LINES,
  ].join("\n");

  const image = `${input.assetBaseUrl.replace(/\/+$/, "")}/power-now/power-now-logo-lockup.jpg`;
  const greeting = `<p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>`;
  const paragraphs = template.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;">${linkPlainContacts(escapeHtml(paragraph))}</p>`)
    .join("");
  const signature = SIGNATURE_LINES
    .map((line, index) => {
      const escaped = escapeHtml(line);
      const linked = index === 4
        ? '<a href="https://accelanalysis.com" style="color:#2F5597;">accelanalysis.com</a>'
        : linkPlainContacts(escaped);
      if (index === 0) return `<strong style="color:#00072E;">${linked}</strong>`;
      if (index === SIGNATURE_LINES.length - 1) return `<em style="color:#2F5597;">${linked}</em>`;
      return linked;
    })
    .join("<br>");
  const footer = FOOTER_LINES.map((line) => escapeHtml(line)).join("<br>");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(template.subject)}</title></head><body style="margin:0;padding:0;background:#E9EDF5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9EDF5;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:8px;"><tr><td style="padding:28px 28px 8px;font-family:'Open Sans',Arial,sans-serif;color:#1B1B1B;font-size:16px;line-height:1.6;"><img src="${escapeHtml(image)}" width="560" alt="POWER NOW" style="display:block;width:100%;max-width:560px;height:auto;border:0;margin:0 0 22px;">${greeting}${paragraphs}<p style="margin:0 0 16px;">${escapeHtml(template.signoff)}<br>Jonathan</p><p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #E3E7EF;font-size:14px;line-height:1.55;color:#5E5E5E;">${signature}</p><p style="margin:22px 0 0;padding-top:12px;border-top:1px solid #E3E7EF;font-size:12px;line-height:1.55;color:#5E5E5E;">${footer}</p></td></tr></table></td></tr></table></body></html>`;

  return {
    version: CONFIRMATION_TEMPLATE_VERSION[input.path],
    subject: template.subject,
    html,
    text,
    listUnsubscribe: listUnsubscribeValue(input.replyTo),
  };
}

export function decideReservation(current: ReservationSnapshot, input: ReservationInput): ReservationDecision {
  const recentHits = current.ipHits.filter((hit) => input.nowMs - hit < input.windowMs);
  if (current.addressSentAt != null && input.nowMs - current.addressSentAt < input.windowMs) {
    return { allow: false, limit: "address" };
  }
  if (recentHits.length >= input.ipCap) return { allow: false, limit: "ip" };
  if (current.dailyCount >= input.dailyCap) return { allow: false, limit: "daily" };
  return {
    allow: true,
    addressSentAt: input.nowMs,
    ipHits: [...recentHits, input.nowMs],
    dailyCount: current.dailyCount + 1,
  };
}

export function createMemoryConfirmationStore(): MemoryConfirmationStore {
  const suppressed = new Set<string>();
  const address = new Map<string, number>();
  const ips = new Map<string, number[]>();
  const days = new Map<string, number>();
  return {
    suppress(emailHash: string) {
      suppressed.add(emailHash);
    },
    async suppressed(emailHash: string) {
      return suppressed.has(emailHash);
    },
    async reserve(input) {
      const decision = decideReservation(
        {
          addressSentAt: address.get(input.addressKey) ?? null,
          ipHits: ips.get(input.ipKey) ?? [],
          dailyCount: days.get(input.dayKey) ?? 0,
        },
        {
          nowMs: input.nowMs,
          windowMs: CONFIRMATION_ADDRESS_WINDOW_MS,
          ipCap: input.ipCap,
          dailyCap: input.dailyCap,
        },
      );
      if (!decision.allow) return decision.limit;
      address.set(input.addressKey, decision.addressSentAt);
      ips.set(input.ipKey, decision.ipHits);
      days.set(input.dayKey, decision.dailyCount);
      return "ok";
    },
  };
}

export function createFirestoreConfirmationStore(): ConfirmationStore {
  const db = () => {
    if (admin.apps.length === 0) admin.initializeApp();
    return admin.firestore();
  };
  return {
    async suppressed(emailHash: string) {
      const snap = await db().collection("powerNowEmailSuppression").doc(emailHash).get();
      return snap.exists;
    },
    async reserve(input) {
      const firestore = db();
      const addressRef = firestore.collection("powerNowEmailAddressWindow").doc(input.addressKey);
      const ipRef = firestore.collection("powerNowEmailIpWindow").doc(input.ipKey);
      const dayRef = firestore.collection("powerNowEmailDaily").doc(input.dayKey);
      return firestore.runTransaction(async (tx) => {
        const [addressSnap, ipSnap, daySnap] = await Promise.all([tx.get(addressRef), tx.get(ipRef), tx.get(dayRef)]);
        const sentAt = addressSnap.get("sentAt");
        const hits = ipSnap.get("hits");
        const count = daySnap.get("count");
        const decision = decideReservation(
          {
            addressSentAt: typeof sentAt === "number" ? sentAt : null,
            ipHits: Array.isArray(hits) ? hits.filter((hit): hit is number => typeof hit === "number") : [],
            dailyCount: typeof count === "number" ? count : 0,
          },
          {
            nowMs: input.nowMs,
            windowMs: CONFIRMATION_ADDRESS_WINDOW_MS,
            ipCap: input.ipCap,
            dailyCap: input.dailyCap,
          },
        );
        if (!decision.allow) return decision.limit;
        tx.set(addressRef, { sentAt: decision.addressSentAt });
        tx.set(ipRef, { hits: decision.ipHits });
        tx.set(dayRef, { count: decision.dailyCount });
        return "ok" as const;
      });
    },
  };
}

export async function verifyRecaptchaEnterprise(input: {
  token: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  readSecret?: (name: string) => string | undefined;
}): Promise<CaptchaVerdict> {
  const siteKey = input.env.RECAPTCHA_ENTERPRISE_SITE_KEY?.trim()
    || input.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim()
    || "";
  const apiKey = input.readSecret?.("RECAPTCHA_ENTERPRISE_API_KEY")
    ?? input.env.RECAPTCHA_ENTERPRISE_API_KEY?.trim()
    ?? "";
  if (!siteKey || !apiKey) return { ok: false, errorClass: "CaptchaUnconfigured" };
  if (!input.token.trim()) return { ok: false, errorClass: "CaptchaMissing" };
  const project = input.env.RECAPTCHA_ENTERPRISE_PROJECT?.trim() || POWER_NOW_RECAPTCHA_PROJECT;
  const minScore = recaptchaMinScore(input.env);
  let response: Response;
  try {
    response = await input.fetchImpl(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(project)}/assessments?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            token: input.token,
            siteKey,
            expectedAction: POWER_NOW_RECAPTCHA_ACTION,
          },
        }),
      },
    );
  } catch {
    return { ok: false, errorClass: "CaptchaRejected" };
  }
  if (!response.ok) return { ok: false, errorClass: "CaptchaRejected" };
  const body = await response.json().catch(() => null) as {
    tokenProperties?: { valid?: boolean; action?: string };
    riskAnalysis?: { score?: number };
  } | null;
  const valid = body?.tokenProperties?.valid === true
    && body.tokenProperties.action === POWER_NOW_RECAPTCHA_ACTION
    && typeof body.riskAnalysis?.score === "number"
    && body.riskAnalysis.score >= minScore;
  return valid ? { ok: true } : { ok: false, errorClass: "CaptchaRejected" };
}

export async function sendWithResend(
  fetchImpl: typeof fetch,
  apiKey: string,
  message: {
    from: string;
    to: string;
    replyTo: string;
    subject: string;
    html: string;
    text: string;
    listUnsubscribe: string;
    idempotencyKey: string;
  },
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        reply_to: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { "List-Unsubscribe": message.listUnsubscribe },
      }),
    });
  } catch {
    throw new ConfirmationEmailError("SendFailed");
  }
  if (!response.ok) throw new ConfirmationEmailError("ResendRejected");
  const body = await response.json().catch(() => null) as { id?: unknown } | null;
  return typeof body?.id === "string" && body.id.trim() ? body.id.trim() : message.idempotencyKey;
}

export async function sendWithGraph(
  fetchImpl: typeof fetch,
  credentials: { tenantId: string; clientId: string; clientSecret: string },
  message: {
    from: string;
    to: string;
    replyTo: string;
    subject: string;
    html: string;
    listUnsubscribe: string;
    idempotencyKey: string;
  },
): Promise<string> {
  const tokenBody = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      },
    );
  } catch {
    throw new ConfirmationEmailError("GraphAuthFailed");
  }
  if (!tokenResponse.ok) throw new ConfirmationEmailError("GraphAuthFailed");
  const tokenJson = await tokenResponse.json().catch(() => null) as { access_token?: unknown } | null;
  const accessToken = typeof tokenJson?.access_token === "string" ? tokenJson.access_token : "";
  if (!accessToken) throw new ConfirmationEmailError("GraphAuthFailed");

  const fromAddress = mailboxAddress(message.from);
  const fromName = message.from.includes("<")
    ? message.from.slice(0, message.from.indexOf("<")).trim().replace(/^"|"$/g, "")
    : "Accel Analysis";
  let response: Response;
  try {
    response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromAddress)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "client-request-id": message.idempotencyKey,
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: "HTML", content: message.html },
            toRecipients: [{ emailAddress: { address: message.to } }],
            from: { emailAddress: { address: fromAddress, name: fromName || "Accel Analysis" } },
            replyTo: [{ emailAddress: { address: mailboxAddress(message.replyTo) } }],
            internetMessageHeaders: [
              { name: "x-list-unsubscribe", value: message.listUnsubscribe },
            ],
          },
          saveToSentItems: true,
        }),
      },
    );
  } catch {
    throw new ConfirmationEmailError("SendFailed");
  }
  if (!response.ok) throw new ConfirmationEmailError("GraphRejected");
  return `graph:${message.idempotencyKey}`;
}

export async function runPowerNowConfirmation(input: {
  lead: NormalizedPowerNow;
  personRecordId: string;
  env: NodeJS.ProcessEnv;
  now: Date;
  ip: string;
  startedAt: string | null;
  captchaToken: string | null;
  mailFetch?: typeof fetch;
  store?: ConfirmationStore;
  resolveMx?: MxLookup;
  verifyCaptcha?: PowerNowConfirmationOptions["verifyCaptcha"];
  readSecret?: (name: string) => string | undefined;
  onSendFailure: (errorClass: SendFailureClass) => Promise<void>;
  onSuccess: (note: string) => Promise<void>;
}): Promise<{ outcome: "sent" | "skipped"; errorClass?: string; messageId?: string }> {
  const env = input.env;
  const fetchImpl = input.mailFetch ?? fetch;
  const readSecret = input.readSecret ?? ((name: string) => readPowerNowSecret(name, env));
  try {
    const allowList = testRecipients(env);
    if (allowList && !allowList.includes(input.lead.email.trim().toLowerCase())) {
      return skipped(input.personRecordId, "TestRecipientSkipped");
    }
    if (!submittedSlowEnough(input.startedAt, input.now, confirmationMinSubmitMs(env))) {
      return skipped(input.personRecordId, "TooFast");
    }
    const domain = input.lead.email.split("@")[1] ?? "";
    if (isRoleAddress(input.lead.email)) return skipped(input.personRecordId, "RoleAddress");
    if (DISPOSABLE_DOMAINS.has(domain)) return skipped(input.personRecordId, "DisposableDomain");
    const lookup = input.resolveMx ?? defaultResolveMx;
    try {
      const records = await lookup(domain);
      if (!records.some((record) => record.exchange.trim())) return skipped(input.personRecordId, "MxFailed");
    } catch {
      return skipped(input.personRecordId, "MxFailed");
    }

    const verify = input.verifyCaptcha ?? ((captchaInput) => verifyRecaptchaEnterprise({ ...captchaInput, readSecret }));
    const captcha = await verify({ token: input.captchaToken ?? "", env, fetchImpl });
    if (!captcha.ok) return skipped(input.personRecordId, captcha.errorClass);

    const store = input.store ?? createFirestoreConfirmationStore();
    const emailHash = powerNowEmailHash(input.lead.email);
    let suppressed = false;
    try {
      suppressed = await store.suppressed(emailHash);
    } catch {
      return skipped(input.personRecordId, "RateLimitUnavailable");
    }
    if (suppressed) return skipped(input.personRecordId, "Suppressed");

    const provider = confirmationProvider(env);
    const graphReady = Boolean(
      readSecret("M365_TENANT_ID") && readSecret("M365_CLIENT_ID") && readSecret("M365_CLIENT_SECRET"),
    );
    const providerReady = provider === "graph" ? graphReady : provider === "resend" && Boolean(readSecret("RESEND_API_KEY"));
    if (!providerReady) return providerUnconfigured(input);

    const addressKey = `${emailHash}_${input.lead.path}`;
    const ipKey = powerNowEmailHash(input.ip.trim() || "unknown");
    const dayKey = input.now.toISOString().slice(0, 10);
    let reserved: "ok" | "address" | "ip" | "daily";
    try {
      reserved = await store.reserve({
        addressKey,
        ipKey,
        dayKey,
        nowMs: input.now.getTime(),
        ipCap: confirmationIpCap(env),
        dailyCap: confirmationDailyCap(env),
      });
    } catch {
      return skipped(input.personRecordId, "RateLimitUnavailable");
    }
    if (reserved !== "ok") {
      logConfirmation(input.personRecordId, "RateLimited");
      return { outcome: "skipped", errorClass: "RateLimited" };
    }

    const from = confirmationFrom(env);
    const replyTo = confirmationReplyTo(env);
    const built = buildPowerNowConfirmationMessage({
      path: input.lead.path,
      fullName: input.lead.fullName,
      assetBaseUrl: confirmationAssetBase(env),
      replyTo,
    });
    const idempotencyKey = confirmationDedupeKey(input.lead.email, input.lead.path, input.now);
    let messageId = "";
    if (provider === "graph") {
      messageId = await sendWithGraph(fetchImpl, {
        tenantId: readSecret("M365_TENANT_ID") ?? "",
        clientId: readSecret("M365_CLIENT_ID") ?? "",
        clientSecret: readSecret("M365_CLIENT_SECRET") ?? "",
      }, {
        from,
        to: input.lead.email,
        replyTo,
        subject: built.subject,
        html: built.html,
        listUnsubscribe: built.listUnsubscribe,
        idempotencyKey,
      });
    } else {
      messageId = await sendWithResend(fetchImpl, readSecret("RESEND_API_KEY") ?? "", {
        from,
        to: input.lead.email,
        replyTo,
        subject: built.subject,
        html: built.html,
        text: built.text,
        listUnsubscribe: built.listUnsubscribe,
        idempotencyKey,
      });
    }

    const note = confirmationSuccessNote({
      subject: built.subject,
      sentAtEt: formatIsoEastern(input.now),
      version: built.version,
      sender: from,
      messageId,
      path: input.lead.path,
    });
    try {
      await input.onSuccess(note);
    } catch {
      logConfirmation(input.personRecordId, "SendFailed");
    }
    return { outcome: "sent", messageId };
  } catch (error) {
    const errorClass: SendFailureClass = error instanceof ConfirmationEmailError
      ? error.errorClass as SendFailureClass
      : "SendFailed";
    logConfirmation(input.personRecordId, errorClass);
    try {
      await input.onSendFailure(errorClass);
    } catch {
      logConfirmation(input.personRecordId, errorClass);
    }
    return { outcome: "skipped", errorClass };
  }
}

export class ConfirmationEmailError extends Error {
  readonly errorClass: SendFailureClass;

  constructor(errorClass: SendFailureClass) {
    super(errorClass);
    this.name = "ConfirmationEmailError";
    this.errorClass = errorClass;
  }
}

async function providerUnconfigured(input: {
  personRecordId: string;
  onSendFailure: (errorClass: "ProviderUnconfigured") => Promise<void>;
}): Promise<{ outcome: "skipped"; errorClass: "ProviderUnconfigured" }> {
  logConfirmation(input.personRecordId, "ProviderUnconfigured");
  try {
    await input.onSendFailure("ProviderUnconfigured");
  } catch {
    logConfirmation(input.personRecordId, "ProviderUnconfigured");
  }
  return { outcome: "skipped", errorClass: "ProviderUnconfigured" };
}

function skipped(personRecordId: string, errorClass: string): { outcome: "skipped"; errorClass: string } {
  logConfirmation(personRecordId, errorClass);
  return { outcome: "skipped", errorClass };
}

function logConfirmation(personRecordId: string, errorClass: string): void {
  console.error("Power NOW confirmation email", { personRecordId, errorClass });
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

function recaptchaMinScore(env: NodeJS.ProcessEnv): number {
  const raw = env.POWER_NOW_RECAPTCHA_MIN_SCORE?.trim();
  if (!raw) return POWER_NOW_RECAPTCHA_MIN_SCORE_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return POWER_NOW_RECAPTCHA_MIN_SCORE_DEFAULT;
  return value;
}

function testRecipients(env: NodeJS.ProcessEnv): string[] | null {
  const raw = env.POWER_NOW_CONFIRMATION_TEST_RECIPIENTS;
  if (raw == null || raw.trim() === "") return null;
  const list = raw.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  return list.length > 0 ? list : null;
}

function submittedSlowEnough(startedAt: string | null, now: Date, minMs: number): boolean {
  if (!startedAt?.trim()) return false;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started >= minMs;
}

function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.split("+")[0]?.trim().toLowerCase() ?? "";
  return ROLE_LOCAL_PARTS.has(local);
}

async function defaultResolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>> {
  return dns.resolveMx(domain);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkPlainContacts(escaped: string): string {
  return escaped
    .replace(
      /hello@accelanalysis\.com/g,
      '<a href="mailto:hello@accelanalysis.com" style="color:#2F5597;">hello@accelanalysis.com</a>',
    )
    .replace(
      /\(757\) 236-0651/g,
      '<a href="tel:+17572360651" style="color:#2F5597;">(757) 236-0651</a>',
    );
}
