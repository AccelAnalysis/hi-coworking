import { describe, expect, it, vi } from "vitest";
import {
  attendanceTaskId,
  attendanceTaskPlan,
  MAX_TASK_DELAY_MS,
  autoCloseTaskId,
  decideAttendanceTask,
  decideAutoClose,
  easternEpoch,
  parseFrontDeskTask,
  planAttendanceTasks,
  trackableBooking,
  type AttendanceTaskPayload,
} from "../../apps/functions/src/frontDeskKiosk/policy";
import { enqueueFrontDeskTasks, type TaskQueueLike } from "../../apps/functions/src/frontDeskKiosk/taskQueue";

const MIN = 60_000;
const DAY = "2026-11-04";
const start = easternEpoch(DAY, "10:00");
const end = easternEpoch(DAY, "12:00");
const booking = { userId: "member-1", resourceId: "seat-3", status: "CONFIRMED", start, end };

function mockQueue(existing: string[] = []) {
  const ids = new Set(existing);
  const calls: Array<{ data: Record<string, unknown>; id: string; scheduleTime: Date }> = [];
  const queue: TaskQueueLike = {
    enqueue: vi.fn(async (data, opts) => {
      if (ids.has(opts.id)) throw Object.assign(new Error("exists"), { code: "functions/task-already-exists" });
      ids.add(opts.id);
      calls.push({ data, id: opts.id, scheduleTime: opts.scheduleTime });
    }),
  };
  return { queue, calls };
}

describe("planning booking tasks", () => {
  it("queues a late check at start + 15 min and a no-show check at the end", () => {
    const tasks = planAttendanceTasks({ bookingId: "b1", before: undefined, after: booking, now: start - 60 * MIN });
    expect(tasks).toEqual([
      { id: `kiosk-late-b1-${start}`, scheduleAt: start + 15 * MIN, payload: { kind: "late", bookingId: "b1", uid: "member-1", start, end } },
      { id: `kiosk-noshow-b1-${start}`, scheduleAt: end, payload: { kind: "no_show", bookingId: "b1", uid: "member-1", start, end } },
    ]);
  });

  it("uses deterministic IDs that change with the start time", () => {
    expect(attendanceTaskId("b1", "late", start)).toBe(attendanceTaskId("b1", "late", start));
    expect(attendanceTaskId("b1", "late", start)).not.toBe(attendanceTaskId("b1", "late", start + 30 * MIN));
    expect(attendanceTaskId("b/1 x", "no_show", start)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(autoCloseTaskId("v.1", 5)).toBe("kiosk-close-v_1-5");
  });

  it("plans nothing when only unrelated fields change", () => {
    expect(planAttendanceTasks({ bookingId: "b1", before: booking, after: { ...booking, note: "x", paymentStatus: "paid" }, now: start - MIN })).toEqual([]);
  });

  it("re-plans a rescheduled booking under new IDs and plans nothing for a cancel or delete", () => {
    const moved = { ...booking, start: start + 60 * MIN, end: end + 60 * MIN };
    const tasks = planAttendanceTasks({ bookingId: "b1", before: booking, after: moved, now: start - MIN });
    expect(tasks.map((t) => t.id)).toEqual([`kiosk-late-b1-${start + 60 * MIN}`, `kiosk-noshow-b1-${start + 60 * MIN}`]);
    expect(planAttendanceTasks({ bookingId: "b1", before: booking, after: { ...booking, status: "CANCELLED" }, now: start - MIN })).toEqual([]);
    expect(planAttendanceTasks({ bookingId: "b1", before: booking, after: undefined, now: start - MIN })).toEqual([]);
  });

  it("plans when a pending booking becomes confirmed, but not for rooms, guests or past bookings", () => {
    expect(planAttendanceTasks({ bookingId: "b1", before: { ...booking, status: "PENDING" }, after: booking, now: start - MIN })).toHaveLength(2);
    expect(planAttendanceTasks({ bookingId: "b1", before: undefined, after: { ...booking, resourceId: "conference-room" }, now: start })).toEqual([]);
    expect(planAttendanceTasks({ bookingId: "b1", before: undefined, after: { ...booking, userId: undefined }, now: start })).toEqual([]);
    expect(planAttendanceTasks({ bookingId: "b1", before: undefined, after: booking, now: end })).toEqual([]);
  });

  it("schedules an overdue late check for now while the booking is still running", () => {
    const now = start + 40 * MIN;
    expect(planAttendanceTasks({ bookingId: "b1", before: undefined, after: booking, now })[0].scheduleAt).toBe(now);
  });

  it("stays inside the Cloud Tasks 30-day limit with a relay task for far-off bookings", () => {
    const now = start - 60 * 24 * 60 * MIN; // booked 60 days ahead
    const [late, noShow] = planAttendanceTasks({ bookingId: "b1", before: undefined, after: booking, now });
    for (const task of [late, noShow]) {
      expect(task.scheduleAt).toBe(now + MAX_TASK_DELAY_MS);
      expect(task.scheduleAt - now).toBeLessThan(30 * 24 * 60 * MIN);
    }
    const relayDay = Math.floor(now / (24 * 60 * MIN));
    expect(late.id).toBe(`kiosk-late-b1-${start}-relay-${relayDay}`);
    expect(noShow.id).toBe(`kiosk-noshow-b1-${start}-relay-${relayDay}`);
    // The relay re-plans when it runs; once in range it gets the real ID.
    const hop = now + MAX_TASK_DELAY_MS;
    expect(attendanceTaskPlan(late.payload as AttendanceTaskPayload, hop).id).toBe(`kiosk-late-b1-${start}-relay-${relayDay + 29}`);
    const inRange = start - 10 * 24 * 60 * MIN;
    expect(attendanceTaskPlan(late.payload as AttendanceTaskPayload, inRange)).toEqual({ id: `kiosk-late-b1-${start}`, scheduleAt: start + 15 * MIN, payload: late.payload });
  });
});

describe("late / no-show task handler decisions", () => {
  const current = trackableBooking("b1", booking);
  const late: AttendanceTaskPayload = { kind: "late", bookingId: "b1", uid: "member-1", start, end };
  const noShow: AttendanceTaskPayload = { ...late, kind: "no_show" };

  it("no-ops when the member checked in", () => {
    expect(decideAttendanceTask({ task: late, booking: current, hasVisit: true, currentFlag: undefined, now: start + 15 * MIN })).toEqual({ action: "noop", reason: "attended" });
    expect(decideAttendanceTask({ task: noShow, booking: current, hasVisit: true, currentFlag: undefined, now: end })).toEqual({ action: "noop", reason: "attended" });
  });

  it("flags late, then no-show, when the member never checks in", () => {
    expect(decideAttendanceTask({ task: late, booking: current, hasVisit: false, currentFlag: undefined, now: start + 15 * MIN })).toEqual({ action: "flag", status: "late" });
    expect(decideAttendanceTask({ task: noShow, booking: current, hasVisit: false, currentFlag: "late", now: end })).toEqual({ action: "flag", status: "no_show" });
  });

  it("turns a late flag into arrived_late when the member came in after all", () => {
    expect(decideAttendanceTask({ task: noShow, booking: current, hasVisit: true, currentFlag: "late", now: end })).toEqual({ action: "arrived_late" });
  });

  it("no-ops for a cancelled or deleted booking", () => {
    const cancelled = trackableBooking("b1", { ...booking, status: "CANCELLED" });
    expect(cancelled).toBeNull();
    expect(decideAttendanceTask({ task: late, booking: cancelled, hasVisit: false, currentFlag: undefined, now: end })).toEqual({ action: "noop", reason: "stale_booking" });
  });

  it("no-ops for a rescheduled or reassigned booking", () => {
    const moved = trackableBooking("b1", { ...booking, start: start + 60 * MIN, end: end + 60 * MIN });
    expect(decideAttendanceTask({ task: late, booking: moved, hasVisit: false, currentFlag: undefined, now: end })).toEqual({ action: "noop", reason: "stale_booking" });
    const reassigned = trackableBooking("b1", { ...booking, userId: "member-2" });
    expect(decideAttendanceTask({ task: noShow, booking: reassigned, hasVisit: false, currentFlag: undefined, now: end })).toEqual({ action: "noop", reason: "stale_booking" });
  });

  it("no-ops on duplicate delivery and never downgrades no_show to late", () => {
    expect(decideAttendanceTask({ task: late, booking: current, hasVisit: false, currentFlag: "late", now: start + 20 * MIN })).toEqual({ action: "noop", reason: "already_flagged" });
    expect(decideAttendanceTask({ task: noShow, booking: current, hasVisit: false, currentFlag: "no_show", now: end })).toEqual({ action: "noop", reason: "already_flagged" });
    expect(decideAttendanceTask({ task: late, booking: current, hasVisit: false, currentFlag: "no_show", now: end + MIN })).toEqual({ action: "noop", reason: "already_flagged" });
  });

  it("does nothing a few minutes before due (clock skew, retried instead)", () => {
    expect(decideAttendanceTask({ task: late, booking: current, hasVisit: false, currentFlag: undefined, now: start + 12 * MIN })).toEqual({ action: "noop", reason: "too_early" });
    // Nothing is decided before due, even if a visit already exists.
    expect(decideAttendanceTask({ task: noShow, booking: current, hasVisit: true, currentFlag: "late", now: end - 2 * MIN })).toEqual({ action: "noop", reason: "too_early" });
  });

  it("relays when a hop task arrives well before due, but only for a booking that still matches", () => {
    expect(decideAttendanceTask({ task: late, booking: current, hasVisit: false, currentFlag: undefined, now: start - 20 * 24 * 60 * MIN })).toEqual({ action: "relay" });
    expect(decideAttendanceTask({ task: late, booking: null, hasVisit: false, currentFlag: undefined, now: start - 20 * 24 * 60 * MIN })).toEqual({ action: "noop", reason: "stale_booking" });
  });
});

describe("forgotten check-out task decisions", () => {
  const closingAt = easternEpoch(DAY, "17:00");
  const base = {
    task: { kind: "auto_close" as const, uid: "member-1", visitId: "v1", dueAt: closingAt },
    openVisitId: "v1",
    visitStatus: "open",
    checkInAt: easternEpoch(DAY, "09:00"),
    closingAt,
    dayEnd: easternEpoch(DAY, "23:59"),
  };

  it("closes a still-open visit at closing time", () => {
    expect(decideAutoClose({ ...base, now: closingAt })).toEqual({ action: "close", checkOutAt: closingAt });
  });

  it("no-ops once the member checked out or on a duplicate delivery", () => {
    expect(decideAutoClose({ ...base, openVisitId: null, visitStatus: "closed", now: closingAt })).toEqual({ action: "noop", reason: "not_open" });
    expect(decideAutoClose({ ...base, visitStatus: "auto_closed", now: closingAt })).toEqual({ action: "noop", reason: "not_open" });
    expect(decideAutoClose({ ...base, openVisitId: "v2", now: closingAt })).toEqual({ action: "noop", reason: "different_visit" });
  });

  it("re-queues for the new time when closing moved later", () => {
    expect(decideAutoClose({ ...base, closingAt: closingAt + 60 * MIN, now: closingAt })).toEqual({ action: "reschedule", dueAt: closingAt + 60 * MIN });
  });
});

describe("task payload validation", () => {
  it("accepts well-formed tasks and drops anything else", () => {
    expect(parseFrontDeskTask({ kind: "late", bookingId: "b1", uid: "u", start, end })).toEqual({ kind: "late", bookingId: "b1", uid: "u", start, end });
    expect(parseFrontDeskTask({ kind: "auto_close", uid: "u", visitId: "v", dueAt: end })).toMatchObject({ kind: "auto_close" });
    expect(parseFrontDeskTask({ kind: "late", bookingId: "a/b", uid: "u", start, end })).toBeNull();
    expect(parseFrontDeskTask({ kind: "late", bookingId: "b1", uid: "u", start: end, end: start })).toBeNull();
    expect(parseFrontDeskTask({ kind: "sweep" })).toBeNull();
    expect(parseFrontDeskTask(null)).toBeNull();
  });
});

describe("enqueueing (mocked Cloud Tasks queue)", () => {
  const tasks = planAttendanceTasks({ bookingId: "b1", before: undefined, after: booking, now: start - 60 * MIN });

  it("enqueues each task with its ID and schedule time", async () => {
    const { queue, calls } = mockQueue();
    expect(await enqueueFrontDeskTasks(queue, tasks)).toEqual({ enqueued: tasks.map((t) => t.id), duplicates: [] });
    expect(calls.map((c) => [c.id, c.scheduleTime.getTime(), c.data.kind])).toEqual([
      [tasks[0].id, start + 15 * MIN, "late"],
      [tasks[1].id, end, "no_show"],
    ]);
  });

  it("treats an existing task ID as a duplicate, so a redelivered trigger cannot double-queue", async () => {
    const { queue, calls } = mockQueue();
    await enqueueFrontDeskTasks(queue, tasks);
    expect(await enqueueFrontDeskTasks(queue, tasks)).toEqual({ enqueued: [], duplicates: tasks.map((t) => t.id) });
    expect(calls).toHaveLength(2);
  });

  it("tries every task and then throws on other errors so the trigger retries", async () => {
    const { queue } = mockQueue([tasks[1].id]);
    const failing: TaskQueueLike = {
      enqueue: vi.fn(async (data, opts) => {
        if (opts.id === tasks[0].id) throw Object.assign(new Error("PERMISSION_DENIED"), { code: "functions/permission-denied" });
        return queue.enqueue(data, opts);
      }),
    };
    await expect(enqueueFrontDeskTasks(failing, tasks)).rejects.toThrow(/Could not enqueue 1 front desk task/);
    expect(failing.enqueue).toHaveBeenCalledTimes(2);
  });
});
