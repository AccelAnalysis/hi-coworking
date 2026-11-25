/**
 * Daily 8:00 AM ET job: invite eligible completed visits to the
 * post-attendance survey. No-ops unless both VISIT_FEEDBACK_ENABLED and
 * VISIT_FEEDBACK_SENDS_ENABLED are "true".
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import type { EmailProvider } from "../providers/emailProvider";
import { ResendEmailProvider } from "../providers/emailProvider";
import { resendApiKey } from "../providers/emailSecret";
import { listUnsubscribeHeaders } from "../providers/marketingPreferences";
import { visitFeedbackEnabled, visitFeedbackJobMaySend, visitFeedbackSendsEnabled } from "./config";
import { renderVisitFeedbackEmail, visitFeedbackSiteOrigin, visitFeedbackSurveyUrl, VISIT_FEEDBACK_EMAIL_CATEGORY } from "./email";
import {
  audienceOf,
  bookingEnd,
  bookingStart,
  bookingUserId,
  firstNameFrom,
  formatVisitDate,
  invitationWindow,
  recipientEmail,
  skipReason,
  type SkipReason,
} from "./eligibility";
import { VISIT_FEEDBACK_SOURCE, VISIT_FEEDBACK_TEMPLATE } from "./questions";
import { emailHash, type VisitFeedbackStore } from "./store";
import { firestoreVisitFeedbackStore } from "./firestoreStore";
import { newVisitFeedbackToken, visitFeedbackTokenHash } from "./tokens";

export type SendInvitesSummary = {
  scanned: number;
  sent: number;
  skipped: Partial<Record<SkipReason | "disabled" | "sends_disabled" | "no_api_key" | "failed", number>>;
};

export type SendInvitesOptions = {
  store?: VisitFeedbackStore;
  provider?: EmailProvider;
  apiKey?: string;
  now?: number;
  env?: NodeJS.ProcessEnv;
};

export async function sendVisitFeedbackInvites(options: SendInvitesOptions = {}): Promise<SendInvitesSummary> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const skipped: SendInvitesSummary["skipped"] = {};
  const bump = (reason: keyof NonNullable<SendInvitesSummary["skipped"]>) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
  };

  if (!visitFeedbackEnabled(env)) {
    logger.info("visitFeedback_sendInvites skipped: feature flag off");
    return { scanned: 0, sent: 0, skipped: { disabled: 1 } };
  }
  if (!visitFeedbackSendsEnabled(env)) {
    logger.info("visitFeedback_sendInvites skipped: sends flag off");
    return { scanned: 0, sent: 0, skipped: { sends_disabled: 1 } };
  }

  const store = options.store ?? firestoreVisitFeedbackStore();
  if (!options.provider && !options.apiKey) {
    logger.info("visitFeedback_sendInvites skipped: Resend API key not configured");
    return { scanned: 0, sent: 0, skipped: { no_api_key: 1 } };
  }
  const provider = options.provider ?? new ResendEmailProvider(options.apiKey as string, { env });
  const window = invitationWindow(now);
  const bookings = await store.listBookingsEndingIn(window);
  let sent = 0;

  for (const booking of bookings) {
    const userId = bookingUserId(booking);
    const user = userId && !userId.startsWith("guest:") ? await store.loadUser(userId) : null;
    const email = recipientEmail(booking, user);
    const emailKey = emailHash(email || "invalid");
    const audience = audienceOf(user, userId);
    const noShow = await store.loadNoShowFlag(booking.id).then((status) => String(status || "") === "no_show");
    const suppressed = email ? await store.isEmailSuppressed(email) : false;
    const invitations = email || userId
      ? await store.listPriorInvitations({ userId, emailHash: email ? emailKey : "" })
      : [];
    const reason = skipReason({
      booking,
      window,
      noShow,
      user,
      email,
      suppressed,
      audience,
      invitations,
      now,
    });
    if (reason) {
      bump(reason);
      continue;
    }

    const token = newVisitFeedbackToken();
    const tokenHash = visitFeedbackTokenHash(token);
    const firstName = firstNameFrom(user, booking);
    const claimed = await store.claimInvitation({
      booking,
      user,
      email,
      firstName,
      audience,
      tokenHash,
      now,
      source: VISIT_FEEDBACK_SOURCE,
      template: VISIT_FEEDBACK_TEMPLATE,
    });
    if (!claimed.claimed) {
      bump("already_invited");
      continue;
    }

    try {
      const origin = visitFeedbackSiteOrigin(env);
      const unsubscribeUrl = await store.unsubscribeUrl(
        email,
        userId && !userId.startsWith("guest:") ? userId : undefined,
        now,
      );
      const copy = renderVisitFeedbackEmail({
        firstName,
        visitDate: formatVisitDate(bookingStart(booking) || bookingEnd(booking)),
        surveyUrl: visitFeedbackSurveyUrl(token, origin),
        unsubscribeUrl,
      });
      const result = await provider.send({
        to: email,
        subject: copy.subject,
        html: copy.html,
        text: copy.text,
        categories: [VISIT_FEEDBACK_EMAIL_CATEGORY],
        headers: listUnsubscribeHeaders(unsubscribeUrl),
        idempotencyKey: `visit-feedback-${claimed.id}`,
      });
      await store.markSent(claimed.id, result.messageId, now);
      sent += 1;
    } catch (error) {
      await store.markFailed(claimed.id, error instanceof Error ? error.name : "send_failed", now).catch(() => undefined);
      logger.error("visitFeedback_sendInvites: send failed", {
        bookingId: booking.id,
        error: error instanceof Error ? error.name : "error",
      });
      bump("failed");
    }
  }

  logger.info("visitFeedback_sendInvites done", { scanned: bookings.length, sent, skipped });
  return { scanned: bookings.length, sent, skipped };
}

export const visitFeedback_sendInvites = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "America/New_York",
    secrets: [resendApiKey],
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    if (!visitFeedbackJobMaySend()) return;
    const apiKey = resendApiKey.value();
    await sendVisitFeedbackInvites({ apiKey });
  },
);
