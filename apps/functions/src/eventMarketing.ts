import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { FcmPushProvider } from "./providers/pushProvider";
import { getSocialProvider } from "./providers/socialProvider";
import { resolveRecipients } from "./providers/recipientResolver";
import {
  renderPushTitle,
  renderPushBody,
  type CampaignContext,
} from "./providers/campaignRenderer";

// Event campaigns retain push, in-app, and social promotion. Administrative
// Microsoft marketing email is implemented separately in adminMarketingEmail.ts.
// Email and SMS are accepted only as legacy stored values so old records can be
// diagnosed; they are never delivered by this processor.
type EventCampaignChannel = "push" | "in_app" | "social" | "email" | "sms";
const SUPPORTED_JOB_CHANNELS = new Set<EventCampaignChannel>(["push", "in_app"]);

// Secrets for social providers only. Microsoft email configuration is optional
// and does not participate in this event processor or core Functions deployment.
const linkedinClientId = defineSecret("LINKEDIN_CLIENT_ID");
const linkedinClientSecret = defineSecret("LINKEDIN_CLIENT_SECRET");
const xClientId = defineSecret("X_CLIENT_ID");
const xClientSecret = defineSecret("X_CLIENT_SECRET");

type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed";
type CampaignJobStatus = "pending" | "processing" | "sent" | "failed";

interface EventCampaignDoc {
  id: string;
  eventId?: string;
  seriesId?: string;
  status: CampaignStatus;
  channels: EventCampaignChannel[];
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

interface CampaignJobDoc {
  id: string;
  campaignId: string;
  type: "announce" | "reminder" | "starting_soon" | "follow_up";
  scheduledFor: number;
  status: CampaignJobStatus;
  recipientCount: number;
  createdAt: number;
  processedAt?: number;
  error?: string;
}

interface EventShareKitDoc {
  id: string;
  eventId?: string;
  seriesId?: string;
  status: "generating" | "ready" | "approved" | "archived";
  assets?: Array<{
    variant: "square" | "vertical" | "horizontal";
    storagePath: string;
    downloadUrl?: string;
  }>;
}

interface SocialPostDoc {
  id: string;
  eventId?: string;
  seriesId?: string;
  channel: "linkedin" | "facebook" | "instagram" | "x";
  caption: string;
  link?: string;
  assetRef?: string;
  scheduledFor: number;
  status: "draft" | "approved" | "scheduled" | "posted" | "failed";
  postUrl?: string;
  retries?: number;
  error?: string;
}

const MAX_RETRIES = 3;

function getDb() {
  return admin.firestore();
}

function requireAdmin(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Administrative access is required");
  }
}

function toJobId(campaignId: string, type: string, scheduledFor: number) {
  return `${campaignId}_${type}_${scheduledFor}`;
}

function clampScheduleTime(value: number | undefined): number | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

async function buildCampaignContext(campaign: EventCampaignDoc): Promise<CampaignContext> {
  const database = getDb();
  let eventTitle: string | undefined;
  let eventDate: string | undefined;
  let eventLocation: string | undefined;
  let eventUrl: string | undefined;

  if (campaign.eventId) {
    const eventSnap = await database.collection("events").doc(campaign.eventId).get();
    const eventData = eventSnap.data();
    if (eventData) {
      eventTitle = eventData.title;
      eventDate = new Date(eventData.startTime).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      eventLocation = eventData.location;
      eventUrl = `https://hi-coworking.com/events/detail?id=${campaign.eventId}`;
    }
  }

  return {
    eventTitle,
    eventDate,
    eventLocation,
    eventUrl,
    copyVariants: campaign.copyVariants,
  };
}

export const events_enqueueCampaignJobs = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required");
  requireAdmin(request.auth);

  const campaignId = typeof request.data?.campaignId === "string"
    ? request.data.campaignId.trim()
    : "";
  if (!campaignId) throw new HttpsError("invalid-argument", "Campaign ID is required");

  const database = getDb();
  const campaignRef = database.collection("eventCampaigns").doc(campaignId);
  const campaignSnap = await campaignRef.get();
  if (!campaignSnap.exists) throw new HttpsError("not-found", "Campaign not found");

  const campaign = campaignSnap.data() as EventCampaignDoc;
  const unsupportedChannels = campaign.channels.filter(
    (channel) => channel === "email" || channel === "sms",
  );
  if (unsupportedChannels.length) {
    throw new HttpsError(
      "failed-precondition",
      "Legacy event email and SMS delivery are disabled. Use the separate admin Microsoft marketing-email module for approved outreach.",
      { unsupportedChannels },
    );
  }

  const now = Date.now();
  const candidateJobs: Array<{ type: CampaignJobDoc["type"]; scheduledFor: number }> = [];
  const announceAt = clampScheduleTime(campaign.schedule?.announceAt);
  if (announceAt) candidateJobs.push({ type: "announce", scheduledFor: announceAt });

  const eventStart = campaign.eventId
    ? ((await database.collection("events").doc(campaign.eventId).get()).data()?.startTime as number | undefined)
    : undefined;
  if (eventStart && campaign.schedule?.reminderOffsetsHours?.length) {
    for (const offsetHours of campaign.schedule.reminderOffsetsHours) {
      if (!Number.isFinite(offsetHours)) continue;
      const scheduledFor = eventStart - Math.floor(offsetHours * 60 * 60 * 1_000);
      if (scheduledFor > 0) candidateJobs.push({ type: "reminder", scheduledFor });
    }
  }

  const followUpAt = clampScheduleTime(campaign.schedule?.followUpAt);
  if (followUpAt) candidateJobs.push({ type: "follow_up", scheduledFor: followUpAt });

  await Promise.all(candidateJobs.map(async ({ type, scheduledFor }) => {
    const id = toJobId(campaignId, type, scheduledFor);
    const ref = database.collection("campaignJobs").doc(id);
    const existing = await ref.get();
    if (existing.exists) return;
    const payload: CampaignJobDoc = {
      id,
      campaignId,
      type,
      scheduledFor,
      status: "pending",
      recipientCount: 0,
      createdAt: now,
    };
    await ref.set(payload, { merge: true });
  }));

  await campaignRef.set({ status: "scheduled", updatedAt: now }, { merge: true });
  return { success: true, enqueued: candidateJobs.length };
});

async function claimPendingCampaignJob(
  jobRef: FirebaseFirestore.DocumentReference,
): Promise<CampaignJobDoc | null> {
  const database = getDb();
  return database.runTransaction(async (transaction) => {
    const snap = await transaction.get(jobRef);
    if (!snap.exists) return null;
    const job = snap.data() as CampaignJobDoc;
    if (job.status !== "pending" || job.scheduledFor > Date.now()) return null;
    transaction.set(
      jobRef,
      { status: "processing" as CampaignJobStatus, processedAt: Date.now() },
      { merge: true },
    );
    return job;
  });
}

export const events_processCampaignJobs = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
  },
  async () => {
    const database = getDb();
    const now = Date.now();
    const pendingSnap = await database
      .collection("campaignJobs")
      .where("status", "==", "pending")
      .where("scheduledFor", "<=", now)
      .orderBy("scheduledFor", "asc")
      .limit(25)
      .get();
    const pushProvider = new FcmPushProvider();

    for (const jobDoc of pendingSnap.docs) {
      const claimed = await claimPendingCampaignJob(jobDoc.ref);
      if (!claimed) continue;

      try {
        const campaignSnap = await database.collection("eventCampaigns").doc(claimed.campaignId).get();
        if (!campaignSnap.exists) throw new Error("campaign-not-found");
        const campaign = campaignSnap.data() as EventCampaignDoc;
        const unsupportedChannels = campaign.channels.filter(
          (channel) => !SUPPORTED_JOB_CHANNELS.has(channel),
        );
        const supportedChannels = campaign.channels.filter((channel) => SUPPORTED_JOB_CHANNELS.has(channel));
        if (!supportedChannels.length) {
          throw new Error(`no-supported-delivery-channel:${unsupportedChannels.join(",")}`);
        }

        const context = await buildCampaignContext(campaign);
        const recipients = await resolveRecipients(
          campaign.id,
          claimed.type,
          campaign.eventId,
          campaign.audienceRules,
        );
        let totalSent = 0;
        let totalFailed = 0;

        if (campaign.channels.includes("push")) {
          const pushRecipients = recipients.filter((recipient) => recipient.fcmToken);
          if (pushRecipients.length) {
            const messages = pushRecipients.map((recipient) => ({
              token: recipient.fcmToken!,
              title: renderPushTitle(claimed.type, context),
              body: renderPushBody(claimed.type, context),
              link: context.eventUrl,
              data: {
                campaignId: campaign.id,
                jobType: claimed.type,
                ...(campaign.eventId ? { eventId: campaign.eventId } : {}),
              },
            }));
            const result = await pushProvider.sendBatch(messages);
            totalSent += result.sent;
            totalFailed += result.failed;
          }
        }

        if (campaign.channels.includes("in_app")) {
          const batch = database.batch();
          for (const recipient of recipients) {
            const notificationRef = database
              .collection("users")
              .doc(recipient.uid)
              .collection("notifications")
              .doc(`campaign_${claimed.id}`);
            batch.set(notificationRef, {
              id: `campaign_${claimed.id}`,
              type: "event_campaign",
              title: renderPushTitle(claimed.type, context),
              body: renderPushBody(claimed.type, context),
              link: context.eventUrl || "/events",
              read: false,
              createdAt: Date.now(),
            }, { merge: true });
          }
          await batch.commit();
          totalSent += recipients.length;
        }

        await jobDoc.ref.set({
          status: "sent",
          recipientCount: totalSent,
          processedAt: Date.now(),
          error: FieldValue.delete(),
          unsupportedChannels,
        }, { merge: true });
        await campaignSnap.ref.set({
          status: "active",
          updatedAt: Date.now(),
          "stats.impressions": FieldValue.increment(totalSent),
        }, { merge: true });
        logger.info("Event campaign job processed", {
          campaignId: claimed.campaignId,
          jobId: claimed.id,
          sent: totalSent,
          failed: totalFailed,
          unsupportedChannels,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown-error";
        logger.error("Event campaign job failed", { jobId: claimed.id, error: errorMessage });
        await jobDoc.ref.set({
          status: "failed",
          processedAt: Date.now(),
          error: errorMessage.slice(0, 500),
        }, { merge: true });
      }
    }
  },
);

export const events_generateShareKits = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "America/New_York",
    memory: "1GiB",
  },
  async () => {
    const database = getDb();
    const bucket = admin.storage().bucket();
    const kits = await database
      .collection("eventShareKits")
      .where("status", "==", "generating")
      .limit(15)
      .get();

    for (const kitDoc of kits.docs) {
      const kit = kitDoc.data() as EventShareKitDoc;
      try {
        let heroStoragePath: string | null = null;
        if (kit.eventId) {
          const eventSnap = await database.collection("events").doc(kit.eventId).get();
          heroStoragePath = eventSnap.data()?.heroImage?.storagePath || null;
        }
        if (!heroStoragePath && kit.seriesId) {
          const seriesSnap = await database.collection("eventSeries").doc(kit.seriesId).get();
          heroStoragePath = seriesSnap.data()?.heroImage?.storagePath || null;
        }

        const basePath = `event-share-kits/${kit.id}`;
        const assets: Array<{
          variant: "square" | "vertical" | "horizontal";
          storagePath: string;
          downloadUrl?: string;
        }> = [];

        if (heroStoragePath) {
          const sharp = await import("sharp");
          const [sourceBuffer] = await bucket.file(heroStoragePath).download();
          const variants: Array<{
            variant: "square" | "vertical" | "horizontal";
            width: number;
            height: number;
          }> = [
            { variant: "square", width: 1080, height: 1080 },
            { variant: "vertical", width: 1080, height: 1350 },
            { variant: "horizontal", width: 1200, height: 630 },
          ];
          for (const variant of variants) {
            const outputPath = `${basePath}/${variant.variant}.png`;
            const buffer = await sharp.default(sourceBuffer)
              .resize(variant.width, variant.height, { fit: "cover", position: "center" })
              .png({ quality: 90 })
              .toBuffer();
            const file = bucket.file(outputPath);
            await file.save(buffer, { contentType: "image/png", public: true });
            const [downloadUrl] = await file.getSignedUrl({
              action: "read",
              expires: Date.now() + 365 * 24 * 60 * 60 * 1_000,
            });
            assets.push({ variant: variant.variant, storagePath: outputPath, downloadUrl });
          }
        } else {
          for (const variant of ["square", "vertical", "horizontal"] as const) {
            assets.push({ variant, storagePath: `${basePath}/${variant}-placeholder.png` });
          }
        }

        await kitDoc.ref.set({ status: "ready", generatedAt: Date.now(), assets }, { merge: true });
        logger.info("Share kit generated", { kitId: kit.id, assetCount: assets.length });
      } catch (error) {
        logger.error("Share kit generation failed", { kitId: kit.id, error });
        await kitDoc.ref.set({
          status: "ready",
          generatedAt: Date.now(),
          error: error instanceof Error ? error.message : "unknown",
        }, { merge: true });
      }
    }
  },
);

export const events_processSocialPosts = onSchedule(
  {
    schedule: "*/10 * * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
    secrets: [linkedinClientId, linkedinClientSecret, xClientId, xClientSecret],
  },
  async () => {
    const database = getDb();
    const now = Date.now();
    const posts = await database
      .collection("socialPosts")
      .where("status", "in", ["approved", "scheduled"])
      .where("scheduledFor", "<=", now)
      .limit(25)
      .get();
    const secrets = {
      linkedinClientId: linkedinClientId.value() || undefined,
      linkedinClientSecret: linkedinClientSecret.value() || undefined,
      xClientId: xClientId.value() || undefined,
      xClientSecret: xClientSecret.value() || undefined,
    };

    for (const postDoc of posts.docs) {
      const post = postDoc.data() as SocialPostDoc;
      if ((post.retries || 0) >= MAX_RETRIES) {
        await postDoc.ref.set({ status: "failed", error: "max_retries_exceeded" }, { merge: true });
        continue;
      }
      try {
        let imageUrl: string | undefined;
        if (post.assetRef) {
          const assetSnap = await database.collection("eventMediaAssets").doc(post.assetRef).get();
          imageUrl = assetSnap.data()?.downloadUrl;
        }
        const provider = getSocialProvider(post.channel, secrets);
        const result = await provider.publish({ caption: post.caption, imageUrl, link: post.link });
        await postDoc.ref.set({
          status: "posted",
          postedAt: Date.now(),
          postUrl: result.postUrl,
          error: FieldValue.delete(),
        }, { merge: true });
        logger.info("Social post published", {
          postId: post.id,
          channel: post.channel,
          postUrl: result.postUrl,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown-error";
        logger.error("Social post failed", {
          postId: post.id,
          channel: post.channel,
          error: errorMessage,
        });
        await postDoc.ref.set({
          status: "failed",
          retries: (post.retries || 0) + 1,
          error: errorMessage,
        }, { merge: true });
      }
    }
  },
);
