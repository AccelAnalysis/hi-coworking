import type { ExchangePublicOrganizationProjection } from "@hi/shared/exchange-organization-context";
import type { PublicOrganizationProjection } from "@/lib/firestore";
import {
  listOrganizationDirectory,
  type ExchangeOrganizationDirectoryFilters,
} from "./organizationContextGateway";

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_REFRESH_MS = 20_000;

interface DirectoryCacheEntry {
  generation: number;
  maximum: number;
  expiresAt: number;
  request: Promise<PublicOrganizationProjection[]> | null;
  records: PublicOrganizationProjection[] | null;
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

const cache = new Map<string, DirectoryCacheEntry>();

function scope(value: string): string {
  const result = value.trim();
  if (!result || result.length > 200) throw new Error("Authenticated viewer scope is required.");
  return result;
}

function query(value?: string): string {
  return value?.trim().slice(0, 300) ?? "";
}

function list(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const result = [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 25);
  return result.length ? result : undefined;
}

function filters(value?: ExchangeOrganizationDirectoryFilters): ExchangeOrganizationDirectoryFilters | undefined {
  if (!value) return undefined;
  const result: ExchangeOrganizationDirectoryFilters = {};
  const industries = list(value.industries);
  const capabilities = list(value.capabilities);
  const naicsCodes = list(value.naicsCodes);
  const certifications = list(value.certifications);
  if (industries) result.industries = industries;
  if (capabilities) result.capabilities = capabilities;
  if (naicsCodes) result.naicsCodes = naicsCodes;
  if (certifications) result.certifications = certifications;
  if (value.locality?.trim()) result.locality = value.locality.trim().slice(0, 160);
  if (value.claimStatus) result.claimStatus = value.claimStatus;
  if (value.verificationStatus?.trim()) result.verificationStatus = value.verificationStatus.trim().slice(0, 40);
  if (value.resourceProviderStatus) result.resourceProviderStatus = value.resourceProviderStatus;
  return Object.keys(result).length ? result : undefined;
}

function key(input: PublicOrganizationDirectoryRequest): string {
  return JSON.stringify([scope(input.cacheScope), query(input.query), filters(input.filters) ?? null]);
}

function entry(cacheKey: string): DirectoryCacheEntry {
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  const created: DirectoryCacheEntry = {
    generation: 0,
    maximum: 0,
    expiresAt: 0,
    request: null,
    records: null,
  };
  cache.set(cacheKey, created);
  return created;
}

function bounded(records: PublicOrganizationProjection[], maximum: number) {
  return records.length <= maximum ? records : records.slice(0, maximum);
}

function project(record: ExchangePublicOrganizationProjection): PublicOrganizationProjection {
  return {
    id: record.id,
    name: record.name,
    city: record.city,
    state: record.state,
    territoryFips: record.territoryFips,
    status: record.status,
    claimStatus: record.claimStatus,
    verificationStatus: record.verificationStatus,
    latitude: record.latitude,
    longitude: record.longitude,
    coordinateConfidence: record.coordinateConfidence,
    coordinatePublicationApproved: record.coordinatePublicationApproved,
    naicsCodes: record.naicsCodes,
    industries: record.industries,
    capabilityKeywords: record.capabilityKeywords,
    certifications: record.certifications,
    description: record.description,
    website: record.website,
    resourceProviderStatus: record.resourceProviderStatus,
    resourceCategories: record.resourceCategories,
    acceptsReferrals: record.acceptsReferrals,
  };
}

async function loadDirectory(
  maximum: number,
  search?: string,
  directoryFilters?: ExchangeOrganizationDirectoryFilters,
): Promise<PublicOrganizationProjection[]> {
  const records: PublicOrganizationProjection[] = [];
  const organizationIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: { name: string; organizationId: string } | undefined;
  while (records.length < maximum) {
    const page = await listOrganizationDirectory({
      query: query(search) || undefined,
      filters: filters(directoryFilters),
      pageSize: Math.min(50, maximum - records.length),
      cursor,
    });
    for (const organization of page.organizations) {
      if (organizationIds.has(organization.id)) continue;
      organizationIds.add(organization.id);
      records.push(project(organization));
    }
    if (!page.hasMore || !page.nextCursor) break;
    const cursorKey = `${page.nextCursor.name}:${page.nextCursor.organizationId}`;
    if (cursors.has(cursorKey)) break;
    cursors.add(cursorKey);
    cursor = page.nextCursor;
  }
  return records;
}

export async function loadPublicOrganizationsForExchange(
  input: PublicOrganizationDirectoryRequest,
): Promise<PublicOrganizationProjection[]> {
  const cacheKey = key(input);
  const current = entry(cacheKey);
  const maximum = Math.max(1, Math.min(1_000, Math.floor(input.maxResults ?? 1_000)));
  const ttlMs = Math.max(1_000, Math.min(60_000, Math.floor(input.ttlMs ?? DEFAULT_TTL_MS)));
  if (!input.force && current.records && current.maximum >= maximum && current.expiresAt > Date.now()) {
    return bounded(current.records, maximum);
  }
  if (!input.force && current.request && current.maximum >= maximum) {
    return bounded(await current.request, maximum);
  }

  const generation = current.generation + 1;
  const request = loadDirectory(maximum, input.query, input.filters);
  current.generation = generation;
  current.maximum = maximum;
  current.request = request;
  try {
    const records = await request;
    if (current.generation !== generation || current.request !== request) {
      if (current.request) return bounded(await current.request, maximum);
      return current.records ? bounded(current.records, maximum) : records;
    }
    current.records = records;
    current.request = null;
    current.expiresAt = Date.now() + ttlMs;
    return records;
  } catch (error) {
    if (current.generation === generation && current.request === request) {
      current.request = null;
      current.expiresAt = 0;
    }
    throw error;
  }
}

export function watchPublicOrganizationsForExchange(
  input: Omit<PublicOrganizationDirectoryRequest, "force"> & { refreshIntervalMs?: number },
  listener: (records: PublicOrganizationProjection[]) => void,
  onStatus?: (status: PublicOrganizationRefreshStatus) => void,
): () => void {
  let active = true;
  let inFlight = false;
  const refresh = async (force: boolean) => {
    if (!active || inFlight) return;
    inFlight = true;
    onStatus?.("refreshing");
    try {
      const records = await loadPublicOrganizationsForExchange({ ...input, force });
      if (active) {
        listener(records);
        onStatus?.("ready");
      }
    } catch {
      if (active) onStatus?.("error");
    } finally {
      inFlight = false;
    }
  };
  const visible = () => {
    if (document.visibilityState === "visible") void refresh(true);
  };
  const online = () => void refresh(true);
  const refreshMs = Math.max(10_000, Math.min(60_000, input.refreshIntervalMs ?? DEFAULT_REFRESH_MS));
  const timer = window.setInterval(() => void refresh(true), refreshMs);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("online", online);
  void refresh(false);
  return () => {
    active = false;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("online", online);
  };
}

export function subscribePublicOrganizationsForExchange(
  cacheScope: string,
  listener: (records: PublicOrganizationProjection[]) => void,
): () => void {
  return watchPublicOrganizationsForExchange({ cacheScope }, listener);
}

export function clearPublicOrganizationsForExchangeCache(cacheScope?: string): void {
  if (cacheScope === undefined) {
    cache.clear();
    return;
  }
  const target = scope(cacheScope);
  for (const [cacheKey, current] of cache.entries()) {
    const parsed = JSON.parse(cacheKey) as [string];
    if (parsed[0] !== target) continue;
    current.generation += 1;
    current.request = null;
    cache.delete(cacheKey);
  }
}
