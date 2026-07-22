"use client";

import { Building2, ChevronRight, Eye, RefreshCw, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeOrganizationContextState } from "../data/useExchangeOrganizationContext";
import {
  exchangeWorkspaceActions,
  type ExchangeWorkspaceAction,
} from "../state/exchangeWorkspaceActions";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import type { ExchangeHistoryMode } from "../views/exchangeViewTypes";

export function ExchangeOrganizationContextBar({
  state,
  context,
  applyAction,
}: {
  state: ExchangeWorkspaceState;
  context: ExchangeOrganizationContextState;
  applyAction: (
    action: ExchangeWorkspaceAction,
    history?: ExchangeHistoryMode,
  ) => ExchangeWorkspaceState;
}) {
  const actor = context.actors.find(
    (candidate) => candidate.organizationId === state.actorOrganizationId,
  );
  const subjectName = context.perspective?.organization?.name;
  const subjectHeading = context.perspective?.perspective.heading;

  return (
    <div
      className="relative z-[1250] flex min-h-12 shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white/88 px-3 py-1.5 shadow-sm backdrop-blur-2xl sm:px-4"
      aria-label="Exchange organization context"
      data-exchange-context-bar
    >
      <label className="flex min-w-0 items-center gap-2">
        <span className="hidden text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:inline">Working as</span>
        <Building2 className="h-4 w-4 shrink-0 text-indigo-700 sm:hidden" aria-hidden="true" />
        <select
          value={state.actorOrganizationId ?? ""}
          disabled={context.actorsLoading || context.actors.length === 0}
          onChange={(event) => context.requestActorOrganization(event.target.value)}
          className="h-9 min-w-0 max-w-[13rem] rounded-xl border border-slate-200 bg-white/90 px-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:text-slate-500"
          aria-label="Working as organization"
        >
          {context.actors.length === 0 ? (
            <option value="">No active organization</option>
          ) : null}
          {context.actors.map((candidate) => (
            <option key={candidate.organizationId} value={candidate.organizationId}>
              {candidate.name} · {candidate.membershipRole}
            </option>
          ))}
        </select>
      </label>

      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Eye className="hidden h-4 w-4 shrink-0 text-violet-700 sm:block" aria-hidden="true" />
        {state.subjectOrganizationId ? (
          <button
            type="button"
            onClick={() => applyAction(exchangeWorkspaceActions.setOrganizationDrawerOpen(true))}
            className="min-w-0 rounded-lg px-2 py-1 text-left outline-none hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Open active organization context"
          >
            <span className="block truncate text-xs font-black text-slate-950">
              {subjectName ?? (context.perspectiveLoading ? "Resolving organization…" : "Organization context")}
            </span>
            <span className="hidden truncate text-[10px] font-semibold text-slate-500 sm:block">
              {subjectHeading ?? "Viewer-relative fields will appear after authorization."}
            </span>
          </button>
        ) : (
          <span className="truncate text-xs font-semibold text-slate-500">Select an organization to keep it in context across modes.</span>
        )}
        {state.subjectOrganizationId ? (
          <button
            type="button"
            onClick={() => applyAction(exchangeWorkspaceActions.clearSubjectOrganization(), "push")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Clear active organization context"
            title="Clear organization context"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {context.actorFallbackApplied ? (
        <span className="hidden items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 lg:inline-flex" role="status">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> Safe actor restored
        </span>
      ) : null}
      {context.error ? (
        <button
          type="button"
          onClick={context.refresh}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-amber-700 outline-none hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500",
            context.actorsLoading && "animate-pulse motion-reduce:animate-none",
          )}
          aria-label={`${context.error} Retry organization context`}
          title={context.error}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {context.error ?? (actor ? `Working as ${actor.name}` : "No validated actor organization")}
      </span>
    </div>
  );
}
