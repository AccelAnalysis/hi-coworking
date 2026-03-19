"use strict";
/**
 * QuickBooks Accounting Sync (PR-14)
 *
 * Creates QBO Sales Receipts for Stripe payments so that QuickBooks
 * serves as the single accounting system of record.
 *
 * Flow: Stripe payment succeeds → webhook handler calls syncPaymentToQBO()
 *       → creates Sales Receipt in QBO → stores accountingRefs.qboSalesReceiptId
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
exports.syncPaymentToQBO = syncPaymentToQBO;
exports.backfillPaymentsToQBO = backfillPaymentsToQBO;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const intuitOAuth_1 = require("./intuitOAuth");
const ledger_1 = require("./ledger");
function getDb() { return admin.firestore(); }
const QBO_BASE_URL = "https://quickbooks.api.intuit.com/v3/company";
const QBO_SANDBOX_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const USE_SANDBOX = process.env.INTUIT_USE_SANDBOX === "true";
function getBaseUrl() {
    return USE_SANDBOX ? QBO_SANDBOX_URL : QBO_BASE_URL;
}
// --- Public API ---
/**
 * Sync a payment to QBO by creating a Sales Receipt.
 * Idempotent: skips if accountingRefs.qboSalesReceiptId already exists.
 * Non-fatal: logs errors but does not throw (payment should not fail
 * because accounting sync failed).
 */
async function syncPaymentToQBO(paymentId, clientId, clientSecret) {
    // Check if QB is connected
    const connected = await (0, intuitOAuth_1.isQuickBooksConnected)();
    if (!connected) {
        logger.info("QBO sync skipped — QuickBooks not connected", { paymentId });
        return { synced: false };
    }
    // Fetch payment
    const db = getDb();
    const paymentSnap = await db.collection("payments").doc(paymentId).get();
    if (!paymentSnap.exists) {
        logger.warn("QBO sync skipped — payment not found", { paymentId });
        return { synced: false };
    }
    const payment = paymentSnap.data();
    // Skip if already synced
    if (payment.accountingRefs?.qboSalesReceiptId) {
        logger.info("QBO sync skipped — already synced", {
            paymentId,
            salesReceiptId: payment.accountingRefs.qboSalesReceiptId,
        });
        return { synced: true, salesReceiptId: payment.accountingRefs.qboSalesReceiptId };
    }
    // Only sync paid payments
    if (payment.status !== "paid") {
        logger.info("QBO sync skipped — payment not paid", { paymentId, status: payment.status });
        return { synced: false };
    }
    try {
        const { accessToken, realmId } = await (0, intuitOAuth_1.getValidAccessToken)(clientId, clientSecret);
        const baseUrl = `${getBaseUrl()}/${realmId}`;
        // Resolve customer email from user doc
        const userSnap = await db.collection("users").doc(payment.uid).get();
        const email = userSnap.exists ? userSnap.data()?.email || "" : "";
        const displayName = userSnap.exists ? userSnap.data()?.displayName || email : email;
        // Find or create QB customer
        const customerId = await findOrCreateCustomer(baseUrl, accessToken, email, displayName);
        // Build description
        const purposeLabel = payment.purpose.charAt(0).toUpperCase() + payment.purpose.slice(1);
        const providerLabel = payment.provider === "stripe" ? "Stripe" : "QuickBooks";
        const description = `${purposeLabel} payment via ${providerLabel}`;
        const amountDollars = payment.amount / 100;
        // Build reference number from provider refs
        const refNum = payment.providerRefs?.stripeSubscriptionId
            || payment.providerRefs?.stripeSessionId
            || payment.id;
        // Create Sales Receipt
        const salesReceiptPayload = {
            CustomerRef: { value: customerId },
            TotalAmt: amountDollars,
            Line: [
                {
                    Amount: amountDollars,
                    DetailType: "SalesItemLineDetail",
                    Description: description,
                    SalesItemLineDetail: {
                        Qty: 1,
                        UnitPrice: amountDollars,
                    },
                },
            ],
            PaymentRefNum: refNum,
            PrivateNote: `Synced from payment ${payment.id} (${payment.provider}). Purpose: ${payment.purpose}.`,
            TxnDate: new Date(payment.createdAt).toISOString().split("T")[0],
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
            logger.error("QBO Sales Receipt creation failed", {
                paymentId,
                status: resp.status,
                body: errBody,
            });
            return { synced: false };
        }
        const data = (await resp.json());
        const salesReceiptId = data.SalesReceipt.Id;
        // Store accounting ref on the payment doc
        await (0, ledger_1.updatePaymentStatus)(payment.id, payment.status, {
            accountingRefs: { qboSalesReceiptId: salesReceiptId },
        });
        logger.info("QBO Sales Receipt created", {
            paymentId: payment.id,
            salesReceiptId,
            amount: amountDollars,
            provider: payment.provider,
        });
        return { synced: true, salesReceiptId };
    }
    catch (err) {
        logger.error("QBO sync failed", { paymentId, err });
        return { synced: false };
    }
}
/**
 * Backfill: sync all paid payments that are missing QBO accounting refs.
 * Returns counts of synced/skipped/failed.
 */
async function backfillPaymentsToQBO(clientId, clientSecret, limitTo = 50) {
    const connected = await (0, intuitOAuth_1.isQuickBooksConnected)();
    if (!connected) {
        logger.warn("QBO backfill skipped — QuickBooks not connected");
        return { synced: 0, skipped: 0, failed: 0 };
    }
    // Query all paid payments
    const snap = await getDb()
        .collection("payments")
        .where("status", "==", "paid")
        .orderBy("createdAt", "desc")
        .limit(limitTo)
        .get();
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    for (const doc of snap.docs) {
        const payment = doc.data();
        // Skip already synced
        if (payment.accountingRefs?.qboSalesReceiptId) {
            skipped++;
            continue;
        }
        const result = await syncPaymentToQBO(payment.id, clientId, clientSecret);
        if (result.synced) {
            synced++;
        }
        else {
            failed++;
        }
    }
    logger.info("QBO backfill complete", { synced, skipped, failed });
    return { synced, skipped, failed };
}
// --- Helpers ---
async function findOrCreateCustomer(baseUrl, accessToken, email, displayName) {
    if (!email) {
        // Use a generic "Walk-in" customer
        return "1";
    }
    const queryStr = encodeURIComponent(`SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email}'`);
    const searchResp = await fetch(`${baseUrl}/query?query=${queryStr}&minorversion=73`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
    });
    if (searchResp.ok) {
        const searchData = (await searchResp.json());
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
            DisplayName: displayName || email.split("@")[0],
            PrimaryEmailAddr: { Address: email },
        }),
    });
    if (!createResp.ok) {
        logger.error("QBO customer creation failed", { email, status: createResp.status });
        return "1"; // Fallback to default customer
    }
    const custData = (await createResp.json());
    return custData.Customer.Id;
}
