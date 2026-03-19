/**
 * QuickBooks Payment Link Provider Adapter (PR-11)
 *
 * Implements PaymentProvider for QuickBooks Payment Links.
 * Unlike Stripe, QB payment links are simple redirect URLs with no webhook.
 * Payment confirmation is done manually by an admin ("mark paid").
 *
 * Flow:
 * 1. Admin configures a QB payment link URL on the product
 * 2. User clicks "Pay with QuickBooks" → redirected to QB link
 * 3. After paying, user returns to the app
 * 4. Admin verifies payment in QB and clicks "Mark Paid" in the admin UI
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import type {
  PaymentProvider,
  CheckoutSessionInput,
  CheckoutSessionResult,
  WebhookResult,
  PaymentStatus,
} from "./types";

function getDb() { return admin.firestore(); }

export class QuickBooksLinkProvider implements PaymentProvider {
  readonly name = "quickbooks_link" as const;

  /**
   * Create a "checkout session" by looking up the QB payment link URL
   * from the products collection and returning it.
   * The metadata.productId must reference a product with quickbooksPaymentLinkUrl set.
   */
  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    const productId = input.metadata?.productId;
    if (!productId) {
      throw new Error("productId is required in metadata for QuickBooks Link payments");
    }

    // Fetch the product to get the QB payment link
    const productSnap = await getDb().collection("products").doc(productId).get();
    if (!productSnap.exists) {
      throw new Error(`Product ${productId} not found`);
    }

    const product = productSnap.data();
    const qbUrl = product?.quickbooksPaymentLinkUrl;
    if (!qbUrl) {
      throw new Error(`Product ${productId} does not have a QuickBooks payment link configured`);
    }

    // Generate a unique session ID for tracking
    const sessionId = `qbl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    logger.info("QuickBooks Link checkout created", {
      sessionId,
      productId,
      uid: input.uid,
    });

    return {
      sessionId,
      url: qbUrl,
      provider: "quickbooks_link",
    };
  }

  /**
   * QB Payment Links do not have webhooks.
   * This method is a no-op and always returns "unknown".
   */
  async handleWebhook(
    _rawBody: Buffer,
    _headers: Record<string, string>
  ): Promise<WebhookResult> {
    return {
      eventId: `qbl_noop_${Date.now()}`,
      action: "unknown",
    };
  }

  /**
   * Manual reconciliation only for QB Payment Links.
   * Returns the current status from the payment doc (no external API to query).
   * Actual reconciliation is done by admin "mark paid" action.
   */
  async reconcileStatus(
    providerRefs: Record<string, string>
  ): Promise<PaymentStatus> {
    const paymentId = providerRefs.paymentId;
    if (!paymentId) {
      return "pending";
    }

    const snap = await getDb().collection("payments").doc(paymentId).get();
    if (!snap.exists) {
      return "pending";
    }

    return (snap.data()?.status as PaymentStatus) || "pending";
  }
}
