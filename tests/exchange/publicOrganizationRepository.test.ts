import { afterEach, describe, expect, it, vi } from "vitest";

const { listOrganizationDirectoryMock } = vi.hoisted(() => ({
  listOrganizationDirectoryMock: vi.fn(),
}));

vi.mock(
  "../../apps/web/src/features/exchange/data/organizationContextGateway",
  () => ({ listOrganizationDirectory: listOrganizationDirectoryMock }),
);

import {
  clearPublicOrganizationsForExchangeCache,
  loadPublicOrganizationsForExchange,
  subscribePublicOrganizationsForExchange,
} from "../../apps/web/src/features/exchange/data/publicOrganizationRepository";

function directoryOrganization(id: string, name: string) {
  return {
    id,
    schemaVersion: 2,
    name,
    normalizedName: name.toLocaleLowerCase(),
    slug: name.toLocaleLowerCase().replace(/\s+/g, "-"),
    city: "Smithfield",
    county: "Isle of Wight",
    state: "VA",
    territoryFips: "51093",
    claimStatus: "unclaimed" as const,
    verificationStatus: "verified",
    organizationType: "business",
    industries: ["Engineering"],
    description: "Public description",
    website: "https://example.test",
    naicsCodes: ["541330"],
    capabilityKeywords: ["stormwater"],
    certifications: ["SWaM"],
    searchTokens: ["engineering", "stormwater"],
    resourceProviderStatus: "approved" as const,
    resourceCategories: ["procurement"],
    issuerStatus: "not_issuer" as const,
    acceptsReferrals: true,
    publicContactAvailable: false,
    status: "active" as const,
    publicationApproved: true as const,
    updatedAt: 1,
    latitude: 36.92,
    longitude: -76.7,
    coordinateConfidence: "authoritative" as const,
    coordinatePublicationApproved: true as const,
  };
}

describe("public organization directory client", () => {
  afterEach(() => {
    listOrganizationDirectoryMock.mockReset();
    clearPublicOrganizationsForExchangeCache();
  });

  it("paginates with an opaque cursor and maps only the browser projection", async () => {
    const first = {
      ...directoryOrganization("org-1", "Alpha Engineering"),
      addressLine1: "Must not enter discovery cache",
      billingEmail: "private@example.test",
    };
    listOrganizationDirectoryMock
      .mockResolvedValueOnce({
        contractVersion: 1,
        organizations: [first, directoryOrganization("org-2", "Beta Works")],
        nextCursor: { name: "Beta Works", organizationId: "org-2" },
        hasMore: true,
        scanned: 2,
      })
      .mockResolvedValueOnce({
        contractVersion: 1,
        organizations: [directoryOrganization("org-3", "Gamma Services")],
        nextCursor: null,
        hasMore: false,
        scanned: 1,
      });

    const organizations = await loadPublicOrganizationsForExchange({
      cacheScope: "user-1",
      force: true,
      maxResults: 3,
    });

    expect(listOrganizationDirectoryMock).toHaveBeenNthCalledWith(1, {
      pageSize: 3,
      cursor: undefined,
    });
    expect(listOrganizationDirectoryMock).toHaveBeenNthCalledWith(2, {
      pageSize: 1,
      cursor: { name: "Beta Works", organizationId: "org-2" },
    });
    expect(organizations.map((organization) => organization.id)).toEqual([
      "org-1",
      "org-2",
      "org-3",
    ]);
    expect(organizations[0]).toMatchObject({
      id: "org-1",
      name: "Alpha Engineering",
      territoryFips: "51093",
      coordinatePublicationApproved: true,
      industries: ["Engineering"],
      resourceProviderStatus: "approved",
      acceptsReferrals: true,
    });
    expect(organizations[0]).not.toHaveProperty("addressLine1");
    expect(organizations[0]).not.toHaveProperty("billingEmail");
    expect(organizations[0]).not.toHaveProperty("searchTokens");

    const cached = await loadPublicOrganizationsForExchange({
      cacheScope: "user-1",
      maxResults: 3,
    });
    expect(cached).toBe(organizations);
    expect(listOrganizationDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it("partitions cache entries by authenticated viewer and publishes forced refreshes", async () => {
    listOrganizationDirectoryMock
      .mockResolvedValueOnce({
        contractVersion: 1,
        organizations: [directoryOrganization("org-a", "Viewer A result")],
        nextCursor: null,
        hasMore: false,
        scanned: 1,
      })
      .mockResolvedValueOnce({
        contractVersion: 1,
        organizations: [directoryOrganization("org-b", "Viewer B result")],
        nextCursor: null,
        hasMore: false,
        scanned: 1,
      })
      .mockResolvedValueOnce({
        contractVersion: 1,
        organizations: [directoryOrganization("org-a2", "Viewer A refreshed")],
        nextCursor: null,
        hasMore: false,
        scanned: 1,
      });

    await expect(loadPublicOrganizationsForExchange({
      cacheScope: "user-a",
    })).resolves.toMatchObject([{ id: "org-a" }]);
    await expect(loadPublicOrganizationsForExchange({
      cacheScope: "user-b",
    })).resolves.toMatchObject([{ id: "org-b" }]);

    const listener = vi.fn();
    const unsubscribe = subscribePublicOrganizationsForExchange("user-a", listener);
    await loadPublicOrganizationsForExchange({
      cacheScope: "user-a",
      force: true,
    });
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({ id: "org-a2" }),
    ]);
    unsubscribe();

    await expect(loadPublicOrganizationsForExchange({
      cacheScope: "user-b",
    })).resolves.toMatchObject([{ id: "org-b" }]);
    expect(listOrganizationDirectoryMock).toHaveBeenCalledTimes(3);
  });

  it("does not let a superseded request repaint an older organization directory", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    listOrganizationDirectoryMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    const first = loadPublicOrganizationsForExchange({ cacheScope: "user-race" });
    const second = loadPublicOrganizationsForExchange({
      cacheScope: "user-race",
      force: true,
    });
    resolveSecond?.({
      contractVersion: 1,
      organizations: [directoryOrganization("new", "New projection")],
      nextCursor: null,
      hasMore: false,
      scanned: 1,
    });
    await expect(second).resolves.toMatchObject([{ id: "new" }]);
    resolveFirst?.({
      contractVersion: 1,
      organizations: [directoryOrganization("old", "Old projection")],
      nextCursor: null,
      hasMore: false,
      scanned: 1,
    });
    await expect(first).resolves.toMatchObject([{ id: "new" }]);
  });

  it("keeps the last safe projection when a forced refresh fails", async () => {
    listOrganizationDirectoryMock
      .mockResolvedValueOnce({
        contractVersion: 1,
        organizations: [directoryOrganization("safe", "Safe projection")],
        nextCursor: null,
        hasMore: false,
        scanned: 1,
      })
      .mockRejectedValueOnce(new Error("temporary outage"));

    await loadPublicOrganizationsForExchange({ cacheScope: "user-safe" });
    await expect(loadPublicOrganizationsForExchange({
      cacheScope: "user-safe",
      force: true,
    })).rejects.toThrow("temporary outage");
    await expect(loadPublicOrganizationsForExchange({
      cacheScope: "user-safe",
    })).resolves.toMatchObject([{ id: "safe" }]);
  });
});
