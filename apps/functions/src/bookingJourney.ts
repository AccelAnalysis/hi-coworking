import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createPayment } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import { getTierById } from "./payments/stripeConfig";
import { createAccessGrant, seamApiKey } from "./access";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const HOLD_MS = 15 * 60 * 1000;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;
const INCREMENT_MS = 30 * 60 * 1000;
const LOCATION_TIME_ZONE = "America/New_York";

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
  expiresAt?: number;
};

type GuestDetails = { name?: string; email?: string; phone?: string };

type LocalClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function db() {
  return admin.firestore();
}

function localClock(timestamp: number): LocalClock {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function localDayKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function localMonthKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function validateWindow(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpsError("invalid-argument", "Choose a valid start and end time.");
  }
  if (start % INCREMENT_MS !== 0 || end % INCREMENT_MS !== 0) {
    throw new HttpsError("invalid-argument", "Bookings must use 30-minute increments.");
  }
  if (localDayKey(start) !== localDayKey(end - 1)) {
    throw new HttpsError("invalid-argument", "Bookings must start and end on the same day.");
  }
  const startClock = localClock(start);
  const endClock = localClock(end);
  const startMinutes = startClock.hour * 60 + startClock.minute;
  const endMinutes = endClock.hour * 60 + endClock.minute;
  if (startMinutes < OPEN_HOUR * 60 || endMinutes > CLOSE_HOUR * 60) {
    throw new HttpsError("failed-precondition", "That time is outside current operating hours.");
  }
  if (start < Date.now() - 60_000) {
    throw new HttpsError("failed-precondition", "That time has already passed.");
  }
}

function resourceConflicts(resourceId: string, start: number, end: number, busy: BusyRecord[]) {
  const target = RESOURCE_CONFIG[resourceId];
  if (!target) return true;
  return busy.some((record) => {
    if (!overlaps(start, end, record.start, record.end)) return false;
    if (record.status === "CANCELLED" || record.status === "EXPIRED") return false;
    if (record.resourceId === resourceId) return true;
    const other = RESOURCE_CONFIG[record.resourceId];
    if (!other || other.exclusiveGroupId !== target.exclusiveGroupId) return false;
    return target.type === "MODE" || other.type === "MODE";
  });
}

function busyFromSnapshots(
  bookingSnap: FirebaseFirestore.QuerySnapshot,
  holdSnap: FirebaseFirestore.QuerySnapshot,
  end: number,
  excludeHoldId?: string,
) {
  const now = Date.now();
  const bookings = bookingSnap.docs
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => item.start < end && item.status !== "CANCELLED");
  const holds = holdSnap.docs
    .filter((doc) => doc.id !== excludeHoldId)
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => item.start < end && (item.expiresAt || 0) > now && item.status !== "EXPIRED" && item.status !== "CONSUMED");
  return [...bookings, ...holds];
}

async function getBusy(start: number, end: number, excludeHoldId?: string) {
  const [bookingSnap, holdSnap] = await Promise.all([
    db().collection("bookings").where("end", ">", start).get(),
    db().collection("bookingHolds").where("end", ">", start).get(),
  ]);
  return busyFromSnapshots(bookingSnap, holdSnap, end, excludeHoldId);
}

async function createHoldAtomically(
  holdRef: FirebaseFirestore.DocumentReference,
  hold: Record<string, unknown>,
  resourceId: string,
  start: number,
  end: number,
) {
  await db().runTransaction(async (tx) => {
    const bookingQuery = db().collection("bookings").where("end", ">", start);
    const holdQuery = db().collection("bookingHolds").where("end", ">", start);
    const [bookingSnap, holdSnap] = await Promise.all([tx.get(bookingQuery), tx.get(holdQuery)]);
    const busy = busyFromSnapshots(bookingSnap, holdSnap, end);
    if (resourceConflicts(resourceId, start, end, busy)) {
      throw new HttpsError("failed-precondition", "That option was just booked. Choose another available space.");
    }
    tx.set(holdRef, hold);
  });
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
        const targetMonth = localMonthKey(start);
        const usedSnap = await db().collection("bookings").where("userId", "==", uid).get();
        const usedHours = usedSnap.docs.reduce((sum, doc) => {
          const booking = doc.data();
          if (booking.status === "CANCELLED" || localMonthKey(booking.start) !== targetMonth) return sum;
          if (RESOURCE_CONFIG[booking.resourceId]?.type !== "SEAT") return sum;
          return sum + Math.max(0, (booking.end - booking.start) / 3_600_000);
        }, 0);
        includedHoursRemaining = Math.max(0, tier.includedHoursPerMonth - usedHours);
        includedHoursApplied = Math.min(durationHours, includedHoursRemaining);
        billableHours = Math.max(0, durationHours - includedHoursApplied);
      }
    }
  }

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
    totalCents: Math.round(billableHours * hourlyRateCents),
    currency: "usd",
  };
}

async function ensureGuestAccount(guest?: GuestDetails) {
  const email = guest?.email?.trim().toLowerCase();
  if (!email) throw new HttpsError("failed-precondition", "Guest email is missing.");
  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error: any) {
    if (error?.code !== "auth/user-not-found") throw error;
    userRecord = await admin.auth().createUser({
      email,
      displayName: guest?.name?.trim() || undefined,
      emailVerified: false,
    });
  }
  const userRef = db().collection("users").doc(userRecord.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    await userRef.set({
      uid: userRecord.uid,
      email,
      displayName: guest?.name?.trim() || "",
      role: "member",
      membershipStatus: "none",
      createdAt: Date.now(),
    });
  }
  return userRecord.uid;
}

async function issueAccessSafely(bookingId: string, resourceId: string, userId: string, start: number, end: number) {
  try {
    await createAccessGrant(bookingId, resourceId, userId, start, end);
  } catch (error) {
    logger.error("Access grant failed after booking confirmation", {
      bookingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const booking_getAvailability = onCall(async (request) => {
  const { start, end } = request.data as { start: number; end: number };
  validateWindow(start, end);
  const busy = await getBusy(start, end);
  return {
    start,
    end,
    operatingHours: { openHour: OPEN_HOUR, closeHour: CLOSE_HOUR, timeZone: LOCATION_TIME_ZONE },
    options: Object.entries(RESOURCE_CONFIG).map(([resourceId, resource]) => ({
      resourceId,
      name: resource.name,
      type: resource.type,
      available: !resourceConflicts(resourceId, start, end, busy),
    })),
  };
});

export const booking_createQuote = onCall(async (request) => {
  const { resourceId, start, end } = request.data as { resourceId: string; start: number; end: number };
  const busy = await getBusy(start, end);
  if (resourceConflicts(resourceId, start, end, busy)) {
    throw new HttpsError("failed-precondition", "That option is no longer available.");
  }
  return quoteFor(resourceId, start, end, request.auth?.uid);
});

export const booking_beginCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    const { resourceId, start, end, successUrl, cancelUrl, guest } = request.data as {
      resourceId: string;
      start: number;
      end: number;
      successUrl: string;
      cancelUrl: string;
      guest?: GuestDetails;
    };
    if (!resourceId || !successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "Space and return URLs are required.");
    }
    if (!request.auth && (!guest?.name?.trim() || !guest?.email?.trim())) {
      throw new HttpsError("invalid-argument", "Name and email are required for guest checkout.");
    }

    validateWindow(start, end);
    const quote = await quoteFor(resourceId, start, end, request.auth?.uid);
    const holdRef = db().collection("bookingHolds").doc();
    const holdSecret = randomBytes(24).toString("hex");
    const now = Date.now();
    const userId = request.auth?.uid || `guest:${holdRef.id}`;
    const hold = {
      id: holdRef.id,
      resourceId,
      resourceName: quote.resourceName,
      start,
      end,
      userId,
      guest: request.auth ? null : {
        name: guest?.name?.trim(),
        email: guest?.email?.trim().toLowerCase(),
        phone: guest?.phone?.trim() || "",
      },
      quote,
      status: "HELD",
      secretHash: createHash("sha256").update(holdSecret).digest("hex"),
      createdAt: now,
      expiresAt: now + HOLD_MS,
    };

    await createHoldAtomically(holdRef, hold, resourceId, start, end);

    if (quote.totalCents === 0 && request.auth) {
      const bookingRef = db().collection("bookings").doc();
      await db().runTransaction(async (tx) => {
        const latest = await tx.get(holdRef);
        if (!latest.exists || latest.data()?.expiresAt <= Date.now()) {
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
        tx.update(holdRef, { status: "CONSUMED", consumedAt: Date.now(), bookingId: bookingRef.id });
      });
      await issueAccessSafely(bookingRef.id, resourceId, request.auth.uid, start, end);
      return { kind: "confirmed", bookingId: bookingRef.id, quote };
    }

    const payment = await createPayment({
      uid: userId,
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
      uid: userId,
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
        uid: userId,
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
  },
);

export const booking_finalizeCheckout = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    const { holdId, holdSecret } = request.data as { holdId: string; holdSecret?: string };
    if (!holdId) throw new HttpsError("invalid-argument", "holdId is required.");
    const holdRef = db().collection("bookingHolds").doc(holdId);
    const holdSnap = await holdRef.get();
    if (!holdSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
    const hold = holdSnap.data() as any;

    const authOwns = Boolean(request.auth && hold.userId === request.auth.uid);
    const secretMatches = Boolean(
      holdSecret && hold.secretHash === createHash("sha256").update(holdSecret).digest("hex"),
    );
    if (!authOwns && !secretMatches) {
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

    const finalUserId = request.auth?.uid || await ensureGuestAccount(hold.guest || undefined);
    const bookingRef = db().collection("bookings").doc();

    await db().runTransaction(async (tx) => {
      const latestHold = await tx.get(holdRef);
      if (!latestHold.exists) throw new HttpsError("not-found", "Booking hold not found.");
      if (latestHold.data()?.status === "CONSUMED") return;

      const bookingQuery = db().collection("bookings").where("end", ">", hold.start);
      const holdQuery = db().collection("bookingHolds").where("end", ">", hold.start);
      const [bookingSnap, holdRangeSnap] = await Promise.all([tx.get(bookingQuery), tx.get(holdQuery)]);
      const busy = busyFromSnapshots(bookingSnap, holdRangeSnap, hold.end, holdId);
      if (resourceConflicts(hold.resourceId, hold.start, hold.end, busy)) {
        logger.error("Paid hold encountered conflict during finalization", { holdId, paymentId: hold.paymentId });
        throw new HttpsError("aborted", "We received payment but the held space cannot be finalized automatically. Staff has been alerted.");
      }

      tx.set(bookingRef, {
        id: bookingRef.id,
        resourceId: hold.resourceId,
        resourceName: hold.resourceName,
        userId: finalUserId,
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
      tx.update(holdRef, {
        status: "CONSUMED",
        consumedAt: Date.now(),
        bookingId: bookingRef.id,
        userId: finalUserId,
      });
    });

    await issueAccessSafely(bookingRef.id, hold.resourceId, finalUserId, hold.start, hold.end);
    return { success: true, bookingId: bookingRef.id };
  },
);
