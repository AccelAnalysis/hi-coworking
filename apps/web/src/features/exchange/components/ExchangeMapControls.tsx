"use client";

import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeMapDimension } from "../map/mapConfig";

export function ExchangeMapControls({
  dimension,
  onDimensionChange,
  onOrganizationHome,
  organizationHomeAvailable,
  drawerOpen,
}: {
  dimension: ExchangeMapDimension;
  onDimensionChange: (dimension: ExchangeMapDimension) => void;
  onOrganizationHome: () => void;
  organizationHomeAvailable: boolean;
  drawerOpen: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] z-[1200] flex max-w-[calc(100%-1.5rem)] items-center gap-2",
        drawerOpen
          ? "right-[max(0.75rem,env(safe-area-inset-right))] lg:right-[calc(min(94vw,26rem)+1.5rem)]"
          : "right-[max(0.75rem,env(safe-area-inset-right))]",
      )}
      data-exchange-map-control-layer
    >
      {organizationHomeAvailable ? (
        <button
          type="button"
          onClick={onOrganizationHome}
          className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/60 bg-white/88 px-3 text-xs font-black text-slate-800 shadow-lg backdrop-blur-xl outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-600"
          aria-label="Return to organization home"
        >
          <Building2 className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Organization home</span>
        </button>
      ) : null}
      <div
        className="pointer-events-auto flex rounded-xl border border-white/60 bg-white/88 p-1 shadow-lg backdrop-blur-xl"
        role="group"
        aria-label="Map dimension"
      >
        {(["2d", "3d"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => onDimensionChange(candidate)}
            aria-pressed={dimension === candidate}
            className={cn(
              "min-h-9 rounded-lg px-3 text-xs font-black uppercase tracking-[0.08em] outline-none transition focus-visible:ring-2 focus-visible:ring-blue-600",
              dimension === candidate
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-950",
            )}
          >
            {candidate.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
