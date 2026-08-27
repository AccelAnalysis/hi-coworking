import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp as deleteAdminApp,
  getApps as getAdminApps,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  getFirestore as getAdminFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import {
  deleteApp,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  type Auth,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";

const PROJECT_ID = "demo-hi-coworking";
const REGION = "us-central1";
const AUTH_EMULATOR_URL = "http://127.0.0.1:9100";
const FUNCTIONS_EMULATOR_HOST = "127.0.0.1";
const FUNCTIONS_EMULATOR_PORT = 5004;
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8081";
const PASSWORD = "booking-test-password";
const FACILITY_TIME_ZONE = "America/New_York";

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9100";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

let adminApp: AdminApp;
let db: Firestore;
const clientApps: FirebaseApp[] = [];
let clientSequence = 0;

function facilityDateValue(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACILITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function facilityWallTimeToTimestamp(
  dateValue: string,
  timeValue: string,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    0,
    0,
  );
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: FACILITY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const observedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      0,
      0,
    );
    guess += targetAsUtc - observedAsUtc;
  }
  return guess;
}

function futureFacilityWindow(
  startTime = "09:00",
  durationHours = 2,
  daysAhead = 1,
) {
  const date = facilityDateValue(
    Date.now() + daysAhead * 24 * 60 * 60 * 1_000,
  );
  const start = facilityWallTimeToTimestamp(date, startTime);
  return {
    start,
    end: start + durationHours * 60 * 60 * 1_000,
  };
}

async function clearFirestore() {
  const response = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(
      `Could not clear Firestore emulator: ${response.status}`,
    );
  }
}

async function clearAuth() {
  const response = await fetch(
    `${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(
      `Could not clear Auth emulator: ${response.status}`,
    );
  }
}

function createClient(name: string) {
  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `${name}-${++clientSequence}`,
  );
  clientApps.push(app);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(
    functions,
    FUNCTIONS_EMULATOR_HOST,
    FUNCTIONS_EMULATOR_PORT,
  );
  return { app, functions };
}

async function createMember(
  uid: string,
  plan = "coworking",
) {
  const email = `${uid}@example.test`;
  await getAdminAuth(adminApp).createUser({
    uid,
    email,
    password: PASSWORD,
    emailVerified: true,
  });
  await db.collection("users").doc(uid).set({
    uid,
    email,
    displayName: "Booking Test Member",
    role: "member",
    membershipStatus: "active",
    plan,
    createdAt: Date.now(),
  });
  const { app, functions } = createClient(
    `booking-member-${uid}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(
    auth,
    AUTH_EMULATOR_URL,
    { disableWarnings: true },
  );
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  return {
    auth,
    functions,
  } satisfies {
    auth: Auth;
    functions: Functions;
  };
}

async function callFunction<Result>(
  functions: Functions,
  name: string,
  data: Record<string, unknown>,
) {
  return (
    await httpsCallable<Record<string, unknown>, Result>(
      functions,
      name,
    )(data)
  ).data;
}

beforeAll(() => {
  adminApp = getAdminApps().find(
    (app) => app.name === "booking-journey-tests",
  ) ?? initializeAdminApp(
    { projectId: PROJECT_ID },
    "booking-journey-tests",
  );
  db = getAdminFirestore(adminApp);
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
});

afterAll(async () => {
  await Promise.all(
    clientApps.map((app) => deleteApp(app)),
  );
  await deleteAdminApp(adminApp);
});

describe("booking journey", () => {
  it("shows only options that are available for the full requested stay", async () => {
    const { functions } = createClient(
      "booking-public-availability",
    );
    const { start, end } = futureFacilityWindow("09:00", 2);
    await db.collection("bookings").doc(
      "existing-seat-booking",
    ).set({
      id: "existing-seat-booking",
      resourceId: "seat-1",
      resourceName: "Desk 1",
      userId: "someone-else",
      start,
      end,
      status: "CONFIRMED",
    });

    const result = await callFunction<{
      options: Array<{
        resourceId: string;
        available: boolean;
      }>;
    }>(
      functions,
      "booking_getAvailability",
      { start, end },
    );

    expect(
      result.options.find(
        (option) => option.resourceId === "seat-1",
      )?.available,
    ).toBe(false);
    expect(
      result.options.find(
        (option) => option.resourceId === "seat-2",
      )?.available,
    ).toBe(true);
    expect(
      result.options.find(
        (option) => option.resourceId === "mode-conference",
      )?.available,
    ).toBe(false);
  });

  it("makes a whole-space mode mutually exclusive with every coworking desk", async () => {
    const { functions } = createClient(
      "booking-public-mode",
    );
    const { start, end } = futureFacilityWindow("11:00", 2);
    await db.collection("bookings").doc(
      "existing-mode-booking",
    ).set({
      id: "existing-mode-booking",
      resourceId: "mode-conference",
      resourceName: "Meeting setup",
      userId: "someone-else",
      start,
      end,
      status: "CONFIRMED",
    });

    const result = await callFunction<{
      options: Array<{
        resourceId: string;
        available: boolean;
      }>;
    }>(
      functions,
      "booking_getAvailability",
      { start, end },
    );

    expect(
      result.options.every(
        (option) => option.available === false,
      ),
    ).toBe(true);
  });

  it("quotes member desk hours from the remaining monthly allowance", async () => {
    const member = await createMember("booking-member");
    const first = futureFacilityWindow("09:00", 2);
    await db.collection("bookings").doc(
      "member-used-hours",
    ).set({
      id: "member-used-hours",
      resourceId: "seat-1",
      resourceName: "Desk 1",
      userId: "booking-member",
      start: first.start,
      end: first.end,
      status: "CONFIRMED",
    });
    const next = futureFacilityWindow("13:00", 3);

    const quote = await callFunction<{
      membershipName: string | null;
      includedHoursRemaining: number;
      includedHoursApplied: number;
      billableHours: number;
      totalCents: number;
    }>(
      member.functions,
      "booking_createQuote",
      {
        resourceId: "seat-2",
        start: next.start,
        end: next.end,
      },
    );

    expect(quote.membershipName).toBe("Coworking Member");
    expect(quote.includedHoursRemaining).toBe(13);
    expect(quote.includedHoursApplied).toBe(3);
    expect(quote.billableHours).toBe(0);
    expect(quote.totalCents).toBe(0);
  });

  it("reserves and spends account credit before Stripe checkout", async () => {
    const member = await createMember(
      "booking-credit-member",
    );
    const window = futureFacilityWindow("15:00", 1);
    const month = new Intl.DateTimeFormat("en-US", {
      timeZone: FACILITY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date(window.start));
    const monthParts = Object.fromEntries(
      month.map((part) => [part.type, part.value]),
    );

    await db.collection("users").doc(
      "booking-credit-member",
    ).update({
      accountCreditCents: 1050,
    });
    await db.collection("membershipUsage").doc(
      `booking-credit-member_${monthParts.year}-${monthParts.month}`,
    ).set({
      uid: "booking-credit-member",
      monthKey: `${monthParts.year}-${monthParts.month}`,
      usedHours: 15,
      reservations: {},
      updatedAt: Date.now(),
    });

    const quote = await callFunction<{
      subtotalCents: number;
      accountCreditAppliedCents: number;
      totalCents: number;
    }>(
      member.functions,
      "booking_createQuote",
      {
        resourceId: "seat-1",
        start: window.start,
        end: window.end,
      },
    );
    expect(quote.subtotalCents).toBe(1050);
    expect(quote.accountCreditAppliedCents).toBe(1050);
    expect(quote.totalCents).toBe(0);

    const result = await callFunction<{
      kind: "confirmed" | "checkout";
      bookingId?: string;
    }>(
      member.functions,
      "booking_beginCheckout",
      {
        resourceId: "seat-1",
        start: window.start,
        end: window.end,
        successUrl: "https://example.test/book/complete",
        cancelUrl: "https://example.test/book",
      },
    );

    expect(result.kind).toBe("confirmed");
    const user = (
      await db.collection("users").doc(
        "booking-credit-member",
      ).get()
    ).data();
    expect(user?.accountCreditCents).toBe(0);

    const booking = (
      await db.collection("bookings").doc(
        result.bookingId!,
      ).get()
    ).data();
    expect(booking?.accountCreditAppliedCents).toBe(1050);
    expect(booking?.status).toBe("CONFIRMED");
  });

  it("resumes cancellation after the payment is already refunded", async () => {
    const member = await createMember(
      "booking-refund-resume",
    );
    const window = futureFacilityWindow(
      "10:00",
      1,
      3,
    );

    await db.collection("payments").doc(
      "refunded-payment",
    ).set({
      id: "refunded-payment",
      uid: "booking-refund-resume",
      provider: "stripe",
      amount: 1750,
      currency: "usd",
      purpose: "booking",
      purposeRefId: "legacy-hold",
      status: "refunded",
      providerRefs: {
        stripeRefundId: "re_existing",
        holdId: "legacy-hold",
      },
      createdAt: Date.now(),
    });
    await db.collection("bookings").doc(
      "refunded-booking",
    ).set({
      id: "refunded-booking",
      resourceId: "seat-1",
      resourceName: "Desk 1",
      userId: "booking-refund-resume",
      userName: "Booking Test Member",
      start: window.start,
      end: window.end,
      status: "CONFIRMED",
      totalPrice: 17.5,
      totalCents: 1750,
      paymentId: "refunded-payment",
      paymentMethod: "STRIPE",
      createdAt: Date.now(),
    });

    const first = await callFunction<{
      success: boolean;
      refundCents: number;
    }>(
      member.functions,
      "booking_cancel",
      { bookingId: "refunded-booking" },
    );
    expect(first.success).toBe(true);
    expect(first.refundCents).toBe(1750);

    const second = await callFunction<{
      success: boolean;
      alreadyCancelled?: boolean;
    }>(
      member.functions,
      "booking_cancel",
      { bookingId: "refunded-booking" },
    );
    expect(second.success).toBe(true);
    expect(second.alreadyCancelled).toBe(true);

    const booking = (
      await db.collection("bookings").doc(
        "refunded-booking",
      ).get()
    ).data();
    expect(booking?.status).toBe("CANCELLED");
    expect(booking?.cancellationState).toBe("COMPLETE");
  });

  it("fails closed when a stale client calls the retired createBooking endpoint", async () => {
    const member = await createMember(
      "legacy-booking-member",
    );
    const window = futureFacilityWindow("15:00", 1);
    await expect(
      callFunction(
        member.functions,
        "createBooking",
        {
          resourceId: "seat-1",
          start: window.start,
          end: window.end,
        },
      ),
    ).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
  });
});
