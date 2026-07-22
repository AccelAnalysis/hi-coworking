import type { ExchangePublicOrganizationProjection } from "@hi/shared/exchange-organization-context";
import type { PublicOrganizationProjection } from "@/lib/firestore";
import { listOrganizationDirectory } from "./organizationContextGateway";

interface OrganizationDirectoryCacheEntry {
  generation: number;
  maxResults: number;
  request: Promise<PublicOrganizationProjection[]> | null;
  organizations: PublicOrganizationProjection[] | null;
  listeners: Set<(organizations: PublicOrganizationProjection[]) => void>;
}

const organizationDirectoryCache = new Map<string, OrganizationDirectoryCacheEntry>();

function normalizeCacheScope(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("An authenticated viewer cache scope is required.");
  }
  return normalized;
}

function cacheEntry(cacheScope: string): OrganizationDirectoryCacheEntry {
  const key = normalizeCacheScope(cacheScope);
  const existing = organizationDirectoryCache.get(key);
  if (existing) return existing;
  const created: OrganizationDirectoryCacheEntry = {
    generation: 0,
    maxResults: 0,
    request: null,
    organizations: null,
    listeners: new Set(),
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
): Promise<PublicOrganizationProjection[]> {
  const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(maxResults)));
  const organizations: PublicOrganizationProjection[] = [];
  const seenCursors = new Set<string>();
  let cursor: { name: string; organizationId: string } | undefined;

  while (organizations.length < boundedLimit) {
    const page = await listOrganizationDirectory({
      pageSize: Math.min(50, boundedLimit - organizations.length),
      cursor,
    });
    organizations.push(...page.organizations.map(toPublicOrganizationProjection));
    if (!page.hasMore || !page.nextCursor) break;
    const cursorKey = `${page.nextCursor.name}\u0000${page.nextCursor.organizationId}`;
    if (seenCursors.has(cursorKey)) break;
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }

  return organizations;
}

/**
 * Reuse the same bounded discovery request across Exchange mode switches.
 * A rejected request is never cached, and an explicit refresh supersedes it.
 */
export async function loadPublicOrganizationsForExchange({
  cacheScope,
  force = false,
  maxResults = 1_000,
}: {
  /** Auth UID or another exact identity-bound scope; never an actor claim. */
  cacheScope: string;
  force?: boolean;
  maxResults?: number;
}): Promise<PublicOrganizationProjection[]> {
  const entry = cacheEntry(cacheScope);
  const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(maxResults)));
  if (!force && entry.organizations && entry.maxResults >= boundedLimit) {
    return boundedCachedOrganizations(entry.organizations, boundedLimit);
  }
  if (!force && entry.request && entry.maxResults >= boundedLimit) {
    return boundedCachedOrganizations(await entry.request, boundedLimit);
  }

  const generation = entry.generation + 1;
  const request = loadBoundedOrganizationDirectory(boundedLimit);
  entry.generation = generation;
  entry.maxResults = boundedLimit;
  entry.request = request;
  try {
    const organizations = await request;
    if (entry.generation !== generation || entry.request !== request) {
      if (entry.request) {
        return boundedCachedOrganizations(await entry.request, boundedLimit);
      }
      if (entry.organizations) {
        return boundedCachedOrganizations(entry.organizations, boundedLimit);
      }
      return organizations;
    }
    entry.request = null;
    entry.organizations = organizations;
    [...entry.listeners].forEach((listener) => {
      try {
        listener(organizations);
      } catch {
        // One unmounted or faulty consumer cannot prevent other active views
        // from receiving the same refreshed public projection.
      }
    });
    return organizations;
  } catch (error) {
    if (entry.generation !== generation || entry.request !== request) {
      if (entry.request) {
        return boundedCachedOrganizations(await entry.request, boundedLimit);
      }
      if (entry.organizations) {
        return boundedCachedOrganizations(entry.organizations, boundedLimit);
      }
      throw error;
    }
    entry.request = null;
    throw error;
  }
}

export function subscribePublicOrganizationsForExchange(
  cacheScope: string,
  listener: (organizations: PublicOrganizationProjection[]) => void,
): () => void {
  const entry = cacheEntry(cacheScope);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

export function clearPublicOrganizationsForExchangeCache(cacheScope?: string): void {
  if (cacheScope === undefined) {
    organizationDirectoryCache.clear();
    return;
  }
  const key = normalizeCacheScope(cacheScope);
  const entry = organizationDirectoryCache.get(key);
  if (!entry) return;
  entry.generation += 1;
  entry.request = null;
  entry.organizations = null;
}
