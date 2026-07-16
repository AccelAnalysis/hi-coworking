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

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const isSubscription = input.mode !== "payment";
    
    // Construct line item
    const configuredPriceId = input.metadata?.stripePriceId;
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = configuredPriceId
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

    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
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

  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<WebhookResult> {
    const sig = headers["stripe-signature"];
    if (!sig) {
      throw new Error("Missing stripe-signature header");
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        sig,
        this.webhookSecret
      );
    } catch (err) {
      logger.error("Stripe webhook signature verification failed", { err });
      throw new Error("Invalid webhook signature");
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
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
            subscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : "",
            customerId:
              typeof session.customer === "string"
                ? session.customer
                : "",
          },
        };
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceRecord = invoice as unknown as Record<string, unknown>;
        const lines = invoice.lines?.data ?? [];
        const period = lines[0]?.period;
        return {
          eventId: event.id,
          action: "payment_succeeded",
          status: "paid",
          metadata: {
            eventType: event.type,
            invoiceId: invoice.id,
            subscriptionId: invoiceRecord.subscription as string || "",
            customerId:
              typeof invoice.customer === "string"
                ? invoice.customer
                : "",
            currentPeriodStart: period?.start ? String(period.start * 1_000) : "",
            currentPeriodEnd: period?.end ? String(period.end * 1_000) : "",
          },
        };
      }

      case "invoice.payment_failed": {
        const failedInvoice = event.data.object as Stripe.Invoice;
        return {
          eventId: event.id,
          action: "payment_failed",
          status: "failed",
          metadata: {
            eventType: event.type,
            invoiceId: failedInvoice.id,
            subscriptionId: (failedInvoice as unknown as Record<string, unknown>).subscription as string || "",
          },
        };
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const deletedSub = event.data.object as Stripe.Subscription;
        const subscriptionRecord = deletedSub as unknown as Record<string, unknown>;
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
            subscriptionCreatedAt: String(deletedSub.created * 1_000),
            currentPeriodStart: item?.current_period_start ? String(item.current_period_start * 1_000) : "",
            currentPeriodEnd: item?.current_period_end ? String(item.current_period_end * 1_000) : "",
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
        const object = event.data.object as unknown as Record<string, unknown>;
        const metadata = (object.metadata && typeof object.metadata === "object"
          ? object.metadata
          : {}) as Record<string, string>;
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

  async reconcileStatus(
    providerRefs: Record<string, string>
  ): Promise<PaymentStatus> {
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
    } catch (err) {
      logger.error("Failed to reconcile Stripe subscription", {
        subscriptionId,
        err,
      });
      return "pending";
    }
  }
}
