import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

// Real Auth/Firestore emulators, real compiled production finalizer; no Stripe,
// customer email, or physical lock is contacted. No doors are seeded.
process.env.GCLOUD_PROJECT = "demo-hi-coworking";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9100";
const require = createRequire(new URL("../../apps/functions/lib/bookingFlexTransaction.js", import.meta.url));
const admin = require("firebase-admin");
let app: any;
let db: any;
let finalize: any;
let callable: any;
let adminQueue: any;
let beginCheckout: any;
const secret = "high-entropy-test-hold-secret";
async function seed(options: { expired?: boolean; uid?: string; credit?: number; start?: number } = {}) {
  const now = Date.now();
  const hold = { id: "hold", resourceId: "seat-1", resourceName: "Desk 1", bookingKind: "single",
    start: options.start || now + 86400000, end: now + 90000000,
    userId: options.uid || "guest:hold", guest: options.uid ? null : { name: "Purchaser", email: "purchaser@example.test" },
    quote: { totalCents: 1750, subtotalCents: 1750, currency: "usd", accountCreditAppliedCents: options.credit || 0, includedHoursApplied: 0 },
    status: "HELD", secretHash: createHash("sha256").update(secret).digest("hex"),
    createdAt: now, expiresAt: options.expired ? now - 1000 : now + 900000, paymentId: "payment" };
  await db.collection("bookingHolds").doc("hold").set(hold);
  await db.collection("payments").doc("payment").set({ id: "payment", uid: hold.userId,
    provider: "stripe", purpose: "booking", purposeRefId: "hold", status: "paid", amount: 1750, currency: "usd" });
  return hold;
}
async function catalogBookingInput() {
  await admin.auth().createUser({ uid: "catalog-member", email: "catalog@example.test" });
  await db.collection("users").doc("catalog-member").set({ role: "member", membershipStatus: "none", accountCreditCents: 50000 });
  const layoutPath = "locations/main/floors/main/layouts/published";
  await db.doc(layoutPath).set({ status: "PUBLISHED", elements: [{ resourceId: "mode-conference" }] });
  await db.collection("spaceSetups").doc("meeting").set({ published: true, name: "Boardroom", layoutPath,
    resourceId: "mode-conference", serviceType: "CONFERENCE", capacity: 6, addOnIds: ["screen"] });
  await db.collection("spaceAddOns").doc("screen").set({ published: true, name: "Screen", serviceTypes: ["CONFERENCE"], priceCents: 1500 });
  const tomorrow = new Date(Date.now() + 86400000);
  // 15:00 UTC remains inside the facility's 08:00–20:00 window in either DST season.
  const start = Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 15);
  return { auth: { uid: "catalog-member", token: { name: "Catalog Member" } }, data: {
    resourceId: "mode-conference", setupId: "meeting", addOnIds: ["screen"], attendeeCount: 4,
    start, end: start + 3600000, expectedTotalCents: 0,
    successUrl: "https://example.test/book/complete", cancelUrl: "https://example.test/spaces",
  } };
}
beforeAll(() => {
  app = admin.apps.find((a: any) => a.name === "[DEFAULT]") || admin.initializeApp({ projectId: "demo-hi-coworking" });
  db = admin.firestore(app);
  const production = require("./bookingFlexTransaction.js");
  finalize = production.finalizePaidBooking;
  callable = production.booking_finalizeCheckout.run;
  adminQueue = production.booking_adminListPaymentRecovery.run;
  beginCheckout = production.booking_beginCheckout.run;
});
beforeEach(async () => {
  for (const url of [
    "http://127.0.0.1:8081/emulator/v1/projects/demo-hi-coworking/databases/(default)/documents",
    "http://127.0.0.1:9100/emulator/v1/projects/demo-hi-coworking/accounts",
  ]) {
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) throw new Error(`Emulator reset failed: ${response.status}`);
  }
});
afterAll(async () => { await app?.delete(); });
describe("authoritative paid booking recovery", () => {
  it.each(["member", "staff", "admin"])("preserves existing %s account and profile", async (role) => {
    await admin.auth().createUser({ uid: "existing", email: "purchaser@example.test", displayName: "Original" });
    await admin.auth().setCustomUserClaims("existing", { role });
    const profile = { role, plan: "coworking", membershipStatus: "active", expiresAt: Date.now() + 10000000,
      displayName: "Original", accountCreditCents: 10000, untouched: { x: 1 } };
    await db.collection("users").doc("existing").set(profile);
    await seed();
    const result = await callable({ data: { holdId: "hold", holdSecret: secret } });
    expect(result.success).toBe(true);
    expect(result.customToken).toBeUndefined();
    expect((await db.collection("users").doc("existing").get()).data()).toEqual(profile);
    expect((await admin.auth().getUser("existing")).customClaims).toEqual({ role });
    expect((await db.collection("bookings").doc(result.bookingId).get()).data().userId).toBe("existing");
  });
  it("uses purchaser identity despite an unrelated signed-in session", async () => {
    await admin.auth().createUser({ uid: "other", email: "other@example.test" });
    await seed();
    const result = await callable({ data: { holdId: "hold", holdSecret: secret }, auth: { uid: "other", token: { name: "Wrong Person" } } });
    expect(result.customToken).toBeTypeOf("string");
    const booking = (await db.collection("bookings").doc(result.bookingId).get()).data();
    expect(booking.userId).not.toBe("other");
    expect(booking.userName).toBe("Purchaser");
  });
  it("finalizes exactly once without browser return, including concurrent events", async () => {
    await seed();
    const results = await Promise.all([finalize("hold", "payment"), finalize("hold", "payment"), finalize("hold", "payment")]);
    expect(new Set(results.map((r: any) => r.bookingId)).size).toBe(1);
    expect((await db.collection("bookings").get()).size).toBe(1);
    expect((await db.collection("accessGrants").get()).size).toBe(1);
    expect((await db.collection("payments").doc("payment").get()).data().fulfillmentStatus).toBe("confirmed");
  });
  it("makes guest sign-in a one-time short-lived claim", async () => {
    await seed();
    const first = await callable({ data: { holdId: "hold", holdSecret: secret } });
    expect(first.customToken).toBeTypeOf("string");
    const second = await callable({ data: { holdId: "hold", holdSecret: secret } });
    expect(second.customToken).toBeUndefined();
    expect(second.bookingId).toBe(first.bookingId);
  });
  it("requires verified recovery after the guest sign-in claim window", async () => {
    await seed();
    await db.collection("bookingHolds").doc("hold").update({ createdAt: Date.now() - 31 * 60_000 });
    const result = await callable({ data: { holdId: "hold", holdSecret: secret } });
    expect(result.success).toBe(true);
    expect(result.customToken).toBeUndefined();
  });
  it("recovers interrupted new Auth provisioning without overwriting any profile", async () => {
    await seed();
    const uid = `booking_guest_${createHash("sha256").update("hold").digest("hex")}`;
    await admin.auth().createUser({ uid, email: "purchaser@example.test" });
    const result = await callable({ data: { holdId: "hold", holdSecret: secret } });
    expect(result.customToken).toBeTypeOf("string");
    expect((await db.collection("users").doc(uid).get()).data().guestCheckoutHoldId).toBe("hold");
  });
  it("preserves a concurrently initialized profile and does not issue its token", async () => {
    await seed();
    const uid = `booking_guest_${createHash("sha256").update("hold").digest("hex")}`;
    await admin.auth().createUser({ uid, email: "purchaser@example.test" });
    await db.collection("users").doc(uid).set({ role: "admin", displayName: "Concurrent" });
    const result = await callable({ data: { holdId: "hold", holdSecret: secret } });
    expect(result.customToken).toBeUndefined();
    expect((await db.collection("users").doc(uid).get()).data()).toEqual({ role: "admin", displayName: "Concurrent" });
  });
  it("retries access and ledger completion after a crash following booking commit", async () => {
    await seed();
    const result = await finalize("hold", "payment");
    await db.collection("accessGrants").doc(`booking_${result.bookingId}`).delete();
    await db.collection("payments").doc("payment").update({ fulfillmentStatus: admin.firestore.FieldValue.delete() });
    const retried = await finalize("hold", "payment");
    expect(retried.bookingId).toBe(result.bookingId);
    expect((await db.collection("accessGrants").get()).size).toBe(1);
    expect((await db.collection("payments").doc("payment").get()).data().fulfillmentStatus).toBe("confirmed");
  });
  it("does not recreate access for a cancelled booking on late replay", async () => {
    await seed();
    const result = await finalize("hold", "payment");
    await db.collection("bookings").doc(result.bookingId).update({ status: "CANCELLED" });
    await db.collection("accessGrants").doc(`booking_${result.bookingId}`).delete();
    await db.collection("payments").doc("payment").update({ fulfillmentStatus: "cancelled" });
    await finalize("hold", "payment");
    expect((await db.collection("accessGrants").get()).empty).toBe(true);
    expect((await db.collection("payments").doc("payment").get()).data().fulfillmentStatus).toBe("cancelled");
  });
  it("recovers an expired cash hold when capacity remains free", async () => {
    await seed({ expired: true });
    expect((await finalize("hold", "payment")).success).toBe(true);
  });
  it("queues alternate reservation/refund when expired capacity was sold", async () => {
    const hold = await seed({ expired: true });
    await db.collection("bookings").doc("other-booking").set({ resourceId: "seat-1", start: hold.start, end: hold.end, status: "CONFIRMED" });
    const result = await finalize("hold", "payment");
    expect(result).toMatchObject({ success: false, status: "recovery_required" });
    expect((await db.collection("bookingPaymentRecovery").doc(result.recoveryId).get()).data())
      .toMatchObject({ status: "OPEN", requiredAction: "ALTERNATE_RESERVATION_OR_REFUND", amountCents: 1750 });
    await finalize("hold", "payment");
    expect((await db.collection("bookingPaymentRecovery").get()).size).toBe(1);
    expect((await db.collection("bookings").get()).size).toBe(1);
  });
  it("shows a verified alternate booking after staff resolves the recovery case", async () => {
    await seed({ expired: true, credit: 1000 });
    const recovery = await finalize("hold", "payment");
    await db.collection("bookings").doc("replacement").set({ status: "CONFIRMED", paymentId: "payment" });
    await db.collection("bookingPaymentRecovery").doc(recovery.recoveryId).update({ status: "RESOLVED", replacementBookingId: "replacement" });
    expect(await finalize("hold", "payment")).toMatchObject({ success: true, bookingId: "replacement" });
    expect((await db.collection("bookingPaymentRecovery").doc(recovery.recoveryId).get()).data().status).toBe("RESOLVED");
  });
  it("does not reuse expired account credit reservations", async () => {
    await seed({ expired: true, credit: 1000 });
    const result = await finalize("hold", "payment");
    expect(result.success).toBe(false);
    expect((await db.collection("bookings").get()).empty).toBe(true);
  });
  it("books a published setup with server-priced add-ons and immutable snapshots", async () => {
    const request = await catalogBookingInput();
    const result = await beginCheckout(request);
    expect(result.kind).toBe("confirmed");
    const booking = (await db.collection("bookings").doc(result.bookingId).get()).data();
    expect(booking).toMatchObject({ attendeeCount: 4, setup: { id: "meeting", name: "Boardroom" },
      addOns: [{ id: "screen", name: "Screen", priceCents: 1500 }], addOnTotalCents: 1500, totalCents: 0 });
    expect(booking.accountCreditAppliedCents).toBe(booking.subtotalCents);
    expect(booking.subtotalCents).toBeGreaterThan(1500);
    await db.collection("spaceAddOns").doc("screen").update({ priceCents: 3000 });
    expect((await db.collection("bookings").doc(result.bookingId).get()).data().addOnTotalCents).toBe(1500);
  });
  it("does not create a hold when the server total differs from the reviewed total", async () => {
    const request = await catalogBookingInput();
    request.data.expectedTotalCents = 1;
    await expect(beginCheckout(request)).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await db.collection("bookingHolds").get()).empty).toBe(true);
  });
  it("rejects unpublished add-ons before holding capacity or spending credit", async () => {
    const request = await catalogBookingInput();
    await db.collection("spaceAddOns").doc("screen").update({ published: false });
    await expect(beginCheckout(request)).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await db.collection("bookingHolds").get()).empty).toBe(true);
    expect((await db.collection("users").doc("catalog-member").get()).data().accountCreditCents).toBe(50000);
  });
  it("lists recovery only to payment administrators", async () => {
    await seed({ expired: true, credit: 1000 });
    await finalize("hold", "payment");
    await expect(adminQueue({ data: {} })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(adminQueue({ data: {}, auth: { uid: "member", token: { role: "member" } } }))
      .rejects.toMatchObject({ code: "permission-denied" });
    const result = await adminQueue({ data: {}, auth: { uid: "admin", token: { role: "admin" } } });
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({ paymentId: "payment", requiredAction: "ALTERNATE_RESERVATION_OR_REFUND" });
  });
  it("rechecks payment status atomically before confirming a booking", async () => {
    await seed();
    const auth = admin.auth();
    const getUser = auth.getUser.bind(auth);
    vi.spyOn(auth, "getUser").mockImplementationOnce(async (uid: string) => {
      await db.collection("payments").doc("payment").update({ status: "refunded" });
      return getUser(uid);
    });
    await expect(finalize("hold", "payment")).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await db.collection("bookings").get()).empty).toBe(true);
  });
  it("rejects unpaid or unrelated ledger entries before account creation", async () => {
    await seed();
    await db.collection("payments").doc("payment").update({ status: "pending" });
    await expect(finalize("hold", "payment")).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await admin.auth().listUsers()).users).toHaveLength(0);
  });
  it("rejects invalid hold secret before any identity changes", async () => {
    await seed();
    await expect(callable({ data: { holdId: "hold", holdSecret: "bad" } })).rejects.toMatchObject({ code: "permission-denied" });
    expect((await admin.auth().listUsers()).users).toHaveLength(0);
  });
  it("never adopts a return-session display name for an authenticated hold", async () => {
    await admin.auth().createUser({ uid: "owner", email: "owner@example.test", displayName: "Real Owner" });
    await seed({ uid: "owner" });
    const result = await callable({ data: { holdId: "hold", holdSecret: secret }, auth: { uid: "wrong", token: { name: "Wrong" } } });
    expect((await db.collection("bookings").doc(result.bookingId).get()).data()).toMatchObject({ userId: "owner", userName: "Real Owner" });
    expect(result.customToken).toBeUndefined();
  });
});
