"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getExchangePublicCommercialPolicyFn, type ExchangePublicCommercialConfiguration } from "@/lib/functions";
import { ArrowRight, BadgeCheck, Building2, Coins, MapPinned, ShieldCheck, Sparkles } from "lucide-react";

const fallback: ExchangePublicCommercialConfiguration = {
  policyVersion: "exchange-launch-v1",
  featureFlags: { exchangeFoundingCampaignEnabled: true, exchangeFoundingCheckoutEnabled: false },
  launchMarket: { enabled: true, publicLabel: "Isle of Wight County, Virginia", stateCode: "VA", countyOrLocalityName: "Isle of Wight County", countryCode: "US" },
  foundingMembership: {
    enabled: true,
    checkoutReady: false,
    publicLabel: "Exchange Founding Membership",
    currency: "usd",
    billingInterval: "month",
    includedCreditsPerPeriod: 0,
    retainRecognitionAfterCancellation: true,
    pricingVersion: "founding-price-unapproved",
    entitlementVersion: "founding-entitlements-v1",
  },
  creditDefinition: {
    nominalDollarValuePerCredit: 1,
    expirationCalendarMonths: 12,
    transferable: false,
    cashRedeemable: false,
    generallyRefundable: false,
    verifiedBusinessRequired: true,
    spendingOrder: "earliest_expiration_first",
  },
  creditPacks: [],
  actionCosts: {},
  referralFinancialPolicy: {
    enabled: false,
    platformFeeBps: 1_000,
    minimumPlatformServiceFeeCents: 500,
    minimumAccumulatedPayoutCents: 10_000,
    payoutHoldDays: 14,
    automatedPayoutsEnabled: false,
    policyVersion: "referral-finance-v1",
  },
};

const capabilities = [
  ["Available now", "Claimable business profiles, opportunity discovery, RFx, teaming, referrals, resources, and network intelligence."],
  ["Founding access", "Organization recognition, included Exchange credits when configured, billing management, and early access to premium Exchange actions."],
  ["In development", "Paid referral collection, reserve operations, and connected-account onboarding remain disabled behind protected launch gates."],
  ["Planned later", "Bookstore, events commerce, and physical workspace scheduling follow the Exchange launch and are not included in Founding Membership."],
];

export default function ExchangeFoundingPage() {
  const [configuration, setConfiguration] = useState(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getExchangePublicCommercialPolicyFn({})
      .then((result) => setConfiguration(result.data.configuration))
      .catch(() => setConfiguration(fallback))
      .finally(() => setLoading(false));
  }, []);

  const founding = configuration.foundingMembership;
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-16">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-2xl shadow-slate-300/30">
          <div className="grid gap-10 px-6 py-10 sm:px-10 lg:grid-cols-[1.25fr_.75fr] lg:px-14 lg:py-16">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
                <MapPinned className="h-4 w-4" /> Founding launch · {configuration.launchMarket.publicLabel}
              </div>
              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
                Build the local business network businesses can actually use.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Hi Exchange connects business discovery, opportunities, teaming, referrals, economic-development resources, and relationship intelligence in one map-based environment.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {founding.checkoutReady ? (
                  <Link href="/exchange/wallet" className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-6 py-3 font-bold text-slate-950 hover:bg-emerald-200">
                    Manage founding enrollment <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <>
                    <Link href="/register" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-slate-950 hover:bg-slate-100">Create a free account <ArrowRight className="h-4 w-4" /></Link>
                    <Link href="/profile" className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3 font-bold text-white hover:bg-white/10">Claim or complete a business profile</Link>
                  </>
                )}
              </div>
              {!loading && !founding.checkoutReady && (
                <p className="mt-4 text-sm font-semibold text-amber-200">Founding enrollment is not yet open. No unapproved price or placeholder Stripe identifier will be submitted.</p>
              )}
            </div>
            <aside className="rounded-3xl border border-white/15 bg-white/5 p-6 backdrop-blur">
              <Sparkles className="h-7 w-7 text-amber-300" />
              <h2 className="mt-4 text-2xl font-black">{founding.publicLabel}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">An organization-level Exchange relationship, separate from physical coworking membership.</p>
              <dl className="mt-6 space-y-4 text-sm">
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Price</dt><dd className="font-bold">{founding.amountCents ? `$${(founding.amountCents / 100).toFixed(2)}/month` : "Pending approval"}</dd></div>
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Included credits</dt><dd className="font-bold">{founding.includedCreditsPerPeriod || "Pending configuration"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-400">Checkout</dt><dd className="font-bold">{founding.checkoutReady ? "Ready" : "Closed"}</dd></div>
              </dl>
            </aside>
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-white p-6"><Building2 className="h-7 w-7 text-indigo-600" /><h2 className="mt-4 text-lg font-black">Free participation matters</h2><p className="mt-2 text-sm leading-6 text-slate-600">Registered people can browse, discover profiles and public opportunities, request claims, save permitted items, receive authorized referrals, and understand which actions require verification, credits, or Founding access.</p></article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6"><Coins className="h-7 w-7 text-amber-600" /><h2 className="mt-4 text-lg font-black">Exchange credits, plainly stated</h2><p className="mt-2 text-sm leading-6 text-slate-600">One Exchange credit has a nominal value of one dollar. Credits are for eligible verified organizations, expire 12 calendar months after issuance, are nontransferable, generally nonrefundable, and have no cash-redemption value.</p></article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6"><ShieldCheck className="h-7 w-7 text-emerald-600" /><h2 className="mt-4 text-lg font-black">Protected by organization authority</h2><p className="mt-2 text-sm leading-6 text-slate-600">Billing, credit purchases, and protected actions are resolved on the server from verified organization membership and permissions. Browser-supplied prices, balances, and tiers are never authoritative.</p></article>
        </section>

        <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex items-center gap-3"><BadgeCheck className="h-7 w-7 text-indigo-600" /><div><h2 className="text-2xl font-black">What the launch includes</h2><p className="text-sm text-slate-500">Clear status labels keep the campaign honest.</p></div></div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {capabilities.map(([status, body]) => <article key={status} className="rounded-2xl bg-slate-50 p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{status}</p><p className="mt-2 text-sm leading-6 text-slate-700">{body}</p></article>)}
          </div>
          <p className="mt-6 text-sm leading-6 text-slate-600">Founding revenue supports continued Exchange development. It does not include desk hours or physical-space access unless a separate future product explicitly says so.</p>
        </section>
      </main>
    </AppShell>
  );
}
