/**
 * Stripe Provider Adapter (PR-10)
 *
 * Implements the PaymentProvider interface for Stripe.
 * Handles checkout session creation, webhook parsing, status reconciliation,
 * and booking refund operations.
 */

import Stripe from "stripe";
import * as logger from "firebase-functions/logger";
import type {
  PaymentProvider,
  CheckoutSessionInput,
  CheckoutSessionResult,
  WebhookResult,
  PaymentStatus,
} from "./types";

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.stripe = new Stripe(secretKey, { apiVersion: "2026-01-28.clover" });
    this.webhookSecret = webhookSecret;
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const isSubscription = input.mode !== "payment";
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = isSubscription
      ? { price: input.metadata?.stripePriceId, quantity: 1 }
      : {
          price_data: {
            currency: input.currency,
            product_data: { name: input.lineItemLabel || "Payment" },
            unit_amount: input.amount,
          },
          quantity: 1,
        };

    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      mode: isSubscription ? "subscription" : "payment",
      customer_email: input.metadata?.email,
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
        metadata: { uid: input.uid, plan: input.metadata?.plan || "" },
      };
    }

    const session = await this.stripe.checkout.sessions.create(sessionConfig);
    logger.info("Stripe checkout session created", { sessionId: session.id, uid: input.uid, mode: sessionConfig.mode });
    return { sessionId: session.id, url: session.url || "", provider: "stripe" };
  }

  async refundCheckoutPayment(input: {
    paymentIntentId?: string;
    checkoutSessionId?: string;
    amountCents?: number;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<{ refundId: string; paymentIntentId: string; amountCents: number }> {
    let paymentIntentId = input.paymentIntentId || "";
    if (!paymentIntentId && input.checkoutSessionId) {
      const session = await this.stripe.checkout.sessions.retrieve(input.checkoutSessionId);
      paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : "";
    }
    if (!paymentIntentId) throw new Error("Stripe payment intent is unavailable for this booking payment.");

    const refund = await this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(typeof input.amountCents === "number" ? { amount: input.amountCents } : {}),
      metadata: input.metadata,
    }, { idempotencyKey: input.idempotencyKey });

    return {
      refundId: refund.id,
      paymentIntentId,
      amountCents: refund.amount,
    };
  }

  async handleWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookResult> {
    const sig = headers["stripe-signature"];
    if (!sig) throw new Error("Missing stripe-signature header");

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
    } catch (err) {
      logger.error("Stripe webhook signature verification failed", { err });
      throw new Error("Invalid webhook signature");
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
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
            checkoutSessionId: session.id,
            paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : "",
            subscriptionId: typeof session.subscription === "string" ? session.subscription : "",
            customerId: typeof session.customer === "string" ? session.customer : "",
          },
        };
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          eventId: event.id,
          action: "payment_succeeded",
          status: "paid",
          metadata: {
            subscriptionId: (invoice as unknown as Record<string, unknown>).subscription as string || "",
            customerId: typeof invoice.customer === "string" ? invoice.customer : "",
          },
        };
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          eventId: event.id,
          action: "payment_failed",
          status: "failed",
          metadata: { subscriptionId: (invoice as unknown as Record<string, unknown>).subscription as string || "" },
        };
      }
      case "customer.subscription.deleted": {
        const deletedSub = event.data.object as Stripe.Subscription;
        return {
          eventId: event.id,
          action: "payment_failed",
          status: "failed",
          metadata: { subscriptionId: deletedSub.id, uid: deletedSub.metadata?.uid || "", reason: "subscription_cancelled" },
        };
      }
      default:
        logger.info("Unhandled Stripe event type", { type: event.type });
        return { eventId: event.id, action: "unknown" };
    }
  }

  async reconcileStatus(providerRefs: Record<string, string>): Promise<PaymentStatus> {
    const subscriptionId = providerRefs.subscriptionId;
    if (!subscriptionId) return "pending";
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      if (sub.status === "active" || sub.status === "trialing") return "paid";
      if (sub.status === "canceled" || sub.status === "incomplete_expired") return "failed";
      return "pending";
    } catch (err) {
      logger.error("Failed to reconcile Stripe subscription", { subscriptionId, err });
      return "pending";
    }
  }
}
