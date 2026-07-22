"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  CircleDollarSign,
  FileText,
  Info,
  Sparkles,
} from "lucide-react";
import { ExchangeCommandBar } from "../components/ExchangeCommandBar";
import { ExchangeDetailSheet } from "../components/ExchangeDetailSheet";
import { ExchangeMobileDrawer } from "../components/ExchangeMobileDrawer";
import { ExchangeMobileWorkspaceTray } from "../components/ExchangeMobileWorkspaceTray";
import { ExchangeStateView } from "../components/ExchangeStateView";
import type {
  ExchangeRun3Gateway,
  ReferralWorkspaceRecord,
} from "../data/exchangeRun3Gateway";
import { useConnectionsData } from "../data/useConnectionsData";
import { exchangeWorkspaceActions } from "../state/exchangeWorkspaceActions";
import type { ExchangeConnectionMode } from "../state/exchangeWorkspaceTypes";
import type { ExchangeViewProps } from "../views/exchangeViewTypes";
import {
  ConnectionModeTabs,
  ConnectionsFilters,
} from "./ConnectionsFilters";
import { RecipientSuggestions } from "./RecipientSuggestions";
import { ReferralCreationWorkflow } from "./ReferralCreationWorkflow";
import { ReferralDetail } from "./ReferralDetail";
import { ReferralList } from "./ReferralList";
import { ServiceOfferSummary } from "./ServiceOfferSummary";

const EMPTY_COUNTS: Record<ExchangeConnectionMode, number> = {
  sent: 0,
  received: 0,
  draft: 0,
  active: 0,
  converted: 0,
  closed: 0,
  disputed: 0,
};

export function ConnectionsWorkspace({
  state,
  applyAction,
  scheduleUrlReplace,
  onViewChange,
  gateway,
  actorOrganizationName,
}: ExchangeViewProps & { gateway: ExchangeRun3Gateway; actorOrganizationName?: string }) {
  const [creationOpen, setCreationOpen] = useState(false);
  const desktopListRef = useRef<HTMLDivElement>(null);
  const mobileListRef = useRef<HTMLDivElement>(null);
  const query = useMemo(() => ({
    actorOrganizationId: state.actorOrganizationId,
    mode: state.connectionMode,
    searchQuery: state.searchQuery,
    statuses: state.referralStatusFilters,
    industries: state.connectionIndustryFilters,
    territories: state.connectionTerritoryFilters,
    compensation: state.compensationFilter,
    relationship: state.relationshipFilter,
  }), [
    state.actorOrganizationId,
    state.compensationFilter,
    state.connectionIndustryFilters,
    state.connectionMode,
    state.connectionTerritoryFilters,
    state.referralStatusFilters,
    state.relationshipFilter,
    state.searchQuery,
  ]);
  const selectedReferralId = state.selection?.entityType === "referral"
    ? state.selection.entityId
    : null;
  const {
    snapshot,
    detail,
    loading,
    refreshing,
    detailLoading,
    mutating,
    error,
    refresh,
    runMutation,
  } = useConnectionsData(gateway, query, selectedReferralId);

  const industries = useMemo(() => Array.from(new Set(
    (snapshot?.records ?? []).map((record) => record.category).filter(Boolean),
  )).sort(), [snapshot]);
  const territories = useMemo(() => Array.from(new Map(
    (snapshot?.records ?? [])
      .filter((record) => record.territoryFips)
      .map((record) => [
        record.territoryFips as string,
        { value: record.territoryFips as string, label: record.territoryLabel ?? record.territoryFips as string },
      ]),
  ).values()).sort((a, b) => a.label.localeCompare(b.label)), [snapshot]);
  const activeFilterCount = state.referralStatusFilters.length
    + state.connectionIndustryFilters.length
    + state.connectionTerritoryFilters.length
    + (state.compensationFilter === "all" ? 0 : 1)
    + (state.relationshipFilter === "all" ? 0 : 1);

  useEffect(() => {
    const scrollTop = state.modeStates.referrals.listScrollTop;
    if (desktopListRef.current) desktopListRef.current.scrollTop = scrollTop;
    if (mobileListRef.current) mobileListRef.current.scrollTop = scrollTop;
  }, [state.modeStates.referrals.listScrollTop]);

  const saveListScroll = (event: UIEvent<HTMLDivElement>) => {
    applyAction(exchangeWorkspaceActions.setModeListScroll(
      event.currentTarget.scrollTop,
      "referrals",
    ));
  };

  const setMode = (mode: ExchangeConnectionMode) => {
    applyAction(exchangeWorkspaceActions.setConnectionMode(mode), "push");
  };
  const clearFilters = () => {
    applyAction(exchangeWorkspaceActions.clearFilters(), "push");
  };
  const selectReferral = (record: ReferralWorkspaceRecord) => {
    applyAction(exchangeWorkspaceActions.selectEntity({
      entityType: "referral",
      entityId: record.id,
    }), "push");
    applyAction(exchangeWorkspaceActions.openMobileDetail());
  };
  const closeDetail = () => {
    applyAction(exchangeWorkspaceActions.closeMobileDetail());
    applyAction(exchangeWorkspaceActions.clearSelection(), "push");
  };
  const perform = async (
    operation: (actorOrganizationId?: string) => Promise<ReferralWorkspaceRecord>,
  ) => {
    try {
      await runMutation(operation);
    } catch {
      // The hook exposes the actionable error in the workspace alert.
    }
  };

  const detailSurface = detail ? (
    <ReferralDetail
      record={detail}
      mutating={mutating}
      onSend={() => void perform((actorOrganizationId) => gateway.sendReferral(
        detail.id,
        detail.version,
        actorOrganizationId,
      ))}
      onRespond={(response) => void perform((actorOrganizationId) => gateway.respondReferral(
        detail.id,
        response,
        detail.version,
        response === "accepted" ? {
          acknowledged: true,
          serviceOfferId: detail.serviceOfferId,
          serviceOfferVersion: detail.serviceOfferVersion,
        } : undefined,
        actorOrganizationId,
      ))}
      onProgress={(status) => void perform((actorOrganizationId) => gateway.progressReferral(
        detail.id,
        status,
        detail.version,
        actorOrganizationId,
      ))}
      onReportTransaction={(amount) => void perform((actorOrganizationId) => gateway.reportTransaction(
        detail.id,
        detail.version,
        amount,
        detail.compensation.currency,
        detail.termsSnapshot?.serviceOfferId,
        actorOrganizationId,
      ))}
      onConfirmTransaction={() => {
        if (!detail.latestTransactionReportId || detail.latestTransactionReportVersion === undefined) return;
        void perform((actorOrganizationId) => gateway.confirmTransaction(
          detail.id,
          detail.latestTransactionReportId as string,
          detail.latestTransactionReportVersion as number,
          actorOrganizationId,
        ));
      }}
    />
  ) : detailLoading ? (
    <div className="p-5"><ExchangeStateView kind="loading" compact message="Loading the protected referral detail…" /></div>
  ) : selectedReferralId ? (
    <div className="p-5"><ExchangeStateView kind="selection-unavailable" compact message="This referral is unavailable in your current authorized scope." onClear={closeDetail} /></div>
  ) : (
    <ConnectionsWelcome
      records={snapshot?.records ?? []}
      suggestions={snapshot?.suggestions ?? []}
      onCreate={() => setCreationOpen(true)}
    />
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-transparent">
      <ExchangeCommandBar
        view="connections"
        searchQuery={state.searchQuery}
        surfaceMode={state.surfaceMode}
        resultCount={snapshot?.records.length ?? 0}
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
        onCreateReferral={() => setCreationOpen(true)}
      />

      {error ? (
        <div className="absolute left-1/2 top-20 z-50 flex -translate-x-1/2 items-center justify-between gap-3 rounded-full border border-red-200/80 bg-red-50/88 px-4 py-2 text-sm text-red-950 shadow-lg backdrop-blur-xl" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()} className="min-h-9 shrink-0 rounded-lg border border-red-300 bg-white/80 px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-500">Retry</button>
        </div>
      ) : null}

      <div className="shrink-0 border-b border-white/60 bg-white/62 backdrop-blur-xl lg:hidden">
        <ConnectionModeTabs mode={state.connectionMode} counts={snapshot?.counts ?? EMPTY_COUNTS} onChange={setMode} />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <aside className="absolute bottom-3 left-3 top-3 z-30 hidden w-[350px] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/68 shadow-2xl backdrop-blur-2xl lg:flex" aria-label="Referral list and filters">
          <div className="shrink-0 border-b border-white/70 bg-white/45">
            <ConnectionModeTabs mode={state.connectionMode} counts={snapshot?.counts ?? EMPTY_COUNTS} onChange={setMode} />
          </div>
          <div ref={desktopListRef} onScroll={saveListScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <details className="border-b border-white/60 bg-white/32" open={activeFilterCount > 0}>
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-xs font-bold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">Filters {activeFilterCount ? `· ${activeFilterCount} active` : ""}</summary>
              <ConnectionsFilters state={state} industries={industries} territories={territories} onChange={(filters) => applyAction(exchangeWorkspaceActions.setFilters(filters), "push")} onClear={clearFilters} />
            </details>
            <ReferralList records={snapshot?.records ?? []} selectedId={selectedReferralId} loading={loading} onSelect={selectReferral} />
          </div>
        </aside>

        <main className="relative z-20 hidden min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-transparent px-[23rem] py-3 lg:block" aria-label="Referral workspace">
          <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/60 bg-white/68 shadow-2xl backdrop-blur-2xl">{detailSurface}</div>
        </main>

        <aside className="absolute bottom-3 right-3 top-3 z-30 hidden w-[310px] shrink-0 overflow-y-auto rounded-2xl border border-white/60 bg-white/68 p-4 shadow-2xl backdrop-blur-2xl xl:block" aria-label="Connection context">
          {detail && (detail.serviceOfferId || detail.termsSnapshot?.serviceOfferId) ? (() => {
            const offerId = detail.serviceOfferId ?? detail.termsSnapshot?.serviceOfferId;
            const offer = snapshot?.serviceOffers.find((candidate) => candidate.id === offerId);
            return offer ? <ServiceOfferSummary offer={offer} /> : null;
          })() : null}
          <div className="mt-4">
            <RecipientSuggestions suggestions={snapshot?.suggestions ?? []} compact />
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-white/70 bg-white/48 p-3 text-xs leading-5 text-slate-600"><Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />Suggestions use published discovery fields and verified history. Protected contact data is excluded.</p>
        </aside>
      </div>

      <ExchangeMobileWorkspaceTray
        view="referrals"
        surfaceMode={state.surfaceMode}
        resultCount={snapshot?.records.length ?? 0}
        loading={loading}
        onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
      >
        <div ref={mobileListRef} onScroll={saveListScroll} className="h-full overflow-y-auto overscroll-contain">
          <ReferralList records={snapshot?.records ?? []} selectedId={selectedReferralId} loading={loading} onSelect={selectReferral} />
        </div>
      </ExchangeMobileWorkspaceTray>

      <ExchangeMobileDrawer
        open={state.mobileFilterOpen}
        activeFilterCount={activeFilterCount}
        onClose={() => applyAction(exchangeWorkspaceActions.closeMobileFilter())}
        onClear={clearFilters}
      >
        <ConnectionsFilters state={state} industries={industries} territories={territories} onChange={(filters) => applyAction(exchangeWorkspaceActions.setFilters(filters), "push")} onClear={clearFilters} />
      </ExchangeMobileDrawer>

      <ExchangeDetailSheet
        open={state.mobileDetailOpen && Boolean(selectedReferralId)}
        title={detail?.title ?? "Referral detail"}
        onClose={closeDetail}
      >
        {detailSurface}
      </ExchangeDetailSheet>

      <ReferralCreationWorkflow
        open={creationOpen}
        actorOrganizationId={state.actorOrganizationId}
        actorOrganizationName={actorOrganizationName}
        suggestions={snapshot?.suggestions ?? []}
        offers={snapshot?.serviceOffers ?? []}
        gatewayMode={gateway.mode}
        onClose={() => setCreationOpen(false)}
        onSuggest={(input) => gateway.suggestRecipients({
          ...input,
          actorOrganizationId: state.actorOrganizationId,
          referrerOrgId: state.actorOrganizationId,
        })}
        onCreate={async (input) => {
          const record = await runMutation((actorOrganizationId) => {
            if (!actorOrganizationId && gateway.mode !== "demo") {
              throw new Error("Choose an active organization before creating a referral draft.");
            }
            return gateway.createReferralDraft({
              ...input,
              actorOrganizationId,
              referrerOrgId: actorOrganizationId,
            });
          });
          applyAction(exchangeWorkspaceActions.setConnectionMode("draft"), "push");
          applyAction(exchangeWorkspaceActions.selectEntity({ entityType: "referral", entityId: record.id }), "push");
          applyAction(exchangeWorkspaceActions.openMobileDetail());
          setCreationOpen(false);
        }}
      />
    </div>
  );
}

function ConnectionsWelcome({
  records,
  suggestions,
  onCreate,
}: {
  records: ReferralWorkspaceRecord[];
  suggestions: Parameters<typeof RecipientSuggestions>[0]["suggestions"];
  onCreate: () => void;
}) {
  const converted = records.filter((record) => record.status === "converted").length;
  const compensated = records.filter((record) => record.compensation.configured).length;
  return (
    <div className="mx-auto max-w-4xl p-5 sm:p-8">
      <section className="overflow-hidden rounded-3xl border border-white/20 bg-slate-950/88 p-6 text-white shadow-xl backdrop-blur-2xl sm:p-8">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-300"><Sparkles className="h-4 w-4" aria-hidden="true" /> Business referral exchange</p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">Connect a real business need with the right regional capability.</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">Create, consent, send, accept, track, and convert referrals. A referral may have no compensation, optional cash terms, or a non-cash benefit.</p>
          <button type="button" onClick={onCreate} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-300 px-5 text-sm font-bold text-slate-950 outline-none hover:bg-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-100"><FileText className="h-4 w-4" aria-hidden="true" /> Create referral draft <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </section>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/70 bg-white/62 p-4 shadow-sm backdrop-blur-xl"><dt className="flex items-center gap-2 text-xs font-bold text-slate-500"><BriefcaseBusiness className="h-4 w-4 text-indigo-600" aria-hidden="true" /> In this view</dt><dd className="mt-2 text-2xl font-bold text-slate-950">{records.length}</dd><p className="text-xs text-slate-500">Authorized referrals</p></div>
        <div className="rounded-2xl border border-white/70 bg-white/62 p-4 shadow-sm backdrop-blur-xl"><dt className="flex items-center gap-2 text-xs font-bold text-slate-500"><ArrowRight className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Converted</dt><dd className="mt-2 text-2xl font-bold text-slate-950">{converted}</dd><p className="text-xs text-slate-500">Lifecycle state, not payment</p></div>
        <div className="rounded-2xl border border-white/70 bg-white/62 p-4 shadow-sm backdrop-blur-xl"><dt className="flex items-center gap-2 text-xs font-bold text-slate-500"><CircleDollarSign className="h-4 w-4 text-amber-600" aria-hidden="true" /> Terms configured</dt><dd className="mt-2 text-2xl font-bold text-slate-950">{compensated}</dd><p className="text-xs text-slate-500">Optional policies</p></div>
      </dl>
      {suggestions.length ? <div className="mt-6 xl:hidden"><RecipientSuggestions suggestions={suggestions} /></div> : null}
    </div>
  );
}
