"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Download, Loader2, Search, UserPlus, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { callableErrorMessage } from "@/lib/callableError";
import { rosterCsv, rosterCsvFilename } from "@/lib/rosterCsv";
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
  const [notice, setNotice] = useState<string | null>(null);

  async function loadRoster(eventId: string) {
    setLoading(true);
    try {
      const result = await staffGetEventRoster({ eventId });
      setRoster(result.data);
      setSelectedId(eventId);
    } catch (error) {
      setMessage(callableErrorMessage(error, "Couldn't load the attendee roster. Try again."));
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
        // /staff/events?event=ID opens that roster directly (linked from Admin > Events),
        // including cancelled or completed events that aren't in the published list.
        const requested = new URLSearchParams(window.location.search).get("event");
        const first = rows.find((event) => event.endTime >= Date.now() - 6 * 60 * 60 * 1000);
        if (requested) await loadRoster(requested);
        else if (first) await loadRoster(first.id);
        else setLoading(false);
      } catch (error) {
        console.error(error);
        if (active) {
          setMessage("Couldn't load events. Check your connection and refresh.");
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
      setMessage(callableErrorMessage(error, "Couldn't check in this attendee. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  async function addWalkIn() {
    if (!roster || !walkInName.trim()) return;
    setBusyId("walk-in");
    setMessage(null);
    setNotice(null);
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
      setNotice("Walk-in added and checked in.");
      await loadRoster(roster.event.id);
    } catch (error) {
      setMessage(callableErrorMessage(error, "Couldn't add this walk-in. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  function downloadCsv() {
    if (!roster) return;
    const blob = new Blob([rosterCsv(roster.registrations)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = rosterCsvFilename(roster.event.title, roster.event.startTime);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const selectableEvents = roster && !events.some((event) => event.id === roster.event.id)
    ? [roster.event, ...events]
    : events;

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
            <label htmlFor="staff-event-select" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Event</label>
            <select
              id="staff-event-select"
              value={selectedId}
              onChange={(event) => void loadRoster(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Select event</option>
              {selectableEvents.map((event) => (
                <option key={event.id} value={event.id}>{event.title}{event.status !== "published" ? ` (${event.status})` : ""}</option>
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
              <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="h-7 w-7 animate-spin text-slate-400" aria-hidden="true" /><span className="sr-only">Loading roster</span></div>
            ) : roster ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-5">
                  <div>
                    <h2 className="text-2xl font-semibold text-slate-950">{roster.event.title}</h2>
                    <p className="mt-1 text-sm text-slate-500">{new Date(roster.event.startTime).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={downloadCsv}
                      disabled={roster.registrations.length === 0}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" /> Download CSV
                    </button>
                    {roster.event.status === "published" && (
                      <button
                        type="button"
                        onClick={() => setWalkInOpen((open) => !open)}
                        aria-expanded={walkInOpen}
                        aria-controls="walk-in-form"
                        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
                      >
                        <UserPlus className="h-4 w-4" aria-hidden="true" /> Walk-in
                      </button>
                    )}
                  </div>
                </div>

                {walkInOpen && (
                  <div id="walk-in-form" className="mt-5 grid gap-3 rounded-2xl bg-slate-100 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <label className="text-sm font-medium text-slate-700">
                      Name
                      <input value={walkInName} onChange={(event) => setWalkInName(event.target.value)} autoComplete="off" className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Email (optional)
                      <input value={walkInEmail} onChange={(event) => setWalkInEmail(event.target.value)} type="email" autoComplete="off" className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                    </label>
                    <p className="text-xs text-slate-600 sm:col-span-3 sm:order-last">Walk-ins don&apos;t get a confirmation email.</p>
                    <button type="button" onClick={addWalkIn} disabled={!walkInName.trim() || busyId === "walk-in"} className="min-h-11 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 ring-1 ring-slate-300 disabled:opacity-50">
                      {busyId === "walk-in" ? "Adding…" : "Add + check in"}
                    </button>
                  </div>
                )}

                <div className="relative mt-5">
                  <label htmlFor="attendee-search" className="sr-only">Search attendees</label>
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true" />
                  <input id="attendee-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search attendee" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm" />
                </div>

                <div aria-live="polite">
                  {message && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">{message}</p>}
                  {notice && <p className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
                </div>

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
                          aria-label={fullyChecked ? `${registration.displayName} is checked in` : registration.status !== "CONFIRMED" ? `${registration.displayName}: ${registration.status.toLowerCase().replace(/_/g, " ")}` : `Check in ${registration.displayName}`}
                          className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${fullyChecked ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-700 ring-1 ring-slate-200"} disabled:opacity-70`}
                        >
                          {busyId === registration.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : fullyChecked ? <Check className="h-4 w-4" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
                          {fullyChecked ? "Checked in" : registration.status !== "CONFIRMED" ? registration.status.toLowerCase().replace(/_/g, " ") : "Check in"}
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
