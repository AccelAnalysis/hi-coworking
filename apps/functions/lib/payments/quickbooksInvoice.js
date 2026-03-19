"use strict";
/**
 * QuickBooks Invoice Creation & Polling (PR-12)
 *
 * Creates invoices via the QuickBooks Online Accounting API
 * and polls their status for automated reconciliation.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQuickBooksInvoice = createQuickBooksInvoice;
exports.getInvoiceStatus = getInvoiceStatus;
exports.mapInvoiceStatusToPaymentStatus = mapInvoiceStatusToPaymentStatus;
const logger = __importStar(require("firebase-functions/logger"));
const intuitOAuth_1 = require("./intuitOAuth");
const QBO_BASE_URL = "https://quickbooks.api.intuit.com/v3/company";
const QBO_SANDBOX_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";
// Set to true for sandbox testing
const USE_SANDBOX = process.env.INTUIT_USE_SANDBOX === "true";
function getBaseUrl() {
    return USE_SANDBOX ? QBO_SANDBOX_URL : QBO_BASE_URL;
}
// --- Invoice Creation ---
/**
 * Create an invoice in QuickBooks Online.
 * First finds or creates the customer, then creates the invoice.
 */
async function createQuickBooksInvoice(input, clientId, clientSecret) {
    const { accessToken, realmId } = await (0, intuitOAuth_1.getValidAccessToken)(clientId, clientSecret);
    const baseUrl = `${getBaseUrl()}/${realmId}`;
    // Find or create customer
    const customerId = await findOrCreateCustomer(baseUrl, accessToken, input.customerEmail, input.customerName);
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
    const invoicePayload = {
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
    const data = (await resp.json());
    const invoice = data.Invoice;
    const result = {
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
async function getInvoiceStatus(invoiceId, clientId, clientSecret) {
    const { accessToken, realmId } = await (0, intuitOAuth_1.getValidAccessToken)(clientId, clientSecret);
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
    const data = (await resp.json());
    const invoice = data.Invoice;
    const balance = Number(invoice.Balance || 0);
    const totalAmt = Number(invoice.TotalAmt || 0);
    let status = "Unpaid";
    if (balance === 0 && totalAmt > 0)
        status = "Paid";
    if (invoice.Voided)
        status = "Voided";
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
function mapInvoiceStatusToPaymentStatus(qbStatus) {
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
async function findOrCreateCustomer(baseUrl, accessToken, email, displayName) {
    // Query for existing customer
    const queryStr = encodeURIComponent(`SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email}'`);
    const searchResp = await fetch(`${baseUrl}/query?query=${queryStr}&minorversion=73`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
    });
    if (searchResp.ok) {
        const searchData = (await searchResp.json());
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
    const custData = (await createResp.json());
    return custData.Customer.Id;
}
/**
 * Build a URL the customer can use to view/pay the invoice.
 */
function buildInvoiceUrl(realmId, invoiceId) {
    return `https://app.qbo.intuit.com/app/invoice?txnId=${invoiceId}&companyId=${realmId}`;
}
