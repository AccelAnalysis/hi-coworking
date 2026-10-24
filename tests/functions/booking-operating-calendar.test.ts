import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOKING_EARLIEST_TIME,
  BOOKING_HOURS_MESSAGE,
  BOOKING_LATEST_TIME,
  BOOKING_OUTSIDE_HOURS_MESSAGE,
  BOOKING_WEEKEND_MESSAGE,
  DEFAULT_WEEKLY_HOURS,
  assertWindowWithinOperatingCalendar,
  bookingHoursViolation,
  normalizeWeeklyHours,
  resolveDayIntervals,
} from "../../apps/functions/src/bookingOperatingCalendar";
import { CLOSE_HOUR, OPEN_HOUR, validateWindow } from "../../apps/functions/src/bookingFlexShared";

const HOUR = 60 * 60 * 1_000;
// Facility time is America/New_York. 2030-01-07 is a Monday (EST, UTC-5);
// 2030-07-08 is a Monday (EDT, UTC-4); 2030-01-05/06 are Saturday/Sunday.
const MON_EST_8AM = Date.UTC(2030, 0, 7, 13, 0);
const MON_EDT_8AM = Date.UTC(2030, 6, 8, 12, 0);
const SAT_EST_8AM = Date.UTC(2030, 0, 5, 13, 0);
const SUN_EST_8AM = Date.UTC(2030, 0, 6, 13, 0);

describe("booking operating calendar", () => {
  it("uses the default Monday through Friday booking hours", () => {
    expect(
      resolveDayIntervals("2026-08-31", DEFAULT_WEEKLY_HOURS, []),
    ).toEqual([{ startTime: "08:00", endTime: "17:00" }]);
  });

  it("keeps weekends closed, even with a special opening on file", () => {
    expect(resolveDayIntervals("2026-09-05", DEFAULT_WEEKLY_HOURS, [])).toEqual([]);
    expect(resolveDayIntervals("2026-09-06", DEFAULT_WEEKLY_HOURS, [])).toEqual([]);
    expect(
      resolveDayIntervals("2026-09-05", DEFAULT_WEEKLY_HOURS, [
        { date: "2026-09-05", kind: "OPEN", allDay: false, startTime: "09:00", endTime: "13:00" },
      ]),
    ).toEqual([]);
    const weekendsOpen = {
      ...DEFAULT_WEEKLY_HOURS,
      sat: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
    };
    expect(resolveDayIntervals("2026-09-05", weekendsOpen, [])).toEqual([]);
  });

  it("keeps weekday special openings inside 8 AM to 5 PM", () => {
    const closedMonday = { ...DEFAULT_WEEKLY_HOURS, mon: { ...DEFAULT_WEEKLY_HOURS.mon, isOpen: false } };
    expect(
      resolveDayIntervals("2026-08-31", closedMonday, [
        { date: "2026-08-31", kind: "OPEN", allDay: true, startTime: null, endTime: null },
      ]),
    ).toEqual([{ startTime: "08:00", endTime: "17:00" }]);
    expect(
      resolveDayIntervals("2026-08-31", closedMonday, [
        { date: "2026-08-31", kind: "OPEN", allDay: false, startTime: "15:00", endTime: "20:00" },
      ]),
    ).toEqual([{ startTime: "15:00", endTime: "17:00" }]);
  });

  it("uses an 8 AM to 5 PM outer limit for the admin calendar", () => {
    expect(BOOKING_EARLIEST_TIME).toBe("08:00");
    expect(BOOKING_LATEST_TIME).toBe("17:00");
  });

  it("trims stored hours to 8 AM to 5 PM and closes stored weekend openings", () => {
    const weekly = normalizeWeeklyHours({
      mon: { isOpen: true, openTime: "08:00", closeTime: "20:00" },
      tue: { isOpen: true, openTime: "09:30", closeTime: "16:00" },
      wed: { isOpen: true, openTime: "18:00", closeTime: "20:00" },
      sat: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
      sun: { isOpen: true, openTime: "10:00", closeTime: "14:00" },
    });
    expect(weekly.mon).toEqual({ isOpen: true, openTime: "08:00", closeTime: "17:00" });
    expect(weekly.tue).toEqual({ isOpen: true, openTime: "09:30", closeTime: "16:00" });
    expect(weekly.wed).toEqual(DEFAULT_WEEKLY_HOURS.wed);
    expect(weekly.sat.isOpen).toBe(false);
    expect(weekly.sun.isOpen).toBe(false);
  });

  it("removes a partial closure from otherwise open hours", () => {
    expect(
      resolveDayIntervals("2026-08-31", DEFAULT_WEEKLY_HOURS, [
        {
          date: "2026-08-31",
          kind: "CLOSED",
          allDay: false,
          startTime: "12:00",
          endTime: "13:30",
        },
      ]),
    ).toEqual([
      { startTime: "08:00", endTime: "12:00" },
      { startTime: "13:30", endTime: "17:00" },
    ]);
  });

  it("lets a full-day closure override the regular schedule", () => {
    expect(
      resolveDayIntervals("2026-09-07", DEFAULT_WEEKLY_HOURS, [
        {
          date: "2026-09-07",
          kind: "CLOSED",
          allDay: true,
          startTime: null,
          endTime: null,
        },
      ]),
    ).toEqual([]);
  });
});

describe("Monday to Friday, 8 AM to 5 PM booking limit", () => {
  it("allows any weekday window from 8 AM to 5 PM, in both EST and EDT", () => {
    expect(bookingHoursViolation(MON_EST_8AM, MON_EST_8AM + 9 * HOUR)).toBeNull();
    expect(bookingHoursViolation(MON_EDT_8AM, MON_EDT_8AM + 9 * HOUR)).toBeNull();
    expect(bookingHoursViolation(MON_EST_8AM + 8.5 * HOUR, MON_EST_8AM + 9 * HOUR)).toBeNull();
    for (let day = 0; day < 5; day += 1) {
      const start = MON_EST_8AM + day * 24 * HOUR;
      expect(bookingHoursViolation(start, start + HOUR)).toBeNull();
    }
  });

  it("rejects a start before 8 AM or an end after 5 PM", () => {
    expect(bookingHoursViolation(MON_EST_8AM - 0.5 * HOUR, MON_EST_8AM + HOUR)).toBe(BOOKING_OUTSIDE_HOURS_MESSAGE);
    expect(bookingHoursViolation(MON_EST_8AM + 8 * HOUR, MON_EST_8AM + 9.5 * HOUR)).toBe(BOOKING_OUTSIDE_HOURS_MESSAGE);
    expect(bookingHoursViolation(MON_EDT_8AM + 9 * HOUR, MON_EDT_8AM + 10 * HOUR)).toBe(BOOKING_OUTSIDE_HOURS_MESSAGE);
    expect(bookingHoursViolation(MON_EDT_8AM + 11 * HOUR, MON_EDT_8AM + 12 * HOUR)).toBe(BOOKING_OUTSIDE_HOURS_MESSAGE);
  });

  it("rejects Saturday and Sunday at any time", () => {
    expect(bookingHoursViolation(SAT_EST_8AM, SAT_EST_8AM + HOUR)).toBe(BOOKING_WEEKEND_MESSAGE);
    expect(bookingHoursViolation(SUN_EST_8AM + 2 * HOUR, SUN_EST_8AM + 3 * HOUR)).toBe(BOOKING_WEEKEND_MESSAGE);
  });

  it("explains the hours in every rejection", () => {
    expect(BOOKING_HOURS_MESSAGE).toBe("Hi Coworking is open Monday to Friday, 8 AM to 5 PM.");
    expect(BOOKING_WEEKEND_MESSAGE).toContain(BOOKING_HOURS_MESSAGE);
    expect(BOOKING_OUTSIDE_HOURS_MESSAGE).toContain(BOOKING_HOURS_MESSAGE);
  });

  it("is enforced by flex desk and meeting-room booking (bookingFlexShared)", () => {
    expect(OPEN_HOUR).toBe(8);
    expect(CLOSE_HOUR).toBe(17);
    expect(() => validateWindow(MON_EST_8AM, MON_EST_8AM + 9 * HOUR)).not.toThrow();
    expect(() => validateWindow(MON_EST_8AM + 8 * HOUR, MON_EST_8AM + 10 * HOUR)).toThrow(BOOKING_OUTSIDE_HOURS_MESSAGE);
    expect(() => validateWindow(SAT_EST_8AM, SAT_EST_8AM + 2 * HOUR)).toThrow(BOOKING_WEEKEND_MESSAGE);
  });

  it("is checked by the operating calendar before it reads the schedule", async () => {
    await expect(assertWindowWithinOperatingCalendar(SAT_EST_8AM, SAT_EST_8AM + HOUR)).rejects.toThrow(BOOKING_WEEKEND_MESSAGE);
    await expect(
      assertWindowWithinOperatingCalendar(MON_EST_8AM + 8 * HOUR, MON_EST_8AM + 10 * HOUR),
    ).rejects.toThrow(BOOKING_OUTSIDE_HOURS_MESSAGE);
  });

  it("is enforced by reschedule and admin booking-for-member paths", () => {
    for (const file of ["apps/functions/src/bookingManagement.ts", "apps/functions/src/adminMemberOperations.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('import { bookingHoursViolation } from "./bookingOperatingCalendar";');
      expect(source).toContain("bookingHoursViolation(start, end)");
      expect(source).not.toMatch(/CLOSE_HOUR\s*=\s*20/);
    }
  });

  it("matches the booking UI, reschedule form and admin pickers", () => {
    const booking = readFileSync("apps/web/src/components/BookingExperienceWithDeskChange.tsx", "utf8");
    expect(booking).toContain("Hi Coworking is open Monday to Friday, 8 AM to 5 PM.");
    expect(booking).toContain("Hi Coworking is closed on weekends.");
    expect(booking).toContain('aria-describedby="booking-hours-note booking-day-status"');
    const reschedule = readFileSync("apps/web/src/components/BookingManagementCard.tsx", "utf8");
    expect(reschedule).toContain('max="16:30"');
    const calendarAdmin = readFileSync("apps/web/src/components/OperatingHoursManager.tsx", "utf8");
    expect(calendarAdmin).toContain("17 * 60");
    expect(calendarAdmin).not.toContain("20 * 60");
    const memberAdmin = readFileSync("apps/web/src/app/admin/members/actions/page.tsx", "utf8");
    expect(memberAdmin).toContain("Array.from({ length: 19 }");
  });
});
