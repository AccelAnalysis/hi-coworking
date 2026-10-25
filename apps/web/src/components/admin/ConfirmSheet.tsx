"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

/**
 * In-app confirmation sheet for important or destructive admin actions.
 * Replaces window.confirm (audit P2-4) with a labelled modal dialog that
 * traps focus (native <dialog>), closes on Escape, and names the action on
 * its confirm button.
 */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Keep as is",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-3xl bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/40"
    >
      {open && (
        <div className="p-6">
          <h2 id={titleId} className="text-xl font-semibold tracking-tight">{title}</h2>
          {children && <div id={bodyId} className="mt-3 space-y-3 text-sm leading-6 text-slate-700">{children}</div>}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              autoFocus
              className="min-h-11 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={busy}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${destructive ? "bg-rose-700" : "bg-slate-950"}`}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
