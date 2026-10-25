/**
 * Refund and cancellation emails for members, sent by stripe_webhook:
 *
 * - Refund confirmation: once per Stripe refund (sentEmails/refund_{refundId}).
 * - Cancellation scheduled: the member cancelled in the billing portal and the
 *   membership stays active until the period end (customer.subscription.updated
 *   with a cancel date). Once per subscription and end date.
 * - Membership ended: customer.subscription.deleted. Once per subscription.
 *
 * Same pattern as membershipWelcomeEmail.ts: transactional (no marketing
 * opt-out check), a Firestore claim in sentEmails/{key} so each email goes out
 * once, and a send failure is logged and recorded but never thrown, so the
 * webhook and the membership/ledger updates are unaffected. Logs carry the
 * uid and Stripe IDs, never the recipient address.
 *
 * Complimentary memberships (users/{uid}.membershipSource == "comp", added by
 * PR #118) have no paid subscription, so the cancellation emails skip them.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  EmailSendError,
  ResendEmailProvider,
  type EmailProvider,
} from "../providers/emailProvider";
import {
  CONTACT_EMAIL,
  SPACE_ADDRESS,
  escapeHtml,
  firestoreWelcomeEmailStore,
  firstNameOf,
  siteOrigin,
  type WelcomeEmailStore,
} from "./membershipWelcomeEmail";
import { getTierById } from "./stripeConfig";
import { formatMoney, refundDestination } from "./stripeRefund";
import type { StripeRefundLine, StripeRefundSnapshot } from "./types";

export const REFUND_CONFIRMATION_CATEGORY = "refund_confirmation";
export const CANCELLATION_SCHEDULED_CATEGORY = "membership_cancellation_scheduled";
export const MEMBERSHIP_ENDED_CATEGORY = "membership_ended";
export const MEMBER_NOTICE_TEMPLATE_VERSION = "v1";
/** Matches COMP_MEMBERSHIP_SOURCE in PR #118's compMembership.ts. */
export const COMP_MEMBERSHIP_SOURCE = "comp";
export const COMPANY_NAME = "Accel Analysis";
const FACILITY_TIME_ZONE = "America/New_York";

export type NoticeCopy = { subject: string; html: string; text: string };

export function formatNoticeDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ms));
}

export function planLabel(planId?: string | null): string {
  const tier = planId ? getTierById(planId) : undefined;
  if (!tier) return "Hi Coworking membership";
  // "Coworking Member" reads as "Coworking membership", not "Coworking Member membership".
  const name = tier.name.replace(/\s+Member$/i, "");
  return `${name} membership`;
}

function greetingFor(firstName?: string): string {
  const name = (firstName || "").trim();
  return name ? `Hi ${name},` : "Hi there,";
}

/** Shared layout so the three emails match the welcome email. */
function layout(input: {
  subject: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  accountUrl: string;
  linkLabel: string;
  footerReason: string;
}): NoticeCopy {
  const p = "margin:0 0 16px;font-size:16px;line-height:1.7;color:#475569";
  const link = "color:#0f172a;font-weight:600";
  const helpLine = `If you have any questions, reply to this email or write to us at ${CONTACT_EMAIL}.`;
  const helpHtml = escapeHtml(helpLine).replace(
    escapeHtml(CONTACT_EMAIL),
    `<a href="mailto:${CONTACT_EMAIL}" style="${link}">${CONTACT_EMAIL}</a>`,
  );
  const footer = `Hi Coworking · ${COMPANY_NAME} · ${SPACE_ADDRESS}`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>`
    + `<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">`
    + `<div style="max-width:620px;margin:0 auto;padding:40px 24px">`
    + `<div style="font-size:14px;font-weight:700;letter-spacing:.02em">Hi Coworking</div>`
    + `<h1 style="margin:24px 0 12px;font-size:28px;line-height:1.2">${escapeHtml(input.heading)}</h1>`
    + `<p style="${p}">${escapeHtml(input.greeting)}</p>`
    + input.paragraphs.map((line) => `<p style="${p}">${escapeHtml(line)}</p>`).join("")
    + `<p style="margin:24px 0"><a href="${escapeHtml(input.accountUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:650">${escapeHtml(input.linkLabel)}</a></p>`
    + `<p style="${p}">${helpHtml}</p>`
    + `<p style="${p}">Thank you,<br>The Hi Coworking team</p>`
    + `<p style="margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b">${escapeHtml(input.footerReason)} ${escapeHtml(footer)} · <a href="mailto:${CONTACT_EMAIL}" style="color:#475569">${CONTACT_EMAIL}</a></p>`
    + `</div></body></html>`;

  const text = [
    input.greeting,
    "",
    ...input.paragraphs.flatMap((line) => [line, ""]),
    `${input.linkLabel}: ${input.accountUrl}`,
    "",
    helpLine,
    "",
    "Thank you,",
    "The Hi Coworking team",
    "",
    "--",
    input.footerReason,
    `${footer} · ${CONTACT_EMAIL}`,
  ].join("\n");

  return { subject: input.subject, html, text };
}

export function renderRefundEmail(input: {
  amountCents: number;
  currency?: string;
  /** Captured amount of the charge, to say when a refund is partial. */
  chargeAmountCents?: number;
  cardLast4?: string;
  cardBrand?: string;
  firstName?: string;
  origin?: string;
}): NoticeCopy {
  const origin = (input.origin || siteOrigin()).replace(/\/+$/, "");
  const amount = formatMoney(input.amountCents, input.currency);
  const destination = refundDestination(input);
  const partial = Boolean(input.chargeAmountCents && input.amountCents < input.chargeAmountCents);
  const paragraphs = [
    `We've refunded ${amount} to ${destination}.`
      + (partial ? ` This is a partial refund of your ${formatMoney(input.chargeAmountCents || 0, input.currency)} payment.` : ""),
    "Refunds usually take 5–10 business days to appear on your statement, depending on your bank.",
    "You can see your membership and billing details in My Hi at any time.",
  ];
  return layout({
    subject: `Your Hi Coworking refund of ${amount} is on its way`,
    heading: "Your refund is on its way",
    greeting: greetingFor(input.firstName),
    paragraphs,
    accountUrl: `${origin}/my-hi`,
    linkLabel: "Manage membership & billing",
    footerReason: "You're receiving this email because Hi Coworking issued you a refund.",
  });
}

export function renderCancellationScheduledEmail(input: {
  activeUntilMs: number;
  planId?: string | null;
  firstName?: string;
  origin?: string;
}): NoticeCopy {
  const origin = (input.origin || siteOrigin()).replace(/\/+$/, "");
  const date = formatNoticeDate(input.activeUntilMs);
  const plan = planLabel(input.planId);
  return layout({
    subject: `Your Hi Coworking membership is active until ${date}`,
    heading: "Your cancellation is confirmed",
    greeting: greetingFor(input.firstName),
    paragraphs: [
      `We've received your request to cancel your ${plan}. Your membership stays active until ${date}, and it won't renew after that.`,
      "Until then, you can keep booking desks and the meeting room as usual.",
      `If you change your mind, you can keep your membership: open My Hi and choose Manage membership & billing before ${date}.`,
    ],
    accountUrl: `${origin}/my-hi`,
    linkLabel: "Manage membership & billing",
    footerReason: "You're receiving this email because you cancelled your Hi Coworking membership.",
  });
}

export function renderMembershipEndedEmail(input: {
  endedAtMs: number;
  planId?: string | null;
  firstName?: string;
  origin?: string;
}): NoticeCopy {
  const origin = (input.origin || siteOrigin()).replace(/\/+$/, "");
  const date = formatNoticeDate(input.endedAtMs);
  const plan = planLabel(input.planId);
  return layout({
    subject: "Your Hi Coworking membership has ended",
    heading: "Your membership has ended",
    greeting: greetingFor(input.firstName),
    paragraphs: [
      `Your ${plan} ended on ${date}, and you won't be charged for it again.`,
      "Thank you for being part of Hi Coworking. If you'd like to come back, you can choose a plan again at any time from My Hi.",
    ],
    accountUrl: `${origin}/my-hi`,
    linkLabel: "Manage membership & billing",
    footerReason: "You're receiving this email because your Hi Coworking membership ended.",
  });
}

export type NoticeOutcome =
  | "sent"
  | "skipped_missing_data"
  | "skipped_comp_membership"
  | "skipped_not_cancelled"
  | "skipped_different_subscription"
  | "skipped_no_recipient"
  | "skipped_no_api_key"
  | "skipped_already_sent"
  | "failed";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export interface NoticeMember {
  email?: string;
  displayName?: string;
  membershipStatus?: string;
  membershipSource?: string | null;
  plan?: string | null;
  stripeSubscriptionId?: string;
  features?: Record<string, unknown> | null;
}

/** Store for the once-only marker plus the member fields the notices need. */
export interface NoticeStore extends Pick<WelcomeEmailStore, "claim" | "markSent" | "markFailed"> {
  loadMember(uid: string): Promise<NoticeMember | null>;
}

export function firestoreNoticeStore(db: FirebaseFirestore.Firestore = admin.firestore()): NoticeStore {
  const base = firestoreWelcomeEmailStore(db);
  return {
    claim: base.claim,
    markSent: base.markSent,
    markFailed: base.markFailed,
    async loadMember(uid) {
      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      const str = (value: unknown) => (typeof value === "string" ? value : undefined);
      return {
        email: str(data.email),
        displayName: str(data.displayName),
        membershipStatus: str(data.membershipStatus),
        membershipSource: str(data.membershipSource) ?? null,
        plan: str(data.plan) ?? null,
        stripeSubscriptionId: str(data.stripeSubscriptionId),
        features: (data.features && typeof data.features === "object") ? data.features as Record<string, unknown> : null,
      };
    },
  };
}

export interface NoticeOptions {
  apiKey?: string;
  provider?: EmailProvider;
  store?: NoticeStore;
  now?: () => number;
  origin?: string;
}

function storedSubscription(member: NoticeMember): string {
  const fromFeatures = member.features?.stripeSubscriptionId;
  if (typeof fromFeatures === "string" && fromFeatures) return fromFeatures;
  return member.stripeSubscriptionId || "";
}

/** Claim, send, record. Never throws. */
async function sendOnce(input: {
  key: string;
  category: string;
  uid: string;
  logContext: Record<string, unknown>;
  label: string;
  marker: Record<string, unknown>;
  /** Builds the copy from the member, or returns a skip outcome. */
  build: (member: NoticeMember | null) => NoticeCopy | Exclude<NoticeOutcome, "sent" | "failed">;
  options: NoticeOptions;
}): Promise<NoticeOutcome> {
  const { options, logContext, label } = input;
  const now = options.now ?? Date.now;
  try {
    if (!options.provider && !options.apiKey) {
      logger.warn(`${label} skipped: Resend API key not configured`, logContext);
      return "skipped_no_api_key";
    }
    const store = options.store ?? firestoreNoticeStore();
    let member: NoticeMember | null = null;
    try {
      member = await store.loadMember(input.uid);
    } catch (error) {
      logger.warn(`${label}: could not load user doc`, { ...logContext, error: String(error) });
    }
    const built = input.build(member);
    if (typeof built === "string") {
      logger.info(`${label} skipped`, { ...logContext, reason: built });
      return built;
    }
    const to = (member?.email || "").trim();
    if (!EMAIL_RE.test(to)) {
      logger.warn(`${label} skipped: no valid recipient`, logContext);
      return "skipped_no_recipient";
    }
    const claimed = await store.claim(input.key, {
      type: input.category,
      template: `${input.category}-${MEMBER_NOTICE_TEMPLATE_VERSION}`,
      uid: input.uid,
      ...input.marker,
    }, now());
    if (!claimed) {
      logger.info(`${label} already sent or in progress`, logContext);
      return "skipped_already_sent";
    }
    const provider = options.provider ?? new ResendEmailProvider(options.apiKey || "");
    try {
      const { messageId } = await provider.send({
        to,
        subject: built.subject,
        html: built.html,
        text: built.text,
        categories: [input.category, "transactional"],
        idempotencyKey: `${input.category}/${input.key}`,
      });
      await store.markSent(input.key, messageId, now()).catch((error) => {
        logger.error(`${label} sent but marker update failed`, { ...logContext, error: String(error) });
      });
      logger.info(`${label} sent`, { ...logContext, messageId });
      return "sent";
    } catch (error) {
      const code = error instanceof EmailSendError ? `${error.status ?? "network"}_${error.code}` : "unexpected_error";
      await store.markFailed(input.key, code, now()).catch(() => undefined);
      logger.error(`${label} failed (non-fatal)`, { ...logContext, code });
      return "failed";
    }
  } catch (error) {
    logger.error(`${label} failed unexpectedly (non-fatal)`, {
      ...logContext,
      error: error instanceof Error ? error.name : "unknown",
    });
    return "failed";
  }
}

/** Refund confirmation for one issued refund. Never throws. */
export async function sendRefundEmail(
  uid: string,
  snapshot: StripeRefundSnapshot,
  refund: StripeRefundLine,
  options: NoticeOptions = {},
): Promise<NoticeOutcome> {
  const logContext = { uid, refundId: refund.id, chargeId: snapshot.chargeId };
  if (!uid || !refund.id || refund.amountCents <= 0) return "skipped_missing_data";
  return sendOnce({
    key: `refund_${refund.id}`,
    category: REFUND_CONFIRMATION_CATEGORY,
    uid,
    logContext,
    label: "Refund confirmation email",
    marker: { refundId: refund.id, chargeId: snapshot.chargeId, amountCents: refund.amountCents },
    options,
    build: (member) => renderRefundEmail({
      amountCents: refund.amountCents,
      currency: snapshot.currency,
      chargeAmountCents: snapshot.amountCents,
      cardLast4: snapshot.cardLast4,
      cardBrand: snapshot.cardBrand,
      firstName: firstNameOf(member?.displayName),
      origin: options.origin,
    }),
  });
}

/** "Active until {date}" after the member schedules a cancellation. Never throws. */
export async function sendCancellationScheduledEmail(
  input: { uid: string; subscriptionId: string; activeUntilMs: number; eventId?: string },
  options: NoticeOptions = {},
): Promise<NoticeOutcome> {
  const { uid, subscriptionId, activeUntilMs } = input;
  const logContext = { uid, subscriptionId, activeUntilMs };
  if (!uid || !subscriptionId || !(activeUntilMs > 0)) return "skipped_missing_data";
  return sendOnce({
    key: `cancel_scheduled_${subscriptionId}_${activeUntilMs}`,
    category: CANCELLATION_SCHEDULED_CATEGORY,
    uid,
    logContext,
    label: "Cancellation scheduled email",
    marker: { subscriptionId, activeUntilMs, ...(input.eventId ? { eventId: input.eventId } : {}) },
    options,
    build: (member) => {
      if (member?.membershipSource === COMP_MEMBERSHIP_SOURCE) return "skipped_comp_membership";
      const stored = member ? storedSubscription(member) : "";
      if (stored && stored !== subscriptionId) return "skipped_different_subscription";
      return renderCancellationScheduledEmail({
        activeUntilMs,
        planId: member?.plan,
        firstName: firstNameOf(member?.displayName),
        origin: options.origin,
      });
    },
  });
}

/**
 * "Your membership has ended" after customer.subscription.deleted, only when
 * that event actually ended the membership (membershipStatus "cancelled").
 * A comp membership that the deleted event left alone gets nothing. Never throws.
 */
export async function sendMembershipEndedEmail(
  input: { uid: string; subscriptionId: string; endedAtMs: number; planId?: string; eventId?: string },
  options: NoticeOptions = {},
): Promise<NoticeOutcome> {
  const { uid, subscriptionId } = input;
  const endedAtMs = input.endedAtMs > 0 ? input.endedAtMs : (options.now ?? Date.now)();
  const logContext = { uid, subscriptionId };
  if (!uid || !subscriptionId) return "skipped_missing_data";
  return sendOnce({
    key: `membership_ended_${subscriptionId}`,
    category: MEMBERSHIP_ENDED_CATEGORY,
    uid,
    logContext,
    label: "Membership ended email",
    marker: { subscriptionId, endedAtMs, ...(input.eventId ? { eventId: input.eventId } : {}) },
    options,
    build: (member) => {
      if (member?.membershipSource === COMP_MEMBERSHIP_SOURCE) return "skipped_comp_membership";
      if (member?.membershipStatus !== "cancelled") return "skipped_not_cancelled";
      const stored = storedSubscription(member);
      if (stored && stored !== subscriptionId) return "skipped_different_subscription";
      return renderMembershipEndedEmail({
        endedAtMs,
        planId: input.planId,
        firstName: firstNameOf(member.displayName),
        origin: options.origin,
      });
    },
  });
}
