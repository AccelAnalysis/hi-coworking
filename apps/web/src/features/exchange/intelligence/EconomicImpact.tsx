import { BadgeDollarSign, Building2, Handshake, Network, Route } from "lucide-react";
import type { ReferralIntelligenceSnapshot } from "../data/exchangeRun3Gateway";

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function EconomicImpact({ impact }: { impact: ReferralIntelligenceSnapshot["economicImpact"] }) {
  const counts = [
    { label: "Referrals initiated", value: impact.referralsInitiated, icon: Network },
    { label: "Referrals accepted", value: impact.referralsAccepted, icon: Handshake },
    { label: "Confirmed conversions", value: impact.confirmedConversions, icon: BadgeDollarSign },
    { label: "Businesses connected", value: impact.businessesConnected, icon: Building2 },
    { label: "New relationships", value: impact.newRelationshipsFormed ?? "Not available", icon: Handshake },
    { label: "Industries / territories", value: `${impact.industriesConnected} / ${impact.territoriesConnected}`, icon: Route },
  ];
  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-sm font-bold text-slate-950">Verified referral outcomes</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">Counts cover business referrals in the authorized scope. Platform invitations are excluded.</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {counts.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><dt className="flex items-center gap-2 text-xs font-bold text-slate-500"><Icon className="h-4 w-4 text-indigo-600" aria-hidden="true" />{label}</dt><dd className="mt-2 text-2xl font-bold text-slate-950">{value}</dd></div>)}
        </dl>
      </section>
      {impact.currencies.map((currency) => (
        <section key={currency.currency} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby={`impact-${currency.currency}`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id={`impact-${currency.currency}`} className="text-sm font-bold text-slate-950">Currency-specific referred activity · {currency.currency}</h2><p className="mt-1 text-xs text-slate-500">No FX conversion or regional economic multiplier is applied.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{currency.currency}</span></div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl bg-blue-50 p-3"><dt className="text-xs leading-4 text-blue-800">Reported referred transaction value</dt><dd className="mt-2 text-lg font-bold text-blue-950">{money(currency.reportedTransactionValueCents, currency.currency)}</dd><p className="mt-1 text-[10px] text-blue-700">Reported; not confirmed</p></div>
            <div className="rounded-xl bg-emerald-50 p-3"><dt className="text-xs leading-4 text-emerald-800">Confirmed referred transaction value</dt><dd className="mt-2 text-lg font-bold text-emerald-950">{money(currency.confirmedTransactionValueCents, currency.currency)}</dd><p className="mt-1 text-[10px] text-emerald-700">Confirmed referred value</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs leading-4 text-slate-600">Calculated gross referral payout</dt><dd className="mt-2 text-lg font-bold text-slate-950">{money(currency.grossReferralPayoutCents, currency.currency)}</dd></div>
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs leading-4 text-slate-600">Calculated platform fee</dt><dd className="mt-2 text-lg font-bold text-slate-950">{money(currency.platformFeeCents, currency.currency)}</dd><p className="mt-1 text-[10px] text-slate-500">Applied to gross payout</p></div>
            <div className="rounded-xl bg-indigo-50 p-3"><dt className="text-xs leading-4 text-indigo-700">Calculated net referrer benefit</dt><dd className="mt-2 text-lg font-bold text-indigo-950">{money(currency.netReferrerBenefitCents, currency.currency)}</dd><p className="mt-1 text-[10px] text-indigo-700">Settlement state is separate</p></div>
          </dl>
        </section>
      ))}
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3"><dt className="text-xs text-slate-500">Non-cash benefits</dt><dd className="mt-1 font-bold text-slate-950">{impact.nonCashBenefits}</dd></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><dt className="text-xs text-slate-500">RFx opportunities linked</dt><dd className="mt-1 font-bold text-slate-950">{impact.rfxOpportunitiesLinked}</dd></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><dt className="text-xs text-slate-500">Teams linked</dt><dd className="mt-1 font-bold text-slate-950">{impact.teamsLinked}</dd></div>
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3"><dt className="text-xs text-slate-500">Jobs / multipliers</dt><dd className="mt-1 font-bold text-slate-700">Not reported</dd></div>
      </dl>
    </div>
  );
}
