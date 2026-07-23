import { describe, expect, it } from "vitest";
import {
  normalizeActorOrganizationRequest,
  normalizeBusinessReferralListMineInput,
  normalizeOrganizationDirectoryRequest,
} from "../../apps/web/src/lib/callableReadPayloads";

describe("read callable payload normalization", () => {
  it("drops an invalid stale Actor selection and disables persistence", () => {
    expect(normalizeActorOrganizationRequest({
      requestedActorOrganizationId: " stale/actor ",
      persistSelection: true,
      unexpected: "ignored",
    })).toEqual({ contractVersion: 1, persistSelection: false });
  });

  it("sends only directory values accepted by the strict server schema", () => {
    expect(normalizeOrganizationDirectoryRequest({
      query: "  Accel   Analysis  ",
      pageSize: 500,
      filters: {
        industries: [" Consulting ", "Consulting", ""],
        naicsCodes: ["541611", "not-naics", "12"],
        claimStatus: "invalid",
        resourceProviderStatus: "approved",
      },
      cursor: { name: "A", organizationId: "bad/id" },
      unexpected: true,
    })).toEqual({
      contractVersion: 1,
      query: "Accel Analysis",
      filters: {
        industries: ["Consulting"],
        naicsCodes: ["541611", "12"],
        resourceProviderStatus: "approved",
      },
      pageSize: 50,
    });
  });

  it("removes stale organization context from all-scope referral reads", () => {
    expect(normalizeBusinessReferralListMineInput({
      direction: "all",
      scope: "all",
      actorOrganizationId: "stale-org",
      statuses: ["sent", "all", "sent", "bad"],
      territoryFips: "5109",
      limit: 0,
      cursor: { createdAt: -1, id: "bad/id" },
    })).toEqual({ direction: "all", scope: "all", statuses: ["sent"], limit: 1 });
  });

  it("fails closed to individual scope when an organization selection is invalid", () => {
    expect(normalizeBusinessReferralListMineInput({
      direction: "received",
      scope: "organization",
      actorOrganizationId: "invalid/org",
      statuses: [],
      limit: 25,
    })).toEqual({ direction: "received", scope: "individual", statuses: [], limit: 25 });
  });
});
