import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { beforeUserCreated } from "firebase-functions/v2/identity";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { handleStripeWebhook, createPayment, updatePaymentStatus, getTierById, StripeProvider, QuickBooksLinkProvider, QuickBooksPaymentsProvider, getAuthorizationUrl, exchangeCodeForTokens, isQuickBooksConnected, createQuickBooksInvoice, getInvoiceStatus, mapInvoiceStatusToPaymentStatus, queryPayments, ensureIdempotent, markWebhookResult, syncPaymentToQBO, backfillPaymentsToQBO } from "./payments";

// Secrets (set via `firebase functions:secrets:set <KEY>`)
const recaptchaSecret = defineSecret("RECAPTCHA_SECRET_KEY");
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const intuitClientId = defineSecret("INTUIT_CLIENT_ID");
const intuitClientSecret = defineSecret("INTUIT_CLIENT_SECRET");

// MIRROR of @hi/shared userRoleSchema — kept inline because @hi/shared is ESM-only.
// Keep in sync with: packages/shared/src/index.ts → userRoleSchema
const VALID_ROLES = ["master", "admin", "staff", "member", "externalVendor", "econPartner"] as const;
type UserRole = (typeof VALID_ROLES)[number];

admin.initializeApp();
const db = admin.firestore();

// --- Types & Constants ---

// MIRROR of @hi/shared RESOURCE_CATALOG — kept inline because @hi/shared is ESM-only.
// Keep in sync with: packages/shared/src/index.ts → RESOURCE_CATALOG
const RESOURCE_CONFIG: Record<string, {
  name: string;
  type: "SEAT" | "MODE";
  guestRateHourly: number;
  exclusiveGroupId: string;
  capacity: number;
}> = {
  "seat-1": { name: "Seat 1", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-2": { name: "Seat 2", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-3": { name: "Seat 3", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-4": { name: "Seat 4", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-5": { name: "Seat 5", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-6": { name: "Seat 6", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "mode-conference": { name: "Conference Room", type: "MODE", guestRateHourly: 75, exclusiveGroupId: "main_space", capacity: 10 },
};

interface CreateBookingInput {
  resourceId: string;
  start: number; // timestamp
  end: number;   // timestamp
  userId?: string; // Optional if we trust the context auth, but good to have for admin overrides
}

// --- Helpers ---

// Check if two time ranges overlap
const isOverlapping = (startA: number, endA: number, startB: number, endB: number) => {
  return startA < endB && endA > startB;
};

/**
 * Provision membership entitlements for a user.
 * Sets membershipStatus to "active", assigns the plan, and sets a 35-day expiry.
 */
async function provisionMembership(uid: string, plan: string): Promise<void> {
  const now = Date.now();
  const expiresAt = now + 35 * 24 * 60 * 60 * 1000;
  await db.collection("users").doc(uid).update({
    membershipStatus: "active",
    plan,
    expiresAt,
    updatedAt: now,
  });
  logger.info("Membership provisioned", { uid, plan, expiresAt });
}

import { allocateMonthlyCredits } from "./scheduled/monthlyAllocations";
import { rfx_publish, rfx_backfillGeo } from "./rfx";
import { referral_create, referral_convert, referral_markPaid, referral_accept, referral_decline, referral_createPayoutCheckout } from "./referrals";
import { onReferralWritten } from "./triggers/referralTriggers";
import {
  events_createTicketCheckout,
  events_createSponsorshipCheckout,
  events_registerFree,
  events_cancelRegistration,
  events_joinWaitlist,
} from "./events";
import { events_upsertSeries, events_extendHorizon, events_setSeriesOccurrenceOverride } from "./eventSeries";
import {
  events_enqueueCampaignJobs,
  events_processCampaignJobs,
  events_generateShareKits,
  events_processSocialPosts,
} from "./eventMarketing";
import { events_onMediaUploaded } from "./eventMedia";
import { bookstore_createCheckoutSession } from "./bookstore";
import { bookstore_getDownloadLink } from "./digitalFulfillment";
import {
  territory_create,
  territory_update,
  territory_list_released,
  territory_release_scheduled,
} from "./territories";
import { enrichment_search, enrichment_link } from "./enrichment";
import { verification_submit, verification_review, verification_flag } from "./verification";
import {
  team_create,
  team_invite,
  team_respond_invite,
  team_manage_member,
} from "./teaming";
import {
  rfx_refreshSuggestions,
  rfx_refreshSuggestions_scheduled,
} from "./rfxSuggestions";
import { access_expireGrants, access_noShowRevoke } from "./scheduled/accessCleanup";
import {
  createAccessGrant,
  access_getMyGrants,
  access_adminRevoke,
  access_adminUnlock,
  access_adminResendPin,
  access_adminGetDoorStatus,
  access_seamWebhook,
} from "./access";

// --- Exports ---

// Scheduled Functions
export { allocateMonthlyCredits };
export { rfx_refreshSuggestions_scheduled };
export { access_expireGrants, access_noShowRevoke };

// Firestore Triggers
export { onReferralWritten };

// Access Control Functions
export {
  access_getMyGrants,
  access_adminRevoke,
  access_adminUnlock,
  access_adminResendPin,
  access_adminGetDoorStatus,
  access_seamWebhook,
};

// RFx Functions
export { rfx_publish };
export { rfx_backfillGeo };
export { rfx_refreshSuggestions };

// Referral Functions
export { referral_create, referral_convert, referral_markPaid, referral_accept, referral_decline, referral_createPayoutCheckout };

// Event Functions
export {
  events_createTicketCheckout,
  events_createSponsorshipCheckout,
  events_registerFree,
  events_cancelRegistration,
  events_joinWaitlist,
  events_upsertSeries,
  events_extendHorizon,
  events_setSeriesOccurrenceOverride,
  events_enqueueCampaignJobs,
  events_processCampaignJobs,
  events_generateShareKits,
  events_processSocialPosts,
  events_onMediaUploaded,
};

// Bookstore Functions
export { bookstore_createCheckoutSession, bookstore_getDownloadLink };

// Territory / Enrichment / Verification Functions
export {
  territory_create,
  territory_update,
  territory_list_released,
  territory_release_scheduled,
  enrichment_search,
  enrichment_link,
  verification_submit,
  verification_review,
  verification_flag,
  team_create,
  team_invite,
  team_respond_invite,
  team_manage_member,
};

export const health = onCall(async () => {
  return { ok: true, timestamp: Date.now() };
});

export const createBookingQuote = onCall(async (request) => {
  const { resourceId, start, end } = request.data as CreateBookingInput;
  const uid = request.auth?.uid;

  if (!resourceId || !start || !end) {
    throw new HttpsError("invalid-argument", "Missing resourceId, start, or end");
  }

  const resource = RESOURCE_CONFIG[resourceId];
  if (!resource) {
    throw new HttpsError("not-found", "Resource not found");
  }

  // Determine rate based on user type and tier
  let userType: "guest" | "member" = "guest";
  let rate = resource.guestRateHourly;

  if (uid && resource.type === "SEAT") {
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (userData?.membershipStatus === "active" && userData?.plan) {
      const tier = getTierById(userData.plan);
      if (tier) {
        userType = "member";
        rate = tier.extraHourlyRateCents / 100;
      }
    }
  }

  const durationHours = (end - start) / (1000 * 60 * 60);
  const total = Math.round(durationHours * rate * 100) / 100;

  return {
    resourceId,
    resourceName: resource.name,
    start,
    end,
    userType,
    hourlyRate: rate,
    durationHours,
    total,
    currency: "USD"
  };
});

export const createBooking = onCall(async (request) => {
  // 1. Auth & Input Validation
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be logged in to book");
  }
  const { resourceId, start, end } = request.data as CreateBookingInput;
  
  if (!resourceId || !start || !end) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }
  
  if (end <= start) {
    throw new HttpsError("invalid-argument", "End time must be after start time");
  }

  const targetResource = RESOURCE_CONFIG[resourceId];
  if (!targetResource) {
    throw new HttpsError("not-found", "Resource configuration not found");
  }

  const userId = request.auth.uid;
  const userName = request.auth.token.name || request.auth.token.email || "Member";

  // 2. Transaction for Slot Locking
  return await db.runTransaction(async (transaction) => {
    // A. Query potential conflicts
    // We need to check ANY booking that overlaps with our time window.
    // Firestore query limitations mean we usually query for bookings that start before our end time
    // and end after our start time.
    // Simpler query: get bookings ending AFTER our start time, then filter in memory.
    const bookingsRef = db.collection("bookings");
    const q = bookingsRef.where("end", ">", start); 
    const snapshot = await transaction.get(q);

    const conflicts: any[] = [];

    snapshot.docs.forEach((doc) => {
      const b = doc.data();
      // Filter out bookings that don't actually overlap (since query is only on 'end')
      if (!isOverlapping(start, end, b.start, b.end)) return;
      if (b.status === "CANCELLED") return;

      const conflictResId = b.resourceId;
      const conflictResConfig = RESOURCE_CONFIG[conflictResId];

      // Rule 1: Direct Resource Conflict
      if (conflictResId === resourceId) {
        conflicts.push({ type: "DIRECT", bookingId: doc.id });
        return;
      }

      // Rule 2: Mutual Exclusion (Modes vs Seats)
      // If we are in the same exclusive group (e.g. "main_space")
      if (conflictResConfig && targetResource.exclusiveGroupId === conflictResConfig.exclusiveGroupId) {
        
        // Scenario A: I am booking a MODE (e.g. Podcast)
        // -> I conflict with EVERYTHING else in this group (Seat or other Mode)
        if (targetResource.type === "MODE") {
          conflicts.push({ type: "GROUP_MODE_BLOCK", bookingId: doc.id });
        }
        
        // Scenario B: I am booking a SEAT
        // -> I conflict if the existing booking is a MODE
        else if (targetResource.type === "SEAT") {
          if (conflictResConfig.type === "MODE") {
            conflicts.push({ type: "GROUP_SEAT_BLOCKED_BY_MODE", bookingId: doc.id });
          }
        }
      }
    });

    if (conflicts.length > 0) {
      logger.info(`Booking conflict for ${resourceId} at ${start}-${end}`, { conflicts });
      throw new HttpsError("failed-precondition", "Slot is not available.", { conflicts });
    }

    // B. Calculate Price (Recalculate to be safe)
    let rate = targetResource.guestRateHourly;
    if (targetResource.type === "SEAT") {
      const userSnap = await transaction.get(db.collection("users").doc(userId));
      const userData = userSnap.data();
      if (userData?.membershipStatus === "active" && userData?.plan) {
        const tier = getTierById(userData.plan);
        if (tier) rate = tier.extraHourlyRateCents / 100;
      }
    }
    const durationHours = (end - start) / (1000 * 60 * 60);
    const totalPrice = Math.round(durationHours * rate * 100) / 100;

    // C. Write Booking
    const newBookingRef = bookingsRef.doc();
    const newBooking = {
      id: newBookingRef.id,
      resourceId,
      resourceName: targetResource.name,
      userId,
      userName,
      start,
      end,
      status: "CONFIRMED",
      totalPrice,
      paymentMethod: "STRIPE", // Default
      createdAt: Date.now()
    };

    transaction.set(newBookingRef, newBooking);

    return { success: true, bookingId: newBookingRef.id, booking: newBooking };
  }).then(async (result) => {
    // Trigger access grant creation after booking is committed (non-blocking to the booking response)
    createAccessGrant(
      result.bookingId,
      resourceId,
      userId,
      start,
      end
    ).catch((err) => {
      logger.error("createAccessGrant failed after booking", {
        bookingId: result.bookingId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return result;
  });
});

// --- Auth Triggers (PR-02) ---

export const authBeforeCreate = beforeUserCreated(async (event) => {
  const user = event.data;
  logger.info(`Creating user doc for ${user.uid} (${user.email})`);

  const now = Date.now();
  const userDoc = {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    role: "member" as UserRole,
    membershipStatus: "none",
    createdAt: now,
  };

  await db.collection("users").doc(user.uid).set(userDoc);

  // Set initial custom claims — role only (entitlements stay in Firestore)
  return {
    customClaims: { role: "member" },
  };
});

// --- Admin: Set User Role (PR-02) ---

interface SetUserRoleInput {
  targetUid: string;
  role: string;
}

export const setUserRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const callerRole = request.auth.token.role as string | undefined;
  if (callerRole !== "admin" && callerRole !== "master") {
    throw new HttpsError("permission-denied", "Only admin or master users can set roles");
  }

  const { targetUid, role } = request.data as SetUserRoleInput;

  if (!targetUid || !role) {
    throw new HttpsError("invalid-argument", "targetUid and role are required");
  }

  if (!VALID_ROLES.includes(role as UserRole)) {
    throw new HttpsError("invalid-argument", `Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(", ")}`);
  }

  // Prevent non-master from assigning master role
  if (role === "master" && callerRole !== "master") {
    throw new HttpsError("permission-denied", "Only master users can assign the master role");
  }

  logger.info(`Setting role for ${targetUid} to ${role} (by ${request.auth.uid})`);

  // Update custom claims
  await admin.auth().setCustomUserClaims(targetUid, { role });

  // Mirror role in Firestore user doc
  await db.collection("users").doc(targetUid).update({
    role,
    updatedAt: Date.now(),
  });

  return { success: true, uid: targetUid, role };
});

// --- Leads (PR-04) ---

// Allowed origins for CORS (Coming Soon Page)
const ALLOWED_ORIGINS = [
  "https://jonathanholman.github.io",
  "https://hi-coworking-plat.web.app",
  "https://hi-coworking.com",
  "https://www.hi-coworking.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function setCorsHeaders(req: any, res: any): boolean {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

async function verifyRecaptcha(token: string, secretKey: string): Promise<{ success: boolean; score: number }> {
  const url = "https://www.google.com/recaptcha/api/siteverify";
  const params = new URLSearchParams({ secret: secretKey, response: token });

  const resp = await fetch(`${url}?${params.toString()}`, { method: "POST" });
  const data = await resp.json() as { success: boolean; score?: number; "error-codes"?: string[] };

  if (!data.success) {
    logger.warn("reCAPTCHA verification failed", { errors: data["error-codes"] });
    return { success: false, score: 0 };
  }
  return { success: true, score: data.score ?? 0 };
}

/**
 * HTTP Cloud Function: accepts POST from Coming Soon Page.
 * Verifies reCAPTCHA v3 token, then writes to leads/{leadId}.
 * Replaces the Google Apps Script (code.gs) backend.
 */
export const leads_submitLead = onRequest(
  { secrets: [recaptchaSecret], cors: false },
  async (req, res) => {
    // CORS
    if (setCorsHeaders(req, res)) return;

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const body = req.body;

      // --- Validate required fields ---
      if (!body.email || !body.name) {
        res.status(400).json({ error: "name and email are required" });
        return;
      }

      // --- reCAPTCHA v3 verification ---
      const recaptchaToken = body.recaptchaToken as string | undefined;
      if (!recaptchaToken) {
        res.status(400).json({ error: "reCAPTCHA token is required" });
        return;
      }

      const secret = recaptchaSecret.value();
      const captchaResult = await verifyRecaptcha(recaptchaToken, secret);

      if (!captchaResult.success || captchaResult.score < 0.3) {
        logger.warn("Lead rejected by reCAPTCHA", { score: captchaResult.score, email: body.email });
        res.status(403).json({ error: "Spam check failed. Please try again." });
        return;
      }

      // --- Compute interest score (mirrors code.gs logic) ---
      let interestScore = 1;
      const interests = Array.isArray(body.interests) ? body.interests : [];
      interestScore += interests.length;
      if (body.message && body.message.length > 5) interestScore += 2;

      // --- Write to Firestore ---
      const leadRef = db.collection("leads").doc();
      const leadDoc = {
        id: leadRef.id,
        name: body.name,
        email: body.email,
        interests,
        message: body.message || "",
        intent: body.intent || "",
        source: body.source || "coming-soon-page",
        version: body.submission_version || "2.0",
        interestScore,
        type: body.type || "early_access",  // "early_access" or "survey"
        surveyAnswers: body.answers || null, // Survey data if type === "survey"
        recaptchaScore: captchaResult.score,
        createdAt: Date.now(),
      };

      await leadRef.set(leadDoc);

      logger.info("Lead created", { id: leadRef.id, email: body.email, score: captchaResult.score });
      res.status(200).json({ status: "success", id: leadRef.id });
    } catch (err) {
      logger.error("leads_submitLead error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * Firestore trigger: fires when a new lead is created.
 * Logs to admin feed (email notification can be added via SendGrid later).
 */
export const leads_onNewLead = onDocumentCreated("leads/{leadId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const lead = snap.data();
  logger.info("New lead received", {
    id: snap.id,
    name: lead.name,
    email: lead.email,
    type: lead.type,
    interestScore: lead.interestScore,
    source: lead.source,
  });

  // TODO (PR-14): Send email notification to admin via SendGrid
  // TODO (PR-14): Create notification doc in notifications/{adminUid}/{notifId}
});

/**
 * Callable: Submit a contact form message from the platform contact page.
 * Writes to leads/{leadId} with type "contact".
 */
export const leads_submitContact = onCall(async (request) => {
  const { name, email, message, source } = request.data as {
    name: string;
    email: string;
    message: string;
    source?: string;
  };

  if (!name || !email) {
    throw new HttpsError("invalid-argument", "Name and email are required");
  }

  const leadRef = db.collection("leads").doc();
  await leadRef.set({
    id: leadRef.id,
    name,
    email,
    message: message || "",
    source: source || "contact_page",
    type: "contact",
    interests: [],
    interestScore: 0,
    createdAt: Date.now(),
    uid: request.auth?.uid || null,
  });

  logger.info("Contact form lead created", { id: leadRef.id, email });

  return { success: true, id: leadRef.id };
});

// --- Stripe Payments (PR-10) ---

interface CreateCheckoutInput {
  tierId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Callable: Create a Stripe Checkout Session for a membership subscription.
 * The frontend redirects the user to the returned URL.
 */
export const stripe_createCheckoutSession = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { tierId, successUrl, cancelUrl } = request.data as CreateCheckoutInput;

    if (!tierId || !successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "tierId, successUrl, and cancelUrl are required");
    }

    const tier = getTierById(tierId);
    if (!tier) {
      throw new HttpsError("not-found", `Unknown tier: ${tierId}`);
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email || "";

    // Create a pending payment in the ledger first
    const payment = await createPayment({
      uid,
      provider: "stripe",
      amount: tier.amountCents,
      currency: tier.currency,
      purpose: "membership",
      purposeRefId: tier.id,
      status: "pending",
    });

    // Create Stripe checkout session
    const provider = new StripeProvider(
      stripeSecretKey.value(),
      stripeWebhookSecret.value()
    );

    const session = await provider.createCheckoutSession({
      uid,
      amount: tier.amountCents,
      currency: tier.currency,
      purpose: "membership",
      purposeRefId: tier.id,
      successUrl,
      cancelUrl,
      metadata: {
        email,
        stripePriceId: tier.stripePriceId,
        paymentId: payment.id,
        plan: tier.id,
      },
    });

    logger.info("Checkout session created", {
      uid,
      tierId,
      sessionId: session.sessionId,
      paymentId: payment.id,
    });

    return {
      sessionId: session.sessionId,
      url: session.url,
      paymentId: payment.id,
    };
  }
);

/**
 * HTTP endpoint: Stripe webhook receiver.
 * Must be configured as the webhook endpoint in the Stripe Dashboard.
 * URL: https://<region>-<project>.cloudfunctions.net/stripe_webhook
 */
export const stripe_webhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret, intuitClientId, intuitClientSecret], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const result = await handleStripeWebhook(
      req.rawBody as Buffer,
      req.headers as Record<string, string>,
      stripeSecretKey.value(),
      stripeWebhookSecret.value(),
      intuitClientId.value(),
      intuitClientSecret.value()
    );

    res.status(result.status).json(result.body);
  }
);

// --- QuickBooks Payment Links (PR-11) ---

interface QBCheckoutInput {
  productId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Callable: Create a QuickBooks payment link checkout.
 * Looks up the product's QB payment link URL and creates a pending payment.
 */
export const qb_createCheckout = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const { productId, successUrl, cancelUrl } = request.data as QBCheckoutInput;

  if (!productId || !successUrl) {
    throw new HttpsError("invalid-argument", "productId and successUrl are required");
  }

  const uid = request.auth.uid;

  // Fetch product to get amount and QB link
  const productSnap = await db.collection("products").doc(productId).get();
  if (!productSnap.exists) {
    throw new HttpsError("not-found", "Product not found");
  }

  const product = productSnap.data()!;
  if (!product.quickbooksPaymentLinkUrl) {
    throw new HttpsError("failed-precondition", "This product does not have a QuickBooks payment link configured");
  }

  // Create a pending payment in the ledger
  const payment = await createPayment({
    uid,
    provider: "quickbooks_link",
    amount: product.amount || 0,
    currency: product.currency || "USD",
    purpose: product.purpose || "other",
    purposeRefId: productId,
    status: "pending",
    providerRefs: { productId },
  });

  // Create the QB checkout session
  const provider = new QuickBooksLinkProvider();
  const session = await provider.createCheckoutSession({
    uid,
    amount: product.amount || 0,
    currency: product.currency || "USD",
    purpose: product.purpose || "other",
    purposeRefId: productId,
    successUrl,
    cancelUrl,
    metadata: { productId },
  });

  logger.info("QB Link checkout created", {
    uid,
    productId,
    paymentId: payment.id,
  });

  return {
    sessionId: session.sessionId,
    url: session.url,
    paymentId: payment.id,
  };
});

// --- Admin: Mark Payment Paid / Update Status (PR-11) ---

interface AdminMarkPaymentInput {
  paymentId: string;
  newStatus: "paid" | "failed" | "refunded";
  note?: string;
}

/**
 * Callable: Admin marks a payment as paid (or failed/refunded).
 * Creates an audit trail entry in paymentAudit/{auditId}.
 * On "paid" for membership purpose → provisions entitlements.
 */
export const admin_markPaymentStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const callerRole = request.auth.token.role as string | undefined;
  if (callerRole !== "admin" && callerRole !== "master") {
    throw new HttpsError("permission-denied", "Only admin or master users can mark payments");
  }

  const { paymentId, newStatus, note } = request.data as AdminMarkPaymentInput;

  if (!paymentId || !newStatus) {
    throw new HttpsError("invalid-argument", "paymentId and newStatus are required");
  }

  if (!["paid", "failed", "refunded"].includes(newStatus)) {
    throw new HttpsError("invalid-argument", "newStatus must be paid, failed, or refunded");
  }

  // Fetch current payment
  const paymentSnap = await db.collection("payments").doc(paymentId).get();
  if (!paymentSnap.exists) {
    throw new HttpsError("not-found", "Payment not found");
  }

  const payment = paymentSnap.data()!;
  const previousStatus = payment.status;

  // Update payment status
  await updatePaymentStatus(paymentId, newStatus);

  // Create audit trail entry
  const auditRef = db.collection("paymentAudit").doc();
  const auditEntry = {
    id: auditRef.id,
    paymentId,
    action: newStatus === "paid" ? "mark_paid" : newStatus === "refunded" ? "refund" : "mark_failed",
    performedBy: request.auth.uid,
    note: note || "",
    previousStatus,
    newStatus,
    createdAt: Date.now(),
  };
  await auditRef.set(auditEntry);

  // If marking as paid for a membership → provision entitlements
  if (newStatus === "paid" && payment.purpose === "membership" && payment.uid) {
    await provisionMembership(payment.uid, payment.purposeRefId || "other");
  }

  logger.info("Payment status updated by admin", {
    paymentId,
    previousStatus,
    newStatus,
    adminUid: request.auth.uid,
  });

  return { success: true, paymentId, previousStatus, newStatus, auditId: auditRef.id };
});

// --- QuickBooks Invoice Flow (PR-12) ---

/**
 * Callable: Get the Intuit OAuth authorization URL.
 * Admin clicks this to connect QuickBooks.
 */
export const intuit_getAuthUrl = onCall(
  { secrets: [intuitClientId] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role as string | undefined;
    if (callerRole !== "admin" && callerRole !== "master") {
      throw new HttpsError("permission-denied", "Only admin users can connect QuickBooks");
    }

    const { redirectUri } = request.data as { redirectUri: string };
    if (!redirectUri) {
      throw new HttpsError("invalid-argument", "redirectUri is required");
    }

    const state = `hi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = getAuthorizationUrl(intuitClientId.value(), redirectUri, state);

    return { url, state };
  }
);

/**
 * HTTP endpoint: Intuit OAuth callback.
 * Receives the authorization code and exchanges it for tokens.
 */
export const intuit_oauthCallback = onRequest(
  { secrets: [intuitClientId, intuitClientSecret], cors: false },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const code = req.query.code as string;
    const realmId = req.query.realmId as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      logger.warn("Intuit OAuth error", { error });
      res.status(400).send(`<html><body><h2>QuickBooks connection failed</h2><p>${error}</p><p>You can close this window.</p></body></html>`);
      return;
    }

    if (!code || !realmId) {
      res.status(400).send("<html><body><h2>Missing code or realmId</h2></body></html>");
      return;
    }

    try {
      const redirectUri = `https://${req.hostname}/${req.path}`.replace(/\/+$/, "");
      await exchangeCodeForTokens(
        code,
        redirectUri,
        intuitClientId.value(),
        intuitClientSecret.value(),
        realmId
      );

      res.status(200).send(
        '<html><body style="font-family:sans-serif;text-align:center;padding:60px">' +
        '<h2 style="color:#059669">QuickBooks Connected!</h2>' +
        '<p>You can close this window and return to the admin dashboard.</p>' +
        '</body></html>'
      );
    } catch (err) {
      logger.error("Intuit OAuth callback error", { err });
      res.status(500).send("<html><body><h2>Connection failed</h2><p>Please try again.</p></body></html>");
    }
  }
);

/**
 * Callable: Check if QuickBooks is connected.
 */
export const intuit_checkConnection = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }
  const connected = await isQuickBooksConnected();
  return { connected };
});

/**
 * Callable: Create a QuickBooks invoice for a payment.
 * Creates a pending payment in the ledger and a QBO invoice.
 */
export const payments_createQuickBooksInvoice = onCall(
  { secrets: [intuitClientId, intuitClientSecret] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { productId, customerEmail, customerName, memo } = request.data as {
      productId: string;
      customerEmail?: string;
      customerName?: string;
      memo?: string;
    };

    if (!productId) {
      throw new HttpsError("invalid-argument", "productId is required");
    }

    const uid = request.auth.uid;
    const email = customerEmail || request.auth.token.email || "";
    const name = customerName || request.auth.token.name || email;

    // Fetch product
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) {
      throw new HttpsError("not-found", "Product not found");
    }
    const product = productSnap.data()!;

    // Create pending payment in ledger
    const payment = await createPayment({
      uid,
      provider: "quickbooks_invoice",
      amount: product.amount || 0,
      currency: product.currency || "USD",
      purpose: product.purpose || "other",
      purposeRefId: productId,
      status: "pending",
      providerRefs: { productId },
    });

    // Create QBO invoice
    const amountDollars = (product.amount || 0) / 100;
    const invoice = await createQuickBooksInvoice(
      {
        customerEmail: email,
        customerName: name,
        lineItems: [
          {
            description: product.name || "Hi Coworking",
            amount: amountDollars,
            quantity: 1,
          },
        ],
        memo: memo || `Payment for ${product.name}`,
      },
      intuitClientId.value(),
      intuitClientSecret.value()
    );

    // Update payment with QB refs
    await updatePaymentStatus(payment.id, "pending", {
      providerRefs: {
        qbInvoiceId: invoice.invoiceId,
        qbInvoiceNumber: invoice.invoiceNumber,
        qbInvoiceUrl: invoice.invoiceUrl,
      },
    });

    logger.info("QB invoice created for payment", {
      paymentId: payment.id,
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
    });

    return {
      paymentId: payment.id,
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceUrl: invoice.invoiceUrl,
      totalAmount: invoice.totalAmount,
    };
  }
);

/**
 * Scheduled function: Poll pending QB invoices every hour.
 * Updates payment status when invoices are paid in QuickBooks.
 */
export const payments_pollQBInvoices = onSchedule(
  {
    schedule: "every 60 minutes",
    secrets: [intuitClientId, intuitClientSecret],
  },
  async () => {
    // Check if QB is connected before polling
    const connected = await isQuickBooksConnected();
    if (!connected) {
      logger.info("QB not connected, skipping invoice poll");
      return;
    }

    // Fetch all pending QB invoice payments
    const pendingPayments = await queryPayments({
      provider: "quickbooks_invoice",
      status: "pending",
      limitTo: 50,
    });

    if (pendingPayments.length === 0) {
      logger.info("No pending QB invoices to poll");
      return;
    }

    logger.info(`Polling ${pendingPayments.length} pending QB invoices`);

    let updated = 0;
    for (const payment of pendingPayments) {
      const invoiceId = payment.providerRefs?.qbInvoiceId;
      if (!invoiceId) continue;

      try {
        const invoiceStatus = await getInvoiceStatus(
          invoiceId,
          intuitClientId.value(),
          intuitClientSecret.value()
        );

        const newStatus = mapInvoiceStatusToPaymentStatus(invoiceStatus.status);
        if (newStatus !== payment.status) {
          await updatePaymentStatus(payment.id, newStatus);
          updated++;
          logger.info("QB invoice status updated", {
            paymentId: payment.id,
            invoiceId,
            oldStatus: payment.status,
            newStatus,
          });

          // If paid and purpose is membership, provision entitlements
          if (newStatus === "paid" && payment.purpose === "membership" && payment.uid) {
            await provisionMembership(payment.uid, payment.purposeRefId || "other");
          }
        }
      } catch (err) {
        logger.error("Failed to poll QB invoice", { paymentId: payment.id, invoiceId, err });
      }
    }

    logger.info(`QB invoice poll complete: ${updated} updated out of ${pendingPayments.length}`);
  }
);

// --- QuickBooks Payments API (PR-13) ---

/**
 * Callable: Charge a card via QB Payments API.
 * The frontend tokenizes the card using the QB.js SDK, then calls this
 * with the card token. Creates a payment in the ledger, charges the card,
 * and creates a Sales Receipt in QBO for accounting.
 */
export const qb_chargeCard = onCall(
  { secrets: [intuitClientId, intuitClientSecret] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }

    const { cardToken, productId, memo } = request.data as {
      cardToken: string;
      productId: string;
      memo?: string;
    };

    if (!cardToken || !productId) {
      throw new HttpsError("invalid-argument", "cardToken and productId are required");
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email || "";

    // Fetch product
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) {
      throw new HttpsError("not-found", "Product not found");
    }
    const product = productSnap.data()!;
    const amountDollars = (product.amount || 0) / 100;

    // Create pending payment in ledger
    const payment = await createPayment({
      uid,
      provider: "quickbooks_payments",
      amount: product.amount || 0,
      currency: product.currency || "USD",
      purpose: product.purpose || "other",
      purposeRefId: productId,
      status: "pending",
      providerRefs: { productId },
    });

    const provider = new QuickBooksPaymentsProvider(
      intuitClientId.value(),
      intuitClientSecret.value()
    );

    try {
      // Charge the card
      const charge = await provider.chargeCard({
        amount: amountDollars,
        currency: product.currency || "USD",
        cardToken,
        description: memo || product.name || "Hi Coworking Payment",
        customerEmail: email,
      });

      // Update payment with charge refs
      const newStatus = charge.status === "CAPTURED" ? "paid" : "failed";
      await updatePaymentStatus(payment.id, newStatus, {
        providerRefs: {
          qbChargeId: charge.chargeId,
          qbAuthCode: charge.authCode || "",
        },
      });

      // Create Sales Receipt for accounting association
      if (newStatus === "paid") {
        try {
          const receipt = await provider.createSalesReceipt(
            charge,
            email,
            product.name || "Hi Coworking Payment"
          );
          await updatePaymentStatus(payment.id, "paid", {
            accountingRefs: {
              qboSalesReceiptId: receipt.salesReceiptId,
            },
          });
        } catch (err) {
          // Non-fatal: payment succeeded but accounting entry failed
          logger.error("Failed to create sales receipt", { paymentId: payment.id, err });
        }

        // Provision membership if applicable
        if (product.purpose === "membership" && uid) {
          await provisionMembership(uid, productId);
        }
      }

      logger.info("QB Payments charge completed", {
        paymentId: payment.id,
        chargeId: charge.chargeId,
        status: newStatus,
      });

      return {
        paymentId: payment.id,
        chargeId: charge.chargeId,
        status: newStatus,
        amount: charge.amount,
      };
    } catch (err) {
      await updatePaymentStatus(payment.id, "failed");
      logger.error("QB Payments charge failed", { paymentId: payment.id, err });
      throw new HttpsError("internal", "Payment processing failed");
    }
  }
);

/**
 * Callable: Refund a QB Payments charge.
 * Admin-only — refunds the charge via QB Payments API and updates the ledger.
 */
export const qb_refundCharge = onCall(
  { secrets: [intuitClientId, intuitClientSecret] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role as string | undefined;
    if (callerRole !== "admin" && callerRole !== "master") {
      throw new HttpsError("permission-denied", "Only admin users can issue refunds");
    }

    const { paymentId, amount, note } = request.data as {
      paymentId: string;
      amount?: number;
      note?: string;
    };

    if (!paymentId) {
      throw new HttpsError("invalid-argument", "paymentId is required");
    }

    // Fetch payment
    const paymentSnap = await db.collection("payments").doc(paymentId).get();
    if (!paymentSnap.exists) {
      throw new HttpsError("not-found", "Payment not found");
    }
    const payment = paymentSnap.data()!;
    const chargeId = payment.providerRefs?.qbChargeId;
    if (!chargeId) {
      throw new HttpsError("failed-precondition", "No QB charge ID found on this payment");
    }

    const provider = new QuickBooksPaymentsProvider(
      intuitClientId.value(),
      intuitClientSecret.value()
    );

    const refundAmountDollars = amount !== undefined ? amount / 100 : undefined;
    const refund = await provider.refundCharge(chargeId, refundAmountDollars);

    await updatePaymentStatus(paymentId, "refunded", {
      providerRefs: {
        qbRefundId: refund.refundId,
      },
    });

    // Audit trail
    const auditRef = db.collection("paymentAudit").doc();
    await auditRef.set({
      id: auditRef.id,
      paymentId,
      action: "refund",
      performedBy: request.auth.uid,
      note: note || `QB Payments refund: ${refund.refundId}`,
      previousStatus: payment.status,
      newStatus: "refunded",
      createdAt: Date.now(),
    });

    logger.info("QB Payments refund completed", {
      paymentId,
      refundId: refund.refundId,
      amount: refund.amount,
    });

    return {
      paymentId,
      refundId: refund.refundId,
      amount: refund.amount,
      auditId: auditRef.id,
    };
  }
);

/**
 * HTTP endpoint: QuickBooks Payments webhook receiver.
 * Handles Intuit event notifications for payment status changes.
 * Uses ensureIdempotent() for de-duplication.
 */
export const qb_paymentsWebhook = onRequest(
  { secrets: [intuitClientId, intuitClientSecret], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const provider = new QuickBooksPaymentsProvider(
      intuitClientId.value(),
      intuitClientSecret.value()
    );

    let result;
    try {
      result = await provider.handleWebhook(
        req.rawBody as Buffer,
        req.headers as Record<string, string>
      );
    } catch (err) {
      logger.error("QB Payments webhook parse error", { err });
      res.status(400).json({ error: "Invalid webhook" });
      return;
    }

    if (result.action === "unknown") {
      res.status(200).json({ received: true, skipped: true });
      return;
    }

    // Idempotency check
    const isNew = await ensureIdempotent(result.eventId, "quickbooks_payments");
    if (!isNew) {
      res.status(200).json({ received: true, skipped: true });
      return;
    }

    try {
      // Look up payment by QB charge/entity ID if available
      const entityId = result.metadata?.entityId;
      if (entityId && result.status) {
        const payments = await queryPayments({
          provider: "quickbooks_payments",
          limitTo: 10,
        });
        const match = payments.find(
          (p) => p.providerRefs?.qbChargeId === entityId
        );
        if (match) {
          await updatePaymentStatus(match.id, result.status);
          logger.info("QB webhook updated payment", {
            paymentId: match.id,
            newStatus: result.status,
          });
        }
      }
      await markWebhookResult(result.eventId, "success");
    } catch (err) {
      logger.error("QB webhook processing error", { eventId: result.eventId, err });
      await markWebhookResult(result.eventId, `error: ${err}`);
    }

    res.status(200).json({ received: true });
  }
);

// --- QBO Accounting Sync (PR-14) ---

/**
 * Callable: Manually sync a single payment to QBO.
 * Admin can use this to retry a failed sync or sync an older payment.
 */
export const admin_syncPaymentToQBO = onCall(
  { secrets: [intuitClientId, intuitClientSecret] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role as string | undefined;
    if (callerRole !== "admin" && callerRole !== "master") {
      throw new HttpsError("permission-denied", "Only admin users can trigger QBO sync");
    }

    const { paymentId } = request.data as { paymentId: string };
    if (!paymentId) {
      throw new HttpsError("invalid-argument", "paymentId is required");
    }

    const result = await syncPaymentToQBO(
      paymentId,
      intuitClientId.value(),
      intuitClientSecret.value()
    );

    return result;
  }
);

/**
 * Callable: Backfill all paid payments missing QBO accounting refs.
 * Admin reconciliation tool — syncs up to `limit` payments at once.
 */
export const admin_backfillQBO = onCall(
  { secrets: [intuitClientId, intuitClientSecret] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role as string | undefined;
    if (callerRole !== "admin" && callerRole !== "master") {
      throw new HttpsError("permission-denied", "Only admin users can trigger QBO backfill");
    }

    const { limit: maxLimit } = request.data as { limit?: number };

    const result = await backfillPaymentsToQBO(
      intuitClientId.value(),
      intuitClientSecret.value(),
      maxLimit || 50
    );

    logger.info("Admin triggered QBO backfill", {
      adminUid: request.auth.uid,
      ...result,
    });

    return result;
  }
);

// --- Referral & Teaming (PR-16) ---

/**
 * Firestore trigger: when a referral doc is created with status "converted",
 * increment the referrer's referral count and send a notification.
 */
export const referral_onStatusChange = onDocumentCreated(
  "referrals/{referralId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const referral = snap.data();
    if (referral.status !== "converted") return;

    const referrerUid = referral.referrerUid as string;
    if (!referrerUid) return;

    try {
      await db.collection("users").doc(referrerUid).update({
        "stats.referralCount": admin.firestore.FieldValue.increment(1),
        updatedAt: Date.now(),
      });

      await createNotification({
        uid: referrerUid,
        type: "referral",
        title: "Referral converted!",
        body: `Your referral to ${referral.referredEmail} has converted.`,
        linkTo: "/referrals",
      });

      logger.info("Referral conversion notification sent", {
        referralId: event.params.referralId,
        referrerUid,
        referredEmail: referral.referredEmail,
      });
    } catch (err) {
      logger.error("Failed to process referral conversion", {
        referralId: event.params.referralId,
        err,
      });
    }
  }
);

/**
 * Callable: Create an RFx team invite.
 * Creates the invite doc and notifies the invitee.
 */
export const rfx_createTeamInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const { rfxId, inviteeUid, inviteeName, role, note } = request.data as {
    rfxId: string;
    inviteeUid: string;
    inviteeName?: string;
    role?: string;
    note?: string;
  };

  if (!rfxId || !inviteeUid) {
    throw new HttpsError("invalid-argument", "rfxId and inviteeUid are required");
  }

  const inviteRef = db.collection("rfxTeamInvites").doc();
  const invite = {
    id: inviteRef.id,
    rfxId,
    inviterUid: request.auth.uid,
    inviteeUid,
    inviteeName: inviteeName || "",
    role: role || "partner",
    status: "pending",
    note: note || "",
    createdAt: Date.now(),
  };

  await inviteRef.set(invite);

  await createNotification({
    uid: inviteeUid,
    type: "system",
    title: "Team invitation received",
    body: `You've been invited to join an RFx team as ${role || "partner"}.`,
    linkTo: "/referrals?tab=team",
  });

  logger.info("RFx team invite created", {
    inviteId: inviteRef.id,
    rfxId,
    inviterUid: request.auth.uid,
    inviteeUid,
  });

  return { inviteId: inviteRef.id };
});

// --- Corporate Org (PR-17) ---

/**
 * Callable: Create a new organization.
 * Creates the org doc and adds the caller as owner.
 */
export const org_create = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const { name, slug, website, address, billingEmail, seats } = request.data as {
    name: string;
    slug: string;
    website?: string;
    address?: string;
    billingEmail?: string;
    seats?: number;
  };

  if (!name?.trim() || !slug?.trim()) {
    throw new HttpsError("invalid-argument", "name and slug are required");
  }

  // Check slug uniqueness
  const existing = await db.collection("orgs").where("slug", "==", slug.trim()).limit(1).get();
  if (!existing.empty) {
    throw new HttpsError("already-exists", "An org with that slug already exists");
  }

  const orgRef = db.collection("orgs").doc();
  const orgDoc = {
    id: orgRef.id,
    name: name.trim(),
    slug: slug.trim().toLowerCase(),
    ownerUid: request.auth.uid,
    website: website?.trim() || "",
    address: address?.trim() || "",
    billingEmail: billingEmail?.trim() || "",
    seatsPurchased: seats || 5,
    seatsUsed: 1,
    status: "active",
    createdAt: Date.now(),
  };

  const memberDoc = {
    id: `${orgRef.id}_${request.auth.uid}`,
    orgId: orgRef.id,
    uid: request.auth.uid,
    role: "owner",
    joinedAt: Date.now(),
  };

  const batch = db.batch();
  batch.set(orgRef, orgDoc);
  batch.set(db.collection("orgMembers").doc(memberDoc.id), memberDoc);
  await batch.commit();

  logger.info("Organization created", { orgId: orgRef.id, ownerUid: request.auth.uid });

  return { orgId: orgRef.id };
});

/**
 * Callable: Purchase additional seats for an organization.
 * In a real implementation this would create a payment via the payment abstraction.
 * For now it increments seatsPurchased directly.
 */
export const org_purchaseSeats = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const { orgId, seats } = request.data as { orgId: string; seats: number };

  if (!orgId || !seats || seats < 1) {
    throw new HttpsError("invalid-argument", "orgId and seats (>= 1) are required");
  }

  // Verify caller is org owner or admin
  const memberSnap = await db.collection("orgMembers")
    .doc(`${orgId}_${request.auth.uid}`)
    .get();

  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "Not a member of this organization");
  }

  const memberRole = memberSnap.data()?.role;
  if (memberRole !== "owner" && memberRole !== "admin") {
    throw new HttpsError("permission-denied", "Only org owners/admins can purchase seats");
  }

  await db.collection("orgs").doc(orgId).update({
    seatsPurchased: admin.firestore.FieldValue.increment(seats),
    updatedAt: Date.now(),
  });

  logger.info("Seats purchased", { orgId, seats, purchasedBy: request.auth.uid });

  return { success: true };
});

// --- Notifications (PR-18) ---

/**
 * Helper: create a notification document in the top-level notifications collection.
 */
async function createNotification(params: {
  uid: string;
  type: "rfx_new" | "rfx_response" | "referral" | "event_registration" | "payment" | "system";
  title: string;
  body: string;
  linkTo?: string;
}): Promise<void> {
  const ref = db.collection("notifications").doc();
  await ref.set({
    id: ref.id,
    uid: params.uid,
    type: params.type,
    title: params.title,
    body: params.body,
    linkTo: params.linkTo || "",
    read: false,
    createdAt: Date.now(),
  });
}

/**
 * Firestore trigger: when a new RFx is created, notify all members.
 */
export const notify_rfxCreated = onDocumentCreated(
  "rfx/{rfxId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const rfx = snap.data();
    const title = rfx.title || "New RFx";

    // Notify all users with role member/admin (simplified: get all users)
    try {
      const usersSnap = await db.collection("users").limit(200).get();
      const promises = usersSnap.docs
        .filter((u) => u.id !== rfx.createdBy)
        .map((u) =>
          createNotification({
            uid: u.id,
            type: "rfx_new",
            title: "New RFx Posted",
            body: `"${title}" was just posted. Check it out!`,
            linkTo: `/rfx/detail?id=${event.params.rfxId}`,
          })
        );
      await Promise.all(promises);
      logger.info("RFx creation notifications sent", { rfxId: event.params.rfxId, count: promises.length });
    } catch (err) {
      logger.error("Failed to send rfx notifications", { err });
    }
  }
);

/**
 * Firestore trigger: when a new RFx response is created, notify the RFx owner.
 */
export const notify_rfxResponse = onDocumentCreated(
  "rfxResponses/{responseId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const response = snap.data();
    const rfxId = response.rfxId as string;

    try {
      const rfxSnap = await db.collection("rfx").doc(rfxId).get();
      if (!rfxSnap.exists) return;
      const rfx = rfxSnap.data()!;

      await createNotification({
        uid: rfx.createdBy,
        type: "rfx_response",
        title: "New RFx Response",
        body: `Someone responded to your RFx "${rfx.title || ""}".`,
        linkTo: `/rfx/detail?id=${rfxId}`,
      });
      logger.info("RFx response notification sent", { rfxId, responseId: event.params.responseId });
    } catch (err) {
      logger.error("Failed to send rfx response notification", { err });
    }
  }
);

/**
 * Firestore trigger: when a referral status changes to "converted",
 * notify the referrer. (Supplements the existing referral_onStatusChange.)
 */
export const notify_referralUpdate = onDocumentCreated(
  "referrals/{referralId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const referral = snap.data();

    // Only notify on initial creation (status = pending) to the referred person
    if (referral.status === "pending" && referral.referredEmail) {
      // Look up user by email
      try {
        const userSnap = await db.collection("users")
          .where("email", "==", referral.referredEmail)
          .limit(1)
          .get();

        if (!userSnap.empty) {
          await createNotification({
            uid: userSnap.docs[0].id,
            type: "referral",
            title: "You've been referred!",
            body: "Someone referred you to Hi Coworking. Check your referrals.",
            linkTo: "/referrals",
          });
        }
      } catch (err) {
        logger.error("Failed to send referral notification", { err });
      }
    }
  }
);

/**
 * Firestore trigger: when someone registers for an event, notify the event creator.
 */
export const notify_eventRegistration = onDocumentCreated(
  "events/{eventId}/registrations/{uid}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const registration = snap.data();
    const eventId = event.params.eventId;

    try {
      const eventSnap = await db.collection("events").doc(eventId).get();
      if (!eventSnap.exists) return;
      const eventDoc = eventSnap.data()!;

      if (eventDoc.createdBy && eventDoc.createdBy !== registration.uid) {
        await createNotification({
          uid: eventDoc.createdBy,
          type: "event_registration",
          title: "New Event Registration",
          body: `${registration.displayName || "Someone"} registered for "${eventDoc.title || "your event"}".`,
          linkTo: `/events/detail?id=${eventId}`,
        });
      }
      logger.info("Event registration notification sent", { eventId, registrantUid: event.params.uid });
    } catch (err) {
      logger.error("Failed to send event registration notification", { err });
    }
  }
);

/**
 * Firestore trigger: when a payment is created, notify the payer.
 */
export const notify_paymentCreated = onDocumentCreated(
  "payments/{paymentId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const payment = snap.data();

    try {
      await createNotification({
        uid: payment.uid,
        type: "payment",
        title: "Payment Received",
        body: `Your ${payment.purpose} payment of $${((payment.amount || 0) / 100).toFixed(2)} has been recorded.`,
        linkTo: "/dashboard",
      });
      logger.info("Payment notification sent", { paymentId: event.params.paymentId });
    } catch (err) {
      logger.error("Failed to send payment notification", { err });
    }
  }
);
