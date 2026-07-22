export const LEGACY_PROFILE_ORGANIZATION_FIELDS = [
  "businessName", "city", "state", "domain", "naicsCodes", "certifications",
  "uei", "duns", "cageCode", "website",
] as const;

/**
 * Converts UID-owned compatibility fields into non-authoritative organization
 * suggestions. It never reads or mutates an organization record.
 */
export function mergeOrganizationOnboardingSuggestions(
  previous: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const suggestions: Record<string, unknown> = previous.organizationOnboardingSuggestions
    && typeof previous.organizationOnboardingSuggestions === "object"
    && !Array.isArray(previous.organizationOnboardingSuggestions)
    ? { ...previous.organizationOnboardingSuggestions as Record<string, unknown> }
    : {};
  for (const field of LEGACY_PROFILE_ORGANIZATION_FIELDS) {
    if (input[field] !== undefined && input[field] !== null) suggestions[field] = input[field];
  }
  return suggestions;
}
