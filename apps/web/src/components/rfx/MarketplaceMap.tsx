"use client";

import { useCallback, useMemo } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import { ExchangeMap } from "@/features/exchange/map/ExchangeMap";
import type { ExchangeMapBounds } from "@/features/exchange/map/mapConfig";

interface MarketplaceMapProps {
  rfxList: RfxDoc[];
  releasedTerritories: TerritoryDoc[];
  scheduledTerritories: TerritoryDoc[];
  selectedRfxId?: string;
  onSelectRfx?: (rfxId: string) => void;
  onTerritoryMessage?: (message: string) => void;
  onViewportChange?: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
    zoom: number;
  }) => void;
}

/**
 * Backward-compatible adapter for the established `/rfx` route. Lifecycle,
 * sources, layers, and event registration now come from the reusable Exchange
 * map core while this component retains its original public API.
 */
export function MarketplaceMap({
  rfxList,
  releasedTerritories,
  scheduledTerritories,
  selectedRfxId,
  onSelectRfx,
  onTerritoryMessage,
  onViewportChange,
}: MarketplaceMapProps) {
  const territories = useMemo(
    () => new Map(
      [...releasedTerritories, ...scheduledTerritories]
        .map((territory) => [territory.fips, territory] as const),
    ),
    [releasedTerritories, scheduledTerritories],
  );

  const handleTerritorySelection = useCallback((fips: string, status: "released" | "scheduled") => {
    if (status !== "scheduled") return;
    const territory = territories.get(fips);
    const releaseDate = territory?.releaseDate
      ? new Date(territory.releaseDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
      : "a future date";
    onTerritoryMessage?.(
      `${territory?.name || "This territory"} is scheduled for release on ${releaseDate}.`,
    );
  }, [onTerritoryMessage, territories]);

  const handleViewportChange = useCallback((bounds: ExchangeMapBounds) => {
    onViewportChange?.(bounds);
  }, [onViewportChange]);

  return (
    <ExchangeMap
      rfxList={rfxList}
      releasedTerritories={releasedTerritories}
      scheduledTerritories={scheduledTerritories}
      selection={selectedRfxId
        ? { entityType: "rfx", entityId: selectedRfxId }
        : null}
      className="h-full min-h-[360px] w-full rounded-2xl"
      ariaLabel="RFx opportunities and territory availability map"
      onSelectRfx={onSelectRfx}
      onSelectTerritory={handleTerritorySelection}
      onBackgroundClick={() => onTerritoryMessage?.(
        "This area is not released yet. Request activation or join the waitlist.",
      )}
      onViewportChange={handleViewportChange}
    />
  );
}
