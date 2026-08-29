"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { CalendarDays, DoorOpen, RotateCcw } from "lucide-react";

export default function StaffDashboardPage() {
  return (
    <RequireAuth requiredRole="staff">
      <AppShell><StaffDashboardContent /></AppShell>
    </RequireAuth>
  );
}

function StaffDashboardContent() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm font-medium text-slate-500">Today</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Staff</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Link href="/staff/events" className="group rounded-2xl bg-white p-6 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
          <CalendarDays className="h-6 w-6 text-slate-500" />
          <h2 className="mt-8 text-lg font-semibold text-slate-900">Events & check-in</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Open today&apos;s event roster, check people in, and see the waitlist.</p>
        </Link>
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <DoorOpen className="h-6 w-6 text-slate-500" />
          <h2 className="mt-8 text-lg font-semibold text-slate-900">Arrivals</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Booking and access arrivals remain available through the facility workflow.</p>
        </div>
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <RotateCcw className="h-6 w-6 text-slate-500" />
          <h2 className="mt-8 text-lg font-semibold text-slate-900">Room resets</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Keep turnover tasks visible without exposing internal system metadata.</p>
        </div>
      </div>
    </main>
  );
}
