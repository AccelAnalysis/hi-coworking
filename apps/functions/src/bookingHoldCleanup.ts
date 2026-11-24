/**
 * Cleanup policy for abandoned public booking checkout holds.
 *
 * A checkout hold (bookingHolds/{id}) is written when booking_beginCheckout
 * starts and is meant to live 15 minutes. If the visitor never pays, the hold
 * stays forever with the guest's name, email and phone. This module decides,
 * conservatively, which of those holds may be deleted.
 *
 * Kept free of firebase-admin so tests can import it directly. The scheduled
 * sweep (bookingHoldCleanupSweep.ts) is OFF unless BOOKING_HOLD_CLEANUP_MODE is
 * "dry_run" or "delete", and deploying or enabling it needs Jonathan's OK.
 */

/** How long after a hold's expiry we wait before deleting it (7 days). */
export const BOOKING_HOLD_CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bound on parent holds deleted in one scheduled run. */
export const BOOKING_HOLD_CLEANUP_MAX_PER_RUN = 500;

/** Only these statuses describe a checkout that never became a booking. */
const ABANDONED_HOLD_STATUSES = new Set(["HELD", "EXPIRED"]);

/**
 * Payment states that prove no money was taken. "paid", "refunded",
 * "partially_refunded" or anything unknown keeps the hold for reconciliation.
 */
const UNPAID_PAYMENT_STATUSES = new Set(["pending", "failed"]);

const CHECKOUT_BOOKING_KINDS = new Set(["single", "desk_change"]);

export type BookingHoldCleanupMode = "off" | "dry_run" | "delete";

export function bookingHoldCleanupMode(env: Record<string, string | undefined> = process.env): BookingHoldCleanupMode {
  const value = String(env.BOOKING_HOLD_CLEANUP_MODE || "").trim().toLowerCase();
  if (value === "delete") return "delete";
  if (value === "dry_run") return "dry_run";
  return "off";
}

export type HoldRecord = Record<string, unknown>;

export type PaymentSnapshot = { exists: false } | { exists: true; status: unknown };

export type HoldCleanupReason =
  | "missing"
  | "not_checkout_hold"
  | "child_hold"
  | "admin_hold"
  | "reschedule_hold"
  | "finalized"
  | "status_not_abandoned"
  | "not_expired_long_enough"
  | "payment_missing"
  | "payment_not_unpaid";

export type HoldCleanupDecision =
  | { delete: true }
  | { delete: false; reason: HoldCleanupReason };

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Whether a public checkout hold is an expired, abandoned checkout that is safe
 * to delete. `payment` is the payments/{hold.paymentId} snapshot, or null when
 * the hold has no paymentId.
 */
export function abandonedHoldDecision(
  holdId: string,
  hold: HoldRecord | undefined,
  payment: PaymentSnapshot | null,
  now: number,
): HoldCleanupDecision {
  if (!hold) return { delete: false, reason: "missing" };
  if (holdId.startsWith("reschedule_")) return { delete: false, reason: "reschedule_hold" };
  if (hold.kind !== undefined || hold.parentHoldId !== undefined) {
    return { delete: false, reason: "child_hold" };
  }
  if (hold.adminActorUid !== undefined) return { delete: false, reason: "admin_hold" };
  if (
    !CHECKOUT_BOOKING_KINDS.has(String(hold.bookingKind))
    || !nonEmptyString(hold.secretHash)
    || !nonEmptyString(hold.userId)
  ) {
    return { delete: false, reason: "not_checkout_hold" };
  }
  if (hold.bookingId !== undefined && hold.bookingId !== null && hold.bookingId !== "") {
    return { delete: false, reason: "finalized" };
  }
  if (!ABANDONED_HOLD_STATUSES.has(String(hold.status))) {
    return { delete: false, reason: "status_not_abandoned" };
  }
  const expiresAt = Number(hold.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt + BOOKING_HOLD_CLEANUP_GRACE_MS > now) {
    return { delete: false, reason: "not_expired_long_enough" };
  }
  if (nonEmptyString(hold.paymentId)) {
    if (!payment || !payment.exists) return { delete: false, reason: "payment_missing" };
    if (!UNPAID_PAYMENT_STATUSES.has(String(payment.status))) {
      return { delete: false, reason: "payment_not_unpaid" };
    }
  }
  return { delete: true };
}

/** Child occupancy / reschedule-lock hold ids a checkout hold may own. */
export function childHoldIds(hold: HoldRecord): string[] {
  const ids = new Set<string>();
  if (Array.isArray(hold.occupancyHoldIds)) {
    for (const id of hold.occupancyHoldIds) if (nonEmptyString(id)) ids.add(id);
  }
  if (nonEmptyString(hold.rescheduleLockHoldId)) ids.add(hold.rescheduleLockHoldId);
  return [...ids];
}

/** A child hold is removed with its parent only if it is unused and truly owned by it. */
export function childHoldDeletable(parentId: string, child: HoldRecord | undefined): boolean {
  if (!child) return false;
  if (child.parentHoldId !== parentId) return false;
  if (child.bookingId !== undefined && child.bookingId !== null && child.bookingId !== "") return false;
  return ABANDONED_HOLD_STATUSES.has(String(child.status));
}

/** Minimal transactional store so the sweep can be unit-tested without Firestore. */
export type HoldCleanupTransaction = {
  getHold(id: string): Promise<HoldRecord | undefined>;
  getPayment(id: string): Promise<PaymentSnapshot>;
  deleteHold(id: string): void;
};

export type HoldCleanupOutcome =
  | { deleted: true; childIds: string[] }
  | { deleted: false; reason: HoldCleanupReason };

/**
 * Re-reads the hold (and its payment and children) inside a transaction and
 * deletes it only if it is still abandoned. Never writes bookings, payments,
 * or users. In dry-run mode nothing is deleted but the outcome is reported.
 */
export async function cleanupHoldInTransaction(
  tx: HoldCleanupTransaction,
  holdId: string,
  now: number,
  options: { dryRun?: boolean } = {},
): Promise<HoldCleanupOutcome> {
  const hold = await tx.getHold(holdId);
  const paymentId = hold && nonEmptyString(hold.paymentId) ? hold.paymentId : null;
  const payment = paymentId ? await tx.getPayment(paymentId) : null;
  const decision = abandonedHoldDecision(holdId, hold, payment, now);
  if (!decision.delete) return { deleted: false, reason: decision.reason };

  const children: string[] = [];
  for (const childId of childHoldIds(hold!)) {
    if (childHoldDeletable(holdId, await tx.getHold(childId))) children.push(childId);
  }
  if (!options.dryRun) {
    for (const childId of children) tx.deleteHold(childId);
    tx.deleteHold(holdId);
  }
  return { deleted: true, childIds: children };
}

export type HoldCleanupSummary = {
  mode: BookingHoldCleanupMode;
  scanned: number;
  deleted: number;
  childrenDeleted: number;
  skipped: Partial<Record<HoldCleanupReason, number>>;
};

export type HoldCleanupStore = {
  /** Holds with expiresAt < cutoff, oldest first, after the given cursor. */
  listExpired(cutoff: number, limit: number, after?: { expiresAt: number; id: string }): Promise<Array<{ id: string; expiresAt: number }>>;
  runTransaction<T>(fn: (tx: HoldCleanupTransaction) => Promise<T>): Promise<T>;
};

/** Pages through long-expired holds and removes the abandoned ones. */
export async function runAbandonedHoldCleanup(
  store: HoldCleanupStore,
  mode: BookingHoldCleanupMode,
  now: number,
  options: { pageSize?: number; maxDeleted?: number } = {},
): Promise<HoldCleanupSummary> {
  const summary: HoldCleanupSummary = { mode, scanned: 0, deleted: 0, childrenDeleted: 0, skipped: {} };
  if (mode === "off") return summary;
  const pageSize = options.pageSize ?? 200;
  const maxDeleted = options.maxDeleted ?? BOOKING_HOLD_CLEANUP_MAX_PER_RUN;
  const cutoff = now - BOOKING_HOLD_CLEANUP_GRACE_MS;
  let cursor: { expiresAt: number; id: string } | undefined;

  while (summary.deleted < maxDeleted) {
    const page = await store.listExpired(cutoff, pageSize, cursor);
    if (page.length === 0) break;
    for (const candidate of page) {
      if (summary.deleted >= maxDeleted) break;
      summary.scanned += 1;
      const outcome = await store.runTransaction((tx) => cleanupHoldInTransaction(
        tx, candidate.id, now, { dryRun: mode === "dry_run" },
      ));
      if (outcome.deleted) {
        summary.deleted += 1;
        summary.childrenDeleted += outcome.childIds.length;
      } else {
        summary.skipped[outcome.reason] = (summary.skipped[outcome.reason] || 0) + 1;
      }
    }
    if (page.length < pageSize) break;
    const last = page[page.length - 1];
    cursor = { expiresAt: last.expiresAt, id: last.id };
  }
  return summary;
}
