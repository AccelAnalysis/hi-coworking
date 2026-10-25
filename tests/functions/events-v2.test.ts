import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp as deleteAdminApp,
  getApps as getAdminApps,
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
const AUTH_EMULATOR_URL = "http://127.0.0.1:9100";
const FUNCTIONS_EMULATOR_HOST = "127.0.0.1";
const FUNCTIONS_EMULATOR_PORT = 5004;
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8081";
const PASSWORD = "events-v2-test-password";

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9100";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

let adminApp: AdminApp;
let db: Firestore;
const clientApps: FirebaseApp[] = [];
let sequence = 0;

async function clearFirestore() {
  const response = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Could not clear Firestore emulator: ${response.status}`);
}

async function clearAuth() {
  const response = await fetch(`${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Could not clear Auth emulator: ${response.status}`);
}

function createClient(name: string) {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
  }, `${name}-${++sequence}`);
  clientApps.push(app);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, FUNCTIONS_EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
  return { app, functions };
}

async function createSignedInUser(uid: string, role: "member" | "staff" | "admin" = "member") {
  const email = `${uid}@example.test`;
  const authAdmin = getAdminAuth(adminApp);
  await authAdmin.createUser({ uid, email, password: PASSWORD, emailVerified: true });
  if (role !== "member") await authAdmin.setCustomUserClaims(uid, { role });
  await db.collection("users").doc(uid).set({
    uid,
    email,
    displayName: role === "member" ? "Event Member" : "Event Staff",
    role,
    membershipStatus: role === "member" ? "active" : "none",
    plan: role === "member" ? "coworking" : null,
    createdAt: Date.now(),
  });
  const client = createClient(`event-${role}-${uid}`);
  const auth = getAuth(client.app);
  connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  return client.functions;
}

async function callFunction<Result>(functions: Functions, name: string, data: Record<string, unknown>) {
  return (await httpsCallable<Record<string, unknown>, Result>(functions, name)(data)).data;
}

function futureEvent(id: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "A test event for the Events v2 lifecycle.",
    format: "in-person",
    location: "Hi Coworking",
    startTime: now + 3 * 24 * 60 * 60 * 1000,
    endTime: now + 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
    timezone: "America/New_York",
    status: "published",
    seatCap: 10,
    confirmedQuantity: 0,
    registrationCount: 0,
    heldQuantity: 0,
    price: 0,
    currency: "usd",
    ticketTypes: [],
    reminders: { confirmation: false, reminder24h: false, reminder1h: false, followUp: false },
    createdAt: now,
    ...overrides,
  };
}

beforeAll(() => {
  adminApp = getAdminApps().find((app) => app.name === "events-v2-tests")
    ?? initializeAdminApp({ projectId: PROJECT_ID }, "events-v2-tests");
  db = getAdminFirestore(adminApp);
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
});

afterAll(async () => {
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  await deleteAdminApp(adminApp);
});

describe("Events v2", () => {
  it("confirms only one guest when two people race for the last free seat", async () => {
    await db.collection("events").doc("last-seat").set(futureEvent("last-seat", { seatCap: 1 }));
    const first = createClient("last-seat-a").functions;
    const second = createClient("last-seat-b").functions;

    const results = await Promise.allSettled([
      callFunction<{ kind: string; registrationId?: string }>(first, "events_v2BeginRegistration", {
        eventId: "last-seat",
        quantity: 1,
        guest: { name: "First Guest", email: "first@example.test" },
      }),
      callFunction<{ kind: string; registrationId?: string }>(second, "events_v2BeginRegistration", {
        eventId: "last-seat",
        quantity: 1,
        guest: { name: "Second Guest", email: "second@example.test" },
      }),
    ]);

    const confirmed = results.filter((result) => result.status === "fulfilled" && result.value.kind === "confirmed");
    expect(confirmed).toHaveLength(1);
    const registrations = await db.collection("eventRegistrations").where("eventId", "==", "last-seat").get();
    expect(registrations.size).toBe(1);
    const event = (await db.collection("events").doc("last-seat").get()).data();
    expect(event?.confirmedQuantity).toBe(1);
    expect(event?.registrationCount).toBe(1);
  });

  it("does not allow a paid ticket type to use the free registration path", async () => {
    await db.collection("events").doc("paid-ticket").set(futureEvent("paid-ticket", {
      price: 0,
      ticketTypes: [{
        id: "general",
        name: "General admission",
        priceCents: 2500,
        soldCount: 0,
        heldCount: 0,
        targetAudience: "public",
      }],
    }));
    const functions = createClient("paid-ticket").functions;

    await expect(callFunction(functions, "events_v2BeginRegistration", {
      eventId: "paid-ticket",
      ticketTypeId: "general",
      quantity: 1,
      guest: { name: "Paid Guest", email: "paid@example.test" },
    })).rejects.toThrow();

    const registrations = await db.collection("eventRegistrations").where("eventId", "==", "paid-ticket").get();
    expect(registrations.empty).toBe(true);
    const holds = await db.collection("eventHolds").where("eventId", "==", "paid-ticket").get();
    expect(holds.empty).toBe(true);
  });

  it("reserves the released seat for the first waitlisted guest after cancellation", async () => {
    await db.collection("events").doc("waitlist-event").set(futureEvent("waitlist-event", { seatCap: 1 }));
    const memberFunctions = await createSignedInUser("waitlist-member");
    const guestFunctions = createClient("waitlist-guest").functions;

    const registration = await callFunction<{ kind: string; registrationId: string }>(
      memberFunctions,
      "events_v2BeginRegistration",
      { eventId: "waitlist-event", quantity: 1 },
    );
    expect(registration.kind).toBe("confirmed");

    const waitlist = await callFunction<{ success: boolean; entryId: string }>(
      guestFunctions,
      "events_v2JoinWaitlist",
      {
        eventId: "waitlist-event",
        quantity: 1,
        guest: { name: "Waiting Guest", email: "waiting@example.test" },
      },
    );
    expect(waitlist.success).toBe(true);

    await callFunction(memberFunctions, "events_v2CancelRegistration", {
      registrationId: registration.registrationId,
    });

    const entry = (await db.collection("eventWaitlist").doc(waitlist.entryId).get()).data();
    expect(entry?.status).toBe("OFFERED");
    expect(entry?.offerHoldId).toBeTruthy();
    const hold = (await db.collection("eventHolds").doc(entry?.offerHoldId).get()).data();
    expect(hold?.status).toBe("HELD");
    expect(hold?.source).toBe("waitlist");
    const event = (await db.collection("events").doc("waitlist-event").get()).data();
    expect(event?.confirmedQuantity).toBe(0);
    expect(event?.heldQuantity).toBe(1);
  });

  it("does not expose a virtual meeting URL through the public event projection", async () => {
    await db.collection("events").doc("private-link").set(futureEvent("private-link", {
      format: "virtual",
      location: "15373 Carrollton Blvd, Carrollton, VA",
      virtualUrl: "https://meet.example.test/private-secret",
    }));
    const functions = createClient("public-projection").functions;

    const result = await callFunction<{ event: Record<string, unknown> }>(
      functions,
      "events_v2GetPublicEvent",
      { identifier: "private-link" },
    );

    expect(result.event.title).toBe("Event private-link");
    expect(result.event.virtualUrl).toBeUndefined();
    expect(result.event.location).toBeUndefined();
    expect(JSON.stringify(result.event)).not.toContain("Carrollton");
  });

  it("keeps an in-person street address on the public event projection", async () => {
    await db.collection("events").doc("in-person-address").set(futureEvent("in-person-address", {
      format: "in-person",
      location: "15373 Carrollton Blvd, Carrollton, VA",
    }));
    const functions = createClient("in-person-address").functions;

    const result = await callFunction<{ event: Record<string, unknown> }>(
      functions,
      "events_v2GetPublicEvent",
      { identifier: "in-person-address" },
    );

    expect(result.event.location).toBe("15373 Carrollton Blvd, Carrollton, VA");
  });

  it("cancels an event without emailing anyone or issuing refunds, and holds paid seats for admin review", async () => {
    await db.collection("events").doc("cancel-me").set(futureEvent("cancel-me", { confirmedQuantity: 2, registrationCount: 2 }));
    const base = {
      eventId: "cancel-me",
      quantity: 1,
      discountCents: 0,
      currency: "usd",
      status: "CONFIRMED",
      attendanceStatus: "NOT_CHECKED_IN",
      checkedInQuantity: 0,
      source: "web",
      registeredAt: Date.now(),
      manageSecretHash: "hash",
    };
    await db.collection("eventRegistrations").doc("free-reg").set({
      ...base, id: "free-reg", displayName: "Free Guest", email: "free@example.test",
      publicUnitPriceCents: 0, finalUnitPriceCents: 0, amountPaidCents: 0,
    });
    await db.collection("eventRegistrations").doc("paid-reg").set({
      ...base, id: "paid-reg", displayName: "Paid Guest", email: "paid@example.test",
      publicUnitPriceCents: 2500, finalUnitPriceCents: 2500, amountPaidCents: 2500, paymentId: "pay-1",
    });
    const staff = await createSignedInUser("cancel-staff", "staff");
    await expect(callFunction(staff, "events_v2AdminCancelEvent", { eventId: "cancel-me" })).rejects.toThrow();

    const admin = await createSignedInUser("cancel-admin", "admin");
    const result = await callFunction<{
      cancelledRegistrations: number;
      refundReviewRegistrations: number;
      emailsSent: number;
    }>(admin, "events_v2AdminCancelEvent", { eventId: "cancel-me", reason: "Speaker unavailable" });
    expect(result).toMatchObject({ cancelledRegistrations: 1, refundReviewRegistrations: 1, emailsSent: 0 });

    expect((await db.collection("events").doc("cancel-me").get()).data()?.status).toBe("cancelled");
    expect((await db.collection("eventRegistrations").doc("free-reg").get()).data()?.status).toBe("CANCELLED");
    expect((await db.collection("eventRegistrations").doc("paid-reg").get()).data()?.status).toBe("REFUND_PENDING");
    const refundJobs = await db.collection("eventRefundJobs").get();
    expect(refundJobs.docs.map((doc) => doc.data().status)).toEqual(["needs_admin_review"]);
    const notifications = await db.collection("eventNotificationJobs").get();
    expect(notifications.empty).toBe(true);
    const audit = await db.collection("eventOperationAudit").get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data()).toMatchObject({
      action: "event_cancel",
      reason: "Speaker unavailable",
      emailsSent: 0,
      refundsIssued: 0,
      actorUid: "cancel-admin",
    });

    await expect(callFunction(admin, "events_v2AdminCancelEvent", { eventId: "cancel-me" })).rejects.toThrow();
  });

  it("gives staff a roster without secrets and adds walk-ins without sending email", async () => {
    await db.collection("events").doc("roster-event").set(futureEvent("roster-event"));
    const member = await createSignedInUser("roster-member");
    const registration = await callFunction<{ kind: string; registrationId: string }>(
      member,
      "events_v2BeginRegistration",
      { eventId: "roster-event", quantity: 1 },
    );
    expect(registration.kind).toBe("confirmed");

    await expect(callFunction(member, "events_v2StaffGetRoster", { eventId: "roster-event" })).rejects.toThrow();

    const staff = await createSignedInUser("roster-staff", "staff");
    const walkIn = await callFunction<{ registrationId: string; emailSent: boolean }>(
      staff,
      "events_v2StaffWalkIn",
      { eventId: "roster-event", name: "Walk In", email: "walkin@example.test", quantity: 1 },
    );
    expect(walkIn.emailSent).toBe(false);

    const roster = await callFunction<{ registrations: Array<Record<string, unknown>> }>(
      staff,
      "events_v2StaffGetRoster",
      { eventId: "roster-event" },
    );
    expect(roster.registrations).toHaveLength(2);
    for (const row of roster.registrations) {
      expect(row).not.toHaveProperty("manageSecretHash");
    }

    const checkIn = await callFunction<{ attendanceStatus: string }>(
      staff,
      "events_v2StaffCheckIn",
      { registrationId: registration.registrationId, quantity: 1 },
    );
    expect(checkIn.attendanceStatus).toBe("CHECKED_IN");
    const stored = (await db.collection("eventRegistrations").doc(registration.registrationId).get()).data();
    expect(stored?.checkedInBy).toBe("roster-staff");

    const walkInNotifications = await db.collection("eventNotificationJobs")
      .where("registrationId", "==", walkIn.registrationId).get();
    expect(walkInNotifications.empty).toBe(true);
  });

  it("fails closed when a stale client calls the retired free-registration endpoint", async () => {
    const functions = createClient("legacy-events").functions;
    await expect(callFunction(functions, "events_registerFree", {
      eventId: "anything",
    })).rejects.toThrow();
  });
});
