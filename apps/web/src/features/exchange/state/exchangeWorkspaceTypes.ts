import type { RfxStatus } from "@hi/shared";
import type {
  OpportunityLocationFilter,
  OpportunitySort,
} from "@hi/shared/opportunity-discovery";

export const EXCHANGE_SURFACE_MODES = ["map", "list", "split"] as const;
export type ExchangeSurfaceMode = (typeof EXCHANGE_SURFACE_MODES)[number];

export const EXCHANGE_VIEWS = [
  "businesses",
  "opportunities",
  "referrals",
  "teaming",
  "resources",
  "connections",
  "intelligence",
] as const;
export type ExchangeView = (typeof EXCHANGE_VIEWS)[number];

export const EXCHANGE_CONNECTION_MODES = [
  "sent",
  "received",
  "draft",
  "active",
  "converted",
  "closed",
  "disputed",
] as const;
export type ExchangeConnectionMode =
  (typeof EXCHANGE_CONNECTION_MODES)[number];

export const EXCHANGE_REFERRAL_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "in_progress",
  "converted",
  "closed",
  "withdrawn",
  "expired",
] as const;
export type ExchangeReferralStatus =
  (typeof EXCHANGE_REFERRAL_STATUSES)[number];

export const EXCHANGE_COMPENSATION_FILTERS = [
  "all",
  "configured",
  "none",
] as const;
export type ExchangeCompensationFilter =
  (typeof EXCHANGE_COMPENSATION_FILTERS)[number];

export const EXCHANGE_RELATIONSHIP_FILTERS = [
  "all",
  "new",
  "active",
  "established",
  "trusted",
  "review_required",
] as const;
export type ExchangeRelationshipFilter =
  (typeof EXCHANGE_RELATIONSHIP_FILTERS)[number];

export const EXCHANGE_INTELLIGENCE_METRICS = [
  "overview",
  "relationships",
  "gaps",
  "impact",
] as const;
export type ExchangeIntelligenceMetric =
  (typeof EXCHANGE_INTELLIGENCE_METRICS)[number];

export const EXCHANGE_TERRITORY_STATUSES = ["released", "scheduled"] as const;
export type ExchangeTerritoryStatus =
  (typeof EXCHANGE_TERRITORY_STATUSES)[number];

export const EXCHANGE_RFX_STATUSES = [
  "open",
] as const satisfies readonly RfxStatus[];
export type ExchangeRfxStatus = (typeof EXCHANGE_RFX_STATUSES)[number];

export const EXCHANGE_OPPORTUNITY_SORTS = [
  "recommended",
  "relevance",
  "nearest",
  "newest",
  "updated",
  "deadline_soonest",
  "deadline_latest",
  "local_first",
  "capability_match",
  "budget_high",
  "budget_low",
] as const satisfies readonly OpportunitySort[];

export const EXCHANGE_PERSONALIZED_FILTERS = [
  "matches_organization",
  "matches_naics",
  "matches_capabilities",
  "matches_service_territory",
  "saved",
  "viewed",
  "responded",
  "managed",
  "new_since_last_visit",
  "updated_since_viewed",
  "exclude_issued_by_my_org",
] as const;
export type ExchangePersonalizedFilter =
  (typeof EXCHANGE_PERSONALIZED_FILTERS)[number];

export type ExchangeSelection =
  | { entityType: "rfx"; entityId: string }
  | { entityType: "territory"; entityId: string }
  | { entityType: "organization"; entityId: string }
  | { entityType: "referral"; entityId: string }
  | { entityType: "relationship"; entityId: string }
  | { entityType: "industry"; entityId: string }
  | null;

export interface ExchangeViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface ExchangeWorkspaceState {
  view: ExchangeView;
  surfaceMode: ExchangeSurfaceMode;
  selection: ExchangeSelection;

  searchQuery: string;
  naicsFilters: string[];
  industryFilters: string[];
  capabilityFilters: string[];
  territoryFilters: string[];
  rfxStatusFilters: ExchangeRfxStatus[];
  territoryStatusFilters: ExchangeTerritoryStatus[];
  opportunityTypeFilters: string[];
  rfxTypeFilters: string[];
  buyerTypeFilters: string[];
  workArrangementFilters: string[];
  visibilityFilters: string[];
  certificationFilters: string[];
  setAsideFilters: string[];
  primeClassificationFilters: string[];
  awardClassificationFilters: string[];
  personalizedFilters: ExchangePersonalizedFilter[];
  localFirst: boolean;
  closingSoon: boolean;
  teamingSuitable: boolean;
  budgetMin?: number;
  budgetMax?: number;
  opportunitySort: OpportunitySort;
  opportunityLocation?: OpportunityLocationFilter;
  activeSavedSearchId?: string;

  connectionMode: ExchangeConnectionMode;
  referralStatusFilters: ExchangeReferralStatus[];
  connectionIndustryFilters: string[];
  connectionTerritoryFilters: string[];
  compensationFilter: ExchangeCompensationFilter;
  relationshipFilter: ExchangeRelationshipFilter;
  intelligenceMetric: ExchangeIntelligenceMetric;

  leftPanelCollapsed: boolean;
  rightPanelOpen: boolean;

  mobileFilterOpen: boolean;
  mobileDetailOpen: boolean;

  viewport?: ExchangeViewport;
}

/**
 * The subset of interaction state that is meaningful in a shareable URL.
 * Drawer and panel animation state intentionally does not cross this boundary.
 */
export type ExchangeUrlState = Pick<
  ExchangeWorkspaceState,
  | "view"
  | "surfaceMode"
  | "selection"
  | "searchQuery"
  | "naicsFilters"
  | "industryFilters"
  | "capabilityFilters"
  | "territoryFilters"
  | "rfxStatusFilters"
  | "territoryStatusFilters"
  | "opportunityTypeFilters"
  | "rfxTypeFilters"
  | "buyerTypeFilters"
  | "workArrangementFilters"
  | "visibilityFilters"
  | "certificationFilters"
  | "setAsideFilters"
  | "primeClassificationFilters"
  | "awardClassificationFilters"
  | "personalizedFilters"
  | "localFirst"
  | "closingSoon"
  | "teamingSuitable"
  | "budgetMin"
  | "budgetMax"
  | "opportunitySort"
  | "opportunityLocation"
  | "activeSavedSearchId"
  | "connectionMode"
  | "referralStatusFilters"
  | "connectionIndustryFilters"
  | "connectionTerritoryFilters"
  | "compensationFilter"
  | "relationshipFilter"
  | "intelligenceMetric"
  | "viewport"
>;

export type ExchangeWorkspaceHydration = Partial<ExchangeUrlState>;

export const DEFAULT_EXCHANGE_VIEW: ExchangeView = "opportunities";
export const DEFAULT_EXCHANGE_SURFACE_MODE: ExchangeSurfaceMode = "split";
export const DEFAULT_EXCHANGE_LOCAL_FIRST = true;
export const DEFAULT_EXCHANGE_OPPORTUNITY_SORT: OpportunitySort = "recommended";
export const DEFAULT_EXCHANGE_CONNECTION_MODE: ExchangeConnectionMode = "sent";
export const DEFAULT_EXCHANGE_COMPENSATION_FILTER: ExchangeCompensationFilter = "all";
export const DEFAULT_EXCHANGE_RELATIONSHIP_FILTER: ExchangeRelationshipFilter = "all";
export const DEFAULT_EXCHANGE_INTELLIGENCE_METRIC: ExchangeIntelligenceMetric = "overview";

export function createInitialExchangeWorkspaceState(): ExchangeWorkspaceState {
  return {
    view: DEFAULT_EXCHANGE_VIEW,
    surfaceMode: DEFAULT_EXCHANGE_SURFACE_MODE,
    selection: null,
    searchQuery: "",
    naicsFilters: [],
    industryFilters: [],
    capabilityFilters: [],
    territoryFilters: [],
    rfxStatusFilters: [],
    territoryStatusFilters: [],
    opportunityTypeFilters: [],
    rfxTypeFilters: [],
    buyerTypeFilters: [],
    workArrangementFilters: [],
    visibilityFilters: [],
    certificationFilters: [],
    setAsideFilters: [],
    primeClassificationFilters: [],
    awardClassificationFilters: [],
    personalizedFilters: [],
    localFirst: DEFAULT_EXCHANGE_LOCAL_FIRST,
    closingSoon: false,
    teamingSuitable: false,
    budgetMin: undefined,
    budgetMax: undefined,
    opportunitySort: DEFAULT_EXCHANGE_OPPORTUNITY_SORT,
    opportunityLocation: undefined,
    activeSavedSearchId: undefined,
    connectionMode: DEFAULT_EXCHANGE_CONNECTION_MODE,
    referralStatusFilters: [],
    connectionIndustryFilters: [],
    connectionTerritoryFilters: [],
    compensationFilter: DEFAULT_EXCHANGE_COMPENSATION_FILTER,
    relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
    intelligenceMetric: DEFAULT_EXCHANGE_INTELLIGENCE_METRIC,
    leftPanelCollapsed: false,
    rightPanelOpen: false,
    mobileFilterOpen: false,
    mobileDetailOpen: false,
    viewport: undefined,
  };
}

export const initialExchangeWorkspaceState =
  createInitialExchangeWorkspaceState();

export function isExchangeSurfaceMode(
  value: unknown,
): value is ExchangeSurfaceMode {
  return typeof value === "string"
    && (EXCHANGE_SURFACE_MODES as readonly string[]).includes(value);
}

export function isExchangeView(value: unknown): value is ExchangeView {
  return typeof value === "string"
    && (EXCHANGE_VIEWS as readonly string[]).includes(value);
}

export function isExchangeConnectionMode(
  value: unknown,
): value is ExchangeConnectionMode {
  return typeof value === "string"
    && (EXCHANGE_CONNECTION_MODES as readonly string[]).includes(value);
}

export function isExchangeReferralStatus(
  value: unknown,
): value is ExchangeReferralStatus {
  return typeof value === "string"
    && (EXCHANGE_REFERRAL_STATUSES as readonly string[]).includes(value);
}

export function isExchangeCompensationFilter(
  value: unknown,
): value is ExchangeCompensationFilter {
  return typeof value === "string"
    && (EXCHANGE_COMPENSATION_FILTERS as readonly string[]).includes(value);
}

export function isExchangeRelationshipFilter(
  value: unknown,
): value is ExchangeRelationshipFilter {
  return typeof value === "string"
    && (EXCHANGE_RELATIONSHIP_FILTERS as readonly string[]).includes(value);
}

export function isExchangeIntelligenceMetric(
  value: unknown,
): value is ExchangeIntelligenceMetric {
  return typeof value === "string"
    && (EXCHANGE_INTELLIGENCE_METRICS as readonly string[]).includes(value);
}

export function isExchangeRfxStatus(
  value: unknown,
): value is ExchangeRfxStatus {
  return typeof value === "string"
    && (EXCHANGE_RFX_STATUSES as readonly string[]).includes(value);
}

export function isExchangeTerritoryStatus(
  value: unknown,
): value is ExchangeTerritoryStatus {
  return typeof value === "string"
    && (EXCHANGE_TERRITORY_STATUSES as readonly string[]).includes(value);
}

export function isExchangeOpportunitySort(
  value: unknown,
): value is OpportunitySort {
  return typeof value === "string"
    && (EXCHANGE_OPPORTUNITY_SORTS as readonly string[]).includes(value);
}

export function isExchangePersonalizedFilter(
  value: unknown,
): value is ExchangePersonalizedFilter {
  return typeof value === "string"
    && (EXCHANGE_PERSONALIZED_FILTERS as readonly string[]).includes(value);
}
