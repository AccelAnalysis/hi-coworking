"use client";

import { useEffect, useState } from "react";
import { formatDayTime, formatMinutes, membersKioskSummary, type MemberKioskSummary } from "@/lib/frontDeskKiosk";

/**
 * SayHi card: the member's front-desk check-in code and this month's visits.
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
      <h2 className="text-sm font-medium text-slate-600">Front-desk check-in</h2>
      <p className="mt-1 font-mono text-2xl font-bold tracking-[0.18em] text-slate-900" aria-label={`Member code ${summary.code.split("").join(" ")}`}>
        {summary.code}
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Enter this code or your email on the front-desk iPad when you arrive and when you leave.
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
