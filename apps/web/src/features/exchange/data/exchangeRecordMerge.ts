import type { RfxDoc } from "@hi/shared";

export function isDiscoverableExchangeRfx(rfx: RfxDoc): boolean {
  return rfx.status === "open" && rfx.adminApprovalStatus === "approved";
}

export function uniqueDiscoverableExchangeRfx(
  records: readonly RfxDoc[],
  maximum: number,
): RfxDoc[] {
  const byId = new Map<string, RfxDoc>();
  for (const record of records) {
    if (!record.id || !isDiscoverableExchangeRfx(record)) continue;
    if (byId.has(record.id)) continue;
    byId.set(record.id, record);
    if (byId.size >= maximum) break;
  }
  return [...byId.values()];
}

/**
 * Keep the newest viewport response first, then fill the bounded cache with
 * previously discovered records. This prevents a full cache from permanently
 * rejecting every later pan while retaining a useful non-destructive list.
 */
export function mergeExchangeRfx(
  current: readonly RfxDoc[],
  viewport: readonly RfxDoc[],
  maximum: number,
): RfxDoc[] {
  return uniqueDiscoverableExchangeRfx([...viewport, ...current], maximum);
}

/**
 * Resolve a selection pin only from records already loaded into this workspace.
 * A previous pin may survive a viewport replacement, but an arbitrary ID can
 * never manufacture a record or trigger a selected-record read.
 */
export function resolvePinnedExchangeRfx(
  loadedRecords: readonly RfxDoc[],
  selectedRfxId: string | null,
  previousPinnedRfx: RfxDoc | null,
): RfxDoc | null {
  if (!selectedRfxId) return null;

  const loaded = loadedRecords.find(
    (record) => record.id === selectedRfxId && isDiscoverableExchangeRfx(record),
  );
  if (loaded) return loaded;

  return previousPinnedRfx?.id === selectedRfxId
    && isDiscoverableExchangeRfx(previousPinnedRfx)
    ? previousPinnedRfx
    : null;
}

/**
 * Preserve one already-loaded selected RFx without allowing it to freeze later
 * viewport responses. The ordinary latest-viewport-first merge remains the
 * source of ordering; a missing pin reserves at most one bounded slot.
 */
export function mergeExchangeRfxWithPinned(
  current: readonly RfxDoc[],
  viewport: readonly RfxDoc[],
  pinnedRfx: RfxDoc | null,
  maximum: number,
): RfxDoc[] {
  const merged = mergeExchangeRfx(current, viewport, maximum);
  if (!pinnedRfx || !isDiscoverableExchangeRfx(pinnedRfx)) return merged;

  const existingIndex = merged.findIndex((record) => record.id === pinnedRfx.id);
  if (existingIndex >= 0) {
    if (merged[existingIndex] === pinnedRfx) return merged;
    const refreshed = [...merged];
    refreshed[existingIndex] = pinnedRfx;
    return refreshed;
  }

  return uniqueDiscoverableExchangeRfx([pinnedRfx, ...merged], maximum);
}
