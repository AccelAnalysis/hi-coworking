import { onCall, HttpsError } from "firebase-functions/v2/https";

function requireAdmin(request: {
  auth?: {
    uid: string;
    token: Record<string, unknown>;
  } | null;
}) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const role = request.auth.token.role;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError(
      "permission-denied",
      "Admin access is required.",
    );
  }
}

/**
 * Compatibility shim for the retired generic payment-state editor.
 *
 * Payment state is authoritative to the payment provider or the originating
 * transaction lifecycle. Keeping the old function name deployed fail-closed
 * prevents stale Admin clients from marking a Stripe/QuickBooks transaction
 * paid, failed, or refunded without the corresponding provider operation.
 */
export const admin_markPaymentStatus = onCall(async (request) => {
  requireAdmin(request);

  throw new HttpsError(
    "failed-precondition",
    "Manual payment status changes are retired. Payment status is updated by Stripe or QuickBooks and refunds/cancellations must run through the originating transaction workflow.",
  );
});
