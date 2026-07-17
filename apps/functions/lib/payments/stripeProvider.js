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
    async createCustomer(input) {
        const customer = await this.stripe.customers.create({
            email: input.email || undefined,
            name: input.name || undefined,
            metadata: input.metadata,
        });
        return customer.id;
    }
    async getPriceConfiguration(priceId) {
        const price = await this.stripe.prices.retrieve(priceId, { expand: ["product"] });
        const product = price.product;
        if (typeof product === "string" || product.deleted) {
            throw new Error("Configured Stripe product is unavailable");
        }
        return {
            id: price.id,
            active: price.active,
            livemode: price.livemode,
            currency: price.currency,
            unitAmount: price.unit_amount,
            type: price.type,
            recurringInterval: price.recurring?.interval || null,
            recurringIntervalCount: price.recurring?.interval_count || null,
            productId: product.id,
            productActive: product.active,
            productName: product.name,
        };
    }
    async createCheckoutSession(input) {
        const isSubscription = input.mode !== "payment";
        // Construct line item
        const lineItem = isSubscription
            ? {
                price: input.metadata?.stripePriceId,
                quantity: 1,
            }
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
                    ...(input.metadata || {}),
                    uid: input.uid,
                    plan: input.metadata?.plan || "",
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
            case "checkout.session.completed": {
                const session = event.data.object;
                const sessionMetadata = session.metadata || {};
                return {
                    eventId: event.id,
                    action: "payment_succeeded",
                    paymentId: sessionMetadata.paymentId || undefined,
                    status: "paid",
                    metadata: {
                        ...sessionMetadata,
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
                const subscriptionMetadata = invoiceRecord.parent?.subscription_details?.metadata || {};
                return {
                    eventId: event.id,
                    action: "payment_succeeded",
                    status: "paid",
                    metadata: {
                        ...subscriptionMetadata,
                        invoiceId: invoice.id,
                        subscriptionId: invoiceRecord.subscription || invoiceRecord.parent?.subscription_details?.subscription || "",
                        customerId: typeof invoice.customer === "string"
                            ? invoice.customer
                            : "",
                    },
                };
            }
            case "invoice.payment_failed": {
                const failedInvoice = event.data.object;
                const failedRecord = failedInvoice;
                return {
                    eventId: event.id,
                    action: "payment_failed",
                    status: "failed",
                    metadata: {
                        ...(failedRecord.parent?.subscription_details?.metadata || {}),
                        invoiceId: failedInvoice.id,
                        subscriptionId: failedRecord.subscription || failedRecord.parent?.subscription_details?.subscription || "",
                    },
                };
            }
            case "customer.subscription.deleted": {
                const deletedSub = event.data.object;
                return {
                    eventId: event.id,
                    action: "payment_failed",
                    status: "failed",
                    metadata: {
                        ...(deletedSub.metadata || {}),
                        subscriptionId: deletedSub.id,
                        customerId: typeof deletedSub.customer === "string" ? deletedSub.customer : "",
                        subscriptionStatus: deletedSub.status,
                        cancelAtPeriodEnd: String(deletedSub.cancel_at_period_end),
                        uid: deletedSub.metadata?.uid || "",
                        reason: "subscription_cancelled",
                    },
                };
            }
            case "customer.subscription.created":
            case "customer.subscription.updated": {
                const subscription = event.data.object;
                const item = subscription.items.data[0];
                return {
                    eventId: event.id,
                    action: "subscription_updated",
                    status: subscription.status === "active" || subscription.status === "trialing" ? "paid" : "pending",
                    metadata: {
                        ...(subscription.metadata || {}),
                        subscriptionId: subscription.id,
                        customerId: typeof subscription.customer === "string" ? subscription.customer : "",
                        subscriptionStatus: subscription.status,
                        billingPeriodStart: String(item?.current_period_start ? item.current_period_start * 1000 : ""),
                        billingPeriodEnd: String(item?.current_period_end ? item.current_period_end * 1000 : ""),
                        cancelAtPeriodEnd: String(subscription.cancel_at_period_end),
                    },
                };
            }
            case "checkout.session.expired": {
                const session = event.data.object;
                return {
                    eventId: event.id,
                    action: "checkout_expired",
                    metadata: { ...(session.metadata || {}) },
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
