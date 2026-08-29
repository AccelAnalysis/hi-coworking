import { describe, expect, it } from "vitest";
import { generateOccurrenceStarts, zonedDateTimeToEpoch } from "../../apps/functions/src/eventSeries";

function localClock(timestamp: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

describe("event series timezone handling", () => {
  it("keeps a 9:00 AM New York weekly event at 9:00 through the spring DST transition", () => {
    const timeZone = "America/New_York";
    const seriesStartDate = zonedDateTimeToEpoch({ year: 2026, month: 3, day: 1 }, "09:00", timeZone);
    const seriesEndDate = zonedDateTimeToEpoch({ year: 2026, month: 3, day: 15 }, "23:00", timeZone);
    const now = zonedDateTimeToEpoch({ year: 2026, month: 2, day: 28 }, "12:00", timeZone);

    const starts = generateOccurrenceStarts({
      id: "sunday-coffee",
      title: "Sunday Coffee",
      description: "Weekly community coffee",
      format: "in-person",
      status: "published",
      timezone: timeZone,
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU",
      startTimeOfDay: "09:00",
      durationMins: 60,
      seriesStartDate,
      seriesEndDate,
      exceptions: [],
      overrides: {},
      createdBy: "admin",
      createdAt: now,
    }, 30, now);

    expect(starts).toHaveLength(3);
    expect(starts.map((timestamp) => localClock(timestamp, timeZone))).toEqual([
      "2026-03-01 09:00",
      "2026-03-08 09:00",
      "2026-03-15 09:00",
    ]);

    // UTC shifts from 14:00 to 13:00 after DST begins; the local event time does not.
    expect(new Date(starts[0]).getUTCHours()).toBe(14);
    expect(new Date(starts[1]).getUTCHours()).toBe(13);
    expect(new Date(starts[2]).getUTCHours()).toBe(13);
  });
});
