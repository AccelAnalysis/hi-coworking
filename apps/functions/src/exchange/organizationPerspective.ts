import type {
  ExchangeActorCapability,
  ExchangeMode,
  ExchangeOrganizationAction,
  ExchangeOrganizationContextType,
  ExchangeOrganizationMembershipRole,
  ExchangeOrganizationProjectionLevel,
} from "@hi/shared";
import { sanitizePublicOrganization } from "./organizationModel";

type RecordData = Record<string, unknown>;

const OWNER_CAPABILITIES: ExchangeActorCapability[] = [
  "view_exchange",
  "edit_profile",
  "respond_to_opportunities",
  "manage_referrals",
  "spend_credits",
  "purchase_credits",
  "manage_billing",
  "manage_members",
];

const MEMBER_CAPABILITIES: ExchangeActorCapability[] = [
  "view_exchange",
  "edit_profile",
  "respond_to_opportunities",
  "manage_referrals",
];

export function actorCapabilitiesForRole(
  role: ExchangeOrganizationMembershipRole,
  explicit: unknown,
): ExchangeActorCapability[] {
  const permitted = role === "owner" || role === "admin"
    ? OWNER_CAPABILITIES
    : MEMBER_CAPABILITIES;
  if (!Array.isArray(explicit)) return [...permitted];
  const explicitSet = new Set(explicit.filter((value): value is string => typeof value === "string"));
  const selected = permitted.filter((capability) => explicitSet.has(capability));
  return selected.length ? selected : [...permitted];
}

function text(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function stringList(value: unknown, max = 50): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 160)).slice(0, max)
    : [];
}

function claimStatus(value: unknown): "claimed" | "claim_pending" | "unclaimed" {
  return value === "claimed" || value === "claim_pending" ? value : "unclaimed";
}

/**
 * Final public response allowlist. Calling this on an Admin SDK record is safe:
 * unapproved, inactive, and suppressed publication state fails closed.
 */
export function projectApprovedPublicOrganization(
  organizationId: string,
  source: RecordData,
): RecordData | null {
  const sanitized = sanitizePublicOrganization(organizationId, source);
  if (sanitized.status !== "active" || sanitized.publicationApproved !== true) return null;
  const projection: RecordData = {
    id: organizationId,
    schemaVersion: Number(sanitized.schemaVersion || 2),
    name: text(sanitized.name, 200) ?? "Organization",
    normalizedName: text(sanitized.normalizedName, 200) ?? "",
    slug: text(sanitized.slug, 100) ?? "",
    city: text(sanitized.city, 100) ?? "",
    county: text(sanitized.county, 100) ?? "",
    state: text(sanitized.state, 40) ?? "",
    territoryFips: text(sanitized.territoryFips, 12) ?? "",
    claimStatus: claimStatus(sanitized.claimStatus),
    verificationStatus: text(sanitized.verificationStatus, 40) ?? "unverified",
    organizationType: text(sanitized.organizationType, 100) ?? "",
    industries: stringList(sanitized.industries),
    description: text(sanitized.description, 2_000) ?? "",
    website: text(sanitized.website, 500) ?? "",
    naicsCodes: stringList(sanitized.naicsCodes),
    capabilityKeywords: stringList(sanitized.capabilityKeywords),
    certifications: stringList(sanitized.certifications),
    searchTokens: stringList(sanitized.searchTokens),
    resourceProviderStatus: sanitized.resourceProviderStatus === "approved" ? "approved" : "not_provider",
    resourceCategories: sanitized.resourceProviderStatus === "approved"
      ? stringList(sanitized.resourceCategories)
      : [],
    issuerStatus: sanitized.issuerStatus === "approved" ? "approved" : "not_issuer",
    acceptsReferrals: sanitized.acceptsReferrals === true,
    publicContactAvailable: sanitized.publicContactAvailable === true,
    publicLocationCount: typeof sanitized.publicLocationCount === "number" ? sanitized.publicLocationCount : 0,
    status: "active",
    publicationApproved: true,
    updatedAt: typeof sanitized.updatedAt === "number" ? sanitized.updatedAt : 0,
  };
  if (sanitized.primaryPublicLocation && typeof sanitized.primaryPublicLocation === "object") {
    projection.primaryPublicLocation = sanitized.primaryPublicLocation;
  }
  if (sanitized.addressPublicationApproved === true) {
    if (text(sanitized.addressLine1, 300)) projection.addressLine1 = text(sanitized.addressLine1, 300);
    if (text(sanitized.postalCode, 20)) projection.postalCode = text(sanitized.postalCode, 20);
    if (projection.addressLine1 || projection.postalCode) projection.addressPublicationApproved = true;
  }
  if (
    sanitized.coordinatePublicationApproved === true
    && typeof sanitized.latitude === "number"
    && Number.isFinite(sanitized.latitude)
    && typeof sanitized.longitude === "number"
    && Number.isFinite(sanitized.longitude)
  ) {
    projection.latitude = sanitized.latitude;
    projection.longitude = sanitized.longitude;
    projection.coordinatePublicationApproved = true;
    if (text(sanitized.geohash, 100)) projection.geohash = text(sanitized.geohash, 100);
    if (["authoritative", "verified", "approximate"].includes(String(sanitized.coordinateConfidence))) {
      projection.coordinateConfidence = sanitized.coordinateConfidence;
    }
  }
  return projection;
}

function privateBase(organizationId: string, source: RecordData): RecordData {
  const approved = projectApprovedPublicOrganization(organizationId, source);
  return approved ?? {
    id: organizationId,
    schemaVersion: Number(source.schemaVersion || 2),
    name: text(source.name, 200) ?? "Organization",
    normalizedName: text(source.normalizedName, 200) ?? "",
    slug: text(source.slug, 100) ?? "",
    city: text(source.city, 100) ?? "",
    county: text(source.county, 100) ?? "",
    state: text(source.state, 40) ?? "",
    territoryFips: text(source.territoryFips, 12) ?? "",
    claimStatus: claimStatus(source.claimStatus),
    verificationStatus: text(source.verificationStatus, 40) ?? "unverified",
    organizationType: text(source.organizationType, 100) ?? "",
    industries: stringList(source.industries ?? source.industryLabels),
    description: text(source.description, 2_000) ?? "",
    website: text(source.website, 500) ?? "",
    naicsCodes: stringList(source.naicsCodes),
    capabilityKeywords: stringList(source.capabilityKeywords),
    certifications: stringList(source.certifications),
    searchTokens: stringList(source.searchTokens),
    resourceProviderStatus: source.resourceProviderStatus === "approved" ? "approved" : "not_provider",
    resourceCategories: source.resourceProviderStatus === "approved" ? stringList(source.resourceCategories) : [],
    issuerStatus: source.issuerStatus === "approved" ? "approved" : "not_issuer",
    acceptsReferrals: source.acceptsReferrals === true,
    publicContactAvailable: source.publicContactAvailable === true || Boolean(text(source.website, 500)),
    publicLocationCount: typeof source.publicLocationCount === "number" ? source.publicLocationCount : 0,
    status: text(source.status, 40) ?? "inactive",
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : 0,
  };
}

/** Final role-bounded private response allowlist. */
export function projectPrivateOrganization(
  organizationId: string,
  source: RecordData,
  role: ExchangeOrganizationMembershipRole,
): RecordData {
  const projectionLevel = `private_${role}` as ExchangeOrganizationProjectionLevel;
  const projection: RecordData = {
    ...privateBase(organizationId, source),
    projectionLevel,
    homeBased: source.homeBased === true,
    privacySuppressed: source.homeBased === true || source.privacySuppressed === true,
    internalCapabilityGaps: stringList(source.internalCapabilityGaps, 100),
  };
  if (text(source.readinessTier, 80)) projection.readinessTier = text(source.readinessTier, 80);
  if (role === "owner" || role === "admin") {
    if (text(source.addressLine1 ?? source.address, 300)) {
      projection.addressLine1 = text(source.addressLine1 ?? source.address, 300);
    }
    if (text(source.addressLine2, 300)) projection.addressLine2 = text(source.addressLine2, 300);
    if (text(source.postalCode, 20)) projection.postalCode = text(source.postalCode, 20);
    if (text(source.billingEmail, 320)) projection.billingEmail = text(source.billingEmail, 320);
  }
  if (role === "owner" && text(source.ownerUid, 200)) {
    projection.ownerUid = text(source.ownerUid, 200);
  }
  return projection;
}

export interface PerspectiveModelInput {
  actorValid: boolean;
  actorOrganizationId: string | null;
  actorName: string | null;
  actorMembershipRole: ExchangeOrganizationMembershipRole | null;
  subjectOrganizationId: string;
  subjectName: string;
  subjectAvailable: boolean;
  subjectMembershipRole: ExchangeOrganizationMembershipRole | null;
  subjectClaimStatus: "claimed" | "claim_pending" | "unclaimed";
  subjectResourceProviderApproved: boolean;
  subjectIssuerApproved: boolean;
  relationshipExists: boolean;
  relationshipDisclosurePermitted: boolean;
  relationshipTrusted: boolean;
  saved: boolean;
  mode: ExchangeMode;
}

export interface PerspectiveModelResult {
  contextType: ExchangeOrganizationContextType;
  projectionLevel: ExchangeOrganizationProjectionLevel;
  allowedActions: ExchangeOrganizationAction[];
  isModeResultEligible: boolean;
  contextMarkerOnly: boolean;
  heading: string;
}

export function resolveOrganizationPerspectiveModel(
  input: PerspectiveModelInput,
): PerspectiveModelResult {
  if (!input.subjectAvailable) {
    return {
      contextType: "unavailable",
      projectionLevel: "unavailable",
      allowedActions: [],
      isModeResultEligible: false,
      contextMarkerOnly: false,
      heading: "Organization unavailable",
    };
  }

  const self = input.actorValid && input.actorOrganizationId === input.subjectOrganizationId;
  const managed = !self
    && (input.subjectMembershipRole === "owner" || input.subjectMembershipRole === "admin");
  let contextType: ExchangeOrganizationContextType;
  if (self) contextType = "self";
  else if (managed) contextType = "managed";
  else if (input.subjectResourceProviderApproved) contextType = "resource_provider";
  else if (input.subjectIssuerApproved) contextType = "issuer";
  else if (input.subjectClaimStatus === "claimed") contextType = "external_claimed";
  else contextType = "external_unclaimed";

  let projectionLevel: ExchangeOrganizationProjectionLevel;
  const privateRole = self ? input.actorMembershipRole : input.subjectMembershipRole;
  if ((self || managed) && privateRole) projectionLevel = `private_${privateRole}`;
  else if (contextType === "resource_provider") projectionLevel = "resource_public";
  else if (input.relationshipExists && input.relationshipDisclosurePermitted) projectionLevel = "relationship_safe";
  else if (input.subjectClaimStatus === "claimed" || contextType === "issuer") projectionLevel = "public_claimed";
  else projectionLevel = "public_seed";

  const allowedActions: ExchangeOrganizationAction[] = [];
  if (self || managed) {
    allowedActions.push("view_private_organization", "view_private_analytics");
    if (privateRole === "owner" || privateRole === "admin") {
      allowedActions.push("edit_organization", "manage_members");
    }
    if (input.mode === "opportunities") allowedActions.push("respond_to_opportunities");
  } else {
    if (input.actorValid) allowedActions.push(input.saved ? "unsave_organization" : "save_organization");
    if (input.subjectClaimStatus === "unclaimed") allowedActions.push("request_claim");
    if (input.actorValid && input.subjectClaimStatus === "claimed") {
      allowedActions.push("request_contact");
      if (input.mode === "referrals") {
        allowedActions.push("initiate_referral", "request_introduction");
      }
      if (input.mode === "opportunities") {
        allowedActions.push("initiate_teaming", "view_public_opportunities");
      }
    }
    if (input.mode === "resources" && input.subjectResourceProviderApproved) {
      allowedActions.push("view_public_resources");
    }
  }

  const resourceContextOnly = input.mode === "resources" && !input.subjectResourceProviderApproved;
  let heading = input.subjectName;
  if (input.actorValid && input.actorName && !self) {
    if (input.mode === "opportunities") {
      heading = `Opportunities for ${input.actorName} related to ${input.subjectName}.`;
    } else if (input.mode === "resources") {
      heading = `Resources for ${input.actorName} near or relevant to ${input.subjectName}.`;
    }
  }
  return {
    contextType,
    projectionLevel,
    allowedActions: [...new Set(allowedActions)],
    isModeResultEligible: !resourceContextOnly,
    contextMarkerOnly: resourceContextOnly,
    heading,
  };
}
