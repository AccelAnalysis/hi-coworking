"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Clock, Users } from "lucide-react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { AppShell } from "@/components/AppShell";
import { PublicSiteGate } from "@/components/PublicSiteGate";
import { useAuth } from "@/lib/authContext";
import { functions } from "@/lib/firebase";
import { SAYHI_FLOW, VIRTUAL_ADDRESS } from "@/lib/sayhiFlags";
import { rememberVirtualAddressChoice, virtualAddressChoice } from "@/lib/sayhiAccount";
import {
  MEMBERSHIP_TIERS,
  GUEST_PRICING,
  CONFERENCE_ROOM_CONFIG,
} from "@hi/shared";

const createCheckout = httpsCallable<
  { tierId: string; successUrl: string; cancelUrl: string; virtualAddress?: boolean },
  { sessionId: string; url: string; paymentId: string }
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

export default function PricingPage() {
  const { user } = useAuth();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Virtual address (built, OFF): the option here and the pop-up on the way to
  // Create your account show only when NEXT_PUBLIC_VIRTUAL_ADDRESS is on.
  const [vaChosen, setVaChosen] = useState(false);
  const [vaOfferFor, setVaOfferFor] = useState<string | null>(null);
  useEffect(() => {
    if (VIRTUAL_ADDRESS) setVaChosen(virtualAddressChoice() === true);
  }, []);
  const chooseVa = (chosen: boolean) => {
    setVaChosen(chosen);
    rememberVirtualAddressChoice(chosen);
  };
  const goToCreateAccount = (tierId: string) => {
    window.location.href = `/register?plan=${encodeURIComponent(tierId)}`;
  };
  const primaryClass = SAYHI_FLOW
    ? "bg-[#101D4B] text-white hover:bg-[#3A4675] shadow-[#101D4B]/20"
    : "bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/20";

  const handleSubscribe = async (tierId: string) => {
    if (!user) return;
    setLoadingTier(tierId);
    setError(null);

    try {
      const result = await createCheckout({
        tierId,
        successUrl: `${window.location.origin}/my-hi?payment=success&plan=${encodeURIComponent(tierId)}`,
        cancelUrl: `${window.location.origin}/pricing?payment=cancelled`,
        ...(VIRTUAL_ADDRESS && vaChosen && tierId !== "virtual" ? { virtualAddress: true } : {}),
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
          <div className="text-center mb-16">
            <h1 className="font-display text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 mb-4">
              Simple pricing for how you use the space
            </h1>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
              Book by the hour, become a coworking member for included time and lower rates, or choose Virtual Office when you do not need regular desk access.
            </p>
          </div>

          {error && (
            <div className="max-w-md mx-auto mb-8 p-4 rounded-xl bg-red-50 text-red-700 text-sm text-center border border-red-200">
              {error}
            </div>
          )}

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

          <div className="mb-10">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Users className="h-3.5 w-3.5" /> Membership Plans
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {MEMBERSHIP_TIERS.map((tier) => {
                const isPopular = tier.id === "coworking";
                const isVirtualOffice = tier.id === "virtual";
                const visibleFeatures = coworkingOnlyFeatures(tier.features);
                return (
                  <div
                    key={tier.id}
                    className={`bg-white rounded-2xl p-6 md:p-8 shadow-sm flex flex-col relative ${
                      isPopular
                        ? "ring-2 ring-[#101D4B]/20 border border-[#C5CADB]"
                        : "ring-1 ring-slate-200"
                    }`}
                  >
                    {isPopular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold text-white bg-[#101D4B] px-3 py-1 rounded-full shadow-lg shadow-[#101D4B]/20 uppercase tracking-wider">
                        Best for regular use
                      </span>
                    )}

                    <h3 className="text-xl font-bold text-slate-900">{tier.name}</h3>
                    <p className="mt-3">
                      <span className="text-4xl font-extrabold text-slate-900">
                        ${(tier.amountCents / 100).toFixed(0)}
                      </span>
                      <span className="text-lg text-slate-500 font-normal">/mo</span>
                    </p>

                    <div className="mt-4 p-3 rounded-xl bg-[#EEF0F6] border border-[#C5CADB]">
                      {isVirtualOffice ? (
                        <>
                          <p className="text-sm font-semibold text-[#101D4B]">No desk hours included</p>
                          <p className="text-xs text-[#3A4675] mt-0.5">Coworking desk use: $17.50/hr</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[#101D4B]">
                            {tier.includedHoursPerMonth} desk {tier.includedHoursPerMonth === 1 ? "hour" : "hours"}/month included
                          </p>
                          <p className="text-xs text-[#3A4675] mt-0.5">
                            Additional hours: {tier.id === "coworking" ? "20%" : "30%"} off the regular hourly price
                          </p>
                        </>
                      )}
                    </div>

                    <ul className="mt-5 space-y-3 flex-1">
                      {visibleFeatures.map((feature) => (
                        <li key={feature} className="flex items-center gap-3 text-slate-600 text-sm">
                          <div className="w-5 h-5 rounded-full bg-[#EEF0F6] flex items-center justify-center text-[#101D4B] shrink-0">
                            <Check size={12} strokeWidth={3} />
                          </div>
                          {feature}
                        </li>
                      ))}
                    </ul>

                    {user ? (
                      <button
                        onClick={() => handleSubscribe(tier.id)}
                        disabled={loadingTier !== null}
                        className={`mt-8 w-full py-3 rounded-full font-medium transition-all duration-300 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed ${
                          isPopular
                            ? primaryClass
                            : "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-slate-200/50"
                        }`}
                      >
                        {loadingTier === tier.id ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Redirecting...
                          </span>
                        ) : (
                          isVirtualOffice ? "Choose Virtual Office" : "Become a Member"
                        )}
                      </button>
                    ) : SAYHI_FLOW ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (VIRTUAL_ADDRESS && !isVirtualOffice && !vaChosen) setVaOfferFor(tier.id);
                          else goToCreateAccount(tier.id);
                        }}
                        className={`mt-8 w-full min-h-11 py-3 rounded-full font-medium transition-all duration-300 shadow-lg ${
                          isPopular
                            ? primaryClass
                            : "bg-white text-[#101D4B] border border-[#C5CADB] hover:bg-[#EEF0F6] shadow-slate-200/50"
                        }`}
                      >
                        {isVirtualOffice ? "Choose Virtual Office" : "Become a Member"}
                      </button>
                    ) : (
                      <Link
                        href="/register"
                        className={`mt-8 block text-center py-3 rounded-full font-medium transition-all duration-300 shadow-lg ${
                          isPopular
                            ? primaryClass
                            : "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-slate-200/50"
                        }`}
                      >
                        {isVirtualOffice ? "Choose Virtual Office" : "Become a Member"}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mb-10">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Users className="h-3.5 w-3.5" /> Conference Room
            </h2>
            <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Conference Room</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Private use for meetings, presentations, interviews, and small team sessions · Up to {CONFERENCE_ROOM_CONFIG.maxCapacity} people
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-3xl font-bold text-slate-900">
                    ${(CONFERENCE_ROOM_CONFIG.hourlyRateCents / 100).toFixed(0)}
                  </span>
                  <span className="text-base text-slate-500">/hr</span>
                  {SAYHI_FLOW ? (
                    <Link
                      href="/book?resource=mode-conference"
                      className={`mt-3 flex min-h-11 items-center justify-center rounded-full px-5 py-2 text-sm font-semibold ${primaryClass}`}
                    >
                      Book the Conference Room
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </div>


          {VIRTUAL_ADDRESS ? (
            <div className="mb-10" data-testid="va-option">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Add-on</h2>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[#C5CADB]">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-[#101D4B]"
                  checked={vaChosen}
                  onChange={(e) => chooseVa(e.target.checked)}
                />
                <span>
                  <span className="block font-semibold text-[#101D4B]">Virtual business address · $49/mo</span>
                  <span className="block text-sm text-slate-600">
                    A business mailing address with mail handling, added to your membership.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {vaOfferFor ? (
            <VirtualAddressOffer
              onAnswer={(chosen) => {
                chooseVa(chosen);
                const tierId = vaOfferFor;
                setVaOfferFor(null);
                goToCreateAccount(tierId);
              }}
              onClose={() => setVaOfferFor(null)}
            />
          ) : null}

          <p className="text-center text-sm text-slate-500 mt-8">
            Physical coworking bookings include Wi-Fi and shared amenities. Memberships renew monthly. Cancel anytime.
          </p>
        </div>
      </AppShell>
    </PublicSiteGate>
  );
}

/** Step 4 pop-up: offered once on the way to Create your account. */
function VirtualAddressOffer({ onAnswer, onClose }: { onAnswer: (chosen: boolean) => void; onClose: () => void }) {
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101D4B]/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="va-offer-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        data-testid="va-offer"
      >
        <h2 id="va-offer-title" className="font-display text-xl font-semibold text-[#101D4B]">
          Add a virtual business address?
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Use Hi Coworking as your business mailing address, with mail handling, for $49/mo.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button
            ref={firstButton}
            type="button"
            onClick={() => onAnswer(true)}
            className="min-h-11 flex-1 rounded-full bg-[#101D4B] px-5 text-sm font-semibold text-white hover:bg-[#3A4675]"
          >
            Add it
          </button>
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="min-h-11 flex-1 rounded-full border border-[#C5CADB] px-5 text-sm font-semibold text-[#101D4B] hover:bg-[#EEF0F6]"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
