"use client";

import { FormEvent, useId, useState } from "react";
import { Loader2, Save } from "lucide-react";
import type { EventSeriesDoc } from "@hi/shared";
import { upsertEventSeriesFn } from "@/lib/functions";
import { callableErrorMessage } from "@/lib/callableError";
import {
  SERIES_WEEKDAYS,
  buildWeeklyRRule,
  facilityDateInputValue,
  facilityDateToEpoch,
  parseWeeklyRRule,
} from "@/lib/eventSeriesForm";

type Props = {
  /** Existing series to edit; omit to create a new one. */
  initial?: EventSeriesDoc | null;
  onSaved: (seriesId: string, occurrences: number) => void;
  onCancel: () => void;
};

const inputClass =
  "mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900";
const labelClass = "block text-sm font-medium text-slate-700";

export function EventSeriesForm({ initial, onSaved, onCancel }: Props) {
  const formId = useId();
  const rule = parseWeeklyRRule(initial?.rrule);
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [format, setFormat] = useState<EventSeriesDoc["format"]>(initial?.format || "in-person");
  const [location, setLocation] = useState(initial?.location || "Hi Coworking, Carrollton, VA");
  const [virtualUrl, setVirtualUrl] = useState(initial?.virtualUrl || "");
  const [startDate, setStartDate] = useState(facilityDateInputValue(initial?.seriesStartDate));
  const [endDate, setEndDate] = useState(facilityDateInputValue(initial?.seriesEndDate));
  const [days, setDays] = useState<string[]>(rule.days.length ? rule.days : ["TU"]);
  const [interval, setInterval] = useState(String(rule.interval));
  const [startTime, setStartTime] = useState(initial?.startTimeOfDay || "10:00");
  const [duration, setDuration] = useState(String(initial?.durationMins || 60));
  const [seatCap, setSeatCap] = useState(initial?.seatCap ? String(initial.seatCap) : "");
  const [price, setPrice] = useState(initial?.price ? (initial.price / 100).toFixed(2) : "0");
  const [status, setStatus] = useState<EventSeriesDoc["status"]>(initial?.status || "draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (code: string) =>
    setDays((current) => (current.includes(code) ? current.filter((value) => value !== code) : [...current, code]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const seriesStartDate = facilityDateToEpoch(startDate);
    if (!seriesStartDate) {
      setError("Choose the date the series starts.");
      return;
    }
    if (days.length === 0) {
      setError("Pick at least one day of the week.");
      return;
    }
    const priceCents = Math.round(Number(price || 0) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError("Enter a price of $0 or more.");
      return;
    }
    setSaving(true);
    try {
      const result = await upsertEventSeriesFn({
        series: {
          ...(initial?.id ? { id: initial.id } : {}),
          title,
          description,
          format,
          location: format === "virtual" ? "" : location,
          virtualUrl: format === "in-person" ? "" : virtualUrl,
          seriesStartDate,
          seriesEndDate: facilityDateToEpoch(endDate) ?? null,
          rrule: buildWeeklyRRule(days, Number(interval) || 1),
          startTimeOfDay: startTime,
          durationMins: Number(duration),
          seatCap: seatCap ? Number(seatCap) : null,
          price: priceCents,
          currency: "USD",
          status,
        },
      });
      onSaved(result.data.seriesId, result.data.occurrences ?? 0);
    } catch (caught) {
      setError(callableErrorMessage(caught, "The series couldn't be saved. Try again in a moment."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} aria-labelledby={`${formId}-title`} className="mb-8 rounded-xl border border-slate-200 bg-white p-5">
      <h2 id={`${formId}-title`} className="text-lg font-semibold text-slate-900">
        {initial ? "Edit series" : "New recurring series"}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        In-person and hybrid dates have to fall Monday to Friday, 8 AM to 5 PM Eastern. Virtual series can run any time.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className={`${labelClass} md:col-span-2`}>
          Title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} maxLength={200} />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          Description
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={5000}
            className={`${inputClass} py-2`}
          />
        </label>
        <label className={labelClass}>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as EventSeriesDoc["format"])} className={inputClass}>
            <option value="in-person">In person</option>
            <option value="hybrid">Hybrid</option>
            <option value="virtual">Virtual</option>
          </select>
        </label>
        <label className={labelClass}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as EventSeriesDoc["status"])} className={inputClass}>
            <option value="draft">Draft (admins only)</option>
            <option value="published">Published (public calendar)</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        {format !== "virtual" ? (
          <label className={labelClass}>
            Location
            <input required value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} />
          </label>
        ) : null}
        {format !== "in-person" ? (
          <label className={labelClass}>
            Virtual link
            <input type="url" placeholder="https://" value={virtualUrl} onChange={(e) => setVirtualUrl(e.target.value)} className={inputClass} />
          </label>
        ) : null}
        <label className={labelClass}>
          First date
          <input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>
          Last date (optional)
          <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </label>
        <fieldset className="md:col-span-2">
          <legend className={labelClass}>Repeats on</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {SERIES_WEEKDAYS.map((day) => {
              const checked = days.includes(day.code);
              return (
                <label
                  key={day.code}
                  className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-slate-900 ${
                    checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleDay(day.code)} />
                  <span aria-hidden="true">{day.short}</span>
                  <span className="sr-only">{day.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className={labelClass}>
          Every
          <select value={interval} onChange={(e) => setInterval(e.target.value)} className={inputClass}>
            <option value="1">Week</option>
            <option value="2">2 weeks</option>
            <option value="3">3 weeks</option>
            <option value="4">4 weeks</option>
          </select>
        </label>
        <label className={labelClass}>
          Start time (Eastern)
          <input required type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>
          Length (minutes)
          <input required type="number" min={15} max={720} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>
          Seat cap (optional)
          <input type="number" min={1} max={5000} value={seatCap} onChange={(e) => setSeatCap(e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>
          Price per seat (USD, 0 for free)
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {initial ? "Save series" : "Create series"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-5 text-sm font-medium text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
