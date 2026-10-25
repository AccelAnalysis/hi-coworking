"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Accessible modal built on the native <dialog> element: focus is moved
 * into the dialog and trapped by the browser, Escape closes it, and focus
 * returns to the control that opened it.
 */
export function DesignerDialog({
  open,
  title,
  description,
  children,
  onClose,
  footer,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button");
      first?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      restoreRef.current?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {description ? (
          <div id={descId} className="mt-2 text-sm text-slate-600">
            {description}
          </div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>
    </dialog>
  );
}

export const dialogButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40";
