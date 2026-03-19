import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { SendGridProvider } from "./providers/emailProvider";
import { TwilioSmsProvider } from "./providers/smsProvider";
import { FcmPushProvider } from "./providers/pushProvider";
import { getSocialProvider } from "./providers/socialProvider";
import { resolveRecipients } from "./providers/recipientResolver";
import {
  renderEmailSubject,
  renderEmailHtml,
  renderSmsBody,
  renderPushTitle,
  renderPushBody,
  type CampaignContext,
} from "./providers/campaignRenderer";

// Secrets for campaign delivery providers
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioFromNumber = defineSecret("TWILIO_FROM_NUMBER");

// Secrets for social providers
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
  assets?: Array<{ variant: "square" | "vertical" | "horizontal"; storagePath: string; downloadUrl?: string }>;
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

const FROM_EMAIL = "events@hi-coworking.com";
const MAX_RETRIES = 3;

function getDb() {
  return admin.firestore();
}

function requireAdmin(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new Error("permission-denied");
  }
}

function toJobId(campaignId: string, type: string, scheduledFor: number) {
  return `${campaignId}_${type}_${scheduledFor}`;
}

function clampScheduleTime(value: number | undefined): number | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

async function buildCampaignContext(
  campaign: EventCampaignDoc
): Promise<CampaignContext> {
  const db = getDb();
  let eventTitle: string | undefined;
  let eventDate: string | undefined;
  let eventLocation: string | undefined;
  let eventUrl: string | undefined;

  if (campaign.eventId) {
    const eventSnap = await db.collection("events").doc(campaign.eventId).get();
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

// --- Enqueue ---

export const events_enqueueCampaignJobs = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("unauthenticated");
  }
  requireAdmin(request.auth);

  const { campaignId } = request.data as { campaignId?: string };
  if (!campaignId) {
    throw new Error("invalid-argument");
  }

  const db = getDb();
  const campaignRef = db.collection("eventCampaigns").doc(campaignId);
  const campaignSnap = await campaignRef.get();
  if (!campaignSnap.exists) {
    throw new Error("not-found");
  }

  const campaign = campaignSnap.data() as EventCampaignDoc;
  const now = Date.now();
  const candidateJobs: Array<{ type: CampaignJobDoc["type"]; scheduledFor: number }> = [];

  const announceAt = clampScheduleTime(campaign.schedule?.announceAt);
  if (announceAt) {
    candidateJobs.push({ type: "announce", scheduledFor: announceAt });
  }

  const eventStart = campaign.eventId
    ? ((await db.collection("events").doc(campaign.eventId).get()).data()?.startTime as number | undefined)
    : undefined;

  if (eventStart && campaign.schedule?.reminderOffsetsHours?.length) {
    for (const offsetHours of campaign.schedule.reminderOffsetsHours) {
      if (!Number.isFinite(offsetHours)) continue;
      const scheduledFor = eventStart - Math.floor(offsetHours * 60 * 60 * 1000);
      if (scheduledFor > 0) {
        candidateJobs.push({ type: "reminder", scheduledFor });
      }
    }
  }

  const followUpAt = clampScheduleTime(campaign.schedule?.followUpAt);
  if (followUpAt) {
    candidateJobs.push({ type: "follow_up", scheduledFor: followUpAt });
  }

  const writes = candidateJobs.map(async ({ type, scheduledFor }) => {
    const id = toJobId(campaignId, type, scheduledFor);
    const ref = db.collection("campaignJobs").doc(id);
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
  });

  await Promise.all(writes);
  await campaignRef.set({ status: "scheduled", updatedAt: now }, { merge: true });

  return { success: true, enqueued: candidateJobs.length };
});

// --- Campaign Job Processor ---

async function claimPendingCampaignJob(jobRef: FirebaseFirestore.DocumentReference): Promise<CampaignJobDoc | null> {
  const db = getDb();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return null;
    const job = snap.data() as CampaignJobDoc;
    if (job.status !== "pending" || job.scheduledFor > Date.now()) {
      return null;
    }
    tx.set(jobRef, { status: "processing" as CampaignJobStatus, processedAt: Date.now() }, { merge: true });
    return job;
  });
}

export const events_processCampaignJobs = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
    secrets: [sendgridApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber],
  },
  async () => {
    const db = getDb();
    const now = Date.now();
    const pendingSnap = await db
      .collection("campaignJobs")
      .where("status", "==", "pending")
      .where("scheduledFor", "<=", now)
      .orderBy("scheduledFor", "asc")
      .limit(25)
      .get();

    // Initialize providers (only if secrets are available)
    const emailProvider = sendgridApiKey.value()
      ? new SendGridProvider(sendgridApiKey.value())
      : null;
    const smsProvider =
      twilioAccountSid.value() && twilioAuthToken.value() && twilioFromNumber.value()
        ? new TwilioSmsProvider(twilioAccountSid.value(), twilioAuthToken.value(), twilioFromNumber.value())
        : null;
    const pushProvider = new FcmPushProvider();

    for (const jobDoc of pendingSnap.docs) {
      const claimed = await claimPendingCampaignJob(jobDoc.ref);
      if (!claimed) continue;

      try {
        const campaignSnap = await db.collection("eventCampaigns").doc(claimed.campaignId).get();
        if (!campaignSnap.exists) {
          throw new Error("campaign-not-found");
        }

        const campaign = campaignSnap.data() as EventCampaignDoc;
        const ctx = await buildCampaignContext(campaign);

        // Resolve recipients
        const recipients = await resolveRecipients(
          campaign.id,
          claimed.type,
          campaign.eventId,
          campaign.audienceRules
        );

        let totalSent = 0;
        let totalFailed = 0;

        // --- Email delivery via SendGrid ---
        if (campaign.channels.includes("email") && emailProvider) {
          const emailRecipients = recipients.filter((r) => r.email);
          if (emailRecipients.length > 0) {
            const messages = emailRecipients.map((r) => ({
              to: r.email!,
              from: FROM_EMAIL,
              subject: renderEmailSubject(claimed.type, { ...ctx, recipientName: r.displayName }),
              html: renderEmailHtml(claimed.type, { ...ctx, recipientName: r.displayName }),
            }));
            const result = await emailProvider.sendBatch(messages);
            totalSent += result.sent;
            totalFailed += result.failed;
            logger.info("Email batch sent", { sent: result.sent, failed: result.failed });
          }
        }

        // --- SMS delivery via Twilio ---
        if (campaign.channels.includes("sms") && smsProvider) {
          const smsRecipients = recipients.filter((r) => r.phone);
          if (smsRecipients.length > 0) {
            const messages = smsRecipients.map((r) => ({
              to: r.phone!,
              body: renderSmsBody(claimed.type, ctx),
            }));
            const result = await smsProvider.sendBatch(messages);
            totalSent += result.sent;
            totalFailed += result.failed;
            logger.info("SMS batch sent", { sent: result.sent, failed: result.failed });
          }
        }

        // --- Push notifications via FCM ---
        if (campaign.channels.includes("push")) {
          const pushRecipients = recipients.filter((r) => r.fcmToken);
          if (pushRecipients.length > 0) {
            const messages = pushRecipients.map((r) => ({
              token: r.fcmToken!,
              title: renderPushTitle(claimed.type, ctx),
              body: renderPushBody(claimed.type, ctx),
              link: ctx.eventUrl,
              data: {
                campaignId: campaign.id,
                jobType: claimed.type,
                ...(campaign.eventId ? { eventId: campaign.eventId } : {}),
              },
            }));
            const result = await pushProvider.sendBatch(messages);
            totalSent += result.sent;
            totalFailed += result.failed;
            logger.info("Push batch sent", { sent: result.sent, failed: result.failed });
          }
        }

        // --- In-app notifications ---
        if (campaign.channels.includes("in_app")) {
          const batch = db.batch();
          for (const r of recipients) {
            const notifRef = db
              .collection("users")
              .doc(r.uid)
              .collection("notifications")
              .doc(`campaign_${claimed.id}`);
            batch.set(notifRef, {
              id: `campaign_${claimed.id}`,
              type: "event_campaign",
              title: renderPushTitle(claimed.type, ctx),
              body: renderPushBody(claimed.type, ctx),
              link: ctx.eventUrl || "/events",
              read: false,
              createdAt: Date.now(),
            }, { merge: true });
          }
          await batch.commit();
          totalSent += recipients.length;
        }

        // Update job status
        await jobDoc.ref.set(
          {
            status: "sent",
            recipientCount: totalSent,
            processedAt: Date.now(),
            error: admin.firestore.FieldValue.delete(),
          },
          { merge: true }
        );

        // Update campaign stats
        await campaignSnap.ref.set(
          {
            status: "active",
            updatedAt: Date.now(),
            "stats.impressions": admin.firestore.FieldValue.increment(totalSent),
          },
          { merge: true }
        );

        logger.info("Campaign job processed", {
          campaignId: claimed.campaignId,
          jobId: claimed.id,
          sent: totalSent,
          failed: totalFailed,
        });
      } catch (err) {
        logger.error("Campaign job failed", { jobId: claimed.id, err });
        await jobDoc.ref.set(
          {
            status: "failed",
            processedAt: Date.now(),
            error: err instanceof Error ? err.message : "unknown-error",
          },
          { merge: true }
        );
      }
    }
  }
);

// --- Share Kit Generator ---

export const events_generateShareKits = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "America/New_York",
    memory: "1GiB",
  },
  async () => {
    const db = getDb();
    const bucket = admin.storage().bucket();
    const kits = await db.collection("eventShareKits").where("status", "==", "generating").limit(15).get();

    for (const kitDoc of kits.docs) {
      const kit = kitDoc.data() as EventShareKitDoc;

      try {
        // Find source hero image from event or series
        let heroStoragePath: string | null = null;
        if (kit.eventId) {
          const eventSnap = await db.collection("events").doc(kit.eventId).get();
          heroStoragePath = eventSnap.data()?.heroImage?.storagePath || null;
        }
        if (!heroStoragePath && kit.seriesId) {
          const seriesSnap = await db.collection("eventSeries").doc(kit.seriesId).get();
          heroStoragePath = seriesSnap.data()?.heroImage?.storagePath || null;
        }

        const basePath = `event-share-kits/${kit.id}`;
        const assets: Array<{ variant: "square" | "vertical" | "horizontal"; storagePath: string; downloadUrl?: string }> = [];

        if (heroStoragePath) {
          // Use the existing Sharp-generated variants from media pipeline
          // The media trigger generates variants at event-media/.../variants/
          const variantsBase = heroStoragePath.replace(/\/([^/]+)$/, "/variants/$1");

          // Generate share kit crops from hero image using Sharp
          const sharp = await import("sharp");
          const sourceFile = bucket.file(heroStoragePath);
          const [sourceBuffer] = await sourceFile.download();

          const variants: Array<{ variant: "square" | "vertical" | "horizontal"; width: number; height: number }> = [
            { variant: "square", width: 1080, height: 1080 },
            { variant: "vertical", width: 1080, height: 1350 },
            { variant: "horizontal", width: 1200, height: 630 },
          ];

          for (const v of variants) {
            const outputPath = `${basePath}/${v.variant}.png`;
            const buffer = await sharp.default(sourceBuffer)
              .resize(v.width, v.height, { fit: "cover", position: "center" })
              .png({ quality: 90 })
              .toBuffer();

            const file = bucket.file(outputPath);
            await file.save(buffer, { contentType: "image/png", public: true });
            const [downloadUrl] = await file.getSignedUrl({
              action: "read",
              expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
            });

            assets.push({ variant: v.variant, storagePath: outputPath, downloadUrl });
          }
        } else {
          // No hero image; create placeholder paths
          for (const variant of ["square", "vertical", "horizontal"] as const) {
            assets.push({ variant, storagePath: `${basePath}/${variant}-placeholder.png` });
          }
        }

        await kitDoc.ref.set(
          {
            status: "ready",
            generatedAt: Date.now(),
            assets,
          },
          { merge: true }
        );

        logger.info("Share kit generated", { kitId: kit.id, assetCount: assets.length });
      } catch (err) {
        logger.error("Share kit generation failed", { kitId: kit.id, err });
        await kitDoc.ref.set(
          { status: "ready", generatedAt: Date.now(), error: err instanceof Error ? err.message : "unknown" },
          { merge: true }
        );
      }
    }
  }
);

// --- Social Post Processor ---

export const events_processSocialPosts = onSchedule(
  {
    schedule: "*/10 * * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
    secrets: [linkedinClientId, linkedinClientSecret, xClientId, xClientSecret],
  },
  async () => {
    const db = getDb();
    const now = Date.now();
    const posts = await db
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

      // Skip if exceeded retry limit
      if ((post.retries || 0) >= MAX_RETRIES) {
        await postDoc.ref.set({ status: "failed", error: "max_retries_exceeded" }, { merge: true });
        continue;
      }

      try {
        // Resolve image URL if assetRef is provided
        let imageUrl: string | undefined;
        if (post.assetRef) {
          const assetSnap = await db.collection("eventMediaAssets").doc(post.assetRef).get();
          const assetData = assetSnap.data();
          if (assetData?.downloadUrl) {
            imageUrl = assetData.downloadUrl;
          }
        }

        const provider = getSocialProvider(post.channel, secrets);
        const result = await provider.publish({
          caption: post.caption,
          imageUrl,
          link: post.link,
        });

        await postDoc.ref.set(
          {
            status: "posted",
            postedAt: Date.now(),
            postUrl: result.postUrl,
            error: admin.firestore.FieldValue.delete(),
          },
          { merge: true }
        );

        logger.info("Social post published", { postId: post.id, channel: post.channel, postUrl: result.postUrl });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "unknown-error";
        logger.error("Social post failed", { postId: post.id, channel: post.channel, err: errMsg });

        await postDoc.ref.set(
          {
            status: "failed",
            retries: (post.retries || 0) + 1,
            error: errMsg,
          },
          { merge: true }
        );
      }
    }
  }
);
