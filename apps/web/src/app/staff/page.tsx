"use client";

import Link from "next/link";
import { CalendarCheck2, DoorOpen } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";

export default function StaffDashboardPage() {
  return (
    <RequireAuth requiredRole="staff">
      <AppShell>
        <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Staff</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Today at Hi</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">Open the tools you need while operating the space.</p>

          <div className="mt-9 grid gap-5 sm:grid-cols-2">
            <Link href="/staff/events" className="group rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md">
              <CalendarCheck2 className="h-7 w-7 text-sky-700" />
              <h2 className="mt-5 text-2xl font-semibold text-slate-950">Event check-in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Open attendee rosters, check people in, and add walk-ins.</p>
              <span className="mt-5 inline-flex text-sm font-semibold text-sky-800 group-hover:text-sky-950">Open events →</span>
            </Link>

            <Link href="/admin/access" className="group rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md">
              <DoorOpen className="h-7 w-7 text-slate-700" />
              <h2 className="mt-5 text-2xl font-semibold text-slate-950">Access</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Review active facility access and help with entry when needed.</p>
              <span className="mt-5 inline-flex text-sm font-semibold text-slate-700 group-hover:text-slate-950">Open access →</span>
            </Link>
          </div>
        </main>
      </AppShell>
    </RequireAuth>
  );
}
