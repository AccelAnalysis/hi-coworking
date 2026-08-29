"use client";

import Link from "next/link";
import { CalendarCheck2, Clock3 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";

export default function StaffDashboardPage() {
  return (
    <RequireAuth requiredRole="staff">
      <AppShell>
        <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Staff</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Today at Hi</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">Open the tools available to staff while operating the space.</p>

          <div className="mt-9 grid max-w-3xl gap-4 sm:grid-cols-2">
            <Link href="/staff/events" className="group block rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md">
              <CalendarCheck2 className="h-7 w-7 text-sky-700" />
              <h2 className="mt-5 text-2xl font-semibold text-slate-950">Event check-in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Open attendee rosters, check people in, and add walk-ins.</p>
              <span className="mt-5 inline-flex text-sm font-semibold text-sky-800 group-hover:text-sky-950">Open events →</span>
            </Link>

            <Link href="/staff/hours" className="group block rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md">
              <Clock3 className="h-7 w-7 text-sky-700" />
              <h2 className="mt-5 text-2xl font-semibold text-slate-950">Hours & closures</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Close booking times for holidays, weather, maintenance, or an unexpected event.</p>
              <span className="mt-5 inline-flex text-sm font-semibold text-sky-800 group-hover:text-sky-950">Manage schedule →</span>
            </Link>
          </div>
        </main>
      </AppShell>
    </RequireAuth>
  );
}
