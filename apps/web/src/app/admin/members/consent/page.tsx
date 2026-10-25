"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { callableErrorMessage } from "@/lib/callableError";
import { functions } from "@/lib/firebase";

type ConsentFilter = "sms-opted-in" | "sms-opted-out" | "email-opted-out" | "do-not-contact" | "suppressed";

type ConsentRow = {
  uid: string | null;
  displayName: string | null;
  email: string | null;
  smsOptIn: boolean | null;
  smsUpdatedAt: number | null;
  smsOptOutReason: string | null;
  marketingOptOut: boolean;
  doNotContact: boolean;
  suppressionReason: string | null;
  updatedAt: number | null;
};

type ConsentList = { filter: ConsentFilter; rows: ConsentRow[]; truncated: boolean };

const listConsent = httpsCallable<{ filter: ConsentFilter }, ConsentList>(functions, "admin_consentList");

const FILTERS: Array<{ id: ConsentFilter; label: string; hint: string }> = [
  { id: "sms-opted-in", label: "Texts: opted in", hint: "Members who agreed to receive text messages." },
  { id: "sms-opted-out", label: "Texts: opted out", hint: "Members who opted out, by request or by replying STOP." },
  { id: "email-opted-out", label: "Email: unsubscribed", hint: "Members who unsubscribed from marketing email." },
  { id: "do-not-contact", label: "Do not contact", hint: "Members marked do not contact. No marketing email or texts." },
  { id: "suppressed", label: "Email suppression list", hint: "Every address that marketing and nurture email skip, members or not." },
];

function formatDateTime(timestamp?: number | null) {
  if (!timestamp) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function words(value?: string | null) {
  if (!value) return "—";
  return value.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default function ConsentListPage() {
  return (
    <RequireAuth requiredRole="admin">
      <ConsentListContent />
    </RequireAuth>
  );
}

function ConsentListContent() {
  const [filter, setFilter] = useState<ConsentFilter>("sms-opted-in");
  const [data, setData] = useState<ConsentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (next: ConsentFilter) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listConsent({ filter: next });
      setData(result.data);
    } catch (err) {
      setData(null);
      setError(callableErrorMessage(err, "Could not load the consent list."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = data?.filter === filter ? data.rows : [];
    if (!needle) return all;
    return all.filter((row) => `${row.displayName || ""} ${row.email || ""}`.toLowerCase().includes(needle));
  }, [data, filter, search]);

  const active = FILTERS.find((item) => item.id === filter)!;
  const smsView = filter === "sms-opted-in" || filter === "sms-opted-out";

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Consent and suppressions</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Who can get marketing texts and email. Read-only: members change their own choices on the Preferences page.</p>
          </div>
          <button
            type="button"
            onClick={() => void load(filter)}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:self-auto"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            List
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as ConsentFilter)}
              aria-describedby="consent-filter-hint"
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900"
            >
              {FILTERS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Search name or email
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                id="consent-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm font-normal text-slate-900"
              />
            </span>
          </label>
        </div>
        <p id="consent-filter-hint" className="mt-2 text-sm text-slate-600">{active.hint}</p>

        {error && (
          <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" aria-hidden="true" />
            <span className="sr-only">Loading consent list</span>
          </div>
        ) : (
          !error && (
            <>
              <p className="mt-6 text-sm text-slate-600" role="status">
                {rows.length} {rows.length === 1 ? "entry" : "entries"}
                {data?.truncated ? " (showing the first 500)" : ""}
              </p>
              {rows.length === 0 ? (
                <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-600">Nobody is on this list.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <caption className="sr-only">{active.label}</caption>
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold">{filter === "suppressed" ? "Email" : "Member"}</th>
                        {smsView && <th scope="col" className="px-4 py-3 font-semibold">Texts</th>}
                        {smsView && filter === "sms-opted-out" && <th scope="col" className="px-4 py-3 font-semibold">Reason</th>}
                        {!smsView && <th scope="col" className="px-4 py-3 font-semibold">{filter === "suppressed" ? "Reason" : "Email status"}</th>}
                        <th scope="col" className="px-4 py-3 font-semibold">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row, index) => (
                        <tr key={row.uid || `${row.email}-${index}`}>
                          <th scope="row" className="px-4 py-3 font-normal">
                            {row.uid ? (
                              <Link href={`/admin/members/record?uid=${encodeURIComponent(row.uid)}`} className="font-semibold text-sky-800 hover:underline">
                                {row.displayName || row.email || "Member"}
                              </Link>
                            ) : (
                              <span className="text-slate-900">{row.email || "Address not stored"}</span>
                            )}
                            {row.uid && row.displayName && row.email && <span className="block text-xs text-slate-600">{row.email}</span>}
                          </th>
                          {smsView && <td className="px-4 py-3 text-slate-700">{row.smsOptIn ? "Opted in" : "Opted out"}</td>}
                          {smsView && filter === "sms-opted-out" && <td className="px-4 py-3 text-slate-700">{words(row.smsOptOutReason)}</td>}
                          {!smsView && (
                            <td className="px-4 py-3 text-slate-700">
                              {filter === "suppressed"
                                ? words(row.suppressionReason)
                                : [row.marketingOptOut && "Unsubscribed", row.doNotContact && "Do not contact"].filter(Boolean).join(", ") || "—"}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(smsView ? row.smsUpdatedAt : row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        )}
      </div>
    </AppShell>
  );
}
