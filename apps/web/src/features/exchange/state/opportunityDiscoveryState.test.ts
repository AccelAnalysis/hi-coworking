import assert from "node:assert/strict";
import test from "node:test";
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

  assert.equal(parsed.searchQuery, "commercial HVAC");
  assert.deepEqual(parsed.naicsFilters, ["238220"]);
  assert.deepEqual(parsed.industryFilters, ["Plumbing and HVAC contractors"]);
  assert.deepEqual(parsed.capabilityFilters, ["building automation"]);
  assert.deepEqual(parsed.personalizedFilters, ["matches_capabilities", "saved"]);
  assert.equal(parsed.closingSoon, true);
  assert.equal(parsed.teamingSuitable, true);
  assert.equal(parsed.budgetMin, 100_000);
  assert.equal(parsed.budgetMax, 2_500_000);
  assert.equal(parsed.opportunitySort, "nearest");
  assert.deepEqual(parsed.opportunityLocation, {
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
  assert.equal(parsed.opportunityLocation?.latitude, undefined);
  assert.equal(parsed.opportunityLocation?.longitude, undefined);
  assert.deepEqual(parsed.opportunityLocation?.bounds, {
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
    },
  }));

  assert.equal(state.budgetMin, undefined);
  assert.equal(state.budgetMax, undefined);
  assert.equal(state.opportunityLocation, undefined);
});

test("clear filters restores the calm default discovery model", () => {
  const cleared = exchangeWorkspaceReducer(
    hydratedState(),
    exchangeWorkspaceActions.clearFilters(),
  );

  assert.equal(cleared.searchQuery, "");
  assert.deepEqual(cleared.naicsFilters, []);
  assert.deepEqual(cleared.capabilityFilters, []);
  assert.deepEqual(cleared.personalizedFilters, []);
  assert.equal(cleared.opportunityLocation, undefined);
  assert.equal(cleared.opportunitySort, "recommended");
  assert.equal(cleared.localFirst, true);
});
