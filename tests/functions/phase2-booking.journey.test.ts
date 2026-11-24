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
const PASSWORD = "phase2-journey-password";
const TZ = "America/New_York";

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

async function signedIn(uid: string, extras: { role?: "admin" | "staff" | "member"; plan?: string; membershipStatus?: string } = {}) {
  const email = `${uid}@example.test`;
  const role = extras.role ?? "member";
  await getAdminAuth(adminApp).createUser({ uid, email, password: PASSWORD, emailVerified: true });
  await getAdminAuth(adminApp).setCustomUserClaims(uid, { role });
  await db.collection("users").doc(uid).set({
    uid,
    email,
    displayName: uid,
    role,
    membershipStatus: extras.membershipStatus ?? (extras.plan ? "active" : "none"),
    plan: extras.plan ?? null,
    createdAt: Date.now(),
  });
  const result = client(uid);
  const auth = getAuth(result.app);
  connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  await auth.currentUser?.getIdToken(true);
  return result.functions;
}

async function call<Result>(functions: Functions, name: string, data: Record<string, unknown> = {}) {
  return (await httpsCallable<Record<string, unknown>, Result>(functions, name)(data)).data;
}

function dateParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function todayKey() {
  const values = dateParts(Date.now());
  return `${values.year}-${values.month}-${values.day}`;
}

function facilityTime(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const observed = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), 0, 0);
    guess += targetAsUtc - observed;
  }
  return guess;
}

function upcomingWeekdayKey(daysAheadStart = 1) {
  for (let ahead = daysAheadStart; ahead <= 14; ahead += 1) {
    const values = dateParts(Date.now() + ahead * 24 * 60 * 60 * 1000);
    if (values.weekday !== "Sat" && values.weekday !== "Sun") {
      return `${values.year}-${values.month}-${values.day}`;
    }
  }
  throw new Error("Could not find a weekday.");
}

function upcomingWeekendKey() {
  for (let ahead = 1; ahead <= 14; ahead += 1) {
    const values = dateParts(Date.now() + ahead * 24 * 60 * 60 * 1000);
    if (values.weekday === "Sat") return `${values.year}-${values.month}-${values.day}`;
  }
  throw new Error("Could not find a Saturday.");
}

async function seedBooking(id: string, resourceId: string, start: number, end: number, extra: Record<string, unknown> = {}) {
  await db.collection("bookings").doc(id).set({
    id,
    resourceId,
    resourceName: resourceId,
    status: "CONFIRMED",
    bookingKind: "single",
    start,
    end,
    createdAt: Date.now(),
    ...extra,
  });
}

type Availability = {
  options: Array<{ resourceId: string; type: string; available: boolean }>;
};

function option(result: Availability, resourceId: string) {
  return result.options.find((item) => item.resourceId === resourceId);
}

beforeAll(() => {
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "phase2-booking-journey-tests");
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

describe("Phase 2 booking journeys", () => {
  it("keeps D1 and the conference room exclusive with the private office, while D2-D6 stay open", async () => {
    const functions = client("availability").functions;
    const date = upcomingWeekdayKey();
    const start = facilityTime(date, "08:00");
    const end = facilityTime(date, "12:00");
    await seedBooking("office-am", "private-office", start, end);
    const withOffice = await call<Availability>(functions, "booking_getAvailability", { start, end });
    expect(option(withOffice, "private-office")).toMatchObject({ type: "ROOM", available: false });
    expect(option(withOffice, "seat-1")?.available).toBe(false);
    expect(option(withOffice, "mode-conference")?.available).toBe(false);
    expect(option(withOffice, "seat-2")?.available).toBe(true);
    expect(option(withOffice, "seat-3")?.available).toBe(true);
    expect(option(withOffice, "seat-6")?.available).toBe(true);

    await clearFirestore();
    await seedBooking("d1-am", "seat-1", start, end);
    const withDesk = await call<Availability>(functions, "booking_getAvailability", { start, end });
    expect(option(withDesk, "private-office")?.available).toBe(false);
    expect(option(withDesk, "seat-2")?.available).toBe(true);

    await clearFirestore();
    await seedBooking("conf-am", "mode-conference", start, end);
    const withConference = await call<Availability>(functions, "booking_getAvailability", { start, end });
    expect(option(withConference, "private-office")?.available).toBe(false);
    expect(option(withConference, "seat-1")?.available).toBe(false);
    expect(option(withConference, "seat-6")?.available).toBe(false);
  });

  it("accepts evening and weekend conference requests, blocks overlaps, and lets staff approve a slot", async () => {
    const guest = client("after-hours-guest").functions;
    const staff = await signedIn("phase2-staff", { role: "staff" });
    const date = upcomingWeekendKey();
    const created = await call<{ id: string; status: string }>(guest, "booking_requestAfterHoursConference", {
      date,
      start: "08:00",
      end: "12:00",
      name: "Casey Guest",
      email: "casey@example.test",
      phone: "555-0140",
      notes: "Board review",
    });
    expect(created).toMatchObject({ status: "pending" });
    expect(created.id).toBeTruthy();

    await expect(call(guest, "booking_requestAfterHoursConference", {
      date,
      start: "08:00",
      end: "12:00",
      name: "Other Guest",
      email: "other@example.test",
    })).rejects.toThrow(/already/i);

    const afternoon = await call<{ id: string }>(guest, "booking_requestAfterHoursConference", {
      date,
      start: "12:00",
      end: "16:00",
      name: "Afternoon Guest",
      email: "afternoon@example.test",
    });
    await expect(call(guest, "booking_requestAfterHoursConference", {
      date,
      start: "13:00",
      end: "17:00",
      name: "Overlap Guest",
      email: "overlap@example.test",
    })).rejects.toThrow(/already|overlap/i);

    const approved = await call<{ status: string; bookingId: string | null }>(staff, "admin_reviewConferenceSlotRequest", {
      requestId: created.id,
      decision: "approved",
    });
    expect(approved.status).toBe("approved");
    expect(approved.bookingId).toBeTruthy();
    const booking = (await db.collection("bookings").doc(approved.bookingId!).get()).data();
    expect(booking).toMatchObject({
      resourceId: "mode-conference",
      status: "CONFIRMED",
      afterHours: true,
      paymentMethod: "APPOINTMENT",
    });

    const listed = await call<{ requests: Array<{ id: string; status: string }> }>(staff, "admin_listConferenceSlotRequests", {});
    expect(listed.requests.some((item) => item.id === created.id && item.status === "approved")).toBe(true);
    expect(listed.requests.some((item) => item.id === afternoon.id && item.status === "pending")).toBe(true);
  });

  it("applies a $0 same-day member upgrade immediately and extends the booking to 5:00 PM", async () => {
    const date = todayKey();
    const start = facilityTime(date, "08:00");
    const end = facilityTime(date, "12:00");
    if (Date.now() >= end) return;
    const functions = await signedIn("phase2-member", { role: "member", plan: "coworking", membershipStatus: "active" });
    await seedBooking("upgrade-d1", "seat-1", start, end, {
      userId: "phase2-member",
      resourceName: "Desk 1",
      includedHoursApplied: 4,
      paidCents: 0,
      subtotalCents: 0,
      amountCents: 0,
    });
    const preview = await call<{ deltaCents: number; incrementalIncludedHours: number; toEnd: number }>(
      functions,
      "booking_previewUpgrade",
      { bookingId: "upgrade-d1" },
    );
    expect(preview.deltaCents).toBe(0);
    expect(preview.incrementalIncludedHours).toBe(5);
    const begun = await call<{ kind: string; quote: { deltaCents: number } }>(
      functions,
      "booking_beginUpgrade",
      { bookingId: "upgrade-d1" },
    );
    expect(begun).toMatchObject({ kind: "applied", quote: { deltaCents: 0 } });
    const booking = (await db.collection("bookings").doc("upgrade-d1").get()).data();
    expect(booking?.end).toBe(facilityTime(date, "17:00"));
    expect(booking?.start).toBe(start);
    expect(booking?.includedHoursApplied).toBe(9);
  });
});
