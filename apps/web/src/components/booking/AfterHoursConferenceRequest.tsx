"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";
import { CONFERENCE_ROOM_CONFIG, afterHoursSlotsForDate, formatUsdCents, isWeekendDateKey } from "@hi/shared";
import { functions } from "@/lib/firebase";
import { callableErrorMessage } from "@/lib/callableError";

type Slot = {
  id: string;
  kind: string;
  label: string;
  timeLabel: string;
  start: string;
  end: string;
  available: boolean;
};

const listSlots = httpsCallable<{ date: string }, { date: string; priceCents: number; capacity: number; slots: Slot[] }>(
  functions,
  "booking_listAfterHoursConferenceSlots",
);
const requestSlot = httpsCallable<
  { date: string; start: string; end: string; name: string; email: string; phone?: string; notes?: string },
  { success: boolean; id: string; status: string; priceCents: number }
>(functions, "booking_requestAfterHoursConference");

export function AfterHoursConferenceRequest({ date }: { date: string }) {
  const [slots, setSlots] = useState<Slot[]>(afterHoursSlotsForDate(date).map((slot) => ({ ...slot, available: true })));
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDone(false);
    setError(null);
    setSelected(null);
    setLoading(true);
    setSlots(afterHoursSlotsForDate(date).map((slot) => ({ ...slot, available: true })));
    void listSlots({ date })
      .then((result) => {
        if (!cancelled) setSlots(result.data.slots);
      })
      .catch((caught) => {
        if (!cancelled) setError(callableErrorMessage(caught, "We could not load evening and weekend times."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const selectedSlot = slots.find((slot) => `${slot.start}-${slot.end}` === selected);
  const heading = isWeekendDateKey(date) ? "Weekend 4-hour slot" : "Weekday evening 4-hour slot";

  async function submit() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestSlot({
        date,
        start: selectedSlot.start,
        end: selectedSlot.end,
        name,
        email,
        phone,
        notes,
      });
      setDone(true);
    } catch (caught) {
      setError(callableErrorMessage(caught, "We could not send that request. Please try another time."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="after-hours" className="mt-8 rounded-2xl border border-[#C5CADB] bg-white p-5" data-testid="after-hours-conference-request">
      <h3 className="font-display text-lg font-semibold text-[#101D4B]">Evening and weekend, by appointment</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        {formatUsdCents(CONFERENCE_ROOM_CONFIG.afterHoursSlotPriceCents)} for a 4-hour slot, seated for {CONFERENCE_ROOM_CONFIG.maxCapacity}.
        A principal opens and closes the space, and weekday desks stay as they are. We will confirm after we review your request.
      </p>

      {done ? (
        <p className="mt-4 rounded-xl bg-[#EEF0F6] px-4 py-3 text-sm text-[#101D4B]" role="status">
          Request received. We will email {email.trim() || "you"} once the {selectedSlot?.timeLabel} slot is reviewed.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium text-[#101D4B]">{heading}</p>
          {loading ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading times…
            </p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {slots.map((slot) => {
                const key = `${slot.start}-${slot.end}`;
                const active = selected === key;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!slot.available}
                    onClick={() => setSelected(key)}
                    className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] disabled:cursor-not-allowed disabled:opacity-40 ${
                      active ? "border-[#101D4B] bg-[#101D4B] text-white" : "border-[#C5CADB] bg-white text-[#101D4B] hover:bg-[#EEF0F6]"
                    }`}
                  >
                    <span>
                      <span className="block font-semibold">{slot.label}</span>
                      <span className={active ? "text-white/80" : "text-slate-600"}>{slot.timeLabel}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatUsdCents(CONFERENCE_ROOM_CONFIG.afterHoursSlotPriceCents)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-[#101D4B]">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-base text-slate-950" />
            </label>
            <label className="text-sm font-medium text-[#101D4B]">
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-base text-slate-950" />
            </label>
            <label className="text-sm font-medium text-[#101D4B] sm:col-span-2">
              Phone <span className="font-normal text-slate-500">(optional)</span>
              <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-base text-slate-950" />
            </label>
            <label className="text-sm font-medium text-[#101D4B] sm:col-span-2">
              Event notes <span className="font-normal text-slate-500">(optional)</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-base text-slate-950" />
            </label>
          </div>

          {error ? <p className="mt-3 text-sm text-rose-800" role="alert">{error}</p> : null}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !selectedSlot || name.trim().length < 2 || !email.includes("@")}
            className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#101D4B] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#3A4675] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Request this 4-hour slot
          </button>
        </>
      )}
    </div>
  );
}
