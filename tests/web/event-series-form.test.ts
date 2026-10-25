import { describe, expect, it } from "vitest";
import {
  buildWeeklyRRule,
  facilityDateInputValue,
  facilityDateToEpoch,
  parseWeeklyRRule,
} from "../../apps/web/src/lib/eventSeriesForm";

describe("event series form helpers", () => {
  it("builds a weekly rule with days in calendar order", () => {
    expect(buildWeeklyRRule(["FR", "MO", "WE"], 2)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR");
    expect(buildWeeklyRRule(["TU"], 0)).toBe("FREQ=WEEKLY;INTERVAL=1;BYDAY=TU");
  });

  it("reads weekly rules, including RRULE: prefixes and ordinal days", () => {
    expect(parseWeeklyRRule("RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=mo,1TH")).toEqual({ days: ["MO", "TH"], interval: 3 });
    expect(parseWeeklyRRule(undefined)).toEqual({ days: [], interval: 1 });
  });

  it("round-trips a date input through Eastern time in winter and summer", () => {
    for (const value of ["2026-01-15", "2026-07-04", "2026-03-08", "2026-11-01"]) {
      const epoch = facilityDateToEpoch(value);
      expect(epoch).toBeDefined();
      expect(facilityDateInputValue(epoch)).toBe(value);
    }
    expect(facilityDateToEpoch("01/15/2026")).toBeUndefined();
    expect(facilityDateInputValue(undefined)).toBe("");
  });
});
