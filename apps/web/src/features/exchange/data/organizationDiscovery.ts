import type { PublicOrganizationProjection } from "@/lib/firestore";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";

export type OrganizationDiscoveryFilters = Pick<
  ExchangeWorkspaceState,
  | "searchQuery"
  | "naicsFilters"
  | "capabilityFilters"
  | "certificationFilters"
  | "territoryFilters"
  | "opportunityLocation"
>;

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function includesAny(values: readonly string[] | undefined, filters: readonly string[]): boolean {
  if (!filters.length) return true;
  const candidates = (values ?? []).map(normalized);
  return filters.some((filter) => candidates.some((candidate) => (
    candidate === normalized(filter) || candidate.startsWith(normalized(filter))
  )));
}

function isWithinMapBounds(
  organization: PublicOrganizationProjection,
  bounds: NonNullable<ExchangeWorkspaceState["opportunityLocation"]>["bounds"],
): boolean {
  if (!bounds) return true;
  const { latitude, longitude } = organization;
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= bounds.west
    && longitude <= bounds.east
    && latitude >= bounds.south
    && latitude <= bounds.north;
}

/**
 * Applies canonical Exchange filters to the bounded public projection only.
 * Organization IDs are de-duplicated before presentation so a record cannot
 * produce multiple list cards or map markers.
 */
export function filterPublicOrganizations(
  organizations: readonly PublicOrganizationProjection[],
  filters: OrganizationDiscoveryFilters,
): PublicOrganizationProjection[] {
  const queryTokens = normalized(filters.searchQuery).split(/\s+/).filter(Boolean);
  const seen = new Set<string>();

  return organizations.filter((organization) => {
    if (!organization.id || seen.has(organization.id) || organization.status !== "active") return false;
    seen.add(organization.id);

    const searchable = [
      organization.name,
      organization.description,
      organization.city,
      organization.state,
      ...(organization.naicsCodes ?? []),
      ...(organization.capabilityKeywords ?? []),
      ...(organization.certifications ?? []),
    ].map(normalized).join(" ");

    return queryTokens.every((token) => searchable.includes(token))
      && includesAny(organization.naicsCodes, filters.naicsFilters)
      && includesAny(organization.capabilityKeywords, filters.capabilityFilters)
      && includesAny(organization.certifications, filters.certificationFilters)
      && (!filters.territoryFilters.length
        || filters.territoryFilters.includes(organization.territoryFips ?? ""))
      && isWithinMapBounds(organization, filters.opportunityLocation?.bounds);
  });
}
