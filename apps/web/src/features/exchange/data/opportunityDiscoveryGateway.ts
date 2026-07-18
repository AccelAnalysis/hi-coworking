import { httpsCallable } from "firebase/functions";
import type { RfxDoc } from "@hi/shared";
import type {
  OpportunityDiscoveryPage,
  OpportunityDiscoveryQuery,
  OpportunityDiscoveryRecord,
  SavedOpportunitySearch,
} from "@hi/shared/opportunity-discovery";
import { functions } from "@/lib/firebase";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";

export type ExchangeDiscoveryRfx = RfxDoc & {
  discovery?: OpportunityDiscoveryRecord;
};

interface GatewayInput {
  operation:
    | "discover"
    | "setSaved"
    | "markViewed"
    | "savedSearchUpsert"
    | "savedSearchDelete"
    | "savedSearchList";
  payload: unknown;
}

const gateway = httpsCallable<GatewayInput, unknown>(functions, "rfx_listManaged");

export function workspaceToOpportunityQuery(
  state: ExchangeWorkspaceState,
  cursor?: string,
  pageSize = 40,
): OpportunityDiscoveryQuery {
  return {
    contractVersion: 1,
    query: state.searchQuery,
    filters: {
      naics: state.naicsFilters,
      industries: state.industryFilters,
      capabilities: state.capabilityFilters,
      opportunityTypes: state.opportunityTypeFilters as OpportunityDiscoveryQuery["filters"]["opportunityTypes"],
      rfxTypes: state.rfxTypeFilters,
      buyerTypes: state.buyerTypeFilters as OpportunityDiscoveryQuery["filters"]["buyerTypes"],
      workArrangements: state.workArrangementFilters as OpportunityDiscoveryQuery["filters"]["workArrangements"],
      visibility: state.visibilityFilters as OpportunityDiscoveryQuery["filters"]["visibility"],
      requiredCertifications: state.certificationFilters,
      setAsideDesignations: state.setAsideFilters,
      territoryFips: state.territoryFilters,
      primeClassifications: state.primeClassificationFilters as OpportunityDiscoveryQuery["filters"]["primeClassifications"],
      awardClassifications: state.awardClassificationFilters as OpportunityDiscoveryQuery["filters"]["awardClassifications"],
      ...(state.teamingSuitable ? { teamingSuitable: true } : {}),
      ...(state.closingSoon ? { closingSoon: true } : {}),
      ...(state.budgetMin !== undefined ? { budgetMin: state.budgetMin } : {}),
      ...(state.budgetMax !== undefined ? { budgetMax: state.budgetMax } : {}),
      personalized: state.personalizedFilters,
    },
    ...(state.opportunityLocation ? { location: state.opportunityLocation } : {}),
    sort: state.opportunitySort,
    pageSize,
    ...(cursor ? { cursor } : {}),
  };
}

export function discoveryRecordToRfx(
  record: OpportunityDiscoveryRecord,
): ExchangeDiscoveryRfx {
  return {
    id: record.id,
    schemaVersion: record.projectionVersion,
    title: record.title,
    description: record.searchableDescription,
    naicsCodes: record.naicsCodes,
    location: record.placeOfPerformance,
    ...(record.geo ? {
      geo: {
        lat: record.geo.latitude,
        lng: record.geo.longitude,
        geohash: record.geo.geohash,
      },
    } : {}),
    territoryFips: record.territoryFips,
    dueDate: record.responseDeadline,
    budget: record.budgetDisplay,
    memberOnly: record.visibility !== "public",
    status: record.status === "open" ? "open" : "closed",
    createdBy: record.issuerOrganizationId ?? "discovery-projection",
    orgId: record.issuerOrganizationId,
    createdByName: record.issuerDisplayName,
    visibility: record.visibility === "public" ? "public" : "members",
    template: record.rfxType,
    evaluationCriteria: [],
    requestedDocuments: [],
    adminApprovalStatus: "approved",
    responseCount: record.responseCount ?? 0,
    createdAt: record.postedAt,
    updatedAt: record.updatedAt,
    discovery: record,
  };
}

export async function discoverOpportunities(
  query: OpportunityDiscoveryQuery,
): Promise<OpportunityDiscoveryPage> {
  const response = await gateway({ operation: "discover", payload: query });
  return response.data as OpportunityDiscoveryPage;
}

export async function setOpportunitySaved(
  rfxId: string,
  saved: boolean,
): Promise<{ rfxId: string; saved: boolean }> {
  const response = await gateway({
    operation: "setSaved",
    payload: { rfxId, saved },
  });
  return response.data as { rfxId: string; saved: boolean };
}

export async function markOpportunityViewed(rfxId: string): Promise<void> {
  await gateway({ operation: "markViewed", payload: { rfxId } });
}

export async function listSavedOpportunitySearches(): Promise<SavedOpportunitySearch[]> {
  const response = await gateway({
    operation: "savedSearchList",
    payload: { maxResults: 50 },
  });
  return (response.data as { searches?: SavedOpportunitySearch[] }).searches ?? [];
}

export async function upsertSavedOpportunitySearch(input: {
  id?: string;
  name: string;
  query: Omit<OpportunityDiscoveryQuery, "cursor">;
  alertFrequency: SavedOpportunitySearch["alertFrequency"];
}): Promise<SavedOpportunitySearch> {
  const response = await gateway({ operation: "savedSearchUpsert", payload: input });
  return response.data as SavedOpportunitySearch;
}

export async function deleteSavedOpportunitySearch(id: string): Promise<void> {
  await gateway({ operation: "savedSearchDelete", payload: { id } });
}
