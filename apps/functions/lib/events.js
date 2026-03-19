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
exports.events_createSponsorshipCheckout = exports.events_createTicketCheckout = exports.events_joinWaitlist = exports.events_cancelRegistration = exports.events_registerFree = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const ledger_1 = require("./payments/ledger");
const stripeProvider_1 = require("./payments/stripeProvider");
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
function getDb() {
    return admin.firestore();
}
function assertPublished(event) {
    if (event.status !== "published") {
        throw new https_1.HttpsError("failed-precondition", "Event is not published");
    }
}
function assertSeatAvailable(event, requestedQuantity) {
    const cap = event.seatCap;
    if (typeof cap !== "number")
        return;
    const current = event.registrationCount || 0;
    if (current + requestedQuantity > cap) {
        throw new https_1.HttpsError("resource-exhausted", "Event is full");
    }
}
/**
 * Register for a free event using a server-authoritative transaction.
 */
exports.events_registerFree = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to register");
    }
    const { eventId, displayName, email } = request.data;
    if (!eventId) {
        throw new https_1.HttpsError("invalid-argument", "eventId is required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    const eventRef = db.collection("events").doc(eventId);
    const registrationRef = eventRef.collection("registrations").doc(uid);
    await db.runTransaction(async (tx) => {
        const [eventSnap, regSnap] = await Promise.all([tx.get(eventRef), tx.get(registrationRef)]);
        if (!eventSnap.exists) {
            throw new https_1.HttpsError("not-found", "Event not found");
        }
        if (regSnap.exists) {
            throw new https_1.HttpsError("already-exists", "Already registered for this event");
        }
        const event = eventSnap.data();
        assertPublished(event);
        const price = event.price || 0;
        if (price > 0) {
            throw new https_1.HttpsError("failed-precondition", "Paid events must use checkout flow");
        }
        assertSeatAvailable(event, 1);
        const registration = {
            uid,
            eventId,
            displayName: displayName || undefined,
            email: email || undefined,
            registeredAt: Date.now(),
            quantity: 1,
            status: "active",
        };
        tx.set(registrationRef, registration);
        tx.update(eventRef, { registrationCount: admin.firestore.FieldValue.increment(1) });
    });
    return { success: true };
});
/**
 * Cancel an active registration and decrement registration count.
 */
exports.events_cancelRegistration = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to cancel registration");
    }
    const { eventId } = request.data;
    if (!eventId) {
        throw new https_1.HttpsError("invalid-argument", "eventId is required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    const eventRef = db.collection("events").doc(eventId);
    const registrationRef = eventRef.collection("registrations").doc(uid);
    await db.runTransaction(async (tx) => {
        const [eventSnap, registrationSnap] = await Promise.all([tx.get(eventRef), tx.get(registrationRef)]);
        if (!eventSnap.exists) {
            throw new https_1.HttpsError("not-found", "Event not found");
        }
        if (!registrationSnap.exists) {
            throw new https_1.HttpsError("not-found", "Registration not found");
        }
        tx.delete(registrationRef);
        tx.update(eventRef, {
            registrationCount: admin.firestore.FieldValue.increment(-1),
            updatedAt: Date.now(),
        });
    });
    return { success: true };
});
/**
 * Join waitlist for full events.
 */
exports.events_joinWaitlist = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to join waitlist");
    }
    const { eventId, displayName, email } = request.data;
    if (!eventId) {
        throw new https_1.HttpsError("invalid-argument", "eventId is required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    const eventRef = db.collection("events").doc(eventId);
    const waitlistRef = eventRef.collection("waitlist").doc(uid);
    await db.runTransaction(async (tx) => {
        const [eventSnap, existingWaitlistSnap] = await Promise.all([tx.get(eventRef), tx.get(waitlistRef)]);
        if (!eventSnap.exists) {
            throw new https_1.HttpsError("not-found", "Event not found");
        }
        const event = eventSnap.data();
        assertPublished(event);
        if (!event.seatCap || (event.registrationCount || 0) < event.seatCap) {
            throw new https_1.HttpsError("failed-precondition", "Event still has available seats");
        }
        if (existingWaitlistSnap.exists) {
            throw new https_1.HttpsError("already-exists", "Already on waitlist");
        }
        const entry = {
            uid,
            eventId,
            displayName: displayName || undefined,
            email: email || undefined,
            joinedAt: Date.now(),
            status: "waiting",
        };
        tx.set(waitlistRef, entry);
    });
    return { success: true };
});
/**
 * Create a Stripe Checkout Session for Event Tickets.
 */
exports.events_createTicketCheckout = (0, https_1.onCall)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to purchase tickets");
    }
    const { eventId, ticketTypeId, quantity = 1, successUrl, cancelUrl } = request.data;
    if (!eventId || !successUrl || !cancelUrl) {
        throw new https_1.HttpsError("invalid-argument", "eventId, successUrl, and cancelUrl are required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    // 1. Get Event
    const eventSnap = await db.collection("events").doc(eventId).get();
    if (!eventSnap.exists) {
        throw new https_1.HttpsError("not-found", "Event not found");
    }
    const event = eventSnap.data();
    assertPublished(event);
    // Determine Price
    let amountCents = event.price || 0;
    let description = `Ticket for ${event.title}`;
    if (ticketTypeId) {
        // Find specific ticket type
        const ticketType = event.ticketTypes?.find(t => t.id === ticketTypeId);
        if (!ticketType) {
            throw new https_1.HttpsError("not-found", "Ticket type not found");
        }
        amountCents = ticketType.priceCents;
        description = `${ticketType.name} - ${event.title}`;
    }
    // Check Member Discount
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const planId = userData?.plan;
    // Apply discount logic
    // Virtual: 10%, Coworking: 20%, Plus: 40% (example from plan)
    // We should probably move this config to MEMBERSHIP_TIERS but hardcoding for now based on plan doc
    let discountPercent = 0;
    if (planId === "virtual")
        discountPercent = 10;
    else if (planId === "coworking")
        discountPercent = 20;
    else if (planId === "coworking_plus")
        discountPercent = 40;
    if (discountPercent > 0) {
        amountCents = Math.round(amountCents * (1 - discountPercent / 100));
    }
    if (amountCents <= 0) {
        // Free ticket logic should be handled by direct registration, but if it ends up here:
        throw new https_1.HttpsError("invalid-argument", "Price is 0, use free registration endpoint");
    }
    const totalAmount = amountCents * quantity;
    // 2. Create Pending Payment
    const payment = await (0, ledger_1.createPayment)({
        uid,
        provider: "stripe",
        amount: totalAmount,
        currency: event.currency || "usd",
        purpose: "event",
        purposeRefId: eventId,
        status: "pending",
        providerRefs: { ticketTypeId: ticketTypeId || "standard", quantity: String(quantity) }
    });
    // 3. Create Checkout Session
    const provider = new stripeProvider_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
        uid,
        amount: totalAmount,
        currency: event.currency || "usd",
        purpose: "event",
        purposeRefId: eventId,
        successUrl,
        cancelUrl,
        mode: "payment",
        lineItemLabel: description,
        metadata: {
            eventId,
            ticketTypeId: ticketTypeId || "",
            quantity: String(quantity),
            paymentId: payment.id,
            checkoutType: "ticket"
        }
    });
    return {
        sessionId: session.sessionId,
        url: session.url,
        paymentId: payment.id
    };
});
/**
 * Create a Stripe Checkout Session for Event Sponsorship.
 */
exports.events_createSponsorshipCheckout = (0, https_1.onCall)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to sponsor events");
    }
    const { eventId, sponsorshipTierId, successUrl, cancelUrl } = request.data;
    if (!eventId || !sponsorshipTierId || !successUrl || !cancelUrl) {
        throw new https_1.HttpsError("invalid-argument", "eventId, sponsorshipTierId, successUrl, and cancelUrl are required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    // 1. Get Event
    const eventSnap = await db.collection("events").doc(eventId).get();
    if (!eventSnap.exists) {
        throw new https_1.HttpsError("not-found", "Event not found");
    }
    const event = eventSnap.data();
    assertPublished(event);
    // Find Sponsorship Tier
    const tier = event.sponsorships?.find(t => t.id === sponsorshipTierId);
    if (!tier) {
        throw new https_1.HttpsError("not-found", "Sponsorship tier not found");
    }
    // Check availability
    if (tier.soldCount >= tier.slots) {
        throw new https_1.HttpsError("resource-exhausted", "Sponsorship tier is sold out");
    }
    const amountCents = tier.priceCents;
    if (amountCents <= 0) {
        throw new https_1.HttpsError("invalid-argument", "Sponsorship price must be greater than 0");
    }
    const description = `Sponsorship: ${tier.name} - ${event.title}`;
    // 2. Create Pending Payment
    const payment = await (0, ledger_1.createPayment)({
        uid,
        provider: "stripe",
        amount: amountCents,
        currency: event.currency || "usd",
        purpose: "event",
        purposeRefId: eventId,
        status: "pending",
        providerRefs: { sponsorshipTierId }
    });
    // 3. Create Checkout Session
    const provider = new stripeProvider_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
        uid,
        amount: amountCents,
        currency: event.currency || "usd",
        purpose: "event",
        purposeRefId: eventId,
        successUrl,
        cancelUrl,
        mode: "payment",
        lineItemLabel: description,
        metadata: {
            eventId,
            sponsorshipTierId,
            paymentId: payment.id,
            checkoutType: "sponsorship"
        }
    });
    return {
        sessionId: session.sessionId,
        url: session.url,
        paymentId: payment.id
    };
});
