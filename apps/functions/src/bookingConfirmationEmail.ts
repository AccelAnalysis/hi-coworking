/**
 * Desk and meeting-room booking confirmation email.
 *
 * Sent once per booking, right after finalizeHeldBooking (bookingFlexTransaction.ts)
 * confirms it: paid Stripe checkouts (booking_finalizeCheckout) and bookings
 * fully covered by membership hours or account credit (booking_beginCheckout).
 *
 * Same pattern as payments/membershipWelcomeEmail.ts:
 * - Transactional: it confirms a booking the customer just made, so it does not
 *   check the marketing opt-out and has no unsubscribe link.
 * - Once only: a Firestore transaction claims the send on the booking itself
 *   (bookings/{bookingId}.confirmationEmail). A retry of the callable, or a
 *   second finalize call for the same hold, finds the claim and skips. Resend
 *   also gets an idempotency key, so a send that timed out but went through is
 *   not delivered twice.
 * - Never throws: an email outage is logged and recorded on the booking, but the
 *   paid booking, the access grant and the callable response are unaffected.
 * - Logs carry the booking id and uid, never the recipient address.
 *
 * Seam for a later post-attendance follow-up (not built here): a sent
 * confirmation sets bookings/{bookingId}.confirmationEmailSentAt (epoch ms,
 * like createdAt). postAttendanceFollowUpCandidate() below describes which
 * bookings a future survey job may pick up and the fields it should read. It
 * sends nothing and schedules nothing.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  EmailSendError,
  ResendEmailProvider,
  type EmailProvider,
} from "./providers/emailProvider";
import {
  CONTACT_EMAIL,
  SPACE_ADDRESS,
  SPACE_HOURS,
  STALE_CLAIM_MS,
  escapeHtml,
  firstNameOf,
  siteOrigin,
} from "./payments/membershipWelcomeEmail";
import { formatMoney } from "./payments/stripeRefund";
import {
  EMAIL_BODY_FONT,
  EMAIL_BUTTON_STYLE,
  EMAIL_HEADLINE_FONT,
  EMAIL_LOGO_HTML,
  EMAIL_NAVY,
} from "./payments/emailBrand";

export const BOOKING_CONFIRMATION_TEMPLATE = "booking-confirmation-v1";
export const BOOKING_CONFIRMATION_CATEGORY = "booking_confirmation";
export const COMPANY_NAME = "Accel Analysis";
export const FACILITY_TIME_ZONE = "America/New_York";
/** A booking that keeps failing stops retrying after this many attempts. */
export const MAX_SEND_ATTEMPTS = 5;
/** Setting this env var to exactly "true" turns the email off (kill switch). */
export const DISABLE_ENV_VAR = "BOOKING_CONFIRMATION_EMAIL_DISABLED";

export type BookingConfirmationCopy = { subject: string; html: string; text: string };

export type BookingSegmentInput = { resourceName: string; start: number; end: number };

export type BookingConfirmationInput = {
  firstName?: string;
  resourceName: string;
  start: number;
  end: number;
  /** Desk-change bookings: the two desks in order. */
  segments?: BookingSegmentInput[];
  totalCents: number;
  subtotalCents?: number;
  accountCreditAppliedCents?: number;
  includedHoursApplied?: number;
  currency?: string;
  origin?: string;
};

// ---------------------------------------------------------------- format ----

export function formatBookingDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ms));
}

export function formatBookingTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

/** "9:00 AM – 1:00 PM ET". Facility time, whatever the server's zone. */
export function formatTimeWindow(start: number, end: number): string {
  return `${formatBookingTime(start)} – ${formatBookingTime(end)} ET`;
}

export function formatDuration(start: number, end: number): string {
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (rest) parts.push(`${rest} minutes`);
  return parts.join(" ") || "0 minutes";
}

function hoursLabel(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} hour${rounded === 1 ? "" : "s"}`;
}

/** Plain-language payment lines. No processor names or internal ids. */
export function paymentLines(input: BookingConfirmationInput): Array<{ label: string; value: string; strong?: boolean }> {
  const currency = input.currency || "usd";
  const total = Math.max(0, Math.round(input.totalCents || 0));
  const credit = Math.max(0, Math.round(input.accountCreditAppliedCents || 0));
  const hours = Math.max(0, Number(input.includedHoursApplied || 0));
  const lines: Array<{ label: string; value: string; strong?: boolean }> = [];
  if (hours > 0) lines.push({ label: "Membership hours used", value: hoursLabel(hours) });
  if (credit > 0) lines.push({ label: "Account credit applied", value: formatMoney(credit, currency) });
  if (total > 0) {
    lines.push({ label: "Paid by card", value: formatMoney(total, currency), strong: true });
  } else {
    lines.push({ label: "Amount due", value: formatMoney(0, currency), strong: true });
  }
  return lines;
}

function deskNameForSubject(input: BookingConfirmationInput): string {
  if (input.segments && input.segments.length > 1) {
    return input.segments.map((segment) => segment.resourceName).join(" and ");
  }
  return input.resourceName;
}

function clean(value: string, max = 80): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

// ---------------------------------------------------------------- render ----

export function renderBookingConfirmationEmail(input: BookingConfirmationInput): BookingConfirmationCopy {
  const origin = (input.origin || siteOrigin()).replace(/\/+$/, "");
  const accountUrl = `${origin}/my-hi`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Hi Coworking, ${SPACE_ADDRESS}`)}`;
  const firstName = clean(input.firstName || "", 40);
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const resourceName = clean(input.resourceName || "Your space");
  const date = formatBookingDate(input.start);
  const window = formatTimeWindow(input.start, input.end);
  const duration = formatDuration(input.start, input.end);
  const segments = (input.segments || []).filter((segment) => segment && segment.resourceName);
  const spaceLines = segments.length > 1
    ? segments.map((segment) => `${clean(segment.resourceName)}, ${formatTimeWindow(segment.start, segment.end)}`)
    : [resourceName];
  const payments = paymentLines(input);

  const subject = `You're booked: ${clean(deskNameForSubject({ ...input, resourceName }))} on ${date}`;
  const preheader = `${resourceName} · ${date} · ${window}`;
  const intro = "Thanks for booking with Hi Coworking. Your space is reserved, and here are your details.";
  const arrivalLines = [
    `Say hello at the front desk when you get here. Our team is on site ${SPACE_HOURS}.`,
    "Your booking and any door access details are on your SayHi page.",
  ];
  const manageLine = "To view or manage your booking, open SayHi.";
  const helpLine = `Questions? Reply to this email or write to us at ${CONTACT_EMAIL}.`;
  const footerReason = "You're receiving this email because you booked a space at Hi Coworking.";
  const footer = `Hi Coworking · ${COMPANY_NAME} · ${SPACE_ADDRESS}`;

  // Colors: body #475569 and labels #64748b on white both pass WCAG AA (7.6:1, 4.8:1).
  const p = "margin:0 0 16px;font-size:16px;line-height:1.7;color:#475569";
  const link = `color:${EMAIL_NAVY};font-weight:600`;
  const label = "padding:14px 0;width:96px;vertical-align:top;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b";
  const value = "padding:14px 0;vertical-align:top;font-size:16px;line-height:1.5;color:#0f172a";
  const row = (name: string, html: string, first = false) =>
    `<tr><td style="${label}${first ? "" : ";border-top:1px solid #e2e8f0"}">${escapeHtml(name)}</td>`
    + `<td style="${value}${first ? "" : ";border-top:1px solid #e2e8f0"}">${html}</td></tr>`;
  const muted = "display:block;font-size:14px;color:#64748b";
  const h2 = "margin:32px 0 10px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b";

  const detailRows = [
    row("Date", `<strong style="font-weight:600">${escapeHtml(date)}</strong>`, true),
    row("Time", `${escapeHtml(window)}<span style="${muted}">${escapeHtml(duration)}</span>`),
    row("Space", spaceLines.map((line) => escapeHtml(line)).join("<br>")),
    row(
      "Where",
      `Hi Coworking<br>${escapeHtml(SPACE_ADDRESS)}<br><a href="${escapeHtml(mapsUrl)}" style="${link};font-size:14px">Get directions</a>`,
    ),
  ].join("");

  const paymentRows = payments.map((line, index) => (
    `<tr><td style="padding:8px 0;font-size:15px;color:#475569${index ? ";border-top:1px solid #e2e8f0" : ""}">${escapeHtml(line.label)}</td>`
    + `<td align="right" style="padding:8px 0;font-size:15px;text-align:right;color:#0f172a;${line.strong ? "font-weight:700;" : ""}${index ? "border-top:1px solid #e2e8f0" : ""}">${escapeHtml(line.value)}</td></tr>`
  )).join("");

  const helpHtml = escapeHtml(helpLine).replace(
    escapeHtml(CONTACT_EMAIL),
    `<a href="mailto:${CONTACT_EMAIL}" style="${link}">${CONTACT_EMAIL}</a>`,
  );

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`
    + `<title>${escapeHtml(subject)}</title>`
    + `<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Fraunces:opsz,wght@9..144,600&display=swap" rel="stylesheet">`
    + `</head>`
    + `<body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:${EMAIL_BODY_FONT}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:32px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px">`
    + `<tr><td style="padding:32px 28px 8px">`
    + `${EMAIL_LOGO_HTML}`
    + `<p style="margin:24px 0 0"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${EMAIL_NAVY};color:#ffffff;font-size:13px;font-weight:700;letter-spacing:.04em">&#10003;&nbsp; Booking confirmed</span></p>`
    + `<h1 style="margin:16px 0 12px;font-family:${EMAIL_HEADLINE_FONT};font-size:32px;font-weight:600;line-height:1.15;color:${EMAIL_NAVY}">You're booked</h1>`
    + `<p style="${p}">${escapeHtml(greeting)}</p>`
    + `<p style="${p}">${escapeHtml(intro)}</p>`
    + `</td></tr>`
    + `<tr><td style="padding:0 28px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:3px solid ${EMAIL_NAVY}">${detailRows}</table>`
    + `</td></tr>`
    + `<tr><td style="padding:8px 28px 0">`
    + `<h2 style="${h2}">Payment</h2>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:8px 16px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${paymentRows}</table>`
    + `</td></tr></table>`
    + `<h2 style="${h2}">When you arrive</h2>`
    + arrivalLines.map((line) => `<p style="${p}">${escapeHtml(line)}</p>`).join("")
    + `<p style="margin:24px 0"><a href="${escapeHtml(accountUrl)}" style="${EMAIL_BUTTON_STYLE}">View booking in SayHi</a></p>`
    + `<p style="${p}">${escapeHtml(manageLine)} ${helpHtml}</p>`
    + `<p style="${p}">See you soon,<br>The Hi Coworking team</p>`
    + `</td></tr>`
    + `<tr><td style="padding:8px 28px 28px">`
    + `<p style="margin:16px 0 0;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b">${escapeHtml(footerReason)}<br>${escapeHtml(footer)} · <a href="mailto:${CONTACT_EMAIL}" style="color:#475569">${CONTACT_EMAIL}</a></p>`
    + `</td></tr>`
    + `</table></td></tr></table></body></html>`;

  const text = [
    greeting,
    "",
    intro,
    "",
    "YOUR BOOKING",
    `Date: ${date}`,
    `Time: ${window} (${duration})`,
    ...(spaceLines.length > 1 ? ["Space:", ...spaceLines.map((line) => `- ${line}`)] : [`Space: ${spaceLines[0]}`]),
    `Where: Hi Coworking, ${SPACE_ADDRESS}`,
    `Directions: ${mapsUrl}`,
    "",
    "PAYMENT",
    ...payments.map((line) => `${line.label}: ${line.value}`),
    "",
    "WHEN YOU ARRIVE",
    ...arrivalLines,
    "",
    `View booking in SayHi: ${accountUrl}`,
    "",
    manageLine,
    helpLine,
    "",
    "See you soon,",
    "The Hi Coworking team",
    "",
    "--",
    footerReason,
    `${footer} · ${CONTACT_EMAIL}`,
  ].join("\n");

  return { subject, html, text };
}

// ----------------------------------------------------------------- store ----

/** The booking fields the email reads. Matches finalizeHeldBooking's write. */
export type ConfirmableBooking = {
  id: string;
  status?: string;
  userId?: string;
  userName?: string;
  guestEmail?: string | null;
  resourceName?: string;
  start?: number;
  end?: number;
  segments?: BookingSegmentInput[];
  totalCents?: number;
  subtotalCents?: number;
  accountCreditAppliedCents?: number;
  includedHoursApplied?: number;
  confirmationEmailSentAt?: number | null;
};

export type ClaimResult =
  | { claimed: true; booking: ConfirmableBooking }
  | { claimed: false; reason: "not_found" | "not_confirmed" | "already_sent" | "in_progress" | "too_many_attempts" };

export interface BookingConfirmationStore {
  /** Atomically claims the send on the booking. */
  claim(bookingId: string, now: number): Promise<ClaimResult>;
  markSent(bookingId: string, messageId: string, now: number): Promise<void>;
  markFailed(bookingId: string, code: string, now: number): Promise<void>;
  /** Recipient and name fallbacks from users/{uid}. */
  loadUser(uid: string): Promise<{ email?: string; displayName?: string } | null>;
}

/** Shared claim rules, used by the Firestore store and the tests' memory store. */
export function evaluateClaim(data: Record<string, unknown> | null, now: number): ClaimResult | { claimed: true } {
  if (!data) return { claimed: false, reason: "not_found" };
  if (String(data.status || "").toUpperCase() !== "CONFIRMED") return { claimed: false, reason: "not_confirmed" };
  const marker = (data.confirmationEmail && typeof data.confirmationEmail === "object")
    ? data.confirmationEmail as Record<string, unknown>
    : {};
  if (Number(data.confirmationEmailSentAt || 0) > 0 || marker.status === "sent") {
    return { claimed: false, reason: "already_sent" };
  }
  if (marker.status === "sending" && now - Number(marker.claimedAt || 0) < STALE_CLAIM_MS) {
    return { claimed: false, reason: "in_progress" };
  }
  if (Number(marker.attempts || 0) >= MAX_SEND_ATTEMPTS) return { claimed: false, reason: "too_many_attempts" };
  return { claimed: true };
}

function toBooking(id: string, data: Record<string, unknown>): ConfirmableBooking {
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  const segments = Array.isArray(data.segments)
    ? (data.segments as Array<Record<string, unknown>>)
      .map((segment) => ({
        resourceName: str(segment?.resourceName) || "",
        start: num(segment?.start) || 0,
        end: num(segment?.end) || 0,
      }))
      .filter((segment) => segment.resourceName && segment.start && segment.end)
    : undefined;
  return {
    id,
    status: str(data.status),
    userId: str(data.userId),
    userName: str(data.userName),
    guestEmail: str(data.guestEmail) ?? null,
    resourceName: str(data.resourceName),
    start: num(data.start),
    end: num(data.end),
    segments,
    totalCents: num(data.totalCents),
    subtotalCents: num(data.subtotalCents),
    accountCreditAppliedCents: num(data.accountCreditAppliedCents),
    includedHoursApplied: num(data.includedHoursApplied),
    confirmationEmailSentAt: num(data.confirmationEmailSentAt) ?? null,
  };
}

export function firestoreBookingConfirmationStore(
  db: FirebaseFirestore.Firestore = admin.firestore(),
): BookingConfirmationStore {
  const ref = (bookingId: string) => db.collection("bookings").doc(bookingId);
  return {
    async claim(bookingId, now) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(bookingId));
        const data = snap.exists ? snap.data() || {} : null;
        const verdict = evaluateClaim(data, now);
        if (!verdict.claimed || !data) return verdict as ClaimResult;
        const marker = (data.confirmationEmail && typeof data.confirmationEmail === "object")
          ? data.confirmationEmail as Record<string, unknown>
          : {};
        tx.set(ref(bookingId), {
          confirmationEmail: {
            template: BOOKING_CONFIRMATION_TEMPLATE,
            status: "sending",
            claimedAt: now,
            attempts: Number(marker.attempts || 0) + 1,
          },
        }, { merge: true });
        return { claimed: true, booking: toBooking(bookingId, data) };
      });
    },
    async markSent(bookingId, messageId, now) {
      await ref(bookingId).set({
        confirmationEmailSentAt: now,
        confirmationEmail: { status: "sent", sentAt: now, messageId, errorCode: null },
      }, { merge: true });
    },
    async markFailed(bookingId, code, now) {
      await ref(bookingId).set({
        confirmationEmail: { status: "failed", failedAt: now, errorCode: code },
      }, { merge: true });
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

// ------------------------------------------------------------------ send ----

export type BookingConfirmationOutcome =
  | "sent"
  | "skipped_disabled"
  | "skipped_missing_data"
  | "skipped_no_api_key"
  | "skipped_not_found"
  | "skipped_not_confirmed"
  | "skipped_already_sent"
  | "skipped_in_progress"
  | "skipped_too_many_attempts"
  | "skipped_no_recipient"
  | "failed";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** A display name that is really an email address is not a first name. */
function safeFirstName(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (!candidate || candidate.includes("@")) continue;
    const first = firstNameOf(candidate);
    if (first && first.toLowerCase() !== "guest" && first.toLowerCase() !== "member") return first;
  }
  return "";
}

/**
 * Send the confirmation email for a confirmed booking. Safe to call more than
 * once for the same booking: only the first successful call sends. Never throws.
 */
export async function sendBookingConfirmationEmail(
  bookingId: string,
  options: {
    apiKey?: string;
    provider?: EmailProvider;
    store?: BookingConfirmationStore;
    now?: () => number;
    origin?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<BookingConfirmationOutcome> {
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const logContext: Record<string, unknown> = { bookingId };
  let store: BookingConfirmationStore | null = null;
  let claimed = false;

  try {
    if (env[DISABLE_ENV_VAR] === "true") return "skipped_disabled";
    if (!bookingId) return "skipped_missing_data";
    if (!options.provider && !options.apiKey) {
      logger.warn("Booking confirmation email skipped: Resend API key not configured", logContext);
      return "skipped_no_api_key";
    }

    store = options.store ?? firestoreBookingConfirmationStore();
    const claim = await store.claim(bookingId, now());
    if (!claim.claimed) {
      if (claim.reason !== "already_sent") {
        logger.info("Booking confirmation email not sent", { ...logContext, reason: claim.reason });
      }
      return `skipped_${claim.reason}` as BookingConfirmationOutcome;
    }
    claimed = true;
    const booking = claim.booking;
    logContext.uid = booking.userId || "";

    if (!booking.resourceName || !booking.start || !booking.end) {
      await store.markFailed(bookingId, "missing_booking_fields", now()).catch(() => undefined);
      logger.warn("Booking confirmation email skipped: booking is missing its space or time", logContext);
      return "skipped_missing_data";
    }

    let user: { email?: string; displayName?: string } | null = null;
    if (booking.userId && !booking.userId.startsWith("guest:")) {
      try {
        user = await store.loadUser(booking.userId);
      } catch (error) {
        logger.warn("Booking confirmation email: could not load user doc", {
          ...logContext,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    const to = [booking.guestEmail, user?.email]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find((value) => EMAIL_RE.test(value));
    if (!to) {
      await store.markFailed(bookingId, "no_recipient", now()).catch(() => undefined);
      logger.warn("Booking confirmation email skipped: no valid recipient", logContext);
      return "skipped_no_recipient";
    }

    const copy = renderBookingConfirmationEmail({
      firstName: safeFirstName(user?.displayName, booking.userName),
      resourceName: booking.resourceName,
      start: booking.start,
      end: booking.end,
      segments: booking.segments,
      totalCents: booking.totalCents || 0,
      subtotalCents: booking.subtotalCents,
      accountCreditAppliedCents: booking.accountCreditAppliedCents,
      includedHoursApplied: booking.includedHoursApplied,
      origin: options.origin,
    });

    const provider = options.provider ?? new ResendEmailProvider(options.apiKey || "");
    try {
      const { messageId } = await provider.send({
        to,
        subject: copy.subject,
        html: copy.html,
        text: copy.text,
        categories: [BOOKING_CONFIRMATION_CATEGORY, "transactional"],
        idempotencyKey: `booking-confirmation/${bookingId}`,
      });
      await store.markSent(bookingId, messageId, now()).catch((error) => {
        logger.error("Booking confirmation email sent but marker update failed", {
          ...logContext,
          error: error instanceof Error ? error.name : "unknown",
        });
      });
      logger.info("Booking confirmation email sent", { ...logContext, messageId });
      return "sent";
    } catch (error) {
      const code = error instanceof EmailSendError ? `${error.status ?? "network"}_${error.code}` : "unexpected_error";
      await store.markFailed(bookingId, code, now()).catch(() => undefined);
      logger.error("Booking confirmation email failed (non-fatal)", { ...logContext, code });
      return "failed";
    }
  } catch (error) {
    if (claimed && store) await store.markFailed(bookingId, "unexpected_error", now()).catch(() => undefined);
    logger.error("Booking confirmation email failed unexpectedly (non-fatal)", {
      ...logContext,
      error: error instanceof Error ? error.name : "unknown",
    });
    return "failed";
  }
}

// ------------------------------------------------- follow-up seam (only) ----

export type PostAttendanceFollowUpCandidate = {
  bookingId: string;
  userId: string;
  resourceName: string;
  start: number;
  end: number;
  confirmationEmailSentAt: number;
};

/**
 * Seam for a future post-attendance follow-up (survey). Pure: it decides
 * whether a booking would be eligible and returns the fields such a job should
 * use. It does not send, queue or schedule anything, and nothing calls it yet.
 *
 * Eligible: a confirmed booking whose end time has passed, whose confirmation
 * email went out, and that has no postAttendanceFollowUpSentAt yet. A future
 * job should also check attendance (front-desk check-in) and the marketing
 * opt-out if the follow-up is not strictly transactional.
 */
export function postAttendanceFollowUpCandidate(
  booking: Record<string, unknown> & { id: string },
  now: number,
): PostAttendanceFollowUpCandidate | null {
  if (String(booking.status || "").toUpperCase() !== "CONFIRMED") return null;
  const end = Number(booking.end || 0);
  const start = Number(booking.start || 0);
  const sentAt = Number(booking.confirmationEmailSentAt || 0);
  if (!end || !start || end > now || !sentAt) return null;
  if (Number(booking.postAttendanceFollowUpSentAt || 0) > 0) return null;
  const userId = typeof booking.userId === "string" ? booking.userId : "";
  if (!userId || userId.startsWith("guest:")) return null;
  return {
    bookingId: booking.id,
    userId,
    resourceName: typeof booking.resourceName === "string" ? booking.resourceName : "",
    start,
    end,
    confirmationEmailSentAt: sentAt,
  };
}
