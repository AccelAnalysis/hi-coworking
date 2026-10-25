/** Pure helpers for the admin event-series form (unit tested). */

export const FACILITY_TIME_ZONE = "America/New_York";

export const SERIES_WEEKDAYS = [
  { code: "MO", short: "Mon", label: "Monday" },
  { code: "TU", short: "Tue", label: "Tuesday" },
  { code: "WE", short: "Wed", label: "Wednesday" },
  { code: "TH", short: "Thu", label: "Thursday" },
  { code: "FR", short: "Fri", label: "Friday" },
  { code: "SA", short: "Sat", label: "Saturday" },
  { code: "SU", short: "Sun", label: "Sunday" },
] as const;

const DAY_ORDER: string[] = SERIES_WEEKDAYS.map((day) => day.code);

export function buildWeeklyRRule(days: string[], interval: number) {
  const ordered = DAY_ORDER.filter((code) => days.includes(code));
  const safeInterval = Number.isInteger(interval) && interval > 0 ? interval : 1;
  return `FREQ=WEEKLY;INTERVAL=${safeInterval};BYDAY=${ordered.join(",")}`;
}

export function parseWeeklyRRule(rrule?: string | null): { days: string[]; interval: number } {
  const parts = Object.fromEntries(
    String(rrule || "")
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((part) => part.split("=").map((value) => value.trim().toUpperCase()))
      .filter((pair) => pair.length === 2 && pair[0]),
  );
  const interval = Number.parseInt(parts.INTERVAL || "1", 10);
  const days = String(parts.BYDAY || "")
    .split(",")
    .map((value) => value.slice(-2))
    .filter((code) => DAY_ORDER.includes(code));
  return { days, interval: Number.isFinite(interval) && interval > 0 ? interval : 1 };
}

/**
 * The series only uses the calendar date of seriesStartDate/seriesEndDate in
 * Eastern time. 16:00 UTC (11 AM-noon Eastern) lands on the same Eastern date all year.
 */
export function facilityDateToEpoch(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 16, 0);
}

export function facilityDateInputValue(timestamp?: number | null): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FACILITY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
