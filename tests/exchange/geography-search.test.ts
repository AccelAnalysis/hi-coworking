import { describe, expect, it } from "vitest";
import { searchManagedTerritories } from "../../apps/web/src/features/exchange/onboarding/geographySearch";

const territories = [
  { fips: "51093", name: "Isle of Wight County", state: "VA", status: "released" as const, type: "county" as const },
  { fips: "51740", name: "Portsmouth", state: "VA", status: "scheduled" as const, type: "city" as const },
  { fips: "51095", name: "James City County", state: "VA", status: "paused" as const, type: "county" as const },
];

describe("onboarding managed geography search", () => {
  it("prioritizes released and scheduled communities when no query is entered", () => {
    const results = searchManagedTerritories("", territories);
    expect(results.map((result) => result.territory?.fips)).toEqual(["51093", "51740"]);
    expect(results.map((result) => result.availability)).toEqual(["released", "scheduled"]);
  });

  it("matches locality names without requiring the word county", () => {
    const results = searchManagedTerritories("Isle of Wight", territories);
    expect(results[0]?.territory?.fips).toBe("51093");
    expect(results[0]?.availability).toBe("released");
  });

  it("matches a managed territory by FIPS and preserves unavailable status", () => {
    const results = searchManagedTerritories("51095", territories);
    expect(results[0]?.territory?.name).toBe("James City County");
    expect(results[0]?.availability).toBe("unavailable");
  });
});
