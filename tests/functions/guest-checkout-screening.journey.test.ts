/**
 * Guest checkout screening, end to end through booking_finalizeCheckout.
 * Runs against the Auth and Firestore emulators (product CI's transaction
 * step). Seeds a paid hold directly so no Stripe charge or real lock is used.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp as deleteAdminApp,
  getApps as getAdminApps,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore, type Firestore } from "firebase-admin/firestore";

const PROJECT_ID = "demo-hi-coworking";
const AUTH_EMULATOR_URL = "http://127.0.0.1:9100";
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8081";

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9100";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

const LIB = new URL("../../apps/functions/lib/bookingFlexTransaction.js", import.meta.url);

let adminApp: AdminApp;
let db: Firestore;
let localFunctionsApp: AdminApp | undefined;

type FinalizeResult = { success: boolean; bookingId: string; customToken?: string };

function localFinalizer() {
  const require = createRequire(LIB);
  const admin = require("firebase-admin");
  localFunctionsApp ??= admin.apps.find((app: AdminApp) => app.name === "[DEFAULT]")
    ?? admin.initializeApp({ projectId: PROJECT_ID });
  return require("./bookingFlexTransaction.js").booking_finalizeCheckout.run as (request: {
    data: { holdId: string; holdSecret: string };
  }) => Promise<FinalizeResult>;
}

const TERMS = { version: "HC-TERMS-v1", text: "I agree to the Terms of Service and Privacy Policy.", source: "guest-checkout", acceptedAt: 1_700_000_000_000 };

async function createPaidGuestHold(email: string, withScreening = true) {
  const holdId = `screening-hold-${Math.random().toString(36).slice(2, 8)}`;
  const holdSecret = "test-screening-hold-secret";
  const start = Date.now() + 2 * 24 * 60 * 60 * 1000;
  await db.collection("payments").doc(`${holdId}-payment`).set({
    id: `${holdId}-payment`, uid: `guest:${holdId}`, provider: "stripe", amount: 1750, currency: "usd",
    purpose: "booking", purposeRefId: holdId, status: "paid",
  });
  await db.collection("bookingHolds").doc(holdId).set({
    id: holdId, resourceId: "seat-1", resourceName: "Desk 1", bookingKind: "single",
    start, end: start + 60 * 60 * 1000,
    userId: `guest:${holdId}`,
    guest: {
      name: "Sample Guest",
      email,
      phone: "+15550100199",
      ...(withScreening ? { businessName: "Sample Studio", isIndependent: false, intendedUse: "Client calls and quiet work" } : {}),
    },
    ...(withScreening ? { termsAcceptance: TERMS } : {}),
    quote: { totalCents: 1750, subtotalCents: 1750, accountCreditAppliedCents: 0, includedHoursApplied: 0 },
    status: "HELD",
    secretHash: createHash("sha256").update(holdSecret).digest("hex"),
    createdAt: Date.now(), expiresAt: Date.now() + 15 * 60 * 1000,
    paymentId: `${holdId}-payment`,
  });
  return { holdId, holdSecret };
}

async function clear() {
  await fetch(`${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

beforeAll(() => {
  adminApp = getAdminApps().find((app) => app.name === "guest-screening-tests")
    ?? initializeAdminApp({ projectId: PROJECT_ID }, "guest-screening-tests");
  db = getAdminFirestore(adminApp);
});

beforeEach(clear);

afterAll(async () => {
  await deleteAdminApp(adminApp);
  if (localFunctionsApp) {
    await createRequire(LIB)("firebase-admin/app").deleteApp(localFunctionsApp);
  }
});

describe("guest checkout screening at finalize", () => {
  it("records screening and Terms on the booking and on a newly created account", async () => {
    const finalize = localFinalizer();
    const result = await finalize({ data: await createPaidGuestHold("new-screened-guest@example.test") });
    expect(result.success).toBe(true);

    const booking = (await db.collection("bookings").doc(result.bookingId).get()).data();
    expect(booking?.guestScreening).toEqual({ businessName: "Sample Studio", isIndependent: false, intendedUse: "Client calls and quiet work" });
    expect(booking?.termsAcceptance).toEqual(TERMS);

    const uid = String(booking?.userId);
    const user = (await db.collection("users").doc(uid).get()).data();
    expect(user?.termsAcceptance).toEqual(TERMS);
    expect(user?.termsAcceptanceHistory).toEqual([{ version: "HC-TERMS-v1", source: "guest-checkout", at: TERMS.acceptedAt }]);
    expect(user).not.toHaveProperty("idCheck");

    const details = (await db.collection("accountDetails").doc(uid).get()).data();
    expect(details).toMatchObject({ company: "Sample Studio", isIndependent: false, phone: "+15550100199" });
  });

  it("does not write Terms or business details onto an existing account", async () => {
    const existing = await getAdminAuth(adminApp).createUser({ uid: "existing-member", email: "existing-member@example.test" });
    await db.collection("users").doc(existing.uid).set({ uid: existing.uid, email: "existing-member@example.test", role: "member" });
    await db.collection("accountDetails").doc(existing.uid).set({ company: "Original Co", phone: "+15550100111" });

    const finalize = localFinalizer();
    const result = await finalize({ data: await createPaidGuestHold("existing-member@example.test") });
    const booking = (await db.collection("bookings").doc(result.bookingId).get()).data();
    expect(booking?.termsAcceptance).toEqual(TERMS);
    expect((await db.collection("users").doc(existing.uid).get()).data()).not.toHaveProperty("termsAcceptance");
    expect((await db.collection("accountDetails").doc(existing.uid).get()).data()).toEqual({ company: "Original Co", phone: "+15550100111" });
  });

  it("still finalizes a hold created before screening shipped", async () => {
    const finalize = localFinalizer();
    const result = await finalize({ data: await createPaidGuestHold("legacy-hold@example.test", false) });
    expect(result.success).toBe(true);
    const booking = (await db.collection("bookings").doc(result.bookingId).get()).data();
    expect(booking).not.toHaveProperty("guestScreening");
    expect(booking).not.toHaveProperty("termsAcceptance");
  });
});
