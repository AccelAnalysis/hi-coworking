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

// Emulator-only. Every account and record here is fake test data.
const PROJECT_ID = "demo-hi-coworking";
const REGION = "us-central1";
const AUTH_URL = "http://127.0.0.1:9100";
const FIRESTORE_URL = "http://127.0.0.1:8081";
const PASSWORD = "front-desk-kiosk-test-password";
const MIN = 60_000;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9100";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

let adminApp: AdminApp;
let db: Firestore;
let sequence = 0;
const clients: FirebaseApp[] = [];

async function wipe(url: string) {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) throw new Error(`Could not clear emulator: ${response.status}`);
}

type Account = { uid: string; role: string; kiosk?: boolean; profile?: Record<string, unknown> };

async function signedIn(account: Account): Promise<Functions> {
  const email = `${account.uid}@example.test`;
  const auth = getAdminAuth(adminApp);
  await auth.createUser({ uid: account.uid, email, password: PASSWORD, emailVerified: true });
  const claims: Record<string, unknown> = { role: account.role };
  if (account.kiosk) claims.kiosk = true;
  await db.collection("users").doc(account.uid).set({
    uid: account.uid, email, displayName: account.uid, role: account.role, membershipStatus: "none", createdAt: Date.now(),
    ...(account.profile || {}),
  });
  const app = initializeApp({ apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID }, `${account.uid}-${++sequence}`);
  clients.push(app);
  const clientAuth = getAuth(app);
  connectAuthEmulator(clientAuth, AUTH_URL, { disableWarnings: true });
  await signInWithEmailAndPassword(clientAuth, email, PASSWORD);
  // The provisioning trigger may race our claims; set until the token shows them.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await auth.setCustomUserClaims(account.uid, claims);
    const token = await clientAuth.currentUser!.getIdTokenResult(true);
    if (token.claims.role === account.role && (token.claims.kiosk === true) === Boolean(account.kiosk)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, "127.0.0.1", 5004);
  return functions;
}

async function member(uid: string, profile: Record<string, unknown> = {}) {
  const email = `${uid}@example.test`;
  await getAdminAuth(adminApp).createUser({ uid, email, password: PASSWORD });
  await db.collection("users").doc(uid).set({
    uid, email, role: "member", membershipStatus: "none", createdAt: Date.now(), ...profile,
  });
  return email;
}

async function kioskDevice(uid = "kiosk-ipad", enrolled = true) {
  if (enrolled) await db.collection("kioskDevices").doc(uid).set({ uid, label: "Front desk", enabled: true, enrolledAt: Date.now() });
  return signedIn({ uid, role: "member", kiosk: true });
}

async function call<T = Record<string, unknown>>(functions: Functions, name: string, data: Record<string, unknown> = {}) {
  return (await httpsCallable<Record<string, unknown>, T>(functions, name)(data)).data;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code: `functions/${code}` });
}

function requestId() {
  return `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function easternNoonToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

let sweep: typeof import("../../apps/functions/src/frontDeskKiosk/functions");
let policy: typeof import("../../apps/functions/src/frontDeskKiosk/policy");

beforeAll(async () => {
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "front-desk-kiosk-tests");
  db = getAdminFirestore(adminApp);
  sweep = await import("../../apps/functions/src/frontDeskKiosk/functions");
  policy = await import("../../apps/functions/src/frontDeskKiosk/policy");
});

beforeEach(async () => {
  await wipe(`${FIRESTORE_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`);
  await wipe(`${AUTH_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`);
});

afterAll(async () => {
  await Promise.all(clients.map((app) => deleteApp(app)));
  await deleteAdminApp(adminApp);
});

describe("kiosk claim boundary", () => {
  it("refuses members, staff with a kiosk claim, and unenrolled devices", async () => {
    const plainMember = await signedIn({ uid: "plain-member", role: "member" });
    await expectCode(call(plainMember, "kiosk_session"), "permission-denied");

    await db.collection("kioskDevices").doc("staff-kiosk").set({ uid: "staff-kiosk", enabled: true });
    const staffKiosk = await signedIn({ uid: "staff-kiosk", role: "staff", kiosk: true });
    await expectCode(call(staffKiosk, "kiosk_session"), "permission-denied");

    const unenrolled = await kioskDevice("unenrolled-ipad", false);
    await expectCode(call(unenrolled, "kiosk_session"), "permission-denied");

    const kiosk = await kioskDevice();
    const session = await call<{ deviceLabel: string; settings: { idleLogoMinutes: number } }>(kiosk, "kiosk_session");
    expect(session.deviceLabel).toBe("Front desk");
    expect(session.settings.idleLogoMinutes).toBe(15);
  });

  it("never treats the kiosk claim as staff", async () => {
    const kiosk = await kioskDevice();
    await expectCode(call(kiosk, "admin_kioskOverview"), "permission-denied");
    await expectCode(call(kiosk, "admin_kioskCloseVisit", { visitId: "x", checkOutAt: Date.now(), reason: "test" }), "permission-denied");
    await expectCode(call(kiosk, "admin_kioskDeviceSet", { uid: "kiosk-ipad", action: "enroll" }), "permission-denied");
    await expectCode(call(kiosk, "members_kioskSummary"), "permission-denied");
  });

  it("only enrolls non-staff accounts and revokes cleanly", async () => {
    const adminFns = await signedIn({ uid: "admin-one", role: "admin" });
    await member("new-ipad");
    await call(adminFns, "admin_kioskDeviceSet", { uid: "new-ipad", action: "enroll", label: "Lobby iPad" });
    let user = await getAdminAuth(adminApp).getUser("new-ipad");
    expect(user.customClaims?.kiosk).toBe(true);
    expect((await db.collection("kioskDevices").doc("new-ipad").get()).data()?.enabled).toBe(true);

    await call(adminFns, "admin_kioskDeviceSet", { uid: "new-ipad", action: "revoke" });
    user = await getAdminAuth(adminApp).getUser("new-ipad");
    expect(user.customClaims?.kiosk).toBeUndefined();
    expect((await db.collection("kioskDevices").doc("new-ipad").get()).data()?.enabled).toBe(false);

    await signedIn({ uid: "staffer", role: "staff" });
    await expectCode(call(adminFns, "admin_kioskDeviceSet", { uid: "staffer", action: "enroll" }), "failed-precondition");
    const audits = await db.collection("memberOperationAudit").where("memberUid", "==", "new-ipad").get();
    expect(audits.docs.map((d) => d.data().action).sort()).toEqual(["kiosk_device_enroll", "kiosk_device_revoke"]);
  });
});

describe("lookup", () => {
  it("returns only a masked name and a short-lived handle", async () => {
    const email = await member("avery", { displayName: "Avery Kim" });
    const kiosk = await kioskDevice();
    const result = await call<Record<string, unknown>>(kiosk, "kiosk_lookupMember", { query: email.toUpperCase() });
    expect(result.memberLabel).toBe("Avery K.");
    expect(result.checkedIn).toBe(false);
    expect(JSON.stringify(result)).not.toContain("avery@");
    expect(JSON.stringify(result)).not.toContain("\"avery\"");
    await expectCode(call(kiosk, "kiosk_lookupMember", { query: "nobody@example.test" }), "not-found");
    await expectCode(call(kiosk, "kiosk_lookupMember", { query: "kiosk-ipad@example.test" }), "not-found");
  });

  it("finds a member by the code on their account page", async () => {
    const samFns = await signedIn({ uid: "sam-signed", role: "member", profile: { displayName: "Sam Lee" } });
    const summary = await call<{ code: string; visits: unknown[] }>(samFns, "members_kioskSummary");
    expect(policy.isValidMemberCode(summary.code)).toBe(true);
    expect((await call<{ code: string }>(samFns, "members_kioskSummary")).code).toBe(summary.code);
    const kiosk = await kioskDevice();
    const found = await call<{ memberLabel: string }>(kiosk, "kiosk_lookupMember", { query: summary.code.toLowerCase() });
    expect(found.memberLabel).toBe("Sam L.");
  });

  it("is rate-limited per device", async () => {
    const kiosk = await kioskDevice();
    const minute = Math.floor(Date.now() / MIN);
    await db.collection("kioskRateLimits").doc(`kiosk-ipad_${minute}`).set({ count: policy.LOOKUPS_PER_MINUTE });
    await db.collection("kioskRateLimits").doc(`kiosk-ipad_${minute + 1}`).set({ count: policy.LOOKUPS_PER_MINUTE });
    await expectCode(call(kiosk, "kiosk_lookupMember", { query: "someone@example.test" }), "resource-exhausted");
  });
});

describe("check-in and check-out", () => {
  it("is idempotent per request and keeps one open visit per member", async () => {
    const email = await member("riley", { displayName: "Riley Park" });
    const kiosk = await kioskDevice();
    const { lookupId } = await call<{ lookupId: string }>(kiosk, "kiosk_lookupMember", { query: email });
    const rid = requestId();
    const first = await call<Record<string, unknown>>(kiosk, "kiosk_checkIn", { lookupId, requestId: rid });
    const replay = await call<Record<string, unknown>>(kiosk, "kiosk_checkIn", { lookupId, requestId: rid });
    expect(first.status).toBe("checked_in");
    expect(replay).toEqual(first);
    expect(first.firstName).toBe("Riley");

    const again = await call<Record<string, unknown>>(kiosk, "kiosk_checkIn", { lookupId, requestId: requestId() });
    expect(again.status).toBe("already_checked_in");
    const visits = await db.collection("kioskVisits").where("uid", "==", "riley").get();
    expect(visits.size).toBe(1);
  });

  it("lets only one of two simultaneous check-ins open a visit", async () => {
    const email = await member("jordan", { displayName: "Jordan Blake" });
    const kiosk = await kioskDevice();
    const { lookupId } = await call<{ lookupId: string }>(kiosk, "kiosk_lookupMember", { query: email });
    const results = await Promise.all([1, 2, 3].map(() => call<{ status: string }>(kiosk, "kiosk_checkIn", { lookupId, requestId: requestId() })));
    expect(results.filter((r) => r.status === "checked_in")).toHaveLength(1);
    expect((await db.collection("kioskVisits").where("uid", "==", "jordan").get()).size).toBe(1);
  });

  it("uses today's booked window and records overage minutes without charging", async () => {
    const email = await member("casey", { displayName: "Casey North", membershipStatus: "active", plan: "coworking" });
    const now = Date.now();
    await db.collection("bookings").doc("casey-booking").set({
      userId: "casey", resourceId: "seat-3", status: "CONFIRMED", start: now - 10 * MIN, end: now + 50 * MIN,
    });
    const kiosk = await kioskDevice();
    const { lookupId } = await call<{ lookupId: string }>(kiosk, "kiosk_lookupMember", { query: email });
    const checkIn = await call<Record<string, unknown>>(kiosk, "kiosk_checkIn", { lookupId, requestId: requestId() });
    expect(checkIn.bookedWindow).toEqual({ start: now - 10 * MIN, end: now + 50 * MIN });
    expect(checkIn.planName).toBeTruthy();

    // Move the check-in back 2 hours to simulate a long stay.
    const visitId = String(checkIn.visitId);
    const twoHoursAgo = Date.now() - 112 * MIN; // ~52 raw overage minutes -> 60
    await db.collection("kioskVisits").doc(visitId).update({ checkInAt: twoHoursAgo });
    const out = await call<Record<string, unknown>>(kiosk, "kiosk_checkOut", { lookupId, requestId: requestId() });
    expect(out.status).toBe("checked_out");
    expect(out.overageMinutes).toBe(60);
    const visit = (await db.collection("kioskVisits").doc(visitId).get()).data()!;
    expect(visit.status).toBe("closed");
    expect(visit.chargeStatus).toBe("not_charged");
    expect(visit.rateCents).toBeGreaterThan(0);
    expect((await db.collection("kioskOpenVisits").doc("casey").get()).exists).toBe(false);

    const second = await call<{ status: string }>(kiosk, "kiosk_checkOut", { lookupId, requestId: requestId() });
    expect(second.status).toBe("not_checked_in");
  });

  it("raises a quiet staff alert for lapsed memberships while the member sees a normal check-in", async () => {
    const email = await member("morgan", { displayName: "Morgan Diaz", membershipStatus: "pastDue", plan: "coworking" });
    const kiosk = await kioskDevice();
    const { lookupId } = await call<{ lookupId: string }>(kiosk, "kiosk_lookupMember", { query: email });
    const result = await call<Record<string, unknown>>(kiosk, "kiosk_checkIn", { lookupId, requestId: requestId() });
    expect(result.status).toBe("checked_in");
    expect(JSON.stringify(result)).not.toMatch(/past|alert|expired/i);
    const alerts = await db.collection("kioskAlerts").get();
    expect(alerts.docs.map((d) => d.data().reason)).toEqual(["past_due"]);

    const staff = await signedIn({ uid: "desk-staff", role: "staff" });
    const overview = await call<{ alerts: Array<{ alertId: string }>; openVisits: unknown[] }>(staff, "admin_kioskOverview");
    expect(overview.alerts).toHaveLength(1);
    expect(overview.openVisits).toHaveLength(1);
    await call(staff, "admin_kioskResolveAlert", { alertId: overview.alerts[0].alertId, note: "Spoke at desk" });
    expect((await db.collection("kioskAlerts").doc(overview.alerts[0].alertId).get()).data()?.status).toBe("resolved");
  });
});

describe("attendance sweep and staff close", () => {
  it("auto-closes forgotten check-outs at closing time for review, with no assumed overage", async () => {
    const day = easternNoonToday();
    const yesterday = policy.easternDayKey(policy.easternDayBounds(day).start - 60 * MIN);
    const checkInAt = policy.easternEpoch(yesterday, "10:00");
    await member("taylor", { displayName: "Taylor Fox" });
    await db.collection("kioskVisits").doc("visit-taylor").set({
      id: "visit-taylor", uid: "taylor", memberLabel: "Taylor F.", dayKey: yesterday, monthKey: yesterday.slice(0, 7),
      status: "open", checkInAt, checkOutAt: null, allowanceSource: "monthly", allowanceMinutes: 60, needsReview: false,
    });
    await db.collection("kioskOpenVisits").doc("taylor").set({ uid: "taylor", visitId: "visit-taylor", checkInAt, dayKey: yesterday });

    const result = await sweep.runAttendanceSweep(policy.easternEpoch(day, "12:00"));
    expect(result.autoClosed).toBe(1);
    const visit = (await db.collection("kioskVisits").doc("visit-taylor").get()).data()!;
    expect(visit.status).toBe("auto_closed");
    expect(visit.needsReview).toBe(true);
    expect(visit.reviewReason).toBe("forgot_checkout");
    expect(visit.overageMinutes).toBeNull();
    expect(visit.checkOutAt).toBeGreaterThan(checkInAt);
    expect((await db.collection("kioskOpenVisits").doc("taylor").get()).exists).toBe(false);

    const staff = await signedIn({ uid: "desk-staff", role: "staff" });
    await expectCode(call(staff, "admin_kioskCloseVisit", { visitId: "visit-taylor", checkOutAt: checkInAt + 90 * MIN, reason: "" }), "invalid-argument");
    const closed = await call<{ overageMinutes: number }>(staff, "admin_kioskCloseVisit", {
      visitId: "visit-taylor", checkOutAt: checkInAt + 90 * MIN, reason: "Member confirmed they left at 11:30",
    });
    expect(closed.overageMinutes).toBe(30);
    const after = (await db.collection("kioskVisits").doc("visit-taylor").get()).data()!;
    expect(after.status).toBe("staff_closed");
    expect(after.needsReview).toBe(false);
    const audit = await db.collection("memberOperationAudit").where("action", "==", "kiosk_visit_closed").get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().details).toMatchObject({ visitId: "visit-taylor", fromStatus: "auto_closed", reason: "Member confirmed they left at 11:30" });
    await expectCode(call(staff, "admin_kioskCloseVisit", { visitId: "visit-taylor", checkOutAt: checkInAt + 60 * MIN, reason: "again" }), "failed-precondition");
  });

  it("flags late and no-show bookings without touching the booking", async () => {
    const day = easternNoonToday();
    const noon = policy.easternEpoch(day, "12:00");
    await member("lee", { displayName: "Lee Hart" });
    await member("kai", { displayName: "Kai Moss" });
    await db.collection("bookings").doc("late-booking").set({ userId: "lee", resourceId: "seat-1", status: "CONFIRMED", start: noon - 30 * MIN, end: noon + 60 * MIN });
    await db.collection("bookings").doc("missed-booking").set({ userId: "kai", resourceId: "seat-2", status: "CONFIRMED", start: noon - 180 * MIN, end: noon - 60 * MIN });
    await db.collection("bookings").doc("future-booking").set({ userId: "kai", resourceId: "seat-2", status: "CONFIRMED", start: noon + 60 * MIN, end: noon + 120 * MIN });

    const result = await sweep.runAttendanceSweep(noon);
    expect(result).toMatchObject({ flagged: 2, bookingsChecked: 3 });
    expect((await db.collection("kioskBookingFlags").doc("late-booking").get()).data()?.status).toBe("late");
    expect((await db.collection("kioskBookingFlags").doc("missed-booking").get()).data()?.status).toBe("no_show");
    expect((await db.collection("kioskBookingFlags").doc("future-booking").get()).exists).toBe(false);
    expect((await db.collection("bookings").doc("late-booking").get()).data()?.status).toBe("CONFIRMED");

    await db.collection("kioskVisits").doc("visit-lee").set({ id: "visit-lee", uid: "lee", dayKey: day, status: "open", checkInAt: noon + 5 * MIN });
    await sweep.runAttendanceSweep(noon + 10 * MIN);
    expect((await db.collection("kioskBookingFlags").doc("late-booking").get()).data()?.status).toBe("arrived_late");
  });
});
