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

let tasks: typeof import("../../apps/functions/src/frontDeskKiosk/functions");
let policy: typeof import("../../apps/functions/src/frontDeskKiosk/policy");

beforeAll(async () => {
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "front-desk-kiosk-tests");
  db = getAdminFirestore(adminApp);
  tasks = await import("../../apps/functions/src/frontDeskKiosk/functions");
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

describe("deferred tasks and staff close", () => {
  type Enqueued = { data: Record<string, unknown>; id: string; scheduleTime: Date };
  let queued: Enqueued[] = [];

  beforeEach(() => {
    queued = [];
    tasks.setFrontDeskTaskQueueForTests(() => ({
      enqueue: async (data, opts) => {
        if (queued.some((q) => q.id === opts.id)) throw Object.assign(new Error("exists"), { code: "functions/task-already-exists" });
        queued.push({ data: data as Record<string, unknown>, id: opts.id, scheduleTime: opts.scheduleTime });
      },
    }));
  });

  afterAll(() => tasks.setFrontDeskTaskQueueForTests(null));

  function tomorrow() {
    return policy.easternDayKey(policy.easternDayBounds(easternNoonToday()).end + 60 * MIN);
  }

  async function seatBooking(id: string, uid: string, start: number, end: number, status = "CONFIRMED") {
    await db.collection("bookings").doc(id).set({ userId: uid, resourceId: "seat-1", status, start, end });
  }

  function attendance(kind: "late" | "no_show", bookingId: string, uid: string, start: number, end: number) {
    return { kind, bookingId, uid, start, end };
  }

  async function flag(bookingId: string) {
    return (await db.collection("kioskBookingFlags").doc(bookingId).get()).data();
  }

  it("runs end to end: a booking write queues a Cloud Task that flags a late member", async () => {
    await member("quinn", { displayName: "Quinn Ray" });
    const now = Date.now();
    // Late check is due now; the no-show check is an hour away.
    await seatBooking("quinn-booking", "quinn", now - 20 * MIN, now + 60 * MIN);
    let status: unknown;
    for (let attempt = 0; attempt < 60 && status !== "late"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = (await flag("quinn-booking"))?.status;
    }
    expect(status).toBe("late");
    expect(await flag("quinn-booking")).toMatchObject({ bookingId: "quinn-booking", uid: "quinn", memberLabel: "Quinn R." });
    expect((await db.collection("bookings").doc("quinn-booking").get()).data()?.status).toBe("CONFIRMED");
  }, 45_000);

  it("plans late and no-show tasks with deterministic IDs, once per booking time", async () => {
    const noon = policy.easternEpoch(tomorrow(), "12:00");
    const booking = { userId: "lee", resourceId: "seat-1", status: "CONFIRMED", start: noon, end: noon + 120 * MIN };
    const first = await tasks.enqueueBookingTasks({ bookingId: "b1", before: undefined, after: booking, now: noon - 600 * MIN });
    expect(first.enqueued).toEqual([`kiosk-late-b1-${noon}`, `kiosk-noshow-b1-${noon}`]);
    expect(queued.map((q) => q.scheduleTime.getTime())).toEqual([noon + 15 * MIN, noon + 120 * MIN]);
    // A replayed trigger event re-plans the same IDs and is a no-op.
    const replay = await tasks.enqueueBookingTasks({ bookingId: "b1", before: undefined, after: booking, now: noon - 600 * MIN });
    expect(replay).toEqual({ enqueued: [], duplicates: [`kiosk-late-b1-${noon}`, `kiosk-noshow-b1-${noon}`] });
    // Unrelated edits queue nothing; a reschedule queues new IDs.
    expect((await tasks.enqueueBookingTasks({ bookingId: "b1", before: booking, after: { ...booking, note: "x" } })).enqueued).toEqual([]);
    const moved = { ...booking, start: noon + 60 * MIN, end: noon + 180 * MIN };
    expect((await tasks.enqueueBookingTasks({ bookingId: "b1", before: booking, after: moved, now: noon - 600 * MIN })).enqueued)
      .toEqual([`kiosk-late-b1-${noon + 60 * MIN}`, `kiosk-noshow-b1-${noon + 60 * MIN}`]);
    expect((await tasks.enqueueBookingTasks({ bookingId: "b1", before: booking, after: { ...booking, status: "CANCELLED" } })).enqueued).toEqual([]);
  });

  it("flags a member who has not checked in, late then no-show, and handles duplicate delivery", async () => {
    const day = tomorrow();
    const start = policy.easternEpoch(day, "10:00");
    const end = start + 120 * MIN;
    await member("kai", { displayName: "Kai Moss" });
    await seatBooking("kai-booking", "kai", start, end);

    const late = attendance("late", "kai-booking", "kai", start, end);
    expect(await tasks.runFrontDeskTask(late, start + 15 * MIN)).toMatchObject({ action: "flag", status: "late" });
    const first = await flag("kai-booking");
    expect(first).toMatchObject({ status: "late", uid: "kai", memberLabel: "Kai M.", dayKey: day, start, end });
    // Cloud Tasks is at-least-once: a second delivery changes nothing.
    expect(await tasks.runFrontDeskTask(late, start + 20 * MIN)).toMatchObject({ action: "noop", reason: "already_flagged" });
    expect(await flag("kai-booking")).toEqual(first);

    const noShow = attendance("no_show", "kai-booking", "kai", start, end);
    expect(await tasks.runFrontDeskTask(noShow, end)).toMatchObject({ action: "flag", status: "no_show" });
    expect(await flag("kai-booking")).toMatchObject({ status: "no_show", flaggedAt: first!.flaggedAt });
    expect(await tasks.runFrontDeskTask(noShow, end + MIN)).toMatchObject({ action: "noop", reason: "already_flagged" });
    expect(await tasks.runFrontDeskTask(late, end + MIN)).toMatchObject({ action: "noop", reason: "already_flagged" });
    expect((await flag("kai-booking"))?.status).toBe("no_show");
  });

  it("does nothing for a member who checked in, and marks a late member who arrives", async () => {
    const day = tomorrow();
    const start = policy.easternEpoch(day, "09:00");
    const end = start + 180 * MIN;
    await member("lee", { displayName: "Lee Hart" });
    await member("ana", { displayName: "Ana Cruz" });
    await seatBooking("lee-booking", "lee", start, end);
    await seatBooking("ana-booking", "ana", start, end);
    await db.collection("kioskVisits").doc("visit-ana").set({ id: "visit-ana", uid: "ana", dayKey: day, status: "open", checkInAt: start - 5 * MIN, checkOutAt: null });

    expect(await tasks.runFrontDeskTask(attendance("late", "ana-booking", "ana", start, end), start + 15 * MIN)).toMatchObject({ action: "noop", reason: "attended" });
    expect(await tasks.runFrontDeskTask(attendance("no_show", "ana-booking", "ana", start, end), end)).toMatchObject({ action: "noop", reason: "attended" });
    expect(await flag("ana-booking")).toBeUndefined();

    await tasks.runFrontDeskTask(attendance("late", "lee-booking", "lee", start, end), start + 15 * MIN);
    expect((await flag("lee-booking"))?.status).toBe("late");
    await db.collection("kioskVisits").doc("visit-lee").set({ id: "visit-lee", uid: "lee", dayKey: day, status: "open", checkInAt: start + 40 * MIN, checkOutAt: null });
    expect(await tasks.runFrontDeskTask(attendance("no_show", "lee-booking", "lee", start, end), end)).toMatchObject({ action: "arrived_late" });
    expect((await flag("lee-booking"))?.status).toBe("arrived_late");
  });

  it("no-ops for cancelled, rescheduled, reassigned, deleted, early and malformed tasks", async () => {
    const day = tomorrow();
    const start = policy.easternEpoch(day, "13:00");
    const end = start + 60 * MIN;
    await member("rae", { displayName: "Rae Lin" });
    await seatBooking("cancelled", "rae", start, end, "CANCELLED");
    await seatBooking("moved", "rae", start + 120 * MIN, end + 120 * MIN);
    await seatBooking("reassigned", "someone-else", start, end);

    for (const id of ["cancelled", "moved", "reassigned", "deleted"]) {
      expect(await tasks.runFrontDeskTask(attendance("late", id, "rae", start, end), start + 15 * MIN)).toMatchObject({ action: "noop", reason: "stale_booking" });
      expect(await tasks.runFrontDeskTask(attendance("no_show", id, "rae", start, end), end)).toMatchObject({ action: "noop", reason: "stale_booking" });
      expect(await flag(id)).toBeUndefined();
    }
    // The moved booking's own tasks still work at its new time.
    expect(await tasks.runFrontDeskTask(attendance("late", "moved", "rae", start + 120 * MIN, end + 120 * MIN), start + 135 * MIN)).toMatchObject({ action: "flag" });

    // Slightly early delivery (clock skew) throws so Cloud Tasks retries.
    await seatBooking("early", "rae", start, end);
    await expect(tasks.runFrontDeskTask(attendance("late", "early", "rae", start, end), start + 12 * MIN)).rejects.toThrow(/before it was due/);
    expect(await flag("early")).toBeUndefined();
    // A relay hop for a far-off booking re-queues the real check instead.
    expect(await tasks.runFrontDeskTask(attendance("late", "early", "rae", start, end), start - 10 * 24 * 60 * MIN)).toEqual({ action: "relay" });
    expect(queued.map((q) => [q.id, q.scheduleTime.getTime()])).toEqual([[`kiosk-late-early-${start}`, start + 15 * MIN]]);
    expect(await flag("early")).toBeUndefined();
    expect(await tasks.runFrontDeskTask({ kind: "late", bookingId: "a/b", uid: "rae", start, end })).toMatchObject({ reason: "malformed" });
  });

  it("auto-closes a forgotten check-out at closing time for review, with no assumed overage", async () => {
    const day = easternNoonToday();
    const yesterday = policy.easternDayKey(policy.easternDayBounds(day).start - 60 * MIN);
    const checkInAt = policy.easternEpoch(yesterday, "10:00");
    await member("taylor", { displayName: "Taylor Fox" });
    await db.collection("kioskVisits").doc("visit-taylor").set({
      id: "visit-taylor", uid: "taylor", memberLabel: "Taylor F.", dayKey: yesterday, monthKey: yesterday.slice(0, 7),
      status: "open", checkInAt, checkOutAt: null, allowanceSource: "monthly", allowanceMinutes: 60, needsReview: false,
    });
    await db.collection("kioskOpenVisits").doc("taylor").set({ uid: "taylor", visitId: "visit-taylor", checkInAt, dayKey: yesterday });

    // Closing time comes from the operating calendar; the task was due then.
    const now = policy.easternEpoch(day, "12:00");
    const task = { kind: "auto_close", uid: "taylor", visitId: "visit-taylor", dueAt: checkInAt + 60 * MIN };
    const decision = await tasks.runFrontDeskTask(task, now) as { action: string; checkOutAt: number };
    expect(decision.action).toBe("close");
    const visit = (await db.collection("kioskVisits").doc("visit-taylor").get()).data()!;
    expect(visit.status).toBe("auto_closed");
    expect(visit.needsReview).toBe(true);
    expect(visit.reviewReason).toBe("forgot_checkout");
    expect(visit.overageMinutes).toBeNull();
    expect(visit.checkOutAt).toBe(decision.checkOutAt);
    expect(visit.checkOutAt).toBeGreaterThan(checkInAt);
    expect((await db.collection("kioskOpenVisits").doc("taylor").get()).exists).toBe(false);
    // Duplicate delivery: already closed, nothing changes.
    expect(await tasks.runFrontDeskTask(task, now + MIN)).toMatchObject({ action: "noop", reason: "not_open" });
    expect((await db.collection("kioskVisits").doc("visit-taylor").get()).data()).toEqual(visit);

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
    // The staff close is final: a late task delivery cannot reopen or re-close it.
    expect(await tasks.runFrontDeskTask(task, now + 2 * MIN)).toMatchObject({ action: "noop" });
  });

  it("leaves a checked-out visit alone, re-queues when closing moved later, and retries early delivery", async () => {
    const day = tomorrow();
    const checkInAt = policy.easternEpoch(day, "10:00");
    await db.collection("kioskVisits").doc("visit-done").set({ id: "visit-done", uid: "jo", dayKey: day, status: "closed", checkInAt, checkOutAt: checkInAt + 60 * MIN });
    expect(await tasks.runFrontDeskTask({ kind: "auto_close", uid: "jo", visitId: "visit-done", dueAt: checkInAt + 60 * MIN }, checkInAt + 600 * MIN))
      .toMatchObject({ action: "noop", reason: "not_open" });
    // A visit that no longer exists is a no-op, not an error to retry.
    await db.collection("kioskOpenVisits").doc("gone").set({ uid: "gone", visitId: "visit-gone", checkInAt, dayKey: day });
    expect(await tasks.runFrontDeskTask({ kind: "auto_close", uid: "gone", visitId: "visit-gone", dueAt: checkInAt + 60 * MIN }, checkInAt + 600 * MIN))
      .toMatchObject({ action: "noop", reason: "not_open" });

    await db.collection("kioskVisits").doc("visit-open").set({ id: "visit-open", uid: "mo", dayKey: day, status: "open", checkInAt, checkOutAt: null });
    await db.collection("kioskOpenVisits").doc("mo").set({ uid: "mo", visitId: "visit-open", checkInAt, dayKey: day });
    // A task queued for an earlier close than the day's hours now say.
    const stale = { kind: "auto_close", uid: "mo", visitId: "visit-open", dueAt: checkInAt + MIN };
    const decision = await tasks.runFrontDeskTask(stale, checkInAt + MIN) as { action: string; dueAt: number };
    expect(decision.action).toBe("reschedule");
    expect(decision.dueAt).toBeGreaterThan(checkInAt + MIN);
    expect(queued.map((q) => q.id)).toEqual([`kiosk-close-visit-open-${decision.dueAt}`]);
    expect(queued[0].scheduleTime.getTime()).toBe(decision.dueAt);
    expect(queued[0].data).toEqual({ kind: "auto_close", uid: "mo", visitId: "visit-open", dueAt: decision.dueAt });
    // The re-queued task delivered early (clock skew) throws so Cloud Tasks retries.
    await expect(tasks.runFrontDeskTask(queued[0].data, decision.dueAt - MIN)).rejects.toThrow(/before it was due/);
    expect((await db.collection("kioskVisits").doc("visit-open").get()).data()?.status).toBe("open");
    expect(await tasks.runFrontDeskTask(queued[0].data, decision.dueAt)).toMatchObject({ action: "close" });
  });

  it("closes yesterday's open visit when the member checks in again", async () => {
    const day = easternNoonToday();
    const yesterday = policy.easternDayKey(policy.easternDayBounds(day).start - 60 * MIN);
    const checkInAt = policy.easternEpoch(yesterday, "10:00");
    const email = await member("sky", { displayName: "Sky Moon" });
    await db.collection("kioskVisits").doc("visit-sky").set({
      id: "visit-sky", uid: "sky", memberLabel: "Sky M.", dayKey: yesterday, monthKey: yesterday.slice(0, 7),
      status: "open", checkInAt, checkOutAt: null, allowanceSource: "monthly", allowanceMinutes: 60, needsReview: false,
    });
    await db.collection("kioskOpenVisits").doc("sky").set({ uid: "sky", visitId: "visit-sky", checkInAt, dayKey: yesterday });
    const kiosk = await kioskDevice();
    const { lookupId } = await call<{ lookupId: string }>(kiosk, "kiosk_lookupMember", { query: email });
    const result = await call<{ status: string; visitId: string }>(kiosk, "kiosk_checkIn", { lookupId, requestId: requestId() });
    expect(result.status).toBe("checked_in");
    const old = (await db.collection("kioskVisits").doc("visit-sky").get()).data()!;
    expect(old).toMatchObject({ status: "auto_closed", needsReview: true, reviewReason: "forgot_checkout", overageMinutes: null });
    expect((await db.collection("kioskOpenVisits").doc("sky").get()).data()?.visitId).toBe(result.visitId);
  });
});
