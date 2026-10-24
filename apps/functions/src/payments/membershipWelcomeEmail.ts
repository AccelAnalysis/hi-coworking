/**
 * Membership welcome email, sent once per Stripe Checkout session after
 * checkout.session.completed provisions a membership (purpose=membership).
 *
 * Transactional: it confirms a purchase the member just made, so it does not
 * check the marketing opt-out. It never throws. A send failure is logged and
 * recorded on sentEmails/{checkoutSessionId}; the webhook and the membership
 * activation are unaffected.
 *
 * Logs carry the uid, plan and session id, never the recipient address.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  EmailSendError,
  ResendEmailProvider,
  type EmailProvider,
} from "../providers/emailProvider";
import { getTierById, type MembershipTier } from "./stripeConfig";
import type { WebhookResult } from "./types";

export const MEMBERSHIP_WELCOME_TEMPLATE = "membership-welcome-v1";
export const MEMBERSHIP_WELCOME_CATEGORY = "membership_welcome";
export const SENT_EMAILS_COLLECTION = "sentEmails";
/** Monitored inbox for member replies and questions. Also the default Reply-To. */
export const CONTACT_EMAIL = "hicoworking@accelanalysis.com";
/** Street address confirmed by Jonathan (Oct 24, 2026). */
export const SPACE_ADDRESS = "15373 Carrollton Blvd, Carrollton, VA 23314";
/** Staffed hours confirmed by Jonathan (Oct 24, 2026). */
export const SPACE_HOURS = "Monday to Friday, 8 AM to 5 PM";
/** A "sending" claim older than this is treated as abandoned and may be retried. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PUBLIC_SITE_URL || "https://hi-coworking.com").replace(/\/+$/, "");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Plan-specific lines, all derived from MEMBERSHIP_TIERS in stripeConfig.ts. */
export function planHighlights(tier: MembershipTier): string[] {
  const lines: string[] = [];
  if (tier.includedHoursPerMonth > 0) {
    lines.push(`${tier.includedHoursPerMonth} coworking desk hours included every month`);
    lines.push(`Extra desk hours at the member rate of ${money(tier.extraHourlyRateCents)}/hr`);
    lines.push("Wi-Fi, coffee, and shared amenities when you work from the space");
  } else {
    lines.push(`A coworking desk whenever you need one, at ${money(tier.extraHourlyRateCents)}/hr. You pay only for the time you book`);
    lines.push("Wi-Fi, coffee, and shared amenities whenever you book a desk");
  }
  lines.push(`Book up to ${tier.bookingWindowDays} days ahead`);
  return lines;
}

export type WelcomeEmailCopy = { subject: string; html: string; text: string };

export function renderMembershipWelcomeEmail(input: {
  planId: string;
  firstName?: string;
  origin?: string;
}): WelcomeEmailCopy | null {
  const tier = getTierById(input.planId);
  if (!tier) return null;
  const origin = (input.origin || siteOrigin()).replace(/\/+$/, "");
  const bookUrl = `${origin}/book`;
  const accountUrl = `${origin}/my-hi`;
  const pricingUrl = `${origin}/pricing`;
  const greetingName = (input.firstName || "").trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";
  const price = `${money(tier.amountCents)}/month`;
  const highlights = planHighlights(tier);

  const subject = `Welcome to Hi Coworking. Your ${tier.name} plan is active`;
  const intro = `Thank you for joining Hi Coworking. Your ${tier.name} plan (${price}) is active, and we're glad to have you with us.`;
  const bookLine = tier.includedHoursPerMonth > 0
    ? `Book a desk or the meeting room online. Choose a date and we'll show the hours that are open and check live availability. Your included hours are applied automatically when you book.`
    : `Book a desk or the meeting room online whenever you want to work from the space. Choose a date and we'll show the hours that are open and check live availability.`;
  const accountLine = "Your My Hi page shows your membership, upcoming bookings, access details, and any account credit.";
  const hoursLine = `Open ${SPACE_HOURS}.`;
  const renewLine = "Your membership renews monthly. To update your payment method, view invoices, change your plan, or cancel, open My Hi and choose Manage membership & billing. If you cancel, your membership stays active until the end of the period you've paid for.";
  const helpLine = `For help with anything else, reply to this email or write to us at ${CONTACT_EMAIL}.`;

  const p = "margin:0 0 16px;font-size:16px;line-height:1.7;color:#475569";
  const h2 = "margin:28px 0 10px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b";
  const link = "color:#0f172a;font-weight:600";
  const list = highlights
    .map((line) => `<li style="margin:0 0 8px">${escapeHtml(line)}</li>`)
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">`
    + `<div style="max-width:620px;margin:0 auto;padding:40px 24px">`
    + `<div style="font-size:14px;font-weight:700;letter-spacing:.02em">Hi Coworking</div>`
    + `<h1 style="margin:24px 0 12px;font-size:28px;line-height:1.2">Welcome to Hi Coworking</h1>`
    + `<p style="${p}">${escapeHtml(greeting)}</p>`
    + `<p style="${p}">${escapeHtml(intro)}</p>`
    + `<h2 style="${h2}">What your plan includes</h2>`
    + `<ul style="margin:0 0 8px;padding-left:20px;font-size:16px;line-height:1.6;color:#475569">${list}</ul>`
    + `<h2 style="${h2}">Using the space</h2>`
    + `<p style="${p}">${escapeHtml(bookLine)}</p>`
    + `<p style="margin:24px 0"><a href="${escapeHtml(bookUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:650">Book a desk</a></p>`
    + `<p style="${p}">${escapeHtml(accountLine)} <a href="${escapeHtml(accountUrl)}" style="${link}">Open My Hi</a></p>`
    + `<h2 style="${h2}">Find us</h2>`
    + `<p style="${p}">Hi Coworking<br>${escapeHtml(SPACE_ADDRESS)}<br>${escapeHtml(hoursLine)}</p>`
    + `<h2 style="${h2}">Your membership</h2>`
    + `<p style="${p}">${escapeHtml(renewLine)}</p>`
    + `<p style="margin:0 0 16px"><a href="${escapeHtml(accountUrl)}" style="${link}">Manage membership &amp; billing</a> · <a href="${escapeHtml(pricingUrl)}" style="${link}">Compare plans</a></p>`
    + `<p style="${p}">${escapeHtml(helpLine).replace(escapeHtml(CONTACT_EMAIL), `<a href="mailto:${CONTACT_EMAIL}" style="${link}">${CONTACT_EMAIL}</a>`)}</p>`
    + `<p style="${p}">We look forward to seeing you,<br>The Hi Coworking team</p>`
    + `<p style="margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b">You're receiving this email because you joined Hi Coworking on the ${escapeHtml(tier.name)} plan. Hi Coworking · ${escapeHtml(SPACE_ADDRESS)} · <a href="mailto:${CONTACT_EMAIL}" style="color:#475569">${CONTACT_EMAIL}</a></p>`
    + `</div></body></html>`;

  const text = [
    greeting,
    "",
    intro,
    "",
    "WHAT YOUR PLAN INCLUDES",
    ...highlights.map((line) => `- ${line}`),
    "",
    "USING THE SPACE",
    bookLine,
    `Book a desk: ${bookUrl}`,
    "",
    `${accountLine}`,
    `Open My Hi: ${accountUrl}`,
    "",
    "FIND US",
    "Hi Coworking",
    SPACE_ADDRESS,
    hoursLine,
    "",
    "YOUR MEMBERSHIP",
    renewLine,
    `Manage membership & billing: ${accountUrl}`,
    `Compare plans: ${pricingUrl}`,
    "",
    helpLine,
    "",
    "We look forward to seeing you,",
    "The Hi Coworking team",
    "",
    "--",
    `You're receiving this email because you joined Hi Coworking on the ${tier.name} plan.`,
    `Hi Coworking · ${SPACE_ADDRESS} · ${CONTACT_EMAIL}`,
  ].join("\n");

  return { subject, html, text };
}

export function firstNameOf(displayName: unknown): string {
  if (typeof displayName !== "string") return "";
  const first = displayName.trim().split(/\s+/)[0] || "";
  return first.length <= 40 ? first : "";
}

/** Persistence for the once-per-session marker. Firestore in production. */
export interface WelcomeEmailStore {
  /** Returns true when this caller now owns the send for the session. */
  claim(sessionId: string, data: Record<string, unknown>, now: number): Promise<boolean>;
  markSent(sessionId: string, messageId: string, now: number): Promise<void>;
  markFailed(sessionId: string, code: string, now: number): Promise<void>;
  /** Recipient and name fallbacks from users/{uid}. */
  loadUser(uid: string): Promise<{ email?: string; displayName?: string } | null>;
}

export function firestoreWelcomeEmailStore(db: FirebaseFirestore.Firestore = admin.firestore()): WelcomeEmailStore {
  const ref = (sessionId: string) => db.collection(SENT_EMAILS_COLLECTION).doc(sessionId);
  return {
    async claim(sessionId, data, now) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(sessionId));
        const existing = snap.exists ? snap.data() || {} : null;
        if (existing) {
          if (existing.status === "sent") return false;
          if (existing.status === "sending" && now - Number(existing.claimedAt || 0) < STALE_CLAIM_MS) return false;
        }
        tx.set(ref(sessionId), { ...data, status: "sending", claimedAt: now, attempts: Number(existing?.attempts || 0) + 1 }, { merge: true });
        return true;
      });
    },
    async markSent(sessionId, messageId, now) {
      await ref(sessionId).set({ status: "sent", messageId, sentAt: now, errorCode: null }, { merge: true });
    },
    async markFailed(sessionId, code, now) {
      await ref(sessionId).set({ status: "failed", errorCode: code, failedAt: now }, { merge: true });
    },
    async loadUser(uid) {
      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      return {
        email: typeof data.email === "string" ? data.email : undefined,
        displayName: typeof data.displayName === "string" ? data.displayName : undefined,
      };
    },
  };
}

export type WelcomeEmailOutcome =
  | "sent"
  | "skipped_not_membership"
  | "skipped_missing_data"
  | "skipped_unknown_plan"
  | "skipped_no_recipient"
  | "skipped_no_api_key"
  | "skipped_already_sent"
  | "failed";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Send the welcome email for a completed membership Checkout session.
 * Never throws.
 */
export async function sendMembershipWelcomeEmail(
  result: WebhookResult,
  options: {
    apiKey?: string;
    provider?: EmailProvider;
    store?: WelcomeEmailStore;
    now?: () => number;
    origin?: string;
  } = {},
): Promise<WelcomeEmailOutcome> {
  const meta = result.metadata || {};
  const sessionId = meta.checkoutSessionId || "";
  const uid = meta.uid || "";
  const plan = meta.plan || "";
  const now = options.now ?? Date.now;
  const logContext = { uid, plan, checkoutSessionId: sessionId };

  try {
    if (meta.purpose !== "membership") return "skipped_not_membership";
    if (!sessionId || !uid || !plan) {
      logger.warn("Membership welcome email skipped: missing session, uid, or plan", logContext);
      return "skipped_missing_data";
    }
    if (!getTierById(plan)) {
      logger.warn("Membership welcome email skipped: unknown plan", logContext);
      return "skipped_unknown_plan";
    }
    if (!options.provider && !options.apiKey) {
      logger.warn("Membership welcome email skipped: Resend API key not configured", logContext);
      return "skipped_no_api_key";
    }

    const store = options.store ?? firestoreWelcomeEmailStore();
    let user: { email?: string; displayName?: string } | null = null;
    try {
      user = await store.loadUser(uid);
    } catch (error) {
      logger.warn("Membership welcome email: could not load user doc", { ...logContext, error: String(error) });
    }
    const to = [meta.email, user?.email]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find((value) => EMAIL_RE.test(value));
    if (!to) {
      logger.warn("Membership welcome email skipped: no valid recipient", logContext);
      return "skipped_no_recipient";
    }

    const copy = renderMembershipWelcomeEmail({
      planId: plan,
      firstName: firstNameOf(meta.displayName || user?.displayName),
      origin: options.origin,
    });
    if (!copy) return "skipped_unknown_plan";

    const claimed = await store.claim(sessionId, {
      type: MEMBERSHIP_WELCOME_CATEGORY,
      template: MEMBERSHIP_WELCOME_TEMPLATE,
      uid,
      plan,
      checkoutSessionId: sessionId,
      ...(result.paymentId ? { paymentId: result.paymentId } : {}),
      eventId: result.eventId,
    }, now());
    if (!claimed) {
      logger.info("Membership welcome email already sent or in progress", logContext);
      return "skipped_already_sent";
    }

    const provider = options.provider ?? new ResendEmailProvider(options.apiKey || "");
    try {
      const { messageId } = await provider.send({
        to,
        subject: copy.subject,
        html: copy.html,
        text: copy.text,
        categories: [MEMBERSHIP_WELCOME_CATEGORY, "transactional"],
        idempotencyKey: `membership-welcome/${sessionId}`,
      });
      await store.markSent(sessionId, messageId, now()).catch((error) => {
        logger.error("Membership welcome email sent but marker update failed", { ...logContext, error: String(error) });
      });
      logger.info("Membership welcome email sent", { ...logContext, messageId });
      return "sent";
    } catch (error) {
      const code = error instanceof EmailSendError ? `${error.status ?? "network"}_${error.code}` : "unexpected_error";
      await store.markFailed(sessionId, code, now()).catch(() => undefined);
      logger.error("Membership welcome email failed (non-fatal)", { ...logContext, code });
      return "failed";
    }
  } catch (error) {
    logger.error("Membership welcome email failed unexpectedly (non-fatal)", {
      ...logContext,
      error: error instanceof Error ? error.name : "unknown",
    });
    return "failed";
  }
}
