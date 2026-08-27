"use client";

import Link from "next/link";
import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  CalendarClock,
  Download,
  Loader2,
  ReceiptText,
  XCircle,
} from "lucide-react";
import { functions } from "@/lib/firebase";

const previewCancellation = httpsCallable<
  { bookingId: string },
  {
    bookingId: string;
    decision: {
      outcome: string;
      reason: string;
      refundPercent: number;
      accountCreditPercent: number;
      restoreIncludedHoursPercent: number;
    };
    refundCents: number;
    accountCreditCents: number;
    includedHoursToRestore: number;
    canReschedule: boolean;
  }
>(functions, "booking_getCancellationPreview");

const cancelBooking = httpsCallable<
  { bookingId: string },
  { success: boolean }
>(functions, "booking_cancel");

const rescheduleBooking = httpsCallable<
  { bookingId: string; start: number; end: number },
  { success: boolean; accessReady?: boolean }
>(functions, "booking_reschedule");

type Props = {
  bookingId: string;
  resourceId: string;
  resourceName: string;
  start: number;
  end: number;
  amountChargedCents: number;
  subtotalCents: number;
  accountCreditAppliedCents: number;
  paymentMethod: string;
};

type Preview = Awaited<
  ReturnType<typeof previewCancellation>
>["data"];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function easternParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function easternEpoch(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = targetAsUtc;

  for (let pass = 0; pass < 2; pass += 1) {
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      local.map((part) => [part.type, part.value]),
    );
    const observedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
    guess += targetAsUtc - observedAsUtc;
  }

  return guess;
}

function compactUtc(timestamp: number) {
  return new Date(timestamp)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function extensionHref(end: number, resourceId: string) {
  const parts = easternParts(end);
  return `/book?date=${encodeURIComponent(parts.date)}&time=${encodeURIComponent(parts.time)}&duration=1&resource=${encodeURIComponent(resourceId)}`;
}

export function BookingManagementCard({
  bookingId,
  resourceId,
  resourceName,
  start,
  end,
  amountChargedCents,
  subtotalCents,
  accountCreditAppliedCents,
  paymentMethod,
}: Props) {
  const initial = easternParts(start);
  const [open, setOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateValue, setDateValue] = useState(initial.date);
  const [timeValue, setTimeValue] = useState(initial.time);

  async function openManager() {
    setOpen(true);
    if (preview) return;
    setLoading(true);
    setError(null);
    try {
      setPreview((await previewCancellation({ bookingId })).data);
    } catch (caught) {
      console.error(caught);
      setError(
        "We could not load the current cancellation policy for this booking.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function doCancel() {
    if (!preview) return;
    if (
      !window.confirm(
        "Cancel this booking using the refund, credit, and hours shown here?",
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await cancelBooking({ bookingId });
      window.location.reload();
    } catch (caught) {
      console.error(caught);
      setError(
        "The cancellation did not finish. Do not make a replacement booking yet; retry here or contact Hi Coworking.",
      );
      setLoading(false);
    }
  }

  async function doReschedule() {
    const newStart = easternEpoch(dateValue, timeValue);
    const newEnd = newStart + (end - start);
    setLoading(true);
    setError(null);
    try {
      const result = await rescheduleBooking({
        bookingId,
        start: newStart,
        end: newEnd,
      });
      if (!result.data.accessReady && result.data.accessReady !== undefined) {
        throw new Error("Access was not ready for the new booking time.");
      }
      window.location.reload();
    } catch (caught) {
      console.error(caught);
      setError(
        "That change could not be completed safely. Refresh your bookings before trying again; the account record remains authoritative.",
      );
      setLoading(false);
    }
  }

  function downloadCalendar() {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Hi Coworking//Booking//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${escapeIcs(bookingId)}@hi-coworking`,
      `DTSTAMP:${compactUtc(Date.now())}`,
      `DTSTART:${compactUtc(start)}`,
      `DTEND:${compactUtc(end)}`,
      `SUMMARY:${escapeIcs(`Hi Coworking · ${resourceName}`)}`,
      `LOCATION:${escapeIcs("Hi Coworking, Carrollton, Virginia")}`,
      `DESCRIPTION:${escapeIcs(`Booking reference: ${bookingId}`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    const blob = new Blob([`${lines.join("\r\n")}\r\n`], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hi-coworking-${bookingId}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-5 border-t border-slate-200 pt-5">
      <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
        <button
          type="button"
          onClick={downloadCalendar}
          className="inline-flex items-center gap-2 font-semibold text-slate-800 underline underline-offset-4"
        >
          <Download className="h-4 w-4" />
          Add to calendar
        </button>
        <button
          type="button"
          onClick={() => setReceiptOpen((visible) => !visible)}
          className="inline-flex items-center gap-2 font-semibold text-slate-800 underline underline-offset-4"
        >
          <ReceiptText className="h-4 w-4" />
          Receipt
        </button>
        <Link
          href={extensionHref(end, resourceId)}
          className="font-semibold text-slate-800 underline underline-offset-4"
        >
          Extend / book more time
        </Link>
        <button
          type="button"
          onClick={openManager}
          className="font-semibold text-slate-800 underline underline-offset-4"
        >
          Cancel or reschedule
        </button>
      </div>

      {receiptOpen && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Space value</span>
            <span className="font-medium text-slate-900">
              {money(subtotalCents)}
            </span>
          </div>
          {accountCreditAppliedCents > 0 && (
            <div className="mt-2 flex justify-between gap-4">
              <span className="text-slate-500">Account credit applied</span>
              <span className="font-medium text-slate-900">
                −{money(accountCreditAppliedCents)}
              </span>
            </div>
          )}
          <div className="mt-3 flex justify-between gap-4 border-t border-slate-200 pt-3">
            <span className="font-medium text-slate-700">Amount charged</span>
            <span className="font-semibold text-slate-950">
              {money(amountChargedCents)}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Method: {paymentMethod.replaceAll("_", " ").toLowerCase()} ·
            Reference: {bookingId}
          </p>
        </div>
      )}

      {open && (
        <div className="mt-5 rounded-2xl bg-slate-50 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                Manage {resourceName}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Consequences are recalculated when you confirm the change.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-slate-500"
            >
              Close
            </button>
          </div>

          {loading && !preview && (
            <div className="mt-5 flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading policy…
            </div>
          )}
          {error && (
            <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {error}
            </p>
          )}

          {preview && (
            <>
              <div className="mt-5 grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-xl bg-white p-3">
                  <span className="block text-slate-500">Refund</span>
                  <strong className="mt-1 block text-slate-950">
                    {money(preview.refundCents)}
                  </strong>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <span className="block text-slate-500">
                    Account credit
                  </span>
                  <strong className="mt-1 block text-slate-950">
                    {money(preview.accountCreditCents)}
                  </strong>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <span className="block text-slate-500">
                    Hours restored
                  </span>
                  <strong className="mt-1 block text-slate-950">
                    {preview.includedHoursToRestore}
                  </strong>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {preview.decision.reason}
              </p>

              {preview.canReschedule ? (
                <div className="mt-6 border-t border-slate-200 pt-5">
                  <div className="flex items-center gap-2 font-semibold text-slate-950">
                    <CalendarClock className="h-4 w-4" />
                    Reschedule
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Keep the same space and duration. The new booking time is
                    committed only after availability and access are ready.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input
                      type="date"
                      value={dateValue}
                      onChange={(event) => setDateValue(event.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                    />
                    <input
                      type="time"
                      step={1800}
                      value={timeValue}
                      onChange={(event) => setTimeValue(event.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={doReschedule}
                    className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Move booking
                  </button>
                </div>
              ) : (
                <p className="mt-5 rounded-xl bg-white p-3 text-sm text-slate-600">
                  This booking is inside the late-cancellation window.
                  Rescheduling is disabled so the cancellation policy cannot be
                  bypassed. You may cancel under the terms above and make a new
                  booking.
                </p>
              )}

              <div className="mt-6 border-t border-slate-200 pt-5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={doCancel}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-red-200 bg-white px-5 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel booking
                </button>
              </div>
            </>
          )}

          <p className="mt-5 text-xs text-slate-500">
            Resource: {resourceId}
          </p>
        </div>
      )}
    </div>
  );
}
