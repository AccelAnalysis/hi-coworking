import { z } from "zod";

export const EXCHANGE_ORGANIZATION_CONTEXT_VERSION = 1 as const;

export const exchangeOrganizationMembershipRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
]);
export type ExchangeOrganizationMembershipRole = z.infer<
  typeof exchangeOrganizationMembershipRoleSchema
>;

export const exchangeModeSchema = z.enum([
  "intelligence",
  "referrals",
  "opportunities",
  "resources",
]);
export type ExchangeMode = z.infer<typeof exchangeModeSchema>;

export const exchangeOrganizationContextTypeSchema = z.enum([
  "self",
  "managed",
  "external_claimed",
  "external_unclaimed",
  "resource_provider",
  "issuer",
  "unavailable",
]);
export type ExchangeOrganizationContextType = z.infer<
  typeof exchangeOrganizationContextTypeSchema
>;

export const exchangeOrganizationProjectionLevelSchema = z.enum([
  "private_owner",
  "private_admin",
  "private_member",
  "relationship_safe",
  "public_claimed",
  "public_seed",
  "resource_public",
  "unavailable",
]);
export type ExchangeOrganizationProjectionLevel = z.infer<
  typeof exchangeOrganizationProjectionLevelSchema
>;

export const exchangeOrganizationClaimedStatusSchema = z.enum([
  "claimed",
  "claim_pending",
  "unclaimed",
  "unavailable",
]);
export type ExchangeOrganizationClaimedStatus = z.infer<
  typeof exchangeOrganizationClaimedStatusSchema
>;

export const exchangeOrganizationResourceProviderStatusSchema = z.enum([
  "approved",
  "not_provider",
  "pending",
  "suspended",
  "rejected",
  "unavailable",
]);
export type ExchangeOrganizationResourceProviderStatus = z.infer<
  typeof exchangeOrganizationResourceProviderStatusSchema
>;

export const exchangeActorCapabilitySchema = z.enum([
  "view_exchange",
  "edit_profile",
  "respond_to_opportunities",
  "manage_referrals",
  "spend_credits",
  "purchase_credits",
  "manage_billing",
  "manage_members",
]);
export type ExchangeActorCapability = z.infer<typeof exchangeActorCapabilitySchema>;

export const exchangeOrganizationActionSchema = z.enum([
  "view_private_organization",
  "view_private_analytics",
  "edit_organization",
  "manage_members",
  "respond_to_opportunities",
  "save_organization",
  "unsave_organization",
  "request_contact",
  "request_introduction",
  "initiate_referral",
  "initiate_teaming",
  "request_claim",
  "view_public_opportunities",
  "view_public_resources",
]);
export type ExchangeOrganizationAction = z.infer<
  typeof exchangeOrganizationActionSchema
>;

export const exchangeViewerContextSchema = z.object({
  authenticated: z.boolean(),
  uid: z.string().min(1).nullable(),
  platformRole: z.string().min(1).nullable(),
}).strict();
export type ExchangeViewerContext = z.infer<typeof exchangeViewerContextSchema>;

export const exchangeActorContextSchema = z.object({
  organizationId: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  membershipRole: exchangeOrganizationMembershipRoleSchema.nullable(),
  capabilities: z.array(exchangeActorCapabilitySchema),
  valid: z.boolean(),
  fallbackApplied: z.boolean(),
}).strict();
export type ExchangeActorContext = z.infer<typeof exchangeActorContextSchema>;

export const exchangeSubjectContextSchema = z.object({
  organizationId: z.string().min(1),
  contextType: exchangeOrganizationContextTypeSchema,
  claimedStatus: exchangeOrganizationClaimedStatusSchema,
  resourceProviderStatus: z.enum([
    "approved",
    "not_provider",
    "unavailable",
  ]),
}).strict();
export type ExchangeSubjectContext = z.infer<typeof exchangeSubjectContextSchema>;

export const exchangeSecondaryContextSchema = z.object({
  type: z.enum([
    "opportunity",
    "referral",
    "resource",
    "territory",
    "team",
    "organization",
  ]),
  id: z.string().trim().min(1).max(200),
}).strict();
export type ExchangeSecondaryContext = z.infer<
  typeof exchangeSecondaryContextSchema
>;

export const exchangeModeStateSchema = z.object({
  mode: exchangeModeSchema,
  secondary: exchangeSecondaryContextSchema.optional(),
  searchText: z.string().max(300).default(""),
  filters: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type ExchangeModeState = z.infer<typeof exchangeModeStateSchema>;

export const exchangeMapBoundsSchema = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
}).strict();
export type ExchangeMapBounds = z.infer<typeof exchangeMapBoundsSchema>;

export const exchangeWorkspaceContextSchema = z.object({
  contractVersion: z.literal(EXCHANGE_ORGANIZATION_CONTEXT_VERSION),
  viewer: exchangeViewerContextSchema,
  actor: exchangeActorContextSchema,
  subject: exchangeSubjectContextSchema.nullable(),
  secondary: exchangeSecondaryContextSchema.optional(),
  activeMode: exchangeModeSchema,
  workspaceSearchText: z.string().max(300).default(""),
  selectedLocality: z.string().max(200).nullable().default(null),
  searchGeography: z.string().max(200).nullable().default(null),
  radiusMiles: z.number().positive().max(500).nullable().default(null),
  mapBounds: exchangeMapBoundsSchema.nullable().default(null),
  mapCamera: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    zoom: z.number().min(0).max(24),
    pitch: z.number().min(0).max(85),
    bearing: z.number().min(-360).max(360),
  }).strict().nullable().default(null),
  openPanel: z.string().max(100).nullable().default(null),
  priorRoute: z.string().max(1_000).nullable().default(null),
}).strict();
export type ExchangeWorkspaceContext = z.infer<
  typeof exchangeWorkspaceContextSchema
>;

export const exchangeRelationshipContextSchema = z.object({
  exists: z.boolean(),
  type: z.enum(["none", "undisclosed", "established", "trusted"]),
  disclosureLevel: z.enum(["none", "indicator", "relationship_safe"]),
  trustedIntroductionMayBeAvailable: z.boolean(),
}).strict();
export type ExchangeRelationshipContext = z.infer<
  typeof exchangeRelationshipContextSchema
>;

export const exchangePublicOrganizationProjectionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  name: z.string(),
  normalizedName: z.string(),
  slug: z.string(),
  city: z.string(),
  county: z.string(),
  state: z.string(),
  territoryFips: z.string(),
  claimStatus: z.enum(["unclaimed", "claim_pending", "claimed"]),
  verificationStatus: z.string(),
  organizationType: z.string(),
  industries: z.array(z.string()),
  description: z.string(),
  website: z.string(),
  naicsCodes: z.array(z.string()),
  capabilityKeywords: z.array(z.string()),
  certifications: z.array(z.string()),
  searchTokens: z.array(z.string()),
  resourceProviderStatus: z.enum(["approved", "not_provider"]),
  resourceCategories: z.array(z.string()),
  issuerStatus: z.enum(["approved", "not_issuer"]),
  acceptsReferrals: z.boolean(),
  publicContactAvailable: z.boolean(),
  status: z.literal("active"),
  publicationApproved: z.literal(true),
  updatedAt: z.number(),
  addressLine1: z.string().optional(),
  postalCode: z.string().optional(),
  addressPublicationApproved: z.literal(true).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geohash: z.string().optional(),
  coordinateConfidence: z.enum(["authoritative", "verified", "approximate"]).optional(),
  coordinatePublicationApproved: z.literal(true).optional(),
}).strict();
export type ExchangePublicOrganizationProjection = z.infer<
  typeof exchangePublicOrganizationProjectionSchema
>;

export const exchangeOrganizationProjectionSchema = exchangePublicOrganizationProjectionSchema
  .partial()
  .extend({
    id: z.string().min(1),
    name: z.string(),
    projectionLevel: exchangeOrganizationProjectionLevelSchema,
    status: z.string(),
    addressLine2: z.string().optional(),
    homeBased: z.boolean().optional(),
    privacySuppressed: z.boolean().optional(),
    ownerUid: z.string().optional(),
    billingEmail: z.string().optional(),
    internalCapabilityGaps: z.array(z.string()).optional(),
    readinessTier: z.string().optional(),
  })
  .strict();
export type ExchangeOrganizationProjection = z.infer<
  typeof exchangeOrganizationProjectionSchema
>;

export const exchangeOrganizationPerspectiveSchema = z.object({
  contractVersion: z.literal(EXCHANGE_ORGANIZATION_CONTEXT_VERSION),
  viewer: exchangeViewerContextSchema,
  actor: exchangeActorContextSchema,
  subject: exchangeSubjectContextSchema,
  relationship: exchangeRelationshipContextSchema,
  perspective: z.object({
    mode: exchangeModeSchema,
    projectionLevel: exchangeOrganizationProjectionLevelSchema,
    allowedActions: z.array(exchangeOrganizationActionSchema),
    isModeResultEligible: z.boolean(),
    contextMarkerOnly: z.boolean(),
    heading: z.string(),
  }).strict(),
  secondary: exchangeSecondaryContextSchema.optional(),
  organization: exchangeOrganizationProjectionSchema.nullable(),
  saved: z.boolean(),
}).strict();
export type ExchangeOrganizationPerspective = z.infer<
  typeof exchangeOrganizationPerspectiveSchema
>;
