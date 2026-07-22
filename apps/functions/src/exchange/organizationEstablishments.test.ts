import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCensusCandidates, normalizeMapboxCandidates, projectPublicContactPoint, projectPublicEstablishment, resolveCommunicationRoute } from "./organizationEstablishments";
import { applyLegacyOrganizationClaimPolicy, planLegacyOrganizationLocationMigration } from "./organizationLocationMigration";
import { organizationContactPointSchema, organizationEstablishmentSchema } from "@hi/shared/organization-establishments";

const now = 1_700_000_000_000;

test("Census and Mapbox responses are bounded and discard unsafe provider payload", () => {
  const census = normalizeCensusCandidates({ result: { addressMatches: [{
    matchedAddress: "1 MAIN ST, SMITHFIELD, VA, 23430", matchType: "Exact",
    coordinates: { x: -76.63, y: 36.98 }, secret: "must-not-survive",
  }] } });
  assert.equal(census.length, 1); assert.equal(census[0].provider, "census");
  assert.equal("secret" in census[0], false);
  const mapbox = normalizeMapboxCandidates({ features: [{ id: "address.1", type: "address",
    geometry: { coordinates: [-76.63, 36.98] }, properties: { full_address: "1 Main St", match_code: { confidence: "high" }, raw: "drop" } }] });
  assert.equal(mapbox[0].confidence, "high"); assert.equal("raw" in mapbox[0], false);
});

test("provider normalizers reject missing and zero/zero coordinates", () => {
  assert.deepEqual(normalizeCensusCandidates({ result: { addressMatches: [{ coordinates: { x: 0, y: 0 } }] } }), []);
  assert.deepEqual(normalizeMapboxCandidates({ features: [{ geometry: { coordinates: [] } }] }), []);
});

test("public location projection suppresses a private home and independent private fields", () => {
  const base = { id: "location_1", organizationId: "org_1", name: "HQ", locationType: "headquarters",
    isHeadquarters: true, isPrimary: true, status: "active", physicalAddress: { line1: "1 Main", locality: "Smithfield", administrativeArea: "VA", countryCode: "US" },
    addressPublicationApproved: false, coordinatePublicationApproved: true,
    geocode: { provider: "census", normalizedAddress: "1 Main", latitude: 36.98, longitude: -76.63, precision: "address", confidence: "high", source: "owner_confirmed", geocodedAt: now, confirmedByUid: "owner", confirmedAt: now },
    serviceArea: { city: "Smithfield", county: "Isle of Wight", region: "VA", countryCode: "US" },
    publicContactAvailable: false, privateHome: false, createdBy: "owner", createdAt: now, updatedAt: now, version: 1, recordVersion: 1 };
  const location = organizationEstablishmentSchema.parse(base);
  const projection = projectPublicEstablishment(location);
  assert.equal(projection?.addressLine1, undefined); assert.equal(projection?.latitude, 36.98);
  const homeProjection = projectPublicEstablishment(organizationEstablishmentSchema.parse({ ...base, name: "Private owner label", privateHome: true, coordinatePublicationApproved: false }));
  assert.equal(homeProjection?.name, "Smithfield service area");
  assert.equal(homeProjection?.locationType, "service_location");
  assert.equal(homeProjection?.city, "Smithfield");
  assert.equal(homeProjection?.addressLine1, undefined);
  assert.equal(homeProjection?.latitude, undefined);
  assert.equal(JSON.stringify(homeProjection).includes("Private owner label"), false);
});

test("only explicit public approved contacts receive a public projection", () => {
  const base = { id: "contact_1", organizationId: "org_1", type: "email", purposes: ["general"],
    normalizedValue: "hello@example.com", displayValue: "hello@example.com", verificationStatus: "unverified",
    visibility: "private_operational", publicationStatus: "draft", consentAuthorityBasis: "owner", status: "active",
    createdBy: "owner", createdAt: now, updatedAt: now, version: 1, recordVersion: 1 };
  assert.equal(projectPublicContactPoint(organizationContactPointSchema.parse(base)), null);
  assert.equal(projectPublicContactPoint(organizationContactPointSchema.parse({ ...base, visibility: "public", publicationStatus: "approved" }))?.displayValue, "hello@example.com");
});

test("legacy migration is deterministic, private-preserving, and refuses city-only markers", () => {
  const skipped = planLegacyOrganizationLocationMigration("org_1", { name: "List only", city: "Smithfield", state: "VA" }, now);
  assert.equal(skipped.outcome, "skip");
  const first = planLegacyOrganizationLocationMigration("org_1", { name: "Home", addressLine1: "1 Main", city: "Smithfield", state: "VA", homeBased: true, latitude: 36.98, longitude: -76.63, coordinatePublicationApproved: true }, now);
  const replay = planLegacyOrganizationLocationMigration("org_1", { name: "Home", addressLine1: "1 Main", city: "Smithfield", state: "VA", homeBased: true, latitude: 36.98, longitude: -76.63, coordinatePublicationApproved: true }, now);
  assert.equal(first.hash, replay.hash); assert.equal(first.location?.coordinatePublicationApproved, false); assert.equal(first.location?.privateHome, true);
  assert.equal(applyLegacyOrganizationClaimPolicy(first, { claimStatus: "claimed" }, false).reason, "claimed_requires_explicit_flag");
  assert.equal(applyLegacyOrganizationClaimPolicy(first, { claimStatus: "claimed" }, true).outcome, "create");
});

function routeDb(seed: Record<string, Array<{ id: string; data: Record<string, unknown> }>>) {
  const deliveries = new Map<string, Record<string, unknown>>();
  return {
    deliveries,
    collection(name: string) {
      const source = seed[name] ?? [];
      return {
        where() { return this; },
        async get() {
          return { docs: source.map(({ id, data }) => ({ id, data: () => data, get: (field: string) => data[field] })) };
        },
        doc(id: string) {
          return { async set(data: Record<string, unknown>) { deliveries.set(id, data); } };
        },
      };
    },
  };
}

test("route resolution honors a location override without disclosing its private destination", async () => {
  const db = routeDb({
    organizationCommunicationRoutes: [{ id: "route_location", data: {
      organizationId: "org_1", locationId: "location_1", purpose: "referrals",
      primaryContactPointIds: ["private_email"], fallbackContactPointIds: [], fallbackMemberRoles: ["owner"],
      inAppEnabled: true, emailEnabled: true, phoneEnabled: false, status: "active", createdBy: "owner",
      createdAt: now, updatedAt: now, version: 1, recordVersion: 1,
    } }],
    organizationContactPoints: [{ id: "private_email", data: {
      organizationId: "org_1", type: "email", normalizedValue: "private@example.test", status: "active",
    } }],
    orgMembers: [{ id: "org_1_owner", data: { orgId: "org_1", uid: "owner", role: "owner", status: "active" } }],
  });
  const result = await resolveCommunicationRoute({ db: db as never, actorUid: "sender", organizationId: "org_1", locationId: "location_1", purpose: "referrals", requestId: "request_1" });
  assert.equal(result.publicResult.selectedRouteId, "route_location");
  assert.equal(result.publicResult.fallbackUsed, "none");
  assert.equal(JSON.stringify(result.publicResult).includes("private@example.test"), false);
  assert.deepEqual(result.publicResult.deliveryChannelTypes, ["in_app", "email"]);
});

test("general resolution prefers an approved public contact before member fallback", async () => {
  const db = routeDb({
    organizationCommunicationRoutes: [],
    organizationContactPoints: [{ id: "public_email", data: {
      organizationId: "org_1", type: "email", purposes: ["general"], normalizedValue: "hello@example.test",
      visibility: "public", publicationStatus: "approved", status: "active",
    } }],
    orgMembers: [{ id: "org_1_owner", data: { orgId: "org_1", uid: "owner", role: "owner", status: "active" } }],
  });
  const result = await resolveCommunicationRoute({ db: db as never, actorUid: "sender", organizationId: "org_1", purpose: "general", requestId: "request_2" });
  assert.equal(result.publicResult.publicDisclosureLevel, "public");
  assert.equal(result.publicResult.fallbackUsed, "none");
  assert.deepEqual(result.destinationMemberUids, []);
  assert.equal(JSON.stringify(result.publicResult).includes("hello@example.test"), false);
  assert.equal(db.deliveries.get("request_2")?.consentVisibilityBasis, "approved_public_contact");
});
