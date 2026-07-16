import { describe, expect, it } from "vitest";
import { exchangeWorkspaceActions as actions } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceActions";
import { exchangeWorkspaceReducer } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceReducer";
import {
  createInitialExchangeWorkspaceState,
  type ExchangeWorkspaceState,
} from "../../apps/web/src/features/exchange/state/exchangeWorkspaceTypes";
import { parseExchangeUrlState } from "../../apps/web/src/features/exchange/state/exchangeUrlState";

function reduce(
  state: ExchangeWorkspaceState,
  ...workspaceActions: Parameters<typeof exchangeWorkspaceReducer>[1][]
): ExchangeWorkspaceState {
  return workspaceActions.reduce(exchangeWorkspaceReducer, state);
}

describe("exchangeWorkspaceReducer", () => {
  it("creates a stable initial interaction state without fetched data", () => {
    expect(exchangeWorkspaceReducer(undefined, { type: "CLEAR_FILTERS" })).toEqual(
      createInitialExchangeWorkspaceState(),
    );
  });

  it("changes search without disturbing filters", () => {
    const state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setFilters({ naicsFilters: ["541511"] }),
      actions.setSearch("water systems"),
    );
    expect(state.searchQuery).toBe("water systems");
    expect(state.naicsFilters).toEqual(["541511"]);
  });

  it("normalizes filter updates and preserves unspecified filter groups", () => {
    const state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setFilters({ territoryFilters: ["51093"] }),
      actions.setFilters({
        naicsFilters: [" 541511 ", "541511", ""],
        rfxStatusFilters: ["open"],
        territoryStatusFilters: ["released", "scheduled"],
        localFirst: false,
      }),
    );
    expect(state).toMatchObject({
      territoryFilters: ["51093"],
      naicsFilters: ["541511"],
      rfxStatusFilters: ["open"],
      territoryStatusFilters: ["released", "scheduled"],
      localFirst: false,
    });
  });

  it("clears search and every filter back to product defaults", () => {
    const state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setSearch("design"),
      actions.setFilters({
        naicsFilters: ["54"],
        territoryFilters: ["51093"],
        rfxStatusFilters: ["open"],
        territoryStatusFilters: ["scheduled"],
        localFirst: false,
      }),
      actions.clearFilters(),
    );
    expect(state).toMatchObject({
      searchQuery: "",
      naicsFilters: [],
      territoryFilters: [],
      rfxStatusFilters: [],
      territoryStatusFilters: [],
      localFirst: true,
    });
  });

  it("switches between map, list, and split presentation", () => {
    let state = createInitialExchangeWorkspaceState();
    for (const mode of ["map", "list", "split"] as const) {
      state = exchangeWorkspaceReducer(state, actions.setSurfaceMode(mode));
      expect(state.surfaceMode).toBe(mode);
    }
  });

  it("switches Exchange views and clears incompatible detail state", () => {
    const selected = reduce(
      createInitialExchangeWorkspaceState(),
      actions.selectEntity({ entityType: "rfx", entityId: "rfx-1" }),
      actions.openMobileFilter(),
      actions.setView("connections"),
    );
    expect(selected).toMatchObject({
      view: "connections",
      selection: null,
      rightPanelOpen: false,
      mobileDetailOpen: false,
      mobileFilterOpen: false,
    });
  });

  it("owns Connections and Intelligence filter state", () => {
    const connections = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setView("connections"),
      actions.setConnectionMode("received"),
      actions.setFilters({
        referralStatusFilters: ["accepted", "converted"],
        connectionIndustryFilters: ["Engineering services"],
        connectionTerritoryFilters: ["51093"],
        compensationFilter: "configured",
        relationshipFilter: "trusted",
      }),
    );
    expect(connections).toMatchObject({
      connectionMode: "received",
      referralStatusFilters: ["accepted", "converted"],
      compensationFilter: "configured",
      relationshipFilter: "trusted",
    });
    const intelligence = reduce(
      connections,
      actions.setView("intelligence"),
      actions.setIntelligenceMetric("gaps"),
      actions.clearFilters(),
    );
    expect(intelligence).toMatchObject({
      view: "intelligence",
      intelligenceMetric: "overview",
      connectionIndustryFilters: [],
      connectionTerritoryFilters: [],
      relationshipFilter: "all",
    });
  });

  it("selects an RFx and opens responsive detail surfaces", () => {
    const state = exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      actions.selectEntity({ entityType: "rfx", entityId: "rfx-1" }),
    );
    expect(state.selection).toEqual({ entityType: "rfx", entityId: "rfx-1" });
    expect(state.rightPanelOpen).toBe(true);
    expect(state.mobileDetailOpen).toBe(true);
  });

  it("selects a territory and clears selection explicitly", () => {
    const state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.selectEntity({ entityType: "territory", entityId: "51093" }),
      actions.clearSelection(),
    );
    expect(state.selection).toBeNull();
    expect(state.rightPanelOpen).toBe(false);
    expect(state.mobileDetailOpen).toBe(false);
  });

  it("opens and closes panels without implicitly clearing selection", () => {
    const selected = exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      actions.selectEntity({ entityType: "rfx", entityId: "rfx-2" }),
    );
    const state = reduce(
      selected,
      actions.toggleLeftPanel(),
      actions.closeRightPanel(),
      actions.openRightPanel(),
      actions.closeRightPanel(),
    );
    expect(state.leftPanelCollapsed).toBe(true);
    expect(state.rightPanelOpen).toBe(false);
    expect(state.selection).toEqual(selected.selection);
  });

  it("owns the mobile filter drawer and detail sheet state", () => {
    const state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.openMobileFilter(),
      actions.openMobileDetail(),
      actions.closeMobileFilter(),
      actions.closeMobileDetail(),
    );
    expect(state.mobileFilterOpen).toBe(false);
    expect(state.mobileDetailOpen).toBe(false);
  });

  it("accepts a valid viewport and rejects an invalid one", () => {
    const initial = createInitialExchangeWorkspaceState();
    const withViewport = exchangeWorkspaceReducer(
      initial,
      actions.setViewport({ longitude: -76.7, latitude: 36.9, zoom: 10.5 }),
    );
    expect(withViewport.viewport).toEqual({
      longitude: -76.7,
      latitude: 36.9,
      zoom: 10.5,
    });

    const invalid = exchangeWorkspaceReducer(withViewport, {
      type: "SET_VIEWPORT",
      viewport: { longitude: 999, latitude: 36.9, zoom: 10 },
    });
    expect(invalid).toBe(withViewport);
  });

  it("hydrates shareable state from a URL and restores a deep link", () => {
    const hydration = parseExchangeUrlState(
      "?mode=list&q=roads&naics=237310&entity=territory&selected=51093",
    );
    const state = exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      actions.hydrateFromUrl(hydration),
    );
    expect(state).toMatchObject({
      surfaceMode: "list",
      searchQuery: "roads",
      naicsFilters: ["237310"],
      selection: { entityType: "territory", entityId: "51093" },
      rightPanelOpen: true,
      mobileDetailOpen: true,
    });
  });

  it("returns the same state for an unknown action at runtime", () => {
    const state = createInitialExchangeWorkspaceState();
    const next = exchangeWorkspaceReducer(
      state,
      { type: "FUTURE_ACTION" } as never,
    );
    expect(next).toBe(state);
  });
});
