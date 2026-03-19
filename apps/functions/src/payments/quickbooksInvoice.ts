/**
 * QuickBooks Invoice Creation & Polling (PR-12)
 *
 * Creates invoices via the QuickBooks Online Accounting API
 * and polls their status for automated reconciliation.
 */

import * as logger from "firebase-functions/logger";
import { getValidAccessToken } from "./intuitOAuth";
import type { PaymentStatus } from "./types";

const QBO_BASE_URL = "https://quickbooks.api.intuit.com/v3/company";
const QBO_SANDBOX_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";

// Set to true for sandbox testing
const USE_SANDBOX = process.env.INTUIT_USE_SANDBOX === "true";

function getBaseUrl(): string {
  return USE_SANDBOX ? QBO_SANDBOX_URL : QBO_BASE_URL;
}

// --- Types ---

export interface CreateInvoiceInput {
  customerEmail: string;
  customerName: string;
  lineItems: InvoiceLineItem[];
  dueDate?: string; // YYYY-MM-DD format
  memo?: string;
}

export interface InvoiceLineItem {
  description: string;
  amount: number; // in dollars (not cents)
  quantity?: number;
}

export interface QBInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  invoiceUrl: string;
  totalAmount: number;
  balance: number;
  status: "Unpaid" | "Paid" | "Overdue" | "Voided" | "Deleted";
}

// --- Invoice Creation ---

/**
 * Create an invoice in QuickBooks Online.
 * First finds or creates the customer, then creates the invoice.
 */
export async function createQuickBooksInvoice(
  input: CreateInvoiceInput,
  clientId: string,
  clientSecret: string
): Promise<QBInvoiceResult> {
  const { accessToken, realmId } = await getValidAccessToken(clientId, clientSecret);
  const baseUrl = `${getBaseUrl()}/${realmId}`;

  // Find or create customer
  const customerId = await findOrCreateCustomer(
    baseUrl,
    accessToken,
    input.customerEmail,
    input.customerName
  );

  // Build invoice payload
  const lines = input.lineItems.map((item, idx) => ({
    LineNum: idx + 1,
    Amount: item.amount * (item.quantity || 1),
    DetailType: "SalesItemLineDetail",
    Description: item.description,
    SalesItemLineDetail: {
      Qty: item.quantity || 1,
      UnitPrice: item.amount,
    },
  }));

  const invoicePayload: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line: lines,
    BillEmail: { Address: input.customerEmail },
    EmailStatus: "NeedToSend",
  };

  if (input.dueDate) {
    invoicePayload.DueDate = input.dueDate;
  }
  if (input.memo) {
    invoicePayload.CustomerMemo = { value: input.memo };
  }

  const resp = await fetch(`${baseUrl}/invoice?minorversion=73`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(invoicePayload),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    logger.error("QBO invoice creation failed", { status: resp.status, body: errBody });
    throw new Error(`Invoice creation failed: ${resp.status}`);
  }

  const data = (await resp.json()) as { Invoice: Record<string, unknown> };
  const invoice = data.Invoice;

  const result: QBInvoiceResult = {
    invoiceId: String(invoice.Id),
    invoiceNumber: String(invoice.DocNumber || ""),
    invoiceUrl: buildInvoiceUrl(realmId, String(invoice.Id)),
    totalAmount: Number(invoice.TotalAmt || 0),
    balance: Number(invoice.Balance || 0),
    status: Number(invoice.Balance) === 0 ? "Paid" : "Unpaid",
  };

  logger.info("QBO invoice created", {
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    totalAmount: result.totalAmount,
  });

  return result;
}

// --- Invoice Status Polling ---

/**
 * Query a single invoice's current status from QuickBooks.
 */
export async function getInvoiceStatus(
  invoiceId: string,
  clientId: string,
  clientSecret: string
): Promise<QBInvoiceResult> {
  const { accessToken, realmId } = await getValidAccessToken(clientId, clientSecret);
  const baseUrl = `${getBaseUrl()}/${realmId}`;

  const resp = await fetch(`${baseUrl}/invoice/${invoiceId}?minorversion=73`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    logger.error("QBO invoice fetch failed", { invoiceId, status: resp.status, body: errBody });
    throw new Error(`Invoice fetch failed: ${resp.status}`);
  }

  const data = (await resp.json()) as { Invoice: Record<string, unknown> };
  const invoice = data.Invoice;

  const balance = Number(invoice.Balance || 0);
  const totalAmt = Number(invoice.TotalAmt || 0);

  let status: QBInvoiceResult["status"] = "Unpaid";
  if (balance === 0 && totalAmt > 0) status = "Paid";
  if (invoice.Voided) status = "Voided";

  return {
    invoiceId: String(invoice.Id),
    invoiceNumber: String(invoice.DocNumber || ""),
    invoiceUrl: buildInvoiceUrl(realmId, String(invoice.Id)),
    totalAmount: totalAmt,
    balance,
    status,
  };
}

/**
 * Map QBO invoice status to our PaymentStatus enum.
 */
export function mapInvoiceStatusToPaymentStatus(
  qbStatus: QBInvoiceResult["status"]
): PaymentStatus {
  switch (qbStatus) {
    case "Paid":
      return "paid";
    case "Voided":
    case "Deleted":
      return "refunded";
    case "Unpaid":
    case "Overdue":
    default:
      return "pending";
  }
}

// --- Helpers ---

/**
 * Find an existing QB customer by email, or create a new one.
 */
async function findOrCreateCustomer(
  baseUrl: string,
  accessToken: string,
  email: string,
  displayName: string
): Promise<string> {
  // Query for existing customer
  const queryStr = encodeURIComponent(`SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email}'`);
  const searchResp = await fetch(`${baseUrl}/query?query=${queryStr}&minorversion=73`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (searchResp.ok) {
    const searchData = (await searchResp.json()) as {
      QueryResponse: { Customer?: Array<{ Id: string }> };
    };
    if (searchData.QueryResponse.Customer && searchData.QueryResponse.Customer.length > 0) {
      return searchData.QueryResponse.Customer[0].Id;
    }
  }

  // Create new customer
  const createResp = await fetch(`${baseUrl}/customer?minorversion=73`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      DisplayName: displayName,
      PrimaryEmailAddr: { Address: email },
    }),
  });

  if (!createResp.ok) {
    const errBody = await createResp.text();
    logger.error("QBO customer creation failed", { status: createResp.status, body: errBody });
    throw new Error(`Customer creation failed: ${createResp.status}`);
  }

  const custData = (await createResp.json()) as { Customer: { Id: string } };
  return custData.Customer.Id;
}

/**
 * Build a URL the customer can use to view/pay the invoice.
 */
function buildInvoiceUrl(realmId: string, invoiceId: string): string {
  return `https://app.qbo.intuit.com/app/invoice?txnId=${invoiceId}&companyId=${realmId}`;
}
