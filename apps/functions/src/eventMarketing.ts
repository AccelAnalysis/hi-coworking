import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { getSocialProvider } from "./providers/socialProvider";
import type { CampaignJobDoc, EventCampaignDoc } from "./campaignJobs";

// events_processCampaignJobs lives in campaignJobs.ts so the isolated
// campaign bundle (firebase/campaign-functions) can deploy it without the
// LinkedIn and X secrets declared below. Re-exported for the main source.
export { events_processCampaignJobs } from "./campaignJobs";

// Secrets for social providers
const linkedinClientId = defineSecret("LINKEDIN_CLIENT_ID");
const linkedinClientSecret = defineSecret("LINKEDIN_CLIENT_SECRET");
const xClientId = defineSecret("X_CLIENT_ID");
const xClientSecret = defineSecret("X_CLIENT_SECRET");

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
            error: FieldValue.delete(),
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
