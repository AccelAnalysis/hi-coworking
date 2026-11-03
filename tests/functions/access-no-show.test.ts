import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory Firestore so the real no-show sweep runs; revoke is a spy.
const h = vi.hoisted(() => {
  type Doc = Record<string, unknown>;
  const docs = new Map<string, Doc>();
  const logs: unknown[][] = [];
  const revoked: string[] = [];
  const failOn = { collection: "" };
  const hooks: { beforeRevoke?: () => void } = {};
  type Filter = [string, string, unknown];
  const match = (data: Doc, [f, op, v]: Filter) =>
    op === "==" ? data[f] === v : op === ">" ? Number(data[f]) > Number(v) : op === "<" ? Number(data[f]) < Number(v) : false;
  function snapOf(collection: string, id: string) {
    const data = docs.get(`${collection}/${id}`);
    return { id, exists: !!data, data: () => (data ? { ...data } : undefined) };
  }
  function query(collection: string, filters: Filter[], order?: string) {
    return {
      where: (f: string, op: string, v: unknown) => query(collection, [...filters, [f, op, v]], order),
      orderBy: (f: string) => query(collection, filters, f),
      limit: () => query(collection, filters, order),
      async get() {
        if (failOn.collection === collection) throw new Error("boom");
        let found = [...docs.entries()]
          .filter(([path, data]) => path.startsWith(`${collection}/`) && filters.every((flt) => match(data, flt)))
          .map(([path, data]) => ({ id: path.slice(collection.length + 1), data: () => ({ ...data }) }));
        if (order) found = found.sort((a, b) => Number(a.data()[order]) - Number(b.data()[order]));
        return { empty: found.length === 0, size: found.length, docs: found };
      },
    };
  }
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (failOn.collection === name) throw new Error("boom");
          return snapOf(name, id);
        },
      }),
      where: (f: string, op: string, v: unknown) => query(name, []).where(f, op, v),
    }),
  };
  return { docs, logs, revoked, failOn, hooks, db };
});

vi.mock("../../apps/functions/node_modules/firebase-admin", () => ({ firestore: () => h.db }));
vi.mock("firebase-admin", () => ({ firestore: () => h.db }));
vi.mock("firebase-functions/logger", () => ({
  info: (...args: unknown[]) => h.logs.push(args),
  warn: (...args: unknown[]) => h.logs.push(args),
  error: (...args: unknown[]) => h.logs.push(args),
}));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: (_opts: unknown, handler: unknown) => handler }));
vi.mock("../../apps/functions/src/access", () => ({
  revokeAccessGrant: async (grantId: string) => {
    h.revoked.push(grantId);
  },
  seamApiKey: { name: "SEAM_API_KEY" },
  NO_SHOW_GRACE_MINUTES: 30,
}));

import { runNoShowSweep } from "../../apps/functions/src/scheduled/accessCleanup";
import { decideNoShow, type NoShowInput } from "../../apps/functions/src/accessCodes/noShow";

const MIN = 60_000;
const START = Date.parse("2026-11-03T14:00:00.000Z");
const END = START + 4 * 60 * MIN;
const NOW = START + 45 * MIN; // 45 minutes into the booking

function seed() {
  // Grant window includes the 5-minute entry grace on both sides.
  h.docs.set("accessGrants/g1", {
    bookingId: "b1", doorId: "door1", userId: "u1", status: "active",
    startsAt: START - 5 * MIN, endsAt: END + 5 * MIN, gracePeriodMinutes: 5,
  });
  h.docs.set("bookings/b1", { userId: "u1", status: "CONFIRMED", start: START, end: END, resourceId: "seat-1" });
  h.docs.set("doors/door1", { status: "online", seamDeviceId: "dev_1" });
  h.docs.set("accessCodes/c1", { grantId: "g1", doorId: "door1", status: "active", seamCodeId: "code_1" });
  h.docs.set("accessEvents/e0", { grantId: "g1", bookingId: "b1", doorId: "door1", eventType: "code_issued" });
}

const sweep = (now = NOW) => runNoShowSweep(now, { revoke: async (id) => { h.hooks.beforeRevoke?.(); h.revoked.push(id); } });

beforeEach(() => {
  h.docs.clear();
  h.logs.length = 0;
  h.revoked.length = 0;
  h.failOn.collection = "";
  h.hooks.beforeRevoke = undefined;
  seed();
});

describe("no-show sweep", () => {
  it("revokes a true no-show: everything known, nothing shows the member arrived", async () => {
    const counts = await sweep();
    expect(h.revoked).toEqual(["g1"]);
    expect(counts).toMatchObject({ candidates: 1, revoked: 1 });
  });

  it("never revokes a member who used their code (code_used event from the webhook)", async () => {
    h.docs.set("accessEvents/e1", { grantId: "g1", bookingId: "b1", doorId: "door1", eventType: "code_used" });
    expect(await sweep()).toMatchObject({ revoked: 0, code_used: 1 });
    expect(h.revoked).toEqual([]);
  });

  it("never revokes when the grant or code carries a first-use time", async () => {
    h.docs.set("accessGrants/g1", { ...h.docs.get("accessGrants/g1"), firstUsedAt: START + MIN });
    await sweep();
    expect(h.revoked).toEqual([]);
    seed();
    h.docs.set("accessCodes/c1", { ...h.docs.get("accessCodes/c1"), firstUsedAt: START + MIN });
    await sweep();
    expect(h.revoked).toEqual([]);
  });

  it("keeps the code after a door unlock or staff unlock for the booking", async () => {
    for (const eventType of ["door_unlocked", "door_unlock_requested", "admin_override"]) {
      seed();
      h.docs.set("accessEvents/e2", { bookingId: "b1", doorId: "door1", eventType });
      await sweep();
      expect(h.revoked).toEqual([]);
      h.docs.delete("accessEvents/e2");
    }
  });

  it("keeps the code when the member checked in at the front desk", async () => {
    h.docs.set("kioskVisits/v1", { uid: "u1", checkInAt: START + 20 * MIN, checkOutAt: null });
    expect(await sweep()).toMatchObject({ checked_in: 1, revoked: 0 });
    // A visit from another day does not count.
    h.docs.set("kioskVisits/v1", { uid: "u1", checkInAt: START - 24 * 60 * MIN, checkOutAt: START - 23 * 60 * MIN });
    await sweep();
    expect(h.revoked).toEqual(["g1"]);
  });

  it("measures the 30 minutes from the booking start, not the earlier grant start", async () => {
    await sweep(START + 28 * MIN);
    expect(h.revoked).toEqual([]);
    await sweep(START + 31 * MIN);
    expect(h.revoked).toEqual(["g1"]);
  });

  it("fails safe when the door is not online or the code was never confirmed on the lock", async () => {
    for (const status of ["offline", "unknown", undefined]) {
      seed();
      h.docs.set("doors/door1", { seamDeviceId: "dev_1", ...(status && { status }) });
      expect(await sweep()).toMatchObject({ revoked: 0, door_not_online: 1 });
    }
    seed();
    h.docs.set("accessCodes/c1", { ...h.docs.get("accessCodes/c1"), status: "programming" });
    expect(await sweep()).toMatchObject({ revoked: 0, code_not_confirmed_on_lock: 1 });
    expect(h.revoked).toEqual([]);
  });

  it("fails safe on missing or odd data", async () => {
    const cases: Array<() => void> = [
      () => h.docs.delete("bookings/b1"),
      () => h.docs.delete("doors/door1"),
      () => h.docs.delete("accessCodes/c1"),
      () => h.docs.set("bookings/b1", { ...h.docs.get("bookings/b1"), status: "CANCELLED" }),
      () => h.docs.set("bookings/b1", { ...h.docs.get("bookings/b1"), userId: "someone-else" }),
      () => h.docs.set("bookings/b1", { ...h.docs.get("bookings/b1"), start: undefined }),
      () => h.docs.set("accessGrants/g1", { ...h.docs.get("accessGrants/g1"), bookingId: undefined }),
      () => h.docs.set("accessGrants/g1", { ...h.docs.get("accessGrants/g1"), doorId: "" }),
      () => h.docs.set("accessGrants/g1", { ...h.docs.get("accessGrants/g1"), status: "pending" }),
    ];
    for (const breakIt of cases) {
      seed();
      breakIt();
      await sweep();
      expect(h.revoked).toEqual([]);
    }
  });

  it("revokes nothing when any lookup fails", async () => {
    for (const collection of ["accessGrants", "accessEvents", "kioskVisits", "doors", "bookings", "accessCodes"]) {
      seed();
      h.failOn.collection = collection;
      await sweep();
      expect(h.revoked).toEqual([]);
    }
  });

  it("re-checks right before revoking, so a use recorded mid-run still saves the member", async () => {
    const realGet = h.db.collection;
    let grantReads = 0;
    h.db.collection = ((name: string) => {
      const col = realGet(name);
      if (name !== "accessGrants") return col;
      return {
        ...col,
        doc: (id: string) => ({
          get: async () => {
            grantReads++;
            if (grantReads === 2) h.docs.set("accessGrants/g1", { ...h.docs.get("accessGrants/g1"), firstUsedAt: NOW });
            return col.doc(id).get();
          },
        }),
      };
    }) as typeof h.db.collection;
    try {
      expect(await sweep()).toMatchObject({ revoked: 0, code_used: 1 });
      expect(h.revoked).toEqual([]);
    } finally {
      h.db.collection = realGet;
    }
  });

  it("ignores ended bookings and logs counts only", async () => {
    await sweep(END + 10 * MIN);
    expect(h.revoked).toEqual([]);
    await sweep();
    const logged = JSON.stringify(h.logs);
    expect(logged).not.toContain("u1");
    expect(logged).not.toContain("b1");
    expect(logged).not.toContain("g1");
  });
});

describe("decideNoShow", () => {
  const base = (): NoShowInput => ({
    now: NOW,
    noShowGraceMinutes: 30,
    grant: { status: "active", bookingId: "b1", doorId: "door1", userId: "u1" },
    booking: { status: "CONFIRMED", userId: "u1", start: START, end: END },
    door: { status: "online" },
    codes: [{ status: "active" }],
    events: [],
    visits: [],
  });

  it("revokes only the fully known no-show", () => {
    expect(decideNoShow(base())).toEqual({ revoke: true });
    expect(decideNoShow({ ...base(), grant: null })).toEqual({ revoke: false, reason: "grant_missing" });
    expect(decideNoShow({ ...base(), events: [{ eventType: "code_used" }] })).toEqual({ revoke: false, reason: "code_used" });
    expect(decideNoShow({ ...base(), booking: { ...base().booking, checkedInAt: NOW } })).toEqual({ revoke: false, reason: "checked_in" });
    expect(decideNoShow({ ...base(), codes: [{ status: "active" }, { status: "failed" }] })).toEqual({ revoke: false, reason: "code_state_unknown" });
    expect(decideNoShow({ ...base(), codes: [] })).toEqual({ revoke: false, reason: "code_not_confirmed_on_lock" });
  });
});
