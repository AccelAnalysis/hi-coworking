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
exports.stripe_webhook = exports.stripe_createCheckoutSession = exports.leads_submitContact = exports.leads_onNewLead = exports.leads_submitLead = exports.setUserRole = exports.authBeforeCreate = exports.createBooking = exports.createBookingQuote = exports.health = exports.team_manage_member = exports.team_respond_invite = exports.team_invite = exports.team_create = exports.verification_flag = exports.verification_review = exports.verification_submit = exports.enrichment_link = exports.enrichment_search = exports.territory_release_scheduled = exports.territory_list_released = exports.territory_update = exports.territory_create = exports.bookstore_getDownloadLink = exports.bookstore_createCheckoutSession = exports.events_onMediaUploaded = exports.events_processSocialPosts = exports.events_generateShareKits = exports.events_processCampaignJobs = exports.events_enqueueCampaignJobs = exports.events_setSeriesOccurrenceOverride = exports.events_extendHorizon = exports.events_upsertSeries = exports.events_joinWaitlist = exports.events_cancelRegistration = exports.events_registerFree = exports.events_createSponsorshipCheckout = exports.events_createTicketCheckout = exports.referral_createPayoutCheckout = exports.referral_decline = exports.referral_accept = exports.referral_markPaid = exports.referral_convert = exports.referral_create = exports.rfx_refreshSuggestions = exports.rfx_backfillGeo = exports.rfx_publish = exports.onReferralWritten = exports.rfx_refreshSuggestions_scheduled = exports.allocateMonthlyCredits = void 0;
exports.notify_paymentCreated = exports.notify_eventRegistration = exports.notify_referralUpdate = exports.notify_rfxResponse = exports.notify_rfxCreated = exports.org_purchaseSeats = exports.org_create = exports.rfx_createTeamInvite = exports.referral_onStatusChange = exports.admin_backfillQBO = exports.admin_syncPaymentToQBO = exports.qb_paymentsWebhook = exports.qb_refundCharge = exports.qb_chargeCard = exports.payments_pollQBInvoices = exports.payments_createQuickBooksInvoice = exports.intuit_checkConnection = exports.intuit_oauthCallback = exports.intuit_getAuthUrl = exports.admin_markPaymentStatus = exports.qb_createCheckout = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const identity_1 = require("firebase-functions/v2/identity");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const payments_1 = require("./payments");
// Secrets (set via `firebase functions:secrets:set <KEY>`)
const recaptchaSecret = (0, params_1.defineSecret)("RECAPTCHA_SECRET_KEY");
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
const intuitClientId = (0, params_1.defineSecret)("INTUIT_CLIENT_ID");
const intuitClientSecret = (0, params_1.defineSecret)("INTUIT_CLIENT_SECRET");
// MIRROR of @hi/shared userRoleSchema — kept inline because @hi/shared is ESM-only.
// Keep in sync with: packages/shared/src/index.ts → userRoleSchema
const VALID_ROLES = ["master", "admin", "staff", "member", "externalVendor", "econPartner"];
admin.initializeApp();
const db = admin.firestore();
// --- Types & Constants ---
// MIRROR of @hi/shared RESOURCE_CATALOG — kept inline because @hi/shared is ESM-only.
// Keep in sync with: packages/shared/src/index.ts → RESOURCE_CATALOG
const RESOURCE_CONFIG = {
    "seat-1": { name: "Seat 1", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
    "seat-2": { name: "Seat 2", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
    "seat-3": { name: "Seat 3", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
    "seat-4": { name: "Seat 4", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
    "seat-5": { name: "Seat 5", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
    "seat-6": { name: "Seat 6", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
    "mode-conference": { name: "Conference Room", type: "MODE", guestRateHourly: 75, exclusiveGroupId: "main_space", capacity: 10 },
};
// --- Helpers ---
// Check if two time ranges overlap
const isOverlapping = (startA, endA, startB, endB) => {
    return startA < endB && endA > startB;
};
/**
 * Provision membership entitlements for a user.
 * Sets membershipStatus to "active", assigns the plan, and sets a 35-day expiry.
 */
async function provisionMembership(uid, plan) {
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
const monthlyAllocations_1 = require("./scheduled/monthlyAllocations");
Object.defineProperty(exports, "allocateMonthlyCredits", { enumerable: true, get: function () { return monthlyAllocations_1.allocateMonthlyCredits; } });
const rfx_1 = require("./rfx");
Object.defineProperty(exports, "rfx_publish", { enumerable: true, get: function () { return rfx_1.rfx_publish; } });
Object.defineProperty(exports, "rfx_backfillGeo", { enumerable: true, get: function () { return rfx_1.rfx_backfillGeo; } });
const referrals_1 = require("./referrals");
Object.defineProperty(exports, "referral_create", { enumerable: true, get: function () { return referrals_1.referral_create; } });
Object.defineProperty(exports, "referral_convert", { enumerable: true, get: function () { return referrals_1.referral_convert; } });
Object.defineProperty(exports, "referral_markPaid", { enumerable: true, get: function () { return referrals_1.referral_markPaid; } });
Object.defineProperty(exports, "referral_accept", { enumerable: true, get: function () { return referrals_1.referral_accept; } });
Object.defineProperty(exports, "referral_decline", { enumerable: true, get: function () { return referrals_1.referral_decline; } });
Object.defineProperty(exports, "referral_createPayoutCheckout", { enumerable: true, get: function () { return referrals_1.referral_createPayoutCheckout; } });
const referralTriggers_1 = require("./triggers/referralTriggers");
Object.defineProperty(exports, "onReferralWritten", { enumerable: true, get: function () { return referralTriggers_1.onReferralWritten; } });
const events_1 = require("./events");
Object.defineProperty(exports, "events_createTicketCheckout", { enumerable: true, get: function () { return events_1.events_createTicketCheckout; } });
Object.defineProperty(exports, "events_createSponsorshipCheckout", { enumerable: true, get: function () { return events_1.events_createSponsorshipCheckout; } });
Object.defineProperty(exports, "events_registerFree", { enumerable: true, get: function () { return events_1.events_registerFree; } });
Object.defineProperty(exports, "events_cancelRegistration", { enumerable: true, get: function () { return events_1.events_cancelRegistration; } });
Object.defineProperty(exports, "events_joinWaitlist", { enumerable: true, get: function () { return events_1.events_joinWaitlist; } });
const eventSeries_1 = require("./eventSeries");
Object.defineProperty(exports, "events_upsertSeries", { enumerable: true, get: function () { return eventSeries_1.events_upsertSeries; } });
Object.defineProperty(exports, "events_extendHorizon", { enumerable: true, get: function () { return eventSeries_1.events_extendHorizon; } });
Object.defineProperty(exports, "events_setSeriesOccurrenceOverride", { enumerable: true, get: function () { return eventSeries_1.events_setSeriesOccurrenceOverride; } });
const eventMarketing_1 = require("./eventMarketing");
Object.defineProperty(exports, "events_enqueueCampaignJobs", { enumerable: true, get: function () { return eventMarketing_1.events_enqueueCampaignJobs; } });
Object.defineProperty(exports, "events_processCampaignJobs", { enumerable: true, get: function () { return eventMarketing_1.events_processCampaignJobs; } });
Object.defineProperty(exports, "events_generateShareKits", { enumerable: true, get: function () { return eventMarketing_1.events_generateShareKits; } });
Object.defineProperty(exports, "events_processSocialPosts", { enumerable: true, get: function () { return eventMarketing_1.events_processSocialPosts; } });
const eventMedia_1 = require("./eventMedia");
Object.defineProperty(exports, "events_onMediaUploaded", { enumerable: true, get: function () { return eventMedia_1.events_onMediaUploaded; } });
const bookstore_1 = require("./bookstore");
Object.defineProperty(exports, "bookstore_createCheckoutSession", { enumerable: true, get: function () { return bookstore_1.bookstore_createCheckoutSession; } });
const digitalFulfillment_1 = require("./digitalFulfillment");
Object.defineProperty(exports, "bookstore_getDownloadLink", { enumerable: true, get: function () { return digitalFulfillment_1.bookstore_getDownloadLink; } });
const territories_1 = require("./territories");
Object.defineProperty(exports, "territory_create", { enumerable: true, get: function () { return territories_1.territory_create; } });
Object.defineProperty(exports, "territory_update", { enumerable: true, get: function () { return territories_1.territory_update; } });
Object.defineProperty(exports, "territory_list_released", { enumerable: true, get: function () { return territories_1.territory_list_released; } });
Object.defineProperty(exports, "territory_release_scheduled", { enumerable: true, get: function () { return territories_1.territory_release_scheduled; } });
const enrichment_1 = require("./enrichment");
Object.defineProperty(exports, "enrichment_search", { enumerable: true, get: function () { return enrichment_1.enrichment_search; } });
Object.defineProperty(exports, "enrichment_link", { enumerable: true, get: function () { return enrichment_1.enrichment_link; } });
const verification_1 = require("./verification");
Object.defineProperty(exports, "verification_submit", { enumerable: true, get: function () { return verification_1.verification_submit; } });
Object.defineProperty(exports, "verification_review", { enumerable: true, get: function () { return verification_1.verification_review; } });
Object.defineProperty(exports, "verification_flag", { enumerable: true, get: function () { return verification_1.verification_flag; } });
const teaming_1 = require("./teaming");
Object.defineProperty(exports, "team_create", { enumerable: true, get: function () { return teaming_1.team_create; } });
Object.defineProperty(exports, "team_invite", { enumerable: true, get: function () { return teaming_1.team_invite; } });
Object.defineProperty(exports, "team_respond_invite", { enumerable: true, get: function () { return teaming_1.team_respond_invite; } });
Object.defineProperty(exports, "team_manage_member", { enumerable: true, get: function () { return teaming_1.team_manage_member; } });
const rfxSuggestions_1 = require("./rfxSuggestions");
Object.defineProperty(exports, "rfx_refreshSuggestions", { enumerable: true, get: function () { return rfxSuggestions_1.rfx_refreshSuggestions; } });
Object.defineProperty(exports, "rfx_refreshSuggestions_scheduled", { enumerable: true, get: function () { return rfxSuggestions_1.rfx_refreshSuggestions_scheduled; } });
exports.health = (0, https_1.onCall)(async () => {
    return { ok: true, timestamp: Date.now() };
});
exports.createBookingQuote = (0, https_1.onCall)(async (request) => {
    const { resourceId, start, end } = request.data;
    const uid = request.auth?.uid;
    if (!resourceId || !start || !end) {
        throw new https_1.HttpsError("invalid-argument", "Missing resourceId, start, or end");
    }
    const resource = RESOURCE_CONFIG[resourceId];
    if (!resource) {
        throw new https_1.HttpsError("not-found", "Resource not found");
    }
    // Determine rate based on user type and tier
    let userType = "guest";
    let rate = resource.guestRateHourly;
    if (uid && resource.type === "SEAT") {
        const userSnap = await db.collection("users").doc(uid).get();
        const userData = userSnap.data();
        if (userData?.membershipStatus === "active" && userData?.plan) {
            const tier = (0, payments_1.getTierById)(userData.plan);
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
exports.createBooking = (0, https_1.onCall)(async (request) => {
    // 1. Auth & Input Validation
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in to book");
    }
    const { resourceId, start, end } = request.data;
    if (!resourceId || !start || !end) {
        throw new https_1.HttpsError("invalid-argument", "Missing required fields");
    }
    if (end <= start) {
        throw new https_1.HttpsError("invalid-argument", "End time must be after start time");
    }
    const targetResource = RESOURCE_CONFIG[resourceId];
    if (!targetResource) {
        throw new https_1.HttpsError("not-found", "Resource configuration not found");
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
        const conflicts = [];
        snapshot.docs.forEach((doc) => {
            const b = doc.data();
            // Filter out bookings that don't actually overlap (since query is only on 'end')
            if (!isOverlapping(start, end, b.start, b.end))
                return;
            if (b.status === "CANCELLED")
                return;
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
            throw new https_1.HttpsError("failed-precondition", "Slot is not available.", { conflicts });
        }
        // B. Calculate Price (Recalculate to be safe)
        let rate = targetResource.guestRateHourly;
        if (targetResource.type === "SEAT") {
            const userSnap = await transaction.get(db.collection("users").doc(userId));
            const userData = userSnap.data();
            if (userData?.membershipStatus === "active" && userData?.plan) {
                const tier = (0, payments_1.getTierById)(userData.plan);
                if (tier)
                    rate = tier.extraHourlyRateCents / 100;
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
    });
});
// --- Auth Triggers (PR-02) ---
exports.authBeforeCreate = (0, identity_1.beforeUserCreated)(async (event) => {
    const user = event.data;
    logger.info(`Creating user doc for ${user.uid} (${user.email})`);
    const now = Date.now();
    const userDoc = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        role: "member",
        membershipStatus: "none",
        createdAt: now,
    };
    await db.collection("users").doc(user.uid).set(userDoc);
    // Set initial custom claims — role only (entitlements stay in Firestore)
    return {
        customClaims: { role: "member" },
    };
});
exports.setUserRole = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role;
    if (callerRole !== "admin" && callerRole !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin or master users can set roles");
    }
    const { targetUid, role } = request.data;
    if (!targetUid || !role) {
        throw new https_1.HttpsError("invalid-argument", "targetUid and role are required");
    }
    if (!VALID_ROLES.includes(role)) {
        throw new https_1.HttpsError("invalid-argument", `Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(", ")}`);
    }
    // Prevent non-master from assigning master role
    if (role === "master" && callerRole !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only master users can assign the master role");
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
function setCorsHeaders(req, res) {
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
async function verifyRecaptcha(token, secretKey) {
    const url = "https://www.google.com/recaptcha/api/siteverify";
    const params = new URLSearchParams({ secret: secretKey, response: token });
    const resp = await fetch(`${url}?${params.toString()}`, { method: "POST" });
    const data = await resp.json();
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
exports.leads_submitLead = (0, https_1.onRequest)({ secrets: [recaptchaSecret], cors: false }, async (req, res) => {
    // CORS
    if (setCorsHeaders(req, res))
        return;
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
        const recaptchaToken = body.recaptchaToken;
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
        if (body.message && body.message.length > 5)
            interestScore += 2;
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
            type: body.type || "early_access", // "early_access" or "survey"
            surveyAnswers: body.answers || null, // Survey data if type === "survey"
            recaptchaScore: captchaResult.score,
            createdAt: Date.now(),
        };
        await leadRef.set(leadDoc);
        logger.info("Lead created", { id: leadRef.id, email: body.email, score: captchaResult.score });
        res.status(200).json({ status: "success", id: leadRef.id });
    }
    catch (err) {
        logger.error("leads_submitLead error", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
/**
 * Firestore trigger: fires when a new lead is created.
 * Logs to admin feed (email notification can be added via SendGrid later).
 */
exports.leads_onNewLead = (0, firestore_1.onDocumentCreated)("leads/{leadId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
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
exports.leads_submitContact = (0, https_1.onCall)(async (request) => {
    const { name, email, message, source } = request.data;
    if (!name || !email) {
        throw new https_1.HttpsError("invalid-argument", "Name and email are required");
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
/**
 * Callable: Create a Stripe Checkout Session for a membership subscription.
 * The frontend redirects the user to the returned URL.
 */
exports.stripe_createCheckoutSession = (0, https_1.onCall)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { tierId, successUrl, cancelUrl } = request.data;
    if (!tierId || !successUrl || !cancelUrl) {
        throw new https_1.HttpsError("invalid-argument", "tierId, successUrl, and cancelUrl are required");
    }
    const tier = (0, payments_1.getTierById)(tierId);
    if (!tier) {
        throw new https_1.HttpsError("not-found", `Unknown tier: ${tierId}`);
    }
    const uid = request.auth.uid;
    const email = request.auth.token.email || "";
    // Create a pending payment in the ledger first
    const payment = await (0, payments_1.createPayment)({
        uid,
        provider: "stripe",
        amount: tier.amountCents,
        currency: tier.currency,
        purpose: "membership",
        purposeRefId: tier.id,
        status: "pending",
    });
    // Create Stripe checkout session
    const provider = new payments_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
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
});
/**
 * HTTP endpoint: Stripe webhook receiver.
 * Must be configured as the webhook endpoint in the Stripe Dashboard.
 * URL: https://<region>-<project>.cloudfunctions.net/stripe_webhook
 */
exports.stripe_webhook = (0, https_1.onRequest)({ secrets: [stripeSecretKey, stripeWebhookSecret, intuitClientId, intuitClientSecret], cors: false }, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    const result = await (0, payments_1.handleStripeWebhook)(req.rawBody, req.headers, stripeSecretKey.value(), stripeWebhookSecret.value(), intuitClientId.value(), intuitClientSecret.value());
    res.status(result.status).json(result.body);
});
/**
 * Callable: Create a QuickBooks payment link checkout.
 * Looks up the product's QB payment link URL and creates a pending payment.
 */
exports.qb_createCheckout = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { productId, successUrl, cancelUrl } = request.data;
    if (!productId || !successUrl) {
        throw new https_1.HttpsError("invalid-argument", "productId and successUrl are required");
    }
    const uid = request.auth.uid;
    // Fetch product to get amount and QB link
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) {
        throw new https_1.HttpsError("not-found", "Product not found");
    }
    const product = productSnap.data();
    if (!product.quickbooksPaymentLinkUrl) {
        throw new https_1.HttpsError("failed-precondition", "This product does not have a QuickBooks payment link configured");
    }
    // Create a pending payment in the ledger
    const payment = await (0, payments_1.createPayment)({
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
    const provider = new payments_1.QuickBooksLinkProvider();
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
/**
 * Callable: Admin marks a payment as paid (or failed/refunded).
 * Creates an audit trail entry in paymentAudit/{auditId}.
 * On "paid" for membership purpose → provisions entitlements.
 */
exports.admin_markPaymentStatus = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role;
    if (callerRole !== "admin" && callerRole !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin or master users can mark payments");
    }
    const { paymentId, newStatus, note } = request.data;
    if (!paymentId || !newStatus) {
        throw new https_1.HttpsError("invalid-argument", "paymentId and newStatus are required");
    }
    if (!["paid", "failed", "refunded"].includes(newStatus)) {
        throw new https_1.HttpsError("invalid-argument", "newStatus must be paid, failed, or refunded");
    }
    // Fetch current payment
    const paymentSnap = await db.collection("payments").doc(paymentId).get();
    if (!paymentSnap.exists) {
        throw new https_1.HttpsError("not-found", "Payment not found");
    }
    const payment = paymentSnap.data();
    const previousStatus = payment.status;
    // Update payment status
    await (0, payments_1.updatePaymentStatus)(paymentId, newStatus);
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
exports.intuit_getAuthUrl = (0, https_1.onCall)({ secrets: [intuitClientId] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role;
    if (callerRole !== "admin" && callerRole !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin users can connect QuickBooks");
    }
    const { redirectUri } = request.data;
    if (!redirectUri) {
        throw new https_1.HttpsError("invalid-argument", "redirectUri is required");
    }
    const state = `hi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = (0, payments_1.getAuthorizationUrl)(intuitClientId.value(), redirectUri, state);
    return { url, state };
});
/**
 * HTTP endpoint: Intuit OAuth callback.
 * Receives the authorization code and exchanges it for tokens.
 */
exports.intuit_oauthCallback = (0, https_1.onRequest)({ secrets: [intuitClientId, intuitClientSecret], cors: false }, async (req, res) => {
    if (req.method !== "GET") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    const code = req.query.code;
    const realmId = req.query.realmId;
    const state = req.query.state;
    const error = req.query.error;
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
        await (0, payments_1.exchangeCodeForTokens)(code, redirectUri, intuitClientId.value(), intuitClientSecret.value(), realmId);
        res.status(200).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px">' +
            '<h2 style="color:#059669">QuickBooks Connected!</h2>' +
            '<p>You can close this window and return to the admin dashboard.</p>' +
            '</body></html>');
    }
    catch (err) {
        logger.error("Intuit OAuth callback error", { err });
        res.status(500).send("<html><body><h2>Connection failed</h2><p>Please try again.</p></body></html>");
    }
});
/**
 * Callable: Check if QuickBooks is connected.
 */
exports.intuit_checkConnection = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const connected = await (0, payments_1.isQuickBooksConnected)();
    return { connected };
});
/**
 * Callable: Create a QuickBooks invoice for a payment.
 * Creates a pending payment in the ledger and a QBO invoice.
 */
exports.payments_createQuickBooksInvoice = (0, https_1.onCall)({ secrets: [intuitClientId, intuitClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { productId, customerEmail, customerName, memo } = request.data;
    if (!productId) {
        throw new https_1.HttpsError("invalid-argument", "productId is required");
    }
    const uid = request.auth.uid;
    const email = customerEmail || request.auth.token.email || "";
    const name = customerName || request.auth.token.name || email;
    // Fetch product
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) {
        throw new https_1.HttpsError("not-found", "Product not found");
    }
    const product = productSnap.data();
    // Create pending payment in ledger
    const payment = await (0, payments_1.createPayment)({
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
    const invoice = await (0, payments_1.createQuickBooksInvoice)({
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
    }, intuitClientId.value(), intuitClientSecret.value());
    // Update payment with QB refs
    await (0, payments_1.updatePaymentStatus)(payment.id, "pending", {
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
});
/**
 * Scheduled function: Poll pending QB invoices every hour.
 * Updates payment status when invoices are paid in QuickBooks.
 */
exports.payments_pollQBInvoices = (0, scheduler_1.onSchedule)({
    schedule: "every 60 minutes",
    secrets: [intuitClientId, intuitClientSecret],
}, async () => {
    // Check if QB is connected before polling
    const connected = await (0, payments_1.isQuickBooksConnected)();
    if (!connected) {
        logger.info("QB not connected, skipping invoice poll");
        return;
    }
    // Fetch all pending QB invoice payments
    const pendingPayments = await (0, payments_1.queryPayments)({
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
        if (!invoiceId)
            continue;
        try {
            const invoiceStatus = await (0, payments_1.getInvoiceStatus)(invoiceId, intuitClientId.value(), intuitClientSecret.value());
            const newStatus = (0, payments_1.mapInvoiceStatusToPaymentStatus)(invoiceStatus.status);
            if (newStatus !== payment.status) {
                await (0, payments_1.updatePaymentStatus)(payment.id, newStatus);
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
        }
        catch (err) {
            logger.error("Failed to poll QB invoice", { paymentId: payment.id, invoiceId, err });
        }
    }
    logger.info(`QB invoice poll complete: ${updated} updated out of ${pendingPayments.length}`);
});
// --- QuickBooks Payments API (PR-13) ---
/**
 * Callable: Charge a card via QB Payments API.
 * The frontend tokenizes the card using the QB.js SDK, then calls this
 * with the card token. Creates a payment in the ledger, charges the card,
 * and creates a Sales Receipt in QBO for accounting.
 */
exports.qb_chargeCard = (0, https_1.onCall)({ secrets: [intuitClientId, intuitClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { cardToken, productId, memo } = request.data;
    if (!cardToken || !productId) {
        throw new https_1.HttpsError("invalid-argument", "cardToken and productId are required");
    }
    const uid = request.auth.uid;
    const email = request.auth.token.email || "";
    // Fetch product
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) {
        throw new https_1.HttpsError("not-found", "Product not found");
    }
    const product = productSnap.data();
    const amountDollars = (product.amount || 0) / 100;
    // Create pending payment in ledger
    const payment = await (0, payments_1.createPayment)({
        uid,
        provider: "quickbooks_payments",
        amount: product.amount || 0,
        currency: product.currency || "USD",
        purpose: product.purpose || "other",
        purposeRefId: productId,
        status: "pending",
        providerRefs: { productId },
    });
    const provider = new payments_1.QuickBooksPaymentsProvider(intuitClientId.value(), intuitClientSecret.value());
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
        await (0, payments_1.updatePaymentStatus)(payment.id, newStatus, {
            providerRefs: {
                qbChargeId: charge.chargeId,
                qbAuthCode: charge.authCode || "",
            },
        });
        // Create Sales Receipt for accounting association
        if (newStatus === "paid") {
            try {
                const receipt = await provider.createSalesReceipt(charge, email, product.name || "Hi Coworking Payment");
                await (0, payments_1.updatePaymentStatus)(payment.id, "paid", {
                    accountingRefs: {
                        qboSalesReceiptId: receipt.salesReceiptId,
                    },
                });
            }
            catch (err) {
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
    }
    catch (err) {
        await (0, payments_1.updatePaymentStatus)(payment.id, "failed");
        logger.error("QB Payments charge failed", { paymentId: payment.id, err });
        throw new https_1.HttpsError("internal", "Payment processing failed");
    }
});
/**
 * Callable: Refund a QB Payments charge.
 * Admin-only — refunds the charge via QB Payments API and updates the ledger.
 */
exports.qb_refundCharge = (0, https_1.onCall)({ secrets: [intuitClientId, intuitClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role;
    if (callerRole !== "admin" && callerRole !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin users can issue refunds");
    }
    const { paymentId, amount, note } = request.data;
    if (!paymentId) {
        throw new https_1.HttpsError("invalid-argument", "paymentId is required");
    }
    // Fetch payment
    const paymentSnap = await db.collection("payments").doc(paymentId).get();
    if (!paymentSnap.exists) {
        throw new https_1.HttpsError("not-found", "Payment not found");
    }
    const payment = paymentSnap.data();
    const chargeId = payment.providerRefs?.qbChargeId;
    if (!chargeId) {
        throw new https_1.HttpsError("failed-precondition", "No QB charge ID found on this payment");
    }
    const provider = new payments_1.QuickBooksPaymentsProvider(intuitClientId.value(), intuitClientSecret.value());
    const refundAmountDollars = amount !== undefined ? amount / 100 : undefined;
    const refund = await provider.refundCharge(chargeId, refundAmountDollars);
    await (0, payments_1.updatePaymentStatus)(paymentId, "refunded", {
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
});
/**
 * HTTP endpoint: QuickBooks Payments webhook receiver.
 * Handles Intuit event notifications for payment status changes.
 * Uses ensureIdempotent() for de-duplication.
 */
exports.qb_paymentsWebhook = (0, https_1.onRequest)({ secrets: [intuitClientId, intuitClientSecret], cors: false }, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    const provider = new payments_1.QuickBooksPaymentsProvider(intuitClientId.value(), intuitClientSecret.value());
    let result;
    try {
        result = await provider.handleWebhook(req.rawBody, req.headers);
    }
    catch (err) {
        logger.error("QB Payments webhook parse error", { err });
        res.status(400).json({ error: "Invalid webhook" });
        return;
    }
    if (result.action === "unknown") {
        res.status(200).json({ received: true, skipped: true });
        return;
    }
    // Idempotency check
    const isNew = await (0, payments_1.ensureIdempotent)(result.eventId, "quickbooks_payments");
    if (!isNew) {
        res.status(200).json({ received: true, skipped: true });
        return;
    }
    try {
        // Look up payment by QB charge/entity ID if available
        const entityId = result.metadata?.entityId;
        if (entityId && result.status) {
            const payments = await (0, payments_1.queryPayments)({
                provider: "quickbooks_payments",
                limitTo: 10,
            });
            const match = payments.find((p) => p.providerRefs?.qbChargeId === entityId);
            if (match) {
                await (0, payments_1.updatePaymentStatus)(match.id, result.status);
                logger.info("QB webhook updated payment", {
                    paymentId: match.id,
                    newStatus: result.status,
                });
            }
        }
        await (0, payments_1.markWebhookResult)(result.eventId, "success");
    }
    catch (err) {
        logger.error("QB webhook processing error", { eventId: result.eventId, err });
        await (0, payments_1.markWebhookResult)(result.eventId, `error: ${err}`);
    }
    res.status(200).json({ received: true });
});
// --- QBO Accounting Sync (PR-14) ---
/**
 * Callable: Manually sync a single payment to QBO.
 * Admin can use this to retry a failed sync or sync an older payment.
 */
exports.admin_syncPaymentToQBO = (0, https_1.onCall)({ secrets: [intuitClientId, intuitClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role;
    if (callerRole !== "admin" && callerRole !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin users can trigger QBO sync");
    }
    const { paymentId } = request.data;
    if (!paymentId) {
        throw new https_1.HttpsError("invalid-argument", "paymentId is required");
    }
    const result = await (0, payments_1.syncPaymentToQBO)(paymentId, intuitClientId.value(), intuitClientSecret.value());
    return result;
});
/**
 * Callable: Backfill all paid payments missing QBO accounting refs.
 * Admin reconciliation tool — syncs up to `limit` payments at once.
 */
exports.admin_backfillQBO = (0, https_1.onCall)({ secrets: [intuitClientId, intuitClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const callerRole = request.auth.token.role;
    if (callerRole !== "admin" && callerRole !== "master") {
        throw new https_1.HttpsError("permission-denied", "Only admin users can trigger QBO backfill");
    }
    const { limit: maxLimit } = request.data;
    const result = await (0, payments_1.backfillPaymentsToQBO)(intuitClientId.value(), intuitClientSecret.value(), maxLimit || 50);
    logger.info("Admin triggered QBO backfill", {
        adminUid: request.auth.uid,
        ...result,
    });
    return result;
});
// --- Referral & Teaming (PR-16) ---
/**
 * Firestore trigger: when a referral doc is created with status "converted",
 * increment the referrer's referral count and send a notification.
 */
exports.referral_onStatusChange = (0, firestore_1.onDocumentCreated)("referrals/{referralId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const referral = snap.data();
    if (referral.status !== "converted")
        return;
    const referrerUid = referral.referrerUid;
    if (!referrerUid)
        return;
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
    }
    catch (err) {
        logger.error("Failed to process referral conversion", {
            referralId: event.params.referralId,
            err,
        });
    }
});
/**
 * Callable: Create an RFx team invite.
 * Creates the invite doc and notifies the invitee.
 */
exports.rfx_createTeamInvite = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { rfxId, inviteeUid, inviteeName, role, note } = request.data;
    if (!rfxId || !inviteeUid) {
        throw new https_1.HttpsError("invalid-argument", "rfxId and inviteeUid are required");
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
exports.org_create = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { name, slug, website, address, billingEmail, seats } = request.data;
    if (!name?.trim() || !slug?.trim()) {
        throw new https_1.HttpsError("invalid-argument", "name and slug are required");
    }
    // Check slug uniqueness
    const existing = await db.collection("orgs").where("slug", "==", slug.trim()).limit(1).get();
    if (!existing.empty) {
        throw new https_1.HttpsError("already-exists", "An org with that slug already exists");
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
exports.org_purchaseSeats = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const { orgId, seats } = request.data;
    if (!orgId || !seats || seats < 1) {
        throw new https_1.HttpsError("invalid-argument", "orgId and seats (>= 1) are required");
    }
    // Verify caller is org owner or admin
    const memberSnap = await db.collection("orgMembers")
        .doc(`${orgId}_${request.auth.uid}`)
        .get();
    if (!memberSnap.exists) {
        throw new https_1.HttpsError("permission-denied", "Not a member of this organization");
    }
    const memberRole = memberSnap.data()?.role;
    if (memberRole !== "owner" && memberRole !== "admin") {
        throw new https_1.HttpsError("permission-denied", "Only org owners/admins can purchase seats");
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
async function createNotification(params) {
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
exports.notify_rfxCreated = (0, firestore_1.onDocumentCreated)("rfx/{rfxId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const rfx = snap.data();
    const title = rfx.title || "New RFx";
    // Notify all users with role member/admin (simplified: get all users)
    try {
        const usersSnap = await db.collection("users").limit(200).get();
        const promises = usersSnap.docs
            .filter((u) => u.id !== rfx.createdBy)
            .map((u) => createNotification({
            uid: u.id,
            type: "rfx_new",
            title: "New RFx Posted",
            body: `"${title}" was just posted. Check it out!`,
            linkTo: `/rfx/detail?id=${event.params.rfxId}`,
        }));
        await Promise.all(promises);
        logger.info("RFx creation notifications sent", { rfxId: event.params.rfxId, count: promises.length });
    }
    catch (err) {
        logger.error("Failed to send rfx notifications", { err });
    }
});
/**
 * Firestore trigger: when a new RFx response is created, notify the RFx owner.
 */
exports.notify_rfxResponse = (0, firestore_1.onDocumentCreated)("rfxResponses/{responseId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const response = snap.data();
    const rfxId = response.rfxId;
    try {
        const rfxSnap = await db.collection("rfx").doc(rfxId).get();
        if (!rfxSnap.exists)
            return;
        const rfx = rfxSnap.data();
        await createNotification({
            uid: rfx.createdBy,
            type: "rfx_response",
            title: "New RFx Response",
            body: `Someone responded to your RFx "${rfx.title || ""}".`,
            linkTo: `/rfx/detail?id=${rfxId}`,
        });
        logger.info("RFx response notification sent", { rfxId, responseId: event.params.responseId });
    }
    catch (err) {
        logger.error("Failed to send rfx response notification", { err });
    }
});
/**
 * Firestore trigger: when a referral status changes to "converted",
 * notify the referrer. (Supplements the existing referral_onStatusChange.)
 */
exports.notify_referralUpdate = (0, firestore_1.onDocumentCreated)("referrals/{referralId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
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
        }
        catch (err) {
            logger.error("Failed to send referral notification", { err });
        }
    }
});
/**
 * Firestore trigger: when someone registers for an event, notify the event creator.
 */
exports.notify_eventRegistration = (0, firestore_1.onDocumentCreated)("events/{eventId}/registrations/{uid}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const registration = snap.data();
    const eventId = event.params.eventId;
    try {
        const eventSnap = await db.collection("events").doc(eventId).get();
        if (!eventSnap.exists)
            return;
        const eventDoc = eventSnap.data();
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
    }
    catch (err) {
        logger.error("Failed to send event registration notification", { err });
    }
});
/**
 * Firestore trigger: when a payment is created, notify the payer.
 */
exports.notify_paymentCreated = (0, firestore_1.onDocumentCreated)("payments/{paymentId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
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
    }
    catch (err) {
        logger.error("Failed to send payment notification", { err });
    }
});
