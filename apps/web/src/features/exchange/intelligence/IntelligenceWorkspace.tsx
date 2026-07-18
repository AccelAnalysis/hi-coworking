"use client";

import { useMemo } from "react";
import {
  Activity,
  BadgeCheck,
  Clock3,
  Factory,
  Gauge,
  Handshake,
  Info,
  MapPinned,
  Network,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ExchangeCommandBar } from "../components/ExchangeCommandBar";
import { ExchangeDetailSheet } from "../components/ExchangeDetailSheet";
import { ExchangeMobileDrawer } from "../components/ExchangeMobileDrawer";
import { ExchangeMobileWorkspaceTray } from "../components/ExchangeMobileWorkspaceTray";
import { ExchangeStateView } from "../components/ExchangeStateView";
import type {
  ExchangeRun3Gateway,
  ReferralGapInsight,
  ReferralIntelligenceSnapshot,
  ReferralRelationshipInsight,
} from "../data/exchangeRun3Gateway";
import { useIntelligenceData } from "../data/useIntelligenceData";
import { exchangeWorkspaceActions } from "../state/exchangeWorkspaceActions";
import {
  EXCHANGE_INTELLIGENCE_METRICS,
  type ExchangeIntelligenceMetric,
  type ExchangeRelationshipFilter,
  type ExchangeWorkspaceState,
} from "../state/exchangeWorkspaceTypes";
import type { ExchangeViewProps } from "../views/exchangeViewTypes";
import { downloadReferralIntelligenceCsv } from "./AnalyticsCsvExport";
import { DataQualityNotice } from "./DataQualityNotice";
import { EconomicImpact } from "./EconomicImpact";
import { GapAnalysis } from "./GapAnalysis";
import { MetricCard } from "./MetricCard";
import { ReciprocalPatterns } from "./ReciprocalPatterns";
import {
  RelationshipExplanation,
  RelationshipInsights,
} from "./RelationshipInsights";

const METRIC_LABELS: Record<ExchangeIntelligenceMetric, string> = {
  overview: "Overview",
  relationships: "Relationships",
  gaps: "Gaps",
  impact: "Impact",
};

const METRIC_ICONS = [Network, Gauge, TrendingUp, Clock3, Activity, ShieldCheck];

function includesQuery(values: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}

function filterIntelligence(
  snapshot: ReferralIntelligenceSnapshot,
  state: ExchangeWorkspaceState,
) {
  const query = state.searchQuery.trim().toLocaleLowerCase();
  const relationships = snapshot.relationships.filter((relationship) => (
    (state.relationshipFilter === "all" || relationship.state === state.relationshipFilter)
    && includesQuery([
      relationship.partnerLabel,
      relationship.state,
      relationship.explanation,
      ...relationship.factors,
    ], query)
  ));
  const industryGaps = snapshot.industryGaps.filter((gap) => (
    (state.connectionIndustryFilters.length === 0 || state.connectionIndustryFilters.includes(gap.label))
    && includesQuery([gap.label, gap.explanation], query)
  ));
  const territoryGaps = snapshot.territoryGaps.filter((gap) => (
    (state.connectionTerritoryFilters.length === 0 || state.connectionTerritoryFilters.includes(gap.label))
    && includesQuery([gap.label, gap.explanation], query)
  ));
  const networkMetrics = snapshot.networkMetrics.filter((metric) => includesQuery([
    metric.label,
    metric.value,
    metric.detail,
  ], query));
  const reciprocalPatterns = snapshot.reciprocalPatterns.filter((pattern) => includesQuery([
    pattern.partnerLabel,
    pattern.classification,
    pattern.notice,
    ...pattern.factors,
  ], query));
  return { relationships, industryGaps, territoryGaps, networkMetrics, reciprocalPatterns };
}

export function IntelligenceWorkspace({
  state,
  applyAction,
  scheduleUrlReplace,
  onViewChange,
  gateway,
}: ExchangeViewProps & { gateway: ExchangeRun3Gateway }) {
  const { snapshot, loading, refreshing, error, refresh } = useIntelligenceData(gateway);
  const filtered = useMemo(
    () => snapshot ? filterIntelligence(snapshot, state) : null,
    [snapshot, state],
  );
  const selectedRelationshipId = state.selection?.entityType === "relationship"
    ? state.selection.entityId
    : null;
  const selectedRelationship = snapshot?.relationships.find(
    (relationship) => relationship.id === selectedRelationshipId,
  );
  const activeFilterCount = state.connectionIndustryFilters.length
    + state.connectionTerritoryFilters.length
    + (state.relationshipFilter === "all" ? 0 : 1);
  const resultCount = !filtered ? 0
    : state.intelligenceMetric === "overview"
      ? filtered.networkMetrics.length + filtered.reciprocalPatterns.length
      : state.intelligenceMetric === "relationships"
        ? filtered.relationships.length
        : state.intelligenceMetric === "gaps"
          ? filtered.industryGaps.length + filtered.territoryGaps.length
          : snapshot?.economicImpact.currencies.length ?? 0;
  const clearFilters = () => applyAction(exchangeWorkspaceActions.clearFilters(), "push");
  const closeRelationship = () => {
    applyAction(exchangeWorkspaceActions.closeMobileDetail());
    applyAction(exchangeWorkspaceActions.clearSelection(), "push");
  };
  const selectRelationship = (relationship: ReferralRelationshipInsight) => {
    applyAction(exchangeWorkspaceActions.selectEntity({
      entityType: "relationship",
      entityId: relationship.id,
    }), "push");
    applyAction(exchangeWorkspaceActions.openMobileDetail());
  };

  const intelligenceSurface = snapshot && filtered ? (
    <div className="space-y-5">
      <header className="rounded-2xl border border-white/70 bg-white/62 p-4 shadow-sm backdrop-blur-xl sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-indigo-700">Referral intelligence · {METRIC_LABELS[state.intelligenceMetric]}</p>
            <h1 className="mt-1 text-xl font-bold text-slate-950 sm:text-2xl">Explainable regional connection signals</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{snapshot.scopeLabel}. Analytics use authorized business-referral records; membership invitations and protected customer data are excluded.</p>
          </div>
          <div className="rounded-xl border border-white/70 bg-white/52 px-3 py-2 text-right text-xs text-slate-600 backdrop-blur-xl">
            <p className="font-bold text-slate-900">{snapshot.windowLabel}</p>
            <p>Updated {new Date(snapshot.generatedAt).toLocaleDateString("en-US")}</p>
          </div>
        </div>
      </header>

      {state.intelligenceMetric === "overview" ? (
        <OverviewSurface snapshot={snapshot} metrics={filtered.networkMetrics} industryGaps={filtered.industryGaps} reciprocalPatterns={filtered.reciprocalPatterns} />
      ) : state.intelligenceMetric === "relationships" ? (
        <section aria-labelledby="relationships-title">
          <div className="mb-3">
            <h2 id="relationships-title" className="text-lg font-bold text-slate-950">Trusted-referral relationships</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">Classifications use server-authoritative factors and minimum samples. Select a relationship to inspect its explanation.</p>
          </div>
          <RelationshipInsights relationships={filtered.relationships} selectedId={selectedRelationshipId} onSelect={selectRelationship} />
        </section>
      ) : state.intelligenceMetric === "gaps" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <GapAnalysis title="Industry and capability gaps" gaps={filtered.industryGaps} />
          <GapAnalysis title="Territory coverage gaps" gaps={filtered.territoryGaps} />
        </div>
      ) : (
        <EconomicImpact impact={snapshot.economicImpact} />
      )}

      <DataQualityNotice notices={snapshot.notices} scopeLabel={snapshot.scopeLabel} windowLabel={snapshot.windowLabel} privacyThreshold={snapshot.privacyThreshold} calculationVersion={snapshot.calculationVersion} />
    </div>
  ) : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-transparent">
      <ExchangeCommandBar
        view="intelligence"
        searchQuery={state.searchQuery}
        surfaceMode={state.surfaceMode}
        resultCount={resultCount}
        activeFilterCount={activeFilterCount}
        filtersOpen={state.mobileFilterOpen}
        mapAvailable
        refreshing={refreshing}
        onViewChange={onViewChange}
        onSearchChange={(value) => {
          applyAction(exchangeWorkspaceActions.setSearch(value));
          scheduleUrlReplace();
        }}
        onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
        onOpenFilters={() => applyAction(exchangeWorkspaceActions.openMobileFilter())}
        onClearFilters={clearFilters}
        onRefresh={() => void refresh()}
        onExportAnalytics={() => snapshot && downloadReferralIntelligenceCsv(snapshot)}
      />

      {error ? (
        <div className="absolute left-1/2 top-20 z-50 flex -translate-x-1/2 items-center justify-between gap-3 rounded-full border border-red-200/80 bg-red-50/88 px-4 py-2 text-sm text-red-950 shadow-lg backdrop-blur-xl" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()} className="min-h-9 shrink-0 rounded-lg border border-red-300 bg-white/80 px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-500">Retry</button>
        </div>
      ) : null}

      <div className="shrink-0 border-b border-white/60 bg-white/62 backdrop-blur-xl lg:hidden">
        <IntelligenceMetricTabs metric={state.intelligenceMetric} onChange={(metric) => applyAction(exchangeWorkspaceActions.setIntelligenceMetric(metric), "push")} />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <aside className="absolute bottom-3 left-3 top-3 z-30 hidden w-[260px] shrink-0 overflow-y-auto rounded-2xl border border-white/60 bg-white/68 shadow-2xl backdrop-blur-2xl lg:block" aria-label="Intelligence navigation and filters">
          <div className="border-b border-white/70 bg-white/42 p-3">
            <p className="px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Intelligence lens</p>
            <IntelligenceMetricTabs metric={state.intelligenceMetric} vertical onChange={(metric) => applyAction(exchangeWorkspaceActions.setIntelligenceMetric(metric), "push")} />
          </div>
          <IntelligenceFilters snapshot={snapshot} state={state} onRelationship={(relationship) => applyAction(exchangeWorkspaceActions.setFilters({ relationshipFilter: relationship }), "push")} onIndustry={(industry) => applyAction(exchangeWorkspaceActions.setFilters({ connectionIndustryFilters: industry ? [industry] : [] }), "push")} onTerritory={(territory) => applyAction(exchangeWorkspaceActions.setFilters({ connectionTerritoryFilters: territory ? [territory] : [] }), "push")} onClear={clearFilters} />
        </aside>

        <main className="relative z-20 hidden min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-[18rem] py-3 lg:block xl:px-[22rem]" aria-label="Referral intelligence">
          <div className="mx-auto max-w-7xl rounded-3xl border border-white/60 bg-white/58 p-5 shadow-2xl backdrop-blur-2xl">
            {loading && !snapshot ? <ExchangeStateView kind="loading" message="Loading privacy-scoped referral intelligence…" /> : null}
            {!loading ? intelligenceSurface : null}
          </div>
        </main>

        {selectedRelationship ? (
          <aside className="absolute bottom-3 right-3 top-3 z-30 hidden w-[330px] shrink-0 overflow-y-auto rounded-2xl border border-white/60 bg-white/68 shadow-2xl backdrop-blur-2xl xl:block" aria-label="Selected relationship explanation">
            <RelationshipExplanation relationship={selectedRelationship} />
            <button type="button" onClick={closeRelationship} className="mx-5 mb-5 min-h-11 w-[calc(100%-2.5rem)] rounded-xl border border-white/75 bg-white/65 px-4 text-sm font-bold text-slate-700 outline-none hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-indigo-500">Close explanation</button>
          </aside>
        ) : null}
      </div>

      <ExchangeMobileWorkspaceTray
        view="intelligence"
        surfaceMode={state.surfaceMode}
        resultCount={resultCount}
        loading={loading}
        onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
      >
        <div className="h-full overflow-y-auto overscroll-contain p-3">
          {loading && !snapshot ? <ExchangeStateView kind="loading" compact message="Loading intelligence…" /> : intelligenceSurface}
        </div>
      </ExchangeMobileWorkspaceTray>

      <ExchangeMobileDrawer open={state.mobileFilterOpen} activeFilterCount={activeFilterCount} onClose={() => applyAction(exchangeWorkspaceActions.closeMobileFilter())} onClear={clearFilters}>
        <IntelligenceFilters snapshot={snapshot} state={state} onRelationship={(relationship) => applyAction(exchangeWorkspaceActions.setFilters({ relationshipFilter: relationship }), "push")} onIndustry={(industry) => applyAction(exchangeWorkspaceActions.setFilters({ connectionIndustryFilters: industry ? [industry] : [] }), "push")} onTerritory={(territory) => applyAction(exchangeWorkspaceActions.setFilters({ connectionTerritoryFilters: territory ? [territory] : [] }), "push")} onClear={clearFilters} />
      </ExchangeMobileDrawer>

      <ExchangeDetailSheet open={state.mobileDetailOpen && Boolean(selectedRelationship)} title={selectedRelationship?.partnerLabel ?? "Relationship explanation"} onClose={closeRelationship}>
        {selectedRelationship ? <RelationshipExplanation relationship={selectedRelationship} /> : null}
      </ExchangeDetailSheet>
    </div>
  );
}

function IntelligenceMetricTabs({
  metric,
  onChange,
  vertical = false,
}: {
  metric: ExchangeIntelligenceMetric;
  onChange: (metric: ExchangeIntelligenceMetric) => void;
  vertical?: boolean;
}) {
  return (
    <div className={cn("gap-1 p-2", vertical ? "grid" : "flex overflow-x-auto [scrollbar-width:none]")} role="group" aria-label="Intelligence metric">
      {EXCHANGE_INTELLIGENCE_METRICS.map((candidate) => (
        <button key={candidate} type="button" onClick={() => onChange(candidate)} aria-pressed={metric === candidate} className={cn("min-h-10 rounded-lg px-3 text-left text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500", vertical ? "w-full" : "shrink-0", metric === candidate ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white/65")}>{METRIC_LABELS[candidate]}</button>
      ))}
    </div>
  );
}

function IntelligenceFilters({
  snapshot,
  state,
  onRelationship,
  onIndustry,
  onTerritory,
  onClear,
}: {
  snapshot: ReferralIntelligenceSnapshot | null;
  state: ExchangeWorkspaceState;
  onRelationship: (relationship: ExchangeRelationshipFilter) => void;
  onIndustry: (industry: string) => void;
  onTerritory: (territory: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">Intelligence filters</h2><button type="button" onClick={onClear} className="text-xs font-bold text-indigo-700 underline-offset-2 hover:underline">Clear</button></div>
      <label className="block text-xs font-bold text-slate-700">Relationship state
        <select value={state.relationshipFilter} onChange={(event) => onRelationship(event.target.value as ExchangeRelationshipFilter)} className="mt-2 min-h-11 w-full rounded-xl border border-white/75 bg-white/65 px-3 text-sm font-normal outline-none backdrop-blur-xl focus:ring-2 focus:ring-indigo-500"><option value="all">All states</option><option value="new">New</option><option value="active">Active</option><option value="established">Established</option><option value="trusted">Trusted</option><option value="review_required">Review required</option></select>
      </label>
      <label className="block text-xs font-bold text-slate-700">Industry or capability
        <select value={state.connectionIndustryFilters[0] ?? ""} onChange={(event) => onIndustry(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-white/75 bg-white/65 px-3 text-sm font-normal outline-none backdrop-blur-xl focus:ring-2 focus:ring-indigo-500"><option value="">All industries</option>{snapshot?.industryGaps.map((gap) => <option key={gap.id} value={gap.label}>{gap.label}</option>)}</select>
      </label>
      <label className="block text-xs font-bold text-slate-700">Territory
        <select value={state.connectionTerritoryFilters[0] ?? ""} onChange={(event) => onTerritory(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-white/75 bg-white/65 px-3 text-sm font-normal outline-none backdrop-blur-xl focus:ring-2 focus:ring-indigo-500"><option value="">All territories</option>{snapshot?.territoryGaps.map((gap) => <option key={gap.id} value={gap.label}>{gap.label}</option>)}</select>
      </label>
      <p className="flex items-start gap-2 rounded-xl border border-white/70 bg-white/42 p-3 text-xs leading-5 text-slate-600"><Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />Filters operate only on the authorized aggregate snapshot and never expose contact data or third-party private relationships.</p>
    </div>
  );
}

function OverviewSurface({
  snapshot,
  metrics,
  industryGaps,
  reciprocalPatterns,
}: {
  snapshot: ReferralIntelligenceSnapshot;
  metrics: ReferralIntelligenceSnapshot["networkMetrics"];
  industryGaps: ReferralGapInsight[];
  reciprocalPatterns: ReferralIntelligenceSnapshot["reciprocalPatterns"];
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="network-overview-title"><h2 id="network-overview-title" className="text-sm font-bold text-slate-950">Referral network overview and conversion performance</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric, index) => <MetricCard key={metric.id} {...metric} icon={METRIC_ICONS[index % METRIC_ICONS.length]} />)}</div></section>
      <section className="rounded-2xl border border-white/70 bg-white/55 p-4 shadow-sm backdrop-blur-xl sm:p-5" aria-labelledby="capability-coverage-title">
        <h2 id="capability-coverage-title" className="flex items-center gap-2 text-sm font-bold text-slate-950"><Factory className="h-4 w-4 text-indigo-600" aria-hidden="true" /> Capability matching and recipient coverage</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">Coverage is derived from published, currently accepting recipients in qualifying industry aggregates.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{industryGaps.map((gap) => gap.suppressed ? <div key={gap.id} className="rounded-xl bg-white/48 p-3"><p className="text-xs font-bold text-slate-800">{gap.label}</p><p className="mt-1 text-xs text-slate-500">Coverage hidden below privacy threshold.</p></div> : <div key={gap.id} className="rounded-xl bg-indigo-50/72 p-3"><p className="text-xs font-bold text-indigo-950">{gap.label}</p><div className="mt-2 flex items-center justify-between text-xs text-indigo-800"><span className="flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> {gap.activeRecipientCount} active recipients</span><span>{gap.unansweredDemand} unanswered needs</span></div></div>)}</div>
      </section>
      <ReciprocalPatterns patterns={reciprocalPatterns} />
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Exchange linkage outcomes">
        <div className="rounded-2xl border border-white/70 bg-white/55 p-4 shadow-sm backdrop-blur-xl"><p className="flex items-center gap-2 text-xs font-bold text-slate-500"><Handshake className="h-4 w-4 text-indigo-600" aria-hidden="true" /> New relationships</p><p className="mt-2 text-2xl font-bold text-slate-950">{snapshot.economicImpact.newRelationshipsFormed ?? "Not available"}</p></div>
        <div className="rounded-2xl border border-white/70 bg-white/55 p-4 shadow-sm backdrop-blur-xl"><p className="flex items-center gap-2 text-xs font-bold text-slate-500"><MapPinned className="h-4 w-4 text-indigo-600" aria-hidden="true" /> Territories connected</p><p className="mt-2 text-2xl font-bold text-slate-950">{snapshot.economicImpact.territoriesConnected}</p></div>
        <div className="rounded-2xl border border-white/70 bg-white/55 p-4 shadow-sm backdrop-blur-xl"><p className="flex items-center gap-2 text-xs font-bold text-slate-500"><Factory className="h-4 w-4 text-indigo-600" aria-hidden="true" /> Industries connected</p><p className="mt-2 text-2xl font-bold text-slate-950">{snapshot.economicImpact.industriesConnected}</p></div>
      </section>
    </div>
  );
}