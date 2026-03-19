"use strict";
/**
 * Payment Ledger Helpers (PR-09)
 *
 * Writes and reads from the payments/{paymentId} collection.
 * Every transaction — regardless of provider — passes through here
 * to maintain a single unified ledger.
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
exports.createPayment = createPayment;
exports.updatePaymentStatus = updatePaymentStatus;
exports.queryPayments = queryPayments;
exports.getPayment = getPayment;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() { return admin.firestore(); }
/**
 * Create a new payment document. Returns the generated ID and full doc.
 */
async function createPayment(input) {
    const ref = getDb().collection("payments").doc();
    const now = Date.now();
    const doc = {
        id: ref.id,
        uid: input.uid,
        orgId: input.orgId,
        provider: input.provider,
        amount: input.amount,
        currency: input.currency || "USD",
        purpose: input.purpose,
        purposeRefId: input.purposeRefId,
        status: input.status || "pending",
        providerRefs: input.providerRefs,
        createdAt: now,
    };
    await ref.set(doc);
    logger.info("Payment created", { id: doc.id, provider: doc.provider, amount: doc.amount });
    return doc;
}
/**
 * Update the status (and optionally providerRefs / accountingRefs) of
 * an existing payment document.
 */
async function updatePaymentStatus(paymentId, status, extra) {
    const data = {
        status,
        updatedAt: Date.now(),
    };
    if (extra?.providerRefs) {
        // Merge rather than overwrite
        for (const [k, v] of Object.entries(extra.providerRefs)) {
            data[`providerRefs.${k}`] = v;
        }
    }
    if (extra?.accountingRefs) {
        for (const [k, v] of Object.entries(extra.accountingRefs)) {
            data[`accountingRefs.${k}`] = v;
        }
    }
    await getDb().collection("payments").doc(paymentId).update(data);
    logger.info("Payment status updated", { paymentId, status });
}
/**
 * Query payments with optional filters. Returns newest-first.
 */
async function queryPayments(filters = {}) {
    let q = getDb().collection("payments");
    if (filters.provider)
        q = q.where("provider", "==", filters.provider);
    if (filters.status)
        q = q.where("status", "==", filters.status);
    if (filters.purpose)
        q = q.where("purpose", "==", filters.purpose);
    if (filters.uid)
        q = q.where("uid", "==", filters.uid);
    q = q.orderBy("createdAt", "desc");
    if (filters.limitTo)
        q = q.limit(filters.limitTo);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
}
/**
 * Get a single payment by ID.
 */
async function getPayment(paymentId) {
    const snap = await getDb().collection("payments").doc(paymentId).get();
    return snap.exists ? snap.data() : null;
}
