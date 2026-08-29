"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { checkInEventRegistrationV2, getEventRosterV2 } from "@/lib/eventFunctions";
import { Check, Loader2, Search, Users } from "lucide-react";

type RegistrationRow = {
  id: string;
  displayName?: string;
  email?: string;
  quantity?: number;
  checkedInQuantity?: number;
  status?: string;
  attendanceStatus?: string;
};

export default function StaffEventManagePage() {
  return (
    <RequireAuth requiredRole="staff">
      <Suspense fallback={<AppShell><div className="py-24 text-center text-slate-500">Loading roster…</div></AppShell>}>
        <Roster />
      </Suspense>
    </RequireAuth>
  );
}

function Roster() {
  const eventId = useSearchParams().get("id") || "";
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const result = await getEventRosterV2({ eventId });
      setRows(result.data.registrations as RegistrationRow[]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.displayName || ""} ${row.email || ""}`.toLowerCase().includes(needle));
  }, [rows, search]);

  const confirmed = rows.filter((row) => row.status === "CONFIRMED");
  const checkedIn = confirmed.reduce((sum, row) => sum + Number(row.checkedInQuantity || 0), 0);
  const registered = confirmed.reduce((sum, row) => sum + Number(row.quantity || 1), 0);

  async function checkIn(row: RegistrationRow) {
    setWorkingId(row.id);
    try {
      await checkInEventRegistrationV2({ registrationId: row.id, quantity: row.quantity || 1 });
      await load();
    } finally {
      setWorkingId("");
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <Link href="/staff" className="text-sm font-medium text-slate-600 hover:text-slate-900">← Staff</Link>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-700">Event operations</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Attendee check-in</h1>
            <p className="mt-2 text-sm text-slate-500">{registered} registered · {checkedIn} checked in</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" className="w-full rounded-full border border-slate-300 py-3 pl-10 pr-4 text-sm" />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
        ) : !visible.length ? (
          <div className="py-20 text-center text-slate-500"><Users className="mx-auto mb-3 h-9 w-9 text-slate-300" />No matching attendees.</div>
        ) : (
          <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
            {visible.map((row) => {
              const quantity = Number(row.quantity || 1);
              const count = Number(row.checkedInQuantity || 0);
              const done = count >= quantity;
              return (
                <div key={row.id} className="flex items-center gap-4 py-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {done ? <Check className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{row.displayName || "Guest"}</p>
                    <p className="truncate text-sm text-slate-500">{row.email || "No email"}{quantity > 1 ? ` · ${quantity} tickets` : ""}</p>
                  </div>
                  <button type="button" onClick={() => checkIn(row)} disabled={done || workingId === row.id || row.status !== "CONFIRMED"} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-45">
                    {workingId === row.id ? "Checking in…" : done ? "Checked in" : "Check in"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}
