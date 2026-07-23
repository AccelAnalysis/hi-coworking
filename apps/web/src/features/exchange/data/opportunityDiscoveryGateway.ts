import { httpsCallable } from "firebase/functions";
import type { RfxDoc } from "@hi/shared";
import type {
  OpportunityDiscoveryPage,
  OpportunityDiscoveryQuery,
  OpportunityDiscoveryRecord,
  OpportunityGovernanceSnapshot,
  RecentOpportunitySearch,
  SavedOpportunitySearch,
} from "@hi/shared/opportunity-discovery";
import { functions } from "@/lib/firebase";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";

export type ExchangeDiscoveryRfx = RfxDoc & {
  discovery?: OpportunityDiscoveryRecord;
};

export type {
  OpportunityAddendum,
  OpportunityGovernanceSnapshot,
  OpportunityQuestion,
  RecentOpportunitySearch,
} from "@hi/shared/opportunity-discovery";

interface GatewayInput {
  operation:
    | "discover"
    | "setSaved"
    | "markViewed"
    | "savedSearchUpsert"
    | "savedSearchDelete"
    | "savedSearchList"
    | "recentSearchList"
    | "governanceList"
    | "addendumCreate"
    | "addendumAcknowledge"
    | "questionSubmit"
    | "questionAnswer";
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
    ...(state.actorOrganizationId ? { actorOrganizationId: state.actorOrganizationId } : {}),
    ...(state.modeStates.opportunities.filters.issuerOrganizationId
      ? { issuerOrganizationId: state.modeStates.opportunities.filters.issuerOrganizationId }
      : {}),
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
        geohash: record.geo.geohash ?? "",
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
  actorOrganizationId?: string,
): Promise<{ rfxId: string; saved: boolean }> {
  const response = await gateway({
    operation: "setSaved",
    payload: {
      rfxId,
      saved,
      ...(actorOrganizationId ? { actorOrganizationId } : {}),
    },
  });
  return response.data as { rfxId: string; saved: boolean };
}

export async function markOpportunityViewed(
  rfxId: string,
  actorOrganizationId?: string,
): Promise<void> {
  await gateway({
    operation: "markViewed",
    payload: { rfxId, ...(actorOrganizationId ? { actorOrganizationId } : {}) },
  });
}

export async function listSavedOpportunitySearches(
  actorOrganizationId?: string,
): Promise<SavedOpportunitySearch[]> {
  const response = await gateway({
    operation: "savedSearchList",
    payload: { maxResults: 50, ...(actorOrganizationId ? { actorOrganizationId } : {}) },
  });
  return (response.data as { searches?: SavedOpportunitySearch[] }).searches ?? [];
}

export async function listRecentOpportunitySearches(
  actorOrganizationId?: string,
): Promise<RecentOpportunitySearch[]> {
  const response = await gateway({
    operation: "recentSearchList",
    payload: { maxResults: 10, ...(actorOrganizationId ? { actorOrganizationId } : {}) },
  });
  return (response.data as { searches?: RecentOpportunitySearch[] }).searches ?? [];
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

export async function deleteSavedOpportunitySearch(
  id: string,
  actorOrganizationId?: string,
): Promise<void> {
  await gateway({
    operation: "savedSearchDelete",
    payload: { id, ...(actorOrganizationId ? { actorOrganizationId } : {}) },
  });
}

function idempotencyKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 160);
}

export async function loadOpportunityGovernance(
  rfxId: string,
): Promise<OpportunityGovernanceSnapshot> {
  const response = await gateway({
    operation: "governanceList",
    payload: { rfxId, includePrivate: true },
  });
  return response.data as OpportunityGovernanceSnapshot;
}

export async function submitOpportunityQuestion(input: {
  rfxId: string;
  question: string;
  visibilityRequested: "public" | "private";
  organizationId?: string;
}): Promise<{ id: string; replayed: boolean }> {
  const response = await gateway({
    operation: "questionSubmit",
    payload: {
      ...input,
      idempotencyKey: idempotencyKey("question"),
    },
  });
  return response.data as { id: string; replayed: boolean };
}

export async function answerOpportunityQuestion(input: {
  rfxId: string;
  questionId: string;
  answer: string;
  visibility: "public" | "private";
}): Promise<void> {
  await gateway({
    operation: "questionAnswer",
    payload: {
      ...input,
      idempotencyKey: idempotencyKey("answer"),
    },
  });
}

export async function createOpportunityAddendum(input: {
  rfxId: string;
  title: string;
  summary: string;
  materialChanges: string[];
  deadlineChanged: boolean;
  previousDeadline?: number;
  newDeadline?: number;
  acknowledgmentRequired: boolean;
}): Promise<{ id: string; version: number; replayed: boolean }> {
  const response = await gateway({
    operation: "addendumCreate",
    payload: {
      ...input,
      idempotencyKey: idempotencyKey("addendum"),
    },
  });
  return response.data as { id: string; version: number; replayed: boolean };
}

export async function acknowledgeOpportunityAddendum(input: {
  rfxId: string;
  addendumId: string;
  organizationId?: string;
}): Promise<void> {
  await gateway({
    operation: "addendumAcknowledge",
    payload: {
      ...input,
      idempotencyKey: idempotencyKey("acknowledge"),
    },
  });
}
