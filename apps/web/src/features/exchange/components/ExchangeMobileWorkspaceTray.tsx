"use client";

import Link from "next/link";
import type { ReactNode } from "react";
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
  resultCount,
  loading = false,
  children,
  onSurfaceModeChange,
}: {
  view: ExchangeView;
  surfaceMode: ExchangeSurfaceMode;
  resultCount?: number;
  loading?: boolean;
  children?: ReactNode;
  onSurfaceModeChange: (mode: ExchangeSurfaceMode) => void;
}) {
  const currentView = canonicalView(view);
  const listVisible = surfaceMode === "list";

  return (
    <section
      className={cn(
        "fixed inset-x-0 bottom-[4.75rem] z-[65] flex flex-col overflow-hidden rounded-t-[1.75rem] border border-b-0 border-white/60 bg-white/78 shadow-[0_-18px_50px_rgba(15,23,42,0.22)] backdrop-blur-2xl transition-[height] duration-300 motion-reduce:transition-none lg:hidden",
        listVisible
          ? "h-[min(76dvh,calc(100dvh-7.75rem))]"
          : "h-[10.75rem]",
      )}
      aria-label={`${currentView} results and workspace controls`}
      aria-expanded={listVisible}
    >
      <button
        type="button"
        onClick={() => onSurfaceModeChange(listVisible ? "map" : "list")}
        className="flex h-7 w-full shrink-0 items-center justify-center rounded-t-[1.75rem] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        aria-label={listVisible ? "Collapse the result drawer" : "Expand the result drawer"}
      >
        <span className="h-1.5 w-16 rounded-full bg-slate-400/90" />
      </button>

      <div className="flex shrink-0 items-center justify-between border-b border-white/70 px-4 pb-2">
        <button
          type="button"
          onClick={() => onSurfaceModeChange("list")}
          className="inline-flex min-h-9 items-center gap-1 text-xs font-black text-blue-700"
          title="Open sorted results"
        >
          Sort: Default <ChevronUp className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2">
          {typeof resultCount === "number" ? (
            <span className="rounded-full border border-white/80 bg-white/65 px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">
              {loading ? "Loading…" : `${resultCount.toLocaleString("en-US")} results`}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onSurfaceModeChange(listVisible ? "map" : "list")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/80 bg-white/55 px-3 text-xs font-black text-blue-700 shadow-sm outline-none hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {listVisible ? <Map className="h-4 w-4" aria-hidden="true" /> : <List className="h-4 w-4" aria-hidden="true" />}
            {listVisible ? "Map View" : "List View"}
          </button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-4 gap-1 border-b border-white/60 px-3 py-2">
        {ACTIONS[currentView].map((action, index) => {
          const className = cn(
            "flex min-h-10 items-center justify-center gap-1 rounded-xl border px-1 text-center text-[10px] font-black outline-none transition focus-visible:ring-2 focus-visible:ring-blue-600",
            index === 0 && !listVisible
              ? "border-blue-500/70 bg-blue-50/80 text-blue-700 shadow-sm"
              : "border-white/80 bg-white/45 text-slate-600 hover:bg-white/80",
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

      {listVisible ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-white/38">
          {children ?? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-slate-600">
              Results for this view will appear here as verified records become available.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}