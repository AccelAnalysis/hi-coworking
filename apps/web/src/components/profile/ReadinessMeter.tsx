"use client";

import { CheckCircle2, Clock3, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ProfileReadinessTier, ProfileDoc } from "@hi/shared";

interface ReadinessMeterProps {
  completeness: number;
  readinessTier: ProfileReadinessTier;
  verificationStatus: ProfileDoc["verificationStatus"];
}

const readinessLabel: Record<ProfileReadinessTier, string> = {
  seat_ready: "Seat-Ready",
  bid_ready: "Bid-Ready",
  procurement_ready: "Procurement-Ready",
};

export function ReadinessMeter({
  completeness,
  readinessTier,
  verificationStatus,
}: ReadinessMeterProps) {
  const verificationPill =
    verificationStatus === "verified"
      ? {
          icon: ShieldCheck,
          label: "Verified",
          className: "bg-emerald-100 text-emerald-800 border-emerald-300",
        }
      : verificationStatus === "pending"
      ? {
          icon: Clock3,
          label: "Verification Pending",
          className: "bg-amber-100 text-amber-800 border-amber-300",
        }
      : verificationStatus === "rejected"
      ? {
          icon: ShieldAlert,
          label: "Action Required",
          className: "bg-red-100 text-red-800 border-red-300",
        }
      : {
          icon: ShieldAlert,
          label: "Not Verified",
          className: "bg-slate-100 text-slate-600 border-slate-300",
        };

  const readinessPill =
    readinessTier === "procurement_ready"
      ? {
          icon: CheckCircle2,
          className: "bg-emerald-100 text-emerald-800 border-emerald-300",
        }
      : readinessTier === "bid_ready"
      ? {
          icon: CheckCircle2,
          className: "bg-blue-100 text-blue-800 border-blue-300",
        }
      : {
          icon: Clock3,
          className: "bg-slate-100 text-slate-700 border-slate-300",
        };

  const ReadinessIcon = readinessPill.icon;
  const VerificationIcon = verificationPill.icon;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${readinessPill.className}`}
        >
          <ReadinessIcon className="h-3.5 w-3.5" />
          {readinessLabel[readinessTier]}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${verificationPill.className}`}
        >
          <VerificationIcon className="h-3.5 w-3.5" />
          {verificationPill.label}
        </span>
      </div>

      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>Profile completeness</span>
        <span className="font-semibold text-slate-700">{completeness}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-slate-900 transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, completeness))}%` }}
        />
      </div>
    </div>
  );
}
