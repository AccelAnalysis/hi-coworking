"use client";

import Link from "next/link";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { WELCOME_NEXT_STEPS, type WelcomeBannerCopy } from "@/lib/membershipCopy";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

export function MembershipWelcomeBanner({
  copy,
  onDismiss,
}: {
  copy: WelcomeBannerCopy;
  onDismiss: () => void;
}) {
  const active = copy.state === "active";
  return (
    <section
      aria-labelledby="membership-welcome-title"
      className="mb-8 rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-200 sm:p-6"
    >
      <div className="flex items-start gap-3">
        {active ? (
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
        ) : (
          <Loader2 aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700 motion-safe:animate-spin" />
        )}
        <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
          <h2 id="membership-welcome-title" className="text-lg font-bold text-emerald-950 sm:text-xl">
            {copy.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-emerald-900 sm:text-base">
            {copy.body}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss welcome message"
          className={`-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-emerald-900 transition hover:bg-emerald-100 ${FOCUS_RING}`}
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      <h3 className="mt-5 text-sm font-semibold text-emerald-950">Your next steps</h3>
      <ul className="mt-2 grid gap-3 sm:grid-cols-3">
        {WELCOME_NEXT_STEPS.map((step, index) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className={`flex h-full min-h-11 flex-col rounded-xl p-4 transition ${
                index === 0
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-white text-slate-900 ring-1 ring-emerald-200 hover:bg-emerald-100"
              } ${FOCUS_RING}`}
            >
              <span className="text-sm font-semibold">{step.label}</span>
              <span className={`mt-1 text-sm ${index === 0 ? "text-slate-200" : "text-slate-600"}`}>
                {step.detail}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
