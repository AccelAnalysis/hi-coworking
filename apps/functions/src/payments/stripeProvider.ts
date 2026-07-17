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
import { getTierByPriceId } from "./stripeConfig";
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

  async getSubscriptionMembershipContext(
    subscriptionId: string
  ): Promise<{
    subscriptionId: string;
    uid?: string;
    plan?: string;
    customerId?: string;
    periodStart?: number;
    periodEnd?: number;
    metadata?: Record<string, string>;
  } | null> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      return this.toSubscriptionMembershipContext(subscription);
    } catch (err) {
      logger.error("Failed to retrieve Stripe subscription", { subscriptionId, err });
      return null;
    }
  }

  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const isSubscription = input.mode !== "payment";
    
    // Construct line item
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = isSubscription
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

    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      mode: isSubscription ? "subscription" : "payment",
      customer: input.customerId || undefined,
      customer_email: input.customerId ? undefined : input.metadata?.email,
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
        metadata: sessionConfig.metadata,
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

  async createCustomer(input: {
    email?: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<string> {
    const customer = await this.stripe.customers.create({
      email: input.email || undefined,
      name: input.name || undefined,
      metadata: input.metadata,
    });
    return customer.id;
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
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionMetadata = session.metadata || {};
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : "";
        const subscriptionContext = subscriptionId
          ? await this.getSubscriptionMembershipContext(subscriptionId)
          : null;
        return {
          eventId: event.id,
          action: "payment_succeeded",
          paymentId: sessionMetadata.paymentId || undefined,
          status: "paid",
          metadata: {
            ...sessionMetadata,
            uid: sessionMetadata.uid || subscriptionContext?.uid || "",
            plan: sessionMetadata.plan || subscriptionContext?.plan || "",
            subscriptionId,
            customerId:
              typeof session.customer === "string"
                ? session.customer
                : subscriptionContext?.customerId || "",
            billingPeriodStart: subscriptionContext?.periodStart?.toString() || "",
            billingPeriodEnd: subscriptionContext?.periodEnd?.toString() || "",
            checkoutSessionId: session.id,
          },
        };
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionMetadata = session.metadata || {};
        return {
          eventId: event.id,
          action: "checkout_expired",
          paymentId: sessionMetadata.paymentId || undefined,
          status: "failed",
          metadata: {
            ...sessionMetadata,
            checkoutSessionId: session.id,
            uid: sessionMetadata.uid || "",
            reason: "checkout_expired",
          },
        };
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionMetadata = session.metadata || {};
        return {
          eventId: event.id,
          action: "payment_failed",
          paymentId: sessionMetadata.paymentId || undefined,
          status: "failed",
          metadata: {
            ...sessionMetadata,
            checkoutSessionId: session.id,
            uid: sessionMetadata.uid || "",
            reason: "async_payment_failed",
          },
        };
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = this.getInvoiceSubscriptionId(invoice);
        const subscriptionContext = subscriptionId
          ? await this.getSubscriptionMembershipContext(subscriptionId)
          : null;
        return {
          eventId: event.id,
          action: "payment_succeeded",
          status: "paid",
          metadata: {
            ...(subscriptionContext?.metadata || {}),
            subscriptionId,
            uid: subscriptionContext?.uid || "",
            plan: subscriptionContext?.plan || "",
            customerId:
              typeof invoice.customer === "string"
                ? invoice.customer
                : subscriptionContext?.customerId || "",
            billingPeriodStart: subscriptionContext?.periodStart?.toString() || "",
            billingPeriodEnd: subscriptionContext?.periodEnd?.toString() || "",
            invoiceId: invoice.id,
          },
        };
      }

      case "invoice.payment_failed": {
        const failedInvoice = event.data.object as Stripe.Invoice;
        const subscriptionId = this.getInvoiceSubscriptionId(failedInvoice);
        const subscriptionContext = subscriptionId
          ? await this.getSubscriptionMembershipContext(subscriptionId)
          : null;
        return {
          eventId: event.id,
          action: "payment_failed",
          status: "failed",
          metadata: {
            ...(subscriptionContext?.metadata || {}),
            subscriptionId,
            uid: subscriptionContext?.uid || "",
          },
        };
      }

      case "customer.subscription.deleted": {
        const deletedSub = event.data.object as Stripe.Subscription;
        return {
          eventId: event.id,
          action: "payment_failed",
          status: "failed",
          metadata: {
            ...(deletedSub.metadata || {}),
            subscriptionId: deletedSub.id,
            uid: deletedSub.metadata?.uid || "",
            reason: "subscription_cancelled",
          },
        };
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const context = this.toSubscriptionMembershipContext(subscription);
        return {
          eventId: event.id,
          action: "subscription_updated",
          metadata: {
            ...subscription.metadata,
            subscriptionId: subscription.id,
            customerId: context.customerId || "",
            subscriptionStatus: subscription.status,
            billingPeriodStart: context.periodStart?.toString() || "",
            billingPeriodEnd: context.periodEnd?.toString() || "",
            cancelAtPeriodEnd: subscription.cancel_at_period_end ? "true" : "false",
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

  private getInvoiceSubscriptionId(invoice: Stripe.Invoice): string {
    const invoiceRecord = invoice as unknown as Record<string, unknown>;
    if (typeof invoiceRecord.subscription === "string") {
      return invoiceRecord.subscription;
    }

    const parent = invoiceRecord.parent as Record<string, unknown> | undefined;
    const subscriptionDetails = parent?.subscription_details as Record<string, unknown> | undefined;
    const subscription = subscriptionDetails?.subscription;
    return typeof subscription === "string" ? subscription : "";
  }

  private toSubscriptionMembershipContext(subscription: Stripe.Subscription): {
    subscriptionId: string;
    uid?: string;
    plan?: string;
    customerId?: string;
    periodStart?: number;
    periodEnd?: number;
    metadata?: Record<string, string>;
  } {
    const subscriptionRecord = subscription as unknown as Record<string, unknown>;
    const firstItem = subscription.items.data[0];
    const firstItemRecord = firstItem as unknown as Record<string, unknown> | undefined;
    const priceId = firstItem?.price.id;
    const tier = priceId ? getTierByPriceId(priceId) : undefined;
    const currentPeriodStart =
      subscriptionRecord.current_period_start ?? firstItemRecord?.current_period_start;
    const currentPeriodEnd =
      subscriptionRecord.current_period_end ?? firstItemRecord?.current_period_end;

    return {
      subscriptionId: subscription.id,
      uid: subscription.metadata?.uid || undefined,
      plan: subscription.metadata?.plan || tier?.id,
      customerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : undefined,
      periodStart:
        typeof currentPeriodStart === "number"
          ? currentPeriodStart * 1000
          : undefined,
      periodEnd:
        typeof currentPeriodEnd === "number"
          ? currentPeriodEnd * 1000
          : undefined,
      metadata: subscription.metadata,
    };
  }
}
