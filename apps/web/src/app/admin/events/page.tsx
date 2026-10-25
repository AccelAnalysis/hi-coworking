"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Loader2, Pencil, Plus, Users, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmSheet } from "@/components/admin/ConfirmSheet";
import { callableErrorMessage } from "@/lib/callableError";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: "cancel" | "complete"; event: EventPublic } | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getAllEvents();
      setEvents((rows as EventPublic[]).sort((a, b) => b.startTime - a.startTime));
    } catch (error) {
      console.error(error);
      setMessage("Couldn't load events. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function publish(eventId: string) {
    setBusyId(eventId);
    setMessage(null);
    setNotice(null);
    try {
      await adminPublishEventV2({ eventId });
      setNotice("Event published.");
      await load();
    } catch (error) {
      setMessage(callableErrorMessage(error, "Couldn't publish this event. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  function closeSheet() {
    setPending(null);
    setReason("");
  }

  async function confirmPending() {
    if (!pending) return;
    const { kind, event } = pending;
    setBusyId(event.id);
    setMessage(null);
    setNotice(null);
    try {
      if (kind === "cancel") {
        const result = await adminCancelEventV2({ eventId: event.id, reason: reason.trim() || undefined });
        const { cancelledRegistrations, refundReviewRegistrations } = result.data;
        setNotice(
          `“${event.title}” is cancelled. ${cancelledRegistrations} registration${cancelledRegistrations === 1 ? "" : "s"} cancelled` +
          (refundReviewRegistrations ? `, ${refundReviewRegistrations} paid registration${refundReviewRegistrations === 1 ? "" : "s"} waiting for refund review` : "") +
          ". No one was emailed.",
        );
      } else {
        const result = await adminCompleteEventV2({ eventId: event.id });
        const { noShows } = result.data;
        setNotice(`“${event.title}” is complete. ${noShows} registration${noShows === 1 ? "" : "s"} marked as no-show.`);
      }
      closeSheet();
      await load();
    } catch (error) {
      closeSheet();
      setMessage(callableErrorMessage(error, kind === "cancel" ? "Couldn't cancel this event. Try again." : "Couldn't complete this event. Try again."));
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
            <Link href="/admin/events/submissions" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
              Submissions
            </Link>
            <Link href="/staff/events" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
              <Users className="h-4 w-4" /> Check-in
            </Link>
            <Link href="/admin/events/series" className="inline-flex rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">Recurring series</Link>
            <Link href="/admin/events/new" className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> New event
            </Link>
          </div>
        </div>

        <div aria-live="polite">
          {message && <p role="alert" className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">{message}</p>}
          {notice && <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
        </div>

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
                    <Link href={`/events/detail?event=${encodeURIComponent(event.slug || event.id)}`} className="inline-flex min-h-11 items-center rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200">View</Link>
                    <Link href={`/staff/events?event=${encodeURIComponent(event.id)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200"><Users className="h-3.5 w-3.5" aria-hidden="true" /> Roster</Link>
                    <Link href={`/admin/events/new?edit=${event.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200"><Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit</Link>
                    {event.status === "draft" && (
                      <button type="button" onClick={() => void publish(event.id)} disabled={busyId === event.id} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-50">
                        {busyId === event.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Publish
                      </button>
                    )}
                    {event.status === "published" && !past && (
                      <button type="button" onClick={() => setPending({ kind: "cancel", event })} disabled={busyId === event.id} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-rose-50 px-3.5 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cancel event</button>
                    )}
                    {event.status === "published" && past && (
                      <button type="button" onClick={() => setPending({ kind: "complete", event })} disabled={busyId === event.id} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-2 text-sm font-semibold text-sky-700 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Complete</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <ConfirmSheet
          open={pending !== null}
          title={pending?.kind === "cancel" ? `Cancel “${pending.event.title}”?` : `Complete “${pending?.event.title ?? ""}”?`}
          confirmLabel={pending?.kind === "cancel" ? "Cancel event" : "Complete event"}
          destructive={pending?.kind === "cancel"}
          busy={pending !== null && busyId === pending.event.id}
          onConfirm={confirmPending}
          onClose={closeSheet}
        >
          {pending?.kind === "cancel" ? (
            <>
              <p>The event comes off the public calendar and every registration is cancelled.</p>
              <p>No one is emailed and no refunds are issued automatically. Paid registrations are held for an admin to review the refund. Let registrants know yourself.</p>
              <label className="block">
                <span className="font-semibold text-slate-900">Reason (optional, internal)</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="mt-1 w-full rounded-2xl border border-slate-300 p-3 text-sm"
                />
              </label>
            </>
          ) : (
            <p>Anyone who wasn&apos;t checked in is marked as a no-show. You can&apos;t reopen a completed event.</p>
          )}
        </ConfirmSheet>
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
