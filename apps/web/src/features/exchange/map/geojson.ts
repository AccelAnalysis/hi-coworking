import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import type { PublicOrganizationEstablishment } from "@hi/shared/organization-establishments";

export type ExchangeTerritoryMapStatus = TerritoryDoc["status"];
type ExchangeVisibleTerritoryMapStatus = "released" | "scheduled";

export interface RfxMapProperties {
  entityType: "rfx";
  id: string;
  title: string;
  status: RfxDoc["status"];
  territoryFips: string;
  location: string;
  issuerName: string;
}

export interface TerritoryMapProperties {
  entityType: "territory";
  id: string;
  fips: string;
  name: string;
  state: string;
  status: ExchangeTerritoryMapStatus;
  releaseDate: number;
  releaseLabel: string;
}

export interface PublicOrganizationMapRecord {
  id: string;
  organizationId?: string;
  locationId?: string;
  name: string;
  city?: string;
  state?: string;
  territoryFips?: string;
  status?: string;
  claimStatus?: string;
  verificationStatus?: string;
  latitude?: number;
  longitude?: number;
  homeBased?: boolean;
  privacySuppressed?: boolean;
  coordinatePublicationApproved?: boolean;
  coordinateConfidence?: "authoritative" | "verified" | "approximate";
  naicsCodes?: string[];
  capabilityKeywords?: string[];
  contextType?: "actor" | "subject" | "actor_subject";
  privateActorVisible?: boolean;
}

interface MarkerOrganizationRecord {
  id: string; name: string; city?: string; state?: string; territoryFips?: string;
  status?: string; claimStatus?: string; verificationStatus?: string;
  latitude?: number; longitude?: number; homeBased?: boolean; privacySuppressed?: boolean;
  coordinatePublicationApproved?: boolean; coordinateConfidence?: "authoritative" | "verified" | "approximate";
  naicsCodes?: string[]; capabilityKeywords?: string[];
}

export function establishmentMarkers(
  organizations: readonly MarkerOrganizationRecord[],
  locations: readonly PublicOrganizationEstablishment[],
): PublicOrganizationMapRecord[] {
  const organizationById = new Map(organizations.map((organization) => [organization.id, organization]));
  const locationOrganizationIds = new Set(locations.map((location) => location.organizationId));
  const locationMarkers = locations.flatMap((location) => {
    const organization = organizationById.get(location.organizationId);
    if (!organization || location.coordinatePublicationApproved !== true
      || typeof location.latitude !== "number" || typeof location.longitude !== "number") return [];
    return [{
      id: location.id, organizationId: location.organizationId, locationId: location.id,
      name: `${organization.name} — ${location.name}`,
      city: location.city ?? "", state: location.administrativeArea ?? "",
      territoryFips: organization.territoryFips, status: "active",
      claimStatus: organization.claimStatus, verificationStatus: organization.verificationStatus,
      latitude: location.latitude, longitude: location.longitude,
      coordinatePublicationApproved: true, coordinateConfidence: "verified" as const,
      naicsCodes: organization.naicsCodes, capabilityKeywords: organization.capabilityKeywords,
    }];
  });
  // Compatibility only: approved legacy markers remain until the guarded
  // migration creates public establishment projections.
  return [...locationMarkers, ...organizations.filter((organization) => !locationOrganizationIds.has(organization.id))];
}

export interface OrganizationMapProperties {
  entityType: "organization";
  id: string;
  organizationId?: string;
  locationId?: string;
  name: string;
  city: string;
  state: string;
  territoryFips: string;
  claimStatus: string;
  verificationStatus: string;
  coordinateConfidence: "authoritative" | "verified" | "approximate";
  contextType: "result" | "actor" | "subject" | "actor_subject";
}

export type RfxFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, RfxMapProperties>;
export type OrganizationFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  OrganizationMapProperties
>;
export type TerritoryPointFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  TerritoryMapProperties
>;
export type TerritoryBoundaryGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export type TerritoryBoundaryFeatureCollection = GeoJSON.FeatureCollection<
  TerritoryBoundaryGeometry,
  TerritoryMapProperties
>;

export interface ExchangeMapGeoJson {
  rfx: RfxFeatureCollection;
  organizations: OrganizationFeatureCollection;
  contextOrganizations: OrganizationFeatureCollection;
  releasedTerritoryPoints: TerritoryPointFeatureCollection;
  releasedTerritoryBoundaries: TerritoryBoundaryFeatureCollection;
  scheduledTerritoryPoints: TerritoryPointFeatureCollection;
  scheduledTerritoryBoundaries: TerritoryBoundaryFeatureCollection;
  unreleasedTerritoryBoundaries: TerritoryBoundaryFeatureCollection;
}

export interface ExchangeMapDataBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isPosition(value: unknown): value is GeoJSON.Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    isValidLongitude(value[0]) &&
    isValidLatitude(value[1]) &&
    value.slice(2).every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  );
}

function positionsEqual(left: GeoJSON.Position, right: GeoJSON.Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function isLinearRing(value: unknown): value is GeoJSON.Position[] {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.every(isPosition) &&
    positionsEqual(value[0], value[value.length - 1])
  );
}

function isPolygonCoordinates(value: unknown): value is GeoJSON.Position[][] {
  return Array.isArray(value) && value.length > 0 && value.every(isLinearRing);
}

function isMultiPolygonCoordinates(value: unknown): value is GeoJSON.Position[][][] {
  return Array.isArray(value) && value.length > 0 && value.every(isPolygonCoordinates);
}

/**
 * Territory boundary data is intentionally runtime-validated. The shared
 * contract accepts arbitrary JSON for legacy compatibility, while Mapbox fill
 * layers only accept finite, closed Polygon or MultiPolygon rings here.
 */
export function parseTerritoryBoundaryGeometry(value: unknown): TerritoryBoundaryGeometry | null {
  if (!isRecord(value) || typeof value.type !== "string" || !("coordinates" in value)) {
    return null;
  }

  if (value.type === "Polygon" && isPolygonCoordinates(value.coordinates)) {
    return { type: "Polygon", coordinates: value.coordinates };
  }

  if (value.type === "MultiPolygon" && isMultiPolygonCoordinates(value.coordinates)) {
    return { type: "MultiPolygon", coordinates: value.coordinates };
  }

  return null;
}

function territoryProperties(
  territory: TerritoryDoc,
  requestedStatus: ExchangeVisibleTerritoryMapStatus | "unreleased",
): TerritoryMapProperties | null {
  const fips = typeof territory.fips === "string" ? territory.fips.trim() : "";
  const matchesStatus = requestedStatus === "unreleased"
    ? territory.status === "paused" || territory.status === "archived"
    : territory.status === requestedStatus;
  if (!fips || !matchesStatus) return null;

  const status = territory.status;
  const releaseDate =
    typeof territory.releaseDate === "number" && Number.isFinite(territory.releaseDate)
      ? territory.releaseDate
      : 0;

  return {
    entityType: "territory",
    id: fips,
    fips,
    name: typeof territory.name === "string" && territory.name.trim() ? territory.name : "Territory",
    state: typeof territory.state === "string" ? territory.state : "",
    status,
    releaseDate,
    releaseLabel:
      status === "scheduled" && releaseDate > 0
        ? `Releases ${new Date(releaseDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}`
        : "",
  };
}

export function toRfxFeatureCollection(rfxList: readonly RfxDoc[]): RfxFeatureCollection {
  const features: Array<GeoJSON.Feature<GeoJSON.Point, RfxMapProperties>> = [];

  for (const rfx of rfxList) {
    const id = typeof rfx.id === "string" ? rfx.id.trim() : "";
    const lng = rfx.geo?.lng;
    const lat = rfx.geo?.lat;

    if (!id || !isValidLongitude(lng) || !isValidLatitude(lat)) continue;

    features.push({
      type: "Feature",
      id,
      properties: {
        entityType: "rfx",
        id,
        title: typeof rfx.title === "string" ? rfx.title : "RFx opportunity",
        status: rfx.status,
        territoryFips: typeof rfx.territoryFips === "string" ? rfx.territoryFips : "",
        location: typeof rfx.location === "string" ? rfx.location : "",
        issuerName: typeof rfx.createdByName === "string" ? rfx.createdByName : "",
      },
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Public organization points are accepted only from the server-maintained
 * projection and only when an explicit permitted coordinate survives every
 * privacy check. Suppressed/list-only organizations are deliberately omitted.
 */
export function toOrganizationFeatureCollection(
  organizations: readonly PublicOrganizationMapRecord[],
  defaultContextType: OrganizationMapProperties["contextType"] = "result",
): OrganizationFeatureCollection {
  const features: Array<GeoJSON.Feature<GeoJSON.Point, OrganizationMapProperties>> = [];

  for (const organization of organizations) {
    const id = typeof organization.id === "string" ? organization.id.trim() : "";
    const name = typeof organization.name === "string" ? organization.name.trim() : "";
    const longitude = organization.longitude;
    const latitude = organization.latitude;
    if (
      !id
      || !name
      || organization.status !== "active"
      || (organization.privateActorVisible !== true && organization.homeBased === true)
      || (organization.privateActorVisible !== true && organization.privacySuppressed === true)
      || (organization.privateActorVisible !== true && organization.coordinatePublicationApproved !== true)
      || !isValidLongitude(longitude)
      || !isValidLatitude(latitude)
    ) continue;

    features.push({
      type: "Feature",
      id,
      properties: {
        entityType: "organization",
        id,
        ...(organization.organizationId ? { organizationId: organization.organizationId } : {}),
        ...(organization.locationId ? { locationId: organization.locationId } : {}),
        name,
        city: typeof organization.city === "string" ? organization.city : "",
        state: typeof organization.state === "string" ? organization.state : "",
        territoryFips: typeof organization.territoryFips === "string"
          ? organization.territoryFips
          : "",
        claimStatus: typeof organization.claimStatus === "string" ? organization.claimStatus : "unclaimed",
        verificationStatus: typeof organization.verificationStatus === "string"
          ? organization.verificationStatus
          : "unverified",
        coordinateConfidence: organization.coordinateConfidence ?? "approximate",
        contextType: organization.contextType ?? defaultContextType,
      },
      geometry: { type: "Point", coordinates: [longitude, latitude] },
    });
  }

  return { type: "FeatureCollection", features };
}

export function toTerritoryPointFeatureCollection(
  territories: readonly TerritoryDoc[],
  status: ExchangeVisibleTerritoryMapStatus,
): TerritoryPointFeatureCollection {
  const features: Array<GeoJSON.Feature<GeoJSON.Point, TerritoryMapProperties>> = [];

  for (const territory of territories) {
    const properties = territoryProperties(territory, status);
    const lng = territory.centroid?.lng;
    const lat = territory.centroid?.lat;
    if (!properties || !isValidLongitude(lng) || !isValidLatitude(lat)) continue;

    features.push({
      type: "Feature",
      id: properties.id,
      properties,
      geometry: { type: "Point", coordinates: [lng, lat] },
    });
  }

  return { type: "FeatureCollection", features };
}

export function toTerritoryBoundaryFeatureCollection(
  territories: readonly TerritoryDoc[],
  status: ExchangeVisibleTerritoryMapStatus | "unreleased",
): TerritoryBoundaryFeatureCollection {
  const features: Array<GeoJSON.Feature<TerritoryBoundaryGeometry, TerritoryMapProperties>> = [];

  for (const territory of territories) {
    const properties = territoryProperties(territory, status);
    const geometry = parseTerritoryBoundaryGeometry(territory.boundaryGeoJSON);
    if (!properties || !geometry) continue;

    features.push({
      type: "Feature",
      id: properties.id,
      properties,
      geometry,
    });
  }

  return { type: "FeatureCollection", features };
}

export function buildExchangeMapGeoJson(
  rfxList: readonly RfxDoc[],
  releasedTerritories: readonly TerritoryDoc[],
  scheduledTerritories: readonly TerritoryDoc[],
  unreleasedTerritories: readonly TerritoryDoc[] = [],
  organizations: readonly PublicOrganizationMapRecord[] = [],
  contextOrganizations: readonly PublicOrganizationMapRecord[] = [],
): ExchangeMapGeoJson {
  return {
    rfx: toRfxFeatureCollection(rfxList),
    organizations: toOrganizationFeatureCollection(organizations),
    contextOrganizations: toOrganizationFeatureCollection(contextOrganizations, "subject"),
    releasedTerritoryPoints: toTerritoryPointFeatureCollection(releasedTerritories, "released"),
    releasedTerritoryBoundaries: toTerritoryBoundaryFeatureCollection(releasedTerritories, "released"),
    scheduledTerritoryPoints: toTerritoryPointFeatureCollection(scheduledTerritories, "scheduled"),
    scheduledTerritoryBoundaries: toTerritoryBoundaryFeatureCollection(scheduledTerritories, "scheduled"),
    unreleasedTerritoryBoundaries: toTerritoryBoundaryFeatureCollection(unreleasedTerritories, "unreleased"),
  };
}

function visitPositionBounds(
  position: GeoJSON.Position,
  bounds: ExchangeMapDataBounds | null,
): ExchangeMapDataBounds {
  const [longitude, latitude] = position;
  if (!bounds) {
    return { west: longitude, east: longitude, south: latitude, north: latitude };
  }
  return {
    west: Math.min(bounds.west, longitude),
    east: Math.max(bounds.east, longitude),
    south: Math.min(bounds.south, latitude),
    north: Math.max(bounds.north, latitude),
  };
}

/** Bounds over discoverable RFx points and released/scheduled territory data. */
export function getExchangeMapDataBounds(data: ExchangeMapGeoJson): ExchangeMapDataBounds | null {
  let bounds: ExchangeMapDataBounds | null = null;

  const pointCollections = [
    data.rfx,
    data.organizations,
    data.contextOrganizations,
    data.releasedTerritoryPoints,
    data.scheduledTerritoryPoints,
  ];
  for (const collection of pointCollections) {
    for (const feature of collection.features) {
      bounds = visitPositionBounds(feature.geometry.coordinates, bounds);
    }
  }

  const boundaryCollections = [
    data.releasedTerritoryBoundaries,
    data.scheduledTerritoryBoundaries,
  ];
  for (const collection of boundaryCollections) {
    for (const feature of collection.features) {
      if (feature.geometry.type === "Polygon") {
        for (const ring of feature.geometry.coordinates) {
          for (const position of ring) bounds = visitPositionBounds(position, bounds);
        }
      } else {
        for (const polygon of feature.geometry.coordinates) {
          for (const ring of polygon) {
            for (const position of ring) bounds = visitPositionBounds(position, bounds);
          }
        }
      }
    }
  }

  return bounds;
}
