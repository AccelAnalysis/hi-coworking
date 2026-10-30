import { randomUUID } from "node:crypto";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
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
  attendanceFlag,
  bookingMinutesUsedByVisit,
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
  type KioskBooking,
} from "./policy";

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

  return db().runTransaction(async (tx) => {
    const [requestSnap, openSnap] = await Promise.all([tx.get(requestRef), tx.get(openRef)]);
    if (requestSnap.exists) return requestSnap.data()?.result as Record<string, unknown>;

    let result: Record<string, unknown>;
    if (openSnap.exists) {
      result = {
        status: "already_checked_in",
        firstName: profile.first,
        memberLabel: profile.label,
        checkInAt: Number(openSnap.data()?.checkInAt),
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

// ------------------------------------------------------------- sweep ----

async function closingAtFor(dayKey: string, cache: Map<string, number>): Promise<number> {
  const cached = cache.get(dayKey);
  if (cached !== undefined) return cached;
  let closing = closingTimeFromIntervals([]);
  try {
    closing = closingTimeFromIntervals((await getResolvedBookingDay(dayKey)).intervals);
  } catch (error) {
    logger.warn("kiosk sweep: operating calendar unavailable, using default close", { dayKey, error: String(error) });
  }
  const value = easternEpoch(dayKey, closing);
  cache.set(dayKey, value);
  return value;
}

/**
 * Auto-closes forgotten check-outs and sets late / no-show flags.
 * Exported for tests; kiosk_attendanceSweep runs it on a schedule.
 */
export async function runAttendanceSweep(now = Date.now()) {
  const today = easternDayKey(now);
  const closingCache = new Map<string, number>();
  let autoClosed = 0;

  const openSnap = await db().collection(COL.open).get();
  for (const openDoc of openSnap.docs) {
    const open = openDoc.data();
    const visitRef = db().collection(COL.visits).doc(String(open.visitId || ""));
    const dayKey = String(open.dayKey || easternDayKey(Number(open.checkInAt)));
    const plan = autoClosePlan({
      checkInAt: Number(open.checkInAt),
      closingAt: await closingAtFor(dayKey, closingCache),
      dayEnd: easternDayBounds(dayKey).end,
    });
    if (now < plan.dueAt) continue;
    const closed = await db().runTransaction(async (tx) => {
      const [freshOpen, visitSnap] = await Promise.all([tx.get(openDoc.ref), tx.get(visitRef)]);
      if (!freshOpen.exists || freshOpen.data()?.visitId !== open.visitId) return false;
      tx.delete(openDoc.ref);
      if (!visitSnap.exists || visitSnap.data()?.status !== "open") return false;
      tx.update(visitRef, {
        status: "auto_closed",
        checkOutAt: plan.checkOutAt,
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
    if (closed) autoClosed += 1;
  }

  const { start, end } = easternDayBounds(today);
  const [bookingSnap, visitSnap] = await Promise.all([
    db().collection("bookings").where("start", ">=", start).where("start", "<", end).get(),
    db().collection(COL.visits).where("dayKey", "==", today).get(),
  ]);
  const visits = visitSnap.docs.map((doc) => doc.data());
  const bookings = seatBookingsForDay(
    bookingSnap.docs.map((doc) => {
      const b = doc.data();
      return { id: doc.id, start: Number(b.start), end: Number(b.end), status: b.status, resourceId: b.resourceId, userId: b.userId };
    }),
    today,
  );
  let flagged = 0;
  for (const booking of bookings) {
    if (!booking.userId) continue;
    const hasVisit = visits.some((v) => v.uid === booking.userId && visitOverlapsBooking(v, booking));
    const flag = attendanceFlag({ start: booking.start, end: booking.end, hasVisit, now });
    const ref = db().collection(COL.flags).doc(booking.id);
    const existing = await ref.get();
    const current = existing.data()?.status;
    if (flag && current !== flag) {
      const profile = await memberProfile(booking.userId);
      await ref.set({
        bookingId: booking.id,
        uid: booking.userId,
        memberLabel: profile?.label || "Member",
        dayKey: today,
        start: booking.start,
        end: booking.end,
        status: flag,
        flaggedAt: existing.data()?.flaggedAt || now,
        updatedAt: now,
      }, { merge: true });
      flagged += 1;
    } else if (!flag && hasVisit && current === "late") {
      await ref.set({ status: "arrived_late", updatedAt: now }, { merge: true });
    }
  }
  return { autoClosed, flagged, bookingsChecked: bookings.length };
}

/** One Cloud Scheduler job: every 15 minutes, 8 AM to 6:45 PM ET, Mon-Fri. */
export const kiosk_attendanceSweep = onSchedule(
  { schedule: "*/15 8-18 * * 1-5", timeZone: "America/New_York" },
  async () => {
    const summary = await runAttendanceSweep();
    logger.info("kiosk_attendanceSweep", summary);
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
