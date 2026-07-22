import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertOrganizationLocationInvariants,
  normalizeContactValue,
  organizationCommunicationRouteSchema,
  organizationContactPointSchema,
  organizationEstablishmentSchema,
  organizationProfileV3Schema,
  publicOrganizationEstablishmentSchema,
} from "./organizationEstablishments";

const now = 1_700_000_000_000;
const address = { line1: "1 Main St", locality: "Smithfield", administrativeArea: "VA", postalCode: "23430", countryCode: "US" };
const geocode = { provider: "census", normalizedAddress: "1 MAIN ST, SMITHFIELD, VA 23430", latitude: 36.98, longitude: -76.63,
  precision: "address" as const, confidence: "high" as const, source: "owner_confirmed" as const,
  geocodedAt: now, confirmedByUid: "owner", confirmedAt: now };

function location(overrides: Record<string, unknown> = {}) {
  return { id: "location_1", organizationId: "org_1", name: "Headquarters", locationType: "headquarters",
    isHeadquarters: true, isPrimary: true, status: "active", physicalAddress: address,
    addressPublicationApproved: false, coordinatePublicationApproved: false, geocode,
    publicContactAvailable: false, privateHome: false, createdBy: "owner", createdAt: now, updatedAt: now,
    version: 1, recordVersion: 1, ...overrides };
}

test("establishment contract accepts an owner-confirmed private headquarters", () => {
  assert.equal(organizationEstablishmentSchema.parse(location()).isPrimary, true);
});

test("zero/zero and coordinate publication without confirmation are rejected", () => {
  assert.equal(organizationEstablishmentSchema.safeParse(location({ coordinatePublicationApproved: true, geocode: undefined })).success, false);
  assert.equal(organizationEstablishmentSchema.safeParse(location({ geocode: { ...geocode, latitude: 0, longitude: 0 } })).success, false);
});

test("mailing-only, virtual, and private-home locations cannot publish exact markers", () => {
  for (const overrides of [
    { locationType: "mailing_only", isPrimary: false, isHeadquarters: false, coordinatePublicationApproved: true },
    { locationType: "virtual", physicalAddress: undefined, coordinatePublicationApproved: true },
    { privateHome: true, coordinatePublicationApproved: true },
  ]) assert.equal(organizationEstablishmentSchema.safeParse(location(overrides)).success, false);
});

test("exactly one active establishment is primary and at most one is headquarters", () => {
  assert.doesNotThrow(() => assertOrganizationLocationInvariants([organizationEstablishmentSchema.parse(location())]));
  assert.throws(() => assertOrganizationLocationInvariants([
    organizationEstablishmentSchema.parse(location()),
    organizationEstablishmentSchema.parse(location({ id: "location_2", name: "Branch", locationType: "branch", isHeadquarters: false })),
  ]), /Exactly one/);
});

test("public projection contract keeps address and coordinate approvals independent", () => {
  assert.equal(publicOrganizationEstablishmentSchema.safeParse({
    id: "location_1", organizationId: "org_1", name: "HQ", locationType: "headquarters",
    isHeadquarters: true, isPrimary: true, addressPublicationApproved: false,
    coordinatePublicationApproved: true, latitude: 36.98, longitude: -76.63,
    publicContactAvailable: false, version: 1, updatedAt: now,
  }).success, true);
  assert.equal(publicOrganizationEstablishmentSchema.safeParse({
    id: "location_1", organizationId: "org_1", name: "HQ", locationType: "headquarters",
    isHeadquarters: true, isPrimary: true, addressPublicationApproved: false, addressLine1: "secret",
    coordinatePublicationApproved: false, publicContactAvailable: false, version: 1, updatedAt: now,
  }).success, false);
});

test("contact and route contracts normalize destinations and isolate billing", () => {
  assert.equal(normalizeContactValue("email", " OWNER@Example.COM "), "owner@example.com");
  assert.equal(normalizeContactValue("phone", "+1 (757) 555-0100"), "+17575550100");
  assert.equal(organizationContactPointSchema.safeParse({ id: "contact_1", organizationId: "org_1", type: "email",
    purposes: ["billing"], normalizedValue: "billing@example.com", visibility: "public", publicationStatus: "approved",
    verificationStatus: "unverified", consentAuthorityBasis: "owner", status: "active", createdBy: "owner",
    createdAt: now, updatedAt: now, version: 1, recordVersion: 1 }).success, false);
  assert.equal(organizationCommunicationRouteSchema.safeParse({ id: "route_1", organizationId: "org_1", purpose: "referrals",
    primaryContactPointIds: [], fallbackContactPointIds: [], fallbackMemberRoles: ["owner"],
    inAppEnabled: false, emailEnabled: false, phoneEnabled: false, status: "active", createdBy: "owner",
    createdAt: now, updatedAt: now, version: 1, recordVersion: 1 }).success, false);
});

test("organization profile owns identity, identifiers, media, and protected documents", () => {
  const profile = organizationProfileV3Schema.parse({
    id: "org_1", legalName: "Example LLC", tradeNames: [], identifiers: { uei: "UEI123" },
    description: "Organization-owned description", domain: "example.test", website: "https://example.test",
    industries: ["Professional services"], capabilities: ["Analysis"], certifications: [],
    media: [{ id: "logo_1", kind: "logo", label: "Logo", storagePath: "organizations/org_1/logo.png", publicationStatus: "draft" }],
    documents: [{ id: "doc_1", kind: "capability_statement", label: "Capability statement", storagePath: "organizations/org_1/capability.pdf", publicationStatus: "draft" }],
    publicationStatus: "draft", claimStatus: "claimed", verificationStatus: "unverified",
    version: 3, recordVersion: 1,
  });
  assert.equal(profile.identifiers.uei, "UEI123");
  assert.equal(profile.documents[0].kind, "capability_statement");
});
