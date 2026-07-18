"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { liveExchangeOpportunityRepository } from "../data/exchangeRepository";
import { useExchangeData } from "../data/useExchangeData";
import {
  EXCHANGE_DEMO_TERRITORIES,
} from "../demo/exchangeDemoFixtures";
import { exchangeDemoOpportunityRepository } from "../demo/exchangeDemoGateway";
import type { ExchangeView } from "../state/exchangeWorkspaceTypes";

const ExchangeMap = dynamic(
  () => import("../map/ExchangeMap").then((module) => module.ExchangeMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[22rem] items-center justify-center bg-slate-100 text-sm font-semibold text-slate-600" role="status">
        Loading geographic workspace…
      </div>
    ),
  },
);

const VIEW_LABELS: Partial<Record<ExchangeView, string>> = {
  intelligence: "Intelligence coverage",
  referrals: "Referral geography",
  opportunities: "Opportunity geography",
  resources: "Resource coverage",
};

export function ExchangeContextMap({
  view,
  demoMode,
  className = "h-full min-h-[22rem] w-full border-0",
}: {
  view: "intelligence" | "referrals" | "opportunities" | "resources";
  demoMode: boolean;
  className?: string;
}) {
  const repository = demoMode
    ? exchangeDemoOpportunityRepository
    : liveExchangeOpportunityRepository;
  const {
    releasedTerritories,
    scheduledTerritories,
    loading,
    error,
  } = useExchangeData(repository);

  const released = useMemo(
    () => releasedTerritories.length
      ? releasedTerritories
      : EXCHANGE_DEMO_TERRITORIES.filter((territory) => territory.status === "released"),
    [releasedTerritories],
  );
  const scheduled = useMemo(
    () => scheduledTerritories.length
      ? scheduledTerritories
      : EXCHANGE_DEMO_TERRITORIES.filter((territory) => territory.status === "scheduled"),
    [scheduledTerritories],
  );
  const viewLabel = VIEW_LABELS[view] ?? "Exchange geography";

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-slate-200">
      <ExchangeMap
        rfxList={[]}
        releasedTerritories={released}
        scheduledTerritories={scheduled}
        fitRequest={1}
        className={className}
        ariaLabel={`${viewLabel} map`}
      />
      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[calc(100%-1.5rem)] rounded-2xl border border-white/80 bg-white/92 px-3 py-2 shadow-lg backdrop-blur">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">{viewLabel}</p>
        <p className="mt-1 text-xs font-semibold text-slate-700">
          Territory markers show the current launch-market geography. Domain record markers appear only when verified coordinates are available.
        </p>
        {loading ? <p className="mt-1 text-[10px] text-slate-500">Refreshing geographic data…</p> : null}
        {error ? <p className="mt-1 text-[10px] text-amber-700">Showing launch-market context while live geography is unavailable.</p> : null}
      </div>
    </div>
  );
}
