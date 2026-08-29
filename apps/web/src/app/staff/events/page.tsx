"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Search, UserPlus, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  listPublishedEvents,
  staffAddEventWalkIn,
  staffCheckInEventRegistration,
  staffGetEventRoster,
  type EventPublic,
  type EventRegistrationV2,
  type EventWaitlistV2,
} from "@/lib/eventsV2";

type Roster = {
  event: EventPublic;
  registrations: EventRegistrationV2[];
  waitlist: EventWaitlistV2[];
};

function StaffEventsContent() {
  const [events, setEvents] = useState<EventPublic[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [walkInEmail, setWalkInEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function loadRoster(eventId: string) {
    setLoading(true);
    try {
      const result = await staffGetEventRoster({ eventId });
      setRoster(result.data);
      setSelectedId(eventId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the attendee roster.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const rows = await listPublishedEvents({ includePast: true });
        if (!active) return;
        setEvents(rows);
        const first = rows.find((event) => event.endTime >= Date.now() - 6 * 60 * 60 * 1000);
        if (first) await loadRoster(first.id);
        else setLoading(false);
      } catch (error) {
        console.error(error);
        if (active) {
          setMessage("Could not load events.");
          setLoading(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return roster?.registrations || [];
    return (roster?.registrations || []).filter((registration) => (
      registration.displayName.toLowerCase().includes(needle)
      || registration.email.toLowerCase().includes(needle)
    ));
  }, [roster, search]);

  const checkedIn = roster?.registrations.reduce((sum, registration) => sum + (registration.checkedInQuantity || 0), 0) || 0;
  const confirmed = roster?.registrations
    .filter((registration) => registration.status === "CONFIRMED")
    .reduce((sum, registration) => sum + registration.quantity, 0) || 0;
  const waiting = roster?.waitlist.filter((entry) => entry.status === "WAITING" || entry.status === "OFFERED").length || 0;

  async function checkIn(registration: EventRegistrationV2) {
    setBusyId(registration.id);
    setMessage(null);
    try {
      const result = await staffCheckInEventRegistration({
        registrationId: registration.id,
        quantity: registration.quantity,
      });
      setRoster((current) => current ? {
        ...current,
        registrations: current.registrations.map((item) => (
          item.id === registration.id
            ? {
                ...item,
                checkedInQuantity: result.data.checkedInQuantity,
                attendanceStatus: result.data.attendanceStatus as EventRegistrationV2["attendanceStatus"],
                checkedInAt: Date.now(),
              }
            : item
        )),
      } : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check in this attendee.");
    } finally {
      setBusyId(null);
    }
  }

  async function addWalkIn() {
    if (!roster || !walkInName.trim()) return;
    setBusyId("walk-in");
    setMessage(null);
    try {
      await staffAddEventWalkIn({
        eventId: roster.event.id,
        name: walkInName.trim(),
        email: walkInEmail.trim() || undefined,
        quantity: 1,
      });
      setWalkInName("");
      setWalkInEmail("");
      setWalkInOpen(false);
      await loadRoster(roster.event.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add this walk-in.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Staff</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Event check-in</h1>
          </div>
          <Link href="/staff" className="text-sm font-medium text-slate-500 hover:text-slate-950">Staff home</Link>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[17rem_1fr]">
          <aside>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Event</label>
            <select
              value={selectedId}
              onChange={(event) => void loadRoster(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Select event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>{event.title}</option>
              ))}
            </select>

            {roster && (
              <div className="mt-6 space-y-4 border-t border-slate-200 pt-5 text-sm">
                <div><span className="block text-2xl font-semibold text-slate-950">{confirmed}</span><span className="text-slate-500">registered seats</span></div>
                <div><span className="block text-2xl font-semibold text-slate-950">{checkedIn}</span><span className="text-slate-500">checked in</span></div>
                <div><span className="block text-2xl font-semibold text-slate-950">{waiting}</span><span className="text-slate-500">waiting</span></div>
              </div>
            )}
          </aside>

          <section>
            {loading ? (
              <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
            ) : roster ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-5">
                  <div>
                    <h2 className="text-2xl font-semibold text-slate-950">{roster.event.title}</h2>
                    <p className="mt-1 text-sm text-slate-500">{new Date(roster.event.startTime).toLocaleString()}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWalkInOpen((open) => !open)}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
                  >
                    <UserPlus className="h-4 w-4" /> Walk-in
                  </button>
                </div>

                {walkInOpen && (
                  <div className="mt-5 grid gap-3 rounded-2xl bg-slate-100 p-4 sm:grid-cols-[1fr_1fr_auto]">
                    <input value={walkInName} onChange={(event) => setWalkInName(event.target.value)} placeholder="Name" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" />
                    <input value={walkInEmail} onChange={(event) => setWalkInEmail(event.target.value)} placeholder="Email (optional)" type="email" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" />
                    <button type="button" onClick={addWalkIn} disabled={!walkInName.trim() || busyId === "walk-in"} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 ring-1 ring-slate-200 disabled:opacity-50">
                      {busyId === "walk-in" ? "Adding…" : "Add + check in"}
                    </button>
                  </div>
                )}

                <div className="relative mt-5">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search attendee" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm" />
                </div>

                {message && <p className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>}

                <div className="mt-4 divide-y divide-slate-100 border-y border-slate-200">
                  {filtered.map((registration) => {
                    const fullyChecked = registration.checkedInQuantity >= registration.quantity;
                    return (
                      <div key={registration.id} className="flex items-center justify-between gap-4 py-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-950">{registration.displayName}</p>
                          <p className="truncate text-sm text-slate-500">{registration.email} · {registration.quantity} ticket{registration.quantity === 1 ? "" : "s"}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void checkIn(registration)}
                          disabled={fullyChecked || busyId === registration.id || registration.status !== "CONFIRMED"}
                          className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${fullyChecked ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-700 ring-1 ring-slate-200"} disabled:opacity-70`}
                        >
                          {busyId === registration.id ? <Loader2 className="h-4 w-4 animate-spin" /> : fullyChecked ? <Check className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                          {fullyChecked ? "Checked in" : "Check in"}
                        </button>
                      </div>
                    );
                  })}
                  {filtered.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No attendees match this search.</p>}
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-sm text-slate-500">Choose an event to open its roster.</div>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

export default function StaffEventsPage() {
  return (
    <RequireAuth requiredRole="staff">
      <StaffEventsContent />
    </RequireAuth>
  );
}
