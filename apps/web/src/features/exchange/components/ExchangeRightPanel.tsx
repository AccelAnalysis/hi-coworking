import type { ReactNode } from "react";
import { PanelRightClose, X } from "lucide-react";

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
      className="absolute bottom-3 right-3 top-3 z-40 hidden min-h-0 w-[min(390px,38vw)] flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/74 shadow-[0_20px_55px_rgba(15,23,42,0.28)] backdrop-blur-2xl lg:flex"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/70 bg-white/45 px-3">
        <PanelRightClose className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-black uppercase tracking-[0.12em] text-slate-700">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 outline-none hover:bg-white/85 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Close selected record details"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white/30">{children}</div>
    </aside>
  );
}