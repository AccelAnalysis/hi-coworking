"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { OperatingHoursManager } from "@/components/OperatingHoursManager";
import { RequireAuth } from "@/components/RequireAuth";

export default function AdminSpacesPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AppShell>
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-sm font-medium text-slate-500">Bookings & spaces</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Operating hours & closures</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Set the regular hours customers can book, close dates or time ranges, and create one-off special openings without bypassing the booking transaction lifecycle.
          </p>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            To stop selling a space, use <Link href="/admin/spaces/offerings" className="font-semibold text-slate-950 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-950">Offered spaces</Link>. The Private Office can be turned off or back on there without changing hours.
          </p>
          <div className="mt-9">
            <OperatingHoursManager />
          </div>
        </main>
      </AppShell>
    </RequireAuth>
  );
}
