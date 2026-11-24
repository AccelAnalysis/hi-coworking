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
  CONFERENCE_ROOM_SLOTS,
  SEAT_TIERS,
  formatUsdCents,
  type SeatTierId,
} from "@hi/shared";

const DESK_TIER_ROWS: Array<{ id: SeatTierId; seats: string; detail: string }> = [
  { id: "basic", seats: "D1–D2", detail: "Shared conference-table seats" },
  { id: "window", seats: "D3–D4", detail: "Window sit-stand desks" },
  { id: "equipped", seats: "D5–D6", detail: "Window sit-stand, curved monitor, and dock" },
];

function usd(cents: number) {
  return formatUsdCents(cents) ?? "";
}

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
              Book a desk by the hour, half-day, or full day, become a member for included hours and lower rates, or choose SayHi Connect to book at guest rates whenever you need a desk.
            </p>
          </div>

          {error && (
            <div className="max-w-md mx-auto mb-8 p-4 rounded-xl bg-red-50 text-red-700 text-sm text-center border border-red-200">
              {error}
            </div>
          )}

          <section className="mb-10" aria-labelledby="desk-rates-heading">
            <h2 id="desk-rates-heading" className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Desks by the hour, half-day, or day
            </h2>
            <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm ring-1 ring-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm" data-testid="desk-rate-table">
                  <caption className="sr-only">Guest desk rates by seat tier</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="py-3 pr-4 font-semibold">Seat</th>
                      <th scope="col" className="py-3 pr-4 font-semibold">Hourly</th>
                      <th scope="col" className="py-3 pr-4 font-semibold">Half-day (4 hrs)</th>
                      <th scope="col" className="py-3 font-semibold">Full day (9 hrs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {DESK_TIER_ROWS.map((row) => {
                      const tier = SEAT_TIERS[row.id];
                      return (
                        <tr key={row.id}>
                          <th scope="row" className="py-4 pr-4 font-normal">
                            <span className="block font-semibold text-[#101D4B]">{tier.name} · {row.seats}</span>
                            <span className="block text-xs text-slate-500">{row.detail}</span>
                          </th>
                          <td className="py-4 pr-4 font-semibold tabular-nums text-slate-900">{usd(tier.guestHourlyCents)}/hr</td>
                          <td className="py-4 pr-4 font-semibold tabular-nums text-slate-900">{usd(tier.guestHalfDayCents)}</td>
                          <td className="py-4 font-semibold tabular-nums text-slate-900">{usd(tier.guestDayCents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <p className="text-sm leading-6 text-slate-600">
                  Choose Morning (8–12), Afternoon (1–5), Full day (8–5), or custom hours. Hourly time never costs more than the half-day price for up to {GUEST_PRICING.halfDayHours} hours, or the day price for longer. Book up to {GUEST_PRICING.bookingWindowDays} days ahead.
                </p>
                <Link
                  href="/book"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center px-6 py-3 rounded-full font-medium bg-white text-[#101D4B] border border-[#C5CADB] hover:bg-[#EEF0F6] shadow-sm transition-all"
                >
                  Book a desk
                </Link>
              </div>
            </div>
          </section>

          <div className="mb-10">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Users className="h-3.5 w-3.5" /> Membership Plans
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {MEMBERSHIP_TIERS.map((tier) => {
                const isPopular = tier.id === "coworking";
                const isSayHiConnect = tier.id === "virtual";
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
                      {isSayHiConnect ? (
                        <>
                          <p className="text-sm font-semibold text-[#101D4B]">Desks at guest rates</p>
                          <p className="text-xs text-[#3A4675] mt-0.5">From {usd(SEAT_TIERS.basic.guestHourlyCents)}/hr · Accel Procurement Founders access included</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[#101D4B]">
                            {tier.includedHoursPerMonth} desk hours/month included
                          </p>
                          <p className="text-xs text-[#3A4675] mt-0.5">
                            {tier.id === "coworking" ? "Basic and Window seats (D1–D4)" : "Basic, Window, and Equipped seats (D1–D6)"} · {tier.overageDiscountPercent}% off extra time
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
                          isSayHiConnect ? "Choose SayHi Connect" : "Become a Member"
                        )}
                      </button>
                    ) : SAYHI_FLOW ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (VIRTUAL_ADDRESS && !isSayHiConnect && !vaChosen) setVaOfferFor(tier.id);
                          else goToCreateAccount(tier.id);
                        }}
                        className={`mt-8 w-full min-h-11 py-3 rounded-full font-medium transition-all duration-300 shadow-lg ${
                          isPopular
                            ? primaryClass
                            : "bg-white text-[#101D4B] border border-[#C5CADB] hover:bg-[#EEF0F6] shadow-slate-200/50"
                        }`}
                      >
                        {isSayHiConnect ? "Choose SayHi Connect" : "Become a Member"}
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
                        {isSayHiConnect ? "Choose SayHi Connect" : "Become a Member"}
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
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Conference Room</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Private use for meetings, presentations, interviews, and small team sessions · Seats {CONFERENCE_ROOM_CONFIG.maxCapacity}
                  </p>
                  <ul className="mt-4 space-y-2" data-testid="conference-slots">
                    {CONFERENCE_ROOM_SLOTS.map((slot) => (
                      <li key={slot.id} className="flex items-center gap-3 text-sm text-slate-700">
                        <span className="w-5 h-5 rounded-full bg-[#EEF0F6] flex items-center justify-center text-[#101D4B] shrink-0">
                          <Check size={12} strokeWidth={3} aria-hidden="true" />
                        </span>
                        <span><span className="font-semibold text-[#101D4B]">{slot.label}</span> · {slot.timeLabel}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs leading-5 text-slate-500">
                    Weekdays, booked in 4-hour slots. Evenings and weekends are available by appointment at {usd(CONFERENCE_ROOM_CONFIG.afterHoursSlotPriceCents)} per 4-hour slot. <Link href="/contact" className="font-semibold text-[#101D4B] underline underline-offset-2">Contact us</Link> to arrange one.
                  </p>
                </div>
                <div className="md:text-right">
                  <span className="text-3xl font-bold text-slate-900">
                    {usd(CONFERENCE_ROOM_CONFIG.slotPriceCents)}
                  </span>
                  <span className="text-base text-slate-500"> per 4-hour slot</span>
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
            Desk and room bookings include Wi-Fi and shared amenities. Memberships renew monthly. Cancel anytime.
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
