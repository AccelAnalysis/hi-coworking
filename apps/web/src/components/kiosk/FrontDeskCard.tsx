"use client";

import { useEffect, useState } from "react";
import { formatDayTime, formatMinutes, membersKioskSummary, type MemberKioskSummary } from "@/lib/frontDeskKiosk";

/**
 * SayHi card: this month's visits and check-out reminder. There is no
 * separate front-desk code; the per-booking door code (or email) works on the
 * iPad (decision "one code only", Oct 30, 2026).
 * Hidden while loading and whenever the callable is missing or refuses
 * (Hosting can deploy before the front-desk functions).
 */
export function FrontDeskCard() {
  const [summary, setSummary] = useState<MemberKioskSummary | null>(null);

  useEffect(() => {
    let active = true;
    membersKioskSummary({})
      .then((result) => {
        if (active) setSummary(result.data);
      })
      .catch(() => {
        if (active) setSummary(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!summary) return null;
  const recent = summary.visits.slice(0, 3);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200" data-testid="front-desk-card">
      <h2 className="font-semibold text-[#101D4B]">Your visits</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Your access code checks you in at the door. When you leave, check out on the front-desk iPad with that code or your email.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-slate-600">Visits this month</dt>
          <dd className="text-lg font-semibold text-slate-900">{summary.visits.length}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Extra time recorded</dt>
          <dd className="text-lg font-semibold text-slate-900">{formatMinutes(summary.totalOverageMinutes)}</dd>
        </div>
      </dl>
      {recent.length ? (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          {recent.map((visit) => (
            <li key={visit.visitId} className="flex items-center justify-between gap-3 py-2">
              <span className="text-slate-700">{formatDayTime(visit.checkInAt)}</span>
              <span className="text-right text-slate-600">
                {visit.status === "open"
                  ? "Checked in"
                  : visit.needsReview
                    ? "Under review"
                    : `${formatMinutes(visit.actualMinutes)}${visit.overageMinutes ? ` · ${formatMinutes(visit.overageMinutes)} extra` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.totalOverageMinutes > 0 ? (
        <p className="mt-3 text-xs leading-5 text-slate-600">Extra time is past your booking or included hours. It&apos;s recorded for review and isn&apos;t charged automatically.</p>
      ) : null}
    </div>
  );
}
