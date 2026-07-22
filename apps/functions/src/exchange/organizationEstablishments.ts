import { createHash, randomUUID } from "node:crypto";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION,
  assertOrganizationLocationInvariants,
  normalizeContactValue,
  organizationAddressSchema,
  organizationCommunicationRouteSchema,
  organizationContactPointSchema,
  organizationContactPurposeSchema,
  organizationEstablishmentSchema,
  organizationLocationTypeSchema,
  organizationProfileV3Schema,
  type OrganizationContactPoint,
  type OrganizationContactPurpose,
  type OrganizationEstablishment,
  type PublicOrganizationContactPoint,
  type PublicOrganizationEstablishment,
} from "@hi/shared/organization-establishments";
import { getAuthorizedActor, loadOrgAuthority, writeExchangeAudit } from "./security";

const ID = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const VERSION = ORGANIZATION_ESTABLISHMENT_CONTRACT_VERSION;
const MAX_CANDIDATES = 5;
type Db = FirebaseFirestore.Firestore;
type Data = FirebaseFirestore.DocumentData;

export interface GeocodeCandidate {
  id: string;
  provider: string;
  providerPlaceId?: string;
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  precision: "rooftop" | "parcel" | "address" | "street" | "postal_code" | "locality" | "county" | "region" | "unknown";
  confidence: "high" | "medium" | "low" | "unknown";
  attribution: string;
}

interface GeocodingProvider {
  name: string;
  search(address: z.infer<typeof organizationAddressSchema>): Promise<GeocodeCandidate[]>;
}

const locationInputSchema = z.object({
  organizationId: ID,
  locationId: ID.optional(),
  expectedRecordVersion: z.number().int().nonnegative().optional(),
  name: z.string().trim().min(1).max(160),
  locationType: organizationLocationTypeSchema,
  isHeadquarters: z.boolean(),
  isPrimary: z.boolean(),
  status: z.enum(["active", "inactive", "historical"]),
  physicalAddress: organizationAddressSchema.optional(),
  mailingAddress: organizationAddressSchema.optional(),
  addressPublicationApproved: z.boolean(),
  coordinatePublicationApproved: z.boolean(),
  serviceArea: z.object({
    city: z.string().trim().max(120).optional(), county: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(), countryCode: z.string().trim().length(2).optional(),
    territoryFips: z.string().trim().max(12).optional(),
  }).strict().optional(),
  publicContactAvailable: z.boolean(),
  privateHome: z.boolean().default(false),
  geocodeSelection: z.object({ requestId: ID, candidateId: ID }).strict().optional(),
}).strict();

const contactInputSchema = z.object({
  organizationId: ID, contactPointId: ID.optional(), locationId: ID.optional(),
  expectedRecordVersion: z.number().int().nonnegative().optional(),
  type: z.enum(["email", "phone", "website", "contact_form", "member_route"]),
  purposes: z.array(organizationContactPurposeSchema).min(1).max(9),
  value: z.string().trim().min(1).max(500), displayValue: z.string().trim().max(500).optional(),
  verificationStatus: z.enum(["unverified", "pending", "verified", "failed"]).default("unverified"),
  visibility: z.enum(["private_operational", "organization_members", "relationship_safe", "public"]),
  publicationStatus: z.enum(["draft", "approved", "suppressed"]),
  consentAuthorityBasis: z.string().trim().min(1).max(500),
  status: z.enum(["active", "inactive", "historical"]),
}).strict();

const routeInputSchema = z.object({
  organizationId: ID, routeId: ID.optional(), locationId: ID.optional(),
  expectedRecordVersion: z.number().int().nonnegative().optional(), purpose: organizationContactPurposeSchema,
  primaryContactPointIds: z.array(ID).max(20), fallbackContactPointIds: z.array(ID).max(20),
  fallbackMemberRoles: z.array(z.enum(["owner", "admin", "referral_manager", "response_team"])).max(8),
  inAppEnabled: z.boolean(), emailEnabled: z.boolean(), phoneEnabled: z.boolean(), status: z.enum(["active", "inactive"]),
}).strict();

const enrichmentAddressProposalSchema = z.object({
  id: ID,
  address: organizationAddressSchema,
  geocode: z.object({
    provider: z.string().trim().min(1).max(60), providerPlaceId: z.string().trim().max(240).optional(),
    normalizedAddress: z.string().trim().min(1).max(500), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
    precision: z.enum(["rooftop", "parcel", "address", "street", "postal_code", "locality", "county", "region", "unknown"]),
    confidence: z.enum(["high", "medium", "low", "unknown"]), geocodedAt: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict();

const enrichmentContactProposalSchema = z.object({
  id: ID,
  type: z.enum(["email", "phone"]),
  value: z.string().trim().min(1).max(500),
  label: z.string().trim().max(120).optional(),
}).strict();

const enrichmentProposalReviewInputSchema = z.discriminatedUnion("itemType", [
  z.object({
    organizationId: ID, proposalId: ID, itemType: z.literal("address"), itemId: ID,
    classification: z.enum(["headquarters", "branch", "mailing_only", "historical", "duplicate", "not_associated", "private_home", "unresolved"]),
    label: z.string().trim().min(1).max(160).optional(), makePrimary: z.boolean().default(false),
    addressPublicationApproved: z.boolean().default(false), coordinatePublicationApproved: z.boolean().default(false),
  }).strict(),
  z.object({
    organizationId: ID, proposalId: ID, itemType: z.literal("contact"), itemId: ID,
    classification: z.enum(["organization_general", "referral_intake", "procurement", "location_specific", "public", "private_operational", "incorrect", "historical"]),
    locationId: ID.optional(),
  }).strict(),
]);

const profileInputSchema = z.object({
  organizationId: ID, expectedRecordVersion: z.number().int().nonnegative(),
  legalName: z.string().trim().min(1).max(200), tradeNames: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  identifiers: z.record(z.string().trim().max(60), z.string().trim().max(240)).default({}),
  description: z.string().trim().max(4_000).optional(),
  domain: z.string().trim().max(253).optional(), website: z.string().url().max(500).optional(),
  industries: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  capabilities: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
  certifications: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  media: z.array(z.object({
    id: ID, kind: z.enum(["logo", "image", "video"]), label: z.string().trim().min(1).max(160),
    publicUrl: z.string().url().max(2_000).optional(), storagePath: z.string().trim().min(1).max(1_024).optional(),
    publicationStatus: z.enum(["draft", "approved", "suppressed"]),
  }).strict()).max(100).default([]),
  documents: z.array(z.object({
    id: ID, kind: z.enum(["capability_statement", "certification", "registration", "other"]),
    label: z.string().trim().min(1).max(160), storagePath: z.string().trim().min(1).max(1_024),
    publicationStatus: z.enum(["draft", "approved", "suppressed"]),
  }).strict()).max(100).default([]),
  publicationStatus: z.enum(["draft", "approved", "suppressed"]),
}).strict();

function db(): Db { return admin.firestore(); }

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid organization request", {
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })).slice(0, 20),
  });
  return parsed.data;
}

function firestoreSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => firestoreSafe(item)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, firestoreSafe(item)])) as T;
}

function validCoordinate(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().replace(/\s+/g, " ");
  return result ? result.slice(0, max) : undefined;
}

export function projectPublicEstablishment(location: OrganizationEstablishment): PublicOrganizationEstablishment | null {
  if (location.status !== "active") return null;
  const privateHome = location.privateHome === true;
  const markerEligible = location.locationType !== "mailing_only" && location.locationType !== "virtual";
  const result: PublicOrganizationEstablishment = {
    id: location.id, organizationId: location.organizationId,
    name: privateHome ? (location.serviceArea?.city ? `${location.serviceArea.city} service area` : "Service area") : location.name,
    locationType: privateHome ? "service_location" : location.locationType,
    isHeadquarters: location.isHeadquarters, isPrimary: location.isPrimary,
    city: location.serviceArea?.city ?? (!privateHome && location.addressPublicationApproved ? location.physicalAddress?.locality : undefined),
    county: location.serviceArea?.county ?? (!privateHome && location.addressPublicationApproved ? location.physicalAddress?.county : undefined),
    administrativeArea: location.serviceArea?.region ?? (!privateHome && location.addressPublicationApproved ? location.physicalAddress?.administrativeArea : undefined),
    countryCode: location.serviceArea?.countryCode ?? (!privateHome && location.addressPublicationApproved ? location.physicalAddress?.countryCode : undefined),
    addressPublicationApproved: !privateHome && location.addressPublicationApproved,
    coordinatePublicationApproved: !privateHome && markerEligible && location.coordinatePublicationApproved,
    publicContactAvailable: location.publicContactAvailable, version: VERSION, updatedAt: location.updatedAt,
  };
  if (!privateHome && location.addressPublicationApproved && location.physicalAddress) {
    result.addressLine1 = location.physicalAddress.line1;
    result.postalCode = location.physicalAddress.postalCode;
  }
  if (!privateHome && markerEligible && location.coordinatePublicationApproved && location.geocode
    && validCoordinate(location.geocode.latitude, location.geocode.longitude)) {
    result.latitude = location.geocode.latitude; result.longitude = location.geocode.longitude;
    result.geohash = location.geocode.geohash; result.coordinatePrecision = location.geocode.precision;
  }
  return result;
}

export function projectPublicContactPoint(contact: OrganizationContactPoint): PublicOrganizationContactPoint | null {
  if (contact.status !== "active" || contact.visibility !== "public" || contact.publicationStatus !== "approved" || contact.type === "member_route") return null;
  return {
    id: contact.id, organizationId: contact.organizationId, locationId: contact.locationId, type: contact.type,
    purposes: contact.purposes, displayValue: contact.displayValue ?? contact.normalizedValue,
    visibility: "public", publicationStatus: "approved", status: "active", version: VERSION, updatedAt: contact.updatedAt,
  };
}

export function normalizeCensusCandidates(payload: unknown): GeocodeCandidate[] {
  const matches = (payload as { result?: { addressMatches?: unknown[] } } | null)?.result?.addressMatches;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((raw, index) => {
    const candidate = raw as Record<string, unknown>;
    const coordinates = candidate.coordinates as Record<string, unknown> | undefined;
    const latitude = coordinates?.y; const longitude = coordinates?.x;
    if (!validCoordinate(latitude, longitude)) return [];
    const exact = String(candidate.matchType).toLowerCase().includes("exact");
    return [{
      id: `census_${index}_${createHash("sha256").update(`${candidate.matchedAddress}:${latitude}:${longitude}`).digest("hex").slice(0, 16)}`,
      provider: "census", normalizedAddress: text(candidate.matchedAddress, 500) ?? "Matched address",
      latitude: latitude as number, longitude: longitude as number, precision: exact ? "address" : "street", confidence: exact ? "high" : "medium",
      attribution: "U.S. Census Bureau Geocoding Services",
    } satisfies GeocodeCandidate];
  }).slice(0, MAX_CANDIDATES);
}

export function normalizeMapboxCandidates(payload: unknown): GeocodeCandidate[] {
  const features = (payload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((raw, index) => {
    const feature = raw as Record<string, unknown>;
    const coordinates = (feature.geometry as { coordinates?: unknown[] } | undefined)?.coordinates;
    const longitude = coordinates?.[0]; const latitude = coordinates?.[1];
    if (!validCoordinate(latitude, longitude)) return [];
    const properties = feature.properties as Record<string, unknown> | undefined;
    const confidenceRaw = String((properties?.match_code as Record<string, unknown> | undefined)?.confidence ?? "unknown");
    const confidence = ["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw as GeocodeCandidate["confidence"] : "unknown";
    return [{
      id: `mapbox_${index}_${createHash("sha256").update(`${feature.id}:${latitude}:${longitude}`).digest("hex").slice(0, 16)}`,
      provider: "mapbox", providerPlaceId: text(feature.id, 240),
      normalizedAddress: text(properties?.full_address ?? feature.place_name ?? properties?.name, 500) ?? "Matched address",
      latitude: latitude as number, longitude: longitude as number, precision: String(feature.type ?? properties?.feature_type) === "address" ? "address" : "unknown",
      confidence, attribution: "© Mapbox and its data providers",
    } satisfies GeocodeCandidate];
  }).slice(0, MAX_CANDIDATES);
}

class CensusProvider implements GeocodingProvider {
  name = "census";
  async search(address: z.infer<typeof organizationAddressSchema>): Promise<GeocodeCandidate[]> {
    if (address.countryCode !== "US") return [];
    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.searchParams.set("address", [address.line1, address.line2, address.locality, address.administrativeArea, address.postalCode].filter(Boolean).join(", "));
    url.searchParams.set("benchmark", "Public_AR_Current"); url.searchParams.set("format", "json");
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Census response ${response.status}`);
    return normalizeCensusCandidates(await response.json());
  }
}

class MapboxProvider implements GeocodingProvider {
  name = "mapbox";
  constructor(private token: string) {}
  async search(address: z.infer<typeof organizationAddressSchema>): Promise<GeocodeCandidate[]> {
    const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
    url.searchParams.set("q", [address.line1, address.line2, address.locality, address.administrativeArea, address.postalCode, address.countryCode].filter(Boolean).join(", "));
    url.searchParams.set("access_token", this.token); url.searchParams.set("limit", String(MAX_CANDIDATES));
    // Permanent mode is mandatory because an owner-confirmed result is persisted.
    url.searchParams.set("permanent", "true"); url.searchParams.set("country", address.countryCode.toLowerCase());
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Mapbox response ${response.status}`);
    return normalizeMapboxCandidates(await response.json());
  }
}

function provider(): GeocodingProvider {
  if (String(process.env.ORGANIZATION_GEOCODING_PROVIDER ?? "census").toLowerCase() === "mapbox") {
    if (!process.env.MAPBOX_GEOCODING_TOKEN) throw new HttpsError("failed-precondition", "Configured geocoder is unavailable");
    return new MapboxProvider(process.env.MAPBOX_GEOCODING_TOKEN);
  }
  return new CensusProvider();
}

async function managementAuthority(organizationId: string, uid: string): Promise<void> {
  await db().runTransaction((transaction) => loadOrgAuthority(transaction, db(), organizationId, uid, { managementRequired: true }));
}

async function rateLimitGeocoding(uid: string): Promise<void> {
  const minute = Math.floor(Date.now() / 60_000);
  const ref = db().collection("organizationGeocodeRateLimits").doc(`${uid}_${minute}`);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref); const count = Number(snapshot.get("count") ?? 0);
    if (count >= 12) throw new HttpsError("resource-exhausted", "Too many address searches. Try again shortly.");
    transaction.set(ref, { uid, minute, count: count + 1, expiresAt: Date.now() + 120_000 }, { merge: true });
  });
}

export const exchange_searchOrganizationGeocodes = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parse(z.object({ organizationId: ID, address: organizationAddressSchema }).strict(), request.data);
  await managementAuthority(input.organizationId, actor.uid); await rateLimitGeocoding(actor.uid);
  const geocoder = provider(); const cacheId = createHash("sha256").update(JSON.stringify({ provider: geocoder.name, address: input.address })).digest("hex");
  const cacheRef = db().collection("organizationGeocodeCache").doc(cacheId); const cached = await cacheRef.get();
  let candidates: GeocodeCandidate[];
  if (cached.exists && Number(cached.get("expiresAt")) > Date.now()) candidates = (cached.get("candidates") as GeocodeCandidate[]).slice(0, MAX_CANDIDATES);
  else {
    try { candidates = (await geocoder.search(input.address)).slice(0, MAX_CANDIDATES); }
    catch (error) {
      logger.warn("Organization geocoder unavailable", { provider: geocoder.name, errorType: error instanceof Error ? error.name : "unknown" });
      throw new HttpsError("unavailable", "Address suggestions are temporarily unavailable");
    }
    await cacheRef.set({ provider: geocoder.name, candidates, expiresAt: Date.now() + 86_400_000, updatedAt: Date.now() });
  }
  const requestId = randomUUID(); const expiresAt = Date.now() + 900_000;
  await db().collection("organizationGeocodeCandidateSessions").doc(requestId).set({ uid: actor.uid, organizationId: input.organizationId, candidates, expiresAt, createdAt: Date.now() });
  return { requestId, candidates, expiresAt, attributionRequired: true };
});

async function confirmedGeocode(
  transaction: FirebaseFirestore.Transaction, uid: string, organizationId: string,
  selection: { requestId: string; candidateId: string } | undefined, now: number,
): Promise<OrganizationEstablishment["geocode"] | undefined> {
  if (!selection) return undefined;
  const ref = db().collection("organizationGeocodeCandidateSessions").doc(selection.requestId); const snapshot = await transaction.get(ref); const session = snapshot.data();
  if (!session || session.uid !== uid || session.organizationId !== organizationId || Number(session.expiresAt) < now) throw new HttpsError("failed-precondition", "Address confirmation expired");
  const candidate = (session.candidates as GeocodeCandidate[]).find((item) => item.id === selection.candidateId);
  if (!candidate || !validCoordinate(candidate.latitude, candidate.longitude)) throw new HttpsError("invalid-argument", "Invalid address candidate");
  transaction.delete(ref);
  return {
    provider: candidate.provider, providerPlaceId: candidate.providerPlaceId, normalizedAddress: candidate.normalizedAddress,
    latitude: candidate.latitude, longitude: candidate.longitude, precision: candidate.precision, confidence: candidate.confidence,
    source: "owner_confirmed", geocodedAt: now, confirmedByUid: uid, confirmedAt: now,
  };
}

async function refreshLocationSummary(transaction: FirebaseFirestore.Transaction, organizationId: string, locations: OrganizationEstablishment[], now: number): Promise<void> {
  const publicLocations = locations.map(projectPublicEstablishment).filter((item): item is PublicOrganizationEstablishment => Boolean(item));
  const primary = publicLocations.find((item) => item.isPrimary);
  transaction.set(db().collection("orgs").doc(organizationId), {
    primaryLocationId: locations.find((item) => item.status === "active" && item.isPrimary)?.id ?? admin.firestore.FieldValue.delete(),
    headquartersLocationId: locations.find((item) => item.status === "active" && item.isHeadquarters)?.id ?? admin.firestore.FieldValue.delete(),
    activeLocationCount: locations.filter((item) => item.status === "active").length, schemaVersion: 3, updatedAt: now,
  }, { merge: true });
  transaction.set(db().collection("publicOrganizations").doc(organizationId), {
    publicLocationCount: publicLocations.length,
    primaryPublicLocation: primary ? {
      id: primary.id, name: primary.name, city: primary.city ?? "", county: primary.county ?? "",
      administrativeArea: primary.administrativeArea ?? "", coordinatePublicationApproved: primary.coordinatePublicationApproved,
    } : admin.firestore.FieldValue.delete(),
    publicContactAvailable: publicLocations.some((item) => item.publicContactAvailable), updatedAt: now,
  }, { merge: true });
}

export const exchange_upsertOrganizationEstablishment = onCall(async (request) => {
  const actor = getAuthorizedActor(request); const input = parse(locationInputSchema, request.data); const now = Date.now(); const locationId = input.locationId ?? randomUUID();
  return db().runTransaction(async (transaction) => {
    await loadOrgAuthority(transaction, db(), input.organizationId, actor.uid, { managementRequired: true });
    const ref = db().collection("organizationLocations").doc(locationId);
    const [existing, all] = await Promise.all([transaction.get(ref), transaction.get(db().collection("organizationLocations").where("organizationId", "==", input.organizationId))]);
    const previous = existing.data();
    if (previous && previous.organizationId !== input.organizationId) throw new HttpsError("permission-denied", "Establishment ownership mismatch");
    const currentVersion = Number(previous?.recordVersion ?? 0);
    if (input.expectedRecordVersion !== undefined && input.expectedRecordVersion !== currentVersion) throw new HttpsError("aborted", "Establishment changed after it was loaded");
    const geocode = await confirmedGeocode(transaction, actor.uid, input.organizationId, input.geocodeSelection, now) ?? previous?.geocode;
    const candidate = organizationEstablishmentSchema.parse({
      id: locationId, organizationId: input.organizationId, name: input.name, locationType: input.locationType,
      isHeadquarters: input.isHeadquarters, isPrimary: input.isPrimary, status: input.status,
      physicalAddress: input.physicalAddress, mailingAddress: input.mailingAddress,
      addressPublicationApproved: input.addressPublicationApproved, coordinatePublicationApproved: input.coordinatePublicationApproved,
      geocode, serviceArea: input.serviceArea, publicContactAvailable: input.publicContactAvailable, privateHome: input.privateHome,
      createdBy: previous?.createdBy ?? actor.uid, createdAt: previous?.createdAt ?? now, updatedAt: now, version: VERSION, recordVersion: currentVersion + 1,
    });
    let locations = all.docs.filter((document) => document.id !== locationId).map((document) => organizationEstablishmentSchema.parse({ id: document.id, ...document.data() }));
    const designationTransfers: OrganizationEstablishment[] = [];
    if (candidate.status === "active" && (candidate.isPrimary || candidate.isHeadquarters)) {
      locations = locations.map((location) => {
        const clearPrimary = candidate.isPrimary && location.status === "active" && location.isPrimary;
        const clearHeadquarters = candidate.isHeadquarters && location.status === "active" && location.isHeadquarters;
        if (!clearPrimary && !clearHeadquarters) return location;
        const transferred = organizationEstablishmentSchema.parse({
          ...location,
          ...(clearPrimary ? { isPrimary: false } : {}),
          ...(clearHeadquarters ? { isHeadquarters: false } : {}),
          updatedAt: now,
          recordVersion: location.recordVersion + 1,
        });
        designationTransfers.push(transferred);
        return transferred;
      });
    }
    locations.push(candidate);
    try { assertOrganizationLocationInvariants(locations); } catch (error) { throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Invalid establishment state"); }
    for (const transferred of designationTransfers) {
      transaction.set(db().collection("organizationLocations").doc(transferred.id), firestoreSafe(transferred));
      const transferredPublicRef = db().collection("publicOrganizationLocations").doc(transferred.id);
      const transferredProjection = projectPublicEstablishment(transferred);
      if (transferredProjection) transaction.set(transferredPublicRef, firestoreSafe(transferredProjection)); else transaction.delete(transferredPublicRef);
    }
    transaction.set(ref, firestoreSafe(candidate));
    const publicRef = db().collection("publicOrganizationLocations").doc(locationId); const projection = projectPublicEstablishment(candidate);
    if (projection) transaction.set(publicRef, firestoreSafe(projection)); else transaction.delete(publicRef);
    await refreshLocationSummary(transaction, input.organizationId, locations, now);
    writeExchangeAudit(transaction, db(), { actorUid: actor.uid, actorRole: actor.role, actorOrganizationId: input.organizationId,
      action: existing.exists ? "organization.location.updated" : "organization.location.created", entityType: "organization_location", entityId: locationId, newStatus: candidate.status, createdAt: now });
    return { success: true, locationId, recordVersion: candidate.recordVersion, publicProjectionPublished: Boolean(projection) };
  });
});

async function ownedLocation(transaction: FirebaseFirestore.Transaction, organizationId: string, locationId?: string): Promise<void> {
  if (!locationId) return;
  const snapshot = await transaction.get(db().collection("organizationLocations").doc(locationId));
  if (!snapshot.exists || snapshot.get("organizationId") !== organizationId) throw new HttpsError("invalid-argument", "Establishment ownership mismatch");
}

export const exchange_upsertOrganizationContactPoint = onCall(async (request) => {
  const actor = getAuthorizedActor(request); const input = parse(contactInputSchema, request.data); const now = Date.now(); const contactPointId = input.contactPointId ?? randomUUID();
  let normalizedValue: string;
  try { normalizedValue = normalizeContactValue(input.type, input.value); } catch (error) { throw new HttpsError("invalid-argument", error instanceof Error ? error.message : "Invalid contact value"); }
  return db().runTransaction(async (transaction) => {
    await loadOrgAuthority(transaction, db(), input.organizationId, actor.uid, { managementRequired: true }); await ownedLocation(transaction, input.organizationId, input.locationId);
    const ref = db().collection("organizationContactPoints").doc(contactPointId); const existing = await transaction.get(ref); const previous = existing.data();
    if (previous && previous.organizationId !== input.organizationId) throw new HttpsError("permission-denied", "Contact ownership mismatch");
    const currentVersion = Number(previous?.recordVersion ?? 0);
    if (input.expectedRecordVersion !== undefined && input.expectedRecordVersion !== currentVersion) throw new HttpsError("aborted", "Contact changed after it was loaded");
    const duplicates = await transaction.get(db().collection("organizationContactPoints").where("organizationId", "==", input.organizationId).where("normalizedValue", "==", normalizedValue));
    if (duplicates.docs.some((document) => document.id !== contactPointId && document.get("status") === "active")) throw new HttpsError("already-exists", "Duplicate active contact point");
    const contact = organizationContactPointSchema.parse({
      id: contactPointId, organizationId: input.organizationId, locationId: input.locationId, type: input.type, purposes: input.purposes,
      normalizedValue, displayValue: input.displayValue || input.value, verificationStatus: input.verificationStatus,
      visibility: input.visibility, publicationStatus: input.publicationStatus, consentAuthorityBasis: input.consentAuthorityBasis, status: input.status,
      createdBy: previous?.createdBy ?? actor.uid, createdAt: previous?.createdAt ?? now, updatedAt: now, version: VERSION, recordVersion: currentVersion + 1,
    });
    transaction.set(ref, firestoreSafe(contact)); const publicRef = db().collection("publicOrganizationContactPoints").doc(contactPointId); const projection = projectPublicContactPoint(contact);
    if (projection) transaction.set(publicRef, firestoreSafe(projection)); else transaction.delete(publicRef);
    writeExchangeAudit(transaction, db(), { actorUid: actor.uid, actorRole: actor.role, actorOrganizationId: input.organizationId,
      action: existing.exists ? "organization.contact.updated" : "organization.contact.created", entityType: "organization_contact_point", entityId: contactPointId, newStatus: contact.status, createdAt: now });
    return { success: true, contactPointId, recordVersion: contact.recordVersion, publicProjectionPublished: Boolean(projection) };
  });
});

export const exchange_upsertOrganizationCommunicationRoute = onCall(async (request) => {
  const actor = getAuthorizedActor(request); const input = parse(routeInputSchema, request.data); const now = Date.now(); const routeId = input.routeId ?? randomUUID();
  return db().runTransaction(async (transaction) => {
    await loadOrgAuthority(transaction, db(), input.organizationId, actor.uid, { managementRequired: true }); await ownedLocation(transaction, input.organizationId, input.locationId);
    const contactIds = [...new Set([...input.primaryContactPointIds, ...input.fallbackContactPointIds])];
    const contacts = await Promise.all(contactIds.map((id) => transaction.get(db().collection("organizationContactPoints").doc(id))));
    if (contacts.some((contact) => !contact.exists || contact.get("organizationId") !== input.organizationId || contact.get("status") !== "active")) throw new HttpsError("invalid-argument", "Route contacts must be active and organization-owned");
    if (input.purpose === "billing" && contacts.some((contact) => contact.get("visibility") === "public")) throw new HttpsError("failed-precondition", "Billing routes must remain private");
    const ref = db().collection("organizationCommunicationRoutes").doc(routeId); const existing = await transaction.get(ref); const previous = existing.data();
    if (previous && previous.organizationId !== input.organizationId) throw new HttpsError("permission-denied", "Route ownership mismatch");
    const currentVersion = Number(previous?.recordVersion ?? 0);
    if (input.expectedRecordVersion !== undefined && input.expectedRecordVersion !== currentVersion) throw new HttpsError("aborted", "Route changed after it was loaded");
    const route = organizationCommunicationRouteSchema.parse({
      id: routeId,
      organizationId: input.organizationId,
      locationId: input.locationId,
      purpose: input.purpose,
      primaryContactPointIds: input.primaryContactPointIds,
      fallbackContactPointIds: input.fallbackContactPointIds,
      fallbackMemberRoles: input.fallbackMemberRoles,
      inAppEnabled: input.inAppEnabled,
      emailEnabled: input.emailEnabled,
      phoneEnabled: input.phoneEnabled,
      status: input.status,
      createdBy: previous?.createdBy ?? actor.uid,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      version: VERSION,
      recordVersion: currentVersion + 1,
    });
    transaction.set(ref, firestoreSafe(route));
    const routeFields: Partial<Record<OrganizationContactPurpose, string>> = {
      general: "defaultGeneralRouteId", referrals: "defaultReferralRouteId",
      opportunities: "defaultOpportunityRouteId", billing: "defaultBillingRouteId",
    };
    const field = !route.locationId ? routeFields[route.purpose] : undefined;
    if (field && route.status === "active") transaction.set(db().collection("orgs").doc(input.organizationId), { [field]: routeId, updatedAt: now }, { merge: true });
    writeExchangeAudit(transaction, db(), { actorUid: actor.uid, actorRole: actor.role, actorOrganizationId: input.organizationId,
      action: existing.exists ? "organization.route.updated" : "organization.route.created", entityType: "organization_communication_route", entityId: routeId, newStatus: route.status, createdAt: now });
    return { success: true, routeId, recordVersion: route.recordVersion };
  });
});

export const exchange_updateOrganizationProfile = onCall(async (request) => {
  const actor = getAuthorizedActor(request); const input = parse(profileInputSchema, request.data); const now = Date.now();
  return db().runTransaction(async (transaction) => {
    const { org } = await loadOrgAuthority(transaction, db(), input.organizationId, actor.uid, { managementRequired: true });
    const currentVersion = Number(org.recordVersion ?? 0); if (input.expectedRecordVersion !== currentVersion) throw new HttpsError("aborted", "Organization changed after it was loaded");
    const profile = organizationProfileV3Schema.parse({
      id: input.organizationId,
      legalName: input.legalName,
      tradeNames: input.tradeNames,
      identifiers: input.identifiers,
      description: input.description,
      domain: input.domain,
      website: input.website,
      industries: input.industries,
      capabilities: input.capabilities,
      certifications: input.certifications,
      media: input.media,
      documents: input.documents,
      publicationStatus: input.publicationStatus,
      primaryLocationId: org.primaryLocationId, headquartersLocationId: org.headquartersLocationId,
      defaultGeneralRouteId: org.defaultGeneralRouteId, defaultReferralRouteId: org.defaultReferralRouteId,
      defaultOpportunityRouteId: org.defaultOpportunityRouteId, defaultBillingRouteId: org.defaultBillingRouteId,
      claimStatus: ["claimed", "claim_pending"].includes(String(org.claimStatus)) ? org.claimStatus : "unclaimed",
      verificationStatus: ["pending", "verified", "rejected"].includes(String(org.verificationStatus)) ? org.verificationStatus : "unverified",
      version: 3, recordVersion: currentVersion + 1 });
    transaction.set(db().collection("orgs").doc(input.organizationId), firestoreSafe({ ...profile, name: profile.legalName,
      publicationApproved: profile.publicationStatus === "approved", updatedAt: now }), { merge: true });
    transaction.set(db().collection("publicOrganizations").doc(input.organizationId), { name: profile.legalName,
      tradeNames: profile.tradeNames, website: profile.website ?? "", industries: profile.industries,
      description: profile.description ?? "", capabilityKeywords: profile.capabilities, certifications: profile.certifications,
      publicationApproved: profile.publicationStatus === "approved", status: profile.publicationStatus === "approved" ? "active" : "inactive", schemaVersion: 3, updatedAt: now }, { merge: true });
    return { success: true, recordVersion: profile.recordVersion, updatedAt: now };
  });
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ownerEnrichmentProposals(profile: FirebaseFirestore.DocumentSnapshot): Array<Record<string, unknown>> {
  const proposals = record(profile.get("enrichmentProposals"));
  return Object.entries(proposals).flatMap(([id, raw]) => {
    const proposal = record(raw);
    const addresses = Array.isArray(proposal.proposedAddresses)
      ? proposal.proposedAddresses.flatMap((item) => {
        const parsed = enrichmentAddressProposalSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
      : [];
    const contacts = Array.isArray(proposal.proposedContacts)
      ? proposal.proposedContacts.flatMap((item) => {
        const parsed = enrichmentContactProposalSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
      : [];
    if (!addresses.length && !contacts.length) return [];
    return [{
      id,
      status: typeof proposal.status === "string" ? proposal.status : "proposed",
      provider: typeof proposal.provider === "string" ? proposal.provider : "external",
      proposedFields: record(proposal.proposedFields),
      proposedAddresses: addresses,
      proposedContacts: contacts,
      decisions: record(proposal.decisions),
      createdAt: Number(proposal.createdAt ?? 0),
    }];
  }).slice(0, 50);
}

export const exchange_getOrganizationManagement = onCall(async (request) => {
  const actor = getAuthorizedActor(request); const input = parse(z.object({ organizationId: ID }).strict(), request.data); await managementAuthority(input.organizationId, actor.uid);
  const [organization, locations, contacts, routes, profile] = await Promise.all([
    db().collection("orgs").doc(input.organizationId).get(), db().collection("organizationLocations").where("organizationId", "==", input.organizationId).get(),
    db().collection("organizationContactPoints").where("organizationId", "==", input.organizationId).get(), db().collection("organizationCommunicationRoutes").where("organizationId", "==", input.organizationId).get(),
    db().collection("profiles").doc(actor.uid).get(),
  ]); const org = organization.data() ?? {};
  return { organization: { id: input.organizationId, legalName: org.legalName ?? org.name ?? "Organization", tradeNames: org.tradeNames ?? [], identifiers: org.identifiers ?? {},
      description: org.description ?? "", domain: org.domain ?? "", website: org.website ?? "", industries: org.industries ?? [], capabilities: org.capabilities ?? org.capabilityKeywords ?? [],
      certifications: org.certifications ?? [], media: org.media ?? [], documents: org.documents ?? [], publicationStatus: org.publicationStatus ?? (org.publicationApproved === true ? "approved" : "draft"),
      primaryLocationId: org.primaryLocationId ?? null, headquartersLocationId: org.headquartersLocationId ?? null, recordVersion: Number(org.recordVersion ?? 0) },
    locations: locations.docs.map((document) => organizationEstablishmentSchema.parse({ id: document.id, ...document.data() })),
    contactPoints: contacts.docs.map((document) => organizationContactPointSchema.parse({ id: document.id, ...document.data() })),
    communicationRoutes: routes.docs.map((document) => organizationCommunicationRouteSchema.parse({ id: document.id, ...document.data() })),
    enrichmentProposals: ownerEnrichmentProposals(profile) };
});

export const exchange_reviewOrganizationEnrichmentProposal = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parse(enrichmentProposalReviewInputSchema, request.data);
  const now = Date.now();
  const resultId = `enrichment_${createHash("sha256").update(`${actor.uid}:${input.proposalId}:${input.itemType}:${input.itemId}`).digest("hex").slice(0, 28)}`;
  return db().runTransaction(async (transaction) => {
    await loadOrgAuthority(transaction, db(), input.organizationId, actor.uid, { managementRequired: true });
    const profileRef = db().collection("profiles").doc(actor.uid);
    const resultRef = db().collection(input.itemType === "address" ? "organizationLocations" : "organizationContactPoints").doc(resultId);
    const [profileSnapshot, allLocations, allContacts, priorResult] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(db().collection("organizationLocations").where("organizationId", "==", input.organizationId)),
      transaction.get(db().collection("organizationContactPoints").where("organizationId", "==", input.organizationId)),
      transaction.get(resultRef),
    ]);
    const profile = profileSnapshot.data();
    if (!profile) throw new HttpsError("failed-precondition", "A person profile is required to review enrichment proposals");
    const proposals = record(profile.enrichmentProposals);
    const proposal = record(proposals[input.proposalId]);
    if (!Object.keys(proposal).length) throw new HttpsError("not-found", "Enrichment proposal unavailable");
    const decisions = record(proposal.decisions);
    const decisionKey = `${input.itemType}:${input.itemId}`;
    const previousDecision = record(decisions[decisionKey]);
    if (Object.keys(previousDecision).length) {
      if (previousDecision.classification === input.classification && previousDecision.organizationId === input.organizationId) {
        return { success: true, idempotent: true, resultId: previousDecision.resultId ?? null, proposalStatus: proposal.status ?? "reviewed" };
      }
      throw new HttpsError("failed-precondition", "This enrichment item already has a recorded decision");
    }

    let published = false;
    let decisionResultId: string | null = null;
    if (input.itemType === "address") {
      const raw = Array.isArray(proposal.proposedAddresses)
        ? proposal.proposedAddresses.find((item) => record(item).id === input.itemId)
        : undefined;
      const proposed = enrichmentAddressProposalSchema.safeParse(raw);
      if (!proposed.success) throw new HttpsError("not-found", "Proposed address unavailable");
      const noCreate = ["duplicate", "not_associated", "unresolved"].includes(input.classification);
      if (!noCreate) {
        if (priorResult.exists && priorResult.get("organizationId") !== input.organizationId) throw new HttpsError("permission-denied", "Proposal result ownership mismatch");
        const existingLocations = allLocations.docs.map((document) => organizationEstablishmentSchema.parse({ id: document.id, ...document.data() }));
        const active = input.classification !== "historical";
        const mailingOnly = input.classification === "mailing_only";
        const privateHome = input.classification === "private_home";
        if (mailingOnly && input.makePrimary) throw new HttpsError("invalid-argument", "A mailing-only proposal cannot be primary");
        if (input.coordinatePublicationApproved && !proposed.data.geocode) throw new HttpsError("failed-precondition", "Coordinate publication requires a proposed coordinate to review");
        if (active && !mailingOnly && !input.makePrimary && !existingLocations.some((location) => location.status === "active" && location.isPrimary)) {
          throw new HttpsError("failed-precondition", "The first active establishment must be explicitly designated primary");
        }
        const priorVersion = Number(priorResult.get("recordVersion") ?? 0);
        const geocode = proposed.data.geocode ? {
          ...proposed.data.geocode,
          source: "enrichment_proposed" as const,
          confirmedByUid: actor.uid,
          confirmedAt: now,
        } : undefined;
        const location = organizationEstablishmentSchema.parse({
          id: resultId, organizationId: input.organizationId,
          name: input.label ?? (privateHome ? `${proposed.data.address.locality} service area` : input.classification === "headquarters" ? "Proposed headquarters" : "Proposed branch"),
          locationType: mailingOnly ? "mailing_only" : privateHome ? "service_location" : input.classification === "headquarters" ? "headquarters" : input.classification === "branch" ? "branch" : "other",
          isHeadquarters: active && input.classification === "headquarters", isPrimary: active && input.makePrimary, status: active ? "active" : "historical",
          physicalAddress: mailingOnly ? undefined : proposed.data.address, mailingAddress: mailingOnly ? proposed.data.address : undefined,
          addressPublicationApproved: privateHome ? false : input.addressPublicationApproved,
          coordinatePublicationApproved: privateHome || mailingOnly ? false : input.coordinatePublicationApproved,
          geocode, serviceArea: { city: proposed.data.address.locality, county: proposed.data.address.county, region: proposed.data.address.administrativeArea, countryCode: proposed.data.address.countryCode },
          publicContactAvailable: false, privateHome,
          createdBy: priorResult.get("createdBy") ?? actor.uid, createdAt: priorResult.get("createdAt") ?? now, updatedAt: now,
          version: VERSION, recordVersion: priorVersion + 1,
        });
        const reassigned = existingLocations.map((existing) => {
          const clearPrimary = location.status === "active" && location.isPrimary && existing.status === "active" && existing.isPrimary;
          const clearHeadquarters = location.status === "active" && location.isHeadquarters && existing.status === "active" && existing.isHeadquarters;
          return clearPrimary || clearHeadquarters ? organizationEstablishmentSchema.parse({
            ...existing, ...(clearPrimary ? { isPrimary: false } : {}), ...(clearHeadquarters ? { isHeadquarters: false } : {}), updatedAt: now, recordVersion: existing.recordVersion + 1,
          }) : existing;
        });
        const nextLocations = [...reassigned.filter((item) => item.id !== location.id), location];
        try { assertOrganizationLocationInvariants(nextLocations); } catch (error) { throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Invalid establishment state"); }
        for (const changed of reassigned.filter((item, index) => item !== existingLocations[index])) {
          transaction.set(db().collection("organizationLocations").doc(changed.id), firestoreSafe(changed));
          const publicRef = db().collection("publicOrganizationLocations").doc(changed.id); const projection = projectPublicEstablishment(changed);
          if (projection) transaction.set(publicRef, firestoreSafe(projection)); else transaction.delete(publicRef);
        }
        transaction.set(resultRef, firestoreSafe(location));
        const publicRef = db().collection("publicOrganizationLocations").doc(resultId); const projection = projectPublicEstablishment(location);
        if (projection) transaction.set(publicRef, firestoreSafe(projection)); else transaction.delete(publicRef);
        await refreshLocationSummary(transaction, input.organizationId, nextLocations, now);
        published = Boolean(projection); decisionResultId = resultId;
      }
    } else {
      const raw = Array.isArray(proposal.proposedContacts)
        ? proposal.proposedContacts.find((item) => record(item).id === input.itemId)
        : undefined;
      const proposed = enrichmentContactProposalSchema.safeParse(raw);
      if (!proposed.success) throw new HttpsError("not-found", "Proposed contact unavailable");
      const noCreate = input.classification === "incorrect";
      if (!noCreate) {
        if (priorResult.exists && priorResult.get("organizationId") !== input.organizationId) throw new HttpsError("permission-denied", "Proposal result ownership mismatch");
        if (input.classification === "location_specific" && !input.locationId) throw new HttpsError("invalid-argument", "A location-specific contact requires an establishment");
        if (input.locationId && !allLocations.docs.some((document) => document.id === input.locationId)) throw new HttpsError("invalid-argument", "Establishment ownership mismatch");
        let normalizedValue: string;
        try { normalizedValue = normalizeContactValue(proposed.data.type, proposed.data.value); } catch (error) { throw new HttpsError("invalid-argument", error instanceof Error ? error.message : "Invalid proposed contact"); }
        if (allContacts.docs.some((document) => document.id !== resultId && document.get("normalizedValue") === normalizedValue && document.get("status") === "active")) {
          throw new HttpsError("already-exists", "An active organization contact already uses this value");
        }
        const isHistorical = input.classification === "historical";
        const isPublic = input.classification === "public";
        const purpose: OrganizationContactPurpose = input.classification === "referral_intake" ? "referrals"
          : input.classification === "procurement" ? "opportunities"
            : input.classification === "location_specific" ? "location_inquiries" : "general";
        const contact = organizationContactPointSchema.parse({
          id: resultId, organizationId: input.organizationId, locationId: input.locationId,
          type: proposed.data.type, purposes: [purpose], normalizedValue, displayValue: proposed.data.value,
          verificationStatus: "unverified", visibility: isPublic ? "public" : "private_operational",
          publicationStatus: isPublic ? "approved" : isHistorical ? "suppressed" : "draft",
          consentAuthorityBasis: "organization_owner_enrichment_review", status: isHistorical ? "historical" : "active",
          createdBy: priorResult.get("createdBy") ?? actor.uid, createdAt: priorResult.get("createdAt") ?? now, updatedAt: now,
          version: VERSION, recordVersion: Number(priorResult.get("recordVersion") ?? 0) + 1,
        });
        transaction.set(resultRef, firestoreSafe(contact));
        const publicRef = db().collection("publicOrganizationContactPoints").doc(resultId); const projection = projectPublicContactPoint(contact);
        if (projection) transaction.set(publicRef, firestoreSafe(projection)); else transaction.delete(publicRef);
        published = Boolean(projection); decisionResultId = resultId;
      }
    }

    const nextDecisions = { ...decisions, [decisionKey]: {
      classification: input.classification, organizationId: input.organizationId, resultId: decisionResultId,
      publicationApproved: published, decidedByUid: actor.uid, decidedAt: now,
    } };
    const allKeys = [
      ...(Array.isArray(proposal.proposedAddresses) ? proposal.proposedAddresses.map((item) => `address:${record(item).id}`) : []),
      ...(Array.isArray(proposal.proposedContacts) ? proposal.proposedContacts.map((item) => `contact:${record(item).id}`) : []),
    ];
    const proposalStatus = allKeys.length > 0 && allKeys.every((key) => Object.prototype.hasOwnProperty.call(nextDecisions, key)) ? "reviewed" : "partially_reviewed";
    transaction.set(profileRef, { enrichmentProposals: {
      ...proposals,
      [input.proposalId]: { ...proposal, decisions: nextDecisions, status: proposalStatus },
    }, updatedAt: now }, { merge: true });
    writeExchangeAudit(transaction, db(), { actorUid: actor.uid, actorRole: actor.role, actorOrganizationId: input.organizationId,
      action: "organization.enrichment_proposal.reviewed", entityType: `enrichment_${input.itemType}_proposal`, entityId: input.itemId,
      newStatus: input.classification, metadata: { proposalId: input.proposalId, resultId: decisionResultId, publicationApproved: published }, createdAt: now });
    return { success: true, idempotent: false, resultId: decisionResultId, proposalStatus, publicProjectionPublished: published };
  });
});

function fallbackRoles(purpose: OrganizationContactPurpose): string[] {
  return purpose === "referrals" ? ["referral_manager", "owner", "admin"]
    : purpose === "opportunities" || purpose === "rfx_responses" ? ["response_team", "owner", "admin"] : ["owner", "admin"];
}

export async function resolveCommunicationRoute(input: {
  db: Db; actorUid: string; actorOrganizationId?: string; organizationId: string; locationId?: string;
  purpose: OrganizationContactPurpose; requestId: string;
}): Promise<{ publicResult: Record<string, unknown>; destinationMemberUids: string[] }> {
  const [routes, contacts, members] = await Promise.all([
    input.db.collection("organizationCommunicationRoutes").where("organizationId", "==", input.organizationId).where("status", "==", "active").get(),
    input.db.collection("organizationContactPoints").where("organizationId", "==", input.organizationId).where("status", "==", "active").get(),
    input.db.collection("orgMembers").where("orgId", "==", input.organizationId).where("status", "==", "active").get(),
  ]);
  const routeRecords = routes.docs.map((document) => organizationCommunicationRouteSchema.parse({ id: document.id, ...document.data() }));
  const locationRoute = input.locationId ? routeRecords.find((route) => route.locationId === input.locationId && route.purpose === input.purpose) : undefined;
  const organizationRoute = routeRecords.find((route) => !route.locationId && route.purpose === input.purpose); const route = locationRoute ?? organizationRoute;
  const contactsById = new Map(contacts.docs.map((document) => [document.id, document.data()]));
  const publicGeneralContact = !route && input.purpose === "general"
    ? contacts.docs.find((document) => document.get("visibility") === "public"
      && document.get("publicationStatus") === "approved"
      && Array.isArray(document.get("purposes"))
      && document.get("purposes").includes("general")
      && (input.locationId ? document.get("locationId") === input.locationId : !document.get("locationId")))
      ?? contacts.docs.find((document) => document.get("visibility") === "public"
        && document.get("publicationStatus") === "approved"
        && Array.isArray(document.get("purposes"))
        && document.get("purposes").includes("general")
        && !document.get("locationId"))
    : undefined;
  const destinationContactPointIds = route
    ? [...route.primaryContactPointIds, ...route.fallbackContactPointIds].filter((id) => contactsById.has(id))
    : publicGeneralContact ? [publicGeneralContact.id] : [];
  const roles = route?.fallbackMemberRoles.length ? route.fallbackMemberRoles : fallbackRoles(input.purpose);
  const destinationMemberUids = publicGeneralContact ? []
    : members.docs.filter((document) => roles.includes(String(document.get("role")))).map((document) => String(document.get("uid")));
  const channels = new Set<string>(); if (route?.inAppEnabled || destinationMemberUids.length || !destinationContactPointIds.length) channels.add("in_app");
  if ((route?.emailEnabled || publicGeneralContact) && destinationContactPointIds.some((id) => contactsById.get(id)?.type === "email")) channels.add("email");
  if ((route?.phoneEnabled || publicGeneralContact) && destinationContactPointIds.some((id) => contactsById.get(id)?.type === "phone")) channels.add("phone"); if (!channels.size) channels.add("in_app");
  const fallbackUsed = locationRoute || publicGeneralContact ? "none" : organizationRoute ? "organization_route" : destinationMemberUids.length ? (roles.includes("referral_manager") || roles.includes("response_team") ? "member_role" : "owner_admin") : "in_app";
  const publicResult = { organizationId: input.organizationId, ...(input.locationId ? { locationId: input.locationId } : {}), purpose: input.purpose,
    ...(route ? { selectedRouteId: route.id } : {}), deliveryChannelTypes: [...channels], publicDisclosureLevel: publicGeneralContact ? "public" : "none", fallbackUsed, auditRequestId: input.requestId };
  await input.db.collection("organizationRouteDeliveries").doc(input.requestId).set({ requestId: input.requestId,
    organizationId: input.organizationId, locationId: input.locationId ?? null, purpose: input.purpose, routeId: route?.id ?? null,
    deliveryChannels: [...channels], deliveryState: "queued_in_app", actorUid: input.actorUid,
    actorOrganizationId: input.actorOrganizationId ?? null, subjectOrganizationId: input.organizationId,
    consentVisibilityBasis: route ? "configured_private_route" : publicGeneralContact ? "approved_public_contact" : "active_member_fallback",
    destinationContactPointIds, destinationMemberUids, createdAt: Date.now(), updatedAt: Date.now() });
  return { publicResult, destinationMemberUids };
}

export const exchange_resolveOrganizationCommunicationRoute = onCall(async (request) => {
  const actor = getAuthorizedActor(request); const input = parse(z.object({ organizationId: ID, actorOrganizationId: ID.optional(), locationId: ID.optional(), purpose: organizationContactPurposeSchema }).strict(), request.data);
  if (input.actorOrganizationId) await db().runTransaction((transaction) => loadOrgAuthority(transaction, db(), input.actorOrganizationId as string, actor.uid));
  const publicOrg = await db().collection("publicOrganizations").doc(input.organizationId).get();
  if (!publicOrg.exists || publicOrg.get("status") !== "active" || publicOrg.get("publicationApproved") !== true) throw new HttpsError("not-found", "Organization unavailable");
  if (input.locationId) { const location = await db().collection("publicOrganizationLocations").doc(input.locationId).get(); if (!location.exists || location.get("organizationId") !== input.organizationId) throw new HttpsError("not-found", "Establishment unavailable"); }
  const requestId = randomUUID(); const result = await resolveCommunicationRoute({ db: db(), actorUid: actor.uid, ...input, requestId });
  const batch = db().batch(); result.destinationMemberUids.forEach((uid) => batch.set(db().collection("notifications").doc(), {
    uid, type: "organization_route", title: input.purpose === "referrals" ? "New referral inquiry" : input.purpose === "opportunities" ? "New opportunity inquiry" : "New organization inquiry",
    body: "A platform member sent a routed organization inquiry.", linkTo: "/notifications", requestId, createdAt: Date.now(), read: false }));
  if (result.destinationMemberUids.length) await batch.commit();
  return { success: true, deliveryState: result.destinationMemberUids.length ? "queued" : "accepted", ...result.publicResult };
});

export const exchange_getActorMapAnchor = onCall(async (request) => {
  const actor = getAuthorizedActor(request); const input = parse(z.object({ organizationId: ID }).strict(), request.data);
  const { org } = await db().runTransaction((transaction) => loadOrgAuthority(transaction, db(), input.organizationId, actor.uid));
  const [profile, locations] = await Promise.all([db().collection("profiles").doc(actor.uid).get(), db().collection("organizationLocations").where("organizationId", "==", input.organizationId).where("status", "==", "active").get()]);
  const preferredId = profile.get("preferredEstablishmentId"); const precedence = [preferredId, org.primaryLocationId, org.headquartersLocationId].filter((value): value is string => typeof value === "string");
  const ordered = [...precedence.map((id) => locations.docs.find((document) => document.id === id)), ...locations.docs].filter(Boolean) as FirebaseFirestore.QueryDocumentSnapshot[];
  const unique = [...new Map(ordered.map((document) => [document.id, document])).values()];
  const selected = unique.find((document) => validCoordinate(document.get("geocode.latitude"), document.get("geocode.longitude")));
  if (!selected) return { anchor: null, source: "released_locality" };
  return { anchor: { latitude: selected.get("geocode.latitude"), longitude: selected.get("geocode.longitude") }, locationId: selected.id,
    source: selected.id === preferredId ? "preferred_establishment" : selected.id === org.primaryLocationId ? "primary_location" : selected.id === org.headquartersLocationId ? "headquarters" : "authorized_location" };
});

export function assertDevelopmentMigrationGuard(projectId: string, apply: boolean, confirmation?: string): void {
  if (apply && (projectId !== "hi-coworking-plat" || confirmation !== "hi-coworking-plat")) throw new Error("Apply requires exact configured development confirmation");
}
