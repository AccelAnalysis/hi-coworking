import { describe, expect, it } from "vitest";
import {
  attendanceFlag,
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
  isValidMemberCode,
  maskedName,
  normalizeKioskSettings,
  parseLookupQuery,
  roundOverageMinutes,
  seatBookingsForDay,
  validRequestId,
  validateCloseReason,
  validateKioskSettings,
  type KioskBooking,
} from "../../apps/functions/src/frontDeskKiosk/policy";

const MIN = 60_000;

describe("overage rounding (5-minute grace, then up to the next 15)", () => {
  it.each([
    [0, 0], [3, 0], [5, 0], [5.01, 15], [6, 15], [14, 15], [15, 15], [15.5, 30], [29, 30], [31, 45], [61, 75],
  ])("%s raw minutes -> %s", (raw, rounded) => {
    expect(roundOverageMinutes(raw)).toBe(rounded);
  });
  it("treats negative and non-finite as no overage", () => {
    expect(roundOverageMinutes(-10)).toBe(0);
    expect(roundOverageMinutes(Number.NaN)).toBe(0);
  });
  it("computes a visit against its allowance", () => {
    const checkInAt = Date.UTC(2026, 10, 2, 14, 0);
    const result = computeOverage({ checkInAt, checkOutAt: checkInAt + 127 * MIN, allowanceMinutes: 120 });
    expect(result).toEqual({ actualMinutes: 127, rawOverageMinutes: 7, overageMinutes: 15, includedMinutesApplied: 120 });
    const under = computeOverage({ checkInAt, checkOutAt: checkInAt + 50 * MIN, allowanceMinutes: 120 });
    expect(under.overageMinutes).toBe(0);
    expect(under.includedMinutesApplied).toBe(50);
    const none = computeOverage({ checkInAt, checkOutAt: checkInAt + 4 * MIN, allowanceMinutes: 0 });
    expect(none.overageMinutes).toBe(0);
  });
});

describe("allowance", () => {
  const day = "2026-11-04";
  const at = (time: string) => easternEpoch(day, time);
  const booking = (id: string, start: string, end: string, extra: Partial<KioskBooking> = {}): KioskBooking => ({
    id, start: at(start), end: at(end), status: "CONFIRMED", resourceId: "seat-2", ...extra,
  });

  it("uses the booked window when there is a seat booking that day", () => {
    const bookings = seatBookingsForDay([
      booking("b2", "13:00", "15:00"),
      booking("b1", "09:00", "11:00"),
      booking("cancelled", "11:00", "12:00", { status: "CANCELLED" }),
      booking("room", "11:00", "12:00", { resourceId: "conference-room" }),
      { ...booking("other-day", "09:00", "10:00"), start: easternEpoch("2026-11-05", "09:00"), end: easternEpoch("2026-11-05", "10:00") },
    ], day);
    expect(bookings.map((b) => b.id)).toEqual(["b1", "b2"]);
    const allowance = computeAllowance({ dayBookings: bookings, includedHoursPerMonth: 10, usedBookingHoursThisMonth: 4, walkInIncludedMinutesThisMonth: 30 });
    expect(allowance.source).toBe("booking");
    expect(allowance.allowanceMinutes).toBe(240);
    expect(allowance.bookedWindow).toEqual({ start: at("09:00"), end: at("15:00") });
    expect(allowance.bookingIds).toEqual(["b1", "b2"]);
    expect(allowance.remainingMonthlyMinutes).toBe(600 - 240 - 30);
  });

  it("accepts the flex seat and lower-case legacy status", () => {
    expect(seatBookingsForDay([booking("f", "09:00", "10:00", { resourceId: "seat-flex", status: "confirmed" })], day)).toHaveLength(1);
  });

  it("falls back to remaining monthly included hours", () => {
    const allowance = computeAllowance({ dayBookings: [], includedHoursPerMonth: 15, usedBookingHoursThisMonth: 10.5, walkInIncludedMinutesThisMonth: 60 });
    expect(allowance).toMatchObject({ source: "monthly", allowanceMinutes: 900 - 630 - 60, bookedWindow: null });
  });

  it("never goes below zero", () => {
    const allowance = computeAllowance({ dayBookings: [], includedHoursPerMonth: 10, usedBookingHoursThisMonth: 12, walkInIncludedMinutesThisMonth: 0 });
    expect(allowance.allowanceMinutes).toBe(0);
    expect(allowance.remainingMonthlyMinutes).toBe(0);
  });

  it("is zero without a desk plan or booking", () => {
    expect(computeAllowance({ dayBookings: [], includedHoursPerMonth: null, usedBookingHoursThisMonth: 0, walkInIncludedMinutesThisMonth: 0 }))
      .toEqual({ source: "none", allowanceMinutes: 0, bookedWindow: null, bookingIds: [], remainingMonthlyMinutes: null });
  });
});

describe("staff-only hours alerts", () => {
  const monthly = (remaining: number) => computeAllowance({ dayBookings: [], includedHoursPerMonth: 10, usedBookingHoursThisMonth: 10 - remaining / 60, walkInIncludedMinutesThisMonth: 0 });
  const none = computeAllowance({ dayBookings: [], includedHoursPerMonth: null, usedBookingHoursThisMonth: 0, walkInIncludedMinutesThisMonth: 0 });
  it("flags billing states first", () => {
    expect(hoursAlertReason({ membershipStatus: "pastDue", compEnded: false, hasDeskPlan: true, allowance: monthly(60) })).toBe("past_due");
    expect(hoursAlertReason({ membershipStatus: "cancelled", compEnded: false, hasDeskPlan: false, allowance: none })).toBe("cancelled");
    expect(hoursAlertReason({ membershipStatus: "expired", compEnded: false, hasDeskPlan: false, allowance: none })).toBe("expired");
    expect(hoursAlertReason({ membershipStatus: "active", compEnded: true, hasDeskPlan: false, allowance: none })).toBe("comp_ended");
  });
  it("flags zero remaining hours, but not when they booked today", () => {
    expect(hoursAlertReason({ membershipStatus: "active", compEnded: false, hasDeskPlan: true, allowance: monthly(0) })).toBe("no_hours_remaining");
    expect(hoursAlertReason({ membershipStatus: "active", compEnded: false, hasDeskPlan: true, allowance: monthly(90) })).toBeNull();
    const booked = computeAllowance({
      dayBookings: [{ id: "b", start: 0, end: 60 * MIN, status: "CONFIRMED", resourceId: "seat-1" }],
      includedHoursPerMonth: null, usedBookingHoursThisMonth: 0, walkInIncludedMinutesThisMonth: 0,
    });
    expect(hoursAlertReason({ membershipStatus: "none", compEnded: false, hasDeskPlan: false, allowance: booked })).toBeNull();
    expect(hoursAlertReason({ membershipStatus: "none", compEnded: false, hasDeskPlan: false, allowance: none })).toBe("no_plan_or_booking");
  });
});

describe("Eastern time and daylight saving", () => {
  it("keys days and months in facility time, not UTC", () => {
    // 2026-11-03 02:30 UTC is still Nov 2 in New York (EST, UTC-5).
    expect(easternDayKey(Date.UTC(2026, 10, 3, 2, 30))).toBe("2026-11-02");
    // 2026-11-01 03:30 UTC is Oct 31 23:30 EDT.
    expect(easternMonthKey(Date.UTC(2026, 10, 1, 3, 30))).toBe("2026-10");
  });
  it("converts wall time with the right offset on both sides of a change", () => {
    expect(easternEpoch("2026-10-30", "17:00")).toBe(Date.UTC(2026, 9, 30, 21, 0)); // EDT
    expect(easternEpoch("2026-11-02", "17:00")).toBe(Date.UTC(2026, 10, 2, 22, 0)); // EST
    expect(easternEpoch("2026-03-09", "08:00")).toBe(Date.UTC(2026, 2, 9, 12, 0)); // EDT after spring forward
    expect(easternEpoch("2026-03-06", "08:00")).toBe(Date.UTC(2026, 2, 6, 13, 0)); // EST before
  });
  it("gives 25- and 23-hour days on change days", () => {
    const fall = easternDayBounds("2026-11-01");
    expect((fall.end - fall.start) / (60 * MIN)).toBe(25);
    const spring = easternDayBounds("2026-03-08");
    expect((spring.end - spring.start) / (60 * MIN)).toBe(23);
  });
  it("measures a visit across the fall-back hour in real minutes", () => {
    const checkIn = easternEpoch("2026-11-01", "00:30");
    const checkOut = easternEpoch("2026-11-01", "03:30");
    expect(computeOverage({ checkInAt: checkIn, checkOutAt: checkOut, allowanceMinutes: 180 }).actualMinutes).toBe(240);
  });
});

describe("late, no-show and auto-close", () => {
  const start = easternEpoch("2026-11-04", "10:00");
  const end = easternEpoch("2026-11-04", "12:00");
  it("flags late 15 minutes after start and no-show at the end", () => {
    expect(attendanceFlag({ start, end, hasVisit: false, now: start + 14 * MIN })).toBeNull();
    expect(attendanceFlag({ start, end, hasVisit: false, now: start + 15 * MIN })).toBe("late");
    expect(attendanceFlag({ start, end, hasVisit: false, now: end })).toBe("no_show");
    expect(attendanceFlag({ start, end, hasVisit: true, now: end })).toBeNull();
  });
  it("closes at closing time, or holds after-hours visits to the end of the day", () => {
    const closingAt = easternEpoch("2026-11-04", "17:00");
    const dayEnd = easternDayBounds("2026-11-04").end;
    expect(autoClosePlan({ checkInAt: start, closingAt, dayEnd })).toEqual({ dueAt: closingAt, checkOutAt: closingAt });
    const late = closingAt + 30 * MIN;
    expect(autoClosePlan({ checkInAt: late, closingAt, dayEnd })).toEqual({ dueAt: dayEnd, checkOutAt: late });
  });
  it("reads the closing time from the operating calendar", () => {
    expect(closingTimeFromIntervals([{ endTime: "12:00" }, { endTime: "16:30" }])).toBe("16:30");
    expect(closingTimeFromIntervals([])).toBe("17:00");
  });
});

describe("lookup, names and settings", () => {
  it("parses an email or a member code", () => {
    expect(parseLookupQuery("  Member@Example.Test ")).toEqual({ kind: "email", email: "member@example.test" });
    expect(parseLookupQuery("hk7-m2p")).toEqual({ kind: "code", code: "HK7M2P" });
    expect(parseLookupQuery("HK7M2O")).toBeNull(); // O is not in the alphabet
    expect(parseLookupQuery("abc")).toBeNull();
    expect(parseLookupQuery("not an email@")).toBeNull();
    expect(parseLookupQuery(42)).toBeNull();
  });
  it("generates unambiguous codes", () => {
    for (let i = 0; i < 50; i += 1) expect(isValidMemberCode(generateMemberCode())).toBe(true);
    expect(generateMemberCode(() => 0)).toBe("AAAAAA");
  });
  it("masks names to first name and last initial, never an email", () => {
    expect(maskedName({ displayName: "Avery Quinn Kim" })).toBe("Avery K.");
    expect(maskedName({ firstName: "Sam", lastName: "lee" })).toBe("Sam L.");
    expect(maskedName({ displayName: "Prince" })).toBe("Prince");
    expect(maskedName({ displayName: "someone@example.test" })).toBe("Member");
    expect(maskedName({})).toBe("Member");
    expect(firstName({ displayName: "Avery Kim" })).toBe("Avery");
  });
  it("validates idle timing and close reasons", () => {
    expect(normalizeKioskSettings(undefined)).toEqual({ idleLogoMinutes: 15, logoSeconds: 6 });
    expect(normalizeKioskSettings({ idleLogoMinutes: 500, logoSeconds: 1 })).toEqual({ idleLogoMinutes: 120, logoSeconds: 3 });
    expect(validateKioskSettings({ idleLogoMinutes: 10, logoSeconds: 5 })).toEqual({ idleLogoMinutes: 10, logoSeconds: 5 });
    expect(typeof validateKioskSettings({ idleLogoMinutes: 0, logoSeconds: 5 })).toBe("string");
    expect(validateCloseReason("  ok ")).toBeNull();
    expect(validateCloseReason("Left at 3")).toBe("Left at 3");
    expect(validRequestId("abc")).toBe(false);
    expect(validRequestId("req_12345678")).toBe(true);
  });
});
