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

/**
 * The four product workspaces that own independent filters, selections, and
 * draft/list state. Legacy routes are mapped onto one of these workspaces.
 */
export const EXCHANGE_CANONICAL_MODES = [
  "opportunities",
  "referrals",
  "intelligence",
  "resources",
] as const;
export type ExchangeCanonicalMode = (typeof EXCHANGE_CANONICAL_MODES)[number];

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
  | { entityType: "opportunity"; entityId: string }
  | { entityType: "territory"; entityId: string }
  | { entityType: "organization"; entityId: string }
  | { entityType: "establishment"; entityId: string; organizationId?: string }
  | { entityType: "referral"; entityId: string }
  | { entityType: "resource"; entityId: string }
  | { entityType: "team"; entityId: string }
  | { entityType: "relationship"; entityId: string }
  | { entityType: "industry"; entityId: string }
  | null;

export type ExchangeSecondaryContext = ExchangeSelection;

export interface ExchangeDraftRefs {
  referralDraftId?: string;
  contactRequestDraftId?: string;
  teamingInvitationDraftId?: string;
  organizationClaimDraftId?: string;
  opportunityResponseDraftId?: string;
  savedSearchDraftId?: string;
  resourceContactDraftId?: string;
}

/**
 * A bounded snapshot of mode-owned filters. Fields are optional so each
 * canonical mode stores only the filter family it understands.
 */
export interface ExchangeModeFilterState {
  naicsFilters?: string[];
  industryFilters?: string[];
  capabilityFilters?: string[];
  territoryFilters?: string[];
  rfxStatusFilters?: ExchangeRfxStatus[];
  territoryStatusFilters?: ExchangeTerritoryStatus[];
  opportunityTypeFilters?: string[];
  rfxTypeFilters?: string[];
  buyerTypeFilters?: string[];
  workArrangementFilters?: string[];
  visibilityFilters?: string[];
  certificationFilters?: string[];
  setAsideFilters?: string[];
  primeClassificationFilters?: string[];
  awardClassificationFilters?: string[];
  personalizedFilters?: ExchangePersonalizedFilter[];
  localFirst?: boolean;
  closingSoon?: boolean;
  teamingSuitable?: boolean;
  budgetMin?: number;
  budgetMax?: number;
  opportunitySort?: OpportunitySort;
  activeSavedSearchId?: string;
  connectionMode?: ExchangeConnectionMode;
  referralStatusFilters?: ExchangeReferralStatus[];
  connectionIndustryFilters?: string[];
  connectionTerritoryFilters?: string[];
  compensationFilter?: ExchangeCompensationFilter;
  relationshipFilter?: ExchangeRelationshipFilter;
  intelligenceMetric?: ExchangeIntelligenceMetric;
  eligibilityFilters?: string[];
  providerFilters?: string[];
  serviceFilters?: string[];
}

export interface ExchangeModeState {
  filters: ExchangeModeFilterState;
  secondaryContext: ExchangeSecondaryContext;
  listScrollTop: number;
  panelSubsection?: string;
  resourceCategory?: string;
  draftRefs: ExchangeDraftRefs;
}

export type ExchangeModeStates = Record<ExchangeCanonicalMode, ExchangeModeState>;

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

  /** A URL/browser request only. It never proves authority. */
  requestedActorOrganizationId?: string;
  /** A server-validated actor organization for the current viewer. */
  actorOrganizationId?: string;
  subjectOrganizationId?: string;
  secondaryContext: ExchangeSecondaryContext;
  modeStates: ExchangeModeStates;
  organizationDrawerOpen: boolean;

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
 * Meaningful open detail/drawer state is included; animation and dimensions
 * remain session-only concerns.
 */
export type ExchangeUrlState = Pick<
  ExchangeWorkspaceState,
  | "view"
  | "surfaceMode"
  | "selection"
  | "requestedActorOrganizationId"
  | "subjectOrganizationId"
  | "secondaryContext"
  | "organizationDrawerOpen"
  | "rightPanelOpen"
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

/** Safe, authority-free state returned by the session persistence codec. */
export type ExchangeWorkspaceSessionHydration = Partial<Pick<
  ExchangeWorkspaceState,
  | "view"
  | "surfaceMode"
  | "subjectOrganizationId"
  | "secondaryContext"
  | "modeStates"
  | "organizationDrawerOpen"
  | "searchQuery"
  | "opportunityLocation"
  | "leftPanelCollapsed"
  | "rightPanelOpen"
  | "mobileFilterOpen"
  | "mobileDetailOpen"
  | "viewport"
>>;

export const DEFAULT_EXCHANGE_VIEW: ExchangeView = "opportunities";
export const DEFAULT_EXCHANGE_SURFACE_MODE: ExchangeSurfaceMode = "split";
export const DEFAULT_EXCHANGE_LOCAL_FIRST = true;
export const DEFAULT_EXCHANGE_OPPORTUNITY_SORT: OpportunitySort = "recommended";
export const DEFAULT_EXCHANGE_CONNECTION_MODE: ExchangeConnectionMode = "sent";
export const DEFAULT_EXCHANGE_COMPENSATION_FILTER: ExchangeCompensationFilter = "all";
export const DEFAULT_EXCHANGE_RELATIONSHIP_FILTER: ExchangeRelationshipFilter = "all";
export const DEFAULT_EXCHANGE_INTELLIGENCE_METRIC: ExchangeIntelligenceMetric = "overview";

export function canonicalExchangeMode(view: ExchangeView): ExchangeCanonicalMode {
  if (view === "connections" || view === "referrals") return "referrals";
  if (view === "intelligence") return "intelligence";
  if (view === "resources") return "resources";
  return "opportunities";
}

export function createInitialExchangeModeStates(): ExchangeModeStates {
  return {
    opportunities: {
      filters: {
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
        opportunitySort: DEFAULT_EXCHANGE_OPPORTUNITY_SORT,
      },
      secondaryContext: null,
      listScrollTop: 0,
      draftRefs: {},
    },
    referrals: {
      filters: {
        connectionMode: DEFAULT_EXCHANGE_CONNECTION_MODE,
        referralStatusFilters: [],
        connectionIndustryFilters: [],
        connectionTerritoryFilters: [],
        compensationFilter: DEFAULT_EXCHANGE_COMPENSATION_FILTER,
        relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
      },
      secondaryContext: null,
      listScrollTop: 0,
      draftRefs: {},
    },
    intelligence: {
      filters: {
        connectionIndustryFilters: [],
        connectionTerritoryFilters: [],
        relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
        intelligenceMetric: DEFAULT_EXCHANGE_INTELLIGENCE_METRIC,
      },
      secondaryContext: null,
      listScrollTop: 0,
      draftRefs: {},
    },
    resources: {
      filters: {
        eligibilityFilters: [],
        providerFilters: [],
        serviceFilters: [],
      },
      secondaryContext: null,
      listScrollTop: 0,
      draftRefs: {},
    },
  };
}

export function createInitialExchangeWorkspaceState(): ExchangeWorkspaceState {
  return {
    view: DEFAULT_EXCHANGE_VIEW,
    surfaceMode: DEFAULT_EXCHANGE_SURFACE_MODE,
    selection: null,
    requestedActorOrganizationId: undefined,
    actorOrganizationId: undefined,
    subjectOrganizationId: undefined,
    secondaryContext: null,
    modeStates: createInitialExchangeModeStates(),
    organizationDrawerOpen: false,
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
