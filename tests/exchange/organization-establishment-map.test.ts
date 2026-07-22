import { describe, expect, it } from "vitest";
import { establishmentMarkers, toOrganizationFeatureCollection } from "../../apps/web/src/features/exchange/map/geojson";
import { normalizeExchangeSelection } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceReducer";

const organization = {
  id: "org_1", name: "One Firm", city: "Smithfield", state: "VA", status: "active",
  claimStatus: "claimed", verificationStatus: "verified", resourceProviderStatus: "not_provider" as const,
  coordinatePublicationApproved: false,
};

describe("multi-location Exchange map context", () => {
  it("renders multiple approved establishment markers without duplicating the organization record", () => {
    const locations = [
      { id: "hq", organizationId: "org_1", name: "Headquarters", locationType: "headquarters" as const,
        isHeadquarters: true, isPrimary: true, addressPublicationApproved: false, coordinatePublicationApproved: true,
        latitude: 36.98, longitude: -76.63, publicContactAvailable: false, version: 1 as const, updatedAt: 1 },
      { id: "branch", organizationId: "org_1", name: "Branch", locationType: "branch" as const,
        isHeadquarters: false, isPrimary: false, addressPublicationApproved: false, coordinatePublicationApproved: true,
        latitude: 36.91, longitude: -76.70, publicContactAvailable: false, version: 1 as const, updatedAt: 1 },
    ];
    const markers = establishmentMarkers([organization], locations);
    const features = toOrganizationFeatureCollection(markers);
    expect(features.features).toHaveLength(2);
    expect(new Set(features.features.map((feature) => feature.properties.organizationId))).toEqual(new Set(["org_1"]));
    expect(features.features.map((feature) => feature.properties.locationId).sort()).toEqual(["branch", "hq"]);
  });

  it("mailing-only, private-home, and unpublished coordinates never enter public GeoJSON", () => {
    const markers = establishmentMarkers([organization], [{
      id: "mail", organizationId: "org_1", name: "Mail", locationType: "mailing_only",
      isHeadquarters: false, isPrimary: false, addressPublicationApproved: true, coordinatePublicationApproved: false,
      publicContactAvailable: false, version: 1, updatedAt: 1,
    }]);
    expect(toOrganizationFeatureCollection(markers).features).toHaveLength(0);
  });

  it("normalizes establishment as durable Secondary context", () => {
    expect(normalizeExchangeSelection({ entityType: "establishment", entityId: "branch", organizationId: "org_1" }))
      .toEqual({ entityType: "establishment", entityId: "branch", organizationId: "org_1" });
  });
});
