"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripe_createExchangeBillingPortalSession = exports.stripe_createExchangeCreditPackCheckout = exports.stripe_createExchangeMembershipCheckout = void 0;
exports.processExchangeStripeWebhookResult = processExchangeStripeWebhookResult;
const stripe_1 = __importDefault(require("stripe"));
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const ledger_1 = require("./payments/ledger");
const stripeProvider_1 = require("./payments/stripeProvider");
const exchangeCommercial_1 = require("./exchangeCommercial");
const exchangeCommercialPolicy_1 = require("./exchangeCommercialPolicy");
const security_1 = require("./exchange/security");
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
const safeId = zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const checkoutInput = zod_1.z.object({
    organizationId: safeId,
    key: safeId,
    returnPath: zod_1.z.string().trim().min(1).max(300),
}).strict();
function validatedReturnUrl(path) {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("..")) {
        throw new https_1.HttpsError("invalid-argument", "Return destination is invalid");
    }
    const allowed = ["/exchange", "/exchange/founding", "/exchange/wallet", "/dashboard"];
    if (!allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}?`))) {
        throw new https_1.HttpsError("invalid-argument", "Return destination is not allowed");
    }
    const base = process.env.APP_BASE_URL;
    if (!base || !/^https:\/\//.test(base)) {
        throw new https_1.HttpsError("failed-precondition", "Application return URL is not configured");
    }
    return new URL(path, base).toString();
}
async function stripeCustomer(input) {
    const db = (0, security_1.getDb)();
    const membershipRef = db.collection("exchangeMemberships").doc(input.organizationId);
    const [membershipSnapshot, orgSnapshot] = await Promise.all([
        membershipRef.get(),
        db.collection("orgs").doc(input.organizationId).get(),
    ]);
    const existing = membershipSnapshot.data()?.stripeCustomerId ?? orgSnapshot.data()?.stripeCustomerId;
    if (typeof existing === "string" && existing.startsWith("cus_"))
        return existing;
    const stripe = new stripe_1.default(stripeSecretKey.value(), { apiVersion: "2026-01-28.clover" });
    const customer = await stripe.customers.create({
        name: input.organizationName,
        email: input.email,
        metadata: { organizationId: input.organizationId, commercialDomain: "exchange" },
    });
    await membershipRef.set({
        organizationId: input.organizationId,
        stripeCustomerId: customer.id,
        updatedAt: Date.now(),
    }, { merge: true });
    return customer.id;
}
exports.stripe_createExchangeMembershipCheckout = (0, https_1.onCall)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = checkoutInput.parse(request.data);
    if (input.key !== "exchange_founding")
        throw new https_1.HttpsError("not-found", "Unknown Exchange membership key");
    const policy = await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)();
    const founding = policy.foundingMembership;
    if (!policy.featureFlags.exchangeFoundingCheckoutEnabled || !founding.enabled || !founding.checkoutEnabled
        || !founding.amountCents || !founding.stripePriceId) {
        throw new https_1.HttpsError("failed-precondition", "Founding enrollment is not open");
    }
    if (founding.foundingEnrollmentClosesAt && Date.now() >= founding.foundingEnrollmentClosesAt) {
        throw new https_1.HttpsError("failed-precondition", "Founding enrollment has closed");
    }
    const entitlements = await (0, exchangeCommercial_1.resolveExchangeEntitlements)({
        organizationId: input.organizationId,
        actor,
        requiredPermission: "manage_billing",
        requireVerified: true,
    });
    if (founding.foundingCapacity) {
        const foundingCount = await (0, security_1.getDb)().collection("exchangeMemberships").where("isFoundingMember", "==", true).limit(founding.foundingCapacity).get();
        if (foundingCount.size >= founding.foundingCapacity)
            throw new https_1.HttpsError("resource-exhausted", "Founding capacity is full");
    }
    const customerId = await stripeCustomer({
        organizationId: input.organizationId,
        organizationName: entitlements.organizationName,
        email: actor.email,
    });
    const payment = await (0, ledger_1.createPayment)({
        uid: actor.uid,
        orgId: input.organizationId,
        provider: "stripe",
        amount: founding.amountCents,
        currency: founding.currency,
        purpose: "membership",
        purposeRefId: "exchange_founding",
        status: "pending",
    });
    const provider = new stripeProvider_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const returnUrl = validatedReturnUrl(input.returnPath);
    const session = await provider.createCheckoutSession({
        uid: actor.uid,
        customerId,
        amount: founding.amountCents,
        currency: founding.currency,
        purpose: "membership",
        purposeRefId: "exchange_founding",
        mode: "subscription",
        successUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}checkout=success`,
        cancelUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}checkout=cancelled`,
        metadata: {
            paymentId: payment.id,
            organizationId: input.organizationId,
            commercialDomain: "exchange",
            exchangeProductType: "founding_membership",
            plan: "exchange_founding",
            stripePriceId: founding.stripePriceId,
            policyVersion: policy.policyVersion,
            pricingVersion: founding.pricingVersion,
            entitlementVersion: founding.entitlementVersion,
        },
    });
    await (0, security_1.getDb)().collection("exchangeCheckoutIntents").doc(session.sessionId).set({
        id: session.sessionId,
        organizationId: input.organizationId,
        purchaserUid: actor.uid,
        type: "founding_membership",
        key: input.key,
        amountCents: founding.amountCents,
        currency: founding.currency,
        stripeCustomerId: customerId,
        stripePriceId: founding.stripePriceId,
        paymentId: payment.id,
        policyVersion: policy.policyVersion,
        pricingVersion: founding.pricingVersion,
        status: "checkout_created",
        createdAt: Date.now(),
    });
    return { url: session.url, sessionId: session.sessionId, paymentId: payment.id };
});
exports.stripe_createExchangeCreditPackCheckout = (0, https_1.onCall)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = checkoutInput.parse(request.data);
    const policy = await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)();
    const pack = policy.creditPacks.find((candidate) => candidate.key === input.key);
    if (!pack)
        throw new https_1.HttpsError("not-found", "Unknown Exchange credit pack");
    if (!policy.featureFlags.exchangeCreditPurchasesEnabled || !pack.enabled || !pack.stripePriceId) {
        throw new https_1.HttpsError("failed-precondition", "Exchange credit purchasing is not open");
    }
    const entitlements = await (0, exchangeCommercial_1.resolveExchangeEntitlements)({
        organizationId: input.organizationId,
        actor,
        requiredPermission: "purchase_credits",
        requireVerified: true,
    });
    const customerId = await stripeCustomer({ organizationId: input.organizationId, organizationName: entitlements.organizationName, email: actor.email });
    const payment = await (0, ledger_1.createPayment)({
        uid: actor.uid,
        orgId: input.organizationId,
        provider: "stripe",
        amount: pack.amountCents,
        currency: pack.currency,
        purpose: "other",
        purposeRefId: pack.key,
        status: "pending",
    });
    const provider = new stripeProvider_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const returnUrl = validatedReturnUrl(input.returnPath);
    const session = await provider.createCheckoutSession({
        uid: actor.uid,
        customerId,
        amount: pack.amountCents,
        currency: pack.currency,
        purpose: "other",
        purposeRefId: pack.key,
        mode: "payment",
        successUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}checkout=success`,
        cancelUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}checkout=cancelled`,
        metadata: {
            paymentId: payment.id,
            organizationId: input.organizationId,
            commercialDomain: "exchange",
            exchangeProductType: "credit_pack",
            creditPackKey: pack.key,
            creditPackVersion: pack.version,
            credits: String(pack.credits),
            stripePriceId: pack.stripePriceId,
            policyVersion: policy.policyVersion,
        },
    });
    await (0, security_1.getDb)().collection("exchangeCheckoutIntents").doc(session.sessionId).set({
        id: session.sessionId,
        organizationId: input.organizationId,
        purchaserUid: actor.uid,
        type: "credit_pack",
        key: pack.key,
        credits: pack.credits,
        amountCents: pack.amountCents,
        currency: pack.currency,
        stripeCustomerId: customerId,
        stripePriceId: pack.stripePriceId,
        paymentId: payment.id,
        policyVersion: policy.policyVersion,
        packVersion: pack.version,
        status: "checkout_created",
        createdAt: Date.now(),
    });
    return { url: session.url, sessionId: session.sessionId, paymentId: payment.id };
});
exports.stripe_createExchangeBillingPortalSession = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = zod_1.z.object({ organizationId: safeId, returnPath: zod_1.z.string().min(1).max(300) }).strict().parse(request.data);
    await (0, exchangeCommercial_1.resolveExchangeEntitlements)({ organizationId: input.organizationId, actor, requiredPermission: "manage_billing" });
    const membership = await (0, security_1.getDb)().collection("exchangeMemberships").doc(input.organizationId).get();
    const customerId = membership.data()?.stripeCustomerId;
    if (typeof customerId !== "string" || !customerId.startsWith("cus_")) {
        throw new https_1.HttpsError("failed-precondition", "Stripe billing customer is not configured");
    }
    const stripe = new stripe_1.default(stripeSecretKey.value(), { apiVersion: "2026-01-28.clover" });
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: validatedReturnUrl(input.returnPath) });
    return { url: session.url };
});
function numberMetadata(value) {
    if (!value || !/^\d+$/.test(value))
        return undefined;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
}
/** Called only after the existing signature verifier and webhook idempotency claim. */
async function processExchangeStripeWebhookResult(result) {
    const metadata = result.metadata ?? {};
    const eventType = metadata.eventType;
    const db = (0, security_1.getDb)();
    let organizationId = metadata.organizationId;
    if (!organizationId && metadata.subscriptionId) {
        const membership = await db.collection("exchangeMemberships").where("stripeSubscriptionId", "==", metadata.subscriptionId).limit(1).get();
        organizationId = membership.docs[0]?.id;
    }
    let checkoutIntent;
    if (metadata.sessionId)
        checkoutIntent = await db.collection("exchangeCheckoutIntents").doc(metadata.sessionId).get();
    if (!checkoutIntent?.exists && metadata.paymentIntentId) {
        const matches = await db.collection("exchangeCheckoutIntents").where("stripePaymentIntentId", "==", metadata.paymentIntentId).limit(1).get();
        checkoutIntent = matches.docs[0];
    }
    if (!organizationId && checkoutIntent?.exists)
        organizationId = String(checkoutIntent.data()?.organizationId ?? "");
    const isExchange = metadata.commercialDomain === "exchange" || Boolean(organizationId) || checkoutIntent?.exists === true;
    if (!isExchange)
        return false;
    if (result.paymentId && result.status)
        await (0, ledger_1.updatePaymentStatus)(result.paymentId, result.status);
    if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
        if (!metadata.sessionId)
            throw new Error("Exchange checkout webhook is missing session id");
        const intentRef = db.collection("exchangeCheckoutIntents").doc(metadata.sessionId);
        const intentSnapshot = await intentRef.get();
        if (!intentSnapshot.exists)
            throw new Error("Exchange checkout intent is missing");
        const intent = intentSnapshot.data();
        await intentRef.update({
            status: metadata.paymentStatus === "paid" || eventType.endsWith("succeeded") ? "paid" : "awaiting_payment",
            stripePaymentIntentId: metadata.paymentIntentId || null,
            stripeSubscriptionId: metadata.subscriptionId || null,
            updatedAt: Date.now(),
        });
        if (intent.type === "credit_pack" && (metadata.paymentStatus === "paid" || eventType.endsWith("succeeded"))) {
            const grantedAt = Date.now();
            const grant = await (0, exchangeCommercial_1.grantOrganizationCreditsOnce)({
                organizationId: intent.organizationId,
                source: "purchase",
                credits: intent.credits,
                grantedAt,
                expiresAt: (0, exchangeCommercial_1.addCalendarMonths)(grantedAt, 12),
                sourceReferenceId: metadata.sessionId,
                idempotencyKey: result.eventId,
                policyVersion: intent.policyVersion,
                actorUid: intent.purchaserUid,
            });
            await intentRef.update({ creditGrantId: grant.grantId, updatedAt: Date.now() });
        }
    }
    if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated" || eventType === "customer.subscription.deleted") {
        if (!organizationId || !metadata.subscriptionId)
            throw new Error("Exchange subscription event is missing organization identity");
        const statusMap = {
            active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due",
            canceled: "cancelled", incomplete: "incomplete", incomplete_expired: "cancelled", paused: "paused",
        };
        const status = statusMap[metadata.subscriptionStatus ?? ""] ?? "incomplete";
        const policy = await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)(db);
        const now = Date.now();
        const membershipRef = db.collection("exchangeMemberships").doc(organizationId);
        const existingMembership = await membershipRef.get();
        const existingData = existingMembership.data() ?? {};
        await db.collection("exchangeMemberships").doc(organizationId).set({
            organizationId,
            tier: "founding",
            status,
            isFoundingMember: true,
            foundingRecognitionRetained: status === "cancelled"
                ? policy.foundingMembership.retainRecognitionAfterCancellation
                : true,
            startedAt: existingData.startedAt ?? numberMetadata(metadata.subscriptionCreatedAt) ?? now,
            ...(numberMetadata(metadata.currentPeriodStart) ? { currentPeriodStart: numberMetadata(metadata.currentPeriodStart) } : {}),
            ...(numberMetadata(metadata.currentPeriodEnd) ? { currentPeriodEnd: numberMetadata(metadata.currentPeriodEnd) } : {}),
            ...(status === "cancelled" ? { cancelledAt: now } : {}),
            stripeCustomerId: metadata.customerId,
            stripeSubscriptionId: metadata.subscriptionId,
            stripePriceId: metadata.stripePriceId ?? policy.foundingMembership.stripePriceId,
            pricingVersion: metadata.pricingVersion ?? policy.foundingMembership.pricingVersion,
            entitlementVersion: metadata.entitlementVersion ?? policy.foundingMembership.entitlementVersion,
            createdAt: existingData.createdAt ?? now,
            updatedAt: now,
        }, { merge: true });
    }
    if (eventType === "invoice.paid" && organizationId && metadata.invoiceId) {
        const policy = await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)(db);
        const included = policy.foundingMembership.includedCreditsPerPeriod;
        if (included > 0) {
            const periodStart = numberMetadata(metadata.currentPeriodStart) ?? Date.now();
            await (0, exchangeCommercial_1.grantOrganizationCreditsOnce)({
                organizationId,
                source: "subscription_allocation",
                credits: included,
                grantedAt: periodStart,
                expiresAt: (0, exchangeCommercial_1.addCalendarMonths)(periodStart, 12),
                sourceReferenceId: metadata.invoiceId,
                idempotencyKey: result.eventId,
                policyVersion: policy.policyVersion,
            });
        }
    }
    if (eventType === "invoice.payment_failed" && organizationId) {
        await db.collection("exchangeMemberships").doc(organizationId).set({ status: "past_due", updatedAt: Date.now() }, { merge: true });
    }
    if ((result.action === "refund" || eventType === "charge.dispute.created") && checkoutIntent?.exists) {
        const grantId = checkoutIntent.data()?.creditGrantId;
        if (typeof grantId === "string") {
            await (0, exchangeCommercial_1.reverseCreditGrantAfterPaymentReversal)({ organizationId: String(checkoutIntent.data()?.organizationId), grantId, eventId: result.eventId });
        }
        await checkoutIntent.ref.update({ status: eventType === "charge.dispute.created" ? "disputed" : "refunded", updatedAt: Date.now() });
    }
    if (eventType === "checkout.session.async_payment_failed" && metadata.sessionId) {
        await db.collection("exchangeCheckoutIntents").doc(metadata.sessionId).update({ status: "failed", updatedAt: Date.now() });
    }
    return true;
}
