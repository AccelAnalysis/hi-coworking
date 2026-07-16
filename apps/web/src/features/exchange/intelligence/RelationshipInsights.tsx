import { BadgeCheck, Clock3, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReferralRelationshipInsight } from "../data/exchangeRun3Gateway";

const STATE_STYLES: Record<ReferralRelationshipInsight["state"], string> = {
  new: "border-slate-300 bg-slate-100 text-slate-700",
  active: "border-blue-200 bg-blue-50 text-blue-800",
  established: "border-indigo-200 bg-indigo-50 text-indigo-800",
  trusted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  review_required: "border-orange-300 bg-orange-50 text-orange-900",
};

export function RelationshipInsights({
  relationships,
  selectedId,
  onSelect,
}: {
  relationships: ReferralRelationshipInsight[];
  selectedId?: string | null;
  onSelect?: (relationship: ReferralRelationshipInsight) => void;
}) {
  if (!relationships.length) {
    return <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">No relationship insights match the current authorized filters.</p>;
  }
  return (
    <div className="space-y-3" aria-label="Referral relationships">
      {relationships.map((relationship) => {
        const body = (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-950">{relationship.partnerLabel}</h3>
                <p className="mt-1 text-xs text-slate-500">{relationship.relationshipDays === undefined ? "Duration unavailable" : `${relationship.relationshipDays.toLocaleString("en-US")} days`} · sample {relationship.sampleSize}</p>
              </div>
              <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize", STATE_STYLES[relationship.state])}>{relationship.state.replaceAll("_", " ")}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Accepted</dt><dd className="mt-0.5 font-bold text-slate-900">{relationship.acceptedReferrals}</dd></div>
              <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Confirmed conversions</dt><dd className="mt-0.5 font-bold text-slate-900">{relationship.confirmedConversions}</dd></div>
              <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Median response</dt><dd className="mt-0.5 font-bold text-slate-900">{relationship.medianResponseHours === undefined ? "—" : `${relationship.medianResponseHours}h`}</dd></div>
              <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Disputes</dt><dd className="mt-0.5 font-bold text-slate-900">{relationship.disputes}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-slate-600">{relationship.explanation}</p>
          </>
        );
        return onSelect ? (
          <button
            key={relationship.id}
            type="button"
            onClick={() => onSelect(relationship)}
            aria-pressed={selectedId === relationship.id}
            className={cn("w-full rounded-2xl border bg-white p-4 text-left outline-none transition hover:border-indigo-300 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-indigo-500", selectedId === relationship.id ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200")}
          >{body}</button>
        ) : <article key={relationship.id} className="rounded-2xl border border-slate-200 bg-white p-4">{body}</article>;
      })}
    </div>
  );
}

export function RelationshipExplanation({ relationship }: { relationship: ReferralRelationshipInsight }) {
  return (
    <article className="space-y-4 p-4 sm:p-5">
      <div>
        <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-bold capitalize", STATE_STYLES[relationship.state])}>{relationship.state.replaceAll("_", " ")}</span>
        <h2 className="mt-3 text-xl font-bold text-slate-950">{relationship.partnerLabel}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{relationship.explanation}</p>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950"><BadgeCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" /> Verified factors</h3>
        <ul className="mt-3 space-y-2">{relationship.factors.map((factor) => <li key={factor} className="flex items-start gap-2 text-sm text-slate-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />{factor}</li>)}</ul>
      </section>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-slate-100 p-3"><dt className="flex items-center gap-2 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Relationship duration</dt><dd className="mt-1 font-bold text-slate-950">{relationship.relationshipDays === undefined ? "Not available" : `${relationship.relationshipDays} days`}</dd></div>
        <div className="rounded-xl bg-slate-100 p-3"><dt className="text-xs text-slate-500">Qualifying sample</dt><dd className="mt-1 font-bold text-slate-950">{relationship.sampleSize} referrals</dd></div>
      </dl>
      <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />This classification is not a guarantee, credit rating, legal certification, authorization decision, or payout entitlement.</p>
    </article>
  );
}
