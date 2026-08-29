import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type BookstoreOrderStatus = "pending_payment" | "paid" | "cancelled" | "refunded";
export type BookstoreFulfillmentStatus =
  | "not_required"
  | "awaiting_prep"
  | "ready_for_pickup"
  | "picked_up"
  | "inventory_exception"
  | "cancelled";

export interface BookstoreOrderItem {
  bookId: string;
  variantId: string;
  sku: string;
  title: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  type: "physical" | "digital";
  pickupReadyImmediately: boolean;
}

export interface BookstoreOrder {
  id: string;
  orderNumber: string;
  customerName?: string;
  customerEmail: string;
  status: BookstoreOrderStatus;
  fulfillmentMethod: "pickup" | "digital";
  fulfillmentStatus: BookstoreFulfillmentStatus;
  items: BookstoreOrderItem[];
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  pickup?: {
    locationId: string;
    locationName: string;
    address: string;
    pickupCode: string;
    readyAt?: number;
    pickedUpAt?: number;
  };
  createdAt: number;
  paidAt?: number;
  cancelledAt?: number;
  refundedAt?: number;
}

export interface BookInventoryItem {
  id: string;
  locationId: string;
  bookId: string;
  variantId: string;
  sku: string;
  bookTitle: string;
  variantName: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderAt: number;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  updatedAt: number;
}

export const createBookstoreCheckoutFn = httpsCallable<{
  bookId: string;
  variantId?: string;
  quantity?: number;
  fulfillmentMethod?: "pickup" | "digital";
  pickupLocationId?: string;
  customerName?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}, {
  sessionId: string;
  url: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  accessToken: string;
}>(functions, "bookstore_createCheckoutSession");

export const getBookstorePublicStockFn = httpsCallable<{
  bookId: string;
  variantId?: string;
  locationId?: string;
}, {
  status: "in_stock" | "low_stock" | "out_of_stock";
  pickupLocation: { id: string; name: string; address: string };
}>(functions, "bookstore_getPublicStock");

export const getBookstoreOrderFn = httpsCallable<{
  orderId: string;
  accessToken?: string;
}, {
  order: BookstoreOrder;
  pickupLocation: { id: string; name: string; address: string };
}>(functions, "bookstore_getOrder");

export const getMyBookstoreOrdersFn = httpsCallable<Record<string, never>, {
  orders: BookstoreOrder[];
}>(functions, "bookstore_getMyOrders");

export const listBookstoreOrdersFn = httpsCallable<Record<string, never>, {
  orders: BookstoreOrder[];
}>(functions, "bookstore_listOrders");

export const listBookInventoryFn = httpsCallable<Record<string, never>, {
  inventory: BookInventoryItem[];
}>(functions, "bookstore_listInventory");

export const adjustBookInventoryFn = httpsCallable<{
  bookId: string;
  variantId?: string;
  locationId?: string;
  quantityDelta: number;
  reorderAt?: number;
  reason?: string;
}, {
  inventory: BookInventoryItem;
}>(functions, "bookstore_adjustInventory");

export const setBookstorePickupStatusFn = httpsCallable<{
  orderId: string;
  action: "ready" | "picked_up";
}, {
  order: BookstoreOrder;
}>(functions, "bookstore_setPickupStatus");

/** Pending checkouts only. Paid orders use refundBookstoreOrderFn. */
export const cancelBookstoreOrderFn = httpsCallable<{
  orderId: string;
  reason?: string;
}, {
  order: BookstoreOrder;
}>(functions, "bookstore_cancelOrder");

export const refundBookstoreOrderFn = httpsCallable<{
  orderId: string;
  reason?: string;
}, {
  order: BookstoreOrder;
}>(functions, "bookstore_refundOrder");

export const getBookstoreDownloadLinkFn = httpsCallable<{
  bookId: string;
  orderId?: string;
  accessToken?: string;
}, { url: string }>(functions, "bookstore_getDownloadLink");
