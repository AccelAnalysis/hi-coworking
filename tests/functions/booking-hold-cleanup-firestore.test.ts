// Runs against the Firestore emulator (see the product CI emulator step).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  BOOKING_HOLD_CLEANUP_GRACE_MS,
  runAbandonedHoldCleanup,
} from "../../apps/functions/src/bookingHoldCleanup";
import { firestoreHoldCleanupStore } from "../../apps/functions/src/bookingHoldCleanupSweep";

const PROJECT_ID = "demo-hi-coworking";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

let app: App;
let db: Firestore;

async function clearFirestore() {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Could not clear Firestore emulator: ${response.status}`);
}

beforeAll(() => {
  app = getApps().find((candidate) => candidate.name === "hold-cleanup-tests")
    ?? initializeApp({ projectId: PROJECT_ID }, "hold-cleanup-tests");
  db = getFirestore(app);
});

beforeEach(clearFirestore);

afterAll(async () => {
  await deleteApp(app);
});

const NOW = Date.now();
const LONG_AGO = NOW - BOOKING_HOLD_CLEANUP_GRACE_MS - 60_000;

function hold(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    resourceId: "seat-1",
    resourceName: "Desk 1",
    bookingKind: "single",
    start: LONG_AGO + 3_600_000,
    end: LONG_AGO + 7_200_000,
    userId: `guest:${id}`,
    guest: { name: "Test Guest", email: `${id}@example.test`, phone: "555-0100" },
    quote: { totalCents: 1750 },
    status: "HELD",
    secretHash: "hash",
    createdAt: LONG_AGO - 900_000,
    expiresAt: LONG_AGO,
    ...overrides,
  };
}

describe("abandoned booking hold sweep (Firestore)", () => {
  it("deletes only abandoned checkout holds and never touches bookings, payments or users", async () => {
    const seed: Array<[string, string, Record<string, unknown>]> = [
      ["bookingHolds", "abandoned", hold("abandoned")],
      ["bookingHolds", "abandoned-failed", hold("abandoned-failed", { paymentId: "pay-failed" })],
      ["payments", "pay-failed", { id: "pay-failed", status: "failed", purposeRefId: "abandoned-failed" }],
      ["bookingHolds", "paid", hold("paid", { paymentId: "pay-paid" })],
      ["payments", "pay-paid", { id: "pay-paid", status: "paid", purposeRefId: "paid" }],
      ["bookingHolds", "completed", hold("completed", { status: "CONSUMED", bookingId: "booking-1" })],
      ["bookings", "booking-1", { id: "booking-1", userId: "member-1", status: "CONFIRMED" }],
      ["bookingHolds", "active", hold("active", { expiresAt: NOW + 600_000 })],
      ["bookingHolds", "admin", hold("admin", { adminActorUid: "admin-1" })],
      ["bookingHolds", "desk", hold("desk", {
        bookingKind: "desk_change",
        occupancyHoldIds: ["desk_segment_1"],
        rescheduleLockHoldId: "desk_reschedule_lock",
      })],
      ["bookingHolds", "desk_segment_1", { kind: "DESK_CHANGE_OCCUPANCY", parentHoldId: "desk", status: "HELD", expiresAt: LONG_AGO }],
      ["bookingHolds", "desk_reschedule_lock", { kind: "DESK_CHANGE_RESCHEDULE_LOCK", parentHoldId: "desk", status: "HELD", expiresAt: LONG_AGO }],
      ["users", "member-1", { uid: "member-1", role: "member", membershipStatus: "active" }],
    ];
    for (const [collection, id, data] of seed) await db.collection(collection).doc(id).set(data);

    const store = firestoreHoldCleanupStore(db as unknown as FirebaseFirestore.Firestore);
    const dry = await runAbandonedHoldCleanup(store, "dry_run", NOW, { pageSize: 2 });
    expect(dry.deleted).toBe(3);
    expect((await db.collection("bookingHolds").get()).size).toBe(9);

    const summary = await runAbandonedHoldCleanup(store, "delete", NOW, { pageSize: 2 });
    expect(summary.deleted).toBe(3);
    expect(summary.childrenDeleted).toBe(2);
    const remaining = (await db.collection("bookingHolds").get()).docs.map((doc) => doc.id).sort();
    expect(remaining).toEqual(["active", "admin", "completed", "paid"]);
    expect((await db.collection("payments").get()).size).toBe(2);
    expect((await db.collection("bookings").doc("booking-1").get()).exists).toBe(true);
    expect((await db.collection("users").doc("member-1").get()).data()).toMatchObject({ membershipStatus: "active" });

    const again = await runAbandonedHoldCleanup(store, "delete", NOW);
    expect(again.deleted).toBe(0);
    expect((await db.collection("bookingHolds").get()).size).toBe(4);
  });
});
