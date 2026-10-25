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
const PASSWORD = "admin-booking-test-password";

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

function nextOpenWeekdayEpoch(hour: number, minute = 0) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
  for (let daysAhead = 1; daysAhead <= 7; daysAhead += 1) {
    const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const day = weekday.format(target);
    if (day !== "Sat" && day !== "Sun") return easternEpoch(daysAhead, hour, minute);
  }
  throw new Error("Could not find an open weekday for the booking test.");
}

beforeAll(async () => {
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "admin-booking-management-tests");
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

type CancelResult = {
  success: boolean;
  alreadyCancelled?: boolean;
  refundCents: number;
  accountCreditCents: number;
  restoredIncludedHours: number;
  decision?: { outcome: string };
};

async function seedMember(uid: string, accountCreditCents = 0) {
  await db.collection("users").doc(uid).set({
    uid, email: `${uid}@example.test`, displayName: "Booking Member",
    role: "member", membershipStatus: "none", accountCreditCents, createdAt: Date.now(),
  });
}

async function seedBooking(id: string, userId: string, start: number, end: number, extra: Record<string, unknown> = {}) {
  await db.collection("bookings").doc(id).set({
    id, resourceId: "seat-1", resourceName: "Desk 1", userId, userName: "Booking Member",
    start, end, status: "CONFIRMED", totalPrice: 20, totalCents: 2000,
    includedHoursApplied: 0, paymentMethod: "ACCOUNT_CREDIT", createdAt: Date.now(),
    ...extra,
  });
}

describe("Admin booking cancel and move", () => {
  it("cancels a member booking for full account credit once, with an audit record", async () => {
    const adminFunctions = await signedInClient("booking-admin", "admin");
    await seedMember("member-cancel", 100);
    const start = nextOpenWeekdayEpoch(10, 0);
    await seedBooking("admin-cancel-booking", "member-cancel", start, start + 2 * 60 * 60 * 1000, {
      accountCreditAppliedCents: 500,
    });

    const preview = await call<{ options: Array<{ choice: string; accountCreditCents: number; refundCents: number }> }>(
      adminFunctions, "admin_bookingCancelPreview", { bookingId: "admin-cancel-booking" },
    );
    expect(preview.options.map((option) => option.choice)).toEqual(["policy", "refund", "credit"]);
    expect(preview.options.find((option) => option.choice === "credit")?.accountCreditCents).toBe(2500);
    expect(preview.options.find((option) => option.choice === "refund")).toMatchObject({ refundCents: 2000, accountCreditCents: 500 });

    const first = await call<CancelResult>(adminFunctions, "admin_bookingCancel", {
      bookingId: "admin-cancel-booking", choice: "credit", note: "Desk out of service",
    });
    expect(first.success).toBe(true);
    expect(first.decision?.outcome).toBe("ACCOUNT_CREDIT_100");
    expect(first.accountCreditCents).toBe(2500);
    expect(first.refundCents).toBe(0);

    const repeated = await call<CancelResult>(adminFunctions, "admin_bookingCancel", {
      bookingId: "admin-cancel-booking", choice: "credit",
    });
    expect(repeated.alreadyCancelled).toBe(true);

    const booking = (await db.collection("bookings").doc("admin-cancel-booking").get()).data();
    expect(booking?.status).toBe("CANCELLED");
    expect(booking?.cancelledByRole).toBe("admin");
    expect(booking?.cancelledBy).toBe("booking-admin");
    expect((await db.collection("users").doc("member-cancel").get()).data()?.accountCreditCents).toBe(2600);

    const audit = await db.collection("memberOperationAudit")
      .where("action", "==", "booking_cancelled_by_admin").get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data()).toMatchObject({
      memberUid: "member-cancel", adminUid: "booking-admin",
      details: { bookingId: "admin-cancel-booking", choice: "credit", note: "Desk out of service" },
    });
  });

  it("does not let a member cancel or move another member's booking through the admin callables", async () => {
    const memberFunctions = await signedInClient("plain-member", "member");
    await seedMember("member-other");
    const start = nextOpenWeekdayEpoch(10, 0);
    await seedBooking("other-booking", "member-other", start, start + 60 * 60 * 1000);

    await expect(call(memberFunctions, "admin_bookingCancel", { bookingId: "other-booking", choice: "refund" }))
      .rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(memberFunctions, "admin_bookingReschedule", {
      bookingId: "other-booking", start: start + 60 * 60 * 1000, end: start + 2 * 60 * 60 * 1000,
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect((await db.collection("bookings").doc("other-booking").get()).data()?.status).toBe("CONFIRMED");
  });

  it("rejects an unknown cancellation choice", async () => {
    const adminFunctions = await signedInClient("choice-admin", "admin");
    await seedMember("member-choice");
    const start = nextOpenWeekdayEpoch(10, 0);
    await seedBooking("choice-booking", "member-choice", start, start + 60 * 60 * 1000);
    await expect(call(adminFunctions, "admin_bookingCancel", { bookingId: "choice-booking", choice: "half" }))
      .rejects.toMatchObject({ code: "functions/invalid-argument" });
  });

  it("moves a member booking to a new open time and records who moved it", async () => {
    const adminFunctions = await signedInClient("move-admin", "admin");
    await seedMember("member-move");
    const start = nextOpenWeekdayEpoch(9, 0);
    const end = start + 60 * 60 * 1000;
    await seedBooking("move-booking", "member-move", start, end);
    const newStart = nextOpenWeekdayEpoch(14, 0);
    const newEnd = newStart + 60 * 60 * 1000;

    const result = await call<{ success: boolean }>(adminFunctions, "admin_bookingReschedule", {
      bookingId: "move-booking", start: newStart, end: newEnd, note: "Member called",
    });
    expect(result.success).toBe(true);

    const booking = (await db.collection("bookings").doc("move-booking").get()).data();
    expect(booking?.start).toBe(newStart);
    expect(booking?.end).toBe(newEnd);
    expect(booking?.rescheduledByRole).toBe("admin");
    const audit = await db.collection("memberOperationAudit")
      .where("action", "==", "booking_moved_by_admin").get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().details).toMatchObject({ previousStart: start, start: newStart });
  });

  it("will not move a booking onto a weekend", async () => {
    const adminFunctions = await signedInClient("weekend-admin", "admin");
    await seedMember("member-weekend");
    const start = nextOpenWeekdayEpoch(10, 0);
    await seedBooking("weekend-booking", "member-weekend", start, start + 60 * 60 * 1000);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
    let saturday = 0;
    for (let daysAhead = 1; daysAhead <= 8; daysAhead += 1) {
      if (weekday.format(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)) === "Sat") {
        saturday = easternEpoch(daysAhead, 10, 0);
        break;
      }
    }
    await expect(call(adminFunctions, "admin_bookingReschedule", {
      bookingId: "weekend-booking", start: saturday, end: saturday + 60 * 60 * 1000,
    })).rejects.toBeTruthy();
    expect((await db.collection("bookings").doc("weekend-booking").get()).data()?.start).toBe(start);
  });
});
