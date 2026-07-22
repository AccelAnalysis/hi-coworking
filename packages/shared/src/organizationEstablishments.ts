import { z } from "zod";

export const ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION = 1 as const;

const identifierSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const epochMillisSchema = z.number().int().nonnegative();

export const personCommunicationPreferencesSchema = z.object({
  inApp: z.boolean().default(true),
  email: z.boolean().default(true),
  sms: z.boolean().default(false),
  quietHoursStart: optionalText(5),
  quietHoursEnd: optionalText(5),
  timezone: optionalText(80),
}).strict();

export const personAccessibilityPreferencesSchema = z.object({
  reducedMotion: z.boolean().default(false),
  highContrast: z.boolean().default(false),
  mapAlternativePreferred: z.boolean().default(false),
}).strict();

export const personNotificationPreferencesSchema = z.object({
  referrals: z.boolean().default(true),
  opportunities: z.boolean().default(true),
  introductions: z.boolean().default(true),
  organizationAdministration: z.boolean().default(true),
}).strict();

export const personProfessionalContactPublicationSchema = z.object({
  email: z.boolean().default(false),
  phone: z.boolean().default(false),
  title: z.boolean().default(true),
}).strict();

export const personProfileV2Schema = z.object({
  uid: identifierSchema,
  displayName: optionalText(160),
  professionalTitle: optionalText(160),
  preferredPrivateEmail: z.string().trim().email().max(320).optional(),
  preferredPrivatePhone: optionalText(40),
  communicationPreferences: personCommunicationPreferencesSchema.optional(),
  accessibilityPreferences: personAccessibilityPreferencesSchema.optional(),
  notificationPreferences: personNotificationPreferencesSchema.optional(),
  preferredOrganizationId: identifierSchema.optional(),
  preferredEstablishmentId: identifierSchema.optional(),
  professionalContactPublication: personProfessionalContactPublicationSchema.optional(),
  organizationOnboardingSuggestions: z.record(z.string(), z.unknown()).optional(),
  schemaVersion: z.literal(2),
  version: z.number().int().nonnegative(),
  createdAt: epochMillisSchema,
  updatedAt: epochMillisSchema.optional(),
}).strict().superRefine((person, context) => {
  if (person.preferredEstablishmentId && !person.preferredOrganizationId) {
    context.addIssue({
      code: "custom",
      path: ["preferredEstablishmentId"],
      message: "A preferred establishment requires a preferred organization",
    });
  }
});

export const organizationAddressSchema = z.object({
  line1: requiredText(240),
  line2: optionalText(240),
  locality: requiredText(120),
  administrativeArea: requiredText(120),
  postalCode: optionalText(32),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  county: optionalText(120),
}).strict();

export const organizationLocationTypeSchema = z.enum([
  "headquarters",
  "branch",
  "office",
  "retail",
  "production",
  "warehouse",
  "service_location",
  "coworking",
  "virtual",
  "mailing_only",
  "other",
]);

export const geocodeSourceSchema = z.enum([
  "owner_confirmed",
  "enrichment_proposed",
  "seed_reviewed",
  "administrator_confirmed",
  "migrated_legacy",
]);

export const geocodePrecisionSchema = z.enum([
  "rooftop",
  "parcel",
  "address",
  "street",
  "postal_code",
  "locality",
  "county",
  "region",
  "unknown",
]);

export const geocodeConfidenceSchema = z.enum(["high", "medium", "low", "unknown"]);

export const organizationGeocodeSchema = z.object({
  provider: requiredText(60),
  providerPlaceId: optionalText(240),
  normalizedAddress: requiredText(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geohash: optionalText(24),
  precision: geocodePrecisionSchema,
  confidence: geocodeConfidenceSchema,
  source: geocodeSourceSchema,
  geocodedAt: epochMillisSchema,
  confirmedByUid: identifierSchema,
  confirmedAt: epochMillisSchema,
}).strict().superRefine((geocode, context) => {
  if (geocode.latitude === 0 && geocode.longitude === 0) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Zero/zero is not a valid confirmed coordinate" });
  }
});

export const organizationServiceAreaSchema = z.object({
  city: optionalText(120),
  county: optionalText(120),
  region: optionalText(120),
  countryCode: z.string().trim().length(2).optional(),
  territoryFips: optionalText(12),
}).strict();

export const organizationEstablishmentSchema = z.object({
  id: identifierSchema,
  organizationId: identifierSchema,
  name: requiredText(160),
  locationType: organizationLocationTypeSchema,
  isHeadquarters: z.boolean(),
  isPrimary: z.boolean(),
  status: z.enum(["active", "inactive", "historical"]),
  physicalAddress: organizationAddressSchema.optional(),
  mailingAddress: organizationAddressSchema.optional(),
  addressPublicationApproved: z.boolean(),
  coordinatePublicationApproved: z.boolean(),
  geocode: organizationGeocodeSchema.optional(),
  serviceArea: organizationServiceAreaSchema.optional(),
  operatingHours: z.record(z.string(), z.string().trim().max(120)).optional(),
  publicContactAvailable: z.boolean(),
  privateHome: z.boolean().default(false),
  createdBy: identifierSchema,
  createdAt: epochMillisSchema,
  updatedAt: epochMillisSchema,
  version: z.literal(ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION),
  recordVersion: z.number().int().positive(),
}).strict().superRefine((location, context) => {
  const markerExcluded = location.locationType === "mailing_only" || location.locationType === "virtual";
  if (!markerExcluded && location.status === "active" && !location.physicalAddress) {
    context.addIssue({ code: "custom", path: ["physicalAddress"], message: "An active physical establishment requires a physical address" });
  }
  if (location.locationType === "mailing_only" && location.isPrimary) {
    context.addIssue({ code: "custom", path: ["isPrimary"], message: "A mailing-only location cannot be primary" });
  }
  if (markerExcluded && location.coordinatePublicationApproved) {
    context.addIssue({ code: "custom", path: ["coordinatePublicationApproved"], message: "Virtual and mailing-only locations cannot publish map coordinates" });
  }
  if (location.coordinatePublicationApproved && !location.geocode) {
    context.addIssue({ code: "custom", path: ["geocode"], message: "Coordinate publication requires a confirmed geocode" });
  }
  if (location.privateHome && (location.addressPublicationApproved || location.coordinatePublicationApproved)) {
    context.addIssue({ code: "custom", path: ["privateHome"], message: "A private home location cannot publish its address or exact coordinate" });
  }
  if (location.isHeadquarters && location.locationType === "mailing_only") {
    context.addIssue({ code: "custom", path: ["isHeadquarters"], message: "A mailing-only location cannot be headquarters" });
  }
});

export const publicOrganizationEstablishmentSchema = z.object({
  id: identifierSchema,
  organizationId: identifierSchema,
  name: requiredText(160),
  locationType: organizationLocationTypeSchema,
  isHeadquarters: z.boolean(),
  isPrimary: z.boolean(),
  city: optionalText(120),
  county: optionalText(120),
  administrativeArea: optionalText(120),
  countryCode: optionalText(2),
  addressLine1: optionalText(240),
  postalCode: optionalText(32),
  addressPublicationApproved: z.boolean(),
  coordinatePublicationApproved: z.boolean(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geohash: optionalText(24),
  coordinatePrecision: geocodePrecisionSchema.optional(),
  publicContactAvailable: z.boolean(),
  version: z.literal(ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION),
  updatedAt: epochMillisSchema,
}).strict().superRefine((location, context) => {
  if (location.coordinatePublicationApproved && (location.latitude === undefined || location.longitude === undefined)) {
    context.addIssue({ code: "custom", path: ["coordinatePublicationApproved"], message: "Published coordinates must be complete" });
  }
  if (!location.coordinatePublicationApproved && (location.latitude !== undefined || location.longitude !== undefined || location.geohash !== undefined)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Unpublished coordinates cannot appear in a public projection" });
  }
  if (!location.addressPublicationApproved && (location.addressLine1 !== undefined || location.postalCode !== undefined)) {
    context.addIssue({ code: "custom", path: ["addressLine1"], message: "Unpublished street data cannot appear in a public projection" });
  }
});

export const organizationContactTypeSchema = z.enum([
  "email",
  "phone",
  "website",
  "contact_form",
  "member_route",
]);

export const organizationContactPurposeSchema = z.enum([
  "general",
  "referrals",
  "opportunities",
  "rfx_responses",
  "teaming",
  "resource_inquiries",
  "billing",
  "location_inquiries",
  "administration",
]);

export const organizationContactVisibilitySchema = z.enum([
  "private_operational",
  "organization_members",
  "relationship_safe",
  "public",
]);

export const organizationContactPointSchema = z.object({
  id: identifierSchema,
  organizationId: identifierSchema,
  locationId: identifierSchema.optional(),
  type: organizationContactTypeSchema,
  purposes: z.array(organizationContactPurposeSchema).min(1).max(9),
  normalizedValue: requiredText(500),
  displayValue: optionalText(500),
  verificationStatus: z.enum(["unverified", "pending", "verified", "failed"]),
  visibility: organizationContactVisibilitySchema,
  publicationStatus: z.enum(["draft", "approved", "suppressed"]),
  consentAuthorityBasis: requiredText(500),
  status: z.enum(["active", "inactive", "historical"]),
  createdBy: identifierSchema,
  createdAt: epochMillisSchema,
  updatedAt: epochMillisSchema,
  version: z.literal(ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION),
  recordVersion: z.number().int().positive(),
}).strict().superRefine((contact, context) => {
  if (contact.purposes.includes("billing") && contact.visibility === "public") {
    context.addIssue({ code: "custom", path: ["visibility"], message: "Billing contact points cannot be public" });
  }
  if (contact.publicationStatus === "approved" && contact.visibility !== "public") {
    context.addIssue({ code: "custom", path: ["publicationStatus"], message: "Only public contact points may be publication-approved" });
  }
});

export const publicOrganizationContactPointSchema = z.object({
  id: identifierSchema,
  organizationId: identifierSchema,
  locationId: identifierSchema.optional(),
  type: z.enum(["email", "phone", "website", "contact_form"]),
  purposes: z.array(organizationContactPurposeSchema).min(1).max(9),
  displayValue: requiredText(500),
  visibility: z.literal("public"),
  publicationStatus: z.literal("approved"),
  status: z.literal("active"),
  version: z.literal(ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION),
  updatedAt: epochMillisSchema,
}).strict();

export const organizationCommunicationRouteSchema = z.object({
  id: identifierSchema,
  organizationId: identifierSchema,
  locationId: identifierSchema.optional(),
  purpose: organizationContactPurposeSchema,
  primaryContactPointIds: z.array(identifierSchema).max(20),
  fallbackContactPointIds: z.array(identifierSchema).max(20),
  fallbackMemberRoles: z.array(z.enum(["owner", "admin", "referral_manager", "response_team"])).max(8),
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  phoneEnabled: z.boolean(),
  status: z.enum(["active", "inactive"]),
  createdBy: identifierSchema,
  createdAt: epochMillisSchema,
  updatedAt: epochMillisSchema,
  version: z.literal(ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION),
  recordVersion: z.number().int().positive(),
}).strict().superRefine((route, context) => {
  if (!route.inAppEnabled && !route.emailEnabled && !route.phoneEnabled) {
    context.addIssue({ code: "custom", path: ["inAppEnabled"], message: "At least one delivery channel must be enabled" });
  }
});

export const communicationRouteResolutionSchema = z.object({
  organizationId: identifierSchema,
  locationId: identifierSchema.optional(),
  purpose: organizationContactPurposeSchema,
  selectedRouteId: identifierSchema.optional(),
  deliveryChannelTypes: z.array(z.enum(["in_app", "email", "phone"])).min(1).max(3),
  publicDisclosureLevel: z.enum(["none", "relationship_safe", "public"]),
  fallbackUsed: z.enum(["none", "organization_route", "member_role", "owner_admin", "in_app"]),
  auditRequestId: identifierSchema,
}).strict();

export const organizationMediaSchema = z.object({
  id: identifierSchema,
  kind: z.enum(["logo", "image", "video"]),
  label: requiredText(160),
  publicUrl: z.string().url().max(2_000).optional(),
  storagePath: z.string().trim().min(1).max(1_024).optional(),
  publicationStatus: z.enum(["draft", "approved", "suppressed"]),
}).strict().superRefine((media, context) => {
  if (!media.publicUrl && !media.storagePath) {
    context.addIssue({ code: "custom", path: ["storagePath"], message: "Organization media requires a URL or storage path" });
  }
});

export const organizationDocumentSchema = z.object({
  id: identifierSchema,
  kind: z.enum(["capability_statement", "certification", "registration", "other"]),
  label: requiredText(160),
  storagePath: z.string().trim().min(1).max(1_024),
  publicationStatus: z.enum(["draft", "approved", "suppressed"]),
}).strict();

export const organizationProfileV3Schema = z.object({
  id: identifierSchema,
  legalName: requiredText(200),
  tradeNames: z.array(requiredText(200)).max(20),
  identifiers: z.record(z.string().trim().max(60), z.string().trim().max(240)),
  description: optionalText(4_000),
  domain: optionalText(253),
  website: z.string().url().max(500).optional(),
  industries: z.array(requiredText(160)).max(50),
  capabilities: z.array(requiredText(240)).max(100),
  certifications: z.array(requiredText(160)).max(100),
  media: z.array(organizationMediaSchema).max(100),
  documents: z.array(organizationDocumentSchema).max(100),
  publicationStatus: z.enum(["draft", "approved", "suppressed"]),
  primaryLocationId: identifierSchema.optional(),
  headquartersLocationId: identifierSchema.optional(),
  defaultGeneralRouteId: identifierSchema.optional(),
  defaultReferralRouteId: identifierSchema.optional(),
  defaultOpportunityRouteId: identifierSchema.optional(),
  defaultBillingRouteId: identifierSchema.optional(),
  claimStatus: z.enum(["unclaimed", "claim_pending", "claimed"]),
  verificationStatus: z.enum(["unverified", "pending", "verified", "rejected"]),
  version: z.literal(3),
  recordVersion: z.number().int().positive(),
}).strict();

export type PersonProfileV2 = z.infer<typeof personProfileV2Schema>;
export type OrganizationAddress = z.infer<typeof organizationAddressSchema>;
export type OrganizationGeocode = z.infer<typeof organizationGeocodeSchema>;
export type OrganizationEstablishment = z.infer<typeof organizationEstablishmentSchema>;
export type PublicOrganizationEstablishment = z.infer<typeof publicOrganizationEstablishmentSchema>;
export type OrganizationContactPoint = z.infer<typeof organizationContactPointSchema>;
export type PublicOrganizationContactPoint = z.infer<typeof publicOrganizationContactPointSchema>;
export type OrganizationCommunicationRoute = z.infer<typeof organizationCommunicationRouteSchema>;
export type OrganizationContactPurpose = z.infer<typeof organizationContactPurposeSchema>;
export type CommunicationRouteResolution = z.infer<typeof communicationRouteResolutionSchema>;
export type OrganizationProfileV3 = z.infer<typeof organizationProfileV3Schema>;
export type OrganizationMedia = z.infer<typeof organizationMediaSchema>;
export type OrganizationDocument = z.infer<typeof organizationDocumentSchema>;

export function assertOrganizationLocationInvariants(
  locations: readonly Pick<OrganizationEstablishment, "id" | "status" | "isPrimary" | "isHeadquarters" | "locationType">[],
): void {
  const active = locations.filter((location) => location.status === "active");
  const primaries = active.filter((location) => location.isPrimary);
  if (active.length > 0 && primaries.length !== 1) {
    throw new Error("Exactly one active establishment must be primary");
  }
  if (active.filter((location) => location.isHeadquarters).length > 1) {
    throw new Error("At most one active establishment may be headquarters");
  }
}

export function normalizeContactValue(type: z.infer<typeof organizationContactTypeSchema>, value: string): string {
  const trimmed = value.trim();
  if (type === "email") return trimmed.toLowerCase();
  if (type === "phone") {
    const leadingPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) throw new Error("Phone number must contain 7 to 15 digits");
    return `${leadingPlus ? "+" : ""}${digits}`;
  }
  if (type === "website" || type === "contact_form") {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Contact URL must use HTTP or HTTPS");
    return url.toString();
  }
  return trimmed;
}
