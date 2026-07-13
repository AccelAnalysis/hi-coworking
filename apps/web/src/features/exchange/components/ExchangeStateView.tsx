import {
  CircleOff,
  KeyRound,
  ListFilter,
  Loader2,
  LockKeyhole,
  MapPinned,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getExchangeStateCopy, type ExchangeStateKind } from "./exchangeStateCopy";

export { getExchangeStateCopy, type ExchangeStateKind } from "./exchangeStateCopy";

const ICONS = {
  loading: Loader2,
  empty: CircleOff,
  "filtered-empty": ListFilter,
  error: TriangleAlert,
  permission: LockKeyhole,
  "selection-unavailable": CircleOff,
  "token-missing": KeyRound,
  "map-error": TriangleAlert,
  "no-geocoded-rfx": MapPinned,
} satisfies Record<ExchangeStateKind, typeof Loader2>;

export function ExchangeStateView({
  kind,
  message,
  onRetry,
  onClear,
  compact = false,
}: {
  kind: ExchangeStateKind;
  message?: string;
  onRetry?: () => void;
  onClear?: () => void;
  compact?: boolean;
}) {
  const copy = getExchangeStateCopy(kind);
  const Icon = ICONS[kind];
  return (
    <section
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/90 text-center",
        compact ? "p-5" : "min-h-64 p-8",
      )}
      aria-live={kind === "loading" ? "polite" : "assertive"}
      aria-busy={kind === "loading"}
    >
      <span className="mb-3 rounded-2xl bg-slate-100 p-3 text-slate-500">
        <Icon className={cn("h-6 w-6", kind === "loading" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      </span>
      <h2 className="text-base font-bold text-slate-900">{copy.title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-600">{message || copy.description}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
        ) : null}
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </section>
  );
}
