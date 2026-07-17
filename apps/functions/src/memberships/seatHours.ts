import * as admin from "firebase-admin";
import { getTierById } from "../payments/stripeConfig";

export type BookableResourceType = "SEAT" | "MODE";

export interface MembershipPeriodDoc {
  id: string;
  uid: string;
  plan: string;
  stripeSubscriptionId?: string;
  periodStart: number;
  periodEnd: number;
  includedSeatMinutes: number;
  usedSeatMinutes: number;
  reservedSeatMinutes: number;
  overageSeatMinutes: number;
  createdAt: number;
  updatedAt: number;
}

export interface SeatBookingCharge {
  durationMinutes: number;
  includedSeatMinutesApplied: number;
  overageSeatMinutes: number;
  seatRateCents: number;
  roomOrModeRateCents: number;
  totalPriceCents: number;
  membershipPeriodId?: string;
  paymentStatus: "paid" | "pending";
}

interface CalculateSeatBookingChargeInput {
  uid: string;
  plan?: string;
  durationMinutes: number;
  resourceType: BookableResourceType;
  resourceRateHourlyCents: number;
  atMillis?: number;
}

function getDb() {
  return admin.firestore();
}

function getPeriodId(periodStart: number, periodEnd: number): string {
  return `period_${periodStart}_${periodEnd}`;
}

function getAvailableSeatMinutes(period: MembershipPeriodDoc): number {
  return Math.max(
    0,
    period.includedSeatMinutes - period.usedSeatMinutes - period.reservedSeatMinutes
  );
}

function calculateCents(minutes: number, hourlyRateCents: number): number {
  return Math.round((minutes / 60) * hourlyRateCents);
}

export async function upsertMembershipPeriod(input: {
  uid: string;
  plan: string;
  stripeSubscriptionId?: string;
  periodStart: number;
  periodEnd: number;
}): Promise<MembershipPeriodDoc> {
  const db = getDb();
  const tier = getTierById(input.plan);
  const includedSeatMinutes = (tier?.includedHoursPerMonth || 0) * 60;
  const id = getPeriodId(input.periodStart, input.periodEnd);
  const ref = db
    .collection("users")
    .doc(input.uid)
    .collection("membershipPeriods")
    .doc(id);
  const now = Date.now();

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as Partial<MembershipPeriodDoc>) : {};
    const doc: MembershipPeriodDoc = {
      id,
      uid: input.uid,
      plan: input.plan,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      includedSeatMinutes,
      usedSeatMinutes: existing.usedSeatMinutes || 0,
      reservedSeatMinutes: existing.reservedSeatMinutes || 0,
      overageSeatMinutes: existing.overageSeatMinutes || 0,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };

    if (input.stripeSubscriptionId !== undefined) {
      doc.stripeSubscriptionId = input.stripeSubscriptionId;
    }

    tx.set(ref, doc, { merge: true });
    return doc;
  });
}

export async function getActiveMembershipPeriod(
  uid: string,
  atMillis = Date.now()
): Promise<MembershipPeriodDoc | null> {
  if (!uid) return null;

  const userRef = getDb().collection("users").doc(uid);
  const userSnap = await userRef.get();
  const user = userSnap.data();
  if (
    !user ||
    user.membershipStatus !== "active" ||
    typeof user.billingPeriodStart !== "number" ||
    typeof user.billingPeriodEnd !== "number" ||
    atMillis < user.billingPeriodStart ||
    atMillis >= user.billingPeriodEnd
  ) {
    return null;
  }

  const periodId = getPeriodId(user.billingPeriodStart, user.billingPeriodEnd);
  const periodSnap = await userRef.collection("membershipPeriods").doc(periodId).get();
  return periodSnap.exists ? (periodSnap.data() as MembershipPeriodDoc) : null;
}

export async function calculateSeatBookingCharge(
  input: CalculateSeatBookingChargeInput
): Promise<SeatBookingCharge> {
  const period = await getActiveMembershipPeriod(input.uid, input.atMillis);
  return calculateChargeFromPeriod(input, period);
}

export async function calculateSeatBookingChargeInTransaction(
  tx: admin.firestore.Transaction,
  input: CalculateSeatBookingChargeInput
): Promise<SeatBookingCharge> {
  const userRef = getDb().collection("users").doc(input.uid);
  const userSnap = await tx.get(userRef);
  const user = userSnap.data();
  let period: MembershipPeriodDoc | null = null;
  const atMillis = input.atMillis || Date.now();

  if (
    user?.membershipStatus === "active" &&
    typeof user.billingPeriodStart === "number" &&
    typeof user.billingPeriodEnd === "number" &&
    atMillis >= user.billingPeriodStart &&
    atMillis < user.billingPeriodEnd
  ) {
    const periodId = getPeriodId(user.billingPeriodStart, user.billingPeriodEnd);
    const periodSnap = await tx.get(userRef.collection("membershipPeriods").doc(periodId));
    if (periodSnap.exists) {
      period = periodSnap.data() as MembershipPeriodDoc;
    }
  }

  return calculateChargeFromPeriod(input, period);
}

function calculateChargeFromPeriod(
  input: CalculateSeatBookingChargeInput,
  period: MembershipPeriodDoc | null
): SeatBookingCharge {
  const durationMinutes = Math.max(0, Math.ceil(input.durationMinutes));

  if (input.resourceType === "MODE") {
    const totalPriceCents = calculateCents(durationMinutes, input.resourceRateHourlyCents);
    return {
      durationMinutes,
      includedSeatMinutesApplied: 0,
      overageSeatMinutes: 0,
      seatRateCents: 0,
      roomOrModeRateCents: input.resourceRateHourlyCents,
      totalPriceCents,
      paymentStatus: totalPriceCents > 0 ? "pending" : "paid",
    };
  }

  const tier = input.plan ? getTierById(input.plan) : undefined;
  const seatRateCents = tier ? tier.extraHourlyRateCents : input.resourceRateHourlyCents;
  const availableSeatMinutes = period ? getAvailableSeatMinutes(period) : 0;
  const includedSeatMinutesApplied = period
    ? Math.min(durationMinutes, availableSeatMinutes)
    : 0;
  const overageSeatMinutes = durationMinutes - includedSeatMinutesApplied;
  const totalPriceCents = calculateCents(overageSeatMinutes, seatRateCents);

  return {
    durationMinutes,
    includedSeatMinutesApplied,
    overageSeatMinutes,
    seatRateCents,
    roomOrModeRateCents: 0,
    totalPriceCents,
    membershipPeriodId: period?.id,
    paymentStatus: totalPriceCents > 0 ? "pending" : "paid",
  };
}

export function consumeSeatMinutesForConfirmedBooking(
  tx: admin.firestore.Transaction,
  uid: string,
  charge: SeatBookingCharge
): void {
  if (
    !charge.membershipPeriodId ||
    (charge.includedSeatMinutesApplied <= 0 && charge.overageSeatMinutes <= 0)
  ) {
    return;
  }

  const ref = getDb()
    .collection("users")
    .doc(uid)
    .collection("membershipPeriods")
    .doc(charge.membershipPeriodId);

  tx.update(ref, {
    usedSeatMinutes: admin.firestore.FieldValue.increment(charge.includedSeatMinutesApplied),
    overageSeatMinutes: admin.firestore.FieldValue.increment(charge.overageSeatMinutes),
    updatedAt: Date.now(),
  });
}

export function reserveSeatMinutesForBooking(
  tx: admin.firestore.Transaction,
  uid: string,
  membershipPeriodId: string | undefined,
  minutes: number
): void {
  if (!membershipPeriodId || minutes <= 0) return;
  tx.update(getDb().collection("users").doc(uid).collection("membershipPeriods").doc(membershipPeriodId), {
    reservedSeatMinutes: admin.firestore.FieldValue.increment(minutes),
    updatedAt: Date.now(),
  });
}

export function consumeReservedSeatMinutesForBooking(
  tx: admin.firestore.Transaction,
  uid: string,
  membershipPeriodId: string | undefined,
  minutes: number
): void {
  if (!membershipPeriodId || minutes <= 0) return;
  tx.update(getDb().collection("users").doc(uid).collection("membershipPeriods").doc(membershipPeriodId), {
    reservedSeatMinutes: admin.firestore.FieldValue.increment(-minutes),
    usedSeatMinutes: admin.firestore.FieldValue.increment(minutes),
    updatedAt: Date.now(),
  });
}

export function releaseReservedSeatMinutesForBooking(
  tx: admin.firestore.Transaction,
  uid: string,
  membershipPeriodId: string | undefined,
  minutes: number
): void {
  if (!membershipPeriodId || minutes <= 0) return;
  tx.update(getDb().collection("users").doc(uid).collection("membershipPeriods").doc(membershipPeriodId), {
    reservedSeatMinutes: admin.firestore.FieldValue.increment(-minutes),
    updatedAt: Date.now(),
  });
}
