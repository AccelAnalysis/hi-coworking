"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.events_processSocialPosts = exports.events_generateShareKits = exports.events_processCampaignJobs = exports.events_enqueueCampaignJobs = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const emailProvider_1 = require("./providers/emailProvider");
const smsProvider_1 = require("./providers/smsProvider");
const pushProvider_1 = require("./providers/pushProvider");
const socialProvider_1 = require("./providers/socialProvider");
const recipientResolver_1 = require("./providers/recipientResolver");
const campaignRenderer_1 = require("./providers/campaignRenderer");
// Secrets for campaign delivery providers
const sendgridApiKey = (0, params_1.defineSecret)("SENDGRID_API_KEY");
const twilioAccountSid = (0, params_1.defineSecret)("TWILIO_ACCOUNT_SID");
const twilioAuthToken = (0, params_1.defineSecret)("TWILIO_AUTH_TOKEN");
const twilioFromNumber = (0, params_1.defineSecret)("TWILIO_FROM_NUMBER");
// Secrets for social providers
const linkedinClientId = (0, params_1.defineSecret)("LINKEDIN_CLIENT_ID");
const linkedinClientSecret = (0, params_1.defineSecret)("LINKEDIN_CLIENT_SECRET");
const xClientId = (0, params_1.defineSecret)("X_CLIENT_ID");
const xClientSecret = (0, params_1.defineSecret)("X_CLIENT_SECRET");
const FROM_EMAIL = "events@hi-coworking.com";
const MAX_RETRIES = 3;
function getDb() {
    return admin.firestore();
}
function requireAdmin(auth) {
    const role = auth?.token?.role;
    if (role !== "admin" && role !== "master") {
        throw new Error("permission-denied");
    }
}
function toJobId(campaignId, type, scheduledFor) {
    return `${campaignId}_${type}_${scheduledFor}`;
}
function clampScheduleTime(value) {
    if (!value || !Number.isFinite(value) || value <= 0)
        return null;
    return Math.floor(value);
}
async function buildCampaignContext(campaign) {
    const db = getDb();
    let eventTitle;
    let eventDate;
    let eventLocation;
    let eventUrl;
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
exports.events_enqueueCampaignJobs = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error("unauthenticated");
    }
    requireAdmin(request.auth);
    const { campaignId } = request.data;
    if (!campaignId) {
        throw new Error("invalid-argument");
    }
    const db = getDb();
    const campaignRef = db.collection("eventCampaigns").doc(campaignId);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) {
        throw new Error("not-found");
    }
    const campaign = campaignSnap.data();
    const now = Date.now();
    const candidateJobs = [];
    const announceAt = clampScheduleTime(campaign.schedule?.announceAt);
    if (announceAt) {
        candidateJobs.push({ type: "announce", scheduledFor: announceAt });
    }
    const eventStart = campaign.eventId
        ? (await db.collection("events").doc(campaign.eventId).get()).data()?.startTime
        : undefined;
    if (eventStart && campaign.schedule?.reminderOffsetsHours?.length) {
        for (const offsetHours of campaign.schedule.reminderOffsetsHours) {
            if (!Number.isFinite(offsetHours))
                continue;
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
        if (existing.exists)
            return;
        const payload = {
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
async function claimPendingCampaignJob(jobRef) {
    const db = getDb();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(jobRef);
        if (!snap.exists)
            return null;
        const job = snap.data();
        if (job.status !== "pending" || job.scheduledFor > Date.now()) {
            return null;
        }
        tx.set(jobRef, { status: "processing", processedAt: Date.now() }, { merge: true });
        return job;
    });
}
exports.events_processCampaignJobs = (0, scheduler_1.onSchedule)({
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
    secrets: [sendgridApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber],
}, async () => {
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
        ? new emailProvider_1.SendGridProvider(sendgridApiKey.value())
        : null;
    const smsProvider = twilioAccountSid.value() && twilioAuthToken.value() && twilioFromNumber.value()
        ? new smsProvider_1.TwilioSmsProvider(twilioAccountSid.value(), twilioAuthToken.value(), twilioFromNumber.value())
        : null;
    const pushProvider = new pushProvider_1.FcmPushProvider();
    for (const jobDoc of pendingSnap.docs) {
        const claimed = await claimPendingCampaignJob(jobDoc.ref);
        if (!claimed)
            continue;
        try {
            const campaignSnap = await db.collection("eventCampaigns").doc(claimed.campaignId).get();
            if (!campaignSnap.exists) {
                throw new Error("campaign-not-found");
            }
            const campaign = campaignSnap.data();
            const ctx = await buildCampaignContext(campaign);
            // Resolve recipients
            const recipients = await (0, recipientResolver_1.resolveRecipients)(campaign.id, claimed.type, campaign.eventId, campaign.audienceRules);
            let totalSent = 0;
            let totalFailed = 0;
            // --- Email delivery via SendGrid ---
            if (campaign.channels.includes("email") && emailProvider) {
                const emailRecipients = recipients.filter((r) => r.email);
                if (emailRecipients.length > 0) {
                    const messages = emailRecipients.map((r) => ({
                        to: r.email,
                        from: FROM_EMAIL,
                        subject: (0, campaignRenderer_1.renderEmailSubject)(claimed.type, { ...ctx, recipientName: r.displayName }),
                        html: (0, campaignRenderer_1.renderEmailHtml)(claimed.type, { ...ctx, recipientName: r.displayName }),
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
                        to: r.phone,
                        body: (0, campaignRenderer_1.renderSmsBody)(claimed.type, ctx),
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
                        token: r.fcmToken,
                        title: (0, campaignRenderer_1.renderPushTitle)(claimed.type, ctx),
                        body: (0, campaignRenderer_1.renderPushBody)(claimed.type, ctx),
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
                        title: (0, campaignRenderer_1.renderPushTitle)(claimed.type, ctx),
                        body: (0, campaignRenderer_1.renderPushBody)(claimed.type, ctx),
                        link: ctx.eventUrl || "/events",
                        read: false,
                        createdAt: Date.now(),
                    }, { merge: true });
                }
                await batch.commit();
                totalSent += recipients.length;
            }
            // Update job status
            await jobDoc.ref.set({
                status: "sent",
                recipientCount: totalSent,
                processedAt: Date.now(),
                error: admin.firestore.FieldValue.delete(),
            }, { merge: true });
            // Update campaign stats
            await campaignSnap.ref.set({
                status: "active",
                updatedAt: Date.now(),
                "stats.impressions": admin.firestore.FieldValue.increment(totalSent),
            }, { merge: true });
            logger.info("Campaign job processed", {
                campaignId: claimed.campaignId,
                jobId: claimed.id,
                sent: totalSent,
                failed: totalFailed,
            });
        }
        catch (err) {
            logger.error("Campaign job failed", { jobId: claimed.id, err });
            await jobDoc.ref.set({
                status: "failed",
                processedAt: Date.now(),
                error: err instanceof Error ? err.message : "unknown-error",
            }, { merge: true });
        }
    }
});
// --- Share Kit Generator ---
exports.events_generateShareKits = (0, scheduler_1.onSchedule)({
    schedule: "*/15 * * * *",
    timeZone: "America/New_York",
    memory: "1GiB",
}, async () => {
    const db = getDb();
    const bucket = admin.storage().bucket();
    const kits = await db.collection("eventShareKits").where("status", "==", "generating").limit(15).get();
    for (const kitDoc of kits.docs) {
        const kit = kitDoc.data();
        try {
            // Find source hero image from event or series
            let heroStoragePath = null;
            if (kit.eventId) {
                const eventSnap = await db.collection("events").doc(kit.eventId).get();
                heroStoragePath = eventSnap.data()?.heroImage?.storagePath || null;
            }
            if (!heroStoragePath && kit.seriesId) {
                const seriesSnap = await db.collection("eventSeries").doc(kit.seriesId).get();
                heroStoragePath = seriesSnap.data()?.heroImage?.storagePath || null;
            }
            const basePath = `event-share-kits/${kit.id}`;
            const assets = [];
            if (heroStoragePath) {
                // Use the existing Sharp-generated variants from media pipeline
                // The media trigger generates variants at event-media/.../variants/
                const variantsBase = heroStoragePath.replace(/\/([^/]+)$/, "/variants/$1");
                // Generate share kit crops from hero image using Sharp
                const sharp = await import("sharp");
                const sourceFile = bucket.file(heroStoragePath);
                const [sourceBuffer] = await sourceFile.download();
                const variants = [
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
            }
            else {
                // No hero image; create placeholder paths
                for (const variant of ["square", "vertical", "horizontal"]) {
                    assets.push({ variant, storagePath: `${basePath}/${variant}-placeholder.png` });
                }
            }
            await kitDoc.ref.set({
                status: "ready",
                generatedAt: Date.now(),
                assets,
            }, { merge: true });
            logger.info("Share kit generated", { kitId: kit.id, assetCount: assets.length });
        }
        catch (err) {
            logger.error("Share kit generation failed", { kitId: kit.id, err });
            await kitDoc.ref.set({ status: "ready", generatedAt: Date.now(), error: err instanceof Error ? err.message : "unknown" }, { merge: true });
        }
    }
});
// --- Social Post Processor ---
exports.events_processSocialPosts = (0, scheduler_1.onSchedule)({
    schedule: "*/10 * * * *",
    timeZone: "America/New_York",
    memory: "512MiB",
    secrets: [linkedinClientId, linkedinClientSecret, xClientId, xClientSecret],
}, async () => {
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
        const post = postDoc.data();
        // Skip if exceeded retry limit
        if ((post.retries || 0) >= MAX_RETRIES) {
            await postDoc.ref.set({ status: "failed", error: "max_retries_exceeded" }, { merge: true });
            continue;
        }
        try {
            // Resolve image URL if assetRef is provided
            let imageUrl;
            if (post.assetRef) {
                const assetSnap = await db.collection("eventMediaAssets").doc(post.assetRef).get();
                const assetData = assetSnap.data();
                if (assetData?.downloadUrl) {
                    imageUrl = assetData.downloadUrl;
                }
            }
            const provider = (0, socialProvider_1.getSocialProvider)(post.channel, secrets);
            const result = await provider.publish({
                caption: post.caption,
                imageUrl,
                link: post.link,
            });
            await postDoc.ref.set({
                status: "posted",
                postedAt: Date.now(),
                postUrl: result.postUrl,
                error: admin.firestore.FieldValue.delete(),
            }, { merge: true });
            logger.info("Social post published", { postId: post.id, channel: post.channel, postUrl: result.postUrl });
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : "unknown-error";
            logger.error("Social post failed", { postId: post.id, channel: post.channel, err: errMsg });
            await postDoc.ref.set({
                status: "failed",
                retries: (post.retries || 0) + 1,
                error: errMsg,
            }, { merge: true });
        }
    }
});
