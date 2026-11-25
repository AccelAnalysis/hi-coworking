"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, limit, orderBy, query, updateDoc } from "firebase/firestore";
import { Loader2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { db } from "@/lib/firebase";
import {
  VISIT_FEEDBACK_COLLECTION,
  displayName,
  formatEastern,
  fromVisitFeedbackDoc,
  matchesVisitFeedbackSearch,
  readableAnswers,
  visitFeedbackCsv,
  type VisitFeedbackRow,
  type VisitFeedbackStatus,
} from "@/lib/adminVisitFeedback";

export default function VisitFeedbackAdminPage() {
  return (
    <RequireAuth requiredRole="admin">
      <VisitFeedbackAdminContent />
    </RequireAuth>
  );
}

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#101D4B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

type Filter = "all" | "submitted" | VisitFeedbackStatus;

export function VisitFeedbackAdminContent() {
  const [rows, setRows] = useState<VisitFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("submitted");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(query(collection(db, VISIT_FEEDBACK_COLLECTION), orderBy("createdAt", "desc"), limit(500)));
      const next = snap.docs.map((item) => fromVisitFeedbackDoc(item.id, item.data() as Record<string, unknown>));
      setRows(next);
      setNotes(Object.fromEntries(next.map((row) => [row.id, row.adminNotes])));
    } catch (caught) {
      console.error(caught);
      setError("Visit feedback couldn't be loaded. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    return rows.filter((row) => (filter === "all" || row.status === filter) && matchesVisitFeedbackSearch(row, search));
  }, [rows, filter, search]);

  async function saveNotes(row: VisitFeedbackRow) {
    setSaving(row.id);
    try {
      await updateDoc(doc(db, VISIT_FEEDBACK_COLLECTION, row.id), {
        adminNotes: (notes[row.id] || "").slice(0, 4000),
        adminNotesUpdatedAt: Date.now(),
      });
    } catch (caught) {
      console.error(caught);
      setError("Notes couldn't be saved. Try again.");
    } finally {
      setSaving(null);
    }
  }

  function downloadCsv() {
    const csv = visitFeedbackCsv(visible);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const day = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `hi-coworking-visit-feedback-${filter}-${day}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#101D4B]" style={{ fontFamily: "var(--font-fraunces), Georgia, serif" }}>
              Visit feedback
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Answers from the post-attendance survey. These are not leads and are stored separately.
              Only start a personal follow-up when the visitor gave consent.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
            <button type="button" className={primary} onClick={downloadCsv} disabled={visible.length === 0}>
              Export CSV ({visible.length})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-700">
            Status
            <select className="ml-2 min-h-11 rounded-full border border-slate-300 px-3 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">All</option>
              <option value="submitted">Submitted</option>
              <option value="sent">Invited, not submitted</option>
              <option value="failed">Send failed</option>
              <option value="invited">Invited (pending send)</option>
            </select>
          </label>
          <input
            className="min-h-11 min-w-64 flex-1 rounded-full border border-slate-300 px-4 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or booking ID"
          />
        </div>

        {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-slate-500">No visit feedback matches this view.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Visitor</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Booking</th>
                  <th className="px-4 py-3 font-medium">NPS</th>
                  <th className="px-4 py-3 font-medium">Consent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <Fragment key={row.id}>
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                      onClick={() => setOpenId((id) => (id === row.id ? null : row.id))}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{displayName(row)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.email || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.bookingId || "—"}</td>
                      <td className="px-4 py-3">{row.nps === null ? "—" : row.nps}</td>
                      <td className="px-4 py-3">{row.followupConsent ? "Yes" : "No"}</td>
                      <td className="px-4 py-3 capitalize">{row.status}</td>
                      <td className="px-4 py-3 text-slate-600">{formatEastern(row.submittedAt || row.invitedAt)}</td>
                    </tr>
                    {openId === row.id ? (
                      <tr className="border-b border-slate-200 bg-slate-50/80">
                        <td colSpan={7} className="px-4 py-5">
                          <dl className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <dt className="text-xs uppercase tracking-wide text-slate-500">Booking ID</dt>
                              <dd className="font-mono text-sm">{row.bookingId}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-wide text-slate-500">Visit</dt>
                              <dd className="text-sm">{formatEastern(row.visitStart)} · {row.resourceName || "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-wide text-slate-500">Audience</dt>
                              <dd className="text-sm capitalize">{row.audience}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-wide text-slate-500">Follow-up</dt>
                              <dd className="text-sm">{row.followupConsent ? `Consent given${row.followupEmail || row.email ? ` · ${row.followupEmail || row.email}` : ""}` : "No consent — do not start a personal follow-up"}</dd>
                            </div>
                          </dl>
                          <div className="mt-4 space-y-2">
                            {readableAnswers(row).map((item) => (
                              <div key={item.question}>
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.question}</p>
                                <p className="text-sm text-slate-800">{item.answer}</p>
                              </div>
                            ))}
                          </div>
                          <label className="mt-4 block text-sm font-medium text-slate-700">
                            Staff notes
                            <textarea
                              className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                              maxLength={4000}
                              value={notes[row.id] || ""}
                              onChange={(e) => setNotes((current) => ({ ...current, [row.id]: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </label>
                          <button type="button" className={`${primary} mt-3`} disabled={saving === row.id} onClick={(e) => { e.stopPropagation(); void saveNotes(row); }}>
                            {saving === row.id ? "Saving…" : "Save notes"}
                          </button>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
