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
import { parseSubscriptionInvoice, type InvoiceLike } from "./stripeInvoice";
import { parseSubscriptionUpdate, type SubscriptionLike } from "./stripeSubscription";
import { buildRefundSnapshot, idOf, type ChargeLike } from "./stripeRefund";

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
    // Drop unset metadata values (e.g. no email) so nothing undefined is
    // sent to Stripe or echoed back into Firestore writes.
    const definedMetadata = Object.fromEntries(
      Object.entries(input.metadata || {}).filter(([, v]) => v !== undefined && v !== null)
    );
    const checkoutMetadata = {
      ...definedMetadata,
      uid: input.uid,
      paymentId: input.metadata?.paymentId || "",
      purpose: input.purpose,
      purposeRefId: input.purposeRefId || "",
    };
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
      line_items: [lineItem, ...(input.extraLineItems || [])],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: checkoutMetadata,
    };
    if (input.collectBillingAddress) {
      sessionConfig.billing_address_collection = "required";
    }
    if (input.optionalItems?.length) {
      sessionConfig.optional_items = input.optionalItems.map((item) => ({
        price: item.price,
        quantity: item.quantity,
        adjustable_quantity: { enabled: false },
      }));
    }

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
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const info = parseSubscriptionInvoice(event.data.object as unknown as InvoiceLike);
        if (!info.subscriptionId) {
          logger.info("Stripe invoice event without a subscription, ignoring", {
            type: event.type,
            invoiceId: info.invoiceId,
          });
          return { eventId: event.id, action: "unknown" };
        }
        let { uid, plan } = info;
        if (!uid) {
          try {
            const subscription = await this.stripe.subscriptions.retrieve(info.subscriptionId);
            uid = subscription.metadata?.uid || "";
            plan = plan || subscription.metadata?.plan || "";
          } catch (error) {
            // Non-fatal: the webhook falls back to the stored subscription ID on users.
            logger.warn("Could not retrieve subscription for invoice", {
              subscriptionId: info.subscriptionId,
              invoiceId: info.invoiceId,
              error,
            });
          }
        }
        const succeeded = event.type === "invoice.payment_succeeded";
        return {
          eventId: event.id,
          action: succeeded ? "subscription_invoice_paid" : "subscription_invoice_failed",
          status: succeeded ? "paid" : "failed",
          metadata: {
            subscriptionId: info.subscriptionId,
            customerId: info.customerId,
            invoiceId: info.invoiceId,
            billingReason: info.billingReason,
            uid,
            plan,
            periodEndMs: String(info.periodEndMs),
          },
        };
      }
      case "customer.subscription.updated": {
        const info = parseSubscriptionUpdate(
          event.data.object as unknown as SubscriptionLike,
          event.created,
        );
        return {
          eventId: event.id,
          action: "subscription_updated",
          metadata: {
            subscriptionId: info.subscriptionId,
            customerId: info.customerId,
            uid: info.uid,
            status: info.status,
            priceId: info.priceId,
            cancelAtPeriodEnd: String(info.cancelAtPeriodEnd),
            cancelAtMs: String(info.cancelAtMs),
            eventCreatedMs: String(info.eventCreatedMs),
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
            // For the "membership has ended" email.
            plan: subscription.metadata?.plan || "",
            endedAtMs: String((subscription.ended_at || event.created) * 1000),
          },
        };
      }
      case "charge.refunded":
      case "refund.updated":
      case "refund.failed": {
        const object = event.data.object as Stripe.Charge | Stripe.Refund;
        const isCharge = event.type === "charge.refunded";
        const chargeId = isCharge ? object.id : idOf((object as Stripe.Refund).charge);
        if (!chargeId) {
          logger.info("Stripe refund event without a charge, ignoring", { type: event.type });
          return { eventId: event.id, action: "unknown" };
        }
        // Throws on a Stripe API error, so the webhook answers 400 before the
        // event is marked processed and Stripe retries it.
        const refund = await this.refundSnapshot(chargeId, isCharge ? "" : object.id);
        return {
          eventId: event.id,
          action: "refund",
          ...(refund.paymentId ? { paymentId: refund.paymentId } : {}),
          metadata: {
            eventType: event.type,
            refundId: refund.refundId,
            chargeId: refund.chargeId,
          },
          refund,
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

  /**
   * The charge's current refund state: the charge, all its refunds, the
   * PaymentIntent metadata (ledger paymentId for one-time Checkout) and, for
   * a subscription charge, the invoice it paid (subscription, uid, plan).
   */
  async refundSnapshot(chargeId: string, refundId: string) {
    const charge = await this.stripe.charges.retrieve(chargeId);
    const refunds = await this.stripe.refunds.list({ charge: chargeId, limit: 100 });
    const paymentIntentId = idOf(charge.payment_intent);
    let paymentMetadata: Record<string, string> | null = null;
    let invoice: Parameters<typeof buildRefundSnapshot>[0]["invoice"] = null;
    if (paymentIntentId) {
      if (!charge.metadata?.paymentId) {
        // Propagates API errors (see below): one-time Checkout keeps the
        // ledger paymentId only on the PaymentIntent.
        const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
        paymentMetadata = intent.metadata || null;
      }
      // A Stripe API error here is not swallowed: subscription charges carry
      // no ledger paymentId, so without the invoice the refund would be lost.
      // Throwing answers 400 before the event is marked processed, so Stripe
      // retries. A charge with no invoice (one-time payment) returns no data.
      const payments = await this.stripe.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentIntentId },
        limit: 1,
        expand: ["data.invoice"],
      });
      const paidInvoice = payments.data[0]?.invoice;
      if (paidInvoice && typeof paidInvoice !== "string") {
        const info = parseSubscriptionInvoice(paidInvoice as unknown as InvoiceLike);
        invoice = {
          invoiceId: info.invoiceId,
          billingReason: info.billingReason,
          subscriptionId: info.subscriptionId,
          uid: info.uid,
          plan: info.plan,
        };
      }
    }
    return buildRefundSnapshot({
      refundId,
      charge: charge as unknown as ChargeLike,
      refunds: refunds.data,
      paymentMetadata,
      invoice,
    });
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
