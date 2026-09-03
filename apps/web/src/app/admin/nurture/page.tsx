"use client";

import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, CheckCircle2, Loader2, Mail, Pause, Play, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { functions } from "@/lib/firebase";

type Campaign = {
  id: string;
  name: string;
  stage: "ACQUISITION" | "CUSTOMER_DEVELOPMENT" | "RETENTION";
  status: "ACTIVE" | "PAUSED";
  entrySignals: string[];
  steps: Array<{ id: string; delayHours: number; subject: string }>;
};

type Overview = {
  campaigns: Campaign[];
  summary: { active: number; completed: number; failed: number; suppressed: number };
  deliveries: { sent: number; failed: number };
};

const getOverview = httpsCallable<Record<string, never>, Overview>(functions, "nurture_adminOverview");
const setStatus = httpsCallable<{ campaignId: string; status: "ACTIVE" | "PAUSED" }, { success: boolean }>(
  functions,
  "nurture_adminSetCampaignStatus",
);

export default function NurtureAdminPage() {
  return (
    <RequireAuth requiredRole="admin">
      <NurtureAdminContent />
    </RequireAuth>
  );
}

function NurtureAdminContent() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getOverview({});
      setOverview(result.data);
    } catch (caught) {
      console.error(caught);
      setError("Nurture operations could not be loaded. Confirm the completion functions are deployed and your Admin role is current.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(campaign: Campaign) {
    const next = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setSaving(campaign.id);
    setError(null);
    try {
      await setStatus({ campaignId: campaign.id, status: next });
      await load();
    } catch (caught) {
      console.error(caught);
      setError("The campaign status could not be changed.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Operations overview
        </Link>
        <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Customer lifecycle</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Nurture campaigns</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Acquisition, customer development, renewal, and re-engagement run from committed lead, booking, and membership events. Pausing a campaign stops future sends without deleting history.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {error ? <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div> : null}

        {loading && !overview ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : overview ? (
          <>
            <section className="mt-8 grid gap-px overflow-hidden rounded-3xl bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Active" value={overview.summary.active} />
              <Metric label="Completed" value={overview.summary.completed} />
              <Metric label="Suppressed" value={overview.summary.suppressed} />
              <Metric label="Failed" value={overview.summary.failed} attention={overview.summary.failed > 0} />
              <Metric label="Sent" value={overview.deliveries.sent} />
              <Metric label="Send failures" value={overview.deliveries.failed} attention={overview.deliveries.failed > 0} />
            </section>

            <section className="mt-10">
              <div className="flex items-center gap-2"><Mail className="h-5 w-5 text-slate-500" /><h2 className="text-xl font-semibold text-slate-950">Lifecycle programs</h2></div>
              <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
                {overview.campaigns.map((campaign) => (
                  <div key={campaign.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-950">{campaign.name}</h3>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-600">{campaign.stage.replace("_", " ")}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{campaign.steps.length} step{campaign.steps.length === 1 ? "" : "s"} · triggers: {campaign.entrySignals.join(", ").toLowerCase().replaceAll("_", " ")}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${campaign.status === "ACTIVE" ? "text-emerald-700" : "text-slate-500"}`}>
                        {campaign.status === "ACTIVE" ? <CheckCircle2 className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{campaign.status === "ACTIVE" ? "Running" : "Paused"}
                      </span>
                      <button type="button" disabled={saving === campaign.id} onClick={() => void toggle(campaign)} className="inline-flex min-h-11 min-w-28 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50">
                        {saving === campaign.id ? <Loader2 className="h-4 w-4 animate-spin" /> : campaign.status === "ACTIVE" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        {campaign.status === "ACTIVE" ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-8 rounded-3xl bg-slate-50 p-5 text-sm leading-6 text-slate-600">
              <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" /><p>Marketing opt-outs and unsubscribe links are enforced before each delivery. Transactional booking, payment, and access messages remain governed by their existing transaction lifecycles and are not sent through these campaigns.</p></div>
            </section>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}

function Metric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className="bg-white p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={`mt-2 text-2xl font-semibold ${attention ? "text-rose-700" : "text-slate-950"}`}>{value.toLocaleString()}</p></div>;
}
