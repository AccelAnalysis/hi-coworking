"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { CheckCircle2, ClipboardList, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { ADMIN_CAPABILITIES } from "@/lib/adminCapabilities";
import { callableErrorMessage } from "@/lib/callableError";
import { db } from "@/lib/firebase";
import {
  FOLLOW_UPS_COLLECTION,
  FOLLOW_UP_TYPE_LABELS,
  adminFollowUpSetStatus,
  sortFollowUps,
  toFollowUpItem,
  type FollowUpItem,
  type FollowUpType,
} from "@/lib/followUps";

export default function FollowUpsAdminPage() {
  return (
    <RequireAuth requiredRole="admin">
      <FollowUpsContent />
    </RequireAuth>
  );
}

const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50";
const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#101D4B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

function formatWhen(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function FollowUpsContent() {
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FollowUpType | "all">("all");
  const [showDone, setShowDone] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(query(collection(db, FOLLOW_UPS_COLLECTION), orderBy("createdAt", "desc"), limit(300)));
      setItems(sortFollowUps(snap.docs.map((d) => toFollowUpItem(d.id, d.data())).filter((i): i is FollowUpItem => i !== null)));
    } catch (caught) {
      console.error(caught);
      setError("Follow-ups couldn't be loaded. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => items.filter((i) => (filter === "all" || i.type === filter) && (showDone || i.status === "open")),
    [items, filter, showDone],
  );
  const openCount = items.filter((i) => i.status === "open").length;

  async function setStatus(item: FollowUpItem, status: "open" | "done") {
    setSaving(item.id);
    setNotice(null);
    setError(null);
    try {
      const note = (notes[item.id] || "").trim();
      await adminFollowUpSetStatus({ id: item.id, status, ...(note ? { note } : {}) });
      setNotice(status === "done" ? "Marked done." : "Reopened.");
      await load();
    } catch (caught) {
      setError(callableErrorMessage(caught, "That change didn't save. Try again."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Member &amp; Event Operations</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Follow-ups</h1>
          <button type="button" className={button} onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Refresh
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-slate-600">
          Visits with no check-out, bookings with no check-in
          {ADMIN_CAPABILITIES.virtualAddress.live ? ", and virtual address paperwork" : ""}. Open the
          member or booking, follow up, then mark the item done.
        </p>
        {!ADMIN_CAPABILITIES.followUps.live ? (
          <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900" role="status">
            {ADMIN_CAPABILITIES.followUps.note}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="follow-up-type">Type</label>
          <select
            id="follow-up-type"
            className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FollowUpType | "all")}
          >
            <option value="all">All types</option>
            {(Object.keys(FOLLOW_UP_TYPE_LABELS) as FollowUpType[]).map((t) => (
              <option key={t} value={t}>{FOLLOW_UP_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show done
          </label>
          <span className="text-sm text-slate-600" role="status">{openCount} open</span>
        </div>

        {notice ? <p className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">{notice}</p> : null}
        {error ? <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-900" role="alert">{error}</p> : null}

        {loading ? (
          <p className="mt-8 flex items-center gap-2 text-sm text-slate-600" role="status">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading follow-ups…
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-slate-50 p-6 text-sm text-slate-700">
            <ClipboardList aria-hidden="true" className="mb-2 h-5 w-5" />
            Nothing to follow up right now.
          </p>
        ) : (
          <ul className="mt-6 space-y-4" data-testid="follow-up-list">
            {visible.map((item) => (
              <li key={item.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#101D4B]">{FOLLOW_UP_TYPE_LABELS[item.type]}</p>
                    <p className="mt-1 text-xs text-slate-500">Flagged {formatWhen(item.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.status === "open" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                    {item.status === "open" ? "Open" : "Done"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{item.reason}</p>
                {item.billingCapAt ? (
                  <p className="mt-1 text-sm text-slate-700">Billed through {formatWhen(item.billingCapAt)}.</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className="py-2 text-slate-600">Member ID <code className="rounded bg-slate-100 px-1">{item.memberId}</code></span>
                  {item.bookingId ? <span className="py-2 text-slate-600">Booking <code className="rounded bg-slate-100 px-1">{item.bookingId}</code></span> : null}
                  <Link className="min-h-11 py-2 font-medium text-[#101D4B] underline underline-offset-4" href="/admin/members">Open members</Link>
                  {item.visitId || item.bookingId ? (
                    <Link className="min-h-11 py-2 font-medium text-[#101D4B] underline underline-offset-4" href="/admin/front-desk">Open front desk</Link>
                  ) : null}
                </div>
                {item.status === "done" && item.resolutionNote ? (
                  <p className="mt-2 text-sm text-slate-600">Note: {item.resolutionNote}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  {item.status === "open" ? (
                    <>
                      <label className="flex-1 text-sm text-slate-700">
                        <span className="block font-medium">Note (optional)</span>
                        <input
                          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                          maxLength={500}
                          value={notes[item.id] || ""}
                          onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                        />
                      </label>
                      <button type="button" className={primary} disabled={saving === item.id} onClick={() => void setStatus(item, "done")}>
                        {saving === item.id ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="h-4 w-4" />}
                        Mark done
                      </button>
                    </>
                  ) : (
                    <button type="button" className={button} disabled={saving === item.id} onClick={() => void setStatus(item, "open")}>
                      <RotateCcw aria-hidden="true" className="h-4 w-4" />
                      Reopen
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
