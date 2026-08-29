"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { AddToCalendar } from "@/components/AddToCalendar";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  listMyEventRegistrations,
  type EventPublic,
  type EventRegistrationV2,
} from "@/lib/eventsV2";

type Row = { registration: EventRegistrationV2; event: EventPublic };

function MyEventsContent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const result = await listMyEventRegistrations({});
        if (!active) return;
        const events = new Map(result.data.events.map((event) => [event.id, event]));
        setRows(result.data.registrations
          .map((registration) => {
            const event = events.get(registration.eventId);
            return event ? { registration, event } : null;
          })
          .filter((row): row is Row => Boolean(row)));
      } catch (error) {
        console.error(error);
        if (active) setMessage("We couldn’t load your event registrations.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const upcoming = useMemo(() => rows
    .filter((row) => row.event.endTime >= Date.now() && row.registration.status === "CONFIRMED")
    .sort((a, b) => a.event.startTime - b.event.startTime), [rows]);
  const history = useMemo(() => rows
    .filter((row) => !upcoming.includes(row))
    .sort((a, b) => b.event.startTime - a.event.startTime), [rows, upcoming]);

  function RegistrationRow({ row }: { row: Row }) {
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: row.event.timezone || "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(row.event.startTime));
    return (
      <div className="grid gap-4 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">{row.event.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{date} · {row.registration.quantity} ticket{row.registration.quantity === 1 ? "" : "s"}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{row.registration.status.replaceAll("_", " ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/events/detail?event=${encodeURIComponent(row.event.slug || row.event.id)}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">View</Link>
          {row.registration.status === "CONFIRMED" && row.event.endTime >= Date.now() && <AddToCalendar event={row.event} />}
          {row.registration.status === "CONFIRMED" && (
            <Link href={`/events/manage?registration=${encodeURIComponent(row.registration.id)}`} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Manage</Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Account</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">My events</h1>
          </div>
          <div className="flex gap-3 text-sm font-semibold">
            <Link href="/account/bookings" className="text-slate-500 hover:text-slate-950">Bookings</Link>
            <Link href="/events" className="text-sky-800 hover:text-sky-950">Find events</Link>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
        ) : message ? (
          <p className="mt-8 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="border-b border-slate-200 pb-4 text-2xl font-semibold text-slate-950">Upcoming</h2>
              {upcoming.length ? (
                <div className="divide-y divide-slate-200">{upcoming.map((row) => <RegistrationRow key={row.registration.id} row={row} />)}</div>
              ) : (
                <div className="py-10 text-sm text-slate-500">
                  <CalendarDays className="mb-3 h-7 w-7 text-slate-300" />
                  You don&apos;t have an upcoming event registration.
                </div>
              )}
            </section>

            {history.length > 0 && (
              <section className="mt-10">
                <h2 className="border-b border-slate-200 pb-4 text-2xl font-semibold text-slate-950">Past & cancelled</h2>
                <div className="divide-y divide-slate-200">{history.map((row) => <RegistrationRow key={row.registration.id} row={row} />)}</div>
              </section>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

export default function MyEventsPage() {
  return (
    <RequireAuth>
      <MyEventsContent />
    </RequireAuth>
  );
}
