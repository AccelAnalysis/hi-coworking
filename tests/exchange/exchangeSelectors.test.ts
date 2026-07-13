import { describe, expect, it } from "vitest";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import {
  createExchangeResultsSelector,
  selectDiscoverableRfx,
  selectDiscoverableTerritories,
  selectFilteredRfx,
  selectFilteredTerritories,
} from "../../apps/web/src/features/exchange/data/exchangeSelectors";
import { createInitialExchangeWorkspaceState } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceTypes";

function rfx(
  id: string,
  overrides: Partial<RfxDoc> = {},
): RfxDoc {
  return {
    id,
    title: `Opportunity ${id}`,
    description: "Engineering and construction services",
    status: "open",
    adminApprovalStatus: "approved",
    memberOnly: false,
    createdBy: "issuer-1",
    createdByName: "Regional Water Authority",
    evaluationCriteria: [],
    requestedDocuments: [],
    responseCount: 0,
    createdAt: 100,
    ...overrides,
  };
}

function territory(
  fips: string,
  status: TerritoryDoc["status"],
  overrides: Partial<TerritoryDoc> = {},
): TerritoryDoc {
  return {
    fips,
    name: `Territory ${fips}`,
    state: "VA",
    status,
    createdAt: 100,
    ...overrides,
  };
}

describe("Exchange selectors", () => {
  it("admits only approved, open RFx records", () => {
    const records = [
      rfx("approved-open"),
      rfx("pending-open", { adminApprovalStatus: "pending" }),
      rfx("approved-closed", { status: "closed" }),
      rfx("rejected-open", { adminApprovalStatus: "rejected" }),
    ];
    expect(selectDiscoverableRfx(records).map((record) => record.id)).toEqual([
      "approved-open",
    ]);
  });

  it("admits released and scheduled territories only", () => {
    const records = [
      territory("released", "released"),
      territory("scheduled", "scheduled"),
      territory("paused", "paused"),
      territory("archived", "archived"),
    ];
    expect(
      selectDiscoverableTerritories(records).map((record) => record.fips),
    ).toEqual(["released", "scheduled"]);
  });

  it("searches public RFx fields case-insensitively", () => {
    const records = [
      rfx("water", { title: "Stormwater Improvements", location: "Smithfield" }),
      rfx("roads", { title: "Road resurfacing", location: "Suffolk" }),
    ];
    const state = {
      ...createInitialExchangeWorkspaceState(),
      searchQuery: "SMITHFIELD",
    };
    expect(selectFilteredRfx(records, state).map((record) => record.id)).toEqual([
      "water",
    ]);
  });

  it("combines NAICS hierarchy, territory, and RFx status filters", () => {
    const records = [
      rfx("match", { naicsCodes: ["541511"], territoryFips: "51093" }),
      rfx("wrong-naics", { naicsCodes: ["236220"], territoryFips: "51093" }),
      rfx("wrong-territory", { naicsCodes: ["541330"], territoryFips: "51740" }),
    ];
    const state = {
      ...createInitialExchangeWorkspaceState(),
      naicsFilters: ["54"],
      territoryFilters: ["51093"],
      rfxStatusFilters: ["open" as const],
    };
    expect(selectFilteredRfx(records, state).map((record) => record.id)).toEqual([
      "match",
    ]);
  });

  it("filters territory results by search, FIPS, and released/scheduled status", () => {
    const records = [
      territory("51093", "released", { name: "Isle of Wight" }),
      territory("51740", "scheduled", { name: "Portsmouth" }),
      territory("51800", "scheduled", { name: "Suffolk" }),
    ];
    const state = {
      ...createInitialExchangeWorkspaceState(),
      searchQuery: "portsmouth",
      territoryFilters: ["51740", "51800"],
      territoryStatusFilters: ["scheduled" as const],
    };
    expect(
      selectFilteredTerritories(records, state).map((record) => record.fips),
    ).toEqual(["51740"]);
  });

  it("uses released-territory priority as stable ranking without dropping other RFx", () => {
    const records = [
      rfx("remote", { territoryFips: "51740" }),
      rfx("local", { territoryFips: "51093" }),
      rfx("unscoped", { territoryFips: undefined }),
    ];
    const state = createInitialExchangeWorkspaceState();
    expect(
      selectFilteredRfx(records, state, { priorityTerritoryFips: ["51093"] })
        .map((record) => record.id),
    ).toEqual(["local", "remote", "unscoped"]);
  });

  it("does not treat territory release as RFx transaction eligibility", () => {
    const records = [
      rfx("scheduled-area-rfx", { territoryFips: "51740" }),
      rfx("released-area-rfx", { territoryFips: "51093" }),
    ];
    const state = createInitialExchangeWorkspaceState();
    const result = selectFilteredRfx(records, state, {
      priorityTerritoryFips: ["51740"],
    });

    // The scheduled-area record can rank locally and both remain discoverable.
    // Authorization and transaction gates are intentionally not selector inputs.
    expect(result.map((record) => record.id)).toEqual([
      "scheduled-area-rfx",
      "released-area-rfx",
    ]);
  });

  it("keeps released and scheduled result groups and memoizes immutable inputs", () => {
    const rfxRecords = [rfx("one")];
    const territories = [
      territory("51093", "released"),
      territory("51740", "scheduled"),
    ];
    const state = createInitialExchangeWorkspaceState();
    const selector = createExchangeResultsSelector();
    const first = selector(rfxRecords, territories, state);
    const second = selector(rfxRecords, territories, state);

    expect(second).toBe(first);
    expect(first.releasedTerritories.map((record) => record.fips)).toEqual([
      "51093",
    ]);
    expect(first.scheduledTerritories.map((record) => record.fips)).toEqual([
      "51740",
    ]);
    expect(selector(rfxRecords, territories, { ...state })).not.toBe(first);
  });
});
