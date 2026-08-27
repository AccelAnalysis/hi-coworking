"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CalendarClock, Loader2, XCircle } from "lucide-react";
import { functions } from "@/lib/firebase";

const previewCancellation = httpsCallable<{ bookingId: string }, {
  bookingId: string;
  decision: { outcome: string; reason: string; refundPercent: number; accountCreditPercent: number; restoreIncludedHoursPercent: number };
  refundCents: number;
  accountCreditCents: number;
  includedHoursToRestore: number;
  canReschedule: boolean;
}>(functions, "booking_getCancellationPreview");

const cancelBooking = httpsCallable<{ bookingId: string }, { success: boolean }>(functions, "booking_cancel");
const rescheduleBooking = httpsCallable<{ bookingId: string; start: number; end: number }, { success: boolean }>(functions, "booking_reschedule");

type Props = {
  bookingId: string;
  resourceName: string;
  start: number;
  end: number;
};

type Preview = Awaited<ReturnType<typeof previewCancellation>>["data"];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function easternParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${v.hour}:${v.minute}` };
}

function easternEpoch(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const v = Object.fromEntries(local.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour), Number(v.minute));
  return guess - (representedAsUtc - guess);
}

export function BookingManagementCard({ bookingId, resourceName, start, end }: Props) {
  const initial = easternParts(start);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateValue, setDateValue] = useState(initial.date);
  const [timeValue, setTimeValue] = useState(initial.time);

  async function openManager() {
    setOpen(true);
    if (preview) return;
    setLoading(true); setError(null);
    try {
      setPreview((await previewCancellation({ bookingId })).data);
    } catch (err) {
      console.error(err);
      setError("We could not load the current cancellation policy for this booking.");
    } finally { setLoading(false); }
  }

  async function doCancel() {
    if (!preview) return;
    if (!window.confirm("Cancel this booking using the consequences shown here?")) return;
    setLoading(true); setError(null);
    try {
      await cancelBooking({ bookingId });
      window.location.reload();
    } catch (err) {
      console.error(err);
      setError("The booking was not cancelled. No new charge was made. Please try again or contact Hi Coworking.");
      setLoading(false);
    }
  }

  async function doReschedule() {
    const newStart = easternEpoch(dateValue, timeValue);
    const newEnd = newStart + (end - start);
    setLoading(true); setError(null);
    try {
      await rescheduleBooking({ bookingId, start: newStart, end: newEnd });
      window.location.reload();
    } catch (err) {
      console.error(err);
      setError("That new time could not be secured. Your original booking is unchanged.");
      setLoading(false);
    }
  }

  if (!open) {
    return <button type="button" onClick={openManager} className="mt-4 text-sm font-semibold text-slate-900 underline underline-offset-4">Manage booking</button>;
  }

  return (
    <div className="mt-5 rounded-2xl bg-slate-50 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-950">Manage {resourceName}</p>
          <p className="mt-1 text-sm text-slate-600">Changes are evaluated against the policy at the moment you confirm them.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">Close</button>
      </div>

      {loading && !preview ? <div className="mt-5 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading policy…</div> : null}
      {error ? <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p> : null}

      {preview ? (
        <>
          <div className="mt-5 grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-white p-3"><span className="block text-slate-500">Refund</span><strong className="mt-1 block text-slate-950">{money(preview.refundCents)}</strong></div>
            <div className="rounded-xl bg-white p-3"><span className="block text-slate-500">Hi credit</span><strong className="mt-1 block text-slate-950">{money(preview.accountCreditCents)}</strong></div>
            <div className="rounded-xl bg-white p-3"><span className="block text-slate-500">Hours restored</span><strong className="mt-1 block text-slate-950">{preview.includedHoursToRestore}</strong></div>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{preview.decision.reason}</p>

          {preview.canReschedule ? (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <div className="flex items-center gap-2 font-semibold text-slate-950"><CalendarClock className="h-4 w-4" /> Reschedule</div>
              <p className="mt-1 text-sm text-slate-600">Keep the same space and duration. Rescheduling is free while you are still in the full-refund window.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3" />
                <input type="time" step={1800} value={timeValue} onChange={(e) => setTimeValue(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3" />
              </div>
              <button type="button" disabled={loading} onClick={doReschedule} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">Move booking</button>
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-white p-3 text-sm text-slate-600">This booking is inside the late-cancellation window, so rescheduling is disabled to prevent bypassing the cancellation policy. You can cancel under the terms above and make a new booking.</p>
          )}

          <div className="mt-6 border-t border-slate-200 pt-5">
            <button type="button" disabled={loading} onClick={doCancel} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-red-200 bg-white px-5 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"><XCircle className="h-4 w-4" /> Cancel booking</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
