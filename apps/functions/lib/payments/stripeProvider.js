"use strict";
/**
 * Stripe Provider Adapter (PR-10)
 *
 * Implements the PaymentProvider interface for Stripe.
 * Handles checkout session creation, webhook parsing, and status reconciliation.
 *
 * Requires:
 *   - STRIPE_SECRET_KEY secret (set via firebase functions:secrets:set)
 *   - STRIPE_WEBHOOK_SECRET secret
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeProvider = void 0;
const stripe_1 = __importDefault(require("stripe"));
const logger = __importStar(require("firebase-functions/logger"));
class StripeProvider {
    constructor(secretKey, webhookSecret) {
        this.name = "stripe";
        this.stripe = new stripe_1.default(secretKey, { apiVersion: "2026-01-28.clover" });
        this.webhookSecret = webhookSecret;
    }
    async createCheckoutSession(input) {
        const isSubscription = input.mode !== "payment";
        // Construct line item
        const configuredPriceId = input.metadata?.stripePriceId;
        const lineItem = configuredPriceId
            ? { price: configuredPriceId, quantity: 1 }
            : {
                price_data: {
                    currency: input.currency,
                    product_data: {
                        name: input.lineItemLabel || "Payment",
                    },
                    unit_amount: input.amount, // amount in cents
                },
                quantity: 1,
            };
        const sessionConfig = {
            mode: isSubscription ? "subscription" : "payment",
            ...(input.customerId
                ? { customer: input.customerId }
                : { customer_email: input.metadata?.email }),
            line_items: [lineItem],
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            metadata: {
                ...(input.metadata || {}),
                uid: input.uid,
                paymentId: input.metadata?.paymentId || "",
                purpose: input.purpose,
                purposeRefId: input.purposeRefId || "",
            },
        };
        if (isSubscription) {
            sessionConfig.subscription_data = {
                metadata: {
                    uid: input.uid,
                    plan: input.metadata?.plan || "",
                    organizationId: input.metadata?.organizationId || "",
                    commercialDomain: input.metadata?.commercialDomain || "",
                    policyVersion: input.metadata?.policyVersion || "",
                },
            };
        }
        const session = await this.stripe.checkout.sessions.create(sessionConfig);
        logger.info("Stripe checkout session created", {
            sessionId: session.id,
            uid: input.uid,
            mode: sessionConfig.mode,
        });
        return {
            sessionId: session.id,
            url: session.url || "",
            provider: "stripe",
        };
    }
    async handleWebhook(rawBody, headers) {
        const sig = headers["stripe-signature"];
        if (!sig) {
            throw new Error("Missing stripe-signature header");
        }
        let event;
        try {
            event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
        }
        catch (err) {
            logger.error("Stripe webhook signature verification failed", { err });
            throw new Error("Invalid webhook signature");
        }
        switch (event.type) {
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded":
            case "checkout.session.async_payment_failed": {
                const session = event.data.object;
                const sessionMetadata = session.metadata || {};
                const failed = event.type === "checkout.session.async_payment_failed";
                return {
                    eventId: event.id,
                    action: failed ? "payment_failed" : "payment_succeeded",
                    paymentId: sessionMetadata.paymentId || undefined,
                    status: failed ? "failed" : session.payment_status === "paid" ? "paid" : "pending",
                    metadata: {
                        ...sessionMetadata,
                        eventType: event.type,
                        sessionId: session.id,
                        paymentStatus: session.payment_status,
                        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : "",
                        uid: sessionMetadata.uid || "",
                        plan: sessionMetadata.plan || "",
                        subscriptionId: typeof session.subscription === "string"
                            ? session.subscription
                            : "",
                        customerId: typeof session.customer === "string"
                            ? session.customer
                            : "",
                    },
                };
            }
            case "invoice.paid":
            case "invoice.payment_succeeded": {
                const invoice = event.data.object;
                const invoiceRecord = invoice;
                const lines = invoice.lines?.data ?? [];
                const period = lines[0]?.period;
                return {
                    eventId: event.id,
                    action: "payment_succeeded",
                    status: "paid",
                    metadata: {
                        eventType: event.type,
                        invoiceId: invoice.id,
                        subscriptionId: invoiceRecord.subscription || "",
                        customerId: typeof invoice.customer === "string"
                            ? invoice.customer
                            : "",
                        currentPeriodStart: period?.start ? String(period.start * 1000) : "",
                        currentPeriodEnd: period?.end ? String(period.end * 1000) : "",
                    },
                };
            }
            case "invoice.payment_failed": {
                const failedInvoice = event.data.object;
                return {
                    eventId: event.id,
                    action: "payment_failed",
                    status: "failed",
                    metadata: {
                        eventType: event.type,
                        invoiceId: failedInvoice.id,
                        subscriptionId: failedInvoice.subscription || "",
                    },
                };
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
                const deletedSub = event.data.object;
                const subscriptionRecord = deletedSub;
                const item = deletedSub.items.data[0];
                const cancelled = event.type === "customer.subscription.deleted";
                return {
                    eventId: event.id,
                    action: cancelled ? "payment_failed" : "payment_succeeded",
                    status: cancelled ? "failed" : deletedSub.status === "active" || deletedSub.status === "trialing" ? "paid" : "pending",
                    metadata: {
                        ...deletedSub.metadata,
                        eventType: event.type,
                        subscriptionId: deletedSub.id,
                        uid: deletedSub.metadata?.uid || "",
                        reason: cancelled ? "subscription_cancelled" : "subscription_updated",
                        subscriptionStatus: deletedSub.status,
                        subscriptionCreatedAt: String(deletedSub.created * 1000),
                        currentPeriodStart: item?.current_period_start ? String(item.current_period_start * 1000) : "",
                        currentPeriodEnd: item?.current_period_end ? String(item.current_period_end * 1000) : "",
                        customerId: typeof deletedSub.customer === "string" ? deletedSub.customer : "",
                        stripePriceId: item?.price?.id ?? "",
                        cancelAtPeriodEnd: String(Boolean(subscriptionRecord.cancel_at_period_end)),
                    },
                };
            }
            case "charge.refunded":
            case "refund.created":
            case "charge.dispute.created":
            case "charge.dispute.closed": {
                const object = event.data.object;
                const metadata = (object.metadata && typeof object.metadata === "object"
                    ? object.metadata
                    : {});
                const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : "";
                return {
                    eventId: event.id,
                    action: event.type === "charge.dispute.closed" ? "unknown" : "refund",
                    status: event.type === "charge.dispute.closed" ? undefined : "refunded",
                    metadata: {
                        ...metadata,
                        eventType: event.type,
                        paymentIntentId: paymentIntent,
                    },
                };
            }
            default:
                logger.info("Unhandled Stripe event type", { type: event.type });
                return {
                    eventId: event.id,
                    action: "unknown",
                };
        }
    }
    async reconcileStatus(providerRefs) {
        const subscriptionId = providerRefs.subscriptionId;
        if (!subscriptionId) {
            logger.warn("No subscriptionId in providerRefs for reconciliation");
            return "pending";
        }
        try {
            const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
            switch (sub.status) {
                case "active":
                case "trialing":
                    return "paid";
                case "past_due":
                case "unpaid":
                    return "pending";
                case "canceled":
                case "incomplete_expired":
                    return "failed";
                default:
                    return "pending";
            }
        }
        catch (err) {
            logger.error("Failed to reconcile Stripe subscription", {
                subscriptionId,
                err,
            });
            return "pending";
        }
    }
}
exports.StripeProvider = StripeProvider;
