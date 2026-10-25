/** Pure helpers for Admin booking cancel and move (no Firebase imports). */

export const FACILITY_TIME_ZONE = "America/New_York";

export type AdminCancellationChoice = "policy" | "refund" | "credit";

export type AdminCancellationOption = {
  choice: AdminCancellationChoice;
  outcome: string;
  reason: string;
  refundCents: number;
  accountCreditCents: number;
  includedHoursToRestore: number;
};

export type OpenInterval = { startTime: string; endTime: string };

export const CANCELLATION_CHOICE_COPY: Record<
  AdminCancellationChoice,
  { label: string; hint: string }
> = {
  policy: {
    label: "The member asked to cancel",
    hint: "Applies the same refund, credit and hours rules the member sees.",
  },
  refund: {
    label: "Hi Coworking is cancelling: full refund",
    hint: "Refunds the card payment in full and restores all included hours. Any account credit used is returned as credit.",
  },
  credit: {
    label: "Hi Coworking is cancelling: full account credit",
    hint: "Returns the full booking value as account credit and restores all included hours. No card refund.",
  },
};

export function easternParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

export function easternEpoch(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const { date, time } = easternParts(guess);
    const [y, m, d] = date.split("-").map(Number);
    const [h, min] = time.split(":").map(Number);
    guess += targetAsUtc - Date.UTC(y, m - 1, d, h, min);
  }
  return guess;
}

function minutesOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function timeOf(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 30-minute start times where a booking of this length fits inside an open interval. */
export function startTimeOptions(intervals: OpenInterval[], durationMinutes: number) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];
  const options: string[] = [];
  for (const interval of intervals) {
    const open = minutesOf(interval.startTime);
    const close = minutesOf(interval.endTime);
    for (let start = Math.ceil(open / 30) * 30; start + durationMinutes <= close; start += 30) {
      options.push(timeOf(start));
    }
  }
  return options;
}

/** "9:30 AM" style label for an "HH:MM" value. */
export function timeLabel(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** Admins can cancel or move a confirmed booking until it has ended. */
export function canManageBooking(
  booking: { status: string; end: number | null },
  now: number,
) {
  return booking.status === "CONFIRMED" && typeof booking.end === "number" && booking.end > now;
}

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function cancellationSummary(option: AdminCancellationOption) {
  const parts: string[] = [];
  if (option.refundCents > 0) parts.push(`${money(option.refundCents)} refunded to the card`);
  if (option.accountCreditCents > 0) parts.push(`${money(option.accountCreditCents)} added as account credit`);
  if (option.includedHoursToRestore > 0) {
    const hours = option.includedHoursToRestore;
    parts.push(`${hours} included ${hours === 1 ? "hour" : "hours"} restored`);
  }
  return parts.length ? `The member gets ${parts.join(", ")}.` : "The member gets no refund, credit or hours back.";
}

/** Case-insensitive match on name, email or uid for the member picker. */
export function memberMatchesSearch(
  member: { displayName?: string; email?: string; uid: string },
  search: string,
) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [member.displayName, member.email, member.uid]
    .some((value) => (value || "").toLowerCase().includes(term));
}

/** Message for a Saturday or Sunday "YYYY-MM-DD" date, or null on weekdays. */
export function weekendMessage(dateValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6
    ? "Hi Coworking is closed on weekends. Choose a Monday to Friday date."
    : null;
}
