import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createPayment } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import { getTierById } from "./payments/stripeConfig";
import { createAccessGrant } from "./access";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const HOLD_MS = 15 * 60 * 1000;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;
const MIN_INCREMENT_MS = 30 * 60 * 1000;

const RESOURCE_CONFIG: Record<string, {
  name: string;
  type: "SEAT" | "MODE";
  guestRateHourlyCents: number;
  exclusiveGroupId: string;
}> = {
  "seat-1": { name: "Desk 1", type: "SEAT", guestRateHourlyCents: 1750, exclusiveGroupId: "main_space" },
  "seat-2": { name: "Desk 2", type: "SEAT", guestRateHourlyCents: 1750, exclusiveGroupId: "main_space" },
  "seat-3": { name: "Desk 3", type: "SEAT", guestRateHourlyCents: 1750, exclusiveGroupId: "main_space" },
  "seat-4": { name: "Desk 4", type: "SEAT", guestRateHourlyCents: 1750, exclusiveGroupId: "main_space" },
  "seat-5": { name: "Desk 5", type: "SEAT", guestRateHourlyCents: 1750, exclusiveGroupId: "main_space" },
  "seat-6": { name: "Desk 6", type: "SEAT", guestRateHourlyCents: 1750, exclusiveGroupId: "main_space" },
  "mode-conference": { name: "Meeting setup", type: "MODE", guestRateHourlyCents: 7500, exclusiveGroupId: "main_space" },
};

type BusyRecord = {
  resourceId: string;
  start: number;
  end: number;
  status?: string;
};

function db() {
  return admin.firestore();
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function validateWindow(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpsError("invalid-argument", "Choose a valid start and end time.");
  }
  if (start % MIN_INCREMENT_MS !== 0 || end % MIN_INCREMENT_MS !== 0) {
    throw new HttpsError("invalid-argument", "Bookings must use 30-minute increments.");
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (startDate.toDateString() !== endDate.toDateString()) {
    throw new HttpsError("invalid-argument", "Bookings must start and end on the same day.");
  }
  if (startDate.getHours() < OPEN_HOUR || endDate.getHours() > CLOSE_HOUR || (endDate.getHours() === CLOSE_HOUR && endDate.getMinutes() > 0)) {
    throw new HttpsError("failed-precondition", "That time is outside current operating hours.");
  }
  if (start < Date.now() - 60_000) {
    throw new HttpsError("failed-precondition", "That time has already passed.");
  }
}

function conflicts(targetResourceId: string, start: number, end: number, busy: BusyRecord[]) {
  const target = RESOURCE_CONFIG[targetResourceId];
  if (!target) return true;
  return busy.some((record) => {
    if (!overlaps(start, end, record.start, record.end)) return false;
    if (record.status === "CANCELLED" || record.status === "EXPIRED") return false;
    if (record.resourceId === targetResourceId) return true;
    const other = RESOURCE_CONFIG[record.resourceId];
    if (!other || other.exclusiveGroupId !== target.exclusiveGroupId) return false;
    return target.type === "MODE" || other.type === "MODE";
  });
}

async function getBusy(start: number, end: number, excludeHoldId?: string): Promise<BusyRecord[]> {
  const bookingSnap = await db().collection("bookings").where("end", ">", start).get();
  const holdSnap = await db().collection("bookingHolds").where("end", ">", start).get();
  const now = Date.now();
  const bookings = bookingSnap.docs
    .map((doc) => doc.data() as BusyRecord)
    .filter((b) => b.start < end && b.status !== "CANCELLED");
  const holds = holdSnap.docs
    .filter((doc) => doc.id !== excludeHoldId)
    .map((doc) => doc.data() as BusyRecord & { expiresAt?: number })
    .filter((h) => h.start < end && (h.expiresAt || 0) > now && h.status !== "EXPIRED");
  return [...bookings, ...holds];
}

function monthBounds(timestamp: number) {
  const d = new Date(timestamp);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
  };
}

async function quoteFor(resourceId: string, start: number, end: number, uid?: string) {
  const resource = RESOURCE_CONFIG[resourceId];
  if (!resource) throw new HttpsError("not-found", "Space not found.");
  validateWindow(start, end);

  const durationHours = (end - start) / 3_600_000;
  let includedHoursRemaining = 0;
  let includedHoursApplied = 0;
  let billableHours = durationHours;
  let hourlyRateCents = resource.guestRateHourlyCents;
  let membershipName: string | null = null;

  if (uid && resource.type === "SEAT") {
    const userSnap = await db().collection("users").doc(uid).get();
    const user = userSnap.data();
    if (user?.membershipStatus === "active" && user?.plan) {
      const tier = getTierById(user.plan);
      if (tier) {
        membershipName = tier.name;
        hourlyRateCents = tier.extraHourlyRateCents;
        const bounds = monthBounds(start);
        const usedSnap = await db().collection("bookings")
          .where("userId", "==", uid)
          .where("start", ">=", bounds.start)
          .where("start", "<", bounds.end)
          .get();
        const usedHours = usedSnap.docs.reduce((sum, doc) => {
          const booking = doc.data();
          if (booking.status === "CANCELLED") return sum;
          const bookedResource = RESOURCE_CONFIG[booking.resourceId];
          if (!bookedResource || bookedResource.type !== "SEAT") return sum;
          return sum + Math.max(0, (booking.end - booking.start) / 3_600_000);
        }, 0);
        includedHoursRemaining = Math.max(0, tier.includedHoursPerMonth - usedHours);
        includedHoursApplied = Math.min(durationHours, includedHoursRemaining);
        billableHours = Math.max(0, durationHours - includedHoursApplied);
      }
    }
  }

  const totalCents = Math.round(billableHours * hourlyRateCents);
  return {
    resourceId,
    resourceName: resource.name,
    resourceType: resource.type,
    start,
    end,
    durationHours,
    membershipName,
    includedHoursRemaining,
    includedHoursApplied,
    billableHours,
    hourlyRateCents,
    totalCents,
    currency: "usd",
  };
}

export const booking_getAvailability = onCall(async (request) => {
  const { start, end } = request.data as { start: number; end: number };
  validateWindow(start, end);
  const busy = await getBusy(start, end);
  return {
    start,
    end,
    operatingHours: { openHour: OPEN_HOUR, closeHour: CLOSE_HOUR },
    options: Object.entries(RESOURCE_CONFIG).map(([resourceId, resource]) => ({
      resourceId,
      name: resource.name,
      type: resource.type,
      available: !conflicts(resourceId, start, end, busy),
    })),
  };
});

export const booking_createQuote = onCall(async (request) => {
  const { resourceId, start, end } = request.data as { resourceId: string; start: number; end: number };
  const busy = await getBusy(start, end);
  if (conflicts(resourceId, start, end, busy)) {
    throw new HttpsError("failed-precondition", "That option is no longer available.");
  }
  return quoteFor(resourceId, start, end, request.auth?.uid);
});

export const booking_beginCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const { resourceId, start, end, successUrl, cancelUrl, guest } = request.data as {
      resourceId: string;
      start: number;
      end: number;
      successUrl: string;
      cancelUrl: string;
      guest?: { name?: string; email?: string; phone?: string };
    };
    if (!resourceId || !successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "Space and return URLs are required.");
    }
    if (!request.auth && (!guest?.name || !guest?.email)) {
      throw new HttpsError("invalid-argument", "Name and email are required for guest checkout.");
    }

    validateWindow(start, end);
    const busy = await getBusy(start, end);
    if (conflicts(resourceId, start, end, busy)) {
      throw new HttpsError("failed-precondition", "That option was just booked. Choose another available space.");
    }

    const quote = await quoteFor(resourceId, start, end, request.auth?.uid);
    const holdRef = db().collection("bookingHolds").doc();
    const holdSecret = randomBytes(24).toString("hex");
    const secretHash = createHash("sha256").update(holdSecret).digest("hex");
    const now = Date.now();
    const uid = request.auth?.uid || `guest:${holdRef.id}`;
    const hold = {
      id: holdRef.id,
      resourceId,
      resourceName: quote.resourceName,
      start,
      end,
      userId: uid,
      guest: request.auth ? null : { name: guest?.name, email: guest?.email, phone: guest?.phone || "" },
      quote,
      status: "HELD",
      secretHash,
      createdAt: now,
      expiresAt: now + HOLD_MS,
    };
    await holdRef.set(hold);

    if (quote.totalCents === 0 && request.auth) {
      const bookingRef = db().collection("bookings").doc();
      await db().runTransaction(async (tx) => {
        const holdSnap = await tx.get(holdRef);
        if (!holdSnap.exists || holdSnap.data()?.expiresAt <= Date.now()) {
          throw new HttpsError("deadline-exceeded", "Your hold expired. Please choose the space again.");
        }
        tx.set(bookingRef, {
          id: bookingRef.id,
          resourceId,
          resourceName: quote.resourceName,
          userId: request.auth!.uid,
          userName: request.auth!.token.name || request.auth!.token.email || "Member",
          start,
          end,
          status: "CONFIRMED",
          totalPrice: 0,
          totalCents: 0,
          paymentMethod: "MEMBERSHIP_HOURS",
          includedHoursApplied: quote.includedHoursApplied,
          createdAt: Date.now(),
        });
        tx.update(holdRef, { status: "CONSUMED", consumedAt: Date.now() });
      });
      await createAccessGrant(bookingRef.id, resourceId, request.auth.uid, start, end);
      return { kind: "confirmed", bookingId: bookingRef.id, quote };
    }

    const payment = await createPayment({
      uid,
      provider: "stripe",
      amount: quote.totalCents,
      currency: quote.currency,
      purpose: "booking",
      purposeRefId: holdRef.id,
      status: "pending",
      providerRefs: { holdId: holdRef.id },
    });

    await holdRef.update({ paymentId: payment.id });
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
      uid,
      amount: quote.totalCents,
      currency: quote.currency,
      purpose: "booking",
      purposeRefId: holdRef.id,
      successUrl,
      cancelUrl,
      mode: "payment",
      lineItemLabel: `${quote.resourceName} · ${quote.durationHours} hour${quote.durationHours === 1 ? "" : "s"}`,
      metadata: {
        paymentId: payment.id,
        holdId: holdRef.id,
        purpose: "booking",
        purposeRefId: holdRef.id,
        uid,
      },
    });

    return {
      kind: "checkout",
      holdId: holdRef.id,
      holdSecret,
      expiresAt: hold.expiresAt,
      paymentId: payment.id,
      checkoutUrl: session.url,
      quote,
    };
  }
);

export const booking_finalizeCheckout = onCall(async (request) => {
  const { holdId, holdSecret } = request.data as { holdId: string; holdSecret?: string };
  if (!holdId) throw new HttpsError("invalid-argument", "holdId is required.");
  const holdRef = db().collection("bookingHolds").doc(holdId);
  const holdSnap = await holdRef.get();
  if (!holdSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
  const hold = holdSnap.data() as any;

  const authOwnsHold = Boolean(request.auth && hold.userId === request.auth.uid);
  const secretMatches = Boolean(holdSecret && hold.secretHash === createHash("sha256").update(holdSecret).digest("hex"));
  if (!authOwnsHold && !secretMatches) {
    throw new HttpsError("permission-denied", "This booking hold does not belong to you.");
  }
  if (hold.status === "CONSUMED" && hold.bookingId) {
    return { success: true, bookingId: hold.bookingId, alreadyFinalized: true };
  }
  if (hold.expiresAt <= Date.now()) {
    await holdRef.update({ status: "EXPIRED", expiredAt: Date.now() });
    throw new HttpsError("deadline-exceeded", "Your booking hold expired before payment completed.");
  }
  if (!hold.paymentId) throw new HttpsError("failed-precondition", "No payment is associated with this hold.");
  const paymentSnap = await db().collection("payments").doc(hold.paymentId).get();
  if (!paymentSnap.exists || paymentSnap.data()?.status !== "paid") {
    throw new HttpsError("failed-precondition", "Payment has not been confirmed yet.");
  }

  const busy = await getBusy(hold.start, hold.end, holdId);
  if (conflicts(hold.resourceId, hold.start, hold.end, busy)) {
    logger.error("Paid hold encountered conflict during finalization", { holdId, paymentId: hold.paymentId });
    throw new HttpsError("aborted", "We received payment but the held space cannot be finalized automatically. Staff has been alerted.");
  }

  const bookingRef = db().collection("bookings").doc();
  await db().runTransaction(async (tx) => {
    const latestHold = await tx.get(holdRef);
    if (!latestHold.exists) throw new HttpsError("not-found", "Booking hold not found.");
    if (latestHold.data()?.status === "CONSUMED") return;
    tx.set(bookingRef, {
      id: bookingRef.id,
      resourceId: hold.resourceId,
      resourceName: hold.resourceName,
      userId: hold.userId,
      userName: hold.guest?.name || request.auth?.token.name || request.auth?.token.email || "Guest",
      guestEmail: hold.guest?.email || null,
      guestPhone: hold.guest?.phone || null,
      start: hold.start,
      end: hold.end,
      status: "CONFIRMED",
      totalPrice: (hold.quote?.totalCents || 0) / 100,
      totalCents: hold.quote?.totalCents || 0,
      paymentMethod: "STRIPE",
      paymentId: hold.paymentId,
      includedHoursApplied: hold.quote?.includedHoursApplied || 0,
      createdAt: Date.now(),
    });
    tx.update(holdRef, { status: "CONSUMED", consumedAt: Date.now(), bookingId: bookingRef.id });
  });

  try {
    await createAccessGrant(bookingRef.id, hold.resourceId, hold.userId, hold.start, hold.end);
  } catch (error) {
    logger.error("Access grant failed after paid booking confirmation", {
      bookingId: bookingRef.id,
      holdId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { success: true, bookingId: bookingRef.id };
});
