"use client";

import { useRef, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { useDialogFocus } from "../utils/useDialogFocus";

export function ExchangeMobileDrawer({
  open,
  activeFilterCount,
  children,
  onClose,
  onClear,
}: {
  open: boolean;
  activeFilterCount: number;
  children: ReactNode;
  onClose: () => void;
  onClear: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  useDialogFocus(open, drawerRef, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close filters"
      />
      <aside
        id="exchange-filter-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exchange-filter-drawer-title"
        className="absolute inset-y-0 right-0 flex w-[min(92vw,390px)] flex-col bg-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-right motion-reduce:transition-none"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="exchange-filter-drawer-title" className="flex items-center gap-2 text-base font-bold text-slate-950">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{activeFilterCount ? `${activeFilterCount} active` : "No active filters"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Close filters"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{children}</div>
        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClear}
            disabled={activeFilterCount === 0}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Apply filters
          </button>
        </footer>
      </aside>
    </div>
  );
}
