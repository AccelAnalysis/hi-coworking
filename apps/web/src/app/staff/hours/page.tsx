"use client";

import { AppShell } from "@/components/AppShell";
import { OperatingHoursManager } from "@/components/OperatingHoursManager";
import { RequireAuth } from "@/components/RequireAuth";

export default function StaffHoursPage() {
  return (
    <RequireAuth requiredRole="staff">
      <AppShell>
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-sm font-medium text-slate-500">Staff operations</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Hours & closures</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            View the regular booking schedule and close a date or time range for holidays, weather, maintenance, or an unexpected event. Admins control regular weekly hours and special openings.
          </p>
          <div className="mt-9">
            <OperatingHoursManager />
          </div>
        </main>
      </AppShell>
    </RequireAuth>
  );
}
