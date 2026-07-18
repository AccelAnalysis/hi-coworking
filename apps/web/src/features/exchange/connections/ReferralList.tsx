import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  Link2,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReferralWorkspaceRecord } from "../data/exchangeRun3Gateway";

const STATUS_STYLES: Record<ReferralWorkspaceRecord["status"], string> = {
  draft: "border-slate-300 bg-slate-100/80 text-slate-700",
  sent: "border-blue-200 bg-blue-50/80 text-blue-700",
  accepted: "border-indigo-200 bg-indigo-50/80 text-indigo-700",
  declined: "border-red-200 bg-red-50/80 text-red-700",
  in_progress: "border-cyan-200 bg-cyan-50/80 text-cyan-800",
  converted: "border-emerald-200 bg-emerald-50/80 text-emerald-700",
  closed: "border-slate-300 bg-slate-100/80 text-slate-600",
  withdrawn: "border-amber-200 bg-amber-50/80 text-amber-800",
  expired: "border-slate-300 bg-slate-100/80 text-slate-500",
};

export function ReferralList({
  records,
  selectedId,
  loading,
  onSelect,
}: {
  records: ReferralWorkspaceRecord[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (record: ReferralWorkspaceRecord) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3 p-3" role="status" aria-label="Loading referrals">
        {[0, 1, 2, 3].map((value) => <div key={value} className="h-32 animate-pulse rounded-2xl border border-white/70 bg-white/45 backdrop-blur-xl motion-reduce:animate-none" />)}
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div className="m-3 rounded-2xl border border-dashed border-white/75 bg-white/45 px-6 py-12 text-center backdrop-blur-xl">
        <p className="text-sm font-bold text-slate-800">No referrals match this view.</p>
        <p className="mt-1 text-xs text-slate-500">Adjust the search, lifecycle, industry, or territory filters.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 p-3" aria-label="Business referrals">
      {records.map((record) => {
        const DirectionIcon = record.direction === "sent" ? ArrowUpRight : ArrowDownLeft;
        return (
          <button
            key={record.id}
            type="button"
            onClick={() => onSelect(record)}
            aria-pressed={selectedId === record.id}
            className={cn(
              "w-full rounded-2xl border bg-white/58 p-3 text-left shadow-sm backdrop-blur-xl outline-none transition hover:border-indigo-300 hover:bg-white/78 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500",
              selectedId === record.id ? "border-indigo-500 ring-1 ring-indigo-500" : "border-white/75",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <DirectionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {record.direction}
              </span>
              <span className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize",
                record.activeDispute
                  ? "border-orange-300 bg-orange-50/80 text-orange-800"
                  : STATUS_STYLES[record.status],
              )}>
                {record.activeDispute ? "Disputed" : record.status.replaceAll("_", " ")}
              </span>
            </div>
            <h3 className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-slate-950">{record.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-600">{record.needSummary}</p>
            <p className="mt-2 truncate text-xs font-semibold text-slate-700">
              {record.direction === "sent" ? `To ${record.recipientLabel}` : `From ${record.referrerLabel}`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <span>{record.category}</span>
              {record.territoryLabel ? <span>· {record.territoryLabel}</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-white/62 px-1.5 py-1 text-[10px] font-semibold text-slate-600">
                <CircleDollarSign className="h-3 w-3" aria-hidden="true" /> {record.compensation.label}
              </span>
              {record.linkedEntities.length ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50/80 px-1.5 py-1 text-[10px] font-semibold text-indigo-700">
                  <Link2 className="h-3 w-3" aria-hidden="true" /> {record.linkedEntities.length} linked
                </span>
              ) : null}
              {record.activeDispute ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-orange-50/80 px-1.5 py-1 text-[10px] font-semibold text-orange-800">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Review hold
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}