"use strict";
/**
 * Payment Abstraction Layer — Types (PR-09)
 *
 * These types mirror the schemas in @hi/shared (PaymentDoc, WebhookEventDoc)
 * but are kept inline to avoid cross-package module issues in Cloud Functions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_PURPOSES = exports.PAYMENT_STATUSES = exports.PAYMENT_PROVIDERS = void 0;
// --- Payment Provider Enum ---
exports.PAYMENT_PROVIDERS = [
    "stripe",
    "quickbooks_link",
    "quickbooks_invoice",
    "quickbooks_payments",
];
exports.PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];
exports.PAYMENT_PURPOSES = ["membership", "event", "rfx", "booking", "referral", "bookstore", "other"];
