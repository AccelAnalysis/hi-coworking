import { expect, test } from "vitest";
import { exchangeWorkspaceActions } from "./exchangeWorkspaceActions";
import { exchangeWorkspaceReducer } from "./exchangeWorkspaceReducer";
import {
  createInitialExchangeWorkspaceState,
  type ExchangeWorkspaceState,
} from "./exchangeWorkspaceTypes";
import {
  parseExchangeUrlState,
  serializeExchangeUrlState,
} from "./exchangeUrlState";

function hydratedState(): ExchangeWorkspaceState {
  let state = createInitialExchangeWorkspaceState();
  state = exchangeWorkspaceReducer(state, exchangeWorkspaceActions.setSearch("commercial HVAC"));
  state = exchangeWorkspaceReducer(state, exchangeWorkspaceActions.setFilters({
    naicsFilters: ["238220"],
    industryFilters: ["Plumbing and HVAC contractors"],
    capabilityFilters: ["building automation"],
    territoryFilters: ["51550"],
    opportunityTypeFilters: ["construction"],
    buyerTypeFilters: ["government"],
    workArrangementFilters: ["on_site"],
    visibilityFilters: ["public"],
    certificationFilters: ["SWaM"],
    setAsideFilters: ["small_business"],
    primeClassificationFilters: ["prime"],
    awardClassificationFilters: ["multiple"],
    personalizedFilters: ["matches_capabilities", "saved"],
    closingSoon: true,
    teamingSuitable: true,
    budgetMin: 100_000,
    budgetMax: 2_500_000,
    opportunitySort: "nearest",
    opportunityLocation: {
      label: "Norfolk, Virginia",
      latitude: 36.8508,
      longitude: -76.2859,
      radiusMiles: 50,
      includeRemote: false,
    },
  }));
  return state;
}

test("opportunity discovery state round-trips through the URL codec", () => {
  const state = hydratedState();
  const serialized = serializeExchangeUrlState(state);
  const parsed = parseExchangeUrlState(serialized);

  expect(parsed.searchQuery).toBe("commercial HVAC");
  expect(parsed.naicsFilters).toEqual(["238220"]);
  expect(parsed.industryFilters).toEqual(["Plumbing and HVAC contractors"]);
  expect(parsed.capabilityFilters).toEqual(["building automation"]);
  expect(parsed.personalizedFilters).toEqual(["matches_capabilities", "saved"]);
  expect(parsed.closingSoon).toBe(true);
  expect(parsed.teamingSuitable).toBe(true);
  expect(parsed.budgetMin).toBe(100_000);
  expect(parsed.budgetMax).toBe(2_500_000);
  expect(parsed.opportunitySort).toBe("nearest");
  expect(parsed.opportunityLocation).toEqual({
    label: "Norfolk, Virginia",
    latitude: 36.8508,
    longitude: -76.2859,
    radiusMiles: 50,
    includeRemote: false,
  });
});

test("map-area bounds round-trip without fabricating a point", () => {
  const state = exchangeWorkspaceReducer(
    createInitialExchangeWorkspaceState(),
    exchangeWorkspaceActions.setOpportunityLocation({
      label: "Current map area",
      bounds: {
        west: -77.2,
        south: 36.4,
        east: -75.7,
        north: 37.3,
      },
      includeRemote: false,
    }),
  );
  const parsed = parseExchangeUrlState(serializeExchangeUrlState(state));
  expect(parsed.opportunityLocation?.latitude).toBeUndefined();
  expect(parsed.opportunityLocation?.longitude).toBeUndefined();
  expect(parsed.opportunityLocation?.bounds).toEqual({
    west: -77.2,
    south: 36.4,
    east: -75.7,
    north: 37.3,
  });
});

test("invalid location and money state is rejected by the reducer", () => {
  const initial = createInitialExchangeWorkspaceState();
  const state = exchangeWorkspaceReducer(initial, exchangeWorkspaceActions.setFilters({
    budgetMin: -5,
    budgetMax: Number.POSITIVE_INFINITY,
    opportunityLocation: {
      label: "Invalid",
      latitude: 200,
      longitude: -76,
      radiusMiles: 999,
      includeRemote: false,
    },
  }));

  expect(state.budgetMin).toBeUndefined();
  expect(state.budgetMax).toBeUndefined();
  expect(state.opportunityLocation).toBeUndefined();
});

test("clear filters restores the calm default discovery model", () => {
  const cleared = exchangeWorkspaceReducer(
    hydratedState(),
    exchangeWorkspaceActions.clearFilters(),
  );

  expect(cleared.searchQuery).toBe("");
  expect(cleared.naicsFilters).toEqual([]);
  expect(cleared.capabilityFilters).toEqual([]);
  expect(cleared.personalizedFilters).toEqual([]);
  expect(cleared.opportunityLocation).toBeUndefined();
  expect(cleared.opportunitySort).toBe("recommended");
  expect(cleared.localFirst).toBe(true);
});
