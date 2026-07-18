"use client";

import { useRef, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { useDialogFocus } from "../utils/useDialogFocus";

export function ExchangeDetailSheet({
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
  const sheetRef = useRef<HTMLElement>(null);
  useDialogFocus(open, sheetRef, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1350] isolate lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close selected record"
      />
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exchange-detail-sheet-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[82dvh] min-h-[36dvh] flex-col rounded-t-[28px] border border-b-0 border-white/60 bg-white/86 shadow-2xl backdrop-blur-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom motion-reduce:transition-none"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-white/70 bg-white/58 px-4 py-3 backdrop-blur-xl">
          <span className="absolute left-1/2 top-2 mx-auto h-1 w-11 -translate-x-1/2 rounded-full bg-slate-300" aria-hidden="true" />
          <ChevronDown className="mt-1 h-4 w-4 text-slate-400" aria-hidden="true" />
          <h2 id="exchange-detail-sheet-title" className="mt-1 min-w-0 flex-1 truncate text-sm font-bold text-slate-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 outline-none hover:bg-white/80 focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Close selected record"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </section>
    </div>
  );
}
