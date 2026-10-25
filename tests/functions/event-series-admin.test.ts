import { describe, expect, it } from "vitest";
import {
  SERIES_HOURS_MESSAGE,
  firstSeriesHoursViolation,
  normalizeSeriesInput,
  seriesOccurrenceHoursViolation,
  withoutUndefined,
  zonedDateTimeToEpoch,
} from "../../apps/functions/src/eventSeries";

const TZ = "America/New_York";
const at = (day: number, time: string) => zonedDateTimeToEpoch({ year: 2026, month: 11, day }, time, TZ);
const NOW = at(1, "06:00"); // Sunday, Nov 1 2026

const base = {
  title: "Founder Coffee",
  description: "Weekly coffee for founders",
  format: "in-person" as const,
  status: "published" as const,
  rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU",
  startTimeOfDay: "09:00",
  durationMins: 60,
  seriesStartDate: at(2, "12:00"),
  location: "Hi Coworking Commons",
};

describe("event series input", () => {
  it("normalizes a valid series and drops blank optional fields", () => {
    const series = normalizeSeriesInput({ ...base, id: "founder-coffee", seatCap: "" as unknown as number, virtualUrl: "" }, "admin-1", NOW);
    expect(series).toMatchObject({ id: "founder-coffee", timezone: TZ, currency: "USD", createdBy: "admin-1", updatedAt: NOW });
    expect("seatCap" in series).toBe(false);
    expect("virtualUrl" in series).toBe(false);
  });

  it("drops fields that are not part of a series", () => {
    const series = normalizeSeriesInput(
      { ...base, topics: ["founders"], registrationCount: 99, isAdmin: true } as never,
      "admin-1",
      NOW,
    ) as unknown as Record<string, unknown>;
    expect(series.topics).toEqual(["founders"]);
    expect(series.registrationCount).toBeUndefined();
    expect(series.isAdmin).toBeUndefined();
  });

  it.each([
    [{ title: "" }, "Add a title"],
    [{ location: "" }, "Add a location"],
    [{ startTimeOfDay: "9am" }, "Set a start time"],
    [{ durationMins: 5 }, "between 15 minutes and 12 hours"],
    [{ seriesEndDate: at(1, "12:00") }, "on or after the start date"],
    [{ rrule: "FREQ=YEARLY" }, "daily, weekly, or monthly"],
    [{ format: "virtual", virtualUrl: "http://example.com" }, "https://"],
    [{ seatCap: 0 }, "between 1 and 5000"],
  ])("rejects %o with a clear message", (patch, message) => {
    expect(() => normalizeSeriesInput({ ...base, ...patch } as never, "admin-1", NOW)).toThrow(message);
  });

  it("removes undefined values so Firestore admin accepts the write", () => {
    expect(withoutUndefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
  });
});

describe("series hours (Mon-Fri, 8 AM-5 PM Eastern)", () => {
  it("allows in-person occurrences inside the facility hours", () => {
    expect(seriesOccurrenceHoursViolation("in-person", at(3, "09:00"), at(3, "10:00"))).toBeNull();
    expect(seriesOccurrenceHoursViolation("hybrid", at(3, "16:00"), at(3, "17:00"))).toBeNull();
  });

  it("blocks in-person and hybrid occurrences outside the hours", () => {
    expect(seriesOccurrenceHoursViolation("in-person", at(3, "07:30"), at(3, "08:30"))).toBe(SERIES_HOURS_MESSAGE);
    expect(seriesOccurrenceHoursViolation("hybrid", at(3, "16:30"), at(3, "17:30"))).toBe(SERIES_HOURS_MESSAGE);
    expect(seriesOccurrenceHoursViolation("in-person", at(7, "10:00"), at(7, "11:00"))).toBe(SERIES_HOURS_MESSAGE);
  });

  it("does not apply facility hours to virtual series", () => {
    expect(seriesOccurrenceHoursViolation("virtual", at(7, "19:00"), at(7, "20:00"))).toBeNull();
  });

  it("finds the first occurrence that breaks the hours", () => {
    const evening = normalizeSeriesInput({ ...base, startTimeOfDay: "18:00" }, "admin-1", NOW);
    expect(firstSeriesHoursViolation(evening, 30, NOW)).toEqual({ start: at(3, "18:00"), end: at(3, "19:00") });
    const morning = normalizeSeriesInput(base, "admin-1", NOW);
    expect(firstSeriesHoursViolation(morning, 30, NOW)).toBeNull();
  });

  it("checks moved dates and skips cancelled ones", () => {
    const moved = normalizeSeriesInput(
      { ...base, overrides: { [String(at(3, "09:00"))]: { startTime: at(3, "17:00"), endTime: at(3, "18:00") } } },
      "admin-1",
      NOW,
    );
    expect(firstSeriesHoursViolation(moved, 30, NOW)).toEqual({ start: at(3, "17:00"), end: at(3, "18:00") });

    const single = { ...base, startTimeOfDay: "18:00", seriesEndDate: at(3, "12:00") };
    expect(firstSeriesHoursViolation(normalizeSeriesInput(single, "admin-1", NOW), 30, NOW)).not.toBeNull();
    const cancelled = normalizeSeriesInput(
      { ...single, overrides: { [String(at(3, "18:00"))]: { cancelled: true } } },
      "admin-1",
      NOW,
    );
    expect(firstSeriesHoursViolation(cancelled, 30, NOW)).toBeNull();
  });
});
