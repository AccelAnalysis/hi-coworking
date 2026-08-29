import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp as deleteAdminApp,
  getApps as getAdminApps,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore, type Firestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";

const PROJECT_ID = "demo-hi-coworking";
const REGION = "us-central1";
const AUTH_URL = "http://127.0.0.1:9100";
const FUNCTIONS_HOST = "127.0.0.1";
const FUNCTIONS_PORT = 5004;
const FIRESTORE_URL = "http://127.0.0.1:8081";
const PASSWORD = "bookstore-test-password";

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9100";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

let adminApp: AdminApp;
let db: Firestore;
let sequence = 0;
const clients: FirebaseApp[] = [];

async function clearFirestore() {
  const response = await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Could not clear Firestore: ${response.status}`);
}

async function clearAuth() {
  const response = await fetch(`${AUTH_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Could not clear Auth: ${response.status}`);
}

function client(name: string) {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
  }, `${name}-${++sequence}`);
  clients.push(app);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, FUNCTIONS_HOST, FUNCTIONS_PORT);
  return { app, functions };
}

async function staffClient(uid: string, role: "admin" | "staff" = "admin") {
  const email = `${uid}@example.test`;
  await getAdminAuth(adminApp).createUser({ uid, email, password: PASSWORD, emailVerified: true });
  await getAdminAuth(adminApp).setCustomUserClaims(uid, { role });
  await db.collection("users").doc(uid).set({
    uid,
    email,
    displayName: "Bookstore Test Staff",
    role,
    membershipStatus: "none",
    createdAt: Date.now(),
  });
  const result = client(uid);
  const auth = getAuth(result.app);
  connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  await auth.currentUser?.getIdToken(true);
  return result.functions;
}

async function call<Result>(functions: Functions, name: string, data: Record<string, unknown>) {
  return (await httpsCallable<Record<string, unknown>, Result>(functions, name)(data)).data;
}

async function seedPhysicalBook() {
  await db.collection("books").doc("pickup-book").set({
    id: "pickup-book",
    title: "Pickup Book",
    author: "Hi Coworking",
    availabilityMode: "physical",
    salesChannel: "owned",
    variants: [{
      id: "paperback",
      name: "Paperback",
      priceCents: 2495,
      type: "physical",
      sku: "HC-PICKUP-PB",
      pickupReadyImmediately: true,
      pickupLocationIds: ["main"],
    }],
    bundleIds: [],
    requireLoginToView: false,
    requireLoginToPurchase: false,
    requireLoginToAccessContent: false,
    tags: [],
    published: true,
    createdBy: "seed",
    createdAt: Date.now(),
  });
}

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 10_000) {
  const started = Date.now();
  let latest = await read();
  while (!predicate(latest)) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for emulator trigger");
    await new Promise((resolve) => setTimeout(resolve, 200));
    latest = await read();
  }
  return latest;
}

beforeAll(() => {
  adminApp = getAdminApps().find((app) => app.name === "bookstore-commerce-tests")
    ?? initializeAdminApp({ projectId: PROJECT_ID }, "bookstore-commerce-tests");
  db = getAdminFirestore(adminApp);
});

beforeEach(async () => {
  await Promise.all([clearFirestore(), clearAuth()]);
});

afterAll(async () => {
  await Promise.all(clients.map((app) => deleteApp(app).catch(() => undefined)));
  await deleteAdminApp(adminApp).catch(() => undefined);
});

describe("bookstore pickup commerce", () => {
  it("lets an administrator receive on-site stock and exposes only a stock status publicly", async () => {
    await seedPhysicalBook();
    const adminFunctions = await staffClient("bookstore-admin-1");
    const adjusted = await call<{ inventory: { onHand: number; reserved: number; available: number; stockStatus: string } }>(
      adminFunctions,
      "bookstore_adjustInventory",
      {
        bookId: "pickup-book",
        variantId: "paperback",
        quantityDelta: 5,
        reorderAt: 2,
        reason: "Initial on-site count",
      },
    );
    expect(adjusted.inventory).toMatchObject({ onHand: 5, reserved: 0, available: 5, stockStatus: "in_stock" });

    const anonymous = client("bookstore-public").functions;
    const publicResult = await call<{ status: string; pickupLocation: { address: string } }>(
      anonymous,
      "bookstore_getPublicStock",
      { bookId: "pickup-book", variantId: "paperback" },
    );
    expect(publicResult.status).toBe("in_stock");
    expect(publicResult.pickupLocation.address).toContain("15373 Carrollton Blvd");
    expect(publicResult).not.toHaveProperty("onHand");
  });

  it("does not let stock be adjusted below copies reserved for active pickup checkouts", async () => {
    await seedPhysicalBook();
    await db.collection("bookInventory").doc("main__pickup-book__paperback").set({
      id: "main__pickup-book__paperback",
      locationId: "main",
      bookId: "pickup-book",
      variantId: "paperback",
      sku: "HC-PICKUP-PB",
      bookTitle: "Pickup Book",
      variantName: "Paperback",
      onHand: 2,
      reserved: 2,
      reorderAt: 1,
      updatedAt: Date.now(),
    });
    const adminFunctions = await staffClient("bookstore-admin-2");
    await expect(call(
      adminFunctions,
      "bookstore_adjustInventory",
      {
        bookId: "pickup-book",
        variantId: "paperback",
        quantityDelta: -1,
        reason: "Attempt to remove reserved copy",
      },
    )).rejects.toThrow();

    const inventory = (await db.collection("bookInventory").doc("main__pickup-book__paperback").get()).data();
    expect(inventory?.onHand).toBe(2);
    expect(inventory?.reserved).toBe(2);
  });

  it("finalizes a paid pickup order exactly once and converts reserved stock into a sale", async () => {
    await seedPhysicalBook();
    const now = Date.now();
    await db.collection("bookInventory").doc("main__pickup-book__paperback").set({
      id: "main__pickup-book__paperback",
      locationId: "main",
      bookId: "pickup-book",
      variantId: "paperback",
      sku: "HC-PICKUP-PB",
      bookTitle: "Pickup Book",
      variantName: "Paperback",
      onHand: 3,
      reserved: 1,
      reorderAt: 1,
      updatedAt: now,
    });
    await db.collection("bookstoreOrders").doc("order-paid-1").set({
      id: "order-paid-1",
      orderNumber: "HC-TEST-01",
      userId: "buyer-1",
      customerEmail: "buyer@example.test",
      status: "pending_payment",
      fulfillmentMethod: "pickup",
      fulfillmentStatus: "awaiting_prep",
      items: [{
        bookId: "pickup-book",
        variantId: "paperback",
        sku: "HC-PICKUP-PB",
        title: "Pickup Book",
        variantName: "Paperback",
        unitPriceCents: 2495,
        quantity: 1,
        type: "physical",
        pickupReadyImmediately: true,
      }],
      subtotalCents: 2495,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 2495,
      currency: "usd",
      paymentId: "payment-paid-1",
      guestAccessTokenHash: "not-used",
      reservationExpiresAt: now + 30 * 60_000,
      pickup: {
        locationId: "main",
        locationName: "Hi Coworking",
        address: "15373 Carrollton Blvd, Carrollton, VA",
        pickupCode: "TEST01",
      },
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("payments").doc("payment-paid-1").set({
      id: "payment-paid-1",
      uid: "buyer-1",
      provider: "stripe",
      amount: 2495,
      currency: "usd",
      purpose: "bookstore",
      purposeRefId: "order-paid-1",
      status: "pending",
      createdAt: now,
    });

    await db.collection("payments").doc("payment-paid-1").update({ status: "paid", updatedAt: Date.now() });

    const order = await waitFor(
      async () => (await db.collection("bookstoreOrders").doc("order-paid-1").get()).data(),
      (value) => value?.status === "paid",
    );
    expect(order?.fulfillmentStatus).toBe("ready_for_pickup");

    const inventoryAfter = (await db.collection("bookInventory").doc("main__pickup-book__paperback").get()).data();
    expect(inventoryAfter?.onHand).toBe(2);
    expect(inventoryAfter?.reserved).toBe(0);

    await db.collection("payments").doc("payment-paid-1").update({ updatedAt: Date.now() + 1 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const inventoryReplay = (await db.collection("bookInventory").doc("main__pickup-book__paperback").get()).data();
    expect(inventoryReplay?.onHand).toBe(2);
    expect(inventoryReplay?.reserved).toBe(0);

    const adjustment = await db.collection("bookInventoryAdjustments").doc("order-paid-1__pickup-book__paperback__sale").get();
    expect(adjustment.exists).toBe(true);
  });

  it("creates an active entitlement when a paid digital order is finalized", async () => {
    const now = Date.now();
    await db.collection("bookstoreOrders").doc("digital-order-1").set({
      id: "digital-order-1",
      orderNumber: "HC-DIGI-01",
      userId: "digital-buyer",
      customerEmail: "digital@example.test",
      status: "pending_payment",
      fulfillmentMethod: "digital",
      fulfillmentStatus: "not_required",
      items: [{
        bookId: "digital-book",
        variantId: "digital",
        sku: "digital-book-digital",
        title: "Digital Book",
        variantName: "Digital edition",
        unitPriceCents: 1295,
        quantity: 1,
        type: "digital",
        pickupReadyImmediately: false,
        digitalAssetUrl: "bookstore/digital-book.pdf",
      }],
      subtotalCents: 1295,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 1295,
      currency: "usd",
      paymentId: "digital-payment-1",
      guestAccessTokenHash: "not-used",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("payments").doc("digital-payment-1").set({
      id: "digital-payment-1",
      uid: "digital-buyer",
      provider: "stripe",
      amount: 1295,
      currency: "usd",
      purpose: "bookstore",
      purposeRefId: "digital-order-1",
      status: "pending",
      createdAt: now,
    });
    await db.collection("payments").doc("digital-payment-1").update({ status: "paid", updatedAt: Date.now() });

    await waitFor(
      async () => (await db.collection("bookEntitlements").doc("digital-order-1__digital-book__digital").get()).data(),
      (value) => value?.status === "active",
    );
    const purchase = await db.collection("bookPurchases").doc("order_digital-order-1__digital-book__digital").get();
    expect(purchase.exists).toBe(true);
  });
});
