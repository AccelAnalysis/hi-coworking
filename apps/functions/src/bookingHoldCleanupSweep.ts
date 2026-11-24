import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  bookingHoldCleanupMode,
  runAbandonedHoldCleanup,
  type HoldCleanupStore,
  type HoldRecord,
} from "./bookingHoldCleanup";

/**
 * Firestore adapter for the abandoned checkout-hold sweep. It only reads
 * bookingHolds and payments, and only deletes bookingHolds documents that
 * abandonedHoldDecision() approves inside a transaction.
 */
export function firestoreHoldCleanupStore(db: FirebaseFirestore.Firestore): HoldCleanupStore {
  const holds = db.collection("bookingHolds");
  return {
    async listExpired(cutoff, limit, after) {
      let query = holds
        .where("expiresAt", "<", cutoff)
        .orderBy("expiresAt")
        // "__name__" is the document id; avoids a FieldPath from another SDK copy.
        .orderBy("__name__")
        .limit(limit);
      if (after) query = query.startAfter(after.expiresAt, after.id);
      const snap = await query.get();
      return snap.docs.map((doc) => ({ id: doc.id, expiresAt: Number(doc.get("expiresAt")) }));
    },
    runTransaction(fn) {
      return db.runTransaction((tx) => fn({
        async getHold(id) {
          const snap = await tx.get(holds.doc(id));
          return snap.exists ? (snap.data() as HoldRecord) : undefined;
        },
        async getPayment(id) {
          const snap = await tx.get(db.collection("payments").doc(id));
          return snap.exists ? { exists: true, status: snap.get("status") } : { exists: false };
        },
        deleteHold(id) {
          tx.delete(holds.doc(id));
        },
      }));
    },
  };
}

/**
 * Daily sweep of abandoned public checkout holds (and the guest contact
 * details they carry). OFF by default: set BOOKING_HOLD_CLEANUP_MODE to
 * "dry_run" to only log what would be removed, or "delete" to remove it.
 * Deploying or enabling this function needs Jonathan's explicit approval.
 */
export const booking_cleanupAbandonedHolds = onSchedule(
  { schedule: "every day 03:30", timeZone: "America/New_York" },
  async () => {
    const mode = bookingHoldCleanupMode();
    if (mode === "off") {
      logger.info("Abandoned booking hold cleanup is off");
      return;
    }
    const summary = await runAbandonedHoldCleanup(
      firestoreHoldCleanupStore(admin.firestore()),
      mode,
      Date.now(),
    );
    // Counts only: no hold ids, guest names, emails or phone numbers.
    logger.info("Abandoned booking hold cleanup finished", summary);
  },
);
