/**
 * Payment Abstraction Layer — Types (PR-09)
 *
 * These types mirror the schemas in @hi/shared (PaymentDoc, WebhookEventDoc)
 * but are kept inline to avoid cross-package module issues in Cloud Functions.
 */

// --- Payment Provider Enum ---

export const PAYMENT_PROVIDERS = [
  "stripe",
  "quickbooks_link",
  "quickbooks_invoice",
  "quickbooks_payments",
] as const;

export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PURPOSES = ["membership", "event", "rfx", "booking", "referral", "bookstore", "other"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

// --- Payment Provider Interface ---

export interface CheckoutSessionInput {
  uid: string;
  amount: number;
  currency: string;
  purpose: PaymentPurpose;
  purposeRefId?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  mode?: "subscription" | "payment";
  lineItemLabel?: string; // For ad-hoc one-time payments
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
  provider: PaymentProviderName;
}

export interface WebhookResult {
  eventId: string;
  action: "payment_succeeded" | "payment_failed" | "refund" | "unknown";
  paymentId?: string;
  status?: PaymentStatus;
  metadata?: Record<string, string>;
}

/**
 * Abstract interface that every payment provider adapter must implement.
 * PR-10 implements StripeProvider, PR-11+ implement QuickBooks variants.
 */
export interface PaymentProvider {
  /** Unique provider identifier */
  readonly name: PaymentProviderName;

  /**
   * Create a checkout session (or payment link) and return a URL
   * the frontend can redirect the user to.
   */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;

  /**
   * Parse and handle an incoming webhook from the provider.
   * Returns a structured result that the generic handler uses to
   * update the payments/{paymentId} doc.
   */
  handleWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookResult>;

  /**
   * Reconcile the status of a payment by querying the provider API.
   * Useful for manual reconciliation or scheduled polling (QB invoices).
   */
  reconcileStatus(providerRefs: Record<string, string>): Promise<PaymentStatus>;
}

// --- PaymentDoc shape (mirrors @hi/shared) ---

export interface PaymentDocData {
  id: string;
  uid: string;
  orgId?: string;
  provider: PaymentProviderName;
  amount: number;
  currency: string;
  purpose: PaymentPurpose;
  purposeRefId?: string;
  status: PaymentStatus;
  providerRefs?: Record<string, string>;
  accountingRefs?: Record<string, string>;
  createdAt: number;
  updatedAt?: number;
}

// --- WebhookEventDoc shape (mirrors @hi/shared) ---

export interface WebhookEventDocData {
  eventId: string;
  provider: string;
  processedAt: number;
  result?: string;
}
