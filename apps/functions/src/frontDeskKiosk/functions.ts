import { randomUUID } from "node:crypto";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { adminEventCallableOptions } from "../eventsV2/adminEventCors";
import { getResolvedBookingDay } from "../bookingOperatingCalendar";
import { getMembershipUsageState } from "../bookingFlexShared";
import { getDeskMembershipTierById, GUEST_HOURLY_RATE_CENTS } from "../payments/stripeConfig";
import { compMembershipEnded } from "../payments/compMembership";
import {
  HOURS_ALERT_LABELS,
  LOOKUP_TTL_MS,
  LOOKUPS_PER_MINUTE,
  STAFF_ROLES,
  attendanceTaskPlan,
  autoCloseTaskId,
  bookingMinutesUsedByVisit,
  decideAttendanceTask,
  decideAutoClose,
  parseFrontDeskTask,
  planAttendanceTasks,
  trackableBooking,
  visitOverlapsBooking,
  autoClosePlan,
  closingTimeFromIntervals,
  computeAllowance,
  computeOverage,
  easternDayBounds,
  easternDayKey,
  easternEpoch,
  easternMonthKey,
  firstName,
  generateMemberCode,
  hoursAlertReason,
  maskedName,
  normalizeKioskSettings,
  parseLookupQuery,
  seatBookingsForDay,
  validRequestId,
  validateCloseReason,
  validateKioskSettings,
  type Allowance,
  type AttendanceTaskPayload,
  type AutoCloseTaskPayload,
  type KioskBooking,
  type PlannedTask,
} from "./policy";
import { enqueueFrontDeskTasks, frontDeskTaskQueue, type TaskQueueLike } from "./taskQueue";

/**
 * Front-desk iPad kiosk: check-in and check-out only.
 *
 * Kiosk devices sign in with a dedicated account that carries the custom
 * claim `kiosk: true`. That claim never grants staff access: kiosk callables
 * refuse staff/admin/master tokens, and staff callables ignore the claim.
 * Every write uses the Admin SDK and the server clock. Clients cannot read or
 * write any kiosk collection directly (firestore.rules denies them).
 *
 * Collections (all server-only):
 *   kioskVisits/{visitId}        one stay; status open | closed | auto_closed | staff_closed
 *   kioskOpenVisits/{uid}        one open visit per member (transaction guard)
 *   kioskAlerts/{visitId}        quiet staff-only membership/hours alerts
 *   kioskBookingFlags/{bookingId} late / no_show / arrived_late flags (booking docs untouched)
 *   kioskRequests/{kioskUid}_{requestId} idempotent results
 *   kioskLookups/{lookupId}      short-lived lookup handles (no uid leaves the server)
 *   kioskRateLimits/{kioskUid}_{minute} lookup throttle
 *   kioskDevices/{kioskUid}      enrolled devices
 *   kioskSettings/frontDesk      idle logo timing
 *   kioskMemberCodes/{uid}, kioskCodeIndex/{code} member check-in codes
 *
 * Overage minutes and the plan rate are recorded only. Nothing is charged.
 */

if (admin.apps.length === 0) admin.initializeApp();

const db = () => admin.firestore();
const MINUTE_MS = 60_000;

const COL = {
  visits: "kioskVisits",
  open: "kioskOpenVisits",
  alerts: "kioskAlerts",
  flags: "kioskBookingFlags",
  requests: "kioskRequests",
  lookups: "kioskLookups",
  rate: "kioskRateLimits",
  devices: "kioskDevices",
  settings: "kioskSettings",
  codes: "kioskMemberCodes",
  codeIndex: "kioskCodeIndex",
} as const;

const SETTINGS_DOC = "frontDesk";
const NOT_FOUND_MESSAGE = "We couldn't find that. Check it and try again, or please see staff.";

type AuthLike = CallableRequest["auth"];

// ------------------------------------------------------------ guards ----

function roleOf(auth: AuthLike): string {
  return String(auth?.token?.role || "");
}

export function isKioskToken(auth: AuthLike): boolean {
  return Boolean(auth && auth.token?.kiosk === true && !STAFF_ROLES.has(roleOf(auth)));
}

async function requireKiosk(request: CallableRequest): Promise<{ kioskUid: string; label: string }> {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "This kiosk needs to be signed in.");
  if (auth.token?.kiosk !== true) throw new HttpsError("permission-denied", "This account isn't a front-desk kiosk.");
  if (STAFF_ROLES.has(roleOf(auth))) {
    throw new HttpsError("permission-denied", "Staff accounts can't be used as a kiosk.");
  }
  const device = await db().collection(COL.devices).doc(auth.uid).get();
  if (!device.exists || device.data()?.enabled !== true) {
    throw new HttpsError("permission-denied", "This kiosk isn't enrolled. Please see staff.");
  }
  return { kioskUid: auth.uid, label: String(device.data()?.label || "Front desk") };
}

function requireStaff(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  if (!STAFF_ROLES.has(roleOf(request.auth))) throw new HttpsError("permission-denied", "Staff access is required.");
  return request.auth.uid;
}

function requireAdmin(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = roleOf(request.auth);
  if (role !== "admin" && role !== "master") throw new HttpsError("permission-denied", "Admin access is required.");
  return request.auth.uid;
}

function requireMemberAccount(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  if (request.auth.token?.kiosk === true) throw new HttpsError("permission-denied", "Kiosk accounts don't have a member page.");
  return request.auth.uid;
}

async function writeAudit(input: { action: string; memberUid: string; adminUid: string; details: Record<string, unknown> }) {
  const ref = db().collection("memberOperationAudit").doc();
  await ref.set({ id: ref.id, ...input, createdAt: Date.now() });
  return ref.id;
}

// ----------------------------------------------------------- helpers ----

async function loadSettings() {
  const snap = await db().collection(COL.settings).doc(SETTINGS_DOC).get();
  return normalizeKioskSettings(snap.data());
}

async function consumeRateLimit(kioskUid: string, now: number) {
  const bucket = Math.floor(now / MINUTE_MS);
  const ref = db().collection(COL.rate).doc(`${kioskUid}_${bucket}`);
  const allowed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.data()?.count || 0);
    if (count >= LOOKUPS_PER_MINUTE) return false;
    tx.set(ref, { kioskUid, bucket, count: count + 1, updatedAt: now }, { merge: true });
    return true;
  });
  if (!allowed) throw new HttpsError("resource-exhausted", "Too many tries. Please wait a minute or see staff.");
}

async function findMemberUid(raw: unknown): Promise<string | null> {
  const query = parseLookupQuery(raw);
  if (!query) return null;
  if (query.kind === "email") {
    try {
      return (await admin.auth().getUserByEmail(query.email)).uid;
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") return null;
      throw error;
    }
  }
  const snap = await db().collection(COL.codeIndex).doc(query.code).get();
  return snap.exists ? String(snap.data()?.uid || "") || null : null;
}

type MemberProfile = { uid: string; data: FirebaseFirestore.DocumentData; label: string; first: string };

async function memberProfile(uid: string): Promise<MemberProfile | null> {
  const snap = await db().collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return { uid, data, label: maskedName(data), first: firstName(data) || maskedName(data) };
}

async function readLookup(lookupId: unknown, kioskUid: string, now: number): Promise<{ uid: string; label: string; first: string }> {
  if (typeof lookupId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(lookupId)) {
    throw new HttpsError("invalid-argument", "Please start again.");
  }
  const snap = await db().collection(COL.lookups).doc(lookupId).get();
  const data = snap.data();
  if (!snap.exists || !data || data.kioskUid !== kioskUid || Number(data.expiresAt) < now) {
    throw new HttpsError("deadline-exceeded", "That took a little too long. Please start again.");
  }
  return { uid: String(data.uid), label: String(data.memberLabel || "Member"), first: String(data.firstName || "") };
}

async function readStoredRequest(ref: FirebaseFirestore.DocumentReference) {
  const snap = await ref.get();
  return snap.exists ? (snap.data()?.result as Record<string, unknown>) : null;
}

type AllowanceContext = {
  allowance: Allowance;
  planId: string | null;
  planName: string | null;
  rateCents: number;
  rateSource: "plan" | "guest";
  alertReason: ReturnType<typeof hoursAlertReason>;
};

export async function allowanceContext(uid: string, user: FirebaseFirestore.DocumentData, now: number): Promise<AllowanceContext> {
  const dayKey = easternDayKey(now);
  const monthKey = easternMonthKey(now);
  const active = user.membershipStatus === "active";
  const tier = active && user.plan ? getDeskMembershipTierById(String(user.plan)) : undefined;
  const compEnded = compMembershipEnded(user, now);
  const hasDeskPlan = Boolean(tier) && !compEnded;

  const [bookingSnap, visitSnap, usage] = await Promise.all([
    db().collection("bookings").where("userId", "==", uid).get(),
    db().collection(COL.visits).where("uid", "==", uid).get(),
    hasDeskPlan ? getMembershipUsageState(uid, monthKey) : Promise.resolve(null),
  ]);
  const bookings: KioskBooking[] = bookingSnap.docs.map((doc) => {
    const b = doc.data();
    return { id: doc.id, start: Number(b.start), end: Number(b.end), status: b.status, resourceId: b.resourceId, userId: b.userId };
  });
  const bookingMinutesUsedToday = visitSnap.docs
    .map((doc) => doc.data())
    .filter((v) => v.dayKey === dayKey)
    .reduce((sum, v) => sum + bookingMinutesUsedByVisit(v), 0);
  const walkInIncluded = visitSnap.docs
    .map((doc) => doc.data())
    .filter((v) => v.monthKey === monthKey && v.allowanceSource === "monthly")
    .reduce((sum, v) => sum + Math.max(0, Number(v.includedMinutesApplied || 0)), 0);
  const reservedHours = usage
    ? Object.values(usage.reservations).reduce((sum, r) => sum + Math.max(0, Number(r.hours || 0)), 0)
    : 0;

  const allowance = computeAllowance({
    dayBookings: seatBookingsForDay(bookings, dayKey),
    includedHoursPerMonth: hasDeskPlan && tier ? tier.includedHoursPerMonth : null,
    usedBookingHoursThisMonth: usage ? usage.usedHours + reservedHours : 0,
    walkInIncludedMinutesThisMonth: walkInIncluded,
    bookingMinutesUsedToday,
  });
  return {
    allowance,
    planId: tier ? tier.id : null,
    planName: tier ? tier.name : null,
    rateCents: hasDeskPlan && tier ? tier.extraHourlyRateCents : GUEST_HOURLY_RATE_CENTS,
    rateSource: hasDeskPlan ? "plan" : "guest",
    alertReason: hoursAlertReason({ membershipStatus: user.membershipStatus, compEnded, hasDeskPlan, allowance }),
  };
}

function visitSummary(visit: FirebaseFirestore.DocumentData) {
  return {
    visitId: String(visit.id),
    status: String(visit.status),
    memberLabel: String(visit.memberLabel || "Member"),
    uid: String(visit.uid),
    dayKey: String(visit.dayKey),
    checkInAt: Number(visit.checkInAt),
    checkOutAt: visit.checkOutAt == null ? null : Number(visit.checkOutAt),
    allowanceSource: visit.allowanceSource,
    allowanceMinutes: Number(visit.allowanceMinutes || 0),
    bookedWindow: visit.bookedWindow || null,
    actualMinutes: visit.actualMinutes ?? null,
    overageMinutes: visit.overageMinutes ?? null,
    rateCents: Number(visit.rateCents || 0),
    rateSource: visit.rateSource || null,
    needsReview: visit.needsReview === true,
    reviewReason: visit.reviewReason || null,
    closeReason: visit.closeReason || null,
    alertReason: visit.alertReason || null,
  };
}

// --------------------------------------------------------- kiosk API ----

export const kiosk_session = onCall(adminEventCallableOptions, async (request) => {
  const { label } = await requireKiosk(request);
  return { deviceLabel: label, settings: await loadSettings(), serverNow: Date.now() };
});

export const kiosk_lookupMember = onCall(adminEventCallableOptions, async (request) => {
  const { kioskUid } = await requireKiosk(request);
  const now = Date.now();
  await consumeRateLimit(kioskUid, now);
  const query = (request.data as { query?: unknown } | undefined)?.query;
  const uid = await findMemberUid(query);
  if (!uid) throw new HttpsError("not-found", NOT_FOUND_MESSAGE);
  const [profile, device, open] = await Promise.all([
    memberProfile(uid),
    db().collection(COL.devices).doc(uid).get(),
    db().collection(COL.open).doc(uid).get(),
  ]);
  // Kiosk device accounts are never members at the desk.
  if (!profile || device.exists) throw new HttpsError("not-found", NOT_FOUND_MESSAGE);
  const lookupId = randomUUID();
  await db().collection(COL.lookups).doc(lookupId).set({
    id: lookupId,
    uid,
    kioskUid,
    memberLabel: profile.label,
    firstName: profile.first,
    createdAt: now,
    expiresAt: now + LOOKUP_TTL_MS,
  });
  return {
    lookupId,
    memberLabel: profile.label,
    checkedIn: open.exists,
    checkedInAt: open.exists ? Number(open.data()?.checkInAt) : null,
  };
});

export async function performCheckIn(input: { kioskUid: string; lookupId: unknown; requestId: unknown; now?: number }) {
  if (!validRequestId(input.requestId)) throw new HttpsError("invalid-argument", "Please start again.");
  const now = input.now ?? Date.now();
  const requestRef = db().collection(COL.requests).doc(`${input.kioskUid}_${input.requestId}`);
  const stored = await readStoredRequest(requestRef);
  if (stored) return stored;

  const lookup = await readLookup(input.lookupId, input.kioskUid, now);
  const profile = await memberProfile(lookup.uid);
  if (!profile) throw new HttpsError("not-found", NOT_FOUND_MESSAGE);
  const context = await allowanceContext(lookup.uid, profile.data, now);
  const openRef = db().collection(COL.open).doc(lookup.uid);
  const visitRef = db().collection(COL.visits).doc();
  const today = easternDayKey(now);
  // Backstop if a closing-time task was never queued: an open visit from an
  // earlier day is closed for review (as the task would have) on the next
  // check-in instead of blocking it.
  const priorOpen = (await openRef.get()).data();
  const stale = priorOpen && String(priorOpen.dayKey || "") < today && priorOpen.visitId
    ? {
      visitId: String(priorOpen.visitId),
      ...autoClosePlan({
        checkInAt: Number(priorOpen.checkInAt),
        closingAt: await closingAtFor(String(priorOpen.dayKey)),
        dayEnd: easternDayBounds(String(priorOpen.dayKey)).end,
      }),
    }
    : null;

  const result = await db().runTransaction(async (tx) => {
    const [requestSnap, openSnap] = await Promise.all([tx.get(requestRef), tx.get(openRef)]);
    if (requestSnap.exists) return requestSnap.data()?.result as Record<string, unknown>;

    let openVisit = openSnap.exists ? openSnap.data() : undefined;
    if (openVisit && stale && openVisit.visitId === stale.visitId) {
      const staleRef = db().collection(COL.visits).doc(stale.visitId);
      const staleSnap = await tx.get(staleRef);
      if (staleSnap.exists && staleSnap.data()?.status === "open") {
        tx.update(staleRef, {
          status: "auto_closed",
          checkOutAt: stale.checkOutAt,
          autoClosedAt: now,
          needsReview: true,
          reviewReason: "forgot_checkout",
          actualMinutes: null,
          rawOverageMinutes: null,
          overageMinutes: null,
          updatedAt: now,
        });
      }
      openVisit = undefined;
    }

    let result: Record<string, unknown>;
    if (openVisit) {
      result = {
        status: "already_checked_in",
        firstName: profile.first,
        memberLabel: profile.label,
        checkInAt: Number(openVisit.checkInAt),
      };
    } else {
      const visit = {
        id: visitRef.id,
        uid: lookup.uid,
        memberLabel: profile.label,
        dayKey: easternDayKey(now),
        monthKey: easternMonthKey(now),
        status: "open",
        checkInAt: now,
        checkOutAt: null,
        checkInKioskUid: input.kioskUid,
        checkOutKioskUid: null,
        allowanceSource: context.allowance.source,
        allowanceMinutes: context.allowance.allowanceMinutes,
        remainingMonthlyMinutesAtCheckIn: context.allowance.remainingMonthlyMinutes,
        bookedWindow: context.allowance.bookedWindow,
        bookingIds: context.allowance.bookingIds,
        planId: context.planId,
        rateCents: context.rateCents,
        rateSource: context.rateSource,
        actualMinutes: null,
        rawOverageMinutes: null,
        overageMinutes: null,
        includedMinutesApplied: 0,
        chargeStatus: "not_charged",
        needsReview: false,
        reviewReason: null,
        alertReason: context.alertReason,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(visitRef, visit);
      tx.set(openRef, { uid: lookup.uid, visitId: visitRef.id, checkInAt: now, dayKey: visit.dayKey });
      if (context.alertReason) {
        tx.set(db().collection(COL.alerts).doc(visitRef.id), {
          id: visitRef.id,
          visitId: visitRef.id,
          uid: lookup.uid,
          memberLabel: profile.label,
          type: "hours",
          reason: context.alertReason,
          label: HOURS_ALERT_LABELS[context.alertReason],
          status: "open",
          createdAt: now,
        });
      }
      result = {
        status: "checked_in",
        visitId: visitRef.id,
        firstName: profile.first,
        memberLabel: profile.label,
        checkInAt: now,
        planName: context.planName,
        remainingMonthlyMinutes: context.allowance.remainingMonthlyMinutes,
        bookedWindow: context.allowance.bookedWindow,
      };
    }
    tx.set(requestRef, { kind: "check_in", kioskUid: input.kioskUid, result, createdAt: now });
    return result;
  });
  if (result.status === "checked_in" && typeof result.visitId === "string") {
    await afterCheckIn({ uid: lookup.uid, visitId: result.visitId, checkInAt: Number(result.checkInAt) });
  }
  return result;
}

export async function performCheckOut(input: { kioskUid: string; lookupId: unknown; requestId: unknown; now?: number }) {
  if (!validRequestId(input.requestId)) throw new HttpsError("invalid-argument", "Please start again.");
  const now = input.now ?? Date.now();
  const requestRef = db().collection(COL.requests).doc(`${input.kioskUid}_${input.requestId}`);
  const stored = await readStoredRequest(requestRef);
  if (stored) return stored;

  const lookup = await readLookup(input.lookupId, input.kioskUid, now);
  const openRef = db().collection(COL.open).doc(lookup.uid);

  return db().runTransaction(async (tx) => {
    const [requestSnap, openSnap] = await Promise.all([tx.get(requestRef), tx.get(openRef)]);
    if (requestSnap.exists) return requestSnap.data()?.result as Record<string, unknown>;

    let result: Record<string, unknown>;
    const visitId = openSnap.exists ? String(openSnap.data()?.visitId || "") : "";
    const visitRef = visitId ? db().collection(COL.visits).doc(visitId) : null;
    const visitSnap = visitRef ? await tx.get(visitRef) : null;
    if (!visitRef || !visitSnap?.exists || visitSnap.data()?.status !== "open") {
      result = { status: "not_checked_in", firstName: lookup.first, memberLabel: lookup.label };
      if (openSnap.exists) tx.delete(openRef);
    } else {
      const visit = visitSnap.data() || {};
      const overage = computeOverage({ checkInAt: Number(visit.checkInAt), checkOutAt: now, allowanceMinutes: Number(visit.allowanceMinutes || 0) });
      tx.update(visitRef, {
        status: "closed",
        checkOutAt: now,
        checkOutKioskUid: input.kioskUid,
        actualMinutes: overage.actualMinutes,
        rawOverageMinutes: overage.rawOverageMinutes,
        overageMinutes: overage.overageMinutes,
        includedMinutesApplied: visit.allowanceSource === "monthly" ? overage.includedMinutesApplied : 0,
        updatedAt: now,
      });
      tx.delete(openRef);
      result = {
        status: "checked_out",
        visitId,
        firstName: lookup.first,
        memberLabel: lookup.label,
        checkInAt: Number(visit.checkInAt),
        checkOutAt: now,
        actualMinutes: overage.actualMinutes,
        allowanceSource: visit.allowanceSource,
        allowanceMinutes: Number(visit.allowanceMinutes || 0),
        overageMinutes: overage.overageMinutes,
      };
    }
    tx.set(requestRef, { kind: "check_out", kioskUid: input.kioskUid, result, createdAt: now });
    return result;
  });
}

export const kiosk_checkIn = onCall(adminEventCallableOptions, async (request) => {
  const { kioskUid } = await requireKiosk(request);
  const data = (request.data || {}) as { lookupId?: unknown; requestId?: unknown };
  return performCheckIn({ kioskUid, lookupId: data.lookupId, requestId: data.requestId });
});

export const kiosk_checkOut = onCall(adminEventCallableOptions, async (request) => {
  const { kioskUid } = await requireKiosk(request);
  const data = (request.data || {}) as { lookupId?: unknown; requestId?: unknown };
  return performCheckOut({ kioskUid, lookupId: data.lookupId, requestId: data.requestId });
});

// ------------------------------------------------- deferred tasks ----
//
// No polling and no Cloud Scheduler job. Each confirmed seat booking gets two
// one-time Cloud Tasks (late check at start + 15 min, no-show check at end),
// and each check-in gets one task at that day's closing time to close a
// forgotten check-out. All tasks run kioskFrontDeskTask, which re-reads
// current state and no-ops when nothing is due.

let taskQueueFactory: () => TaskQueueLike = frontDeskTaskQueue;

/** Tests swap the queue for a mock. Pass null to restore Cloud Tasks. */
export function setFrontDeskTaskQueueForTests(factory: (() => TaskQueueLike) | null) {
  taskQueueFactory = factory ?? frontDeskTaskQueue;
}

async function closingAtFor(dayKey: string): Promise<number> {
  let closing = closingTimeFromIntervals([]);
  try {
    closing = closingTimeFromIntervals((await getResolvedBookingDay(dayKey)).intervals);
  } catch (error) {
    logger.warn("kiosk: operating calendar unavailable, using default close", { dayKey, error: String(error) });
  }
  return easternEpoch(dayKey, closing);
}

async function autoCloseTaskFor(input: { uid: string; visitId: string; dayKey: string; checkInAt: number }): Promise<PlannedTask> {
  const plan = autoClosePlan({
    checkInAt: input.checkInAt,
    closingAt: await closingAtFor(input.dayKey),
    dayEnd: easternDayBounds(input.dayKey).end,
  });
  return {
    id: autoCloseTaskId(input.visitId, plan.dueAt),
    scheduleAt: plan.dueAt,
    payload: { kind: "auto_close", uid: input.uid, visitId: input.visitId, dueAt: plan.dueAt },
  };
}

const FOLLOW_UP_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Best effort after a check-in: never fails the check-in itself. */
async function afterCheckIn(input: { uid: string; visitId: string; checkInAt: number }) {
  const dayKey = easternDayKey(input.checkInAt);
  const work: Array<Promise<unknown>> = [
    autoCloseTaskFor({ ...input, dayKey }).then((task) => enqueueFrontDeskTasks(taskQueueFactory(), [task])),
    // A member flagged late who now arrives is shown as "arrived late".
    db().collection(COL.flags).where("uid", "==", input.uid).where("dayKey", "==", dayKey).where("status", "==", "late").get()
      .then((snap) => Promise.all(snap.docs
        .filter((doc) => visitOverlapsBooking({ checkInAt: input.checkInAt, checkOutAt: null }, { start: Number(doc.data().start), end: Number(doc.data().end) }))
        .map((doc) => doc.ref.set({ status: "arrived_late", updatedAt: input.checkInAt }, { merge: true })))),
  ];
  // Bounded: a slow Cloud Tasks call must not hold the kiosk screen. A missed
  // close task is covered by the stale-visit close at the next check-in.
  const results = await Promise.allSettled(work.map((p) => withTimeout(p, FOLLOW_UP_TIMEOUT_MS)));
  for (const r of results) {
    if (r.status === "rejected") logger.error("kiosk check-in follow-up failed", { visitId: input.visitId, error: String(r.reason) });
  }
}

/** Late / no-show task. Idempotent: the flag doc is keyed by booking. */
export async function runAttendanceTask(task: AttendanceTaskPayload, now = Date.now()) {
  const bookingSnap = await db().collection("bookings").doc(task.bookingId).get();
  const booking = bookingSnap.exists ? trackableBooking(bookingSnap.id, bookingSnap.data()) : null;
  const dayKey = easternDayKey(task.start);
  let hasVisit = false;
  if (booking) {
    const visits = await db().collection(COL.visits).where("uid", "==", task.uid).where("dayKey", "==", dayKey).get();
    hasVisit = visits.docs.some((doc) => visitOverlapsBooking(doc.data(), booking));
  }
  const ref = db().collection(COL.flags).doc(task.bookingId);
  const profile = booking ? await memberProfile(task.uid) : null;
  const decision = await db().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const current = existing.data()?.status;
    const result = decideAttendanceTask({ task, booking, hasVisit, currentFlag: current, now });
    if (result.action === "flag") {
      tx.set(ref, {
        bookingId: task.bookingId,
        uid: task.uid,
        memberLabel: profile?.label || "Member",
        dayKey,
        start: task.start,
        end: task.end,
        status: result.status,
        flaggedAt: existing.data()?.flaggedAt || now,
        updatedAt: now,
      }, { merge: true });
    } else if (result.action === "arrived_late") {
      tx.set(ref, { status: "arrived_late", updatedAt: now }, { merge: true });
    }
    return result;
  });
  if (decision.action === "relay") {
    await enqueueFrontDeskTasks(taskQueueFactory(), [attendanceTaskPlan(task, now)]);
    return decision;
  }
  // Cloud Tasks never delivers early; this only covers clock skew. Throwing
  // makes Cloud Tasks retry after the backoff.
  if (decision.action === "noop" && decision.reason === "too_early") {
    throw new Error(`kiosk ${task.kind} task for ${task.bookingId} arrived before it was due`);
  }
  return decision;
}

/** Forgotten check-out task. No-ops once the visit is closed. */
export async function runAutoCloseTask(task: AutoCloseTaskPayload, now = Date.now()) {
  const openRef = db().collection(COL.open).doc(task.uid);
  const visitRef = db().collection(COL.visits).doc(task.visitId);
  const [openSnap, visitSnap] = await Promise.all([openRef.get(), visitRef.get()]);
  const visit = visitSnap.data() || {};
  const checkInAt = Number(visit.checkInAt);
  // A deleted or malformed visit has nothing to close.
  const usable = visitSnap.exists && Number.isFinite(checkInAt);
  const dayKey = usable ? String(visit.dayKey || easternDayKey(checkInAt)) : "";
  const decision = decideAutoClose({
    task,
    openVisitId: openSnap.exists ? String(openSnap.data()?.visitId || "") || null : null,
    visitStatus: usable ? visit.status : null,
    checkInAt,
    closingAt: usable ? await closingAtFor(dayKey) : 0,
    dayEnd: usable ? easternDayBounds(dayKey).end : 0,
    now,
  });
  if (decision.action === "reschedule") {
    // Delivered before it was due (clock skew): throw so Cloud Tasks retries.
    if (decision.dueAt <= task.dueAt) {
      throw new Error(`kiosk auto_close task for ${task.visitId} arrived before it was due`);
    }
    // Closing time moved later after check-in: queue the new time instead.
    const next = await autoCloseTaskFor({ uid: task.uid, visitId: task.visitId, dayKey, checkInAt });
    await enqueueFrontDeskTasks(taskQueueFactory(), [next]);
    return decision;
  }
  if (decision.action !== "close") return decision;
  const closed = await db().runTransaction(async (tx) => {
    const [freshOpen, freshVisit] = await Promise.all([tx.get(openRef), tx.get(visitRef)]);
    if (!freshOpen.exists || freshOpen.data()?.visitId !== task.visitId) return false;
    if (!freshVisit.exists || freshVisit.data()?.status !== "open") return false;
    tx.delete(openRef);
    tx.update(visitRef, {
      status: "auto_closed",
      checkOutAt: decision.checkOutAt,
      autoClosedAt: now,
      needsReview: true,
      reviewReason: "forgot_checkout",
      // No assumed overage: staff confirm the real time on review.
      actualMinutes: null,
      rawOverageMinutes: null,
      overageMinutes: null,
      updatedAt: now,
    });
    return true;
  });
  return closed ? decision : { action: "noop" as const, reason: "not_open" as const };
}

/** Entry point for every front-desk task. Bad payloads are dropped, not retried. */
export async function runFrontDeskTask(data: unknown, now = Date.now()) {
  const task = parseFrontDeskTask(data);
  if (!task) {
    logger.warn("kioskFrontDeskTask: ignoring malformed task");
    return { action: "noop" as const, reason: "malformed" as const };
  }
  return task.kind === "auto_close" ? runAutoCloseTask(task, now) : runAttendanceTask(task, now);
}

/**
 * Enqueues the late and no-show tasks for a booking write. Exported for
 * tests. Returns the planned task IDs.
 */
export async function enqueueBookingTasks(input: { bookingId: string; before: unknown; after: unknown; now?: number }) {
  const tasks = planAttendanceTasks({
    bookingId: input.bookingId,
    before: input.before as Record<string, unknown> | undefined,
    after: input.after as Record<string, unknown> | undefined,
    now: input.now ?? Date.now(),
  });
  if (!tasks.length) return { enqueued: [], duplicates: [] };
  return enqueueFrontDeskTasks(taskQueueFactory(), tasks);
}

/** Give up retrying a booking event after this long (retries run up to 7 days). */
const BOOKING_EVENT_MAX_AGE_MS = 6 * 60 * MINUTE_MS;

/**
 * One trigger on every booking write, so the seven booking write paths need
 * no changes. Re-enqueues only when the start, end, member or confirmed seat
 * status changed; cancelled or moved bookings leave their old tasks to no-op.
 * No automatic retry: Firebase only enables a failure policy with --force, which we never use.
 * A failed enqueue is logged; the booking simply gets no late or no-show flag.
 */
export const kiosk_onBookingWritten = onDocumentWritten(
  { document: "bookings/{bookingId}" },
  async (event) => {
    const age = Date.now() - Date.parse(event.time);
    if (Number.isFinite(age) && age > BOOKING_EVENT_MAX_AGE_MS) {
      logger.error("kiosk_onBookingWritten: giving up on an old event", { bookingId: event.params.bookingId });
      return;
    }
    const result = await enqueueBookingTasks({
      bookingId: event.params.bookingId,
      before: event.data?.before?.data(),
      after: event.data?.after?.data(),
    });
    if (result.enqueued.length || result.duplicates.length) {
      logger.info("kiosk_onBookingWritten", { bookingId: event.params.bookingId, ...result });
    }
  },
);

/** The only task queue: one-time tasks, retried with backoff. */
export const kioskFrontDeskTask = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 30, maxBackoffSeconds: 600, maxDoublings: 4 },
    rateLimits: { maxConcurrentDispatches: 5 },
    timeoutSeconds: 60,
  },
  async (request) => {
    const result = await runFrontDeskTask(request.data);
    logger.info("kioskFrontDeskTask", { result });
  },
);

// ------------------------------------------------------- staff/admin ----

export const admin_kioskOverview = onCall(adminEventCallableOptions, async (request) => {
  requireStaff(request);
  const today = easternDayKey(Date.now());
  const isAdmin = ["admin", "master"].includes(roleOf(request.auth));
  const [openSnap, reviewSnap, alertSnap, flagSnap, todaySnap, settings, deviceSnap] = await Promise.all([
    db().collection(COL.visits).where("status", "==", "open").get(),
    db().collection(COL.visits).where("needsReview", "==", true).get(),
    db().collection(COL.alerts).where("status", "==", "open").get(),
    db().collection(COL.flags).where("dayKey", "==", today).get(),
    db().collection(COL.visits).where("dayKey", "==", today).get(),
    loadSettings(),
    isAdmin ? db().collection(COL.devices).get() : Promise.resolve(null),
  ]);
  const byCheckIn = (a: { checkInAt: number }, b: { checkInAt: number }) => b.checkInAt - a.checkInAt;
  return {
    today,
    openVisits: openSnap.docs.map((d) => visitSummary(d.data())).sort(byCheckIn),
    needsReview: reviewSnap.docs.map((d) => visitSummary(d.data())).sort(byCheckIn),
    todayVisits: todaySnap.docs.map((d) => visitSummary(d.data())).sort(byCheckIn),
    alerts: alertSnap.docs.map((d) => {
      const a = d.data();
      return { alertId: d.id, visitId: a.visitId, uid: a.uid, memberLabel: a.memberLabel, reason: a.reason, label: a.label, createdAt: a.createdAt };
    }).sort((a, b) => Number(b.createdAt) - Number(a.createdAt)),
    flags: flagSnap.docs.map((d) => {
      const f = d.data();
      return { bookingId: d.id, uid: f.uid, memberLabel: f.memberLabel, status: f.status, start: f.start, end: f.end };
    }).sort((a, b) => Number(a.start) - Number(b.start)),
    settings,
    devices: deviceSnap
      ? deviceSnap.docs.map((d) => ({ uid: d.id, label: d.data().label || "", enabled: d.data().enabled === true }))
      : null,
  };
});

export const admin_kioskCloseVisit = onCall(adminEventCallableOptions, async (request) => {
  const staffUid = requireStaff(request);
  const data = (request.data || {}) as { visitId?: unknown; checkOutAt?: unknown; reason?: unknown };
  const reason = validateCloseReason(data.reason);
  if (!reason) throw new HttpsError("invalid-argument", "Add a reason (at least 3 characters).");
  if (typeof data.visitId !== "string" || !data.visitId) throw new HttpsError("invalid-argument", "Visit is required.");
  const checkOutAt = Number(data.checkOutAt);
  const now = Date.now();
  if (!Number.isFinite(checkOutAt) || checkOutAt > now + MINUTE_MS) {
    throw new HttpsError("invalid-argument", "Check-out time can't be in the future.");
  }
  const visitRef = db().collection(COL.visits).doc(data.visitId);
  const outcome = await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "Visit not found.");
    const visit = snap.data() || {};
    const fromStatus = String(visit.status);
    if (!(fromStatus === "open" || (fromStatus === "auto_closed" && visit.needsReview === true))) {
      throw new HttpsError("failed-precondition", "This visit is already closed.");
    }
    if (checkOutAt < Number(visit.checkInAt)) throw new HttpsError("invalid-argument", "Check-out must be after check-in.");
    if (checkOutAt - Number(visit.checkInAt) > 18 * 60 * MINUTE_MS) {
      throw new HttpsError("invalid-argument", "Check-out must be within 18 hours of check-in.");
    }
    const openRef = db().collection(COL.open).doc(String(visit.uid));
    const openSnap = await tx.get(openRef);
    const overage = computeOverage({ checkInAt: Number(visit.checkInAt), checkOutAt, allowanceMinutes: Number(visit.allowanceMinutes || 0) });
    tx.update(visitRef, {
      status: "staff_closed",
      checkOutAt,
      actualMinutes: overage.actualMinutes,
      rawOverageMinutes: overage.rawOverageMinutes,
      overageMinutes: overage.overageMinutes,
      includedMinutesApplied: visit.allowanceSource === "monthly" ? overage.includedMinutesApplied : 0,
      needsReview: false,
      closedBy: staffUid,
      closeReason: reason,
      closedAt: now,
      updatedAt: now,
    });
    if (openSnap.exists && openSnap.data()?.visitId === visitRef.id) tx.delete(openRef);
    return { uid: String(visit.uid), fromStatus, overageMinutes: overage.overageMinutes, actualMinutes: overage.actualMinutes };
  });
  const auditId = await writeAudit({
    action: "kiosk_visit_closed",
    memberUid: outcome.uid,
    adminUid: staffUid,
    details: { visitId: visitRef.id, reason, checkOutAt, fromStatus: outcome.fromStatus, overageMinutes: outcome.overageMinutes },
  });
  return { ok: true, auditId, overageMinutes: outcome.overageMinutes, actualMinutes: outcome.actualMinutes };
});

export const admin_kioskResolveAlert = onCall(adminEventCallableOptions, async (request) => {
  const staffUid = requireStaff(request);
  const data = (request.data || {}) as { alertId?: unknown; note?: unknown };
  if (typeof data.alertId !== "string" || !data.alertId) throw new HttpsError("invalid-argument", "Alert is required.");
  const note = typeof data.note === "string" ? data.note.trim().slice(0, 300) : "";
  const ref = db().collection(COL.alerts).doc(data.alertId);
  const uid = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Alert not found.");
    if (snap.data()?.status !== "open") return null;
    tx.update(ref, { status: "resolved", resolvedAt: Date.now(), resolvedBy: staffUid, note });
    return String(snap.data()?.uid || "");
  });
  if (uid) {
    await writeAudit({ action: "kiosk_alert_resolved", memberUid: uid, adminUid: staffUid, details: { alertId: ref.id, reason: note || "resolved" } });
  }
  return { ok: true };
});

export const admin_kioskSetSettings = onCall(adminEventCallableOptions, async (request) => {
  const adminUid = requireAdmin(request);
  const settings = validateKioskSettings(request.data);
  if (typeof settings === "string") throw new HttpsError("invalid-argument", settings);
  await db().collection(COL.settings).doc(SETTINGS_DOC).set({ ...settings, updatedAt: Date.now(), updatedBy: adminUid });
  return { ok: true, settings };
});

/**
 * Enrolls or revokes a kiosk device account. Enrolling adds `kiosk: true`
 * to the account's existing claims; revoking removes it and signs the device
 * out. Staff, admin and master accounts can never be kiosks.
 */
export const admin_kioskDeviceSet = onCall(adminEventCallableOptions, async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data || {}) as { uid?: unknown; action?: unknown; label?: unknown };
  if (typeof data.uid !== "string" || !data.uid) throw new HttpsError("invalid-argument", "Device account is required.");
  if (data.action !== "enroll" && data.action !== "revoke") throw new HttpsError("invalid-argument", "Choose enroll or revoke.");
  const label = typeof data.label === "string" && data.label.trim() ? data.label.trim().slice(0, 60) : "Front desk";
  let user: admin.auth.UserRecord;
  try {
    user = await admin.auth().getUser(data.uid);
  } catch {
    throw new HttpsError("not-found", "Device account not found.");
  }
  const claims = { ...(user.customClaims || {}) } as Record<string, unknown>;
  const now = Date.now();
  const deviceRef = db().collection(COL.devices).doc(user.uid);
  if (data.action === "enroll") {
    if (STAFF_ROLES.has(String(claims.role || ""))) {
      throw new HttpsError("failed-precondition", "Use a dedicated kiosk account, not a staff account.");
    }
    await admin.auth().setCustomUserClaims(user.uid, { ...claims, kiosk: true });
    await deviceRef.set({ uid: user.uid, label, enabled: true, enrolledAt: now, enrolledBy: adminUid }, { merge: true });
  } else {
    delete claims.kiosk;
    await admin.auth().setCustomUserClaims(user.uid, claims);
    await admin.auth().revokeRefreshTokens(user.uid);
    await deviceRef.set({ uid: user.uid, enabled: false, revokedAt: now, revokedBy: adminUid }, { merge: true });
  }
  await writeAudit({ action: `kiosk_device_${data.action}`, memberUid: user.uid, adminUid, details: { label } });
  return { ok: true };
});

// ------------------------------------------------------------ member ----

async function ensureMemberCode(uid: string): Promise<string> {
  const ref = db().collection(COL.codes).doc(uid);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.code) return String(existing.data()?.code);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateMemberCode();
    const indexRef = db().collection(COL.codeIndex).doc(code);
    const created = await db().runTransaction(async (tx) => {
      const [mine, taken] = await Promise.all([tx.get(ref), tx.get(indexRef)]);
      if (mine.exists && mine.data()?.code) return String(mine.data()?.code);
      if (taken.exists) return null;
      const now = Date.now();
      tx.set(indexRef, { uid, createdAt: now });
      tx.set(ref, { uid, code, createdAt: now });
      return code;
    });
    if (created) return created;
  }
  throw new HttpsError("unavailable", "Couldn't create a check-in code. Try again.");
}

export const members_kioskSummary = onCall(adminEventCallableOptions, async (request) => {
  const uid = requireMemberAccount(request);
  const monthKey = easternMonthKey(Date.now());
  const [code, visitSnap] = await Promise.all([
    ensureMemberCode(uid),
    db().collection(COL.visits).where("uid", "==", uid).get(),
  ]);
  const visits = visitSnap.docs
    .map((d) => d.data())
    .filter((v) => v.monthKey === monthKey)
    .sort((a, b) => Number(b.checkInAt) - Number(a.checkInAt))
    .map((v) => ({
      visitId: String(v.id),
      status: String(v.status),
      checkInAt: Number(v.checkInAt),
      checkOutAt: v.checkOutAt == null ? null : Number(v.checkOutAt),
      actualMinutes: v.actualMinutes ?? null,
      overageMinutes: v.overageMinutes ?? null,
      needsReview: v.needsReview === true,
    }));
  return {
    code,
    monthKey,
    visits,
    totalOverageMinutes: visits.reduce((sum, v) => sum + Number(v.overageMinutes || 0), 0),
  };
});
