import type { ReactNode } from "react";
import { PanelRightClose, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ExchangeRightPanel({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <aside
      id="exchange-right-panel"
      aria-label="Selected Exchange record"
      className={cn(
        "z-30 hidden min-h-0 w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-xl lg:flex",
        "max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:w-[min(390px,42vw)]",
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
        <PanelRightClose className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-[0.12em] text-slate-600">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Close selected record details"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </aside>
  );
}
