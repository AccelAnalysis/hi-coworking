"use strict";
/**
 * Stripe Webhook Handler + Entitlement Updater (PR-10)
 *
 * Receives Stripe webhook events, de-duplicates via ensureIdempotent(),
 * updates the unified payment ledger, and provisions/revokes membership
 * entitlements on the users/{uid} doc.
 */
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
exports.handleStripeWebhook = handleStripeWebhook;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const stripeProvider_1 = require("./stripeProvider");
const idempotency_1 = require("./idempotency");
const ledger_1 = require("./ledger");
const qboAccountingSync_1 = require("./qboAccountingSync");
const seatHours_1 = require("../memberships/seatHours");
const access_1 = require("../access");
const membership_1 = require("../exchange/membership");
function getDb() { return admin.firestore(); }
/**
 * Process a raw Stripe webhook request.
 * Called from the HTTP Cloud Function exported in index.ts.
 */
async function handleStripeWebhook(rawBody, headers, stripeSecretKey, stripeWebhookSecret, intuitClientId, intuitClientSecret) {
    const provider = new stripeProvider_1.StripeProvider(stripeSecretKey, stripeWebhookSecret);
    let result;
    try {
        result = await provider.handleWebhook(rawBody, headers);
    }
    catch (err) {
        logger.error("Stripe webhook parse error", { err });
        return { status: 400, body: { error: "Invalid webhook" } };
    }
    // Idempotency check
    const isNew = await (0, idempotency_1.ensureIdempotent)(result.eventId, "stripe");
    if (!isNew) {
        return { status: 200, body: { received: true, skipped: true } };
    }
    try {
        await processWebhookResult(result, provider, intuitClientId, intuitClientSecret);
        await (0, idempotency_1.markWebhookResult)(result.eventId, "success");
    }
    catch (err) {
        logger.error("Stripe webhook processing error", { eventId: result.eventId, err });
        await (0, idempotency_1.markWebhookResult)(result.eventId, `error: ${err}`);
        return { status: 500, body: { error: "Processing failed" } };
    }
    return { status: 200, body: { received: true } };
}
/**
 * Route the webhook result to the appropriate handler.
 */
async function processWebhookResult(result, provider, intuitClientId, intuitClientSecret) {
    if (await (0, membership_1.processExchangeMembershipWebhook)(result))
        return;
    switch (result.action) {
        case "payment_succeeded":
            await handlePaymentSucceeded(result, provider, intuitClientId, intuitClientSecret);
            break;
        case "payment_failed":
            await handlePaymentFailed(result);
            break;
        case "checkout_expired":
            await handleBookingPaymentFailed(result, "EXPIRED");
            break;
        case "subscription_updated":
            break;
        case "refund":
            if (result.paymentId) {
                await (0, ledger_1.updatePaymentStatus)(result.paymentId, "refunded");
            }
            break;
        case "unknown":
            // No action needed
            break;
    }
}
/**
 * On successful payment/subscription:
 * 1. Update or create payment doc in ledger
 * 2. Provision membership entitlements on users/{uid}
 * 3. Sync to QBO accounting if connected (PR-14)
 */
async function handlePaymentSucceeded(result, provider, intuitClientId, intuitClientSecret) {
    const uid = result.metadata?.uid;
    const subscriptionId = result.metadata?.subscriptionId;
    const plan = result.metadata?.plan;
    if (isBookingPayment(result)) {
        await finalizeBookingPayment(result);
        return;
    }
    // Update existing payment doc if we have a paymentId
    if (result.paymentId) {
        await (0, ledger_1.updatePaymentStatus)(result.paymentId, "paid", {
            providerRefs: {
                stripeSubscriptionId: subscriptionId || "",
                stripeCustomerId: result.metadata?.customerId || "",
            },
        });
    }
    // Provision membership entitlements
    if (uid && plan) {
        await provisionMembership(uid, plan, provider, subscriptionId, result.metadata);
    }
    // Handle Referral Payouts (PR-16)
    if (result.metadata?.purpose === "referral" && result.metadata.purposeRefId) {
        const referralId = result.metadata.purposeRefId;
        await getDb().collection("referrals").doc(referralId).update({
            status: "paid",
            paidAt: Date.now(),
            payoutMethod: "platform",
            payoutPaymentId: result.paymentId || "",
            updatedAt: Date.now(),
        });
        logger.info("Referral marked as paid via platform", { referralId, paymentId: result.paymentId });
    }
    // Handle Bookstore Fulfillment (PR-19)
    if (result.metadata?.bookId) {
        const bookId = result.metadata.bookId;
        const purchaseId = `purchase_${result.eventId}_${bookId}`; // Idempotent ID based on stripe event
        // Create BookPurchaseDoc
        await getDb().collection("bookPurchases").doc(purchaseId).set({
            id: purchaseId,
            bookId: bookId,
            userId: uid || null,
            email: result.metadata.email || null, // Assuming email passed in metadata or we get it from result if available (result doesn't generic expose customer_email in metadata usually, but we passed it in session creation?)
            // We didn't pass email in metadata in bookstore.ts, only in createCheckoutSession args. 
            // But Stripe result might have customer details if we fetched them. 
            // Let's rely on uid if present.
            stripeSessionId: result.eventId, // Using eventId as proxy or we can store session ID if available in result (it is in event.id or resource ID)
            variantId: result.metadata.variantId || null,
            quantity: parseInt(result.metadata.quantity || "1"),
            accessGrantedAt: Date.now(),
            createdAt: Date.now(),
        });
        logger.info("Book purchase fulfilled", { bookId, uid, purchaseId });
    }
    // Handle Event finalization (tickets/sponsorship/vendor tables)
    if (result.metadata?.purpose === "event" || result.metadata?.eventId) {
        await finalizeEventCommerce(result);
    }
    // Sync to QBO accounting (PR-14) — non-fatal
    if (result.paymentId && intuitClientId && intuitClientSecret) {
        try {
            await (0, qboAccountingSync_1.syncPaymentToQBO)(result.paymentId, intuitClientId, intuitClientSecret);
        }
        catch (err) {
            logger.error("QBO sync after Stripe payment failed (non-fatal)", {
                paymentId: result.paymentId,
                err,
            });
        }
    }
}
async function finalizeEventCommerce(result) {
    const checkoutType = result.metadata?.checkoutType;
    if (checkoutType === "sponsorship") {
        await finalizeSponsorshipPurchase(result);
        return;
    }
    if (checkoutType === "vendor_table") {
        await finalizeVendorTablePurchase(result);
        return;
    }
    await finalizeTicketPurchase(result);
}
async function finalizeTicketPurchase(result) {
    const eventId = result.metadata?.eventId || result.metadata?.purposeRefId;
    const uid = result.metadata?.uid;
    if (!eventId || !uid)
        return;
    const ticketTypeId = result.metadata?.ticketTypeId || undefined;
    const quantity = Math.max(1, parseInt(result.metadata?.quantity || "1", 10) || 1);
    const db = getDb();
    const eventRef = db.collection("events").doc(eventId);
    const registrationRef = eventRef.collection("registrations").doc(uid);
    await db.runTransaction(async (tx) => {
        const [eventSnap, registrationSnap] = await Promise.all([
            tx.get(eventRef),
            tx.get(registrationRef),
        ]);
        if (!eventSnap.exists || registrationSnap.exists)
            return;
        const eventDoc = eventSnap.data();
        const currentRegistrationCount = eventDoc.registrationCount || 0;
        if (typeof eventDoc.seatCap === "number" && currentRegistrationCount + quantity > eventDoc.seatCap) {
            throw new Error(`Seat cap exceeded during webhook finalization for event ${eventId}`);
        }
        const registration = {
            uid,
            eventId,
            displayName: result.metadata?.displayName || undefined,
            email: result.metadata?.email || undefined,
            registeredAt: Date.now(),
            paymentId: result.paymentId || undefined,
            ticketTypeId,
            quantity,
            status: "active",
        };
        tx.set(registrationRef, registration);
        const updatePayload = {
            registrationCount: admin.firestore.FieldValue.increment(quantity),
            updatedAt: Date.now(),
        };
        if (ticketTypeId && eventDoc.ticketTypes?.length) {
            updatePayload.ticketTypes = eventDoc.ticketTypes.map((t) => (t.id === ticketTypeId
                ? { ...t, soldCount: (t.soldCount || 0) + quantity }
                : t));
        }
        tx.update(eventRef, updatePayload);
    });
}
async function finalizeSponsorshipPurchase(result) {
    const eventId = result.metadata?.eventId || result.metadata?.purposeRefId;
    const uid = result.metadata?.uid;
    const sponsorshipTierId = result.metadata?.sponsorshipTierId;
    const paymentId = result.paymentId;
    if (!eventId || !uid || !sponsorshipTierId || !paymentId)
        return;
    const db = getDb();
    const eventRef = db.collection("events").doc(eventId);
    const sponsorRef = eventRef.collection("sponsors").doc(paymentId);
    await db.runTransaction(async (tx) => {
        const [eventSnap, sponsorSnap] = await Promise.all([tx.get(eventRef), tx.get(sponsorRef)]);
        if (!eventSnap.exists || sponsorSnap.exists)
            return;
        const eventDoc = eventSnap.data();
        const tiers = eventDoc.sponsorships || [];
        const tier = tiers.find((t) => t.id === sponsorshipTierId);
        if (!tier) {
            throw new Error(`Sponsorship tier ${sponsorshipTierId} missing for event ${eventId}`);
        }
        if (tier.soldCount >= tier.slots) {
            throw new Error(`Sponsorship tier ${sponsorshipTierId} sold out during finalization`);
        }
        const nextTiers = tiers.map((t) => (t.id === sponsorshipTierId
            ? { ...t, soldCount: t.soldCount + 1 }
            : t));
        tx.set(sponsorRef, {
            id: paymentId,
            paymentId,
            eventId,
            sponsorshipTierId,
            uid,
            createdAt: Date.now(),
            status: "active",
        });
        tx.update(eventRef, { sponsorships: nextTiers, updatedAt: Date.now() });
    });
}
async function finalizeVendorTablePurchase(result) {
    const eventId = result.metadata?.eventId || result.metadata?.purposeRefId;
    const uid = result.metadata?.uid;
    const paymentId = result.paymentId;
    if (!eventId || !uid || !paymentId)
        return;
    const db = getDb();
    const vendorTableRef = db.collection("events").doc(eventId).collection("vendorTables").doc(paymentId);
    const vendorTableSnap = await vendorTableRef.get();
    if (vendorTableSnap.exists)
        return;
    await vendorTableRef.set({
        id: paymentId,
        paymentId,
        eventId,
        uid,
        createdAt: Date.now(),
        status: "active",
    });
}
function isBookingPayment(result) {
    return result.metadata?.purpose === "booking" || Boolean(result.metadata?.bookingId);
}
function parseMetadataNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
async function finalizeBookingPayment(result) {
    const bookingId = result.metadata?.bookingId || result.metadata?.purposeRefId;
    const paymentId = result.paymentId || result.metadata?.paymentId;
    if (!bookingId)
        return;
    const db = getDb();
    const bookingRef = db.collection("bookings").doc(bookingId);
    let bookingForAccess = null;
    await db.runTransaction(async (tx) => {
        const bookingSnap = await tx.get(bookingRef);
        if (!bookingSnap.exists)
            return;
        const booking = bookingSnap.data() || {};
        if (booking.status === "CONFIRMED")
            return;
        const userId = typeof booking.userId === "string" ? booking.userId : result.metadata?.uid || "";
        const membershipPeriodId = typeof booking.membershipPeriodId === "string"
            ? booking.membershipPeriodId
            : result.metadata?.membershipPeriodId || undefined;
        const includedSeatMinutesApplied = typeof booking.includedSeatMinutesApplied === "number"
            ? booking.includedSeatMinutesApplied
            : parseMetadataNumber(result.metadata?.includedSeatMinutesApplied);
        (0, seatHours_1.consumeReservedSeatMinutesForBooking)(tx, userId, membershipPeriodId || undefined, includedSeatMinutesApplied);
        const now = Date.now();
        tx.update(bookingRef, {
            status: "CONFIRMED",
            paymentStatus: "paid",
            paidAt: now,
            updatedAt: now,
            checkoutSessionId: result.metadata?.checkoutSessionId || booking.checkoutSessionId || null,
            paymentId: paymentId || booking.paymentId || null,
        });
        if (paymentId) {
            tx.update(db.collection("payments").doc(paymentId), {
                status: "paid",
                updatedAt: now,
                "providerRefs.bookingId": bookingId,
                "providerRefs.checkoutSessionId": result.metadata?.checkoutSessionId || "",
            });
        }
        bookingForAccess = {
            resourceId: String(booking.resourceId || result.metadata?.resourceId || ""),
            userId,
            start: typeof booking.start === "number" ? booking.start : parseMetadataNumber(result.metadata?.start),
            end: typeof booking.end === "number" ? booking.end : parseMetadataNumber(result.metadata?.end),
        };
    });
    const accessContext = bookingForAccess;
    if (accessContext?.resourceId && accessContext.userId && accessContext.start && accessContext.end) {
        await (0, access_1.createAccessGrant)(bookingId, accessContext.resourceId, accessContext.userId, accessContext.start, accessContext.end);
    }
    logger.info("Booking payment finalized", { bookingId, paymentId });
}
async function handleBookingPaymentFailed(result, bookingStatus) {
    const bookingId = result.metadata?.bookingId || result.metadata?.purposeRefId;
    const paymentId = result.paymentId || result.metadata?.paymentId;
    if (!bookingId)
        return;
    const db = getDb();
    const bookingRef = db.collection("bookings").doc(bookingId);
    await db.runTransaction(async (tx) => {
        const bookingSnap = await tx.get(bookingRef);
        if (!bookingSnap.exists)
            return;
        const booking = bookingSnap.data() || {};
        if (booking.status !== "PENDING_PAYMENT")
            return;
        const userId = typeof booking.userId === "string" ? booking.userId : result.metadata?.uid || "";
        const membershipPeriodId = typeof booking.membershipPeriodId === "string"
            ? booking.membershipPeriodId
            : result.metadata?.membershipPeriodId || undefined;
        const includedSeatMinutesApplied = typeof booking.includedSeatMinutesApplied === "number"
            ? booking.includedSeatMinutesApplied
            : parseMetadataNumber(result.metadata?.includedSeatMinutesApplied);
        (0, seatHours_1.releaseReservedSeatMinutesForBooking)(tx, userId, membershipPeriodId || undefined, includedSeatMinutesApplied);
        const now = Date.now();
        tx.update(bookingRef, {
            status: bookingStatus,
            paymentStatus: "failed",
            updatedAt: now,
            checkoutSessionId: result.metadata?.checkoutSessionId || booking.checkoutSessionId || null,
        });
        if (paymentId) {
            tx.update(db.collection("payments").doc(paymentId), {
                status: "failed",
                updatedAt: now,
                "providerRefs.bookingId": bookingId,
                "providerRefs.checkoutSessionId": result.metadata?.checkoutSessionId || "",
            });
        }
    });
    logger.info("Booking payment failed", { bookingId, paymentId, bookingStatus });
}
/**
 * On failed payment:
 * 1. Update payment doc
 * 2. Downgrade membership status to pastDue or cancelled
 */
async function handlePaymentFailed(result) {
    if (isBookingPayment(result)) {
        await handleBookingPaymentFailed(result, "FAILED_PAYMENT");
        return;
    }
    if (result.paymentId) {
        await (0, ledger_1.updatePaymentStatus)(result.paymentId, "failed");
    }
    const uid = result.metadata?.uid;
    const reason = result.metadata?.reason;
    if (uid) {
        const updates = { updatedAt: Date.now() };
        if (reason === "subscription_cancelled") {
            updates.membershipStatus = "cancelled";
            updates.plan = null;
            updates.expiresAt = Date.now();
        }
        else {
            updates.membershipStatus = "pastDue";
        }
        await getDb().collection("users").doc(uid).update(updates);
        logger.info("Membership status downgraded", { uid, reason, updates });
    }
}
/**
 * Set membership entitlements on the user doc after a successful subscription.
 */
async function provisionMembership(uid, plan, provider, subscriptionId, metadata) {
    const now = Date.now();
    let resolvedPlan = plan;
    let resolvedSubscriptionId = subscriptionId;
    let periodStart = metadata?.billingPeriodStart
        ? Number(metadata.billingPeriodStart)
        : metadata?.periodStart
            ? Number(metadata.periodStart)
            : NaN;
    let periodEnd = metadata?.billingPeriodEnd
        ? Number(metadata.billingPeriodEnd)
        : metadata?.periodEnd
            ? Number(metadata.periodEnd)
            : NaN;
    if (resolvedSubscriptionId &&
        (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || !resolvedPlan)) {
        const subscriptionContext = await provider.getSubscriptionMembershipContext(resolvedSubscriptionId);
        if (subscriptionContext) {
            resolvedPlan = resolvedPlan || subscriptionContext.plan || plan;
            periodStart = Number.isFinite(periodStart)
                ? periodStart
                : subscriptionContext.periodStart || NaN;
            periodEnd = Number.isFinite(periodEnd)
                ? periodEnd
                : subscriptionContext.periodEnd || NaN;
            resolvedSubscriptionId = resolvedSubscriptionId || subscriptionContext.subscriptionId;
        }
    }
    if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd)) {
        logger.warn("Stripe billing period missing; using MVP fallback membership period", {
            uid,
            plan: resolvedPlan,
            subscriptionId: resolvedSubscriptionId,
            periodStart,
            periodEnd,
        });
        periodStart = now;
        periodEnd = now + 31 * 24 * 60 * 60 * 1000;
    }
    const updates = {
        membershipStatus: "active",
        plan: resolvedPlan,
        expiresAt: periodEnd,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        updatedAt: now,
    };
    if (resolvedSubscriptionId) {
        updates["features.stripeSubscriptionId"] = resolvedSubscriptionId;
    }
    await getDb().collection("users").doc(uid).set(updates, { merge: true });
    await (0, seatHours_1.upsertMembershipPeriod)({
        uid,
        plan: resolvedPlan,
        stripeSubscriptionId: resolvedSubscriptionId,
        periodStart,
        periodEnd,
    });
    logger.info("Membership provisioned", {
        uid,
        plan: resolvedPlan,
        expiresAt: periodEnd,
        periodStart,
        periodEnd,
    });
}
