import { BadgeCheck, CircleDollarSign } from "lucide-react";
import type { ReferralServiceOfferSummary } from "../data/exchangeRun3Gateway";

export function ServiceOfferSummary({ offer }: { offer: ReferralServiceOfferSummary }) {
  return (
    <article className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
      <div className="flex items-start gap-2">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Published service offer · v{offer.version}</p>
          <h4 className="mt-1 text-sm font-bold text-slate-950">{offer.serviceName}</h4>
          <p className="text-xs text-slate-600">{offer.providerLabel} · {offer.serviceCategory}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-100 bg-white/70 px-2.5 py-2 text-xs font-semibold text-slate-700">
        <CircleDollarSign className="h-4 w-4 text-indigo-700" aria-hidden="true" />
        {offer.compensationLabel}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Publishing locks this version. Accepted referrals retain their own immutable terms snapshot.
      </p>
    </article>
  );
}
