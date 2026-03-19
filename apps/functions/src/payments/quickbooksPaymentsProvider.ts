/**
 * QuickBooks Payments API Provider Adapter (PR-13)
 *
 * Implements PaymentProvider for the QuickBooks Payments API (charge + refund).
 * Uses the Intuit OAuth tokens from intuitOAuth.ts for authentication.
 *
 * QB Payments API:
 *   - Charge: POST /quickbooks/v4/payments/charges
 *   - Refund: POST /quickbooks/v4/payments/charges/{chargeId}/refunds
 *   - Webhooks: Intuit sends event notifications to a configured endpoint
 *
 * This adapter also associates payment transactions with QB accounting
 * entries (Sales Receipts) for bookkeeping.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { getValidAccessToken } from "./intuitOAuth";
import type {
  PaymentProvider,
  CheckoutSessionInput,
  CheckoutSessionResult,
  WebhookResult,
  PaymentStatus,
} from "./types";

function getDb() { return admin.firestore(); }

const QBP_BASE_URL = "https://api.intuit.com/quickbooks/v4/payments";
const QBP_SANDBOX_URL = "https://sandbox.api.intuit.com/quickbooks/v4/payments";
const QBO_BASE_URL = "https://quickbooks.api.intuit.com/v3/company";
const QBO_SANDBOX_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";

const USE_SANDBOX = process.env.INTUIT_USE_SANDBOX === "true";

function getPaymentsBaseUrl(): string {
  return USE_SANDBOX ? QBP_SANDBOX_URL : QBP_BASE_URL;
}

function getAccountingBaseUrl(): string {
  return USE_SANDBOX ? QBO_SANDBOX_URL : QBO_BASE_URL;
}

// --- Types ---

export interface QBChargeInput {
  amount: number; // in dollars
  currency: string;
  cardToken: string; // tokenized card from QB.js client-side SDK
  description?: string;
  customerEmail?: string;
}

export interface QBChargeResult {
  chargeId: string;
  status: "CAPTURED" | "DECLINED" | "CANCELLED" | "REFUNDED";
  amount: number;
  currency: string;
  authCode?: string;
  captureId?: string;
}

export interface QBRefundResult {
  refundId: string;
  amount: number;
  status: string;
}

// --- Provider Adapter ---

export class QuickBooksPaymentsProvider implements PaymentProvider {
  readonly name = "quickbooks_payments" as const;
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * QB Payments doesn't use a hosted checkout page.
   * Instead, the frontend tokenizes the card via QB.js SDK,
   * then calls qb_chargeCard callable with the token.
   * This method returns a placeholder indicating the flow.
   */
  async createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult> {
    // QB Payments uses client-side tokenization, not hosted checkout
    const sessionId = `qbp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return {
      sessionId,
      url: "", // No redirect URL — card is tokenized client-side
      provider: "quickbooks_payments",
    };
  }

  /**
   * Handle Intuit webhook notifications.
   * Intuit sends webhooks for payment events to a configured endpoint.
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<WebhookResult> {
    const verifierToken = headers["intuit-signature"];
    // Note: In production, verify the webhook signature using the
    // Intuit webhook verifier token configured in the Intuit Developer portal.

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      throw new Error("Invalid webhook payload");
    }

    const eventNotifications = payload.eventNotifications as Array<{
      realmId: string;
      dataChangeEvent: {
        entities: Array<{
          name: string;
          id: string;
          operation: string;
          lastUpdated: string;
        }>;
      };
    }> | undefined;

    if (!eventNotifications || eventNotifications.length === 0) {
      return {
        eventId: `qbp_noop_${Date.now()}`,
        action: "unknown",
      };
    }

    // Process the first relevant payment entity
    for (const notification of eventNotifications) {
      for (const entity of notification.dataChangeEvent.entities) {
        if (entity.name === "Payment" || entity.name === "Charge") {
          const eventId = `qbp_${entity.name}_${entity.id}_${entity.lastUpdated}`;

          if (entity.operation === "Create" || entity.operation === "Update") {
            return {
              eventId,
              action: "payment_succeeded",
              status: "paid",
              metadata: {
                entityName: entity.name,
                entityId: entity.id,
                realmId: notification.realmId,
                operation: entity.operation,
              },
            };
          }

          if (entity.operation === "Void" || entity.operation === "Delete") {
            return {
              eventId,
              action: "refund",
              status: "refunded",
              metadata: {
                entityName: entity.name,
                entityId: entity.id,
                realmId: notification.realmId,
              },
            };
          }
        }
      }
    }

    return {
      eventId: `qbp_unhandled_${Date.now()}`,
      action: "unknown",
    };
  }

  /**
   * Reconcile by checking the charge status via QB Payments API.
   */
  async reconcileStatus(
    providerRefs: Record<string, string>
  ): Promise<PaymentStatus> {
    const chargeId = providerRefs.qbChargeId;
    if (!chargeId) {
      return "pending";
    }

    try {
      const { accessToken } = await getValidAccessToken(this.clientId, this.clientSecret);
      const baseUrl = getPaymentsBaseUrl();

      const resp = await fetch(`${baseUrl}/charges/${chargeId}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!resp.ok) {
        logger.error("QB Payments charge fetch failed", { chargeId, status: resp.status });
        return "pending";
      }

      const data = (await resp.json()) as { status: string };
      return mapChargeStatusToPaymentStatus(data.status);
    } catch (err) {
      logger.error("QB Payments reconcile failed", { chargeId, err });
      return "pending";
    }
  }

  // --- Direct Charge/Refund Methods ---

  /**
   * Charge a tokenized card via QB Payments API.
   */
  async chargeCard(input: QBChargeInput): Promise<QBChargeResult> {
    const { accessToken } = await getValidAccessToken(this.clientId, this.clientSecret);
    const baseUrl = getPaymentsBaseUrl();

    const chargePayload = {
      amount: input.amount.toFixed(2),
      currency: input.currency.toUpperCase(),
      token: input.cardToken,
      context: {
        mobile: false,
        isEcommerce: true,
      },
      description: input.description || "Hi Coworking Payment",
      capture: true,
    };

    const requestId = `hi_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const resp = await fetch(`${baseUrl}/charges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Request-Id": requestId,
      },
      body: JSON.stringify(chargePayload),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      logger.error("QB Payments charge failed", { status: resp.status, body: errBody });
      throw new Error(`Charge failed: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      id: string;
      status: string;
      amount: string;
      currency: string;
      authCode?: string;
      captureId?: string;
    };

    logger.info("QB Payments charge successful", {
      chargeId: data.id,
      status: data.status,
      amount: data.amount,
    });

    return {
      chargeId: data.id,
      status: data.status as QBChargeResult["status"],
      amount: parseFloat(data.amount),
      currency: data.currency,
      authCode: data.authCode,
      captureId: data.captureId,
    };
  }

  /**
   * Refund a previous charge via QB Payments API.
   */
  async refundCharge(
    chargeId: string,
    amount?: number
  ): Promise<QBRefundResult> {
    const { accessToken } = await getValidAccessToken(this.clientId, this.clientSecret);
    const baseUrl = getPaymentsBaseUrl();

    const refundPayload: Record<string, unknown> = {};
    if (amount !== undefined) {
      refundPayload.amount = amount.toFixed(2);
    }

    const requestId = `hi_ref_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const resp = await fetch(`${baseUrl}/charges/${chargeId}/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Request-Id": requestId,
      },
      body: JSON.stringify(refundPayload),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      logger.error("QB Payments refund failed", { chargeId, status: resp.status, body: errBody });
      throw new Error(`Refund failed: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      id: string;
      amount: string;
      status: string;
    };

    logger.info("QB Payments refund successful", {
      refundId: data.id,
      chargeId,
      amount: data.amount,
    });

    return {
      refundId: data.id,
      amount: parseFloat(data.amount),
      status: data.status,
    };
  }

  // --- QB Accounting Transaction Association ---

  /**
   * Create a Sales Receipt in QBO to record the payment in accounting.
   * This associates the QB Payments charge with the accounting system.
   */
  async createSalesReceipt(
    chargeResult: QBChargeResult,
    customerEmail: string,
    description: string
  ): Promise<{ salesReceiptId: string }> {
    const { accessToken, realmId } = await getValidAccessToken(this.clientId, this.clientSecret);
    const baseUrl = `${getAccountingBaseUrl()}/${realmId}`;

    // Find or create customer
    const customerId = await this.findOrCreateCustomer(baseUrl, accessToken, customerEmail);

    const salesReceiptPayload = {
      CustomerRef: { value: customerId },
      TotalAmt: chargeResult.amount,
      Line: [
        {
          Amount: chargeResult.amount,
          DetailType: "SalesItemLineDetail",
          Description: description,
          SalesItemLineDetail: {
            Qty: 1,
            UnitPrice: chargeResult.amount,
          },
        },
      ],
      PaymentRefNum: chargeResult.chargeId,
      PrivateNote: `QB Payments charge ID: ${chargeResult.chargeId}`,
    };

    const resp = await fetch(`${baseUrl}/salesreceipt?minorversion=73`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(salesReceiptPayload),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      logger.error("QBO sales receipt creation failed", { status: resp.status, body: errBody });
      throw new Error(`Sales receipt creation failed: ${resp.status}`);
    }

    const data = (await resp.json()) as { SalesReceipt: { Id: string } };

    logger.info("QBO sales receipt created", {
      salesReceiptId: data.SalesReceipt.Id,
      chargeId: chargeResult.chargeId,
    });

    return { salesReceiptId: data.SalesReceipt.Id };
  }

  private async findOrCreateCustomer(
    baseUrl: string,
    accessToken: string,
    email: string
  ): Promise<string> {
    const queryStr = encodeURIComponent(
      `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email}'`
    );
    const searchResp = await fetch(
      `${baseUrl}/query?query=${queryStr}&minorversion=73`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (searchResp.ok) {
      const searchData = (await searchResp.json()) as {
        QueryResponse: { Customer?: Array<{ Id: string }> };
      };
      if (searchData.QueryResponse.Customer?.length) {
        return searchData.QueryResponse.Customer[0].Id;
      }
    }

    const createResp = await fetch(`${baseUrl}/customer?minorversion=73`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        DisplayName: email.split("@")[0],
        PrimaryEmailAddr: { Address: email },
      }),
    });

    if (!createResp.ok) {
      throw new Error(`Customer creation failed: ${createResp.status}`);
    }

    const custData = (await createResp.json()) as { Customer: { Id: string } };
    return custData.Customer.Id;
  }
}

// --- Helpers ---

function mapChargeStatusToPaymentStatus(qbStatus: string): PaymentStatus {
  switch (qbStatus) {
    case "CAPTURED":
    case "SETTLED":
      return "paid";
    case "DECLINED":
    case "CANCELLED":
      return "failed";
    case "REFUNDED":
      return "refunded";
    default:
      return "pending";
  }
}
