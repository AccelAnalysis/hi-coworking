"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import {
  staffGetEventRosterV2,
  staffListUpcomingEventsV2,
  staffSetEventCheckInV2,
  type StaffEventSummary,
  type StaffRegistration,
} from "@/lib/eventFunctionsV2";
import { ArrowLeft, Calendar, Loader2, Search, Users } from "lucide-react";

export default function StaffEventsPage() {
  return (
    <RequireAuth requiredRole="staff">
      <AppShell><StaffEventsContent /></AppShell>
    </RequireAuth>
  );
}

function StaffEventsContent() {
  const [events, setEvents] = useState<StaffEventSummary[]>([]);
  const [selected, setSelected] = useState<StaffEventSummary | null>(null);
  const [registrations, setRegistrations] = useState<StaffRegistration[]>([]);
  const [summary, setSummary] = useState({ registeredQuantity: 0, checkedInQuantity: 0 });
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    void staffListUpcomingEventsV2({}).then((result) => setEvents(result.data.events)).finally(() => setLoading(false));
  }, []);

  async function openEvent(event: StaffEventSummary) {
    setSelected(event);
    setLoading(true);
    try {
      const result = await staffGetEventRosterV2({ eventId: event.id });
      setRegistrations(result.data.registrations);
      setSummary(result.data.summary);
      setWaitlistCount(result.data.waitlistCount);
    } finally {
      setLoading(false);
    }
  }

  async function setCheckIn(registration: StaffRegistration, next: number) {
    setUpdatingId(registration.id);
    try {
      const result = await staffSetEventCheckInV2({ registrationId: registration.id, checkedInQuantity: next });
      setRegistrations((rows) => rows.map((row) => row.id === registration.id ? { ...row, checkedInQuantity: result.data.checkedInQuantity } : row));
      setSummary((current) => ({
        ...current,
        checkedInQuantity: current.checkedInQuantity - registration.checkedInQuantity + result.data.checkedInQuantity,
      }));
    } finally {
      setUpdatingId("");
    }
  }

  const filtered = registrations.filter((registration) => {
    const value = `${registration.displayName} ${registration.email}`.toLowerCase();
    return value.includes(query.trim().toLowerCase());
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/staff" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Staff</Link>
      <div className="mt-6 flex items-end justify-between gap-4">
        <div><p className="text-sm font-medium text-slate-500">Today & upcoming</p><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Event check-in</h1></div>
      </div>

      {loading && !selected ? <Loader2 className="mt-12 h-6 w-6 animate-spin text-slate-400" /> : !selected ? (
        <div className="mt-8 divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
          {events.map((event) => (
            <button key={event.id} onClick={() => openEvent(event)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50">
              <div><p className="font-semibold text-slate-900">{event.title}</p><p className="mt-1 text-sm text-slate-500">{new Date(event.startTime).toLocaleString()} {event.location ? `· ${event.location}` : ""}</p></div>
              <span className="text-sm text-slate-500">{event.confirmedQuantity} registered</span>
            </button>
          ))}
          {!events.length && <p className="p-8 text-sm text-slate-500">No upcoming events.</p>}
        </div>
      ) : (
        <>
          <button onClick={() => setSelected(null)} className="mt-6 text-sm font-medium text-indigo-700">← Choose another event</button>
          <div className="mt-5 rounded-3xl bg-slate-900 p-6 text-white">
            <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-300">{new Date(selected.startTime).toLocaleString()}</p><h2 className="mt-1 text-2xl font-semibold">{selected.title}</h2></div><div className="flex gap-6 text-sm"><span><strong className="block text-2xl">{summary.registeredQuantity}</strong> registered</span><span><strong className="block text-2xl">{summary.checkedInQuantity}</strong> checked in</span><span><strong className="block text-2xl">{waitlistCount}</strong> waiting</span></div></div>
          </div>

          <label className="mt-6 flex items-center gap-2 rounded-full bg-white px-4 py-3 ring-1 ring-slate-200"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search attendees" className="w-full border-0 bg-transparent text-sm outline-none" /></label>
          <div className="mt-4 divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
            {filtered.map((registration) => (
              <div key={registration.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0"><p className="truncate font-medium text-slate-900">{registration.displayName}</p><p className="truncate text-sm text-slate-500">{registration.email} · {registration.checkedInQuantity}/{registration.quantity} checked in</p></div>
                <div className="flex items-center gap-2">
                  {registration.checkedInQuantity > 0 && <button disabled={updatingId === registration.id} onClick={() => setCheckIn(registration, Math.max(0, registration.checkedInQuantity - 1))} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">Undo 1</button>}
                  <button disabled={updatingId === registration.id || registration.checkedInQuantity >= registration.quantity} onClick={() => setCheckIn(registration, registration.checkedInQuantity + 1)} className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Check in</button>
                </div>
              </div>
            ))}
            {!filtered.length && <div className="p-8 text-center text-sm text-slate-500"><Users className="mx-auto mb-2 h-5 w-5" />No attendees match.</div>}
          </div>
        </>
      )}
    </main>
  );
}
