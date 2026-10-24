// Campaign job processor (events_processCampaignJobs).
//
// This module is the deploy unit for firebase/campaign-functions. Keep its
// import graph free of the LinkedIn and X secrets (eventMarketing.ts) and of
// main.ts / index.ts: the Firebase CLI resolves every secret declared in the
// source it loads, even with --only. The only secrets here are the three
// Twilio values and HI_COWORKING_RESEND_API_KEY.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { ResendEmailProvider } from "./providers/emailProvider";
import { resendApiKey } from "./providers/emailSecret";
import { TwilioSmsProvider } from "./providers/smsProvider";
import { FcmPushProvider } from "./providers/pushProvider";
import { resolveRecipients, type Recipient } from "./providers/recipientResolver";
import {
  emailHash,
  ensureUnsubscribeTokens,
  filterMarketingRecipients,
  listUnsubscribeHeaders,
  loadSuppressedHashes,
  normalizeEmail,
  unsubscribeUrl,
} from "./providers/marketingPreferences";
import type { EmailMessage } from "./providers/emailProvider";
import { smsEligibleRecipients } from "./providers/smsCompliance";
import { recordSmsOptOuts } from "./providers/smsOptOut";
import {
  renderEmailSubject,
  renderEmailHtml,
  renderSmsBody,
  renderPushTitle,
  renderPushBody,
  type CampaignContext,
} from "./providers/campaignRenderer";

const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioFromNumber = defineSecret("TWILIO_FROM_NUMBER");

export const SMS_ENABLED_PARAM_NAME = "HI_COWORKING_SMS_ENABLED";

/**
 * SMS kill switch. Campaign texts go out only when this is exactly "true".
 * It stays "false" until the A2P 10DLC campaign is approved. The value lives
 * in firebase/campaign-functions/.env.hi-coworking-plat (and the matching
 * apps/functions env files), so a deploy never prompts and never turns SMS on.
 */
export const smsEnabledParam = defineString(SMS_ENABLED_PARAM_NAME, {
  default: "false",
  description: "Set to true only after the Twilio A2P 10DLC campaign is approved. Any other value holds campaign SMS.",
});

export function isSmsEnabledValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function smsSendingEnabled(): boolean {
  try {
    return isSmsEnabledValue(smsEnabledParam.value());
  } catch {
    return isSmsEnabledValue(process.env[SMS_ENABLED_PARAM_NAME]);
  }
}

export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed";
/**
 * sms_held: every other channel was delivered, but the campaign also has SMS
 * and SMS was off (or Twilio was not configured). The job keeps its place
 * until SMS is turned on, then the SMS leg alone is sent or expired.
 */
export type CampaignJobStatus = "pending" | "processing" | "sent" | "failed" | "sms_held" | "processing_sms";
export type CampaignJobType = "announce" | "reminder" | "starting_soon" | "follow_up";

export interface EventCampaignDoc {
  id: string;
  eventId?: string;
  seriesId?: string;
  status: CampaignStatus;
  channels: Array<"email" | "sms" | "push" | "in_app" | "social">;
  audienceRules?: {
    membershipTiers?: string[];
    tags?: string[];
    interests?: string[];
  };
  schedule?: {
    announceAt?: number;
    reminderOffsetsHours?: number[];
    followUpAt?: number;
  };
  copyVariants?: Record<string, string>;
  stats?: {
    impressions?: number;
    clicks?: number;
    registrations?: number;
    conversionRate?: number;
  };
}

export interface CampaignJobDoc {
  id: string;
  campaignId: string;
  type: CampaignJobType;
  scheduledFor: number;
  status: CampaignJobStatus;
  recipientCount: number;
  createdAt: number;
  processedAt?: number;
  error?: string;
  smsHeldAt?: number;
  smsHeldReason?: string;
  smsOutcome?: "sent" | "expired";
}

const JOBS_PER_RUN = 25;
// Pending jobs are read with an equality filter only, then filtered and
// ordered in memory, so the processor does not need a composite index on
// campaignJobs (status, scheduledFor). Campaigns create a handful of jobs
// each, so this cap is far above the expected queue.
const PENDING_SCAN_LIMIT = 500;
const HOUR_MS = 60 * 60 * 1000;
const STARTING_SOON_MAX_DELAY_MS = HOUR_MS;
const AFTER_THE_FACT_MAX_DELAY_MS = 72 * HOUR_MS;

type JobLike = { id?: string; scheduledFor?: unknown };

/** Due jobs, oldest first, at most `limit`. */
export function selectDueJobs<T extends JobLike>(jobs: T[], now: number, limit = JOBS_PER_RUN): T[] {
  return jobs
    .filter((job) => typeof job.scheduledFor === "number" && Number.isFinite(job.scheduledFor) && job.scheduledFor <= now)
    .sort((a, b) => (a.scheduledFor as number) - (b.scheduledFor as number))
    .slice(0, limit);
}

/**
 * Whether a held SMS leg is still worth sending once SMS is turned on.
 * Announcements and reminders only before the event starts; "starting soon"
 * only within an hour of its slot; follow-ups (and jobs with no event start)
 * only within 72 hours of their slot. Anything older is expired, never sent.
 */
export function heldSmsDisposition(
  job: { type: CampaignJobType | string; scheduledFor: number },
  eventStart: number | undefined,
  now: number,
): "send" | "expire" {
  const hasStart = typeof eventStart === "number" && Number.isFinite(eventStart) && eventStart > 0;
  switch (job.type) {
    case "announce":
    case "reminder":
      if (hasStart) return now < eventStart ? "send" : "expire";
      return now - job.scheduledFor <= AFTER_THE_FACT_MAX_DELAY_MS ? "send" : "expire";
    case "starting_soon":
      if (hasStart && now >= eventStart) return "expire";
      return now - job.scheduledFor <= STARTING_SOON_MAX_DELAY_MS ? "send" : "expire";
    default:
      return now - job.scheduledFor <= AFTER_THE_FACT_MAX_DELAY_MS ? "send" : "expire";
  }
}

/** Final status after the non-SMS channels ran. */
export function statusAfterDelivery(channels: string[], smsSent: boolean): "sent" | "sms_held" {
  return channels.includes("sms") && !smsSent ? "sms_held" : "sent";
}

function getDb() {
  return admin.firestore();
}

async function loadEvent(eventId: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (!eventId) return undefined;
  return (await getDb().collection("events").doc(eventId).get()).data();
}

function buildCampaignContext(campaign: EventCampaignDoc, eventData: Record<string, unknown> | undefined): CampaignContext {
  let eventTitle: string | undefined;
  let eventDate: string | undefined;
  let eventLocation: string | undefined;
  let eventUrl: string | undefined;

  if (campaign.eventId && eventData) {
    eventTitle = eventData.title as string | undefined;
    eventDate = new Date(eventData.startTime as number).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    eventLocation = eventData.location as string | undefined;
    eventUrl = `https://hi-coworking.com/events/detail?id=${campaign.eventId}`;
  }

  return { eventTitle, eventDate, eventLocation, eventUrl, copyVariants: campaign.copyVariants };
}

async function claimJob(
  jobRef: FirebaseFirestore.DocumentReference,
  from: CampaignJobStatus,
  to: CampaignJobStatus,
): Promise<CampaignJobDoc | null> {
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return null;
    const job = snap.data() as CampaignJobDoc;
    if (job.status !== from || job.scheduledFor > Date.now()) return null;
    tx.set(jobRef, { status: to, processedAt: Date.now() }, { merge: true });
    return job;
  });
}

/**
 * One message per allowed recipient, each with its own unsubscribe link in
 * the footer and RFC 8058 one-click List-Unsubscribe headers.
 */
export function buildCampaignEmailMessages(
  jobType: string,
  ctx: CampaignContext,
  recipients: Array<Recipient & { email: string; emailHash: string }>,
  tokens: Map<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): EmailMessage[] {
  const messages: EmailMessage[] = [];
  for (const r of recipients) {
    const token = tokens.get(r.emailHash);
    // No token, no send: marketing mail always carries a working opt-out.
    if (!token) continue;
    const url = unsubscribeUrl(token, env);
    const personal = { ...ctx, recipientName: r.displayName, unsubscribeUrl: url };
    messages.push({
      to: r.email,
      subject: renderEmailSubject(jobType, personal),
      html: renderEmailHtml(jobType, personal),
      headers: listUnsubscribeHeaders(url),
      categories: ["event-campaign"],
    });
  }
  return messages;
}

/** Drops opted-out, do-not-contact and suppressed addresses, then builds the mail. */
async function prepareCampaignEmails(
  recipients: Recipient[],
  jobType: string,
  ctx: CampaignContext,
  now: number,
): Promise<{ messages: EmailMessage[]; skipped: number }> {
  const db = getDb();
  const withEmail = recipients.filter((r) => normalizeEmail(r.email));
  const suppressed = await loadSuppressedHashes(db, withEmail.map((r) => emailHash(r.email!)));
  const { allowed, skipped } = filterMarketingRecipients(withEmail, suppressed);
  const tokens = await ensureUnsubscribeTokens(db, allowed, now);
  return { messages: buildCampaignEmailMessages(jobType, ctx, allowed, tokens), skipped };
}

type SmsSender = Pick<TwilioSmsProvider, "sendBatch">;

async function sendCampaignSms(
  smsProvider: SmsSender,
  recipients: Awaited<ReturnType<typeof resolveRecipients>>,
  jobType: string,
  ctx: CampaignContext,
): Promise<{ sent: number; failed: number }> {
  const smsRecipients = smsEligibleRecipients(recipients);
  if (smsRecipients.length === 0) return { sent: 0, failed: 0 };
  const result = await smsProvider.sendBatch(
    smsRecipients.map((r) => ({ to: r.phone, body: renderSmsBody(jobType, ctx) })),
  );
  const db = getDb();
  await recordSmsOptOuts(db, smsRecipients, result.optedOut);
  logger.info("SMS batch sent", {
    sent: result.sent,
    failed: result.failed,
    optedOut: result.optedOut.length,
    skippedWithoutConsent: recipients.length - smsRecipients.length,
  });
  return { sent: result.sent, failed: result.failed };
}

export const events_processCampaignJobs = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
    secrets: [resendApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber],
  },
  async () => {
    const db = getDb();
    const now = Date.now();
    const smsEnabled = smsSendingEnabled();

    const emailProvider = resendApiKey.value() ? new ResendEmailProvider(resendApiKey.value()) : null;
    const smsConfigured = Boolean(twilioAccountSid.value() && twilioAuthToken.value() && twilioFromNumber.value());
    // No Twilio client exists at all while SMS is off.
    const smsProvider =
      smsEnabled && smsConfigured
        ? new TwilioSmsProvider(twilioAccountSid.value(), twilioAuthToken.value(), twilioFromNumber.value())
        : null;
    const smsHoldReason = !smsEnabled ? "sms-disabled" : !smsConfigured ? "sms-provider-unconfigured" : null;
    const pushProvider = new FcmPushProvider();

    // --- Pending jobs: every channel; SMS only when enabled ---
    const pendingSnap = await db.collection("campaignJobs").where("status", "==", "pending").limit(PENDING_SCAN_LIMIT).get();
    const dueDocs = selectDueJobs(
      pendingSnap.docs.map((doc) => ({ doc, scheduledFor: (doc.data() as CampaignJobDoc).scheduledFor })),
      now,
    ).map((entry) => entry.doc);

    for (const jobDoc of dueDocs) {
      const claimed = await claimJob(jobDoc.ref, "pending", "processing");
      if (!claimed) continue;

      try {
        const campaignSnap = await db.collection("eventCampaigns").doc(claimed.campaignId).get();
        if (!campaignSnap.exists) throw new Error("campaign-not-found");

        const campaign = campaignSnap.data() as EventCampaignDoc;
        const ctx = buildCampaignContext(campaign, await loadEvent(campaign.eventId));
        const recipients = await resolveRecipients(campaign.id, claimed.type, campaign.eventId, campaign.audienceRules);

        let totalSent = 0;
        let totalFailed = 0;

        // Email via Resend (not affected by the SMS switch).
        if (campaign.channels.includes("email") && emailProvider) {
          const { messages, skipped } = await prepareCampaignEmails(recipients, claimed.type, ctx, now);
          if (messages.length > 0) {
            const result = await emailProvider.sendBatch(messages);
            totalSent += result.sent;
            totalFailed += result.failed;
            logger.info("Email batch sent", { sent: result.sent, failed: result.failed, skipped });
          } else if (skipped > 0) {
            logger.info("Email batch skipped", { skipped });
          }
        }

        // SMS via Twilio, only with HI_COWORKING_SMS_ENABLED=true and only to
        // recipients with a recorded opt-in (users/{uid}.smsConsent).
        let smsSent = false;
        if (campaign.channels.includes("sms") && smsProvider) {
          const result = await sendCampaignSms(smsProvider, recipients, claimed.type, ctx);
          totalSent += result.sent;
          totalFailed += result.failed;
          smsSent = true;
        }

        // Push via FCM.
        if (campaign.channels.includes("push")) {
          const pushRecipients = recipients.filter((r) => r.fcmToken);
          if (pushRecipients.length > 0) {
            const result = await pushProvider.sendBatch(
              pushRecipients.map((r) => ({
                token: r.fcmToken!,
                title: renderPushTitle(claimed.type, ctx),
                body: renderPushBody(claimed.type, ctx),
                link: ctx.eventUrl,
                data: {
                  campaignId: campaign.id,
                  jobType: claimed.type,
                  ...(campaign.eventId ? { eventId: campaign.eventId } : {}),
                },
              })),
            );
            totalSent += result.sent;
            totalFailed += result.failed;
            logger.info("Push batch sent", { sent: result.sent, failed: result.failed });
          }
        }

        // In-app notifications.
        if (campaign.channels.includes("in_app") && recipients.length > 0) {
          const batch = db.batch();
          for (const r of recipients) {
            const notifRef = db.collection("users").doc(r.uid).collection("notifications").doc(`campaign_${claimed.id}`);
            batch.set(
              notifRef,
              {
                id: `campaign_${claimed.id}`,
                type: "event_campaign",
                title: renderPushTitle(claimed.type, ctx),
                body: renderPushBody(claimed.type, ctx),
                link: ctx.eventUrl || "/events",
                read: false,
                createdAt: Date.now(),
              },
              { merge: true },
            );
          }
          await batch.commit();
          totalSent += recipients.length;
        }

        const status = statusAfterDelivery(campaign.channels, smsSent);
        await jobDoc.ref.set(
          {
            status,
            recipientCount: totalSent,
            processedAt: Date.now(),
            error: FieldValue.delete(),
            ...(status === "sms_held" ? { smsHeldAt: Date.now(), smsHeldReason: smsHoldReason ?? "sms-not-sent" } : {}),
          },
          { merge: true },
        );
        await campaignSnap.ref.set(
          { status: "active", updatedAt: Date.now(), "stats.impressions": FieldValue.increment(totalSent) },
          { merge: true },
        );

        if (status === "sms_held") {
          logger.info("Campaign SMS held", { campaignId: claimed.campaignId, jobId: claimed.id, reason: smsHoldReason });
        }
        logger.info("Campaign job processed", {
          campaignId: claimed.campaignId,
          jobId: claimed.id,
          status,
          sent: totalSent,
          failed: totalFailed,
        });
      } catch (err) {
        logger.error("Campaign job failed", { jobId: claimed.id, err });
        await jobDoc.ref.set(
          { status: "failed", processedAt: Date.now(), error: err instanceof Error ? err.message : "unknown-error" },
          { merge: true },
        );
      }
    }

    // --- Held SMS legs: only once SMS is on and Twilio is configured ---
    if (!smsProvider) {
      if (smsHoldReason) logger.info("Campaign SMS is off; held jobs stay held", { reason: smsHoldReason });
      return;
    }

    const heldSnap = await db.collection("campaignJobs").where("status", "==", "sms_held").limit(JOBS_PER_RUN).get();
    for (const jobDoc of heldSnap.docs) {
      const claimed = await claimJob(jobDoc.ref, "sms_held", "processing_sms");
      if (!claimed) continue;

      try {
        const campaignSnap = await db.collection("eventCampaigns").doc(claimed.campaignId).get();
        if (!campaignSnap.exists) throw new Error("campaign-not-found");
        const campaign = campaignSnap.data() as EventCampaignDoc;
        const eventData = await loadEvent(campaign.eventId);
        const eventStart = typeof eventData?.startTime === "number" ? (eventData.startTime as number) : undefined;

        if (heldSmsDisposition(claimed, eventStart, Date.now()) === "expire") {
          await jobDoc.ref.set({ status: "sent", smsOutcome: "expired", processedAt: Date.now() }, { merge: true });
          logger.info("Held campaign SMS expired", { campaignId: claimed.campaignId, jobId: claimed.id });
          continue;
        }

        // Recipients and consent are re-read now, so later opt-outs are honored.
        const recipients = await resolveRecipients(campaign.id, claimed.type, campaign.eventId, campaign.audienceRules);
        const result = await sendCampaignSms(smsProvider, recipients, claimed.type, buildCampaignContext(campaign, eventData));
        await jobDoc.ref.set(
          {
            status: "sent",
            smsOutcome: "sent",
            recipientCount: FieldValue.increment(result.sent),
            processedAt: Date.now(),
          },
          { merge: true },
        );
        await campaignSnap.ref.set(
          { updatedAt: Date.now(), "stats.impressions": FieldValue.increment(result.sent) },
          { merge: true },
        );
      } catch (err) {
        logger.error("Held campaign SMS failed", { jobId: claimed.id, err });
        await jobDoc.ref.set(
          { status: "failed", processedAt: Date.now(), error: err instanceof Error ? err.message : "unknown-error" },
          { merge: true },
        );
      }
    }
  },
);
