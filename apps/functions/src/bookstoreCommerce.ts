import { createHash, randomBytes } from "node:crypto";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { StripeProvider } from "./payments/stripeProvider";
import { updatePaymentStatus } from "./payments/ledger";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const RESERVATION_MINUTES = 30;
const DEFAULT_PICKUP_LOCATION_ID = "main";
const PICKUP_LOCATION = {
  id: DEFAULT_PICKUP_LOCATION_ID,
  name: "Hi Coworking",
  address: "15373 Carrollton Blvd, Carrollton, VA",
};

type BookType = "physical" | "digital" | "service";
type OrderStatus = "pending_payment" | "paid" | "cancelled" | "refunded";
type FulfillmentMethod = "pickup" | "digital";
type FulfillmentStatus =
  | "not_required"
  | "awaiting_prep"
  | "ready_for_pickup"
  | "picked_up"
  | "inventory_exception"
  | "cancelled";

type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

interface BookVariantLite {
  id: string;
  name: string;
  priceCents: number;
  type: BookType;
  digitalAssetUrl?: string;
  inventory?: number;
  sku?: string;
  pickupReadyImmediately?: boolean;
  pickupLocationIds?: string[];
}

interface BookDocLite {
  id: string;
  title: string;
  author?: string;
  published?: boolean;
  availabilityMode: "browse_only" | "digital" | "physical";
  salesChannel: "owned" | "affiliate";
  priceCents?: number;
  currency?: string;
  digitalAssetUrl?: string;
  requireLoginToPurchase?: boolean;
  variants?: BookVariantLite[];
}

interface BookstoreOrderItem {
  bookId: string;
  variantId: string;
  sku: string;
  title: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  type: "physical" | "digital";
  pickupReadyImmediately: boolean;
  digitalAssetUrl?: string;
}

interface PickupDetails {
  locationId: string;
  locationName: string;
  address: string;
  pickupCode: string;
  readyAt?: number;
  pickedUpAt?: number;
}

interface BookstoreOrderDoc {
  id: string;
  orderNumber: string;
  userId?: string;
  customerName?: string;
  customerEmail: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  fulfillmentStatus: FulfillmentStatus;
  items: BookstoreOrderItem[];
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  paymentId: string;
  stripeCheckoutSessionId?: string;
  guestAccessTokenHash: string;
  reservationExpiresAt?: number;
  reservationReleasedAt?: number;
  pickup?: PickupDetails;
  createdAt: number;
  paidAt?: number;
  cancelledAt?: number;
  refundedAt?: number;
  updatedAt: number;
}

interface InventoryDoc {
  id: string;
  locationId: string;
  bookId: string;
  variantId: string;
  sku: string;
  bookTitle: string;
  variantName: string;
  onHand: number;
  reserved: number;
  reorderAt: number;
  updatedAt: number;
  updatedBy?: string;
}

function getDb() {
  return admin.firestore();
}

function getStorage() {
  return admin.storage();
}

function safeString(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeId(value: unknown, field: string): string {
  const result = safeString(value, 160);
  if (!result || result.includes("/")) {
    throw new HttpsError("invalid-argument", `${field} is invalid`);
  }
  return result;
}

function positiveQuantity(value: unknown): number {
  const quantity = Number(value ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new HttpsError("invalid-argument", "quantity must be an integer from 1 to 10");
  }
  return quantity;
}

function validatedUrl(value: unknown, field: string): string {
  const text = safeString(value, 2_048);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    return url.toString();
  } catch {
    throw new HttpsError("invalid-argument", `${field} must be a valid http(s) URL`);
  }
}

function roleFromRequest(request: { auth?: { token?: Record<string, unknown> } | null }) {
  return safeString(request.auth?.token?.role, 40);
}

function assertStaff(request: { auth?: { token?: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required");
  if (!["staff", "admin", "master"].includes(roleFromRequest(request))) {
    throw new HttpsError("permission-denied", "Staff access is required");
  }
}

function assertAdmin(request: { auth?: { token?: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required");
  if (!["admin", "master"].includes(roleFromRequest(request))) {
    throw new HttpsError("permission-denied", "Administrator access is required");
  }
}

function inventoryId(locationId: string, bookId: string, variantId: string) {
  return `${locationId}__${bookId}__${variantId}`;
}

function orderNumber(now: number) {
  const time = now.toString(36).toUpperCase().slice(-6);
  const suffix = randomBytes(2).toString("hex").toUpperCase();
  return `HC-${time}-${suffix}`;
}

function pickupCode() {
  return randomBytes(3).toString("hex").toUpperCase();
}

function accessToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function resolveVariant(book: BookDocLite, requestedVariantId?: string): BookVariantLite {
  const variants = Array.isArray(book.variants) ? book.variants : [];
  if (variants.length > 0) {
    const variant = requestedVariantId
      ? variants.find((candidate) => candidate.id === requestedVariantId)
      : variants.length === 1
        ? variants[0]
        : undefined;
    if (!variant) {
      throw new HttpsError("invalid-argument", "Choose a valid book format");
    }
    if (variant.type === "service") {
      throw new HttpsError("failed-precondition", "This format is not available through the bookstore");
    }
    return variant;
  }

  if (book.availabilityMode === "browse_only") {
    throw new HttpsError("failed-precondition", "This title is available to read here but is not for sale");
  }
  const priceCents = Number(book.priceCents || 0);
  return {
    id: "standard",
    name: book.availabilityMode === "digital" ? "Digital edition" : "Physical copy",
    priceCents,
    type: book.availabilityMode,
    digitalAssetUrl: book.digitalAssetUrl,
    pickupReadyImmediately: true,
    pickupLocationIds: [DEFAULT_PICKUP_LOCATION_ID],
  };
}

function stockStatus(inventory: InventoryDoc | undefined): StockStatus {
  if (!inventory) return "out_of_stock";
  const available = Math.max(0, inventory.onHand - inventory.reserved);
  if (available <= 0) return "out_of_stock";
  const threshold = Math.max(1, inventory.reorderAt || 1);
  return available <= threshold ? "low_stock" : "in_stock";
}

function publicOrder(order: BookstoreOrderDoc) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    status: order.status,
    fulfillmentMethod: order.fulfillmentMethod,
    fulfillmentStatus: order.fulfillmentStatus,
    items: order.items.map(({ digitalAssetUrl: _digitalAssetUrl, ...item }) => item),
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    currency: order.currency,
    pickup: order.pickup,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    refundedAt: order.refundedAt,
  };
}

async function notifyOrderUser(
  order: BookstoreOrderDoc,
  kind: "confirmed" | "ready" | "picked_up" | "refunded" | "inventory_exception",
) {
  if (!order.userId) return;
  const messages = {
    confirmed: {
      title: "Bookstore order confirmed",
      body: `${order.orderNumber} has been paid successfully.`,
    },
    ready: {
      title: "Your bookstore order is ready",
      body: `${order.orderNumber} is ready for pickup at Hi Coworking.`,
    },
    picked_up: {
      title: "Bookstore pickup complete",
      body: `${order.orderNumber} has been picked up. Thank you.`,
    },
    refunded: {
      title: "Bookstore order refunded",
      body: `${order.orderNumber} has been refunded.`,
    },
    inventory_exception: {
      title: "Bookstore order needs attention",
      body: `${order.orderNumber} was paid, but staff must confirm inventory before pickup.`,
    },
  } as const;
  const message = messages[kind];
  const id = `bookstore_${order.id}_${kind}`;
  await getDb().collection("notifications").doc(id).set({
    id,
    uid: order.userId,
    type: "payment",
    title: message.title,
    body: message.body,
    linkTo: `/account/orders?order=${order.id}`,
    read: false,
    createdAt: Date.now(),
  }, { merge: true });
}

async function releaseReservation(orderId: string, reason: string) {
  const db = getDb();
  const orderRef = db.collection("bookstoreOrders").doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const order = snap.data() as BookstoreOrderDoc;
    if (order.status !== "pending_payment" || order.reservationReleasedAt) return;

    for (const item of order.items) {
      if (item.type !== "physical") continue;
      const locationId = order.pickup?.locationId || DEFAULT_PICKUP_LOCATION_ID;
      const ref = db.collection("bookInventory").doc(inventoryId(locationId, item.bookId, item.variantId));
      const inventorySnap = await tx.get(ref);
      if (!inventorySnap.exists) continue;
      const inventory = inventorySnap.data() as InventoryDoc;
      tx.update(ref, {
        reserved: Math.max(0, inventory.reserved - item.quantity),
        updatedAt: Date.now(),
      });
    }

    tx.update(orderRef, {
      status: "cancelled",
      fulfillmentStatus: "cancelled",
      reservationReleasedAt: Date.now(),
      cancelledAt: Date.now(),
      cancellationReason: reason,
      updatedAt: Date.now(),
    });
  });
}

export const bookstore_getPublicStock = onCall(async (request) => {
  const bookId = safeId(request.data?.bookId, "bookId");
  const locationId = safeString(request.data?.locationId, 80) || DEFAULT_PICKUP_LOCATION_ID;
  const variantId = safeString(request.data?.variantId, 120) || "standard";
  const snap = await getDb().collection("bookInventory")
    .doc(inventoryId(locationId, bookId, variantId))
    .get();
  const inventory = snap.exists ? snap.data() as InventoryDoc : undefined;
  return {
    status: stockStatus(inventory),
    pickupLocation: PICKUP_LOCATION,
  };
});

export const bookstore_createCheckoutSession = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const bookId = safeId(request.data?.bookId, "bookId");
    const requestedVariantId = safeString(request.data?.variantId, 120) || undefined;
    const quantity = positiveQuantity(request.data?.quantity);
    const successUrl = validatedUrl(request.data?.successUrl, "successUrl");
    const cancelUrl = validatedUrl(request.data?.cancelUrl, "cancelUrl");
    const requestedFulfillment = safeString(request.data?.fulfillmentMethod, 40) as FulfillmentMethod;
    const pickupLocationId = safeString(request.data?.pickupLocationId, 80) || DEFAULT_PICKUP_LOCATION_ID;
    if (pickupLocationId !== DEFAULT_PICKUP_LOCATION_ID) {
      throw new HttpsError("invalid-argument", "That pickup location is not available");
    }

    const uid = request.auth?.uid;
    const tokenEmail = safeString(request.auth?.token?.email, 320);
    const customerEmail = (safeString(request.data?.customerEmail, 320) || tokenEmail).toLowerCase();
    const customerName = safeString(request.data?.customerName, 160) || safeString(request.auth?.token?.name, 160) || undefined;
    if (!customerEmail || !customerEmail.includes("@")) {
      throw new HttpsError("invalid-argument", "A valid email is required for bookstore checkout");
    }

    const db = getDb();
    const bookRef = db.collection("books").doc(bookId);
    const orderRef = db.collection("bookstoreOrders").doc();
    const paymentRef = db.collection("payments").doc();
    const rawAccessToken = accessToken();
    const now = Date.now();
    let order!: BookstoreOrderDoc;

    await db.runTransaction(async (tx) => {
      const bookSnap = await tx.get(bookRef);
      if (!bookSnap.exists) throw new HttpsError("not-found", "Book not found");
      const book = { id: bookId, ...bookSnap.data() } as BookDocLite;
      if (!book.published) throw new HttpsError("failed-precondition", "This title is not currently available");
      if (book.salesChannel !== "owned") {
        throw new HttpsError("failed-precondition", "This title is sold by an external partner");
      }
      if (book.requireLoginToPurchase && !uid) {
        throw new HttpsError("unauthenticated", "Sign in is required to purchase this title");
      }

      const variant = resolveVariant(book, requestedVariantId);
      if (!Number.isInteger(variant.priceCents) || variant.priceCents <= 0) {
        throw new HttpsError("failed-precondition", "This format does not have a valid price");
      }
      const fulfillmentMethod: FulfillmentMethod = variant.type === "digital" ? "digital" : "pickup";
      if (requestedFulfillment && requestedFulfillment !== fulfillmentMethod) {
        throw new HttpsError("invalid-argument", "That fulfillment method is not available for this format");
      }
      if (variant.type === "physical" && variant.pickupLocationIds?.length && !variant.pickupLocationIds.includes(pickupLocationId)) {
        throw new HttpsError("failed-precondition", "This format is not stocked at that pickup location");
      }

      const item: BookstoreOrderItem = {
        bookId,
        variantId: variant.id,
        sku: variant.sku || `${bookId}-${variant.id}`,
        title: book.title,
        variantName: variant.name,
        unitPriceCents: variant.priceCents,
        quantity,
        type: variant.type as "physical" | "digital",
        pickupReadyImmediately: variant.pickupReadyImmediately !== false,
        digitalAssetUrl: variant.digitalAssetUrl || book.digitalAssetUrl,
      };

      if (item.type === "physical") {
        const ref = db.collection("bookInventory").doc(inventoryId(pickupLocationId, bookId, item.variantId));
        const inventorySnap = await tx.get(ref);
        if (!inventorySnap.exists) {
          throw new HttpsError("failed-precondition", "This title is not currently in stock for pickup");
        }
        const inventory = inventorySnap.data() as InventoryDoc;
        if (inventory.onHand - inventory.reserved < quantity) {
          throw new HttpsError("resource-exhausted", "This title just sold out for pickup");
        }
        tx.update(ref, {
          reserved: inventory.reserved + quantity,
          updatedAt: now,
        });
      }

      const subtotalCents = item.unitPriceCents * quantity;
      order = {
        id: orderRef.id,
        orderNumber: orderNumber(now),
        ...(uid ? { userId: uid } : {}),
        ...(customerName ? { customerName } : {}),
        customerEmail,
        status: "pending_payment",
        fulfillmentMethod,
        fulfillmentStatus: fulfillmentMethod === "digital" ? "not_required" : "awaiting_prep",
        items: [item],
        subtotalCents,
        taxCents: 0,
        shippingCents: 0,
        totalCents: subtotalCents,
        currency: (book.currency || "usd").toLowerCase(),
        paymentId: paymentRef.id,
        guestAccessTokenHash: hashToken(rawAccessToken),
        ...(item.type === "physical" ? {
          reservationExpiresAt: now + RESERVATION_MINUTES * 60_000,
          pickup: {
            locationId: pickupLocationId,
            locationName: PICKUP_LOCATION.name,
            address: PICKUP_LOCATION.address,
            pickupCode: pickupCode(),
          },
        } : {}),
        createdAt: now,
        updatedAt: now,
      };

      tx.set(orderRef, order);
      tx.set(paymentRef, {
        id: paymentRef.id,
        uid: uid || `guest_${orderRef.id}`,
        provider: "stripe",
        amount: subtotalCents,
        currency: order.currency,
        purpose: "bookstore",
        purposeRefId: orderRef.id,
        status: "pending",
        providerRefs: {
          bookstoreOrderId: orderRef.id,
          fulfillmentMethod,
        },
        createdAt: now,
      });
    });

    try {
      const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
      const session = await provider.createCheckoutSession({
        uid: uid || `guest_${orderRef.id}`,
        amount: order.totalCents,
        currency: order.currency,
        purpose: "bookstore",
        purposeRefId: orderRef.id,
        successUrl,
        cancelUrl,
        mode: "payment",
        lineItemLabel: `${order.items[0].title} — ${order.items[0].variantName}${quantity > 1 ? ` × ${quantity}` : ""}`,
        metadata: {
          paymentId: paymentRef.id,
          bookstoreOrderId: orderRef.id,
          fulfillmentMethod: order.fulfillmentMethod,
          email: customerEmail,
        },
      });
      await Promise.all([
        orderRef.update({
          stripeCheckoutSessionId: session.sessionId,
          updatedAt: Date.now(),
        }),
        paymentRef.update({
          "providerRefs.stripeCheckoutSessionId": session.sessionId,
          updatedAt: Date.now(),
        }),
      ]);
      return {
        sessionId: session.sessionId,
        url: session.url,
        paymentId: paymentRef.id,
        orderId: orderRef.id,
        orderNumber: order.orderNumber,
        accessToken: rawAccessToken,
      };
    } catch (error) {
      logger.error("Bookstore Stripe checkout creation failed", { orderId: orderRef.id, error });
      await releaseReservation(orderRef.id, "checkout_creation_failed");
      await paymentRef.update({ status: "failed", updatedAt: Date.now() }).catch(() => undefined);
      throw new HttpsError("internal", "We could not start checkout. Please try again.");
    }
  },
);

async function finalizePaidOrder(orderId: string, paymentId: string) {
  const db = getDb();
  const orderRef = db.collection("bookstoreOrders").doc(orderId);
  let finalized: BookstoreOrderDoc | undefined;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new Error(`Bookstore order ${orderId} not found`);
    const order = snap.data() as BookstoreOrderDoc;
    if (order.paymentId !== paymentId) throw new Error(`Bookstore payment mismatch for ${orderId}`);
    if (order.status === "paid" || order.status === "refunded") {
      finalized = order;
      return;
    }

    let inventoryException = false;
    for (const item of order.items) {
      if (item.type !== "physical") continue;
      const locationId = order.pickup?.locationId || DEFAULT_PICKUP_LOCATION_ID;
      const ref = db.collection("bookInventory").doc(inventoryId(locationId, item.bookId, item.variantId));
      const inventorySnap = await tx.get(ref);
      if (!inventorySnap.exists) {
        inventoryException = true;
        continue;
      }
      const inventory = inventorySnap.data() as InventoryDoc;
      const reservationWasReleased = Boolean(order.reservationReleasedAt);
      if (reservationWasReleased) {
        const available = inventory.onHand - inventory.reserved;
        if (available < item.quantity) {
          inventoryException = true;
          continue;
        }
        tx.update(ref, {
          onHand: inventory.onHand - item.quantity,
          updatedAt: Date.now(),
        });
      } else {
        if (inventory.reserved < item.quantity || inventory.onHand < item.quantity) {
          inventoryException = true;
          continue;
        }
        tx.update(ref, {
          onHand: inventory.onHand - item.quantity,
          reserved: inventory.reserved - item.quantity,
          updatedAt: Date.now(),
        });
      }
      const adjustmentId = `${order.id}__${item.bookId}__${item.variantId}__sale`;
      tx.set(db.collection("bookInventoryAdjustments").doc(adjustmentId), {
        id: adjustmentId,
        inventoryId: inventory.id,
        locationId,
        bookId: item.bookId,
        variantId: item.variantId,
        type: "sale",
        quantityDelta: -item.quantity,
        orderId: order.id,
        createdAt: Date.now(),
      }, { merge: true });
    }

    const fulfillmentStatus: FulfillmentStatus = inventoryException
      ? "inventory_exception"
      : order.fulfillmentMethod === "digital"
        ? "not_required"
        : order.items.every((item) => item.pickupReadyImmediately)
          ? "ready_for_pickup"
          : "awaiting_prep";
    const now = Date.now();
    const updates: Partial<BookstoreOrderDoc> = {
      status: "paid",
      fulfillmentStatus,
      paidAt: now,
      updatedAt: now,
    };
    if (fulfillmentStatus === "ready_for_pickup" && order.pickup) {
      updates.pickup = { ...order.pickup, readyAt: now };
    }
    tx.update(orderRef, updates as Record<string, unknown>);

    for (const item of order.items) {
      if (item.type !== "digital") continue;
      const entitlementId = `${order.id}__${item.bookId}__${item.variantId}`;
      tx.set(db.collection("bookEntitlements").doc(entitlementId), {
        id: entitlementId,
        ...(order.userId ? { userId: order.userId } : {}),
        email: order.customerEmail,
        orderId: order.id,
        bookId: item.bookId,
        variantId: item.variantId,
        digitalAssetUrl: item.digitalAssetUrl || null,
        status: "active",
        grantedAt: now,
        createdAt: now,
      }, { merge: true });
      const purchaseId = `order_${entitlementId}`;
      tx.set(db.collection("bookPurchases").doc(purchaseId), {
        id: purchaseId,
        bookId: item.bookId,
        ...(order.userId ? { userId: order.userId } : {}),
        email: order.customerEmail,
        stripeSessionId: order.stripeCheckoutSessionId || null,
        variantId: item.variantId,
        quantity: item.quantity,
        accessGrantedAt: now,
        createdAt: now,
      }, { merge: true });
    }

    finalized = {
      ...order,
      ...updates,
      ...(updates.pickup ? { pickup: updates.pickup } : {}),
    } as BookstoreOrderDoc;
  });

  if (finalized) {
    const kind = finalized.fulfillmentStatus === "inventory_exception"
      ? "inventory_exception"
      : finalized.fulfillmentStatus === "ready_for_pickup"
        ? "ready"
        : "confirmed";
    await notifyOrderUser(finalized, kind).catch((error) => {
      logger.error("Bookstore in-app notification failed", { orderId, error });
    });
  }
}

export const bookstore_onPaymentUpdated = onDocumentUpdated("payments/{paymentId}", async (event) => {
  const before = event.data?.before.data() as Record<string, unknown> | undefined;
  const after = event.data?.after.data() as Record<string, unknown> | undefined;
  if (!after || after.purpose !== "bookstore" || after.status !== "paid" || before?.status === "paid") return;
  const orderId = safeString(after.purposeRefId, 180);
  if (!orderId) {
    logger.error("Paid bookstore payment is missing purposeRefId", { paymentId: event.params.paymentId });
    return;
  }
  await finalizePaidOrder(orderId, event.params.paymentId);
});

export const bookstore_releaseExpiredReservations = onSchedule("every 15 minutes", async () => {
  const now = Date.now();
  const snap = await getDb().collection("bookstoreOrders")
    .where("reservationExpiresAt", "<=", now)
    .limit(100)
    .get();
  for (const doc of snap.docs) {
    const order = doc.data() as BookstoreOrderDoc;
    if (order.status === "pending_payment" && !order.reservationReleasedAt) {
      await releaseReservation(order.id, "checkout_expired");
      await updatePaymentStatus(order.paymentId, "failed").catch(() => undefined);
    }
  }
});

export const bookstore_getOrder = onCall(async (request) => {
  const orderId = safeId(request.data?.orderId, "orderId");
  const snap = await getDb().collection("bookstoreOrders").doc(orderId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found");
  const order = snap.data() as BookstoreOrderDoc;
  const role = roleFromRequest(request);
  const mayRead = request.auth?.uid === order.userId || ["staff", "admin", "master"].includes(role);
  if (!mayRead) {
    const token = safeString(request.data?.accessToken, 200);
    if (!token || hashToken(token) !== order.guestAccessTokenHash) {
      throw new HttpsError("permission-denied", "Order access could not be verified");
    }
  }
  return { order: publicOrder(order), pickupLocation: PICKUP_LOCATION };
});

export const bookstore_getMyOrders = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required");
  const snap = await getDb().collection("bookstoreOrders").where("userId", "==", request.auth.uid).limit(100).get();
  const orders = snap.docs
    .map((doc) => publicOrder(doc.data() as BookstoreOrderDoc))
    .sort((a, b) => b.createdAt - a.createdAt);
  return { orders };
});

export const bookstore_listOrders = onCall(async (request) => {
  assertStaff(request);
  const snap = await getDb().collection("bookstoreOrders").orderBy("createdAt", "desc").limit(100).get();
  return { orders: snap.docs.map((doc) => publicOrder(doc.data() as BookstoreOrderDoc)) };
});

export const bookstore_listInventory = onCall(async (request) => {
  assertStaff(request);
  const snap = await getDb().collection("bookInventory").limit(500).get();
  const inventory = snap.docs.map((doc) => {
    const item = doc.data() as InventoryDoc;
    return {
      ...item,
      available: Math.max(0, item.onHand - item.reserved),
      stockStatus: stockStatus(item),
    };
  }).sort((a, b) => a.bookTitle.localeCompare(b.bookTitle) || a.variantName.localeCompare(b.variantName));
  return { inventory };
});

export const bookstore_adjustInventory = onCall(async (request) => {
  assertAdmin(request);
  const bookId = safeId(request.data?.bookId, "bookId");
  const requestedVariantId = safeString(request.data?.variantId, 120) || undefined;
  const locationId = safeString(request.data?.locationId, 80) || DEFAULT_PICKUP_LOCATION_ID;
  const delta = Number(request.data?.quantityDelta);
  const reorderAt = Math.max(0, Math.floor(Number(request.data?.reorderAt ?? 3)));
  const reason = safeString(request.data?.reason, 240) || "Manual inventory adjustment";
  if (locationId !== DEFAULT_PICKUP_LOCATION_ID) throw new HttpsError("invalid-argument", "Unknown pickup location");
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000) {
    throw new HttpsError("invalid-argument", "quantityDelta must be a non-zero integer up to 1000 units");
  }

  const db = getDb();
  const bookRef = db.collection("books").doc(bookId);
  let result!: InventoryDoc;
  await db.runTransaction(async (tx) => {
    const bookSnap = await tx.get(bookRef);
    if (!bookSnap.exists) throw new HttpsError("not-found", "Book not found");
    const book = { id: bookId, ...bookSnap.data() } as BookDocLite;
    const variant = resolveVariant(book, requestedVariantId);
    if (variant.type !== "physical") throw new HttpsError("failed-precondition", "Only physical formats have pickup inventory");

    const id = inventoryId(locationId, bookId, variant.id);
    const ref = db.collection("bookInventory").doc(id);
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() as InventoryDoc : undefined;
    const onHand = (current?.onHand || 0) + delta;
    const reserved = current?.reserved || 0;
    if (onHand < 0 || onHand < reserved) {
      throw new HttpsError("failed-precondition", "This adjustment would reduce stock below reserved orders");
    }
    result = {
      id,
      locationId,
      bookId,
      variantId: variant.id,
      sku: variant.sku || current?.sku || `${bookId}-${variant.id}`,
      bookTitle: book.title,
      variantName: variant.name,
      onHand,
      reserved,
      reorderAt,
      updatedAt: Date.now(),
      updatedBy: request.auth!.uid,
    };
    tx.set(ref, result, { merge: true });
    const adjustmentRef = db.collection("bookInventoryAdjustments").doc();
    tx.set(adjustmentRef, {
      id: adjustmentRef.id,
      inventoryId: id,
      locationId,
      bookId,
      variantId: variant.id,
      type: delta > 0 ? "received" : "manual_adjustment",
      quantityDelta: delta,
      reason,
      performedBy: request.auth!.uid,
      createdAt: Date.now(),
    });
  });
  return {
    inventory: {
      ...result,
      available: Math.max(0, result.onHand - result.reserved),
      stockStatus: stockStatus(result),
    },
  };
});

export const bookstore_setPickupStatus = onCall(async (request) => {
  assertStaff(request);
  const orderId = safeId(request.data?.orderId, "orderId");
  const action = safeString(request.data?.action, 40);
  if (!["ready", "picked_up"].includes(action)) throw new HttpsError("invalid-argument", "Unknown pickup action");
  const ref = getDb().collection("bookstoreOrders").doc(orderId);
  let updated!: BookstoreOrderDoc;
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found");
    const order = snap.data() as BookstoreOrderDoc;
    if (order.status !== "paid" || order.fulfillmentMethod !== "pickup") {
      throw new HttpsError("failed-precondition", "This order is not an active paid pickup order");
    }
    const now = Date.now();
    if (action === "ready") {
      if (!["awaiting_prep", "ready_for_pickup"].includes(order.fulfillmentStatus)) {
        throw new HttpsError("failed-precondition", "This order cannot be marked ready");
      }
      updated = {
        ...order,
        fulfillmentStatus: "ready_for_pickup",
        pickup: order.pickup ? { ...order.pickup, readyAt: order.pickup.readyAt || now } : order.pickup,
        updatedAt: now,
      } as BookstoreOrderDoc;
    } else {
      if (order.fulfillmentStatus !== "ready_for_pickup") {
        throw new HttpsError("failed-precondition", "Mark the order ready before completing pickup");
      }
      updated = {
        ...order,
        fulfillmentStatus: "picked_up",
        pickup: order.pickup ? { ...order.pickup, pickedUpAt: now } : order.pickup,
        updatedAt: now,
      } as BookstoreOrderDoc;
    }
    tx.update(ref, {
      fulfillmentStatus: updated.fulfillmentStatus,
      pickup: updated.pickup || null,
      updatedAt: updated.updatedAt,
    });
  });
  await notifyOrderUser(updated, action === "ready" ? "ready" : "picked_up").catch(() => undefined);
  return { order: publicOrder(updated) };
});

export const bookstore_cancelOrder = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    assertStaff(request);
    const orderId = safeId(request.data?.orderId, "orderId");
    const reason = safeString(request.data?.reason, 300) || "Cancelled by staff";
    const db = getDb();
    const ref = db.collection("bookstoreOrders").doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Order not found");
    const order = snap.data() as BookstoreOrderDoc;
    if (order.status === "refunded" || order.status === "cancelled") return { order: publicOrder(order) };
    if (order.fulfillmentStatus === "picked_up") {
      throw new HttpsError("failed-precondition", "Picked-up orders require a return workflow before refunding");
    }

    if (order.status === "pending_payment") {
      await releaseReservation(order.id, reason);
      await updatePaymentStatus(order.paymentId, "failed").catch(() => undefined);
      const cancelled = (await ref.get()).data() as BookstoreOrderDoc;
      return { order: publicOrder(cancelled) };
    }

    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    await provider.refundCheckoutPayment({
      checkoutSessionId: order.stripeCheckoutSessionId,
      ledgerPaymentId: order.paymentId,
      idempotencyKey: `bookstore-refund-${order.id}`,
      metadata: { orderId: order.id, reason: reason.slice(0, 120) },
    });

    let refunded!: BookstoreOrderDoc;
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(ref);
      if (!freshSnap.exists) throw new HttpsError("not-found", "Order not found");
      const fresh = freshSnap.data() as BookstoreOrderDoc;
      if (fresh.status === "refunded") {
        refunded = fresh;
        return;
      }
      const now = Date.now();
      for (const item of fresh.items) {
        if (item.type === "physical") {
          const locationId = fresh.pickup?.locationId || DEFAULT_PICKUP_LOCATION_ID;
          const inventoryRef = db.collection("bookInventory").doc(inventoryId(locationId, item.bookId, item.variantId));
          const inventorySnap = await tx.get(inventoryRef);
          if (inventorySnap.exists) {
            const inventory = inventorySnap.data() as InventoryDoc;
            tx.update(inventoryRef, { onHand: inventory.onHand + item.quantity, updatedAt: now });
            const adjustmentRef = db.collection("bookInventoryAdjustments").doc(`${fresh.id}__${item.bookId}__${item.variantId}__refund`);
            tx.set(adjustmentRef, {
              id: adjustmentRef.id,
              inventoryId: inventory.id,
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
        } else {
          const entitlementId = `${fresh.id}__${item.bookId}__${item.variantId}`;
          tx.set(db.collection("bookEntitlements").doc(entitlementId), {
            status: "revoked",
            revokedAt: now,
            revokeReason: "refund",
          }, { merge: true });
        }
      }
      refunded = {
        ...fresh,
        status: "refunded",
        fulfillmentStatus: "cancelled",
        refundedAt: now,
        updatedAt: now,
      };
      tx.update(ref, {
        status: "refunded",
        fulfillmentStatus: "cancelled",
        refundReason: reason,
        refundedAt: now,
        updatedAt: now,
      });
    });
    await updatePaymentStatus(order.paymentId, "refunded");
    await notifyOrderUser(refunded, "refunded").catch(() => undefined);
    return { order: publicOrder(refunded) };
  },
);

export const bookstore_getDownloadLink = onCall(async (request) => {
  const bookId = safeId(request.data?.bookId, "bookId");
  const db = getDb();
  let assetPath = "";

  if (request.auth) {
    const entitlementSnap = await db.collection("bookEntitlements")
      .where("userId", "==", request.auth.uid)
      .where("bookId", "==", bookId)
      .limit(10)
      .get();
    const entitlement = entitlementSnap.docs
      .map((doc) => doc.data() as Record<string, unknown>)
      .find((item) => item.status === "active");
    assetPath = safeString(entitlement?.digitalAssetUrl, 2_048);

    if (!assetPath) {
      const legacyPurchase = await db.collection("bookPurchases")
        .where("userId", "==", request.auth.uid)
        .where("bookId", "==", bookId)
        .limit(1)
        .get();
      if (!legacyPurchase.empty) {
        const bookSnap = await db.collection("books").doc(bookId).get();
        assetPath = safeString(bookSnap.data()?.digitalAssetUrl, 2_048);
      }
    }
  } else {
    const orderId = safeId(request.data?.orderId, "orderId");
    const token = safeString(request.data?.accessToken, 200);
    const orderSnap = await db.collection("bookstoreOrders").doc(orderId).get();
    if (!orderSnap.exists) throw new HttpsError("permission-denied", "Purchase access could not be verified");
    const order = orderSnap.data() as BookstoreOrderDoc;
    if (!token || hashToken(token) !== order.guestAccessTokenHash || order.status !== "paid") {
      throw new HttpsError("permission-denied", "Purchase access could not be verified");
    }
    const item = order.items.find((candidate) => candidate.bookId === bookId && candidate.type === "digital");
    assetPath = item?.digitalAssetUrl || "";
  }

  if (!assetPath) throw new HttpsError("permission-denied", "An active digital purchase is required");
  if (assetPath.startsWith("http://") || assetPath.startsWith("https://")) {
    return { url: assetPath };
  }

  const cleanPath = assetPath.replace(/^gs:\/\/[^/]+\//, "");
  const file = getStorage().bucket().file(cleanPath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", "The purchased digital file is unavailable");
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1_000 });
  return { url };
});
