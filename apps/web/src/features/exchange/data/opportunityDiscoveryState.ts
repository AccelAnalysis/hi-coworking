import type { OpportunityDiscoveryQuery } from "@hi/shared/opportunity-discovery";
import type { ExchangeWorkspaceHydration } from "../state/exchangeWorkspaceTypes";

export function opportunityQueryToWorkspaceHydration(
  query: Omit<OpportunityDiscoveryQuery, "cursor">,
): ExchangeWorkspaceHydration {
  return {
    view: "opportunities",
    searchQuery: query.query,
    naicsFilters: query.filters.naics,
    industryFilters: query.filters.industries,
    capabilityFilters: query.filters.capabilities,
    territoryFilters: query.filters.territoryFips,
    opportunityTypeFilters: query.filters.opportunityTypes,
    rfxTypeFilters: query.filters.rfxTypes,
    buyerTypeFilters: query.filters.buyerTypes,
    workArrangementFilters: query.filters.workArrangements,
    visibilityFilters: query.filters.visibility,
    certificationFilters: query.filters.requiredCertifications,
    setAsideFilters: query.filters.setAsideDesignations,
    primeClassificationFilters: query.filters.primeClassifications,
    awardClassificationFilters: query.filters.awardClassifications,
    personalizedFilters: query.filters.personalized,
    closingSoon: query.filters.closingSoon === true,
    teamingSuitable: query.filters.teamingSuitable === true,
    budgetMin: query.filters.budgetMin,
    budgetMax: query.filters.budgetMax,
    opportunitySort: query.sort,
    opportunityLocation: query.location,
    selection: null,
  };
}

export function summarizeOpportunityQuery(
  query: Omit<OpportunityDiscoveryQuery, "cursor">,
): string {
  const parts = [
    query.query ? `“${query.query}”` : "All keywords",
    query.location?.label,
    query.filters.industries[0],
    query.filters.capabilities[0],
    query.filters.opportunityTypes[0]?.replaceAll("_", " "),
  ].filter((value): value is string => Boolean(value));
  const filterCount = Object.values(query.filters).reduce<number>((count, value) => (
    count + (Array.isArray(value) ? value.length : value ? 1 : 0)
  ), 0);
  return `${parts.slice(0, 3).join(" · ")}${filterCount > 2 ? ` · ${filterCount} filters` : ""}`;
}
