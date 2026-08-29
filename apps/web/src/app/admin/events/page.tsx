"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Loader2, Pencil, Plus, Users, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getAllEvents } from "@/lib/firestore";
import {
  adminCancelEventV2,
  adminCompleteEventV2,
  adminPublishEventV2,
  type EventPublic,
} from "@/lib/eventsV2";

function AdminEventsContent() {
  const [events, setEvents] = useState<EventPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getAllEvents();
      setEvents((rows as EventPublic[]).sort((a, b) => b.startTime - a.startTime));
    } catch (error) {
      console.error(error);
      setMessage("Could not load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function publish(eventId: string) {
    setBusyId(eventId);
    setMessage(null);
    try {
      await adminPublishEventV2({ eventId });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not publish this event.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(event: EventPublic) {
    if (!window.confirm(`Cancel “${event.title}”? Confirmed paid registrations will be queued for full refunds.`)) return;
    setBusyId(event.id);
    setMessage(null);
    try {
      await adminCancelEventV2({ eventId: event.id });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel this event.");
    } finally {
      setBusyId(null);
    }
  }

  async function complete(event: EventPublic) {
    if (!window.confirm(`Complete “${event.title}” and mark unchecked registrations as no-shows?`)) return;
    setBusyId(event.id);
    setMessage(null);
    try {
      await adminCompleteEventV2({ eventId: event.id });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not complete this event.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Events</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">Create, publish, and operate community events without exposing the underlying event machinery.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/staff/events" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
              <Users className="h-4 w-4" /> Check-in
            </Link>
            <Link href="/admin/events/series" className="inline-flex rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">Recurring series</Link>
            <Link href="/admin/events/new" className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> New event
            </Link>
          </div>
        </div>

        {message && <p className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>}

        {loading ? (
          <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
        ) : events.length === 0 ? (
          <div className="mt-12 border-t border-slate-200 py-16">
            <CalendarDays className="h-8 w-8 text-slate-300" />
            <h2 className="mt-4 text-2xl font-semibold text-slate-950">No events yet.</h2>
            <Link href="/admin/events/new" className="mt-5 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Create the first event</Link>
          </div>
        ) : (
          <div className="mt-9 divide-y divide-slate-200 border-y border-slate-200">
            {events.map((event) => {
              const confirmed = event.confirmedQuantity ?? event.registrationCount ?? 0;
              const past = event.endTime < Date.now();
              return (
                <div key={event.id} className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold text-slate-950">{event.title}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        event.status === "published" ? "bg-emerald-50 text-emerald-700" :
                        event.status === "cancelled" ? "bg-rose-50 text-rose-700" :
                        event.status === "completed" ? "bg-sky-50 text-sky-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>{event.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {new Date(event.startTime).toLocaleString()} · {confirmed}{event.seatCap ? `/${event.seatCap}` : ""} registered
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/events/detail?event=${encodeURIComponent(event.slug || event.id)}`} className="rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200">View</Link>
                    <Link href={`/admin/events/new?edit=${event.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200"><Pencil className="h-3.5 w-3.5" /> Edit</Link>
                    {event.status === "draft" && (
                      <button type="button" onClick={() => void publish(event.id)} disabled={busyId === event.id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-50">
                        {busyId === event.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Publish
                      </button>
                    )}
                    {event.status === "published" && !past && (
                      <button type="button" onClick={() => void cancel(event)} disabled={busyId === event.id} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3.5 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" /> Cancel</button>
                    )}
                    {event.status === "published" && past && (
                      <button type="button" onClick={() => void complete(event)} disabled={busyId === event.id} className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-2 text-sm font-semibold text-sky-700 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Complete</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}

export default function AdminEventsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminEventsContent />
    </RequireAuth>
  );
}
