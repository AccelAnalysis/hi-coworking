import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOKING_HOLD_CLEANUP_GRACE_MS,
  abandonedHoldDecision,
  bookingHoldCleanupMode,
  childHoldDeletable,
  cleanupHoldInTransaction,
  runAbandonedHoldCleanup,
  type HoldCleanupStore,
  type HoldCleanupTransaction,
  type HoldRecord,
} from "../../apps/functions/src/bookingHoldCleanup";

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
const LONG_AGO = NOW - BOOKING_HOLD_CLEANUP_GRACE_MS - 60_000;

function checkoutHold(overrides: HoldRecord = {}): HoldRecord {
  return {
    id: "hold-1",
    resourceId: "seat-1",
    resourceName: "Desk 1",
    bookingKind: "single",
    start: LONG_AGO + 3_600_000,
    end: LONG_AGO + 7_200_000,
    userId: "guest:hold-1",
    guest: { name: "Test Guest", email: "guest@example.test", phone: "555-0100" },
    quote: { totalCents: 1750 },
    status: "HELD",
    secretHash: "hash",
    createdAt: LONG_AGO - 15 * 60_000,
    expiresAt: LONG_AGO,
    ...overrides,
  };
}

class MemoryStore implements HoldCleanupStore {
  holds = new Map<string, HoldRecord>();
  payments = new Map<string, Record<string, unknown>>();
  bookings = new Map<string, Record<string, unknown>>();
  users = new Map<string, Record<string, unknown>>();
  transactions = 0;

  async listExpired(cutoff: number, limit: number, after?: { expiresAt: number; id: string }) {
    return [...this.holds.entries()]
      .map(([id, data]) => ({ id, expiresAt: Number(data.expiresAt) }))
      .filter((h) => Number.isFinite(h.expiresAt) && h.expiresAt < cutoff)
      .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))
      .filter((h) => !after || h.expiresAt > after.expiresAt || (h.expiresAt === after.expiresAt && h.id > after.id))
      .slice(0, limit);
  }

  async runTransaction<T>(fn: (tx: HoldCleanupTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const deletes: string[] = [];
    const result = await fn({
      getHold: async (id) => this.holds.get(id),
      getPayment: async (id) => this.payments.has(id)
        ? { exists: true, status: this.payments.get(id)!.status }
        : { exists: false },
      deleteHold: (id) => { deletes.push(id); },
    });
    for (const id of deletes) this.holds.delete(id);
    return result;
  }
}

describe("abandoned booking hold policy", () => {
  it("deletes an expired guest checkout hold with no payment after the grace period", () => {
    expect(abandonedHoldDecision("hold-1", checkoutHold(), null, NOW)).toEqual({ delete: true });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ status: "EXPIRED" }), null, NOW)).toEqual({ delete: true });
  });

  it("deletes when the linked payment is still pending or failed", () => {
    const hold = checkoutHold({ paymentId: "pay-1" });
    expect(abandonedHoldDecision("hold-1", hold, { exists: true, status: "pending" }, NOW).delete).toBe(true);
    expect(abandonedHoldDecision("hold-1", hold, { exists: true, status: "failed" }, NOW).delete).toBe(true);
  });

  it.each(["paid", "refunded", "partially_refunded", "something_new", undefined])(
    "keeps a hold whose payment is %s (needs reconciliation, not deletion)",
    (status) => {
      expect(abandonedHoldDecision("hold-1", checkoutHold({ paymentId: "pay-1" }), { exists: true, status }, NOW))
        .toEqual({ delete: false, reason: "payment_not_unpaid" });
    },
  );

  it("keeps a hold whose payment document cannot be found", () => {
    expect(abandonedHoldDecision("hold-1", checkoutHold({ paymentId: "pay-1" }), { exists: false }, NOW))
      .toEqual({ delete: false, reason: "payment_missing" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ paymentId: "pay-1" }), null, NOW))
      .toEqual({ delete: false, reason: "payment_missing" });
  });

  it("never deletes an active hold or one still inside the grace period", () => {
    expect(abandonedHoldDecision("hold-1", checkoutHold({ expiresAt: NOW + 60_000 }), null, NOW))
      .toEqual({ delete: false, reason: "not_expired_long_enough" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ expiresAt: NOW - BOOKING_HOLD_CLEANUP_GRACE_MS + 60_000 }), null, NOW))
      .toEqual({ delete: false, reason: "not_expired_long_enough" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ expiresAt: undefined }), null, NOW).delete).toBe(false);
    expect(abandonedHoldDecision("hold-1", checkoutHold({ expiresAt: "soon" }), null, NOW).delete).toBe(false);
  });

  it("never deletes a completed hold", () => {
    expect(abandonedHoldDecision("hold-1", checkoutHold({ status: "CONSUMED", bookingId: "b-1" }), null, NOW))
      .toEqual({ delete: false, reason: "finalized" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ bookingId: "b-1" }), null, NOW))
      .toEqual({ delete: false, reason: "finalized" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ status: "CONSUMED" }), null, NOW))
      .toEqual({ delete: false, reason: "status_not_abandoned" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ status: "CANCELLED" }), null, NOW).delete).toBe(false);
  });

  it("leaves admin, reschedule, child and unknown hold shapes alone", () => {
    expect(abandonedHoldDecision("hold-1", checkoutHold({ adminActorUid: "admin-1" }), null, NOW))
      .toEqual({ delete: false, reason: "admin_hold" });
    expect(abandonedHoldDecision("reschedule_b-1", checkoutHold(), null, NOW))
      .toEqual({ delete: false, reason: "reschedule_hold" });
    expect(abandonedHoldDecision("hold-1_segment_1", { kind: "DESK_CHANGE_OCCUPANCY", parentHoldId: "hold-1", status: "HELD", expiresAt: LONG_AGO }, null, NOW))
      .toEqual({ delete: false, reason: "child_hold" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ secretHash: undefined }), null, NOW))
      .toEqual({ delete: false, reason: "not_checkout_hold" });
    expect(abandonedHoldDecision("hold-1", checkoutHold({ bookingKind: "event" }), null, NOW))
      .toEqual({ delete: false, reason: "not_checkout_hold" });
    expect(abandonedHoldDecision("hold-1", undefined, null, NOW)).toEqual({ delete: false, reason: "missing" });
  });

  it("only removes child holds that belong to the parent and were never used", () => {
    expect(childHoldDeletable("p", { parentHoldId: "p", status: "HELD" })).toBe(true);
    expect(childHoldDeletable("p", { parentHoldId: "other", status: "HELD" })).toBe(false);
    expect(childHoldDeletable("p", { parentHoldId: "p", status: "CONSUMED", bookingId: "b" })).toBe(false);
    expect(childHoldDeletable("p", { parentHoldId: "p", status: "HELD", bookingId: "b" })).toBe(false);
    expect(childHoldDeletable("p", undefined)).toBe(false);
  });

  it("is off unless the mode is explicitly dry_run or delete", () => {
    expect(bookingHoldCleanupMode({})).toBe("off");
    expect(bookingHoldCleanupMode({ BOOKING_HOLD_CLEANUP_MODE: "" })).toBe("off");
    expect(bookingHoldCleanupMode({ BOOKING_HOLD_CLEANUP_MODE: "true" })).toBe("off");
    expect(bookingHoldCleanupMode({ BOOKING_HOLD_CLEANUP_MODE: " DRY_RUN " })).toBe("dry_run");
    expect(bookingHoldCleanupMode({ BOOKING_HOLD_CLEANUP_MODE: "delete" })).toBe("delete");
  });
});

describe("abandoned booking hold sweep", () => {
  function seeded() {
    const store = new MemoryStore();
    store.holds.set("abandoned", checkoutHold({ id: "abandoned" }));
    store.holds.set("abandoned-pending", checkoutHold({ id: "abandoned-pending", paymentId: "pay-pending" }));
    store.payments.set("pay-pending", { status: "pending" });
    store.holds.set("paid-unfinalized", checkoutHold({ id: "paid-unfinalized", paymentId: "pay-paid" }));
    store.payments.set("pay-paid", { status: "paid" });
    store.holds.set("completed", checkoutHold({ id: "completed", status: "CONSUMED", bookingId: "booking-1" }));
    store.holds.set("active", checkoutHold({ id: "active", expiresAt: NOW + 10 * 60_000 }));
    store.holds.set("recent", checkoutHold({ id: "recent", expiresAt: NOW - 60_000 }));
    store.holds.set("admin", checkoutHold({ id: "admin", adminActorUid: "admin-1" }));
    store.holds.set("desk-change", checkoutHold({
      id: "desk-change",
      bookingKind: "desk_change",
      occupancyHoldIds: ["desk-change_segment_1", "desk-change_segment_2"],
      rescheduleLockHoldId: "desk-change_reschedule_lock",
    }));
    for (const id of ["desk-change_segment_1", "desk-change_segment_2", "desk-change_reschedule_lock"]) {
      store.holds.set(id, { id, kind: "DESK_CHANGE_OCCUPANCY", parentHoldId: "desk-change", status: "HELD", expiresAt: LONG_AGO });
    }
    store.bookings.set("booking-1", { id: "booking-1" });
    store.users.set("member-1", { role: "member" });
    return store;
  }

  it("does nothing when off", async () => {
    const store = seeded();
    const before = store.holds.size;
    const summary = await runAbandonedHoldCleanup(store, "off", NOW);
    expect(summary).toMatchObject({ mode: "off", scanned: 0, deleted: 0 });
    expect(store.holds.size).toBe(before);
    expect(store.transactions).toBe(0);
  });

  it("reports but deletes nothing in dry_run", async () => {
    const store = seeded();
    const before = new Map(store.holds);
    const summary = await runAbandonedHoldCleanup(store, "dry_run", NOW);
    expect(summary.deleted).toBe(3);
    expect(summary.childrenDeleted).toBe(3);
    expect(store.holds).toEqual(before);
  });

  it("deletes only expired abandoned checkout holds and their unused children", async () => {
    const store = seeded();
    const summary = await runAbandonedHoldCleanup(store, "delete", NOW, { pageSize: 2 });
    expect([...store.holds.keys()].sort()).toEqual(["active", "admin", "completed", "paid-unfinalized", "recent"]);
    expect(summary.deleted).toBe(3);
    expect(summary.childrenDeleted).toBe(3);
    expect(summary.skipped).toMatchObject({ payment_not_unpaid: 1, finalized: 1, admin_hold: 1 });
    expect(store.payments.size).toBe(2);
    expect(store.bookings.size).toBe(1);
    expect(store.users.size).toBe(1);
  });

  it("is idempotent: a second run deletes nothing more", async () => {
    const store = seeded();
    await runAbandonedHoldCleanup(store, "delete", NOW);
    const after = new Map(store.holds);
    const second = await runAbandonedHoldCleanup(store, "delete", NOW);
    expect(second.deleted).toBe(0);
    expect(store.holds).toEqual(after);
  });

  it("re-checks inside the transaction and skips a hold finalized after listing", async () => {
    const store = seeded();
    const runTransaction = store.runTransaction.bind(store);
    store.runTransaction = async (fn) => {
      // A concurrent finalize consumes the hold between the query and the delete.
      const hold = store.holds.get("abandoned");
      if (hold) store.holds.set("abandoned", { ...hold, status: "CONSUMED", bookingId: "late-booking" });
      return runTransaction(fn);
    };
    await runAbandonedHoldCleanup(store, "delete", NOW);
    expect(store.holds.get("abandoned")).toMatchObject({ status: "CONSUMED", bookingId: "late-booking" });
  });

  it("caps deletions per run", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 5; i += 1) store.holds.set(`h${i}`, checkoutHold({ id: `h${i}`, expiresAt: LONG_AGO - i }));
    const summary = await runAbandonedHoldCleanup(store, "delete", NOW, { pageSize: 2, maxDeleted: 3 });
    expect(summary.deleted).toBe(3);
    expect(store.holds.size).toBe(2);
  });

  it("transaction helper reads everything before deleting", async () => {
    const order: string[] = [];
    const holds: Record<string, HoldRecord> = {
      p: checkoutHold({ id: "p", paymentId: "pay", occupancyHoldIds: ["c"] }),
      c: { parentHoldId: "p", status: "HELD" },
    };
    const outcome = await cleanupHoldInTransaction({
      getHold: async (id) => { order.push(`get:${id}`); return holds[id]; },
      getPayment: async () => { order.push("get:payment"); return { exists: true, status: "failed" }; },
      deleteHold: (id) => { order.push(`delete:${id}`); },
    }, "p", NOW);
    expect(outcome).toEqual({ deleted: true, childIds: ["c"] });
    expect(order).toEqual(["get:p", "get:payment", "get:c", "delete:c", "delete:p"]);
  });
});

describe("abandoned booking hold sweep wiring", () => {
  const sweep = readFileSync("apps/functions/src/bookingHoldCleanupSweep.ts", "utf8");
  const main = readFileSync("apps/functions/src/main.ts", "utf8");

  it("is exported only from the default codebase, not an auto-deployed bundle", () => {
    expect(main).toContain('export { booking_cleanupAbandonedHolds } from "./bookingHoldCleanupSweep";');
    for (const bundle of [
      "firebase/booking-transaction-functions/src/index.ts",
      "firebase/booking-public-functions/src/index.ts",
    ]) {
      expect(readFileSync(bundle, "utf8")).not.toContain("booking_cleanupAbandonedHolds");
    }
  });

  it("only deletes bookingHolds documents and logs counts, not guest details", () => {
    expect(sweep.match(/tx\.delete\(/g)).toHaveLength(1);
    expect(sweep).toContain("tx.delete(holds.doc(id))");
    expect(sweep).not.toMatch(/\.set\(|\.update\(/);
    expect(sweep).toContain('logger.info("Abandoned booking hold cleanup finished", summary)');
  });
});
