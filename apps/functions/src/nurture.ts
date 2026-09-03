import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { SendGridProvider } from "./providers/emailProvider";

if (admin.apps.length === 0) admin.initializeApp();

const db = admin.firestore();
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const FROM_EMAIL = "hello@hi-coworking.com";
const SITE_ORIGIN = "https://hi-coworking.com";
const CAMPAIGNS = "nurtureCampaigns";
const ENROLLMENTS = "nurtureEnrollments";
const DELIVERIES = "nurtureDeliveries";
const SUPPRESSIONS = "nurtureSuppressions";

export type NurtureSignal =
  | "LEAD_CREATED"
  | "BOOKING_CONFIRMED"
  | "MEMBER_ACTIVATED"
  | "RENEWAL_DUE"
  | "MEMBER_INACTIVE";

type NurtureStage = "ACQUISITION" | "CUSTOMER_DEVELOPMENT" | "RETENTION";
type CampaignStatus = "ACTIVE" | "PAUSED";
type EnrollmentStatus = "ACTIVE" | "COMPLETED" | "SUPPRESSED" | "FAILED";

type CampaignStep = {
  id: string;
  delayHours: number;
  subject: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
};

type Campaign = {
  id: string;
  name: string;
  stage: NurtureStage;
  status: CampaignStatus;
  entrySignals: NurtureSignal[];
  steps: CampaignStep[];
  createdAt?: number;
  updatedAt?: number;
  updatedBy?: string;
};

type Contact = {
  contactType: "lead" | "user";
  contactId: string;
  email: string;
  displayName?: string;
  uid?: string;
};

type Enrollment = {
  id: string;
  campaignId: string;
  stage: NurtureStage;
  sourceSignal: NurtureSignal;
  sourceRefId?: string;
  contactType: "lead" | "user";
  contactId: string;
  email: string;
  emailHash: string;
  displayName?: string;
  uid?: string;
  status: EnrollmentStatus;
  nextStepIndex: number;
  nextDueAt: number;
  unsubscribeToken: string;
  enrolledAt: number;
  updatedAt: number;
  lastDeliveredAt?: number;
  failureCount?: number;
};

const DEFAULT_CAMPAIGNS: Campaign[] = [
  {
    id: "acquisition-lead",
    name: "New inquiry follow-up",
    stage: "ACQUISITION",
    status: "ACTIVE",
    entrySignals: ["LEAD_CREATED"],
    steps: [
      {
        id: "welcome",
        delayHours: 0,
        subject: "Thanks for reaching out to Hi Coworking",
        body: "Thanks for your interest in Hi Coworking. Take a look at the space, compare options, or plan a visit when it works for you.",
        ctaLabel: "Explore Hi Coworking",
        ctaHref: "/visit",
      },
      {
        id: "book",
        delayHours: 24,
        subject: "Ready to choose your workspace?",
        body: "You can reserve a coworking desk or meeting room directly from the booking screen and see live availability for the time you need.",
        ctaLabel: "Book a space",
        ctaHref: "/book",
      },
      {
        id: "community",
        delayHours: 72,
        subject: "A workspace should fit the way you work",
        body: "Hi Coworking is designed for focused work, useful meetings, and a comfortable local workday. We would be glad to welcome you in.",
        ctaLabel: "Plan a visit",
        ctaHref: "/visit",
      },
    ],
  },
  {
    id: "customer-first-booking",
    name: "First booking development",
    stage: "CUSTOMER_DEVELOPMENT",
    status: "ACTIVE",
    entrySignals: ["BOOKING_CONFIRMED"],
    steps: [
      {
        id: "booking-ready",
        delayHours: 0,
        subject: "Your Hi Coworking visit is on the calendar",
        body: "Your booking is confirmed. Before you arrive, review your booking details and access information from your dashboard.",
        ctaLabel: "Open your dashboard",
        ctaHref: "/dashboard",
      },
      {
        id: "next-visit",
        delayHours: 72,
        subject: "Make your next Hi Coworking visit easier",
        body: "If Hi Coworking is becoming part of your routine, compare membership options and reserve your next workspace while your preferred time is open.",
        ctaLabel: "View memberships",
        ctaHref: "/membership",
      },
    ],
  },
  {
    id: "member-welcome",
    name: "Member development",
    stage: "CUSTOMER_DEVELOPMENT",
    status: "ACTIVE",
    entrySignals: ["MEMBER_ACTIVATED"],
    steps: [
      {
        id: "member-start",
        delayHours: 0,
        subject: "Welcome to Hi Coworking membership",
        body: "Your membership is active. Your dashboard keeps your bookings, membership details, and access information together.",
        ctaLabel: "Open member dashboard",
        ctaHref: "/dashboard",
      },
      {
        id: "member-book",
        delayHours: 168,
        subject: "Put your membership to work",
        body: "Reserve the desk time you need and keep an eye on your included hours and member rate from one booking flow.",
        ctaLabel: "Book a workspace",
        ctaHref: "/book",
      },
    ],
  },
  {
    id: "retention-renewal",
    name: "Renewal retention",
    stage: "RETENTION",
    status: "ACTIVE",
    entrySignals: ["RENEWAL_DUE"],
    steps: [
      {
        id: "renewal-review",
        delayHours: 0,
        subject: "A quick Hi Coworking membership check-in",
        body: "Your current membership period is approaching renewal. Review your plan and account so there are no surprises in your next work cycle.",
        ctaLabel: "Review membership",
        ctaHref: "/dashboard/membership",
      },
    ],
  },
  {
    id: "retention-inactive",
    name: "Inactive member re-engagement",
    stage: "RETENTION",
    status: "ACTIVE",
    entrySignals: ["MEMBER_INACTIVE"],
    steps: [
      {
        id: "return",
        delayHours: 0,
        subject: "Need a place to work again?",
        body: "It has been a while since your last Hi Coworking booking. When you need focused workspace or a meeting room again, your account is ready.",
        ctaLabel: "Check availability",
        ctaHref: "/book",
      },
    ],
  },
];

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 500);
}

function firstName(value?: string) {
  return value?.trim().split(/\s+/)[0] || "there";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function campaignHref(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  return `${SITE_ORIGIN}${value}`;
}

function requireAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const role = String(request.auth.token.role || "");
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return request.auth.uid;
}

async function ensureDefaultCampaigns() {
  const now = Date.now();
  const batch = db.batch();
  let writes = 0;
  for (const campaign of DEFAULT_CAMPAIGNS) {
    const ref = db.collection(CAMPAIGNS).doc(campaign.id);
    const snap = await ref.get();
    if (snap.exists) continue;
    batch.set(ref, { ...campaign, createdAt: now, updatedAt: now, updatedBy: "system" });
    writes += 1;
  }
  if (writes > 0) await batch.commit();
  return writes;
}

async function isSuppressed(emailHash: string, uid?: string) {
  const suppression = await db.collection(SUPPRESSIONS).doc(emailHash).get();
  if (suppression.exists) return true;
  if (!uid) return false;
  const user = await db.collection("users").doc(uid).get();
  return Boolean(user.data()?.marketingOptOut || user.data()?.doNotContact);
}

async function enrollContact(signal: NurtureSignal, contact: Contact, sourceRefId?: string) {
  const email = normalizeEmail(contact.email);
  if (!isValidEmail(email)) return [] as string[];
  const emailHash = stableHash(email);
  if (await isSuppressed(emailHash, contact.uid)) return [] as string[];

  await ensureDefaultCampaigns();
  const campaignSnap = await db
    .collection(CAMPAIGNS)
    .where("entrySignals", "array-contains", signal)
    .get();
  const created: string[] = [];
  const now = Date.now();

  for (const campaignDoc of campaignSnap.docs) {
    const campaign = campaignDoc.data() as Campaign;
    if (campaign.status !== "ACTIVE" || campaign.steps.length === 0) continue;
    const identity = [campaign.id, contact.contactType, contact.contactId, signal, sourceRefId || "lifecycle"].join("|");
    const id = cleanId(`enroll_${stableHash(identity)}`);
    const ref = db.collection(ENROLLMENTS).doc(id);
    const existing = await ref.get();
    if (existing.exists) continue;
    const firstStep = campaign.steps[0];
    const enrollment: Enrollment = {
      id,
      campaignId: campaign.id,
      stage: campaign.stage,
      sourceSignal: signal,
      ...(sourceRefId ? { sourceRefId } : {}),
      contactType: contact.contactType,
      contactId: contact.contactId,
      email,
      emailHash,
      ...(contact.displayName ? { displayName: contact.displayName } : {}),
      ...(contact.uid ? { uid: contact.uid } : {}),
      status: "ACTIVE",
      nextStepIndex: 0,
      nextDueAt: now + Math.max(0, firstStep.delayHours) * 60 * 60 * 1000,
      unsubscribeToken: randomBytes(24).toString("hex"),
      enrolledAt: now,
      updatedAt: now,
    };
    await ref.create(enrollment);
    created.push(id);
  }
  return created;
}

function renderMessage(enrollment: Enrollment, step: CampaignStep) {
  const href = campaignHref(step.ctaHref);
  const unsubscribeHref = `${SITE_ORIGIN}/preferences?token=${encodeURIComponent(enrollment.unsubscribeToken)}`;
  const subject = step.subject.replace(/\{\{firstName\}\}/g, firstName(enrollment.displayName));
  const body = step.body.replace(/\{\{firstName\}\}/g, firstName(enrollment.displayName));
  const cta = href && step.ctaLabel
    ? `<p style="margin:28px 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;font-weight:650">${escapeHtml(step.ctaLabel)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:620px;margin:0 auto;padding:40px 24px"><div style="font-size:14px;font-weight:700;letter-spacing:.02em">Hi Coworking</div><h1 style="margin:24px 0 12px;font-size:28px;line-height:1.2">${escapeHtml(subject)}</h1><p style="margin:0;font-size:16px;line-height:1.7;color:#475569">${escapeHtml(body)}</p>${cta}<p style="margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.6;color:#64748b">You are receiving this because you contacted, booked, or hold an account with Hi Coworking. <a href="${escapeHtml(unsubscribeHref)}" style="color:#475569">Manage follow-up preferences</a>.</p></div></body></html>`;
  return { subject, html, text: `${body}\n\n${href || ""}\n\nManage follow-up preferences: ${unsubscribeHref}`.trim() };
}

async function advanceEnrollment(ref: FirebaseFirestore.DocumentReference, enrollment: Enrollment, campaign: Campaign, deliveredAt: number) {
  const nextStepIndex = enrollment.nextStepIndex + 1;
  const next = campaign.steps[nextStepIndex];
  await ref.set({
    status: next ? "ACTIVE" : "COMPLETED",
    nextStepIndex,
    nextDueAt: next ? deliveredAt + Math.max(0, next.delayHours) * 60 * 60 * 1000 : Number.MAX_SAFE_INTEGER,
    lastDeliveredAt: deliveredAt,
    failureCount: 0,
    updatedAt: deliveredAt,
  }, { merge: true });
}

async function processEnrollment(ref: FirebaseFirestore.DocumentReference, provider: SendGridProvider) {
  const snap = await ref.get();
  if (!snap.exists) return;
  const enrollment = snap.data() as Enrollment;
  if (enrollment.status !== "ACTIVE" || enrollment.nextDueAt > Date.now()) return;
  if (await isSuppressed(enrollment.emailHash, enrollment.uid)) {
    await ref.set({ status: "SUPPRESSED", updatedAt: Date.now() }, { merge: true });
    return;
  }

  const campaignSnap = await db.collection(CAMPAIGNS).doc(enrollment.campaignId).get();
  if (!campaignSnap.exists) {
    await ref.set({ status: "FAILED", failureCount: (enrollment.failureCount || 0) + 1, updatedAt: Date.now() }, { merge: true });
    return;
  }
  const campaign = campaignSnap.data() as Campaign;
  if (campaign.status !== "ACTIVE") return;
  const step = campaign.steps[enrollment.nextStepIndex];
  if (!step) {
    await ref.set({ status: "COMPLETED", updatedAt: Date.now() }, { merge: true });
    return;
  }

  const deliveryId = cleanId(`${enrollment.id}__${step.id}`);
  const deliveryRef = db.collection(DELIVERIES).doc(deliveryId);
  const existingDelivery = await deliveryRef.get();
  if (existingDelivery.data()?.status === "SENT") {
    await advanceEnrollment(ref, enrollment, campaign, Number(existingDelivery.data()?.sentAt || Date.now()));
    return;
  }

  const attempt = Math.max(0, Number(existingDelivery.data()?.attempts || 0)) + 1;
  const now = Date.now();
  await deliveryRef.set({
    id: deliveryId,
    enrollmentId: enrollment.id,
    campaignId: campaign.id,
    stepId: step.id,
    email: enrollment.email,
    status: "PROCESSING",
    attempts: attempt,
    startedAt: now,
    updatedAt: now,
  }, { merge: true });

  try {
    const message = renderMessage(enrollment, step);
    const result = await provider.send({
      to: enrollment.email,
      from: FROM_EMAIL,
      subject: message.subject,
      html: message.html,
      text: message.text,
      categories: ["hi-coworking-nurture", campaign.stage.toLowerCase()],
    });
    const sentAt = Date.now();
    await deliveryRef.set({ status: "SENT", sentAt, providerMessageId: result.messageId, updatedAt: sentAt }, { merge: true });
    await advanceEnrollment(ref, enrollment, campaign, sentAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCount = (enrollment.failureCount || 0) + 1;
    const retryDelayMinutes = Math.min(24 * 60, 15 * 2 ** Math.min(6, failureCount - 1));
    await deliveryRef.set({ status: "FAILED", error: message.slice(0, 500), updatedAt: Date.now() }, { merge: true });
    await ref.set({
      status: failureCount >= 6 ? "FAILED" : "ACTIVE",
      failureCount,
      nextDueAt: Date.now() + retryDelayMinutes * 60 * 1000,
      updatedAt: Date.now(),
    }, { merge: true });
    logger.error("Nurture delivery failed", { enrollmentId: enrollment.id, campaignId: campaign.id, stepId: step.id, failureCount, error: message });
  }
}

export const nurture_process = onSchedule(
  { schedule: "every 15 minutes", secrets: [sendgridApiKey] },
  async () => {
    await ensureDefaultCampaigns();
    const apiKey = sendgridApiKey.value();
    if (!apiKey) {
      logger.error("Nurture processor skipped because SENDGRID_API_KEY is not configured");
      return;
    }
    const provider = new SendGridProvider(apiKey);
    const snap = await db.collection(ENROLLMENTS).where("nextDueAt", "<=", Date.now()).limit(100).get();
    for (const doc of snap.docs) await processEnrollment(doc.ref, provider);
  },
);

export const nurture_scanLifecycle = onSchedule("every day 09:00", async () => {
  const now = Date.now();
  const renewalHorizon = now + 14 * 24 * 60 * 60 * 1000;
  const inactiveCutoff = now - 45 * 24 * 60 * 60 * 1000;
  const userSnap = await db.collection("users").where("membershipStatus", "==", "active").limit(500).get();
  for (const doc of userSnap.docs) {
    const data = doc.data();
    const email = normalizeEmail(data.email);
    if (!isValidEmail(email)) continue;
    const contact: Contact = {
      contactType: "user",
      contactId: doc.id,
      uid: doc.id,
      email,
      displayName: String(data.displayName || ""),
    };
    const expiresAt = Number(data.expiresAt || 0);
    if (expiresAt > now && expiresAt <= renewalHorizon) {
      await enrollContact("RENEWAL_DUE", contact, `renewal:${new Date(expiresAt).toISOString().slice(0, 10)}`);
    }
    const lastBookingAt = Number(data.lastBookingAt || 0);
    if (lastBookingAt > 0 && lastBookingAt <= inactiveCutoff) {
      await enrollContact("MEMBER_INACTIVE", contact, `inactive:${new Date(now).toISOString().slice(0, 10)}`);
    }
  }
});

export const nurture_onLeadCreated = onDocumentCreated("leads/{leadId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const email = normalizeEmail(data.email);
  if (!isValidEmail(email)) return;
  await enrollContact("LEAD_CREATED", {
    contactType: "lead",
    contactId: event.params.leadId,
    email,
    displayName: String(data.name || data.displayName || ""),
  }, event.params.leadId);
});

export const nurture_onBookingCreated = onDocumentCreated("bookings/{bookingId}", async (event) => {
  const data = event.data?.data();
  if (!data || String(data.status || "").toUpperCase() !== "CONFIRMED") return;
  const uid = String(data.userId || "");
  if (!uid || uid.startsWith("guest:")) return;
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.data();
  const email = normalizeEmail(user?.email);
  if (!isValidEmail(email)) return;
  await userSnap.ref.set({ lastBookingAt: Number(data.createdAt || Date.now()), updatedAt: Date.now() }, { merge: true });
  await enrollContact("BOOKING_CONFIRMED", {
    contactType: "user",
    contactId: uid,
    uid,
    email,
    displayName: String(user?.displayName || data.userName || ""),
  }, event.params.bookingId);
});

export const nurture_onMemberUpdated = onDocumentUpdated("users/{uid}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (String(before.membershipStatus || "") === "active" || String(after.membershipStatus || "") !== "active") return;
  const email = normalizeEmail(after.email);
  if (!isValidEmail(email)) return;
  await enrollContact("MEMBER_ACTIVATED", {
    contactType: "user",
    contactId: event.params.uid,
    uid: event.params.uid,
    email,
    displayName: String(after.displayName || ""),
  }, `membership:${Number(after.updatedAt || Date.now())}`);
});

export const nurture_adminOverview = onCall(async (request) => {
  requireAdmin(request);
  await ensureDefaultCampaigns();
  const [campaigns, enrollments, deliveries] = await Promise.all([
    db.collection(CAMPAIGNS).get(),
    db.collection(ENROLLMENTS).get(),
    db.collection(DELIVERIES).get(),
  ]);
  const summary = { active: 0, completed: 0, failed: 0, suppressed: 0 };
  for (const doc of enrollments.docs) {
    const status = String(doc.data().status || "").toUpperCase();
    if (status === "ACTIVE") summary.active += 1;
    else if (status === "COMPLETED") summary.completed += 1;
    else if (status === "FAILED") summary.failed += 1;
    else if (status === "SUPPRESSED") summary.suppressed += 1;
  }
  const sent = deliveries.docs.filter((doc) => doc.data().status === "SENT").length;
  const deliveryFailures = deliveries.docs.filter((doc) => doc.data().status === "FAILED").length;
  return {
    campaigns: campaigns.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    summary,
    deliveries: { sent, failed: deliveryFailures },
  };
});

export const nurture_adminSetCampaignStatus = onCall(async (request) => {
  const uid = requireAdmin(request);
  const { campaignId, status } = request.data as { campaignId?: string; status?: CampaignStatus };
  if (!campaignId || (status !== "ACTIVE" && status !== "PAUSED")) {
    throw new HttpsError("invalid-argument", "campaignId and a valid status are required.");
  }
  const ref = db.collection(CAMPAIGNS).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Campaign not found.");
  await ref.set({ status, updatedAt: Date.now(), updatedBy: uid }, { merge: true });
  return { success: true, campaignId, status };
});

export const nurture_unsubscribe = onCall(async (request) => {
  const token = String((request.data as { token?: string })?.token || "").trim();
  if (token.length < 20) throw new HttpsError("invalid-argument", "A valid preference token is required.");
  const target = await db.collection(ENROLLMENTS).where("unsubscribeToken", "==", token).limit(1).get();
  if (target.empty) throw new HttpsError("not-found", "Preference link not found or expired.");
  const enrollment = target.docs[0].data() as Enrollment;
  const now = Date.now();
  const sameEmail = await db.collection(ENROLLMENTS).where("emailHash", "==", enrollment.emailHash).get();
  const batch = db.batch();
  batch.set(db.collection(SUPPRESSIONS).doc(enrollment.emailHash), {
    emailHash: enrollment.emailHash,
    email: enrollment.email,
    reason: "unsubscribe",
    createdAt: now,
  }, { merge: true });
  for (const doc of sameEmail.docs) batch.set(doc.ref, { status: "SUPPRESSED", updatedAt: now }, { merge: true });
  if (enrollment.uid) batch.set(db.collection("users").doc(enrollment.uid), { marketingOptOut: true, updatedAt: now }, { merge: true });
  await batch.commit();
  return { success: true };
});

export const nurture_updateMyPreferences = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const marketingOptOut = Boolean((request.data as { marketingOptOut?: boolean })?.marketingOptOut);
  const userRef = db.collection("users").doc(request.auth.uid);
  const userSnap = await userRef.get();
  const email = normalizeEmail(userSnap.data()?.email || request.auth.token.email);
  const emailHash = isValidEmail(email) ? stableHash(email) : "";
  await userRef.set({ marketingOptOut, updatedAt: Date.now() }, { merge: true });
  if (emailHash) {
    const suppressionRef = db.collection(SUPPRESSIONS).doc(emailHash);
    if (marketingOptOut) {
      await suppressionRef.set({ emailHash, email, reason: "account_preference", createdAt: Date.now() }, { merge: true });
    } else {
      await suppressionRef.delete().catch(() => undefined);
    }
  }
  return { success: true, marketingOptOut };
});
