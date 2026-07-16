import { Database, ShieldCheck } from "lucide-react";

export function DataQualityNotice({
  notices,
  scopeLabel,
  windowLabel,
  privacyThreshold,
  calculationVersion,
}: {
  notices: string[];
  scopeLabel: string;
  windowLabel: string;
  privacyThreshold: number;
  calculationVersion: number;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="data-quality-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-emerald-100 p-2 text-emerald-800"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h2 id="data-quality-title" className="text-sm font-bold text-slate-950">Scope, privacy, and data quality</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">{scopeLabel} · {windowLabel}</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Privacy threshold</dt><dd className="mt-1 font-bold text-slate-900">{privacyThreshold} qualifying records or organizations</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Calculation version</dt><dd className="mt-1 font-bold text-slate-900">v{calculationVersion}</dd></div>
      </dl>
      <ul className="mt-4 space-y-2">
        {notices.map((notice) => (
          <li key={notice} className="flex items-start gap-2 text-xs leading-5 text-slate-600"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />{notice}</li>
        ))}
      </ul>
    </section>
  );
}
