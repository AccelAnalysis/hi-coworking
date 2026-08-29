import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEKLY_HOURS,
  resolveDayIntervals,
} from "../../apps/functions/src/bookingOperatingCalendar";

describe("booking operating calendar", () => {
  it("uses the default Monday through Friday booking hours", () => {
    expect(
      resolveDayIntervals("2026-08-31", DEFAULT_WEEKLY_HOURS, []),
    ).toEqual([{ startTime: "08:00", endTime: "17:00" }]);
  });

  it("keeps Saturday closed unless a special opening is added", () => {
    expect(
      resolveDayIntervals("2026-09-05", DEFAULT_WEEKLY_HOURS, []),
    ).toEqual([]);

    expect(
      resolveDayIntervals("2026-09-05", DEFAULT_WEEKLY_HOURS, [
        {
          date: "2026-09-05",
          kind: "OPEN",
          allDay: false,
          startTime: "09:00",
          endTime: "13:00",
        },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "13:00" }]);
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
