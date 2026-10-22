import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Actual HTTP -> signed Stripe parser -> ledger -> Auth/Firestore finalization.
 * No production handler or policy is copied/mocked/imported into this process.
 *
 * Before starting demo emulators, create an ephemeral apps/functions/.secret.local:
 * STRIPE_SECRET_KEY=sk_test_onboarding_emulator_only
 * STRIPE_WEBHOOK_SECRET=whsec_onboarding_emulator_only
 * INTUIT_CLIENT_ID=
 * INTUIT_CLIENT_SECRET=
 * SEAM_API_KEY=
 *
 * No subscriptions, connected accounting config, door devices, or mail credentials
 * are seeded. The booking route therefore makes no Stripe/Seam/mail API calls.
 * Never run this suite against a non-demo project or non-loopback emulator host.
 */
const PROJECT = "demo-hi-coworking";
const FIRESTORE_HOST = "127.0.0.1:8081";
const AUTH_HOST = "127.0.0.1:9100";
const ENDPOINT = `http://127.0.0.1:5004/${PROJECT}/us-central1/stripe_webhook`;
const WEBHOOK_SECRET = "whsec_onboarding_emulator_only";
const HOLD_ID = "stripe-http-hold";
const PAYMENT_ID = "stripe-http-payment";
const SESSION_ID = "cs_test_onboarding_emulator_only";
const EMAIL = "stripe-http-purchaser@example.test";

// Refuse rather than silently redirect a caller configured for a real project.
for (const name of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
  if (process.env[name] && process.env[name] !== PROJECT) throw new Error(`${name} must be ${PROJECT} for this destructive emulator test`);
}
for (const [name, expected] of [["FIRESTORE_EMULATOR_HOST", FIRESTORE_HOST], ["FIREBASE_AUTH_EMULATOR_HOST", AUTH_HOST]] as const) {
  if (process.env[name] && process.env[name] !== expected) throw new Error(`${name} must be ${expected}`);
  process.env[name] = expected;
}
process.env.GCLOUD_PROJECT = PROJECT;

let app: App;
let db: Firestore;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT }, "onboarding-stripe-http");
  db = getFirestore(app);
});
beforeEach(async () => {
  for (const url of [
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`,
  ]) {
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) throw new Error(`Demo emulator reset failed: ${response.status}`);
  }
});
afterAll(async () => { if (app) await deleteApp(app); });

async function seedPendingBooking() {
  const now = Date.now();
  // Full-price single seat: no membership/credit reservations and no door device.
  const hold = {
    id: HOLD_ID, resourceId: "seat-1", resourceName: "Desk 1", bookingKind: "single",
    start: now + 86400000, end: now + 90000000,
    userId: `guest:${HOLD_ID}`, guest: { name: "HTTP Purchaser", email: EMAIL },
    quote: { resourceId: "seat-1", resourceName: "Desk 1", resourceType: "SEAT", bookingKind: "single",
      totalCents: 1750, subtotalCents: 1750, currency: "usd", durationHours: 1,
      hourlyRateCents: 1750, billableHours: 1, accountCreditAppliedCents: 0, includedHoursApplied: 0 },
    status: "HELD", secretHash: createHash("sha256").update("http-test-hold-secret-never-returned-to-browser").digest("hex"),
    createdAt: now, expiresAt: now + 900000, paymentId: PAYMENT_ID,
  };
  await db.collection("bookingHolds").doc(HOLD_ID).set(hold);
  await db.collection("payments").doc(PAYMENT_ID).set({
    id: PAYMENT_ID, uid: hold.userId, provider: "stripe", purpose: "booking", purposeRefId: HOLD_ID,
    status: "pending", amount: 1750, currency: "usd",
    providerRefs: { holdId: HOLD_ID, stripeCheckoutSessionId: SESSION_ID }, createdAt: now,
  });
}

function signedEvent(eventId: string, type = "checkout.session.completed", paymentStatus = "paid") {
  const payload = JSON.stringify({ id: eventId, object: "event", type, livemode: false,
    created: Math.floor(Date.now() / 1000), data: { object: {
      id: SESSION_ID, object: "checkout.session", mode: "payment", status: "complete",
      payment_status: paymentStatus, amount_total: 1750, currency: "usd",
      payment_intent: "pi_test_onboarding_emulator_only", subscription: null,
      metadata: { uid: `guest:${HOLD_ID}`, paymentId: PAYMENT_ID, purpose: "booking", purposeRefId: HOLD_ID, holdId: HOLD_ID },
    } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  return { payload, signature: `t=${timestamp},v1=${digest}` };
}
async function deliver(event: ReturnType<typeof signedEvent>) {
  const response = await fetch(ENDPOINT, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": event.signature }, body: event.payload,
  });
  return { status: response.status, body: await response.json() };
}
async function assertExactlyOneFulfillment() {
  const bookings = await db.collection("bookings").get();
  expect(bookings.size).toBe(1);
  const booking = bookings.docs[0].data();
  expect(booking).toMatchObject({ status: "CONFIRMED", paymentId: PAYMENT_ID, totalCents: 1750 });
  const purchaser = await getAuth(app).getUserByEmail(EMAIL);
  expect(booking.userId).toBe(purchaser.uid);
  expect((await getAuth(app).listUsers()).users).toHaveLength(1);
  expect((await db.collection("bookingHolds").doc(HOLD_ID).get()).data()).toMatchObject({ status: "CONSUMED", bookingId: bookings.docs[0].id });
  expect((await db.collection("payments").doc(PAYMENT_ID).get()).data()).toMatchObject({ status: "paid", fulfillmentStatus: "confirmed" });
  // No physical device is configured: recovery/staff state is honest, not a fake PIN.
  const grants = await db.collection("accessGrants").get();
  expect(grants.size).toBe(1);
  expect(grants.docs[0].data().providerAttempted).not.toBe(true);
  expect((await db.collection("bookingPaymentRecovery").get()).empty).toBe(true);
  return bookings.docs[0].id;
}

describe("signed Stripe HTTP booking recovery without browser return", () => {
  it("fulfills one booking through concurrent distinct success events and exact-event retries", async () => {
    await seedPendingBooking();
    const completed = signedEvent("evt_http_completed");
    const asyncPaid = signedEvent("evt_http_async", "checkout.session.async_payment_succeeded");
    const first = await Promise.all([deliver(completed), deliver(asyncPaid)]);
    // A competing delivery may legitimately ask Stripe to retry while another
    // worker holds a lease; both events must subsequently reach terminal success.
    for (const response of first) expect([200, 500]).toContain(response.status);
    expect((await deliver(completed)).status).toBe(200);
    expect((await deliver(asyncPaid)).status).toBe(200);
    const bookingId = await assertExactlyOneFulfillment();
    expect((await deliver(completed)).body).toMatchObject({ received: true, skipped: true });
    expect((await deliver(signedEvent("evt_http_other_success"))).status).toBe(200);
    expect(await assertExactlyOneFulfillment()).toBe(bookingId);
  });

  it("does not fulfill unpaid completion, then fulfills its actual asynchronous success", async () => {
    await seedPendingBooking();
    expect((await deliver(signedEvent("evt_http_unpaid", "checkout.session.completed", "unpaid"))).status).toBe(200);
    expect((await db.collection("bookings").get()).empty).toBe(true);
    expect((await db.collection("accessGrants").get()).empty).toBe(true);
    expect((await getAuth(app).listUsers()).users).toHaveLength(0);
    expect((await db.collection("payments").doc(PAYMENT_ID).get()).data()?.status).toBe("pending");
    expect((await deliver(signedEvent("evt_http_later_paid", "checkout.session.async_payment_succeeded"))).status).toBe(200);
    await assertExactlyOneFulfillment();
  });

  it("rejects invalid signatures without claiming or paying the ledger", async () => {
    await seedPendingBooking();
    const event = signedEvent("evt_http_invalid_signature");
    expect((await deliver({ ...event, signature: event.signature.replace(/v1=.*/, "v1=invalid") })).status).toBe(400);
    expect((await db.collection("webhookEvents").get()).empty).toBe(true);
    expect((await db.collection("bookings").get()).empty).toBe(true);
    expect((await db.collection("payments").doc(PAYMENT_ID).get()).data()?.status).toBe("pending");
  });

  it("retries the same signed failed event after ledger mismatch is repaired", async () => {
    await seedPendingBooking();
    await db.collection("payments").doc(PAYMENT_ID).update({ amount: 2000 });
    const event = signedEvent("evt_http_repair_retry");
    expect((await deliver(event)).status).toBe(500);
    expect((await db.collection("bookings").get()).empty).toBe(true);
    expect((await db.collection("payments").doc(PAYMENT_ID).get()).data()?.status).toBe("pending");
    expect((await db.collection("webhookEvents").doc("evt_http_repair_retry").get()).data()?.result).toMatch(/^error:/);
    await db.collection("payments").doc(PAYMENT_ID).update({ amount: 1750 });
    expect((await deliver(event)).status).toBe(200);
    await assertExactlyOneFulfillment();
    expect((await db.collection("webhookEvents").doc("evt_http_repair_retry").get()).data()?.result).toBe("success");
  });
});
