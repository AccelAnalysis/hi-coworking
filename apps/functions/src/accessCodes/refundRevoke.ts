/**
 * Door codes on booking refunds. A fully refunded booking payment means the
 * booking is off, so its live door codes are removed (plan §3.2, Jonathan
 * Nov 24, 2026). Partial refunds (a goodwill credit, a shortened booking)
 * keep the code.
 *
 * The Stripe webhook doesn't hold the Seam key, so it only marks each live
 * grant with revokeRequestedAt; access_onRevokeRequested (access source)
 * removes the code from the lock, and access_expireGrants catches anything
 * missed. No firebase-admin import, so this stays out of the Seam deploy
 * graph and is unit-testable with a fake store.
 */

export function shouldRevokeForRefund(input: { purpose: string; status: string }): boolean {
  return input.purpose === "booking" && input.status === "refunded";
}

export interface RefundRevokeStore {
  bookingIdsForPayment(paymentId: string): Promise<string[]>;
  liveGrantIdsForBooking(bookingId: string): Promise<string[]>;
  requestRevoke(grantId: string, update: Record<string, unknown>): Promise<void>;
}

/** Marks every live grant of the refunded payment's bookings for removal. Returns how many. */
export async function requestRefundRevokes(
  store: RefundRevokeStore,
  paymentId: string,
  now: number,
): Promise<number> {
  let count = 0;
  for (const bookingId of await store.bookingIdsForPayment(paymentId)) {
    for (const grantId of await store.liveGrantIdsForBooking(bookingId)) {
      await store.requestRevoke(grantId, {
        revokeRequestedAt: now,
        revokeRequestReason: "refund",
        revokeRequestedBy: "stripe-refund",
        updatedAt: now,
      });
      count += 1;
    }
  }
  return count;
}

export function firestoreRefundRevokeStore(db: FirebaseFirestore.Firestore): RefundRevokeStore {
  return {
    async bookingIdsForPayment(paymentId) {
      const snap = await db.collection("bookings").where("paymentId", "==", paymentId).get();
      return snap.docs.map((doc) => doc.id);
    },
    async liveGrantIdsForBooking(bookingId) {
      const snap = await db.collection("accessGrants").where("bookingId", "==", bookingId).get();
      return snap.docs
        .filter((doc) => {
          const status = doc.data().status;
          return status === "pending" || status === "active";
        })
        .map((doc) => doc.id);
    },
    async requestRevoke(grantId, update) {
      await db.collection("accessGrants").doc(grantId).update(update);
    },
  };
}
