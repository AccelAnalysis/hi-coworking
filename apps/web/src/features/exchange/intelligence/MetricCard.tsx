import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  detail,
  sampleSize,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  sampleSize: number;
  icon: LucideIcon;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
        <span className="rounded-xl bg-indigo-50 p-2 text-indigo-700"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p>
      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] font-semibold text-slate-500">Sample: {sampleSize.toLocaleString("en-US")} qualifying record{sampleSize === 1 ? "" : "s"}</p>
    </article>
  );
}
