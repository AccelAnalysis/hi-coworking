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
exports.exchange_getOrganizationMembership = exports.exchange_getFounderAvailability = exports.exchange_createFoundingCheckout = void 0;
exports.validateFoundingPriceConfiguration = validateFoundingPriceConfiguration;
exports.processExchangeMembershipWebhook = processExchangeMembershipWebhook;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const ledger_1 = require("../payments/ledger");
const stripeProvider_1 = require("../payments/stripeProvider");
const credits_1 = require("./credits");
const model_1 = require("./model");
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
const foundingPriceId = (0, params_1.defineString)("STRIPE_FOUNDING_PRICE_ID");
const foundingProductId = (0, params_1.defineString)("STRIPE_FOUNDING_PRODUCT_ID");
const stripeExpectedMode = (0, params_1.defineString)("STRIPE_EXPECTED_MODE", { default: "test" });
const appUrl = (0, params_1.defineString)("APP_URL", { default: "http://localhost:3000" });
function validateFoundingPriceConfiguration(price, expected) {
    const failures = [];
    if (price.id !== expected.priceId)
        failures.push("price ID");
    if (!price.active)
        failures.push("active price");
    if (!price.productActive)
        failures.push("active product");
    if (price.productId !== expected.productId)
        failures.push("product ID");
    if (price.currency.toLowerCase() !== "usd")
        failures.push("USD currency");
    if (price.unitAmount !== model_1.FOUNDING_PRICE_CENTS)
        failures.push("$49.00 unit amount");
    if (price.type !== "recurring")
        failures.push("recurring price type");
    if (price.recurringInterval !== "month" || price.recurringIntervalCount !== 1) {
        failures.push("monthly recurring interval");
    }
    if (price.productName.trim() !== "Hi-Coworking Exchange Founding Membership") {
        failures.push("intended Founding Membership product");
    }
    if (!['test', 'live'].includes(expected.mode))
        failures.push("expected mode parameter");
    if (expected.mode === "test" && price.livemode)
        failures.push("test-mode price");
    if (expected.mode === "live" && !price.livemode)
        failures.push("live-mode price");
    if (failures.length) {
        throw new https_1.HttpsError("failed-precondition", `Founding Membership Stripe configuration failed validation: ${failures.join(", ")}.`);
    }
}
function getFoundingStripeClient() {
    const mockEnabled = process.env.EXCHANGE_STRIPE_MOCK_MODE === "1";
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
    if (mockEnabled) {
        if (!projectId.startsWith("demo-")) {
            throw new https_1.HttpsError("failed-precondition", "Mock Stripe is restricted to Firebase demo projects.");
        }
        return {
            async createCustomer() { return "cus_exchange_emulator"; },
            async getPriceConfiguration(priceId) {
                return {
                    id: priceId,
                    active: true,
                    livemode: false,
                    currency: "usd",
                    unitAmount: model_1.FOUNDING_PRICE_CENTS,
                    type: "recurring",
                    recurringInterval: "month",
                    recurringIntervalCount: 1,
                    productId: foundingProductId.value(),
                    productActive: true,
                    productName: "Hi-Coworking Exchange Founding Membership",
                };
            },
            async createCheckoutSession(input) {
                const separator = input.successUrl.includes("?") ? "&" : "?";
                return { sessionId: "cs_test_exchange_emulator", url: `${input.successUrl}${separator}mock=1`, provider: "stripe" };
            },
        };
    }
    return new stripeProvider_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
}
function getDb() { return admin.firestore(); }
function isPlatformAdmin(token) {
    return token.role === "admin" || token.role === "master";
}
async function requireOrganizationCheckoutAuthority(uid, token, organizationId) {
    const [orgSnap, memberSnap] = await Promise.all([
        getDb().collection("orgs").doc(organizationId).get(),
        getDb().collection("orgMembers").doc(`${organizationId}_${uid}`).get(),
    ]);
    if (!orgSnap.exists)
        throw new https_1.HttpsError("not-found", "Organization not found.");
    const memberRole = String(memberSnap.data()?.role || "");
    if (!isPlatformAdmin(token) && !["owner", "admin"].includes(memberRole)) {
        throw new https_1.HttpsError("permission-denied", "Only an organization owner or administrator can start checkout.");
    }
    return { organization: orgSnap.data() || {}, memberRole };
}
async function cleanupExpiredReservations(now) {
    const snap = await getDb().collection("founderReservations").where("expiresAt", "<=", now).limit(100).get();
    if (snap.empty)
        return;
    const counterRef = getDb().collection("founderAllocation").doc("state");
    await getDb().runTransaction(async (tx) => {
        const current = await tx.get(counterRef);
        let released = 0;
        for (const doc of snap.docs) {
            const fresh = await tx.get(doc.ref);
            if (fresh.exists && Number(fresh.data()?.expiresAt || 0) <= now) {
                tx.delete(doc.ref);
                released += 1;
            }
        }
        if (released) {
            tx.set(counterRef, {
                activeCount: Number(current.data()?.activeCount || 0),
                reservationCount: Math.max(0, Number(current.data()?.reservationCount || 0) - released),
                nextFounderNumber: Number(current.data()?.nextFounderNumber || 1),
                updatedAt: now,
            }, { merge: true });
        }
    });
}
async function reserveFounderSlot(organizationId, uid) {
    const now = Date.now();
    await cleanupExpiredReservations(now);
    const counterRef = getDb().collection("founderAllocation").doc("state");
    const reservationRef = getDb().collection("founderReservations").doc(organizationId);
    const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
    return getDb().runTransaction(async (tx) => {
        const [counterSnap, reservationSnap, membershipSnap] = await Promise.all([
            tx.get(counterRef), tx.get(reservationRef), tx.get(membershipRef),
        ]);
        const membership = membershipSnap.data() || {};
        if (["active", "trialing"].includes(String(membership.status))) {
            throw new https_1.HttpsError("already-exists", "This organization already has an active Founding Membership.");
        }
        if (reservationSnap.exists && Number(reservationSnap.data()?.expiresAt || 0) > now) {
            throw new https_1.HttpsError("already-exists", "A Founding Membership checkout is already pending for this organization.");
        }
        const activeCount = Number(counterSnap.data()?.activeCount || 0);
        const reservationCount = Number(counterSnap.data()?.reservationCount || 0);
        if (activeCount + reservationCount >= model_1.FOUNDING_MEMBER_LIMIT) {
            throw new https_1.HttpsError("resource-exhausted", "All 250 Founding Memberships are currently claimed or reserved.");
        }
        const expiresAt = now + model_1.CHECKOUT_RESERVATION_MS;
        tx.set(reservationRef, { organizationId, uid, createdAt: now, expiresAt, status: "pending" });
        tx.set(counterRef, {
            activeCount,
            reservationCount: reservationCount + 1,
            nextFounderNumber: Number(counterSnap.data()?.nextFounderNumber || 1),
            updatedAt: now,
        }, { merge: true });
        tx.set(membershipRef, {
            organizationId,
            plan: "founding",
            status: "checkout_pending",
            cancelAtPeriodEnd: false,
            protectedRateEligible: false,
            createdAt: Number(membership.createdAt || now),
            updatedAt: now,
            audit: { checkoutRequestedBy: uid },
        }, { merge: true });
        return expiresAt;
    });
}
async function releaseFounderReservation(organizationId, nextStatus = "free") {
    const reservationRef = getDb().collection("founderReservations").doc(organizationId);
    const counterRef = getDb().collection("founderAllocation").doc("state");
    const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
    await getDb().runTransaction(async (tx) => {
        const [reservation, counter, membership] = await Promise.all([
            tx.get(reservationRef), tx.get(counterRef), tx.get(membershipRef),
        ]);
        if (reservation.exists) {
            tx.delete(reservationRef);
            tx.set(counterRef, {
                activeCount: Number(counter.data()?.activeCount || 0),
                reservationCount: Math.max(0, Number(counter.data()?.reservationCount || 0) - 1),
                nextFounderNumber: Number(counter.data()?.nextFounderNumber || 1),
                updatedAt: Date.now(),
            }, { merge: true });
        }
        if (!membership.data()?.founderNumber) {
            tx.set(membershipRef, { plan: nextStatus === "free" ? "free" : "founding", status: nextStatus, updatedAt: Date.now() }, { merge: true });
        }
    });
}
exports.exchange_createFoundingCheckout = (0, https_1.onCall)(process.env.EXCHANGE_STRIPE_MOCK_MODE === "1"
    ? {}
    : { secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to start checkout.");
    const organizationId = typeof request.data?.organizationId === "string" ? request.data.organizationId.trim() : "";
    if (!organizationId)
        throw new https_1.HttpsError("invalid-argument", "organizationId is required.");
    const { organization } = await requireOrganizationCheckoutAuthority(request.auth.uid, request.auth.token, organizationId);
    const priceId = foundingPriceId.value().trim();
    const productId = foundingProductId.value().trim();
    const expectedMode = stripeExpectedMode.value().trim().toLowerCase();
    if (!priceId || !productId)
        throw new https_1.HttpsError("failed-precondition", "Founding Membership checkout is not configured.");
    const provider = getFoundingStripeClient();
    const priceConfiguration = await provider.getPriceConfiguration(priceId);
    validateFoundingPriceConfiguration(priceConfiguration, { priceId, productId, mode: expectedMode });
    await reserveFounderSlot(organizationId, request.auth.uid);
    const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
    try {
        const membershipSnap = await membershipRef.get();
        let customerId = String(membershipSnap.data()?.stripeCustomerId || "");
        if (!customerId) {
            customerId = await provider.createCustomer({
                email: String(request.auth.token.email || organization.billingEmail || ""),
                name: String(organization.name || ""),
                metadata: { organizationId },
            });
            await membershipRef.set({ stripeCustomerId: customerId, updatedAt: Date.now() }, { merge: true });
        }
        const payment = await (0, ledger_1.createPayment)({
            uid: request.auth.uid,
            orgId: organizationId,
            provider: "stripe",
            amount: model_1.FOUNDING_PRICE_CENTS,
            currency: "usd",
            purpose: "membership",
            purposeRefId: "exchange_founding",
            status: "pending",
        });
        const baseUrl = appUrl.value().replace(/\/$/, "");
        const session = await provider.createCheckoutSession({
            uid: request.auth.uid,
            customerId,
            amount: model_1.FOUNDING_PRICE_CENTS,
            currency: "usd",
            purpose: "membership",
            purposeRefId: "exchange_founding",
            mode: "subscription",
            successUrl: `${baseUrl}/exchange/membership/success?organizationId=${encodeURIComponent(organizationId)}`,
            cancelUrl: `${baseUrl}/exchange/membership/canceled?organizationId=${encodeURIComponent(organizationId)}`,
            metadata: {
                stripePriceId: priceId,
                paymentId: payment.id,
                plan: "exchange_founding",
                membershipKind: "exchange_founding",
                organizationId,
                requestedByUid: request.auth.uid,
            },
        });
        await membershipRef.set({ stripePriceId: priceId, checkoutSessionId: session.sessionId, updatedAt: Date.now() }, { merge: true });
        return { url: session.url };
    }
    catch (error) {
        await releaseFounderReservation(organizationId, "free");
        logger.error("Founding checkout creation failed", {
            organizationId,
            error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError("internal", "Unable to start Founding Membership checkout.");
    }
});
async function activateFounderMembership(metadata) {
    const organizationId = metadata.organizationId;
    if (!organizationId)
        return;
    const status = (0, model_1.mapStripeSubscriptionStatus)(metadata.subscriptionStatus || "active");
    const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
    const reservationRef = getDb().collection("founderReservations").doc(organizationId);
    const counterRef = getDb().collection("founderAllocation").doc("state");
    const subscriptionId = metadata.subscriptionId || "";
    const subscriptionRef = subscriptionId
        ? getDb().collection("stripeSubscriptions").doc(subscriptionId)
        : null;
    await getDb().runTransaction(async (tx) => {
        const [membershipSnap, reservationSnap, counterSnap, subscriptionSnap] = await Promise.all([
            tx.get(membershipRef), tx.get(reservationRef), tx.get(counterRef),
            subscriptionRef ? tx.get(subscriptionRef) : Promise.resolve(null),
        ]);
        const current = membershipSnap.data() || {};
        if (subscriptionSnap?.exists && subscriptionSnap.data()?.organizationId !== organizationId) {
            throw new Error("Stripe subscription is already attached to another organization");
        }
        if (current.stripeSubscriptionId
            && subscriptionId
            && current.stripeSubscriptionId !== subscriptionId
            && ["active", "trialing", "checkout_pending"].includes(String(current.status))) {
            throw new Error("Organization already has a different active or pending subscription");
        }
        const isActive = status === "active" || status === "trialing";
        let founderNumber = Number(current.founderNumber || 0);
        let activeCount = Number(counterSnap.data()?.activeCount || 0);
        let reservationCount = Number(counterSnap.data()?.reservationCount || 0);
        let nextFounderNumber = Number(counterSnap.data()?.nextFounderNumber || 1);
        if (isActive && !founderNumber) {
            const allocation = (0, model_1.allocateFounderNumber)({ activeCount, nextFounderNumber });
            founderNumber = allocation.founderNumber;
            nextFounderNumber = allocation.nextFounderNumber;
            activeCount = allocation.activeCount;
        }
        if (reservationSnap.exists) {
            tx.delete(reservationRef);
            reservationCount = Math.max(0, reservationCount - 1);
        }
        tx.set(counterRef, { activeCount, reservationCount, nextFounderNumber, updatedAt: Date.now() }, { merge: true });
        if (subscriptionRef) {
            tx.set(subscriptionRef, { subscriptionId, organizationId, updatedAt: Date.now(), createdAt: subscriptionSnap?.data()?.createdAt || Date.now() }, { merge: true });
        }
        tx.set(membershipRef, {
            organizationId,
            plan: "founding",
            status,
            stripeCustomerId: metadata.customerId || current.stripeCustomerId || "",
            stripeSubscriptionId: metadata.subscriptionId || current.stripeSubscriptionId || "",
            currentPeriodStart: Number(metadata.billingPeriodStart || current.currentPeriodStart || 0) || null,
            currentPeriodEnd: Number(metadata.billingPeriodEnd || current.currentPeriodEnd || 0) || null,
            cancelAtPeriodEnd: metadata.cancelAtPeriodEnd === "true",
            founderNumber: founderNumber || current.founderNumber || null,
            foundingActivatedAt: founderNumber && !current.foundingActivatedAt ? Date.now() : current.foundingActivatedAt || null,
            protectedRateEligible: isActive,
            createdAt: Number(current.createdAt || Date.now()),
            updatedAt: Date.now(),
        }, { merge: true });
    });
}
async function processExchangeMembershipWebhook(result) {
    const metadata = result.metadata || {};
    const isExchange = metadata.membershipKind === "exchange_founding" || metadata.plan === "exchange_founding";
    if (!isExchange)
        return false;
    const organizationId = metadata.organizationId;
    if (!organizationId)
        throw new Error("Exchange membership webhook missing organizationId");
    const eventRef = getDb().collection("organizationSubscriptionEvents").doc(result.eventId);
    try {
        await eventRef.create({
            eventId: result.eventId,
            organizationId,
            action: result.action,
            subscriptionId: metadata.subscriptionId || "",
            invoiceId: metadata.invoiceId || "",
            status: metadata.subscriptionStatus || result.status || "",
            createdAt: Date.now(),
        });
    }
    catch (error) {
        if (error.code === 6 || error.code === "already-exists") {
            return true;
        }
        throw error;
    }
    if (result.paymentId && result.action === "payment_succeeded") {
        await (0, ledger_1.updatePaymentStatus)(result.paymentId, "paid", {
            providerRefs: {
                stripeSubscriptionId: metadata.subscriptionId || "",
                stripeCustomerId: metadata.customerId || "",
                stripeInvoiceId: metadata.invoiceId || "",
            },
        });
    }
    if (result.action === "subscription_updated") {
        await activateFounderMembership(metadata);
    }
    else if (result.action === "payment_succeeded") {
        await getDb().collection("organizationMemberships").doc(organizationId).set({
            stripeCustomerId: metadata.customerId || "",
            stripeSubscriptionId: metadata.subscriptionId || "",
            updatedAt: Date.now(),
        }, { merge: true });
        if (metadata.invoiceId) {
            await (0, credits_1.grantFoundingInvoiceCredits)({ organizationId, invoiceId: metadata.invoiceId, eventId: result.eventId });
        }
    }
    else if (result.action === "payment_failed") {
        const nextStatus = metadata.reason === "subscription_cancelled" ? "canceled" : "past_due";
        await getDb().collection("organizationMemberships").doc(organizationId).set({ status: nextStatus, protectedRateEligible: false, updatedAt: Date.now() }, { merge: true });
    }
    else if (result.action === "checkout_expired") {
        await releaseFounderReservation(organizationId, "free");
    }
    return true;
}
exports.exchange_getFounderAvailability = (0, https_1.onCall)(async () => {
    await cleanupExpiredReservations(Date.now());
    const snap = await getDb().collection("founderAllocation").doc("state").get();
    const claimed = Math.min(model_1.FOUNDING_MEMBER_LIMIT, Number(snap.data()?.activeCount || 0));
    return { claimed, remaining: Math.max(0, model_1.FOUNDING_MEMBER_LIMIT - claimed), limit: model_1.FOUNDING_MEMBER_LIMIT };
});
exports.exchange_getOrganizationMembership = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to view organization membership.");
    const organizationId = typeof request.data?.organizationId === "string" ? request.data.organizationId.trim() : "";
    if (!organizationId)
        throw new https_1.HttpsError("invalid-argument", "organizationId is required.");
    await requireOrganizationCheckoutAuthority(request.auth.uid, request.auth.token, organizationId);
    const membership = await getDb().collection("organizationMemberships").doc(organizationId).get();
    const data = membership.data() || { organizationId, plan: "free", status: "free" };
    const creditBalance = await (0, credits_1.getUsableOrganizationCreditBalance)(organizationId);
    return { membership: data, capabilities: (0, model_1.resolveCapabilities)(data.plan === "founding" ? "founding" : "free", data.status || "free"), creditBalance };
});
