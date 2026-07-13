import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export function ExchangeLeftPanel({
  collapsed,
  filterContent,
  resultsContent,
  showResults,
  onToggle,
}: {
  collapsed: boolean;
  filterContent: ReactNode;
  resultsContent: ReactNode;
  showResults: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      id="exchange-left-panel"
      className={cn(
        "relative z-20 hidden min-h-0 shrink-0 flex-col border-r border-slate-200 bg-slate-50 shadow-sm transition-[width] duration-200 motion-reduce:transition-none lg:flex",
        collapsed ? "w-14" : "w-[320px] 2xl:w-[350px]",
      )}
      aria-label="Exchange results and filters"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
        {!collapsed ? <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Discover</span> : null}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="exchange-left-panel-content"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={collapsed ? "Expand results panel" : "Collapse results panel"}
          title={collapsed ? "Expand results panel" : "Collapse results panel"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <div id="exchange-left-panel-content" className={cn("min-h-0 flex-1 flex-col", collapsed ? "hidden" : "flex")}>
        <div className={cn("shrink-0 overflow-y-auto border-b border-slate-200 bg-white", showResults ? "max-h-[46%]" : "max-h-full")}>{filterContent}</div>
        {showResults ? <div className="min-h-0 flex-1">{resultsContent}</div> : null}
      </div>
    </aside>
  );
}
