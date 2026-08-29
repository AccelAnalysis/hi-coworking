import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { updatePaymentStatus } from "./payments/ledger";

const DEFAULT_PICKUP_LOCATION_ID = "main";

interface PendingOrderItem {
  bookId: string;
  variantId: string;
  quantity: number;
  type: "physical" | "digital";
}

interface PendingOrder {
  id: string;
  orderNumber: string;
  status: "pending_payment" | "paid" | "cancelled" | "refunded";
  fulfillmentStatus: string;
  fulfillmentMethod: "pickup" | "digital";
  items: PendingOrderItem[];
  paymentId: string;
  pickup?: { locationId?: string };
  reservationReleasedAt?: number;
}

function getDb() {
  return admin.firestore();
}

function inventoryId(locationId: string, bookId: string, variantId: string) {
  return `${locationId}__${bookId}__${variantId}`;
}

function role(request: { auth?: { token?: Record<string, unknown> } | null }) {
  const value = request.auth?.token?.role;
  return typeof value === "string" ? value : "";
}

function assertStaff(request: { auth?: { token?: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required");
  if (!["staff", "admin", "master"].includes(role(request))) {
    throw new HttpsError("permission-denied", "Staff access is required");
  }
}

function safeOrderId(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.includes("/")) {
    throw new HttpsError("invalid-argument", "orderId is invalid");
  }
  return value.trim().slice(0, 180);
}

/**
 * Cancel an unpaid bookstore checkout and release its inventory reservation.
 * Paid orders are deliberately rejected here and must use bookstore_refundOrder.
 */
export const bookstore_cancelOrder = onCall(async (request) => {
  assertStaff(request);
  const orderId = safeOrderId(request.data?.orderId);
  const reason = typeof request.data?.reason === "string" && request.data.reason.trim()
    ? request.data.reason.trim().slice(0, 300)
    : "Pending bookstore checkout cancelled by staff";

  const db = getDb();
  const orderRef = db.collection("bookstoreOrders").doc(orderId);
  let paymentId = "";

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
    const order = orderSnap.data() as PendingOrder;
    paymentId = order.paymentId;

    if (order.status === "cancelled") return;
    if (order.status !== "pending_payment") {
      throw new HttpsError(
        "failed-precondition",
        "Paid bookstore orders must use the refund workflow",
      );
    }

    if (!order.reservationReleasedAt) {
      for (const item of order.items) {
        if (item.type !== "physical") continue;
        const locationId = order.pickup?.locationId || DEFAULT_PICKUP_LOCATION_ID;
        const inventoryRef = db.collection("bookInventory")
          .doc(inventoryId(locationId, item.bookId, item.variantId));
        const inventorySnap = await tx.get(inventoryRef);
        if (!inventorySnap.exists) continue;
        const inventory = inventorySnap.data() as { reserved?: number };
        tx.update(inventoryRef, {
          reserved: Math.max(0, Number(inventory.reserved || 0) - item.quantity),
          updatedAt: Date.now(),
        });
      }
    }

    const now = Date.now();
    tx.update(orderRef, {
      status: "cancelled",
      fulfillmentStatus: "cancelled",
      reservationReleasedAt: order.reservationReleasedAt || now,
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
    });
  });

  if (paymentId) {
    await updatePaymentStatus(paymentId, "failed").catch(() => undefined);
  }

  const finalSnap = await orderRef.get();
  const finalOrder = finalSnap.data() as Record<string, unknown> | undefined;
  if (!finalOrder) throw new HttpsError("not-found", "Order not found");
  const { guestAccessTokenHash: _secret, ...safe } = finalOrder;
  return { order: safe };
});
