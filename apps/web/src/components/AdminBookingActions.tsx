"use client";

import { useEffect, useId, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CalendarClock, Loader2, XCircle } from "lucide-react";
import { functions } from "@/lib/firebase";
import { callableErrorMessage } from "@/lib/callableError";
import {
  CANCELLATION_CHOICE_COPY,
  cancellationSummary,
  easternEpoch,
  easternParts,
  startTimeOptions,
  timeLabel,
  type AdminCancellationChoice,
  type AdminCancellationOption,
  type OpenInterval,
} from "@/lib/adminBookingActions";

type ManagedBooking = {
  id: string;
  resourceName: string;
  resourceId: string;
  start: number | null;
  end: number | null;
};

type CancelPreview = { bookingId: string; hasCardPayment: boolean; options: AdminCancellationOption[] };

const previewCancellation = httpsCallable<{ bookingId: string }, CancelPreview>(functions, "admin_bookingCancelPreview");
const cancelBooking = httpsCallable<
  { bookingId: string; choice: AdminCancellationChoice; note: string },
  { success: boolean }
>(functions, "admin_bookingCancel");
const rescheduleBooking = httpsCallable<
  { bookingId: string; start: number; end: number; note: string },
  { success: boolean; accessCleanupPending?: boolean }
>(functions, "admin_bookingReschedule");
const getDaySchedule = httpsCallable<{ date: string }, { isOpen: boolean; intervals: OpenInterval[] }>(
  functions,
  "booking_getDaySchedule",
);

type Mode = "closed" | "cancel" | "move";

export function AdminBookingActions({
  booking,
  memberName,
  onChanged,
}: {
  booking: ManagedBooking;
  memberName: string;
  onChanged: (message: string) => void | Promise<void>;
}) {
  const panelId = useId();
  const [mode, setMode] = useState<Mode>("closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // Cancel state
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [choice, setChoice] = useState<AdminCancellationChoice | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Move state
  const durationMinutes = booking.start && booking.end ? Math.round((booking.end - booking.start) / 60_000) : 0;
  const [dateValue, setDateValue] = useState(() => (booking.start ? easternParts(booking.start).date : ""));
  const [timeOptions, setTimeOptions] = useState<string[]>([]);
  const [timeValue, setTimeValue] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const today = easternParts(Date.now()).date;
  const label = booking.resourceName || booking.resourceId || "this booking";

  function reset(next: Mode) {
    setMode(next);
    setError(null);
    setNote("");
    setChoice(null);
    setConfirming(false);
  }

  async function openCancel() {
    if (mode === "cancel") return reset("closed");
    reset("cancel");
    setBusy(true);
    try {
      const result = await previewCancellation({ bookingId: booking.id });
      setPreview(result.data);
    } catch (caught) {
      setError(callableErrorMessage(caught, "Could not load the cancellation options. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function openMove() {
    reset(mode === "move" ? "closed" : "move");
  }

  useEffect(() => {
    if (mode !== "move" || !dateValue) return;
    let active = true;
    setScheduleMessage(null);
    setTimeOptions([]);
    getDaySchedule({ date: dateValue })
      .then((result) => {
        if (!active) return;
        const options = result.data.isOpen ? startTimeOptions(result.data.intervals, durationMinutes) : [];
        setTimeOptions(options);
        if (!result.data.isOpen) setScheduleMessage("Hi Coworking is closed that day. Choose another date.");
        else if (options.length === 0) setScheduleMessage("A booking this long does not fit in that day's open hours.");
        const current = booking.start ? easternParts(booking.start) : null;
        setTimeValue(current && current.date === dateValue && options.includes(current.time) ? current.time : options[0] || "");
      })
      .catch(() => {
        if (active) setScheduleMessage("Could not load the open hours for that date.");
      });
    return () => {
      active = false;
    };
  }, [mode, dateValue, durationMinutes, booking.start]);

  async function confirmCancel() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await cancelBooking({ bookingId: booking.id, choice, note });
      reset("closed");
      await onChanged(`${label} for ${memberName} was cancelled.`);
    } catch (caught) {
      setError(callableErrorMessage(caught, "The booking was not cancelled. Try again."));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmMove() {
    if (!dateValue || !timeValue || durationMinutes <= 0) return;
    const start = easternEpoch(dateValue, timeValue);
    setBusy(true);
    setError(null);
    try {
      const result = await rescheduleBooking({ bookingId: booking.id, start, end: start + durationMinutes * 60_000, note });
      reset("closed");
      await onChanged(
        result.data.accessCleanupPending
          ? `${label} was moved. The old door code is still being removed; check Door access if it persists.`
          : `${label} for ${memberName} was moved to ${dateValue} at ${timeLabel(timeValue)}.`,
      );
    } catch (caught) {
      setError(callableErrorMessage(caught, "The booking was not moved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const selected = preview?.options.find((option) => option.choice === choice) || null;

  return (
    <div className="sm:col-span-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <button
          type="button"
          onClick={openMove}
          aria-expanded={mode === "move"}
          aria-controls={panelId}
          className="inline-flex min-h-11 items-center gap-2 font-semibold text-slate-800 underline underline-offset-4"
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" /> Move
        </button>
        <button
          type="button"
          onClick={() => void openCancel()}
          aria-expanded={mode === "cancel"}
          aria-controls={panelId}
          className="inline-flex min-h-11 items-center gap-2 font-semibold text-red-700 underline underline-offset-4"
        >
          <XCircle className="h-4 w-4" aria-hidden="true" /> Cancel booking
        </button>
      </div>

      <div id={panelId}>
        {mode !== "closed" && (
          <div className="mt-3 rounded-2xl bg-slate-50 p-4 sm:p-5">
            {error && (
              <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
                {error}
              </p>
            )}

            {mode === "cancel" && (
              <>
                {busy && !preview && (
                  <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading options…
                  </p>
                )}
                {preview && !confirming && (
                  <fieldset>
                    <legend className="text-sm font-semibold text-slate-950">Why is this booking being cancelled?</legend>
                    <div className="mt-3 grid gap-2">
                      {preview.options.map((option) => (
                        <label
                          key={option.choice}
                          className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3 text-sm ${choice === option.choice ? "border-slate-900" : "border-slate-200"}`}
                        >
                          <input
                            type="radio"
                            name={`${panelId}-choice`}
                            value={option.choice}
                            checked={choice === option.choice}
                            onChange={() => setChoice(option.choice)}
                            className="mt-1 h-4 w-4"
                          />
                          <span>
                            <span className="block font-semibold text-slate-950">{CANCELLATION_CHOICE_COPY[option.choice].label}</span>
                            <span className="mt-1 block text-slate-600">{CANCELLATION_CHOICE_COPY[option.choice].hint}</span>
                            <span className="mt-1 block font-medium text-slate-800">{cancellationSummary(option)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </>
            )}

            {mode === "move" && (
              <div>
                <p className="text-sm font-semibold text-slate-950">Move {label}</p>
                <p id={`${panelId}-move-help`} className="mt-1 text-sm text-slate-600">
                  Same space and length ({durationMinutes / 60} hr). Only open times are listed. Admin moves are allowed inside the member&apos;s 24-hour change window.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-slate-700">
                    New date
                    <input
                      type="date"
                      min={today}
                      value={dateValue}
                      onChange={(event) => setDateValue(event.target.value)}
                      aria-describedby={`${panelId}-move-help ${panelId}-schedule`}
                      className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    New start time
                    <select
                      value={timeValue}
                      onChange={(event) => setTimeValue(event.target.value)}
                      disabled={timeOptions.length === 0}
                      aria-describedby={`${panelId}-schedule`}
                      className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 disabled:opacity-60"
                    >
                      {timeOptions.map((time) => (
                        <option key={time} value={time}>{timeLabel(time)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p id={`${panelId}-schedule`} role="status" className="mt-2 min-h-5 text-sm text-amber-900">
                  {scheduleMessage || ""}
                </p>
              </div>
            )}

            {((mode === "cancel" && preview) || mode === "move") && !confirming && (
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Note for the audit log (optional)
                <textarea
                  value={note}
                  maxLength={500}
                  rows={2}
                  onChange={(event) => setNote(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                />
              </label>
            )}

            {mode === "cancel" && confirming && selected && (
              <div role="alertdialog" aria-labelledby={`${panelId}-confirm-title`} aria-describedby={`${panelId}-confirm-body`}>
                <p id={`${panelId}-confirm-title`} className="text-sm font-semibold text-slate-950">
                  Cancel {label} for {memberName}?
                </p>
                <p id={`${panelId}-confirm-body`} className="mt-1 text-sm text-slate-700">
                  {cancellationSummary(selected)} The door code is removed. This cannot be undone.
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              {mode === "cancel" && !confirming && (
                <button
                  type="button"
                  disabled={!choice || busy}
                  onClick={() => setConfirming(true)}
                  className="inline-flex min-h-11 items-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Review cancellation
                </button>
              )}
              {mode === "cancel" && confirming && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmCancel()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-red-700 px-5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Confirm cancellation
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-11 px-3 text-sm font-semibold text-slate-700">
                    Go back
                  </button>
                </>
              )}
              {mode === "move" && (
                <button
                  type="button"
                  disabled={busy || !timeValue}
                  onClick={() => void confirmMove()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Move booking
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => reset("closed")} className="min-h-11 px-3 text-sm font-semibold text-slate-600">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
