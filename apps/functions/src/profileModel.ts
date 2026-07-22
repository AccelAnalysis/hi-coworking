export const PROFILE_SCHEMA_VERSION = 4;

export function computeProfileCompleteness(profile: Record<string, unknown>): number {
  let score = 0;
  if (profile.displayName) score += 10;
  if (profile.professionalTitle) score += 5;
  if (profile.businessName) score += 15;
  if (profile.bio) score += 10;
  if (profile.website) score += 5;
  if (profile.linkedin) score += 5;
  if (profile.city || profile.state) score += 5;
  if (Array.isArray(profile.naicsCodes) && profile.naicsCodes.length > 0) score += 15;
  if (Array.isArray(profile.certifications) && profile.certifications.length > 0) score += 10;
  if (profile.uei) score += 10;
  if (profile.duns) score += 5;
  if (profile.cageCode) score += 5;
  if (profile.capabilityStatementStoragePath || profile.capabilityStatementUrl) score += 10;
  if (profile.photoStoragePath || profile.photoUrl) score += 5;
  return Math.min(100, score);
}

export function computeProfileReadiness(
  profile: Record<string, unknown>,
): "seat_ready" | "bid_ready" | "procurement_ready" {
  const bidReady = profile.verificationStatus === "verified"
    && Boolean(profile.capabilityStatementStoragePath || profile.capabilityStatementUrl);
  if (!bidReady) return "seat_ready";
  const procurementReady = Boolean(profile.enrichmentMatchId)
    && Number(profile.profileCompletenessScore ?? 0) >= 70
    && Boolean(profile.trustStats);
  return procurementReady ? "procurement_ready" : "bid_ready";
}

const CANONICAL_PROFILE_RESPONSE_FIELDS = [
  "uid",
  "displayName",
  "professionalTitle",
  "preferredPrivateEmail",
  "preferredPrivatePhone",
  "communicationPreferences",
  "accessibilityPreferences",
  "notificationPreferences",
  "preferredOrganizationId",
  "preferredEstablishmentId",
  "professionalContactPublication",
  "organizationOnboardingSuggestions",
  "enrichmentProposals",
  "businessName",
  "bio",
  "city",
  "state",
  "domain",
  "naicsCodes",
  "certifications",
  "uei",
  "duns",
  "cageCode",
  "capabilityStatementUrl",
  "capabilityStatementStoragePath",
  "photoUrl",
  "photoStoragePath",
  "website",
  "linkedin",
  "videoIntroUrl",
  "videoIntroStoragePath",
  "videoIntroPosterUrl",
  "videoIntroPosterStoragePath",
  "published",
  "profileCompletenessScore",
  "readinessTier",
  "profileSchemaVersion",
  "profileVersion",
  "verificationStatus",
  "enrichmentMatchId",
  "enrichmentSource",
  "enrichmentLinkedAt",
  "enrichmentFieldProvenance",
  "createdAt",
  "updatedAt",
] as const;

export function sanitizeCanonicalProfile(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of CANONICAL_PROFILE_RESPONSE_FIELDS) {
    if (profile[field] !== undefined) result[field] = profile[field];
  }
  return result;
}
