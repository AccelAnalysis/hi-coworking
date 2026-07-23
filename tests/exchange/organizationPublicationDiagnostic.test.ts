import { describe, expect, it } from "vitest";
import { deriveOrganizationPublicationDiagnostic } from "../../apps/functions/src/exchange/organizationEstablishments";

const organization = {
  status: "active", publicationStatus: "approved", publicationApproved: true,
};
const publicOrganization = {
  status: "active", publicationApproved: true, name: "Organization A",
  normalizedName: "organization a", searchTokens: ["organization", "software"],
};
const privateLocation = {
  organizationId: "org-a", status: "active", locationType: "headquarters", privateHome: false,
  physicalAddress: { line1: "private sentinel" }, coordinatePublicationApproved: true,
  geocode: { latitude: 36.9, longitude: -76.7, confirmedAt: 1, providerPayload: "private sentinel" },
};
const publicLocation = {
  organizationId: "org-a", coordinatePublicationApproved: true, latitude: 36.9, longitude: -76.7,
};

function diagnostic(overrides: Record<string, unknown> = {}) {
  return deriveOrganizationPublicationDiagnostic({
    organizationId: "org-a", privateOrganizationExists: true, privateOrganization: organization,
    publicOrganizationExists: true, publicOrganization, establishmentId: "location-a",
    privateEstablishmentExists: true, privateEstablishment: privateLocation,
    publicEstablishmentExists: true, publicEstablishment: publicLocation, directoryNameMatch: true,
    ...overrides,
  });
}

describe("organization publication diagnostic", () => {
  it("confirms an approved directory and public marker without private values", () => {
    const result = diagnostic();
    expect(result.organization.eligibleForPublicDirectory).toBe(true);
    expect(result.establishment?.markerEligible).toBe(true);
    expect(result.discovery.expectedMarkerId).toBe("location-a");
    expect(JSON.stringify(result)).not.toContain("private sentinel");
  });

  it("keeps list-only organizations searchable without fabricating a marker", () => {
    const result = diagnostic({
      privateEstablishment: { ...privateLocation, locationType: "mailing_only", coordinatePublicationApproved: false },
      publicEstablishmentExists: false,
      publicEstablishment: {},
    });
    expect(result.organization.eligibleForPublicDirectory).toBe(true);
    expect(result.establishment?.markerEligible).toBe(false);
    expect(result.discovery.expectedMarkerId).toBeNull();
  });

  it("fails closed for private-home coordinates", () => {
    const result = diagnostic({ privateEstablishment: { ...privateLocation, privateHome: true } });
    expect(result.establishment?.markerEligible).toBe(false);
    expect(result.establishment?.reason).toContain("Private-home");
  });
});
