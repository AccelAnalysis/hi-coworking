"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getExchangeAdminLaunchDashboardFn } from "@/lib/functions";
import { AlertTriangle, CheckCircle2, Loader2, Rocket, ShieldAlert } from "lucide-react";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

export default function ExchangeLaunchAdminPage() {
  return <RequireAuth requiredRole="admin"><AppShell><LaunchAdmin /></AppShell></RequireAuth>;
}
function LaunchAdmin() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getExchangeAdminLaunchDashboardFn({}).then((result) => setData(result.data)).catch((caught) => setError(caught instanceof Error ? caught.message : "Launch controls unavailable"));
  }, []);
  if (error) return <main className="mx-auto max-w-6xl p-8"><div role="alert" className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900"><AlertTriangle className="h-5 w-5" />{error}</div></main>;
  if (!data) return <main className="flex min-h-[50vh] items-center justify-center gap-3 text-sm font-bold"><Loader2 className="h-5 w-5 animate-spin" /> Loading Exchange launch controls…</main>;
  const readiness = record(data.readiness);
  const config = record(data.configuration);
  const flags = record(config.featureFlags);
  const credits = record(data.credits);
  const finance = record(data.referralFinance);
  const missing = Array.isArray(readiness.missing) ? readiness.missing : [];
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-4"><div className="rounded-2xl bg-slate-950 p-3 text-white"><Rocket className="h-6 w-6" /></div><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Protected administration</p><h1 className="text-3xl font-black">Exchange launch controls</h1></div></div>
      <section className="mt-8 grid gap-4 md:grid-cols-3"><StatusCard label="Founding checkout" ready={readiness.foundingCheckoutReady === true} /><StatusCard label="Credit checkout" ready={readiness.creditCheckoutReady === true} /><StatusCard label="Automated referral payouts" ready={false} /></section>
      {missing.length > 0 && <section className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-6"><div className="flex items-center gap-3"><ShieldAlert className="h-6 w-6 text-amber-700" /><h2 className="text-lg font-black text-amber-950">Launch gate remains closed</h2></div><ul className="mt-4 grid gap-2 text-sm text-amber-950 sm:grid-cols-2">{missing.map((item) => <li key={String(item)} className="rounded-xl bg-white/70 px-3 py-2">{String(item).replaceAll("_", " ")}</li>)}</ul></section>}
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <AdminPanel title="Campaign and subscriptions" values={{ "Founding members": data.foundingCount, "Capacity": data.foundingCapacity ?? "Not configured", "Remaining": data.remainingFoundingCapacity ?? "Not configured", "Membership states": JSON.stringify(data.membershipCounts ?? {}) }} />
        <AdminPanel title="Organization verification" values={record(data.organizationVerificationCounts)} />
        <AdminPanel title="Credit ledger" values={{ "Credits allocated": credits.allocated, "Credits outstanding": credits.outstanding, "Credits expired": credits.expired, "Deficit reviews": credits.deficits }} />
        <AdminPanel title="Referral finance readiness" values={{ "Gross funded": finance.grossFundedCents, "Funds in hold": finance.holdCents, "Reserve liability": finance.reserveLiabilityCents, "Accumulated payouts": finance.accumulatedPayoutCents, "Payout eligible": finance.payoutEligibleCents, "Manual review": finance.manualReviewItems }} />
      </section>
      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-black">Feature flags</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(flags).map(([key, value]) => <div key={key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm"><span>{key}</span><span className={value ? "font-black text-emerald-700" : "font-black text-slate-500"}>{value ? "Enabled" : "Disabled"}</span></div>)}</div><p className="mt-5 text-xs leading-5 text-slate-500">Policy changes are accepted only by the protected, versioned admin Function and create immutable audit records. This view intentionally exposes no secret values.</p></section>
    </main>
  );
}

function StatusCard({ label, ready }: { label: string; ready: boolean }) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-3">{ready ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <ShieldAlert className="h-6 w-6 text-amber-600" />}<div><p className="text-sm text-slate-500">{label}</p><p className="font-black">{ready ? "Ready" : "Fail closed"}</p></div></div></article>;
}

function AdminPanel({ title, values }: { title: string; values: Record<string, unknown> }) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-black">{title}</h2><dl className="mt-4 divide-y divide-slate-100">{Object.entries(values).map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-slate-500">{label.replaceAll("_", " ")}</dt><dd className="max-w-[60%] text-right font-bold">{typeof value === "number" ? value.toLocaleString() : String(value ?? 0)}</dd></div>)}</dl></article>;
}
