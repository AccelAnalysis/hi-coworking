import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { StripeProvider } from "./payments/stripeProvider";
import { updatePaymentStatus } from "./payments/ledger";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const DEFAULT_PICKUP_LOCATION_ID = "main";

interface RefundOrderItem {
  bookId: string;
  variantId: string;
  quantity: number;
  type: "physical" | "digital";
}

interface RefundOrder {
  id: string;
  orderNumber: string;
  userId?: string;
  status: "pending_payment" | "paid" | "cancelled" | "refunded";
  fulfillmentStatus: string;
  items: RefundOrderItem[];
  paymentId: string;
  stripeCheckoutSessionId?: string;
  pickup?: { locationId?: string };
}

function getDb() {
  return admin.firestore();
}

function inventoryId(locationId: string, bookId: string, variantId: string) {
  return `${locationId}__${bookId}__${variantId}`;
}

function staffRole(request: { auth?: { token?: Record<string, unknown> } | null }) {
  const value = request.auth?.token?.role;
  return typeof value === "string" ? value : "";
}

function assertStaff(request: { auth?: { token?: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required");
  if (!["staff", "admin", "master"].includes(staffRole(request))) {
    throw new HttpsError("permission-denied", "Staff access is required");
  }
}

function orderIdFrom(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.includes("/")) {
    throw new HttpsError("invalid-argument", "orderId is invalid");
  }
  return value.trim().slice(0, 180);
}

function publicOrder(order: RefundOrder & Record<string, unknown>) {
  const { guestAccessTokenHash: _secret, ...safe } = order;
  return safe;
}

/**
 * Refund a paid bookstore order before pickup.
 *
 * Inventory is restored only when a physical sale was actually committed.
 * An inventory_exception means payment arrived after the reservation could no
 * longer be honored, so there is no sold unit to return to on-hand stock.
 */
export const bookstore_refundOrder = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    assertStaff(request);
    const orderId = orderIdFrom(request.data?.orderId);
    const reason = typeof request.data?.reason === "string" && request.data.reason.trim()
      ? request.data.reason.trim().slice(0, 300)
      : "Refunded by bookstore staff";

    const db = getDb();
    const orderRef = db.collection("bookstoreOrders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
    const order = orderSnap.data() as RefundOrder & Record<string, unknown>;

    if (order.status === "refunded") return { order: publicOrder(order) };
    if (order.status !== "paid") {
      throw new HttpsError("failed-precondition", "Only paid bookstore orders can be refunded here");
    }
    if (order.fulfillmentStatus === "picked_up") {
      throw new HttpsError(
        "failed-precondition",
        "Picked-up orders require a return to be received before refunding",
      );
    }

    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    await provider.refundCheckoutPayment({
      checkoutSessionId: order.stripeCheckoutSessionId,
      ledgerPaymentId: order.paymentId,
      idempotencyKey: `bookstore-refund-${order.id}`,
      metadata: { orderId: order.id, reason: reason.slice(0, 120) },
    });

    let refunded: (RefundOrder & Record<string, unknown>) | undefined;
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(orderRef);
      if (!freshSnap.exists) throw new HttpsError("not-found", "Order not found");
      const fresh = freshSnap.data() as RefundOrder & Record<string, unknown>;
      if (fresh.status === "refunded") {
        refunded = fresh;
        return;
      }
      if (fresh.status !== "paid" || fresh.fulfillmentStatus === "picked_up") {
        throw new HttpsError("failed-precondition", "This order is no longer refundable through the pickup queue");
      }

      const now = Date.now();
      const restorePhysicalInventory = fresh.fulfillmentStatus !== "inventory_exception";

      for (const item of fresh.items) {
        if (item.type === "physical" && restorePhysicalInventory) {
          const locationId = fresh.pickup?.locationId || DEFAULT_PICKUP_LOCATION_ID;
          const inventoryRef = db.collection("bookInventory")
            .doc(inventoryId(locationId, item.bookId, item.variantId));
          const inventorySnap = await tx.get(inventoryRef);
          if (inventorySnap.exists) {
            const inventory = inventorySnap.data() as { id?: string; onHand?: number };
            tx.update(inventoryRef, {
              onHand: Math.max(0, Number(inventory.onHand || 0)) + item.quantity,
              updatedAt: now,
            });
            const adjustmentId = `${fresh.id}__${item.bookId}__${item.variantId}__refund`;
            tx.set(db.collection("bookInventoryAdjustments").doc(adjustmentId), {
              id: adjustmentId,
              inventoryId: inventory.id || inventoryRef.id,
              locationId,
              bookId: item.bookId,
              variantId: item.variantId,
              type: "return",
              quantityDelta: item.quantity,
              orderId: fresh.id,
              reason,
              performedBy: request.auth!.uid,
              createdAt: now,
            }, { merge: true });
          }
        }

        if (item.type === "digital") {
          const entitlementId = `${fresh.id}__${item.bookId}__${item.variantId}`;
          tx.set(db.collection("bookEntitlements").doc(entitlementId), {
            status: "revoked",
            revokedAt: now,
            revokeReason: "refund",
          }, { merge: true });
        }
      }

      const updates = {
        status: "refunded" as const,
        fulfillmentStatus: "cancelled",
        refundReason: reason,
        refundedAt: now,
        updatedAt: now,
      };
      tx.update(orderRef, updates);
      refunded = { ...fresh, ...updates };
    });

    await updatePaymentStatus(order.paymentId, "refunded");

    if (refunded?.userId) {
      const notificationId = `bookstore_${order.id}_refunded`;
      await db.collection("notifications").doc(notificationId).set({
        id: notificationId,
        uid: refunded.userId,
        type: "payment",
        title: "Bookstore order refunded",
        body: `${order.orderNumber} has been refunded.`,
        linkTo: `/account/orders?order=${order.id}`,
        read: false,
        createdAt: Date.now(),
      }, { merge: true }).catch(() => undefined);
    }

    return { order: publicOrder(refunded || order) };
  },
);
