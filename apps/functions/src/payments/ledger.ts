/**
 * Payment Ledger Helpers (PR-09)
 *
 * Writes and reads from the payments/{paymentId} collection.
 * Every transaction — regardless of provider — passes through here
 * to maintain a single unified ledger.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import type {
  PaymentDocData,
  PaymentProviderName,
  PaymentPurpose,
  PaymentStatus,
} from "./types";

function getDb() { return admin.firestore(); }

// --- Write Helpers ---

export interface CreatePaymentInput {
  uid: string;
  orgId?: string;
  provider: PaymentProviderName;
  amount: number;
  currency?: string;
  purpose: PaymentPurpose;
  purposeRefId?: string;
  status?: PaymentStatus;
  providerRefs?: Record<string, string>;
}

/**
 * Create a new payment document. Returns the generated ID and full doc.
 */
export async function createPayment(
  input: CreatePaymentInput
): Promise<PaymentDocData> {
  const ref = getDb().collection("payments").doc();
  const now = Date.now();

  const doc: PaymentDocData = {
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
export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  extra?: {
    providerRefs?: Record<string, string>;
    accountingRefs?: Record<string, string>;
  }
): Promise<void> {
  const data: Record<string, unknown> = {
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

// --- Read Helpers ---

export interface PaymentQuery {
  provider?: PaymentProviderName;
  status?: PaymentStatus;
  purpose?: PaymentPurpose;
  uid?: string;
  limitTo?: number;
}

/**
 * Query payments with optional filters. Returns newest-first.
 */
export async function queryPayments(
  filters: PaymentQuery = {}
): Promise<PaymentDocData[]> {
  let q: admin.firestore.Query = getDb().collection("payments");

  if (filters.provider) q = q.where("provider", "==", filters.provider);
  if (filters.status) q = q.where("status", "==", filters.status);
  if (filters.purpose) q = q.where("purpose", "==", filters.purpose);
  if (filters.uid) q = q.where("uid", "==", filters.uid);

  q = q.orderBy("createdAt", "desc");

  if (filters.limitTo) q = q.limit(filters.limitTo);

  const snap = await q.get();
  return snap.docs.map((d) => d.data() as PaymentDocData);
}

/**
 * Get a single payment by ID.
 */
export async function getPayment(
  paymentId: string
): Promise<PaymentDocData | null> {
  const snap = await getDb().collection("payments").doc(paymentId).get();
  return snap.exists ? (snap.data() as PaymentDocData) : null;
}
