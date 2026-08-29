import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore, type Firestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";

const PROJECT_ID = "demo-hi-coworking";
const REGION = "us-central1";
const AUTH_URL = "http://127.0.0.1:9100";
const FUNCTIONS_HOST = "127.0.0.1";
const FUNCTIONS_PORT = 5004;
const FIRESTORE_URL = "http://127.0.0.1:8081";
const PASSWORD = "admin-member-test-password";

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
  const app = initializeApp({ apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID }, `${name}-${++sequence}`);
  clients.push(app);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, FUNCTIONS_HOST, FUNCTIONS_PORT);
  return { app, functions };
}

async function signedInClient(uid: string, role: "admin" | "member") {
  const email = `${uid}@example.test`;
  await getAdminAuth(adminApp).createUser({ uid, email, password: PASSWORD, emailVerified: true });
  await getAdminAuth(adminApp).setCustomUserClaims(uid, { role });
  await db.collection("users").doc(uid).set({
    uid, email, displayName: uid, role, membershipStatus: "none", createdAt: Date.now(),
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

function easternEpoch(daysAhead: number, hour: number, minute = 0) {
  const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(target);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const v = Object.fromEntries(local.map((part) => [part.type, part.value]));
    const observed = Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour), Number(v.minute));
    guess += targetAsUtc - observed;
  }
  return guess;
}

beforeAll(async () => {
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "admin-member-operations-tests");
  db = getAdminFirestore(adminApp);
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
});

afterAll(async () => {
  await Promise.all(clients.map((app) => deleteApp(app)));
  await deleteAdminApp(adminApp);
});

describe("Admin member authoritative operations", () => {
  it("adjusts credit idempotently with a permanent audit record", async () => {
    const adminFunctions = await signedInClient("credit-admin", "admin");
    await db.collection("users").doc("member-1").set({
      uid: "member-1", email: "member-1@example.test", displayName: "Member One",
      role: "member", membershipStatus: "active", plan: "coworking",
      accountCreditCents: 5000,
      accountCreditReservations: { active_hold: { amountCents: 2000, expiresAt: Date.now() + 60_000 } },
      createdAt: Date.now(),
    });

    const first = await call<{ adjustment: { beforeCents: number; afterCents: number } }>(adminFunctions, "admin_accountCreditAdjust", {
      uid: "member-1", deltaCents: 2500, reason: "service_adjustment", note: "Service recovery", requestId: "credit_test_0001",
    });
    expect(first.adjustment.beforeCents).toBe(5000);
    expect(first.adjustment.afterCents).toBe(7500);

    const repeated = await call<{ adjustment: { beforeCents: number; afterCents: number } }>(adminFunctions, "admin_accountCreditAdjust", {
      uid: "member-1", deltaCents: 2500, reason: "service_adjustment", note: "Service recovery", requestId: "credit_test_0001",
    });
    expect(repeated.adjustment.afterCents).toBe(7500);

    const user = (await db.collection("users").doc("member-1").get()).data();
    expect(user?.accountCreditCents).toBe(7500);
    expect((await db.collection("accountCreditAdjustments").doc("credit_test_0001").get()).exists).toBe(true);
  });

  it("rejects reuse of an idempotency request ID for a different adjustment", async () => {
    const adminFunctions = await signedInClient("replay-admin", "admin");
    await db.collection("users").doc("member-replay").set({
      uid: "member-replay", email: "member-replay@example.test", role: "member",
      membershipStatus: "active", accountCreditCents: 1000, createdAt: Date.now(),
    });

    await call(adminFunctions, "admin_accountCreditAdjust", {
      uid: "member-replay", deltaCents: 500, reason: "service_adjustment",
      note: "First adjustment", requestId: "credit_replay_0001",
    });

    await expect(call(adminFunctions, "admin_accountCreditAdjust", {
      uid: "member-replay", deltaCents: 900, reason: "service_adjustment",
      note: "Different adjustment", requestId: "credit_replay_0001",
    })).rejects.toBeTruthy();

    expect((await db.collection("users").doc("member-replay").get()).data()?.accountCreditCents).toBe(1500);
  });

  it("rejects a deduction that would consume credit reserved for checkout", async () => {
    const adminFunctions = await signedInClient("deduct-admin", "admin");
    await db.collection("users").doc("member-2").set({
      uid: "member-2", email: "member-2@example.test", role: "member", membershipStatus: "active",
      accountCreditCents: 5000,
      accountCreditReservations: { active_hold: { amountCents: 2000, expiresAt: Date.now() + 60_000 } },
      createdAt: Date.now(),
    });

    await expect(call(adminFunctions, "admin_accountCreditAdjust", {
      uid: "member-2", deltaCents: -4000, reason: "billing_correction", requestId: "credit_test_0002",
    })).rejects.toBeTruthy();
    expect((await db.collection("users").doc("member-2").get()).data()?.accountCreditCents).toBe(5000);
  });

  it("does not allow an ordinary member to adjust another account's credit", async () => {
    const memberFunctions = await signedInClient("ordinary-member", "member");
    await db.collection("users").doc("member-3").set({
      uid: "member-3", email: "member-3@example.test", role: "member", membershipStatus: "none",
      accountCreditCents: 0, createdAt: Date.now(),
    });
    await expect(call(memberFunctions, "admin_accountCreditAdjust", {
      uid: "member-3", deltaCents: 1000, reason: "service_adjustment", requestId: "credit_test_0003",
    })).rejects.toBeTruthy();
  });

  it("quotes a booking using the target member's included hours, not the Admin's entitlements", async () => {
    const adminFunctions = await signedInClient("quote-admin", "admin");
    await db.collection("users").doc("member-4").set({
      uid: "member-4", email: "member-4@example.test", displayName: "Member Four",
      role: "member", membershipStatus: "active", plan: "coworking", accountCreditCents: 0,
      createdAt: Date.now(),
    });
    const start = easternEpoch(2, 10, 0);
    const end = start + 2 * 60 * 60 * 1000;
    const quote = await call<{
      membershipName: string | null;
      includedHoursApplied: number;
      totalCents: number;
    }>(adminFunctions, "admin_bookingForMemberQuote", {
      uid: "member-4", resourceId: "seat-1", start, end,
    });
    expect(quote.membershipName).toBe("Coworking Member");
    expect(quote.includedHoursApplied).toBe(2);
    expect(quote.totalCents).toBe(0);
  });
});
