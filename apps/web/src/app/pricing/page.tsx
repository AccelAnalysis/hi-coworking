"use client";

import { useState } from "react";
import { Check, Loader2, Clock, Users } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/authContext";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { AppShell } from "@/components/AppShell";
import { PublicSiteGate } from "@/components/PublicSiteGate";
import {
  MEMBERSHIP_TIERS,
  GUEST_PRICING,
  CONFERENCE_ROOM_CONFIG,
} from "@hi/shared";

const createCheckout = httpsCallable<
  { tierId: string; successUrl: string; cancelUrl: string },
  { sessionId: string; url: string; paymentId: string }
>(functions, "stripe_createCheckoutSession");

export default function PricingPage() {
  const { user } = useAuth();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async (tierId: string) => {
    if (!user) return;
    setLoadingTier(tierId);
    setError(null);

    try {
      const result = await createCheckout({
        tierId,
        successUrl: `${window.location.origin}/dashboard?payment=success`,
        cancelUrl: `${window.location.origin}/pricing?payment=cancelled`,
      });

      if (result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (err: unknown) {
      console.error("Checkout error:", err);
      setError("Failed to start checkout. Please try again.");
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <PublicSiteGate>
      <AppShell>
        <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            No long contracts. No hidden fees. Walk in as a guest or become a member for included hours and better rates.
          </p>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-8 p-4 rounded-xl bg-red-50 text-red-700 text-sm text-center border border-red-200">
            {error}
          </div>
        )}

        {/* ── Guest Walk-In ── */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" /> Guest / Walk-In
          </h2>
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <h3 className="text-2xl font-bold text-slate-900">
                  ${(GUEST_PRICING.hourlyRateCents / 100).toFixed(2)}
                  <span className="text-base font-normal text-slate-500">/hr per seat</span>
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Daily cap: ${(GUEST_PRICING.dailyCapCents / 100).toFixed(0)}/day per seat · Book up to {GUEST_PRICING.bookingWindowDays} days ahead
                </p>
              </div>
              <Link
                href="/book"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-sm transition-all"
              >
                Book Hourly
              </Link>
            </div>
          </div>
        </div>

        {/* ── Membership Tiers ── */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Users className="h-3.5 w-3.5" /> Membership Plans
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {MEMBERSHIP_TIERS.map((tier) => {
              const isPopular = tier.id === "coworking";
              return (
                <div
                  key={tier.id}
                  className={`bg-white rounded-2xl p-6 md:p-8 shadow-sm flex flex-col relative ${
                    isPopular
                      ? "ring-2 ring-emerald-500/20 border border-emerald-200"
                      : "ring-1 ring-slate-200"
                  }`}
                >
                  {isPopular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold text-white bg-emerald-600 px-3 py-1 rounded-full shadow-lg shadow-emerald-600/20 uppercase tracking-wider">
                      Most Popular
                    </span>
                  )}

                  <h3 className="text-xl font-bold text-slate-900">{tier.name}</h3>
                  <p className="mt-3">
                    <span className="text-4xl font-extrabold text-slate-900">
                      ${(tier.amountCents / 100).toFixed(0)}
                    </span>
                    <span className="text-lg text-slate-500 font-normal">/mo</span>
                  </p>

                  {/* Included hours highlight */}
                  <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                    <p className="text-sm font-semibold text-emerald-900">
                      {tier.includedHoursPerMonth} desk {tier.includedHoursPerMonth === 1 ? "hour" : "hours"}/month included
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Extra hours: ${(tier.extraHourlyRateCents / 100).toFixed(tier.extraHourlyRateCents % 100 === 0 ? 0 : 2)}/hr
                    </p>
                  </div>

                  <ul className="mt-5 space-y-3 flex-1">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-center gap-3 text-slate-600 text-sm">
                        <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                          <Check size={12} strokeWidth={3} />
                        </div>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {user ? (
                    <button
                      onClick={() => handleSubscribe(tier.id)}
                      disabled={loadingTier !== null}
                      className={`mt-8 w-full py-3 rounded-full font-medium transition-all duration-300 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed ${
                        isPopular
                          ? "bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/20"
                          : "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-slate-200/50"
                      }`}
                    >
                      {loadingTier === tier.id ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Redirecting...
                        </span>
                      ) : (
                        "Subscribe"
                      )}
                    </button>
                  ) : (
                    <Link
                      href="/register"
                      className={`mt-8 block text-center py-3 rounded-full font-medium transition-all duration-300 shadow-lg ${
                        isPopular
                          ? "bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/20"
                          : "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-slate-200/50"
                      }`}
                    >
                      Get Started
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Conference Room ── */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Users className="h-3.5 w-3.5" /> Conference Room
          </h2>
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Conference Room Mode</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Up to {CONFERENCE_ROOM_CONFIG.maxCapacity} people · Modular room conversion · Hourly booking
                </p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold text-slate-900">
                  ${(CONFERENCE_ROOM_CONFIG.hourlyRateCents / 100).toFixed(0)}
                </span>
                <span className="text-base text-slate-500">/hr</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-400">
              When the space is reserved in conference mode, desk inventory is not simultaneously available.
            </p>
          </div>
        </div>

        {/* ── Quick Summary ── */}
        <div className="mt-12 p-6 rounded-2xl bg-slate-50 border border-slate-200">
          <h3 className="text-sm font-bold text-slate-700 mb-4">At a Glance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-bold text-slate-900">Guest</span>
              <p className="text-slate-500 mt-0.5">$17.50/hr · $115/day cap · 2-week window</p>
            </div>
            <div>
              <span className="font-bold text-slate-900">Virtual Member</span>
              <p className="text-slate-500 mt-0.5">$49/mo · 2 hrs included · $12/hr extra</p>
            </div>
            <div>
              <span className="font-bold text-slate-900">Coworking Member</span>
              <p className="text-slate-500 mt-0.5">$129/mo · 15 hrs included · $10.50/hr extra</p>
            </div>
            <div>
              <span className="font-bold text-slate-900">Coworking Plus</span>
              <p className="text-slate-500 mt-0.5">$199/mo · 30 hrs included · $9/hr extra</p>
            </div>
          </div>
        </div>

        <p className="text-center text-sm text-slate-500 mt-8">
          All plans include Wi-Fi, coffee, and access to shared amenities.
          Subscriptions managed through Stripe. Cancel anytime.
        </p>
        </div>
      </AppShell>
    </PublicSiteGate>
  );
}
