/**
 * Stripe Provider Adapter (PR-10)
 *
 * Implements the PaymentProvider interface for Stripe.
 * Handles checkout session creation, webhook parsing, status reconciliation,
 * and idempotent booking refunds.
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

function safeMetadataValue(value?: string) {
  return (value || "").replace(/[^A-Za-z0-9_-]/g, "");
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session) {
  if (typeof session.payment_intent === "string") return session.payment_intent;
  return session.payment_intent?.id || "";
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.stripe = new Stripe(secretKey, { apiVersion: "2026-01-28.clover" });
    this.webhookSecret = webhookSecret;
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const isSubscription = input.mode !== "payment";
    const checkoutMetadata = {
      ...(input.metadata || {}),
      uid: input.uid,
      paymentId: input.metadata?.paymentId || "",
      purpose: input.purpose,
      purposeRefId: input.purposeRefId || "",
    };
    const recurringInterval = input.metadata?.recurringInterval === "year" ? "year" : "month";
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = isSubscription && input.metadata?.pricingMode === "price_data"
      ? {
          price_data: {
            currency: input.currency,
            product_data: { name: input.lineItemLabel || "Hi Coworking membership" },
            unit_amount: input.amount,
            recurring: { interval: recurringInterval },
          },
          quantity: 1,
        }
      : isSubscription
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
      metadata: checkoutMetadata,
    };

    if (isSubscription) {
      sessionConfig.subscription_data = {
        metadata: {
          uid: input.uid,
          plan: input.metadata?.plan || "",
        },
      };
    } else {
      sessionConfig.payment_intent_data = {
        metadata: checkoutMetadata,
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

  private async findPaymentIntent(input: {
    paymentIntentId?: string;
    checkoutSessionId?: string;
    ledgerPaymentId?: string;
    holdId?: string;
  }) {
    if (input.paymentIntentId) {
      return {
        paymentIntentId: input.paymentIntentId,
        checkoutSessionId: input.checkoutSessionId,
      };
    }

    if (input.checkoutSessionId) {
      const session = await this.stripe.checkout.sessions.retrieve(
        input.checkoutSessionId,
      );
      const paymentIntentId = paymentIntentIdFromSession(session);
      if (paymentIntentId) {
        return {
          paymentIntentId,
          checkoutSessionId: session.id,
        };
      }
    }

    const metadataCandidates = [
      ["paymentId", input.ledgerPaymentId],
      ["holdId", input.holdId],
      ["purposeRefId", input.holdId],
    ] as const;

    for (const [key, rawValue] of metadataCandidates) {
      const value = safeMetadataValue(rawValue);
      if (!value) continue;
      try {
        const found = await this.stripe.paymentIntents.search({
          query: `metadata['${key}']:'${value}'`,
          limit: 1,
        });
        if (found.data[0]?.id) {
          return {
            paymentIntentId: found.data[0].id,
            checkoutSessionId: input.checkoutSessionId,
          };
        }
      } catch (error) {
        logger.warn("Stripe PaymentIntent metadata search failed", {
          key,
          value,
          error,
        });
      }
    }

    // Older booking checkouts stored the identifying metadata on the Checkout
    // Session but not on the PaymentIntent or payment ledger. Scan recent
    // sessions so those already-paid bookings remain refundable.
    let startingAfter: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const sessions = await this.stripe.checkout.sessions.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      const match = sessions.data.find((session) => {
        const metadata = session.metadata || {};
        return Boolean(
          (input.ledgerPaymentId && metadata.paymentId === input.ledgerPaymentId)
          || (
            input.holdId
            && (
              metadata.holdId === input.holdId
              || metadata.purposeRefId === input.holdId
            )
          )
        );
      });
      if (match) {
        const paymentIntentId = paymentIntentIdFromSession(match);
        if (paymentIntentId) {
          return {
            paymentIntentId,
            checkoutSessionId: match.id,
          };
        }
      }
      if (!sessions.has_more || sessions.data.length === 0) break;
      startingAfter = sessions.data[sessions.data.length - 1]?.id;
      if (!startingAfter) break;
    }

    return {
      paymentIntentId: "",
      checkoutSessionId: input.checkoutSessionId,
    };
  }

  async refundCheckoutPayment(input: {
    paymentIntentId?: string;
    checkoutSessionId?: string;
    ledgerPaymentId?: string;
    holdId?: string;
    amountCents?: number;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<{
    refundId: string;
    paymentIntentId: string;
    checkoutSessionId?: string;
    amountCents: number;
  }> {
    const resolved = await this.findPaymentIntent(input);
    if (!resolved.paymentIntentId) {
      throw new Error(
        "Stripe payment intent is unavailable for this booking payment.",
      );
    }

    const refund = await this.stripe.refunds.create({
      payment_intent: resolved.paymentIntentId,
      ...(typeof input.amountCents === "number"
        ? { amount: input.amountCents }
        : {}),
      metadata: input.metadata,
    }, {
      idempotencyKey: input.idempotencyKey,
    });

    return {
      refundId: refund.id,
      paymentIntentId: resolved.paymentIntentId,
      checkoutSessionId: resolved.checkoutSessionId,
      amountCents: refund.amount,
    };
  }

  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookResult> {
    const signature = headers["stripe-signature"];
    if (!signature) throw new Error("Missing stripe-signature header");

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (error) {
      logger.error("Stripe webhook signature verification failed", { error });
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
            paymentIntentId: paymentIntentIdFromSession(session),
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
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          eventId: event.id,
          action: "payment_succeeded",
          status: "paid",
          metadata: {
            subscriptionId:
              (invoice as unknown as Record<string, unknown>).subscription as string
              || "",
            customerId:
              typeof invoice.customer === "string"
                ? invoice.customer
                : "",
          },
        };
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          eventId: event.id,
          action: "payment_failed",
          status: "failed",
          metadata: {
            subscriptionId:
              (invoice as unknown as Record<string, unknown>).subscription as string
              || "",
          },
        };
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        return {
          eventId: event.id,
          action: "payment_failed",
          status: "failed",
          metadata: {
            subscriptionId: subscription.id,
            uid: subscription.metadata?.uid || "",
            reason: "subscription_cancelled",
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
    providerRefs: Record<string, string>,
  ): Promise<PaymentStatus> {
    const subscriptionId = providerRefs.subscriptionId;
    if (!subscriptionId) return "pending";
    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
      );
      if (
        subscription.status === "active"
        || subscription.status === "trialing"
      ) {
        return "paid";
      }
      if (
        subscription.status === "canceled"
        || subscription.status === "incomplete_expired"
      ) {
        return "failed";
      }
      return "pending";
    } catch (error) {
      logger.error("Failed to reconcile Stripe subscription", {
        subscriptionId,
        error,
      });
      return "pending";
    }
  }
}
