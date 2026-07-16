import { ChartNoAxesCombined, Handshake, MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeView } from "../state/exchangeWorkspaceTypes";

const VIEWS: Array<{
  view: ExchangeView;
  label: string;
  icon: typeof MapPinned;
}> = [
  { view: "opportunities", label: "Opportunities", icon: MapPinned },
  { view: "connections", label: "Connections", icon: Handshake },
  { view: "intelligence", label: "Intelligence", icon: ChartNoAxesCombined },
];

export function ExchangeViewTabs({
  view,
  onChange,
}: {
  view: ExchangeView;
  onChange: (view: ExchangeView) => void;
}) {
  return (
    <nav
      className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-slate-700 bg-slate-900 p-1 [scrollbar-width:none]"
      aria-label="Exchange views"
    >
      {VIEWS.map(({ view: candidate, label, icon: Icon }) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onChange(candidate)}
          aria-current={view === candidate ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-400 sm:min-h-9",
            view === candidate
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-300 hover:bg-slate-800 hover:text-white",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
