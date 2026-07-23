import { z } from "zod";

export const OPPORTUNITY_DISCOVERY_PROJECTION_VERSION = 1 as const;

export const opportunityLifecycleStatusSchema = z.enum([
  "draft",
  "under_review",
  "open",
  "closed",
  "awarded",
  "rejected",
  "cancelled",
  "archived",
]);
export type OpportunityLifecycleStatus = z.infer<
  typeof opportunityLifecycleStatusSchema
>;

export const opportunitySortSchema = z.enum([
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
]);
export type OpportunitySort = z.infer<typeof opportunitySortSchema>;

export const opportunityLocationConfidenceSchema = z.enum([
  "exact",
  "approximate",
  "place_of_performance",
  "issuer_address",
  "eligible_territory",
  "territory_centroid",
  "withheld",
  "remote",
  "not_geocoded",
]);
export type OpportunityLocationConfidence = z.infer<
  typeof opportunityLocationConfidenceSchema
>;

export const opportunityWorkArrangementSchema = z.enum([
  "on_site",
  "remote",
  "hybrid",
  "flexible",
  "unspecified",
]);
export type OpportunityWorkArrangement = z.infer<
  typeof opportunityWorkArrangementSchema
>;

export const opportunityBuyerTypeSchema = z.enum([
  "government",
  "nonprofit",
  "private",
  "institutional",
  "unknown",
]);
export type OpportunityBuyerType = z.infer<typeof opportunityBuyerTypeSchema>;

export const opportunityTypeSchema = z.enum([
  "goods",
  "services",
  "construction",
  "professional_services",
  "mixed",
  "other",
]);
export type OpportunityType = z.infer<typeof opportunityTypeSchema>;

export const opportunityVisibilitySchema = z.enum([
  "public",
  "members",
  "restricted",
]);
export type OpportunityVisibility = z.infer<typeof opportunityVisibilitySchema>;

export const opportunityGeoSchema = z.object({
  latitude: z.number().min(-85.051129).max(85.051129),
  longitude: z.number().min(-180).max(180),
  // A geohash is a derived query accelerator, not coordinate authority.
  // Imported opportunities may carry valid publisher coordinates before a
  // projection backfill derives one, so map eligibility must not depend on it.
  geohash: z.string().min(1).max(24).optional(),
  confidence: opportunityLocationConfidenceSchema,
});
export type OpportunityGeo = z.infer<typeof opportunityGeoSchema>;

export const opportunityRelationshipSchema = z.object({
  saved: z.boolean().default(false),
  viewed: z.boolean().default(false),
  responded: z.boolean().default(false),
  managed: z.boolean().default(false),
  newSinceLastVisit: z.boolean().default(false),
  updatedSinceViewed: z.boolean().default(false),
  eligibleToRespond: z.boolean().optional(),
  eligibilityReason: z.string().max(240).optional(),
});
export type OpportunityRelationship = z.infer<
  typeof opportunityRelationshipSchema
>;

const defaultOpportunityRelationship: OpportunityRelationship = {
  saved: false,
  viewed: false,
  responded: false,
  managed: false,
  newSinceLastVisit: false,
  updatedSinceViewed: false,
};

export const opportunityDiscoveryRecordSchema = z.object({
  projectionVersion: z.literal(OPPORTUNITY_DISCOVERY_PROJECTION_VERSION),
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  searchableDescription: z.string().max(10_000),
  rfxNumber: z.string().max(120).optional(),
  issuerOrganizationId: z.string().max(160).optional(),
  issuerDisplayName: z.string().max(240),
  issuerType: opportunityBuyerTypeSchema,
  issuerVerified: z.boolean(),
  rfxType: z.string().max(80),
  opportunityType: opportunityTypeSchema,
  naicsCodes: z.array(z.string().regex(/^\d{2,6}$/)).max(40),
  industryLabels: z.array(z.string().max(160)).max(40),
  capabilityKeywords: z.array(z.string().max(120)).max(60),
  searchTokens: z.array(z.string().max(64)).max(500),
  postedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  responseDeadline: z.number().int().nonnegative().optional(),
  deadlineTimezone: z.string().max(80).optional(),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().nonnegative().optional(),
  budgetDisplay: z.string().max(160).optional(),
  currency: z.string().length(3).default("USD"),
  placeOfPerformance: z.string().max(320).optional(),
  workArrangement: opportunityWorkArrangementSchema,
  territoryFips: z.string().max(16).optional(),
  city: z.string().max(120).optional(),
  county: z.string().max(120).optional(),
  state: z.string().max(80).optional(),
  postalCode: z.string().max(20).optional(),
  locationConfidence: opportunityLocationConfidenceSchema,
  geo: opportunityGeoSchema.optional(),
  visibility: opportunityVisibilitySchema,
  requiredCertifications: z.array(z.string().max(160)).max(40),
  setAsideDesignations: z.array(z.string().max(160)).max(40),
  primeClassification: z.enum(["prime", "subcontract", "either", "unspecified"]),
  awardClassification: z.enum(["single", "multiple", "unspecified"]),
  teamingSuitable: z.boolean(),
  addendumCount: z.number().int().nonnegative(),
  qAndAStatus: z.enum(["open", "closed", "not_available"]),
  responseCount: z.number().int().nonnegative().optional(),
  status: opportunityLifecycleStatusSchema,
  relationship: opportunityRelationshipSchema.default(defaultOpportunityRelationship),
  relevanceScore: z.number().finite().optional(),
  distanceMiles: z.number().nonnegative().optional(),
});
export type OpportunityDiscoveryRecord = z.infer<
  typeof opportunityDiscoveryRecordSchema
>;

export const opportunityMapBoundsSchema = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-85.051129).max(85.051129),
  east: z.number().min(-180).max(180),
  north: z.number().min(-85.051129).max(85.051129),
}).superRefine((value, context) => {
  if (value.south >= value.north) {
    context.addIssue({
      code: "custom",
      message: "South must be less than north",
      path: ["north"],
    });
  }
  if (value.west === value.east) {
    context.addIssue({
      code: "custom",
      message: "West and east cannot be identical",
      path: ["east"],
    });
  }
});
export type OpportunityMapBounds = z.infer<typeof opportunityMapBoundsSchema>;

export const opportunityLocationFilterSchema = z.object({
  label: z.string().max(240).optional(),
  latitude: z.number().min(-85.051129).max(85.051129).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMiles: z.number().min(1).max(500).optional(),
  bounds: opportunityMapBoundsSchema.optional(),
  includeRemote: z.boolean().default(true),
}).superRefine((value, context) => {
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    context.addIssue({
      code: "custom",
      message: "Latitude and longitude must be supplied together",
      path: [hasLatitude ? "longitude" : "latitude"],
    });
  }
  if (value.radiusMiles !== undefined && (!hasLatitude || !hasLongitude)) {
    context.addIssue({
      code: "custom",
      message: "Radius requires a location center",
      path: ["radiusMiles"],
    });
  }
  if (value.bounds && hasLatitude) {
    context.addIssue({
      code: "custom",
      message: "Use either a location center or map bounds",
      path: ["bounds"],
    });
  }
});
export type OpportunityLocationFilter = z.infer<
  typeof opportunityLocationFilterSchema
>;

export const opportunityDiscoveryFiltersSchema = z.object({
  naics: z.array(z.string().regex(/^\d{2,6}$/)).max(40).default([]),
  industries: z.array(z.string().max(160)).max(40).default([]),
  capabilities: z.array(z.string().max(120)).max(60).default([]),
  opportunityTypes: z.array(opportunityTypeSchema).max(10).default([]),
  rfxTypes: z.array(z.string().max(80)).max(20).default([]),
  buyerTypes: z.array(opportunityBuyerTypeSchema).max(10).default([]),
  workArrangements: z.array(opportunityWorkArrangementSchema).max(10).default([]),
  visibility: z.array(opportunityVisibilitySchema).max(3).default([]),
  requiredCertifications: z.array(z.string().max(160)).max(40).default([]),
  setAsideDesignations: z.array(z.string().max(160)).max(40).default([]),
  territoryFips: z.array(z.string().max(16)).max(40).default([]),
  primeClassifications: z.array(z.enum(["prime", "subcontract", "either"])).max(3).default([]),
  awardClassifications: z.array(z.enum(["single", "multiple"])).max(2).default([]),
  teamingSuitable: z.boolean().optional(),
  closingSoon: z.boolean().optional(),
  postedAfter: z.number().int().nonnegative().optional(),
  postedBefore: z.number().int().nonnegative().optional(),
  deadlineAfter: z.number().int().nonnegative().optional(),
  deadlineBefore: z.number().int().nonnegative().optional(),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  personalized: z.array(z.enum([
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
  ])).max(20).default([]),
}).strict().superRefine((value, context) => {
  for (const [minimum, maximum, path] of [
    [value.postedAfter, value.postedBefore, "postedBefore"],
    [value.deadlineAfter, value.deadlineBefore, "deadlineBefore"],
    [value.budgetMin, value.budgetMax, "budgetMax"],
  ] as const) {
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      context.addIssue({
        code: "custom",
        message: "Minimum cannot exceed maximum",
        path: [path],
      });
    }
  }
});
export type OpportunityDiscoveryFilters = z.infer<
  typeof opportunityDiscoveryFiltersSchema
>;

const defaultOpportunityDiscoveryFilters: OpportunityDiscoveryFilters = {
  naics: [],
  industries: [],
  capabilities: [],
  opportunityTypes: [],
  rfxTypes: [],
  buyerTypes: [],
  workArrangements: [],
  visibility: [],
  requiredCertifications: [],
  setAsideDesignations: [],
  territoryFips: [],
  primeClassifications: [],
  awardClassifications: [],
  personalized: [],
};

export const opportunityDiscoveryQuerySchema = z.object({
  contractVersion: z.literal(OPPORTUNITY_DISCOVERY_PROJECTION_VERSION).default(
    OPPORTUNITY_DISCOVERY_PROJECTION_VERSION,
  ),
  query: z.string().max(240).default(""),
  /** Untrusted request; the server must resolve exact-active authority. */
  actorOrganizationId: z.string().trim().min(1).max(160).optional(),
  /** Canonical issuer narrowing; visibility authorization is still server-side. */
  issuerOrganizationId: z.string().trim().min(1).max(160).optional(),
  exactPhrase: z.string().max(240).optional(),
  filters: opportunityDiscoveryFiltersSchema.default(defaultOpportunityDiscoveryFilters),
  location: opportunityLocationFilterSchema.optional(),
  sort: opportunitySortSchema.default("recommended"),
  pageSize: z.number().int().min(1).max(100).default(40),
  cursor: z.string().max(2048).optional(),
}).strict();
export type OpportunityDiscoveryQuery = z.infer<
  typeof opportunityDiscoveryQuerySchema
>;

export const opportunityDiscoveryPageSchema = z.object({
  contractVersion: z.literal(OPPORTUNITY_DISCOVERY_PROJECTION_VERSION),
  records: z.array(opportunityDiscoveryRecordSchema),
  nextCursor: z.string().max(2048).optional(),
  totalCount: z.number().int().nonnegative().optional(),
  countAccuracy: z.enum(["exact", "qualified", "unavailable"]),
  truncated: z.boolean(),
  degraded: z.boolean(),
  warnings: z.array(z.string().max(240)).max(10),
  provider: z.string().max(80),
  queryDurationMs: z.number().nonnegative(),
});
export type OpportunityDiscoveryPage = z.infer<
  typeof opportunityDiscoveryPageSchema
>;

export const opportunityAlertFrequencySchema = z.enum([
  "immediate",
  "daily",
  "weekly",
  "disabled",
]);
export type OpportunityAlertFrequency = z.infer<
  typeof opportunityAlertFrequencySchema
>;

export const savedOpportunitySearchSchema = z.object({
  id: z.string().min(1).max(160),
  ownerUid: z.string().min(1).max(160),
  name: z.string().min(1).max(120),
  query: opportunityDiscoveryQuerySchema.omit({ cursor: true }),
  alertFrequency: opportunityAlertFrequencySchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SavedOpportunitySearch = z.infer<typeof savedOpportunitySearchSchema>;

export const recentOpportunitySearchSchema = z.object({
  id: z.string().min(1).max(160),
  ownerUid: z.string().min(1).max(160),
  label: z.string().min(1).max(240),
  query: opportunityDiscoveryQuerySchema.omit({ cursor: true }),
  normalizedVersion: z.literal(OPPORTUNITY_DISCOVERY_PROJECTION_VERSION),
  lastUsedAt: z.number().int().nonnegative(),
});
export type RecentOpportunitySearch = z.infer<
  typeof recentOpportunitySearchSchema
>;

export const opportunityAddendumSchema = z.object({
  id: z.string().min(1).max(160),
  rfxId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(5_000),
  materialChanges: z.array(z.string().min(1).max(1_000)).min(1).max(30),
  deadlineChanged: z.boolean(),
  previousDeadline: z.number().int().nonnegative().optional(),
  newDeadline: z.number().int().nonnegative().optional(),
  acknowledgmentRequired: z.boolean(),
  publishedAt: z.number().int().nonnegative(),
});
export type OpportunityAddendum = z.infer<typeof opportunityAddendumSchema>;

export const opportunityAddendumAcknowledgmentSchema = z.object({
  id: z.string().min(1).max(320),
  rfxId: z.string().min(1).max(160),
  addendumId: z.string().min(1).max(160),
  ownerUid: z.string().min(1).max(160),
  organizationId: z.string().min(1).max(160).optional(),
  acknowledgedAt: z.number().int().nonnegative(),
});
export type OpportunityAddendumAcknowledgment = z.infer<
  typeof opportunityAddendumAcknowledgmentSchema
>;

export const opportunityQuestionSchema = z.object({
  id: z.string().min(1).max(160),
  rfxId: z.string().min(1).max(160),
  question: z.string().min(5).max(3_000),
  answer: z.string().max(6_000).optional(),
  status: z.enum(["open", "answered", "dismissed"]),
  visibility: z.enum(["public", "private"]),
  submittedAt: z.number().int().nonnegative(),
  answeredAt: z.number().int().nonnegative().optional(),
  isMine: z.boolean(),
});
export type OpportunityQuestion = z.infer<typeof opportunityQuestionSchema>;

export const opportunityGovernanceSnapshotSchema = z.object({
  addenda: z.array(opportunityAddendumSchema).max(100),
  questions: z.array(opportunityQuestionSchema).max(200),
  questionDeadline: z.number().int().nonnegative().optional(),
  preBidMeeting: z.string().max(2_000).optional(),
  siteVisit: z.string().max(2_000).optional(),
  submissionInstructions: z.string().max(6_000).optional(),
  addendaTruncated: z.boolean(),
  questionsTruncated: z.boolean(),
  canManage: z.boolean(),
  canAsk: z.boolean(),
});
export type OpportunityGovernanceSnapshot = z.infer<
  typeof opportunityGovernanceSnapshotSchema
>;

export const opportunityPersonalizationContextSchema = z.object({
  uid: z.string().min(1).max(160),
  orgIds: z.array(z.string().min(1).max(160)).max(100),
  managerOrgIds: z.array(z.string().min(1).max(160)).max(100),
  naicsCodes: z.array(z.string().regex(/^\d{2,6}$/)).max(500),
  capabilities: z.array(z.string().min(1).max(120)).max(500),
  territoryFips: z.array(z.string().min(1).max(16)).max(500),
  verificationStatus: z.string().max(40).optional(),
});
export type OpportunityPersonalizationContext = z.infer<
  typeof opportunityPersonalizationContextSchema
>;

export function normalizeOpportunitySearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeOpportunitySearch(value: string): string[] {
  const normalized = normalizeOpportunitySearchText(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(" ").filter((token) => token.length > 1))];
}

export function haversineDistanceMiles(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitudeA))
      * Math.cos(radians(latitudeB))
      * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
