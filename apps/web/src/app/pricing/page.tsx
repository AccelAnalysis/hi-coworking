"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { AppShell } from "@/components/AppShell";
import { PublicSiteGate } from "@/components/PublicSiteGate";
import { useAuth } from "@/lib/authContext";
import { functions } from "@/lib/firebase";
import {
  GUEST_PRICING,
  MEMBERSHIP_TIERS,
  annualSavingsCents,
  membershipChargeCents,
  type BillingInterval,
  type MembershipTierId,
} from "@hi/shared";

const createCheckout = httpsCallable<
  { tierId: string; interval: BillingInterval; successUrl: string; cancelUrl: string },
  { sessionId: string; url: string; paymentId: string; amountCents?: number; interval?: BillingInterval }
>(functions, "stripe_createCheckoutSession");

const INTEGRATED_RFXCHANGE_TERMS = [
  "rfx",
  "accelprocure",
  "procurement",
  "directory",
  "referral",
  "credit",
  "business profile",
];

function coworkingOnlyFeatures(features: string[]) {
  return features.filter((feature) => {
    const normalized = feature.toLowerCase();
    return !INTEGRATED_RFXCHANGE_TERMS.some((term) => normalized.includes(term));
  });
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function PricingPage() {
  const { user } = useAuth();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [tierId, setTierId] = useState<MembershipTierId>("coworking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnPath, setReturnPath] = useState("/pricing");

  useEffect(() => {
    setReturnPath(`${window.location.pathname}${window.location.search}`);
  }, []);

  const selected = MEMBERSHIP_TIERS.find((tier) => tier.id === tierId) ?? MEMBERSHIP_TIERS[1];
  const amountCents = membershipChargeCents(selected.amountCents, interval);
  const features = coworkingOnlyFeatures(selected.features);
  const authHref = `/login?next=${encodeURIComponent(returnPath)}`;
  const registerHref = `/register?next=${encodeURIComponent(returnPath)}`;

  const handleSubscribe = async () => {
    if (!user) {
      window.location.assign(authHref);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const result = await createCheckout({
        tierId: selected.id,
        interval,
        successUrl: `${window.location.origin}/my-hi?payment=success`,
        cancelUrl: `${window.location.origin}/pricing?payment=cancelled`,
      });

      if (interval === "year" && (result.data.interval !== "year" || result.data.amountCents !== amountCents)) {
        setError("Annual checkout is not live on the payment function yet, so this screen did not open Stripe. Monthly checkout still uses the existing Stripe prices. Deploy the main Cloud Functions bundle (stripe_createCheckoutSession) before accepting annual payments.");
        setLoading(false);
        return;
      }

      if (result.data.url) {
        window.location.href = result.data.url;
        return;
      }
      setError("Stripe did not return a checkout link. No charge was made.");
    } catch (err: unknown) {
      console.error("Checkout error:", err);
      setError("Stripe checkout did not start. No charge was made. Confirm the Stripe secret is set on the Cloud Function and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicSiteGate>
      <AppShell>
        <div className="mx-auto w-full max-w-6xl overflow-x-hidden px-4 pb-28 pt-6 sm:px-6 lg:pb-10 lg:pt-10">
          <div className="mb-6 max-w-2xl">
            <p className="text-sm font-medium text-slate-500">Membership</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Choose a plan and pay
            </h1>
            <p className="mt-2 text-base leading-7 text-slate-600">
              Monthly and annual prices stay on this screen with what the plan includes. Payment stays on Stripe.
            </p>
          </div>

          {error ? (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
              {error}
            </div>
          ) : null}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                {(["month", "year"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setInterval(value)}
                    className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${
                      interval === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"
                    }`}
                  >
                    {value === "month" ? "Monthly" : "Annual"}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-3">
                {MEMBERSHIP_TIERS.map((tier) => {
                  const active = tier.id === selected.id;
                  const monthly = membershipChargeCents(tier.amountCents, "month");
                  const annual = membershipChargeCents(tier.amountCents, "year");
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setTierId(tier.id)}
                      className={`rounded-2xl border p-4 text-left ${
                        active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold">{tier.name}</p>
                          <p className={`mt-1 text-sm ${active ? "text-slate-300" : "text-slate-500"}`}>
                            {tier.includedHoursPerMonth > 0
                              ? `${tier.includedHoursPerMonth} desk hours included each month`
                              : "Desk time at the public hourly rate"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold">{money(interval === "year" ? annual : monthly)}</p>
                          <p className={`text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                            {interval === "year" ? "/year" : "/month"}
                          </p>
                        </div>
                      </div>
                      <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                        <span>{money(monthly)}/mo</span>
                        <span>{money(annual)}/yr</span>
                        <span>Save {money(annualSavingsCents(tier.amountCents))} annually</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <ul className="mt-5 space-y-2">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-sm text-slate-500">
                Need a desk without a membership? Walk-in seats are {money(GUEST_PRICING.hourlyRateCents)}/hour.{" "}
                <Link href="/book" className="font-medium text-slate-900 underline underline-offset-4">Book hourly</Link>
              </p>
            </section>

            <aside className="min-w-0 rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white lg:sticky lg:top-24">
              <p className="text-sm text-slate-300">You are buying</p>
              <h2 className="mt-2 text-2xl font-semibold">{selected.name}</h2>
              <p className="mt-1 text-sm text-slate-300">
                {interval === "year" ? "Billed once a year" : "Billed every month"} · Cancel in Stripe
              </p>
              <p className="mt-6 text-4xl font-semibold tracking-tight">{money(amountCents)}</p>
              <p className="text-sm text-slate-300">{interval === "year" ? "per year" : "per month"}</p>
              <ul className="mt-5 space-y-2 text-sm text-slate-200">
                {features.slice(0, 4).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {user ? (
                <button
                  type="button"
                  onClick={handleSubscribe}
                  disabled={loading}
                  className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-slate-950 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {loading ? "Opening Stripe…" : `Pay ${money(amountCents)} with Stripe`}
                </button>
              ) : (
                <div className="mt-6 grid gap-2">
                  <Link
                    href={authHref}
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-slate-950"
                  >
                    Sign in to pay
                  </Link>
                  <Link
                    href={registerHref}
                    className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-4 text-sm font-semibold text-white"
                  >
                    Create an account
                  </Link>
                </div>
              )}
              <p className="mt-3 text-xs leading-5 text-slate-400">
                Stripe hosts the card form. This page does not store card numbers.
              </p>
            </aside>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">{selected.name}</p>
                <p className="text-sm text-slate-600">{money(amountCents)} {interval === "year" ? "/year" : "/month"}</p>
              </div>
              {user ? (
                <button
                  type="button"
                  onClick={handleSubscribe}
                  disabled={loading}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {loading ? "Opening…" : "Pay with Stripe"}
                </button>
              ) : (
                <Link
                  href={authHref}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white"
                >
                  Sign in to pay
                </Link>
              )}
            </div>
          </div>
        </div>
      </AppShell>
    </PublicSiteGate>
  );
}
