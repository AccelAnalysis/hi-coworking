"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { adminListEventSubmissions, type EventSubmissionReview } from "@/lib/eventsV2";

const ACTION_LABEL: Record<EventSubmissionReview["action"], string> = {
  attend: "Attend",
  apply_to_pitch: "Apply to pitch",
  offer_prize: "Offer a prize",
};

function AdminEventSubmissionsContent() {
  const [submissions, setSubmissions] = useState<EventSubmissionReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await adminListEventSubmissions({});
      setSubmissions(result.data.submissions);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Could not load submissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <Link href="/admin/events" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Events
        </Link>
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Event submissions</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Attend RSVPs, pitch applications, and prize offers. This list is available to signed-in admins.
          </p>
        </div>

        {message && <p className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>}

        {loading ? (
          <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
        ) : submissions.length === 0 ? (
          <div className="mt-12 border-t border-slate-200 py-16">
            <h2 className="text-2xl font-semibold text-slate-950">No submissions yet.</h2>
          </div>
        ) : (
          <div className="mt-9 overflow-x-auto border-y border-slate-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-3 pr-4 font-semibold">Name</th>
                  <th className="py-3 pr-4 font-semibold">Email</th>
                  <th className="py-3 pr-4 font-semibold">Phone</th>
                  <th className="py-3 pr-4 font-semibold">Action</th>
                  <th className="py-3 pr-4 font-semibold">Event</th>
                  <th className="py-3 font-semibold">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {submissions.map((submission) => (
                  <tr key={`${submission.action}-${submission.id}`}>
                    <td className="py-4 pr-4 font-medium text-slate-950">{submission.name}</td>
                    <td className="py-4 pr-4 text-slate-700">{submission.email}</td>
                    <td className="py-4 pr-4 text-slate-700">{submission.phone || "—"}</td>
                    <td className="py-4 pr-4 text-slate-700">{ACTION_LABEL[submission.action]}</td>
                    <td className="py-4 pr-4 text-slate-700">{submission.eventTitle}</td>
                    <td className="py-4 text-slate-500">{submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  );
}

export default function AdminEventSubmissionsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminEventSubmissionsContent />
    </RequireAuth>
  );
}
