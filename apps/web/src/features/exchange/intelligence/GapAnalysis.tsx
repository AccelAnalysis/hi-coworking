import { EyeOff, Factory, MapPinned } from "lucide-react";
import type { ReferralGapInsight } from "../data/exchangeRun3Gateway";

export function GapAnalysis({
  title,
  gaps,
}: {
  title: string;
  gaps: ReferralGapInsight[];
}) {
  return (
    <section aria-labelledby={`gap-${title.toLocaleLowerCase().replaceAll(" ", "-")}`}>
      <h2 id={`gap-${title.toLocaleLowerCase().replaceAll(" ", "-")}`} className="flex items-center gap-2 text-sm font-bold text-slate-950">
        {gaps[0]?.dimension === "territory" ? <MapPinned className="h-4 w-4 text-indigo-600" aria-hidden="true" /> : <Factory className="h-4 w-4 text-indigo-600" aria-hidden="true" />}{title}
      </h2>
      <div className="mt-3 space-y-3">
        {gaps.map((gap) => (
          <article key={gap.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-950">{gap.label}</h3>
              {gap.suppressed ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700"><EyeOff className="h-3 w-3" aria-hidden="true" /> Suppressed</span> : null}
            </div>
            {gap.suppressed ? (
              <p className="mt-3 rounded-xl bg-slate-100 p-3 text-xs leading-5 text-slate-600">Small-cell values are hidden because this aggregate is below the configured privacy threshold.</p>
            ) : (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div><dt className="text-slate-500">Demand</dt><dd className="mt-1 text-lg font-bold text-slate-950">{gap.demandCount}</dd></div>
                  <div><dt className="text-slate-500">Active recipients</dt><dd className="mt-1 text-lg font-bold text-slate-950">{gap.activeRecipientCount}</dd></div>
                  <div><dt className="text-slate-500">Unanswered</dt><dd className="mt-1 text-lg font-bold text-slate-950">{gap.unansweredDemand}</dd></div>
                  <div><dt className="text-slate-500">Conversion</dt><dd className="mt-1 text-lg font-bold text-slate-950">{gap.conversionRate === undefined ? "—" : `${gap.conversionRate}%`}</dd></div>
                </dl>
                {gap.conversionRate !== undefined ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`${gap.conversionRate}% conversion rate`}><span className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500" style={{ width: `${Math.max(2, Math.min(gap.conversionRate, 100))}%` }} /></div> : null}
              </>
            )}
            <p className="mt-3 text-xs leading-5 text-slate-600">{gap.explanation}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
