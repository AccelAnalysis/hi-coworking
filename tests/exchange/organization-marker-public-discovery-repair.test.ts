import { beforeEach, describe, expect, it, vi } from "vitest";

import { exchangeWorkspaceActions } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceActions";
import { exchangeWorkspaceReducer } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceReducer";
import { createInitialExchangeWorkspaceState } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceTypes";
import { exchangeUrlStateToString } from "../../apps/web/src/features/exchange/state/exchangeUrlState";
import { toServerSecondary } from "../../apps/web/src/features/exchange/data/organizationContextKey";
import { listOrganizationDirectory } from "../../apps/web/src/features/exchange/data/organizationContextGateway";
import {
  clearPublicOrganizationsForExchangeCache,
  loadPublicOrganizationsForExchange,
} from "../../apps/web/src/features/exchange/data/publicOrganizationRepository";

vi.mock("../../apps/web/src/features/exchange/data/organizationContextGateway", () => ({
  listOrganizationDirectory: vi.fn(),
}));

const publicOrganization = {
  id: "org-a",
  schemaVersion: 3,
  name: "Organization A LLC",
  normalizedName: "organization a",
  slug: "organization-a-org-a",
  city: "Smithfield",
  county: "Isle of Wight",
  state: "VA",
  territoryFips: "51093",
  claimStatus: "claimed" as const,
  verificationStatus: "verified",
  organizationType: "business",
  industries: ["Technology"],
  description: "Public organization",
  website: "https://example.test",
  naicsCodes: ["541511"],
  capabilityKeywords: ["software"],
  certifications: ["small business"],
  searchTokens: ["organization", "software"],
  resourceProviderStatus: "not_provider" as const,
  resourceCategories: [],
  issuerStatus: "not_issuer" as const,
  acceptsReferrals: true,
  publicContactAvailable: true,
  publicLocationCount: 1,
  status: "active" as const,
  publicationApproved: true as const,
  updatedAt: 1,
};

describe("organization marker selection contract", () => {
  it("serializes an establishment as the shared server secondary contract", () => {
    expect(toServerSecondary({
      entityType: "establishment",
      entityId: "location-a",
      organizationId: "org-a",
    })).toEqual({ type: "establishment", id: "location-a" });
  });

  it("selects organization and establishment in one reducer transition and one URL snapshot", () => {
    const initial = createInitialExchangeWorkspaceState();
    const action = exchangeWorkspaceActions.selectOrganizationEstablishment(
      "org-a",
      "location-a",
    );

    expect(action.type).toBe("HYDRATE_FROM_URL");
    const selected = exchangeWorkspaceReducer(initial, action);
    expect(selected.subjectOrganizationId).toBe("org-a");
    expect(selected.secondaryContext).toEqual({
      entityType: "establishment",
      entityId: "location-a",
      organizationId: "org-a",
    });
    expect(selected.selection).toEqual(selected.secondaryContext);
    expect(selected.organizationDrawerOpen).toBe(true);
    expect(selected.rightPanelOpen).toBe(true);
    expect(selected.mobileDetailOpen).toBe(true);

    const query = exchangeUrlStateToString(selected);
    expect(query).toContain("subjectOrganizationId=org-a");
    expect(query).toContain("secondaryType=establishment");
    expect(query).toContain("secondaryId=location-a");
  });

  it("selects a list-only organization without fabricating an establishment", () => {
    const selected = exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      exchangeWorkspaceActions.selectOrganization("org-list-only"),
    );
    expect(selected.subjectOrganizationId).toBe("org-list-only");
    expect(selected.secondaryContext).toBeNull();
    expect(selected.selection).toEqual({
      entityType: "organization",
      entityId: "org-list-only",
    });
    expect(selected.organizationDrawerOpen).toBe(true);
  });
});

describe("server-backed public organization directory cache", () => {
  beforeEach(() => {
    clearPublicOrganizationsForExchangeCache();
    vi.clearAllMocks();
    vi.mocked(listOrganizationDirectory).mockResolvedValue({
      contractVersion: 1,
      organizations: [publicOrganization],
      nextCursor: null,
      hasMore: false,
      scanned: 1,
    });
  });

  it("deduplicates concurrent requests and keeps cache identity bound", async () => {
    const request = {
      cacheScope: "viewer-a",
      query: "Organization A",
      maxResults: 50,
      ttlMs: 30_000,
    };
    const [first, second] = await Promise.all([
      loadPublicOrganizationsForExchange(request),
      loadPublicOrganizationsForExchange(request),
    ]);

    expect(first).toEqual(second);
    expect(first.map((organization) => organization.id)).toEqual(["org-a"]);
    expect(listOrganizationDirectory).toHaveBeenCalledTimes(1);

    await loadPublicOrganizationsForExchange(request);
    expect(listOrganizationDirectory).toHaveBeenCalledTimes(1);

    await loadPublicOrganizationsForExchange({ ...request, cacheScope: "viewer-b" });
    expect(listOrganizationDirectory).toHaveBeenCalledTimes(2);
  });

  it("force refresh supersedes a valid TTL entry", async () => {
    const request = { cacheScope: "viewer-a", maxResults: 50, ttlMs: 30_000 };
    await loadPublicOrganizationsForExchange(request);
    await loadPublicOrganizationsForExchange({ ...request, force: true });
    expect(listOrganizationDirectory).toHaveBeenCalledTimes(2);
  });

  it("does not poison the cache after a rejected request", async () => {
    vi.mocked(listOrganizationDirectory)
      .mockRejectedValueOnce(new Error("temporary callable failure"))
      .mockResolvedValueOnce({
        contractVersion: 1,
        organizations: [publicOrganization],
        nextCursor: null,
        hasMore: false,
        scanned: 1,
      });

    await expect(loadPublicOrganizationsForExchange({ cacheScope: "viewer-a" }))
      .rejects.toThrow("temporary callable failure");
    await expect(loadPublicOrganizationsForExchange({ cacheScope: "viewer-a" }))
      .resolves.toHaveLength(1);
    expect(listOrganizationDirectory).toHaveBeenCalledTimes(2);
  });
});
