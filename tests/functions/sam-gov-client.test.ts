import { describe, expect, it, vi } from "vitest";
import {
  buildSamGovEntitySearchUrl,
  parseSamGovEntityResponse,
  requestSamGovEntities,
} from "../../apps/functions/src/providers/samGovClient";

describe("SAM.gov entity client", () => {
  it("uses the public v4 GET endpoint and documented name/location parameters", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ entityData: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await requestSamGovEntities({
      businessName: "Example LLC",
      city: "Smithfield",
      state: "va",
    }, "server-secret", { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(requestUrl.origin + requestUrl.pathname)
      .toBe("https://api.sam.gov/entity-information/v4/entities");
    expect(init.method).toBe("GET");
    expect(requestUrl.searchParams.get("includeSections"))
      .toBe("entityRegistration,coreData");
    expect(requestUrl.searchParams.get("legalBusinessName")).toBe("Example LLC");
    expect(requestUrl.searchParams.get("physicalAddressCity")).toBe("Smithfield");
    expect(requestUrl.searchParams.get("physicalAddressProvinceOrStateCode")).toBe("VA");
    expect(requestUrl.searchParams.has("physicalStateOrProvince")).toBe(false);
  });

  it("prioritizes UEI and CAGE identifiers over broad name/location filters", () => {
    const byUei = buildSamGovEntitySearchUrl({
      businessName: "Ignored Name",
      state: "VA",
      uei: "abc123def456",
      cage: "1abcd",
    }, "server-secret");
    expect(byUei.searchParams.get("ueiSAM")).toBe("ABC123DEF456");
    expect(byUei.searchParams.has("cageCode")).toBe(false);
    expect(byUei.searchParams.has("legalBusinessName")).toBe(false);

    const byCage = buildSamGovEntitySearchUrl({
      businessName: "Ignored Name",
      cage: "1abcd",
    }, "server-secret");
    expect(byCage.searchParams.get("cageCode")).toBe("1ABCD");
    expect(byCage.searchParams.has("legalBusinessName")).toBe(false);
  });

  it("parses nested entityRegistration and coreData records", () => {
    expect(parseSamGovEntityResponse({
      entityData: [{
        entityRegistration: {
          legalBusinessName: "Example Federal Supplier LLC",
          ueiSAM: "ABC123DEF456",
          cageCode: "1ABCD",
          registrationStatus: "Active",
          registrationExpirationDate: "2027-01-31",
        },
        coreData: {
          physicalAddress: { city: "Smithfield", stateOrProvinceCode: "va" },
          businessTypes: {
            businessTypeList: [{ businessTypeDesc: "Small Business" }],
            sbaBusinessTypeList: [{ sbaBusinessTypeDesc: "Women-Owned Small Business" }],
          },
        },
      }],
    }, "Fallback LLC")).toEqual([{
      legalName: "Example Federal Supplier LLC",
      city: "Smithfield",
      state: "VA",
      uei: "ABC123DEF456",
      cage: "1ABCD",
      registrationStatus: "Active",
      registrationExpirationDate: "2027-01-31",
      businessTypes: ["Small Business", "Women-Owned Small Business"],
    }]);
  });

  it("returns safe SAM diagnostics without retaining the API key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: "The search parameter does not exist for api_key=server-secret",
      detail: "Use server-secret with a supported parameter",
      errorCode: "INVALID_PARAMETER",
      transaction_id: "transaction-one",
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));

    const result = await requestSamGovEntities({
      businessName: "Example LLC",
      state: "VA",
    }, "server-secret", { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(result).toMatchObject({
      status: "unavailable",
      error: {
        status: 400,
        errorCode: "INVALID_PARAMETER",
        transactionId: "transaction-one",
      },
    });
    expect(JSON.stringify(result)).not.toContain("server-secret");
  });
});
