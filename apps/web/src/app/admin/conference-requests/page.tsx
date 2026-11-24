"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { functions } from "@/lib/firebase";
import { callableErrorMessage } from "@/lib/callableError";
import { formatUsdCents } from "@hi/shared";
import { tablistKeyHandler } from "@/lib/tablistKeys";

type ConferenceRequest = {
  id: string;
  date: string;
  start: string;
  end: string;
  timeLabel: string;
  kind: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  status: "pending" | "approved" | "declined";
  priceCents: number;
  createdAt: number;
  reviewNote?: string;
  bookingId?: string;
};

const listRequests = httpsCallable<{ status?: string }, { requests: ConferenceRequest[] }>(
  functions,
  "admin_listConferenceSlotRequests",
);
const reviewRequest = httpsCallable<
  { requestId: string; decision: "approved" | "declined"; note?: string },
  { success: boolean; status: string; bookingId?: string | null }
>(functions, "admin_reviewConferenceSlotRequest");

function kindLabel(kind: string) {
  if (kind === "weekday_evening") return "Weekday evening";
  if (kind === "weekend_am") return "Weekend morning";
  if (kind === "weekend_pm") return "Weekend afternoon";
  if (kind === "weekend_evening") return "Weekend evening";
  return kind;
}

export default function AdminConferenceRequestsPage() {
  return (
    <RequireAuth requiredRole="staff">
      <AppShell>
        <ConferenceRequestsContent />
      </AppShell>
    </RequireAuth>
  );
}

function ConferenceRequestsContent() {
  const tabs = ["pending", "approved", "declined", "all"] as const;
  type StatusTab = (typeof tabs)[number];
  const [status, setStatus] = useState<StatusTab>("pending");
  const [requests, setRequests] = useState<ConferenceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listRequests(status === "all" ? {} : { status });
      setRequests(result.data.requests);
    } catch (caught) {
      setError(callableErrorMessage(caught, "We could not load conference requests."));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () => requests.filter((item) => item.status === "pending").length,
    [requests],
  );

  async function decide(requestId: string, decision: "approved" | "declined") {
    setWorkingId(requestId);
    setError(null);
    try {
      await reviewRequest({ requestId, decision, note });
      setNote("");
      await load();
    } catch (caught) {
      setError(callableErrorMessage(caught, "That review could not be saved."));
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-sm font-medium text-slate-500">Operations</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-[#101D4B]">Evening and weekend conference</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Review by-appointment 4-hour slots at {formatUsdCents(29900)}. Approving a request reserves that window so no overlapping request can be accepted.
      </p>

      <div
        className="mt-6 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Request status"
        onKeyDown={tablistKeyHandler(tabs, status, setStatus, "conference-tab-")}
      >
        {([
          ["pending", "Pending"],
          ["approved", "Approved"],
          ["declined", "Declined"],
          ["all", "All"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            id={`conference-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={status === value}
            aria-controls="conference-tabpanel"
            tabIndex={status === value ? 0 : -1}
            onClick={() => setStatus(value)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] ${
              status === value ? "border-[#101D4B] bg-[#101D4B] text-white" : "border-[#C5CADB] bg-white text-[#101D4B] hover:bg-[#EEF0F6]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-4 text-sm text-rose-800" role="alert">{error}</p> : null}

      <div role="tabpanel" id="conference-tabpanel" aria-labelledby={`conference-tab-${status}`} tabIndex={0}>
      {loading ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading requests…
        </p>
      ) : requests.length === 0 ? (
        <p className="mt-8 text-sm text-slate-600">{status === "pending" ? "No pending requests." : "No requests in this view."}</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {requests.map((item) => (
            <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kindLabel(item.kind)}</p>
                  <h2 className="mt-1 font-display text-xl font-semibold text-[#101D4B]">
                    {item.date} · {item.timeLabel}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.name} · {item.email}{item.phone ? ` · ${item.phone}` : ""}
                  </p>
                </div>
                <p className="text-sm font-semibold text-[#101D4B]">{formatUsdCents(item.priceCents)}</p>
              </div>
              {item.notes ? <p className="mt-3 text-sm leading-6 text-slate-700">{item.notes}</p> : null}
              <p className="mt-2 text-xs text-slate-500">Status: {item.status}{item.bookingId ? ` · Booking ${item.bookingId}` : ""}</p>
              {item.status === "pending" ? (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1 text-sm font-medium text-[#101D4B]">
                    Note <span className="font-normal text-slate-500">(optional)</span>
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-950"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={workingId === item.id}
                      onClick={() => void decide(item.id, "approved")}
                      className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#101D4B] px-4 text-sm font-semibold text-white hover:bg-[#3A4675] disabled:opacity-50"
                    >
                      {workingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                    </button>
                    <button
                      type="button"
                      disabled={workingId === item.id}
                      onClick={() => void decide(item.id, "declined")}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#C5CADB] px-4 text-sm font-semibold text-[#101D4B] hover:bg-[#EEF0F6] disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ) : item.reviewNote ? (
                <p className="mt-3 text-sm text-slate-600">Review note: {item.reviewNote}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {status === "all" && pendingCount > 0 ? (
        <p className="sr-only">{pendingCount} pending requests</p>
      ) : null}
      </div>
    </main>
  );
}
