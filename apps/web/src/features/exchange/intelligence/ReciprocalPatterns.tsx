import { ArrowLeftRight, ShieldAlert } from "lucide-react";
import type { ReferralReciprocalPattern } from "../data/exchangeRun3Gateway";

export function ReciprocalPatterns({ patterns }: { patterns: ReferralReciprocalPattern[] }) {
  return (
    <section aria-labelledby="reciprocal-patterns-title">
      <h2 id="reciprocal-patterns-title" className="flex items-center gap-2 text-sm font-bold text-slate-950"><ArrowLeftRight className="h-4 w-4 text-indigo-600" aria-hidden="true" /> Reciprocal referral context</h2>
      <p className="mt-1 text-xs leading-5 text-slate-600">Referrals in both directions are normal network activity. Pattern labels provide context and never automatically change trust or financial calculations.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {patterns.map((pattern) => (
          <article key={pattern.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="text-sm font-bold text-slate-950">{pattern.partnerLabel}</h3><p className="mt-1 text-xs text-slate-500">{pattern.referralsEachDirection} · sample {pattern.sampleSize}</p></div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold capitalize text-slate-700">{pattern.classification.replaceAll("_", " ")}</span>
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-700">{pattern.classification === "review_recommended" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" /> : <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />}{pattern.notice}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">{pattern.factors.map((factor) => <li key={factor} className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-800">{factor}</li>)}</ul>
          </article>
        ))}
      </div>
    </section>
  );
}
