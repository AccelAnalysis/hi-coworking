/**
 * SayHi follow-up emails. Wording approved by Jonathan (Nov 1, 2026, 6:18 AM
 * ET) with the included-hours billing change; the new billing variants are
 * part of that change.
 *
 *  - Extra time: sent once per visit after extra time is settled. Members
 *    with a live plan: covered by included hours, partly covered with the
 *    rest charged to the payment method on file, or all charged. Guests:
 *    charged to the card used for the booking. Never sent when there is no
 *    card or the charge fails (that goes to staff review).
 *  - No check-out: sent once per visit when the visit is flagged for staff
 *    review because nobody checked out.
 *
 * Both stay off unless SAYHI_FLOW_ENABLED is "true" in the mail codebase env.
 * Copy rules: Hi Navy, PNG mark, Fraunces headline, DM Sans body, "SayHi" as
 * one word, no street address, no payment-processor names, no unpublished
 * prices, links to /my-hi and /terms#extra-time. Sender and reply-to come
 * from emailProvider (config), never from here.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { EmailProvider, EmailSendError, ResendEmailProvider } from "../providers/emailProvider";
import {
  EMAIL_BODY_FONT,
  EMAIL_BUTTON_STYLE,
  EMAIL_HEADLINE_FONT,
  EMAIL_LOGO_HTML,
  EMAIL_NAVY,
} from "../payments/emailBrand";
import {
  WelcomeEmailStore,
  escapeHtml,
  firestoreWelcomeEmailStore,
  firstNameOf,
  siteOrigin,
} from "../payments/membershipWelcomeEmail";
import { sayhiFlowEnabled } from "./config";

export const EXTRA_TIME_EMAIL_TYPE = "sayhi_extra_time";
export const NO_CHECKOUT_EMAIL_TYPE = "sayhi_no_checkout";
export const EXTRA_TIME_EMAIL_TEMPLATE = "sayhi-extra-time-v2";
export const NO_CHECKOUT_EMAIL_TEMPLATE = "sayhi-no-checkout-v1";
export const EMAIL_TIME_ZONE = "America/New_York";

export type FollowUpEmailCopy = { subject: string; html: string; text: string };
/**
 * included: all extra time came from plan hours (no charge).
 * partly_included: some from plan hours, the rest charged.
 * member_card: no plan hours left, all charged to the member's payment method.
 * card: guest or non-plan visit, charged to the booking card.
 */
export type ExtraTimeBilling = "included" | "partly_included" | "member_card" | "card";

/** One sentEmails marker per visit per email type. */
export function followUpEmailId(type: typeof EXTRA_TIME_EMAIL_TYPE | typeof NO_CHECKOUT_EMAIL_TYPE, visitId: string): string {
  return `${type}_${visitId}`;
}

export function formatVisitDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: EMAIL_TIME_ZONE, weekday: "long", month: "long", day: "numeric" }).format(ms);
}

export function formatVisitTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: EMAIL_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(ms);
}

export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const h = hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "";
  const m = rest ? `${rest} minutes` : "";
  return [h, m].filter(Boolean).join(" ") || "0 minutes";
}

export function formatAmount(cents: number): string {
  return `$${(Math.max(0, Math.round(cents)) / 100).toFixed(2)}`;
}

type Block = { kind: "p"; text: string } | { kind: "button"; label: string; url: string } | { kind: "link"; before: string; label: string; url: string };

function layout(input: { preheader: string; headline: string; blocks: Block[]; signoff: string[]; footer: string }): string {
  const p = `margin:0 0 16px;font-family:${EMAIL_BODY_FONT};font-size:16px;line-height:1.6;color:#1f2937`;
  const body = input.blocks
    .map((block) => {
      if (block.kind === "p") return `<p style="${p}">${escapeHtml(block.text)}</p>`;
      if (block.kind === "button") {
        return `<p style="margin:8px 0 24px"><a href="${escapeHtml(block.url)}" style="${EMAIL_BUTTON_STYLE};font-family:${EMAIL_BODY_FONT}">${escapeHtml(block.label)}</a></p>`;
      }
      return `<p style="${p}">${escapeHtml(block.before)}<a href="${escapeHtml(block.url)}" style="color:${EMAIL_NAVY};font-weight:650">${escapeHtml(block.label)}</a></p>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.headline)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;650&family=Fraunces:opsz,wght@9..144,600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f5f6fa">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border-top:6px solid ${EMAIL_NAVY}">
<tr><td style="padding:32px 32px 8px">${EMAIL_LOGO_HTML}</td></tr>
<tr><td style="padding:8px 32px 32px">
<h1 style="margin:0 0 20px;font-family:${EMAIL_HEADLINE_FONT};font-weight:600;font-size:28px;line-height:1.25;color:${EMAIL_NAVY}">${escapeHtml(input.headline)}</h1>
${body}
<p style="${p};margin-top:24px">${input.signoff.map(escapeHtml).join("<br>")}</p>
</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-family:${EMAIL_BODY_FONT};font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(input.footer)}</p>
</td></tr>
</table>
</body>
</html>`;
}

function text(input: { headline: string; blocks: Block[]; signoff: string[]; footer: string }): string {
  const lines: string[] = [input.headline, ""];
  for (const block of input.blocks) {
    if (block.kind === "p") lines.push(block.text, "");
    else if (block.kind === "button") lines.push(`${block.label}: ${block.url}`, "");
    else lines.push(`${block.before}${block.label}: ${block.url}`, "");
  }
  lines.push(...input.signoff, "", "--", input.footer);
  return lines.join("\n");
}

const SIGNOFF = ["Thanks for being with us during Early Access,", "The Hi Coworking team"];
const FOOTER = "You're receiving this email because of a recent visit to Hi Coworking.";

export function renderExtraTimeEmail(input: {
  billing: ExtraTimeBilling;
  firstName?: string;
  bookedEnd: number;
  checkOutAt: number;
  /** All billable extra minutes. */
  minutes: number;
  /** Minutes taken from included plan hours (included / partly_included). */
  includedMinutes?: number;
  /** Amount charged (0 when fully covered). */
  cents: number;
  origin?: string;
}): FollowUpEmailCopy {
  const origin = (input.origin || siteOrigin()).replace(/\/+$/, "");
  const date = formatVisitDate(input.bookedEnd);
  const amount = formatAmount(input.cents);
  const duration = formatDuration(input.minutes);
  const includedMinutes = Math.max(0, Math.min(input.minutes, Math.round(input.includedMinutes || 0)));
  const included = formatDuration(includedMinutes);
  const rest = formatDuration(input.minutes - includedMinutes);
  const subject = `Extra time from your visit on ${date}`;
  const headline = "Extra time from your visit";
  const rules = "Checking out within 15 minutes after a booking ends has no extra charge. After that, extra time is counted in 15-minute steps from the end of your booking, so this visit has";
  let amounts: string;
  let billingLine: string;
  let preheader: string;
  switch (input.billing) {
    case "included":
      amounts = `${rules} ${duration} of extra time. All ${duration} came from your plan's included hours for this month.`;
      billingLine = "There's no charge for this extra time, and there's nothing else you need to do.";
      preheader = `${duration} of extra time, covered by your included hours.`;
      break;
    case "partly_included":
      amounts = `${rules} ${duration} of extra time. Of that, ${included} came from your plan's included hours for this month, and the other ${rest} came to ${amount}.`;
      billingLine = `We've charged ${amount} to the payment method on file for your membership. There's nothing else you need to do.`;
      preheader = `${duration} of extra time, ${included} from your included hours, ${amount} charged.`;
      break;
    case "member_card":
      amounts = `${rules} ${duration} of extra time, for ${amount}. You had no included plan hours left this month to put toward it.`;
      billingLine = "We've charged this amount to the payment method on file for your membership. There's nothing else you need to do.";
      preheader = `${duration} of extra time, ${amount}.`;
      break;
    default:
      amounts = `${rules} ${duration} of extra time, for ${amount}.`;
      billingLine = "We've charged this amount to the card you used for your booking. There's nothing else you need to do.";
      preheader = `${duration} of extra time, ${amount}.`;
  }
  const blocks: Block[] = [
    { kind: "p", text: input.firstName ? `Hi ${input.firstName},` : "Hi there," },
    {
      kind: "p",
      text: `Thanks for working at Hi Coworking on ${date}. Your booking ended at ${formatVisitTime(input.bookedEnd)}, and you checked out at ${formatVisitTime(input.checkOutAt)}.`,
    },
    { kind: "p", text: amounts },
    { kind: "p", text: billingLine },
    { kind: "p", text: "You can see your visits, including any extra time, in SayHi." },
    { kind: "button", label: "Open SayHi", url: `${origin}/my-hi` },
    { kind: "link", before: "Read ", label: "how extra time works", url: `${origin}/terms#extra-time` },
    {
      kind: "p",
      text: input.billing === "included"
        ? "Questions about your extra time? Reply to this email and our team will help."
        : "Questions about this charge? Reply to this email and our team will help.",
    },
  ];
  return { subject, html: layout({ preheader, headline, blocks, signoff: SIGNOFF, footer: FOOTER }), text: text({ headline, blocks, signoff: SIGNOFF, footer: FOOTER }) };
}

export function renderNoCheckoutEmail(input: {
  firstName?: string;
  visitDate: number;
  bookedEnd?: number | null;
  origin?: string;
}): FollowUpEmailCopy {
  const origin = (input.origin || siteOrigin()).replace(/\/+$/, "");
  const booked = Number.isFinite(Number(input.bookedEnd)) && Number(input.bookedEnd) > 0;
  const date = formatVisitDate(booked ? Number(input.bookedEnd) : input.visitDate);
  const subject = `We didn't see you check out on ${date}`;
  const headline = "We didn't see you check out";
  const blocks: Block[] = [
    { kind: "p", text: input.firstName ? `Hi ${input.firstName},` : "Hi there," },
    booked
      ? { kind: "p", text: `Your booking at Hi Coworking on ${date} ended at ${formatVisitTime(Number(input.bookedEnd))}, but we didn't see a check-out on the front-desk iPad.` }
      : { kind: "p", text: `We didn't see a check-out on the front-desk iPad after your visit to Hi Coworking on ${date}.` },
    booked
      ? { kind: "p", text: "When there's no check-out, time is counted up to one hour after your booking ends. Our team will review your visit and confirm your time before any extra time is charged." }
      : { kind: "p", text: "Our team will review your visit and confirm your time." },
    { kind: "p", text: "If you left on time, just reply to this email with the time you left, and we'll update your visit." },
    { kind: "p", text: "Next time, please check out on the iPad at the front desk as you leave." },
    { kind: "button", label: "Open SayHi", url: `${origin}/my-hi` },
    { kind: "link", before: "Read ", label: "how check-out and extra time work", url: `${origin}/terms#extra-time` },
  ];
  const preheader = "Our team will review your visit. Reply if you left on time.";
  return { subject, html: layout({ preheader, headline, blocks, signoff: SIGNOFF, footer: FOOTER }), text: text({ headline, blocks, signoff: SIGNOFF, footer: FOOTER }) };
}

// ---------------------------------------------------------------------------
// When to send
// ---------------------------------------------------------------------------

const SETTLED = ["charged", "covered_by_plan_hours"] as const;

export type VisitLike = {
  uid?: unknown;
  status?: unknown;
  chargeStatus?: unknown;
  overtimeBilling?: unknown;
  overtimeMinutes?: unknown;
  overtimeIncludedMinutes?: unknown;
  overtimeCents?: unknown;
  bookedWindow?: { start?: unknown; end?: unknown } | null;
  checkInAt?: unknown;
  checkOutAt?: unknown;
};

/** The email variant when this update is the moment extra time was settled, else null. */
export function extraTimeEmailBilling(before: VisitLike | undefined, after: VisitLike | undefined): ExtraTimeBilling | null {
  if (!after) return null;
  const isSettled = (status: unknown) => (SETTLED as readonly unknown[]).includes(status);
  if (!isSettled(after.chargeStatus) || isSettled(before?.chargeStatus)) return null;
  const minutes = Number(after.overtimeMinutes);
  const included = Math.max(0, Number(after.overtimeIncludedMinutes) || 0);
  const cents = Number(after.overtimeCents);
  if (!(minutes > 0)) return null;
  if (!Number.isFinite(Number(after.bookedWindow?.end)) || !Number.isFinite(Number(after.checkOutAt))) return null;
  if (after.chargeStatus === "covered_by_plan_hours") {
    return after.overtimeBilling === "plan" && included >= minutes ? "included" : null;
  }
  if (!(cents > 0)) return null;
  if (after.overtimeBilling !== "plan") return "card";
  return included > 0 ? "partly_included" : "member_card";
}

/** A staff follow-up for a visit nobody checked out of (Jessica's flag). */
export function isNoCheckoutFlag(followUp: { type?: unknown; visitId?: unknown } | undefined): boolean {
  return followUp?.type === "no_checkout" && typeof followUp.visitId === "string" && followUp.visitId.length > 0;
}

// ---------------------------------------------------------------------------
// Sending (never throws)
// ---------------------------------------------------------------------------

export type FollowUpEmailOutcome =
  | "sent"
  | "skipped_flag_off"
  | "skipped_not_applicable"
  | "skipped_no_recipient"
  | "skipped_no_api_key"
  | "skipped_already_sent"
  | "failed";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

type SendOptions = {
  apiKey?: string;
  provider?: EmailProvider;
  store?: WelcomeEmailStore;
  env?: Record<string, string | undefined>;
  now?: () => number;
  origin?: string;
};

async function deliver(input: {
  type: typeof EXTRA_TIME_EMAIL_TYPE | typeof NO_CHECKOUT_EMAIL_TYPE;
  template: string;
  visitId: string;
  uid: string;
  render: (firstName: string) => FollowUpEmailCopy;
  extra: Record<string, unknown>;
  options: SendOptions;
}): Promise<FollowUpEmailOutcome> {
  const { options } = input;
  const now = options.now ?? Date.now;
  const logContext = { type: input.type, visitId: input.visitId };
  if (!options.provider && !options.apiKey) {
    logger.warn("SayHi follow-up email skipped: email API key not configured", logContext);
    return "skipped_no_api_key";
  }
  const store = options.store ?? firestoreWelcomeEmailStore();
  let user: { email?: string; displayName?: string } | null = null;
  try {
    user = await store.loadUser(input.uid);
  } catch (error) {
    logger.warn("SayHi follow-up email: could not load user doc", { ...logContext, error: String(error) });
  }
  const to = typeof user?.email === "string" ? user.email.trim() : "";
  if (!EMAIL_RE.test(to)) {
    logger.warn("SayHi follow-up email skipped: no valid recipient", logContext);
    return "skipped_no_recipient";
  }
  const copy = input.render(firstNameOf(user?.displayName));
  const id = followUpEmailId(input.type, input.visitId);
  const claimed = await store.claim(id, { type: input.type, template: input.template, uid: input.uid, visitId: input.visitId, ...input.extra }, now());
  if (!claimed) {
    logger.info("SayHi follow-up email already sent or in progress", logContext);
    return "skipped_already_sent";
  }
  const provider = options.provider ?? new ResendEmailProvider(options.apiKey || "");
  try {
    const { messageId } = await provider.send({
      to,
      subject: copy.subject,
      html: copy.html,
      text: copy.text,
      categories: [input.type, "transactional"],
      idempotencyKey: `${input.type}/${input.visitId}`,
    });
    await store.markSent(id, messageId, now()).catch((error) => {
      logger.error("SayHi follow-up email sent but marker update failed", { ...logContext, error: String(error) });
    });
    logger.info("SayHi follow-up email sent", { ...logContext, messageId });
    return "sent";
  } catch (error) {
    const code = error instanceof EmailSendError ? `${error.status ?? "network"}_${error.code}` : "unexpected_error";
    await store.markFailed(id, code, now()).catch(() => undefined);
    logger.error("SayHi follow-up email failed (non-fatal)", { ...logContext, code });
    return "failed";
  }
}

export async function sendExtraTimeEmail(
  input: { visitId: string; before: VisitLike | undefined; after: VisitLike | undefined },
  options: SendOptions = {},
): Promise<FollowUpEmailOutcome> {
  try {
    if (!sayhiFlowEnabled(options.env)) return "skipped_flag_off";
    const billing = extraTimeEmailBilling(input.before, input.after);
    const after = input.after;
    const uid = typeof after?.uid === "string" ? after.uid : "";
    if (!billing || !after || !uid) return "skipped_not_applicable";
    const minutes = Number(after.overtimeMinutes);
    const includedMinutes = Math.max(0, Number(after.overtimeIncludedMinutes) || 0);
    const cents = Math.max(0, Number(after.overtimeCents) || 0);
    return await deliver({
      type: EXTRA_TIME_EMAIL_TYPE,
      template: EXTRA_TIME_EMAIL_TEMPLATE,
      visitId: input.visitId,
      uid,
      extra: { billing, overtimeMinutes: minutes, overtimeIncludedMinutes: includedMinutes, overtimeCents: cents },
      options,
      render: (firstName) => renderExtraTimeEmail({
        billing,
        firstName,
        bookedEnd: Number(after.bookedWindow?.end),
        checkOutAt: Number(after.checkOutAt),
        minutes,
        includedMinutes,
        cents,
        origin: options.origin,
      }),
    });
  } catch (error) {
    logger.error("SayHi extra-time email failed unexpectedly (non-fatal)", { visitId: input.visitId, error: error instanceof Error ? error.name : "unknown" });
    return "failed";
  }
}

export async function sendNoCheckoutEmail(
  input: { followUp: { type?: unknown; visitId?: unknown; memberId?: unknown } | undefined; loadVisit?: (visitId: string) => Promise<VisitLike | undefined> },
  options: SendOptions = {},
): Promise<FollowUpEmailOutcome> {
  const visitId = typeof input.followUp?.visitId === "string" ? input.followUp.visitId : "";
  try {
    if (!sayhiFlowEnabled(options.env)) return "skipped_flag_off";
    if (!isNoCheckoutFlag(input.followUp)) return "skipped_not_applicable";
    const loadVisit = input.loadVisit ?? (async (id: string) => (await admin.firestore().collection("kioskVisits").doc(id).get()).data() as VisitLike | undefined);
    const visit = await loadVisit(visitId);
    const uid = typeof visit?.uid === "string" ? visit.uid : typeof input.followUp?.memberId === "string" ? input.followUp.memberId : "";
    if (!visit || !uid) return "skipped_not_applicable";
    const bookedEnd = Number(visit.bookedWindow?.end);
    const visitDate = Number(visit.checkInAt) || Number(visit.checkOutAt) || (options.now ?? Date.now)();
    return await deliver({
      type: NO_CHECKOUT_EMAIL_TYPE,
      template: NO_CHECKOUT_EMAIL_TEMPLATE,
      visitId,
      uid,
      extra: {},
      options,
      render: (firstName) => renderNoCheckoutEmail({
        firstName,
        visitDate,
        bookedEnd: Number.isFinite(bookedEnd) ? bookedEnd : null,
        origin: options.origin,
      }),
    });
  } catch (error) {
    logger.error("SayHi no-check-out email failed unexpectedly (non-fatal)", { visitId, error: error instanceof Error ? error.name : "unknown" });
    return "failed";
  }
}
