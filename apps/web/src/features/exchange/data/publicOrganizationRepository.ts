import type { ExchangePublicOrganizationProjection } from "@hi/shared/exchange-organization-context";
import type { PublicOrganizationProjection } from "@/lib/firestore";
import {
  listOrganizationDirectory,
  type ExchangeOrganizationDirectoryFilters,
} from "./organizationContextGateway";

const DEFAULT_DIRECTORY_TTL_MS = 15_000;
const DEFAULT_REFRESH_INTERVAL_MS = 20_000;

interface OrganizationDirectoryCacheEntry {
  generation: number;
  maxResults: number;
  request: Promise<PublicOrganizationProjection[]> | null;
  organizations: PublicOrganizationProjection[] | null;
  expiresAt: number;
}

export type PublicOrganizationRefreshStatus = "refreshing" | "ready" | "error";

export interface PublicOrganizationDirectoryRequest {
  cacheScope: string;
  query?: string;
  filters?: ExchangeOrganizationDirectoryFilters;
  force?: boolean;
  maxResults?: number;
  ttlMs?: number;
}

const organizationDirectoryCache = new Map<string, OrganizationDirectoryCacheEntry>();

function normalizeCacheScope(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("An authenticated viewer cache scope is required.");
  }
  return normalized;
}

function normalizedQuery(value: string | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 300) : "";
}

function normalizedFilters(
  filters: ExchangeOrganizationDirectoryFilters | undefined,
): ExchangeOrganizationDirectoryFilters | undefined {
  if (!filters) return undefined;
  const result: ExchangeOrganizationDirectoryFilters = {};
  const copyList = (values: string[] | undefined) => values
    ? [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 25)
    : undefined;
  const industries = copyList(filters.industries);
  const capabilities = copyList(filters.capabilities);
  const naicsCodes = copyList(filters.naicsCodes);
  const certifications = copyList(filters.certifications);
  if (industries?.length) result.industries = industries;
  if (capabilities?.length) result.capabilities = capabilities;
  if (naicsCodes?.length) result.naicsCodes = naicsCodes;
  if (certifications?.length) result.certifications = certifications;
  if (filters.locality?.trim()) result.locality = filters.locality.trim().slice(0, 160);
  if (filters.claimStatus) result.claimStatus = filters.claimStatus;
  if (filters.verificationStatus?.trim()) {
    result.verificationStatus = filters.verificationStatus.trim().slice(0, 40);
  }
  if (filters.resourceProviderStatus) {
    result.resourceProviderStatus = filters.resourceProviderStatus;
  }
  return Object.keys(result).length ? result : undefined;
}

function requestCacheKey(input: PublicOrganizationDirectoryRequest): string {
  return JSON.stringify([
    normalizeCacheScope(input.cacheScope),
    normalizedQuery(input.query),
    normalizedFilters(input.filters) ?? null,
  ]);
}

function cacheEntry(key: string): OrganizationDirectoryCacheEntry {
  const existing = organizationDirectoryCache.get(key);
  if (existing) return existing;
  const created: OrganizationDirectoryCacheEntry = {
    generation: 0,
    maxResults: 0,
    request: null,
    organizations: null,
    expiresAt: 0,
  };
  organizationDirectoryCache.set(key, created);
  return created;
}

function boundedCachedOrganizations(
  organizations: PublicOrganizationProjection[],
  maximum: number,
): PublicOrganizationProjection[] {
  return organizations.length <= maximum
    ? organizations
    : organizations.slice(0, maximum);
}

function toPublicOrganizationProjection(
  organization: ExchangePublicOrganizationProjection,
): PublicOrganizationProjection {
  return {
    id: organization.id,
    name: organization.name,
    city: organization.city,
    state: organization.state,
    territoryFips: organization.territoryFips,
    status: organization.status,
    claimStatus: organization.claimStatus,
    verificationStatus: organization.verificationStatus,
    latitude: organization.latitude,
    longitude: organization.longitude,
    coordinateConfidence: organization.coordinateConfidence,
    coordinatePublicationApproved: organization.coordinatePublicationApproved,
    naicsCodes: organization.naicsCodes,
    industries: organization.industries,
    capabilityKeywords: organization.capabilityKeywords,
    certifications: organization.certifications,
    description: organization.description,
    website: organization.website,
    resourceProviderStatus: organization.resourceProviderStatus,
    resourceCategories: organization.resourceCategories,
    acceptsReferrals: organization.acceptsReferrals,
  };
}

async function loadBoundedOrganizationDirectory(
  maxResults: number,
  query?: string,
  filters?: ExchangeOrganizationDirectoryFilters,
): Promise<PublicOrganizationProjection[]> {
  const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(maxResults)));
  const organizations: PublicOrganizationProjection[] = [];
  const seenOrganizationIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: { name: string; organizationId: string } | undefined;

  while (organizations.length < boundedLimit) {
    const page = await listOrganizationDirectory({
      query: normalizedQuery(query) || undefined,
      filters: normalizedFilters(filters),
      pageSize: Math.min(50, boundedLimit - organizations.length),
      cursor,
    });
    for (const organization of page.organizations) {
      if (seenOrganizationIds.has(organization.id)) continue;
      seenOrganizationIds.add(organization.id);
      organizations.push(toPublicOrganizationProjection(organization));
    }
    if (!page.hasMore || !page.nextCursor) break;
    const cursorKey = `${page.nextCursor.name}\u0000${page.nextCursor.organizationId}`;
    if (seenCursors.has(cursorKey)) break;
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }

  return organizations;
}

/**
 * Loads the current server-backed directory with a short bounded TTL. Requests
 * are keyed by authenticated UID plus validated query/filter input, concurrent
 * callers share one promise, and rejected requests are never cached.
 */
export async function loadPublicOrganizationsForExchange(
  input: PublicOrganizationDirectoryRequest,
): Promise<PublicOrganizationProjection[]> {
  const key = requestCacheKey(input);
  const entry = cacheEntry(key);
  const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(input.maxResults ?? 1_000)));
  const ttlMs = Math.max(1_000, Math.min(60_000, Math.floor(input.ttlMs ?? DEFAULT_DIRECTORY_TTL_MS)));
  const now = Date.now();
  if (!input.force && entry.organizations && entry.maxResults >= boundedLimit && entry.expiresAt > now) {
    return boundedCachedOrganizations(entry.organizations, boundedLimit);
  }
  if (!input.force && entry.request && entry.maxResults >= boundedLimit) {
    return boundedCachedOrganizations(await entry.request, boundedLimit);
  }

  const generation = entry.generation + 1;
  const request = loadBoundedOrganizationDirectory(
    boundedLimit,
    input.query,
    input.filters,
  );
  entry.generation = generation;
  entry.maxResults = boundedLimit;
  entry.request = request;
  try {
    const organizations = await request;
    if (entry.generation !== generation || entry.request !== request) {
      if (entry.request) return boundedCachedOrganizations(await entry.request, boundedLimit);
      if (entry.organizations) return boundedCachedOrganizations(entry.organizations, boundedLimit);
      return organizations;
    }
    entry.request = null;
    entry.organizations = organizations;
    entry.expiresAt = Date.now() + ttlMs;
    return organizations;
  } catch (error) {
    if (entry.generation === generation && entry.request === request) {
      entry.request = null;
      entry.expiresAt = 0;
    }
    throw error;
  }
}

/**
 * Actively watches the server directory. Unlike the former cache listener, this
 * source refreshes on a bounded interval, when the tab becomes visible, and
 * when connectivity returns. It never treats Actor URL state as a cache key.
 */
export function watchPublicOrganizationsForExchange(
  input: Omit<PublicOrganizationDirectoryRequest, "force"> & {
    refreshIntervalMs?: number;
  },
  listener: (organizations: PublicOrganizationProjection[]) => void,
  onStatus?: (status: PublicOrganizationRefreshStatus) => void,
): () => void {
  let active = true;
  let refreshInFlight = false;
  const refresh = async (force: boolean) => {
    if (!active || refreshInFlight) return;
    refreshInFlight = true;
    onStatus?.("refreshing");
    try {
      const organizations = await loadPublicOrganizationsForExchange({ ...input, force });
      if (!active) return;
      listener(organizations);
      onStatus?.("ready");
    } catch {
      if (active) onStatus?.("error");
    } finally {
      refreshInFlight = false;
    }
  };
  const refreshWhenVisible = () => {
    if (document.visibilityState === "visible") void refresh(true);
  };
  const refreshWhenOnline = () => void refresh(true);
  const intervalMs = Math.max(
    10_000,
    Math.min(60_000, Math.floor(input.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS)),
  );
  const interval = window.setInterval(() => void refresh(true), intervalMs);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  window.addEventListener("online", refreshWhenOnline);
  void refresh(false);

  return () => {
    active = false;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
    window.removeEventListener("online", refreshWhenOnline);
  };
}

export function clearPublicOrganizationsForExchangeCache(cacheScope?: string): void {
  if (cacheScope === undefined) {
    organizationDirectoryCache.clear();
    return;
  }
  const scope = normalizeCacheScope(cacheScope);
  for (const [key, entry] of organizationDirectoryCache.entries()) {
    const parsed = JSON.parse(key) as [string];
    if (parsed[0] !== scope) continue;
    entry.generation += 1;
    entry.request = null;
    organizationDirectoryCache.delete(key);
  }
}
