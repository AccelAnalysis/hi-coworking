"use client";

import Link from "next/link";
import { ChevronUp, List, Map, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ExchangeSurfaceMode,
  ExchangeView,
} from "../state/exchangeWorkspaceTypes";

type CanonicalView = "intelligence" | "referrals" | "opportunities" | "resources";

interface TrayAction {
  label: string;
  href?: string;
  starred?: boolean;
}

const ACTIONS: Record<CanonicalView, readonly TrayAction[]> = {
  intelligence: [
    { label: "Overview", href: "/exchange?view=intelligence&metric=overview" },
    { label: "Relationships", href: "/exchange?view=intelligence&metric=relationships" },
    { label: "Gaps", href: "/exchange?view=intelligence&metric=gaps" },
    { label: "Impact", href: "/exchange?view=intelligence&metric=impact" },
  ],
  referrals: [
    { label: "New Referral", href: "/exchange?view=referrals&connectionMode=draft" },
    { label: "Received", href: "/exchange?view=referrals&connectionMode=received" },
    { label: "Sent", href: "/exchange?view=referrals&connectionMode=sent" },
    { label: "Active", href: "/exchange?view=referrals&connectionMode=active" },
  ],
  opportunities: [
    { label: "Search" },
    { label: "Post Opportunity", href: "/rfx/new" },
    { label: "My Opportunities", href: "/rfx/manage" },
    { label: "Starred", href: "/profile", starred: true },
  ],
  resources: [
    { label: "Search" },
    { label: "Programs", href: "/exchange?view=resources&q=program" },
    { label: "Providers", href: "/exchange?view=resources&q=provider" },
    { label: "Saved", href: "/profile", starred: true },
  ],
};

function canonicalView(view: ExchangeView): CanonicalView {
  if (view === "connections") return "referrals";
  if (view === "businesses" || view === "teaming") return "opportunities";
  return view as CanonicalView;
}

export function ExchangeMobileWorkspaceTray({
  view,
  surfaceMode,
  onSurfaceModeChange,
}: {
  view: ExchangeView;
  surfaceMode: ExchangeSurfaceMode;
  onSurfaceModeChange: (mode: ExchangeSurfaceMode) => void;
}) {
  const currentView = canonicalView(view);
  const listVisible = surfaceMode === "list";

  return (
    <section
      className="absolute inset-x-0 bottom-[4.75rem] z-40 h-[10.5rem] rounded-t-[1.5rem] border-t border-slate-200 bg-white shadow-[0_-14px_35px_rgba(15,23,42,0.18)] lg:hidden"
      aria-label={`${currentView} workspace controls`}
    >
      <button
        type="button"
        onClick={() => onSurfaceModeChange(listVisible ? "map" : "list")}
        className="flex h-6 w-full items-center justify-center rounded-t-[1.5rem] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        aria-label={listVisible ? "Return to map view" : "Open full list view"}
      >
        <span className="h-1.5 w-14 rounded-full bg-slate-400" />
      </button>

      <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-2">
        <button
          type="button"
          onClick={() => onSurfaceModeChange("list")}
          className="inline-flex min-h-9 items-center gap-1 text-xs font-bold text-blue-700"
          title="Open the current view controls"
        >
          Sort: Default <ChevronUp className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onSurfaceModeChange(listVisible ? "map" : "list")}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {listVisible ? <Map className="h-4 w-4" aria-hidden="true" /> : <List className="h-4 w-4" aria-hidden="true" />}
          {listVisible ? "Map View" : "List View"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1 px-3 py-2">
        {ACTIONS[currentView].map((action, index) => {
          const className = cn(
            "flex min-h-10 items-center justify-center gap-1 rounded-lg border px-1 text-center text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
            index === 0 && !listVisible
              ? "border-blue-600 bg-blue-50 text-blue-700"
              : "border-slate-200 text-slate-600",
          );
          const label = (
            <>
              {action.starred ? <Star className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              {action.label}
            </>
          );
          if (action.href) {
            return (
              <Link key={action.label} href={action.href} className={className}>
                {label}
              </Link>
            );
          }
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onSurfaceModeChange("list")}
              className={className}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
