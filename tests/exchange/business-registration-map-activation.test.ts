import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toOrganizationFeatureCollection } from "../../apps/web/src/features/exchange/map/geojson";
import { updateExchangeSelectedOrganizationSource } from "../../apps/web/src/features/exchange/map/mapSources";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("business registration and map activation", () => {
  it("requires representative attestation and offers no individual bypass", () => {
    const registration = source("apps/web/src/app/register/page.tsx");
    const onboarding = source("apps/web/src/app/exchange/onboarding/page.tsx");
    expect(registration).toContain("authorized representative of a business or organization");
    expect(registration).toContain("businessRepresentativeAttestation: attested");
    expect(registration).toContain('registrationVersion: 2');
    expect(registration).toContain('router.push("/exchange/onboarding")');
    expect(`${registration}\n${onboarding}`).not.toMatch(/Browse as individual|Skip for now|continue using the Exchange without one/i);
  });

  it("permits a governed claim against an existing claimed organization without granting pending authority", () => {
    const organizations = source("apps/functions/src/exchange/organizations.ts");
    const activation = source("apps/functions/src/exchange/businessActivation.ts");
    expect(organizations).not.toContain('data.claimStatus !== "claimed"');
    expect(organizations).not.toContain("This organization is already claimed.");
    expect(organizations).toContain("A governed competing claim must not demote an already-claimed");
    expect(activation).toContain('if (input.claimPending && !input.authorized) return "claim_pending"');
    expect(activation).toContain('"organization_management"');
  });

  it("lifts the one dimension control above workspace surfaces", () => {
    const map = source("apps/web/src/features/exchange/map/ExchangeMap.tsx");
    const workspace = source("apps/web/src/features/exchange/components/ExchangeWorkspace.tsx");
    const controls = source("apps/web/src/features/exchange/components/ExchangeMapControls.tsx");
    expect(map).not.toContain('aria-label="Map dimension"');
    expect(workspace).toContain("<ExchangeMapControls");
    expect(controls).toContain('data-exchange-map-control-layer');
    expect(controls).toContain('role="group"');
    expect(controls).toContain('aria-label="Map dimension"');
    expect(controls).toContain("z-[1200]");
  });

  it("allows a server-authorized private actor point without weakening public gates", () => {
    const privateFeatures = toOrganizationFeatureCollection([{
      id: "location_private",
      organizationId: "org_1",
      locationId: "location_private",
      name: "Firm — Headquarters",
      status: "active",
      latitude: 36.98,
      longitude: -76.63,
      coordinatePublicationApproved: false,
      privateActorVisible: true,
      contextType: "actor",
    }], "actor");
    expect(privateFeatures.features).toHaveLength(1);
    expect(toOrganizationFeatureCollection([{
      id: "location_external",
      name: "External private point",
      status: "active",
      latitude: 36.98,
      longitude: -76.63,
      coordinatePublicationApproved: false,
    }]).features).toHaveLength(0);
  });

  it("keeps an establishment selected even when the public source would cluster it", () => {
    const selectedData: Parameters<typeof updateExchangeSelectedOrganizationSource>[1] = {
      rfx: { type: "FeatureCollection", features: [] },
      organizations: { type: "FeatureCollection", features: [] },
      contextOrganizations: {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          id: "location_1",
          properties: {
            entityType: "organization",
            id: "location_1",
            organizationId: "org_1",
            locationId: "location_1",
            name: "HQ",
            city: "",
            state: "",
            territoryFips: "",
            claimStatus: "claimed",
            verificationStatus: "unverified",
            coordinateConfidence: "authoritative",
            contextType: "actor",
          },
          geometry: { type: "Point", coordinates: [-76.63, 36.98] },
        }],
      },
      releasedTerritoryPoints: { type: "FeatureCollection", features: [] },
      releasedTerritoryBoundaries: { type: "FeatureCollection", features: [] },
      scheduledTerritoryPoints: { type: "FeatureCollection", features: [] },
      scheduledTerritoryBoundaries: { type: "FeatureCollection", features: [] },
      unreleasedTerritoryBoundaries: { type: "FeatureCollection", features: [] },
    };
    let selectedFeatures: unknown[] = [];
    const map = {
      getSource: () => ({
        type: "geojson",
        setData: (data: { features: unknown[] }) => {
          selectedFeatures = data.features;
        },
      }),
    };
    updateExchangeSelectedOrganizationSource(
      map as never,
      selectedData,
      { entityType: "establishment", entityId: "location_1", organizationId: "org_1" },
    );
    expect(selectedFeatures).toHaveLength(1);
  });
});
