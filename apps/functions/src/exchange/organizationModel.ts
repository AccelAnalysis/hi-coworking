import { createHash } from "node:crypto";

export const ORGANIZATION_SCHEMA_VERSION = 2;

export function normalizeOrganizationName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|corporation|company|limited|inc|corp|co|llc|ltd|pllc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeWebsiteDomain(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function createSearchTokens(name: string): string[] {
  const normalized = normalizeOrganizationName(name);
  return [...new Set(normalized.split(" ").filter((token) => token.length >= 2))].slice(0, 20);
}

export function scoreOrganizationMatch(
  input: { name: string; city?: string; state?: string; website?: string; sourceIds?: Record<string, string> },
  candidate: { name: string; city?: string; state?: string; website?: string; websiteDomain?: string; sourceIds?: Record<string, string> }
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const inputName = normalizeOrganizationName(input.name);
  const candidateName = normalizeOrganizationName(candidate.name);

  if (inputName && inputName === candidateName) {
    score += 65;
    reasons.push("same normalized name");
  } else if (inputName && candidateName && (inputName.includes(candidateName) || candidateName.includes(inputName))) {
    score += 35;
    reasons.push("similar name");
  }

  if (input.city && candidate.city && input.city.trim().toLowerCase() === candidate.city.trim().toLowerCase()) {
    score += 12;
    reasons.push("same city");
  }
  if (input.state && candidate.state && input.state.trim().toLowerCase() === candidate.state.trim().toLowerCase()) {
    score += 8;
    reasons.push("same state");
  }

  const inputDomain = normalizeWebsiteDomain(input.website);
  const candidateDomain = candidate.websiteDomain || normalizeWebsiteDomain(candidate.website);
  if (inputDomain && candidateDomain && inputDomain === candidateDomain) {
    score += 30;
    reasons.push("same website domain");
  }

  for (const [system, identifier] of Object.entries(input.sourceIds || {})) {
    if (identifier && candidate.sourceIds?.[system] === identifier) {
      score += 100;
      reasons.push(`same ${system} identifier`);
      break;
    }
  }

  return { score: Math.min(score, 100), reasons };
}

export function deterministicOrganizationId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 28)}`;
}

export function createOrganizationSlug(name: string, suffix: string): string {
  const base = normalizeOrganizationName(name).replace(/\s+/g, "-").slice(0, 60) || "organization";
  return `${base}-${suffix.replace(/[^A-Za-z0-9]/g, "").slice(-8).toLowerCase()}`;
}

function cleanPublicString(value: unknown, max = 500): string | undefined {
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

/**
 * The only organization representation suitable for public or ordinary-member
 * discovery. Ownership, billing, source identifiers, claim evidence, targeting
 * fields, and suppressed home-business locations are never projected.
 */
export function sanitizePublicOrganization(
  organizationId: string,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const homeBased = source.homeBased === true;
  const privacySuppressed = homeBased || source.privacySuppressed === true;
  const result: Record<string, unknown> = {
    id: organizationId,
    schemaVersion: ORGANIZATION_SCHEMA_VERSION,
    name: cleanPublicString(source.name, 200) ?? "Organization",
    normalizedName: cleanPublicString(source.normalizedName, 200) ?? "",
    slug: cleanPublicString(source.slug, 100) ?? createOrganizationSlug(String(source.name ?? "Organization"), organizationId),
    city: cleanPublicString(source.city, 100) ?? "",
    county: cleanPublicString(source.county, 100) ?? "",
    state: cleanPublicString(source.state, 40) ?? "",
    claimStatus: ["unclaimed", "claim_pending", "claimed"].includes(String(source.claimStatus))
      ? source.claimStatus : "unclaimed",
    verificationStatus: cleanPublicString(source.exchangeVerificationStatus ?? source.verificationStatus, 40) ?? "unverified",
    organizationType: cleanPublicString(source.organizationType, 100) ?? "",
    description: cleanPublicString(source.description, 2_000) ?? "",
    website: cleanPublicString(source.website, 500) ?? "",
    naicsCodes: stringList(source.naicsCodes),
    capabilityKeywords: stringList(source.capabilityKeywords),
    certifications: stringList(source.certifications),
    sources: stringList(source.sources, 20),
    homeBased,
    privacySuppressed,
    status: source.status === "inactive" ? "inactive" : "active",
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(),
  };
  if (!privacySuppressed) {
    const addressLine1 = cleanPublicString(source.addressLine1 ?? source.address, 300);
    const postalCode = cleanPublicString(source.postalCode, 20);
    if (addressLine1) result.addressLine1 = addressLine1;
    if (postalCode) result.postalCode = postalCode;
    if (typeof source.latitude === "number" && Number.isFinite(source.latitude)) result.latitude = source.latitude;
    if (typeof source.longitude === "number" && Number.isFinite(source.longitude)) result.longitude = source.longitude;
    if (typeof source.geohash === "string" && source.geohash.trim()) result.geohash = source.geohash.trim();
  }
  return result;
}
