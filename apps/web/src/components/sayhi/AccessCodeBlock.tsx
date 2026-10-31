"use client";

import { KeyRound } from "lucide-react";
import { accessCodeView, type AccessGrantSummary } from "@/lib/accessCodeView";

/** The per-booking door code, shown next to its scheduled time. */
export function AccessCodeBlock({
  access,
  loading,
  now,
  label = "Access code",
}: {
  access?: AccessGrantSummary;
  loading: boolean;
  now: number;
  label?: string;
}) {
  const view = accessCodeView(access, { loading, now });
  return (
    <div className="mt-5 rounded-xl bg-[#EEF0F6] p-4" data-testid="access-code-block">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#101D4B]">
        <KeyRound aria-hidden="true" className="h-4 w-4" />
        {label}
      </div>
      {view.kind === "code" ? (
        <>
          <p
            className="mt-2 text-3xl font-bold tabular-nums tracking-[0.2em] text-[#101D4B]"
            aria-label={`Access code ${view.spoken}`}
            data-testid="access-code"
          >
            {view.code}
          </p>
          <p className="mt-2 text-sm leading-6 text-[#3A4675]">{view.text}</p>
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-[#3A4675]" role={view.kind === "attention" ? "status" : undefined}>
          {view.text}
        </p>
      )}
    </div>
  );
}
