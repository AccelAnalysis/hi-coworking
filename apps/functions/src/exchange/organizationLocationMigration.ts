import { createHash } from "node:crypto";
import {
  ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION,
  organizationEstablishmentSchema,
  type OrganizationEstablishment,
} from "@hi/shared/organization-establishments";

export const ORGANIZATION_LOCATION_MIGRATION_VERSION = 1 as const;

export interface LegacyOrganizationMigrationPlan {
  organizationId: string;
  outcome: "create" | "skip";
  reason: string;
  location?: OrganizationEstablishment;
  organizationPatch?: Record<string, unknown>;
  hash: string;
}

function clean(value: unknown, max = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().replace(/\s+/g, " ");
  return result ? result.slice(0, max) : undefined;
}

function validCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

function finalize(plan: Omit<LegacyOrganizationMigrationPlan, "hash">): LegacyOrganizationMigrationPlan {
  return {
    ...plan,
    hash: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
  };
}

export function planLegacyOrganizationLocationMigration(
  organizationId: string,
  source: Record<string, unknown>,
  now: number,
): LegacyOrganizationMigrationPlan {
  if (Number(source.organizationLocationMigrationVersion ?? 0) >= ORGANIZATION_LOCATION_MIGRATION_VERSION) {
    return finalize({ organizationId, outcome: "skip", reason: "already_migrated" });
  }
  const addressLine1 = clean(source.addressLine1 ?? source.address);
  const city = clean(source.city);
  const state = clean(source.state, 120);
  const countryCode = clean(source.countryCode, 2) ?? "US";
  if (!addressLine1 || !city || !state) {
    return finalize({ organizationId, outcome: "skip", reason: "incomplete_precise_address" });
  }
  const home = source.homeBased === true || source.privacySuppressed === true;
  const coordinateAvailable = validCoordinates(source.latitude, source.longitude);
  const coordinateApproved = !home && source.coordinatePublicationApproved === true && coordinateAvailable;
  const addressApproved = !home && source.addressPublicationApproved === true;
  const locationId = `legacy_${organizationId}`;
  const location = organizationEstablishmentSchema.parse({
    id: locationId,
    organizationId,
    name: clean(source.name, 160) ? `${clean(source.name, 140)} primary location` : "Primary location",
    locationType: "headquarters",
    isHeadquarters: true,
    isPrimary: true,
    status: source.status === "active" ? "active" : "inactive",
    physicalAddress: {
      line1: addressLine1,
      line2: clean(source.addressLine2),
      locality: city,
      administrativeArea: state,
      postalCode: clean(source.postalCode, 32),
      countryCode,
      county: clean(source.county, 120),
    },
    addressPublicationApproved: addressApproved,
    coordinatePublicationApproved: coordinateApproved,
    ...(coordinateAvailable ? {
      geocode: {
        provider: "legacy",
        normalizedAddress: [addressLine1, city, state, clean(source.postalCode, 32)].filter(Boolean).join(", "),
        latitude: source.latitude,
        longitude: source.longitude,
        geohash: clean(source.geohash, 24),
        precision: source.coordinateConfidence === "authoritative" ? "address" : "unknown",
        confidence: source.coordinateConfidence === "authoritative" ? "high" : "low",
        source: "migrated_legacy",
        geocodedAt: now,
        confirmedByUid: "system_migration",
        confirmedAt: now,
      },
    } : {}),
    serviceArea: { city, county: clean(source.county, 120), region: state, countryCode, territoryFips: clean(source.territoryFips, 12) },
    publicContactAvailable: source.publicContactAvailable === true,
    privateHome: home,
    createdBy: "system_migration",
    createdAt: now,
    updatedAt: now,
    version: ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION,
    recordVersion: 1,
  });
  return finalize({
    organizationId,
    outcome: "create",
    reason: "eligible_legacy_location",
    location,
    organizationPatch: {
      primaryLocationId: locationId,
      headquartersLocationId: locationId,
      organizationLocationMigrationVersion: ORGANIZATION_LOCATION_MIGRATION_VERSION,
      organizationLocationMigrationHash: "pending_plan_hash",
      organizationLocationMigratedAt: now,
      schemaVersion: Math.max(3, Number(source.schemaVersion ?? 0)),
      updatedAt: now,
    },
  });
}

export function applyLegacyOrganizationClaimPolicy(
  plan: LegacyOrganizationMigrationPlan,
  source: Record<string, unknown>,
  includeClaimed: boolean,
): LegacyOrganizationMigrationPlan {
  if (source.claimStatus !== "claimed" || includeClaimed || plan.outcome !== "create") return plan;
  return finalize({
    organizationId: plan.organizationId,
    outcome: "skip",
    reason: "claimed_requires_explicit_flag",
  });
}
