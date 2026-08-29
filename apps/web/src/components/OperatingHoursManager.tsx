"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  CalendarOff,
  Check,
  Clock3,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";

const FACILITY_TIME_ZONE = "America/New_York";

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type ExceptionKind = "OPEN" | "CLOSED";

type WeeklyDay = {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

type WeeklyHours = Record<DayKey, WeeklyDay>;

type ScheduleException = {
  id: string;
  date: string;
  kind: ExceptionKind;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  label: string;
  createdAt: number;
  createdBy: string;
};

type CalendarResponse = {
  timeZone: string;
  earliestTime: string;
  latestTime: string;
  weekly: WeeklyHours;
  exceptions: ScheduleException[];
};

type AffectedBooking = {
  id: string;
  resourceName: string;
  userName: string;
  start: number;
  end: number;
};

const getOperatingCalendar = httpsCallable<Record<string, never>, CalendarResponse>(
  functions,
  "booking_adminGetOperatingCalendar",
);

const setWeeklyHours = httpsCallable<
  { day: DayKey; isOpen: boolean; openTime: string; closeTime: string },
  { success: boolean; weekly: WeeklyHours }
>(functions, "booking_adminSetWeeklyHours");

const addException = httpsCallable<
  {
    date: string;
    kind: ExceptionKind;
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
    label: string;
  },
  {
    success: boolean;
    exception: ScheduleException;
    affectedBookingCount: number;
    affectedBookings: AffectedBooking[];
  }
>(functions, "booking_adminAddException");

const deleteException = httpsCallable<
  { exceptionId: string },
  { success: boolean; alreadyDeleted?: boolean }
>(functions, "booking_adminDeleteException");

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

function facilityDateValue(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACILITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeOptions(includeClose = true) {
  const options: string[] = [];
  const final = includeClose ? 20 * 60 : 20 * 60 - 30;
  for (let minutes = 8 * 60; minutes <= final; minutes += 30) {
    options.push(minutesToTime(minutes));
  }
  return options;
}

function formatClock(value: string | null) {
  if (!value) return "";
  return new Date(`2000-01-01T${value}:00Z`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatBookingTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatException(exception: ScheduleException) {
  if (exception.kind === "CLOSED" && exception.allDay) return "Closed all day";
  const range = `${formatClock(exception.startTime)}–${formatClock(exception.endTime)}`;
  return exception.kind === "OPEN" ? `Special opening · ${range}` : `Closed · ${range}`;
}

function errorMessage(caught: unknown, fallback: string) {
  const raw = caught as { message?: string };
  if (!raw?.message) return fallback;
  const split = raw.message.split(": ");
  return split[split.length - 1] || fallback;
}

export function OperatingHoursManager() {
  const { role } = useAuth();
  const canManageWeekly = role === "admin" || role === "master";
  const today = useMemo(() => facilityDateValue(), []);
  const [weekly, setWeekly] = useState<WeeklyHours | null>(null);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDay, setSavingDay] = useState<DayKey | null>(null);
  const [savingException, setSavingException] = useState(false);
  const [deletingException, setDeletingException] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [affectedBookings, setAffectedBookings] = useState<AffectedBooking[]>([]);
  const [exceptionDate, setExceptionDate] = useState(today);
  const [exceptionKind, setExceptionKind] = useState<ExceptionKind>("CLOSED");
  const [allDay, setAllDay] = useState(true);
  const [exceptionStart, setExceptionStart] = useState("08:00");
  const [exceptionEnd, setExceptionEnd] = useState("17:00");
  const [exceptionLabel, setExceptionLabel] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getOperatingCalendar({});
      setWeekly(result.data.weekly);
      setExceptions(result.data.exceptions);
    } catch (caught) {
      console.error(caught);
      setError(errorMessage(caught, "We could not load the operating calendar."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateDay(day: DayKey, patch: Partial<WeeklyDay>) {
    setWeekly((current) => current
      ? { ...current, [day]: { ...current[day], ...patch } }
      : current);
  }

  async function saveDay(day: DayKey) {
    if (!weekly || !canManageWeekly) return;
    const value = weekly[day];
    setSavingDay(day);
    setNotice(null);
    setError(null);
    try {
      const result = await setWeeklyHours({
        day,
        isOpen: value.isOpen,
        openTime: value.openTime,
        closeTime: value.closeTime,
      });
      setWeekly(result.data.weekly);
      setNotice(`${DAYS.find((item) => item.key === day)?.label || "Day"} hours saved.`);
    } catch (caught) {
      console.error(caught);
      setError(errorMessage(caught, "We could not save those hours."));
    } finally {
      setSavingDay(null);
    }
  }

  async function createException() {
    setSavingException(true);
    setNotice(null);
    setError(null);
    setAffectedBookings([]);
    try {
      const result = await addException({
        date: exceptionDate,
        kind: exceptionKind,
        allDay: exceptionKind === "CLOSED" ? allDay : false,
        startTime: exceptionKind === "CLOSED" && allDay ? null : exceptionStart,
        endTime: exceptionKind === "CLOSED" && allDay ? null : exceptionEnd,
        label: exceptionLabel.trim(),
      });
      setExceptions((current) => [...current, result.data.exception]
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt));
      setExceptionLabel("");
      if (result.data.affectedBookingCount > 0) {
        setAffectedBookings(result.data.affectedBookings);
        setNotice(
          `Schedule updated. ${result.data.affectedBookingCount} confirmed booking${result.data.affectedBookingCount === 1 ? "" : "s"} overlap this closure and need staff attention.`,
        );
      } else {
        setNotice(exceptionKind === "OPEN" ? "Special opening added." : "Closure added. New bookings are blocked for that time.");
      }
    } catch (caught) {
      console.error(caught);
      setError(errorMessage(caught, "We could not add that schedule exception."));
    } finally {
      setSavingException(false);
    }
  }

  async function removeException(exception: ScheduleException) {
    setDeletingException(exception.id);
    setNotice(null);
    setError(null);
    try {
      await deleteException({ exceptionId: exception.id });
      setExceptions((current) => current.filter((item) => item.id !== exception.id));
      setNotice("Schedule exception removed.");
    } catch (caught) {
      console.error(caught);
      setError(errorMessage(caught, "We could not remove that schedule exception."));
    } finally {
      setDeletingException(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading operating calendar…
      </div>
    );
  }

  if (!weekly) {
    return <p className="py-8 text-sm text-slate-600">Operating hours are unavailable.</p>;
  }

  return (
    <div className="space-y-10">
      {notice && (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-950">{notice}</div>
      )}
      {error && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div>
      )}

      {affectedBookings.length > 0 && (
        <section className="border-y border-amber-200 bg-amber-50/60 py-5">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold text-amber-950">Existing bookings need attention</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                The closure blocks new bookings but does not silently cancel confirmed reservations or bypass their cancellation/refund lifecycle.
              </p>
              <div className="mt-3 space-y-2 text-sm text-amber-950">
                {affectedBookings.map((booking) => (
                  <div key={booking.id}>
                    <span className="font-medium">{booking.userName}</span> · {booking.resourceName} · {formatBookingTime(booking.start)}–{formatBookingTime(booking.end)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500">Regular schedule</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">Weekly booking hours</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              These hours control which times customers can select. Dated closures and special openings below override the regular schedule.
            </p>
          </div>
          {!canManageWeekly && (
            <p className="text-sm text-slate-500">Staff can view regular hours; an admin changes the weekly schedule.</p>
          )}
        </div>

        <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
          {DAYS.map(({ key, label }) => {
            const day = weekly[key];
            const endChoices = timeOptions(true).filter((value) => value > day.openTime);
            return (
              <div key={key} className="grid gap-3 py-4 sm:grid-cols-[140px_120px_1fr_auto] sm:items-center">
                <p className="font-medium text-slate-950">{label}</p>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={day.isOpen}
                    disabled={!canManageWeekly}
                    onChange={(event) => updateDay(key, { isOpen: event.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {day.isOpen ? "Open" : "Closed"}
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={day.openTime}
                    disabled={!canManageWeekly || !day.isOpen}
                    onChange={(event) => {
                      const nextOpen = event.target.value;
                      const nextClose = day.closeTime <= nextOpen
                        ? timeOptions(true).find((value) => value > nextOpen) || "20:00"
                        : day.closeTime;
                      updateDay(key, { openTime: nextOpen, closeTime: nextClose });
                    }}
                    className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-base disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {timeOptions(false).map((value) => <option key={value} value={value}>{formatClock(value)}</option>)}
                  </select>
                  <span className="text-slate-400">to</span>
                  <select
                    value={day.closeTime}
                    disabled={!canManageWeekly || !day.isOpen}
                    onChange={(event) => updateDay(key, { closeTime: event.target.value })}
                    className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-base disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {endChoices.map((value) => <option key={value} value={value}>{formatClock(value)}</option>)}
                  </select>
                </div>
                {canManageWeekly && (
                  <button
                    type="button"
                    onClick={() => saveDay(key)}
                    disabled={savingDay === key}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-800 disabled:opacity-50"
                  >
                    {savingDay === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Save
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-8">
        <p className="text-sm font-medium text-slate-500">Date exceptions</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">Closures & special openings</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Use a closure for holidays, weather, maintenance, or an unexpected event. Admins can also create a one-off special opening, such as Saturday hours for a reservation.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[170px_180px_1fr]">
          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 block">Date</span>
            <input
              type="date"
              min={today}
              value={exceptionDate}
              onChange={(event) => setExceptionDate(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base"
            />
          </label>

          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 block">Action</span>
            <select
              value={exceptionKind}
              onChange={(event) => {
                const next = event.target.value as ExceptionKind;
                setExceptionKind(next);
                if (next === "OPEN") setAllDay(false);
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base"
            >
              <option value="CLOSED">Close booking hours</option>
              {canManageWeekly && <option value="OPEN">Special opening</option>}
            </select>
          </label>

          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 block">Reason / label</span>
            <input
              value={exceptionLabel}
              onChange={(event) => setExceptionLabel(event.target.value)}
              placeholder="Holiday, maintenance, weather…"
              maxLength={120}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base"
            />
          </label>
        </div>

        {exceptionKind === "CLOSED" && (
          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Closed for the full booking day
          </label>
        )}

        {(!allDay || exceptionKind === "OPEN") && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-slate-800">
              <span className="mb-2 flex items-center gap-2"><Clock3 className="h-4 w-4" /> Start</span>
              <select
                value={exceptionStart}
                onChange={(event) => setExceptionStart(event.target.value)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-base"
              >
                {timeOptions(false).map((value) => <option key={value} value={value}>{formatClock(value)}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-800">
              <span className="mb-2 block">End</span>
              <select
                value={exceptionEnd}
                onChange={(event) => setExceptionEnd(event.target.value)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-base"
              >
                {timeOptions(true).filter((value) => value > exceptionStart).map((value) => (
                  <option key={value} value={value}>{formatClock(value)}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={createException}
          disabled={savingException}
          className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {savingException ? <Loader2 className="h-5 w-5 animate-spin" /> : exceptionKind === "CLOSED" ? <CalendarOff className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          {exceptionKind === "CLOSED" ? "Add closure" : "Add special opening"}
        </button>
      </section>

      <section className="border-t border-slate-200 pt-8">
        <h2 className="text-xl font-semibold text-slate-950">Upcoming exceptions</h2>
        {exceptions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No upcoming closures or special openings.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
            {exceptions.map((exception) => {
              const staffCannotRemoveOpening = exception.kind === "OPEN" && !canManageWeekly;
              return (
                <div key={exception.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-950">{exception.date}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${exception.kind === "OPEN" ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>
                        {formatException(exception)}
                      </span>
                    </div>
                    {exception.label && <p className="mt-1 text-sm text-slate-500">{exception.label}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeException(exception)}
                    disabled={deletingException === exception.id || staffCannotRemoveOpening}
                    title={staffCannotRemoveOpening ? "An admin must remove a special opening." : "Remove exception"}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {deletingException === exception.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
