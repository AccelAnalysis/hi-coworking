import type { Map as MapboxMap } from "mapbox-gl";

import { EXCHANGE_MAP_SOURCE_IDS } from "./mapConfig";
export type ExchangeMapSelection =
  | { entityType: "rfx"; entityId: string }
  | { entityType: "territory"; entityId: string }
  | { entityType: "organization"; entityId: string }
  | null;

export interface ExchangeFeatureStateTarget {
  source: string;
  id: string;
}

export function exchangeSelectionEquals(
  left: ExchangeMapSelection,
  right: ExchangeMapSelection,
): boolean {
  if (left === right) return true;
  return Boolean(
    left &&
      right &&
      left.entityType === right.entityType &&
      left.entityId === right.entityId,
  );
}

export function getExchangeSelectionTargets(
  selection: ExchangeMapSelection,
): ExchangeFeatureStateTarget[] {
  if (!selection) return [];

  if (selection.entityType === "rfx") {
    return [{ source: EXCHANGE_MAP_SOURCE_IDS.rfx, id: selection.entityId }];
  }

  if (selection.entityType === "organization") {
    return [{ source: EXCHANGE_MAP_SOURCE_IDS.organizations, id: selection.entityId }];
  }

  const releasedTargets = [
    { source: EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryPoints, id: selection.entityId },
    { source: EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryBoundaries, id: selection.entityId },
  ];
  const scheduledTargets = [
    { source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryPoints, id: selection.entityId },
    { source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryBoundaries, id: selection.entityId },
  ];

  // Selection URL state intentionally stores only entity kind and ID. Marking
  // both status namespaces keeps hydration independent of a data lookup while
  // only the source containing that territory actually renders the state.
  return [...releasedTargets, ...scheduledTargets];
}

/**
 * Clear only the previous selection and mark the next one. Source/layer data is
 * untouched, so selecting a list item cannot reset the map viewport.
 */
export function updateExchangeMapSelection(
  map: MapboxMap,
  previousSelection: ExchangeMapSelection,
  nextSelection: ExchangeMapSelection,
): void {
  if (exchangeSelectionEquals(previousSelection, nextSelection)) return;

  for (const target of getExchangeSelectionTargets(previousSelection)) {
    if (map.getSource(target.source)) {
      map.removeFeatureState(target, "selected");
    }
  }

  for (const target of getExchangeSelectionTargets(nextSelection)) {
    if (map.getSource(target.source)) {
      map.setFeatureState(target, { selected: true });
    }
  }
}
