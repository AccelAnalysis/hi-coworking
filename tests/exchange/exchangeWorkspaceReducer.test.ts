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

  it("preserves global context and restores each mode's selection and filters", () => {
    const opportunities = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setValidatedActorOrganization("actor-1"),
      actions.setSubjectOrganization("subject-1"),
      actions.setSearch("water systems"),
      actions.setViewport({ longitude: -76.7, latitude: 36.9, zoom: 10 }),
      actions.setFilters({ naicsFilters: ["541511"] }),
      actions.selectEntity({ entityType: "rfx", entityId: "rfx-1" }),
      actions.openMobileFilter(),
      actions.setModeListScroll(480),
      actions.setModePanelSubsection("requirements"),
      actions.setModeDraftRefs({ opportunityResponseDraftId: "response-1" }),
    );
    const referrals = reduce(
      opportunities,
      actions.setView("connections"),
      actions.setFilters({ referralStatusFilters: ["accepted"] }),
      actions.selectEntity({ entityType: "referral", entityId: "referral-1" }),
      actions.setModeListScroll(120),
    );
    expect(referrals).toMatchObject({
      view: "connections",
      actorOrganizationId: "actor-1",
      subjectOrganizationId: "subject-1",
      organizationDrawerOpen: true,
      searchQuery: "water systems",
      viewport: { longitude: -76.7, latitude: 36.9, zoom: 10 },
      referralStatusFilters: ["accepted"],
      selection: { entityType: "referral", entityId: "referral-1" },
      rightPanelOpen: true,
      mobileFilterOpen: true,
    });

    const restored = exchangeWorkspaceReducer(
      referrals,
      actions.setView("opportunities"),
    );
    expect(restored).toMatchObject({
      actorOrganizationId: "actor-1",
      subjectOrganizationId: "subject-1",
      organizationDrawerOpen: true,
      searchQuery: "water systems",
      viewport: { longitude: -76.7, latitude: 36.9, zoom: 10 },
      naicsFilters: ["541511"],
      selection: { entityType: "rfx", entityId: "rfx-1" },
    });
    expect(restored.modeStates.opportunities).toMatchObject({
      listScrollTop: 480,
      panelSubsection: "requirements",
      draftRefs: { opportunityResponseDraftId: "response-1" },
    });
    expect(restored.modeStates.referrals).toMatchObject({
      listScrollTop: 120,
      secondaryContext: { entityType: "referral", entityId: "referral-1" },
    });
  });

  it("carries actor, subject, search, and camera through all four mode workspaces", () => {
    let state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setValidatedActorOrganization("actor-1"),
      actions.setSubjectOrganization("subject-1"),
      actions.setSearch("coastal engineering"),
      actions.setViewport({ longitude: -76.7, latitude: 36.9, zoom: 9.5 }),
      actions.setSecondaryContext({ entityType: "rfx", entityId: "rfx-1" }),
      actions.setView("referrals"),
      actions.setSecondaryContext({ entityType: "referral", entityId: "referral-1" }),
      actions.setView("intelligence"),
      actions.setSecondaryContext({ entityType: "relationship", entityId: "relationship-1" }),
      actions.setView("resources"),
      actions.setSecondaryContext({ entityType: "resource", entityId: "resource-1" }),
    );

    const expectedByView = {
      opportunities: { entityType: "rfx", entityId: "rfx-1" },
      referrals: { entityType: "referral", entityId: "referral-1" },
      intelligence: { entityType: "relationship", entityId: "relationship-1" },
      resources: { entityType: "resource", entityId: "resource-1" },
    } as const;
    for (const view of [
      "opportunities",
      "referrals",
      "intelligence",
      "resources",
    ] as const) {
      state = exchangeWorkspaceReducer(state, actions.setView(view));
      expect(state).toMatchObject({
        view,
        actorOrganizationId: "actor-1",
        subjectOrganizationId: "subject-1",
        organizationDrawerOpen: true,
        searchQuery: "coastal engineering",
        viewport: { longitude: -76.7, latitude: 36.9, zoom: 9.5 },
        secondaryContext: expectedByView[view],
      });
    }
  });

  it("carries a selected establishment as Secondary context through all four modes", () => {
    let state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setSubjectOrganization("subject-1"),
      actions.setSecondaryContext({
        entityType: "establishment",
        entityId: "branch-1",
        organizationId: "subject-1",
      }),
    );

    for (const view of [
      "referrals",
      "intelligence",
      "resources",
      "opportunities",
    ] as const) {
      state = exchangeWorkspaceReducer(state, actions.setView(view));
      expect(state).toMatchObject({
        view,
        subjectOrganizationId: "subject-1",
        secondaryContext: {
          entityType: "establishment",
          entityId: "branch-1",
          organizationId: "subject-1",
        },
        rightPanelOpen: true,
      });
    }
  });

  it("never changes actor authority when an organization marker becomes the subject", () => {
    const state = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setRequestedActorOrganization("requested-actor"),
      actions.setValidatedActorOrganization("validated-actor"),
      actions.selectEntity({ entityType: "rfx", entityId: "working-opportunity" }),
      actions.selectEntity({ entityType: "organization", entityId: "external-subject" }),
    );
    expect(state).toMatchObject({
      requestedActorOrganizationId: "requested-actor",
      actorOrganizationId: "validated-actor",
      subjectOrganizationId: "external-subject",
      secondaryContext: { entityType: "rfx", entityId: "working-opportunity" },
      selection: { entityType: "rfx", entityId: "working-opportunity" },
      organizationDrawerOpen: true,
    });
    const cleared = exchangeWorkspaceReducer(
      state,
      actions.clearSubjectOrganization(),
    );
    expect(cleared.actorOrganizationId).toBe("validated-actor");
    expect(cleared.subjectOrganizationId).toBeUndefined();
  });

  it("owns Resources category, eligibility filters, selection, and list position", () => {
    const resources = reduce(
      createInitialExchangeWorkspaceState(),
      actions.setView("resources"),
      actions.setResourceCategory("capital"),
      actions.setModeFilters({
        eligibilityFilters: ["woman-owned", "woman-owned"],
        providerFilters: ["local"],
      }),
      actions.selectEntity({ entityType: "resource", entityId: "resource-1" }),
      actions.setModeListScroll(300),
    );
    expect(resources.modeStates.resources).toMatchObject({
      resourceCategory: "capital",
      filters: {
        eligibilityFilters: ["woman-owned"],
        providerFilters: ["local"],
        serviceFilters: [],
      },
      secondaryContext: { entityType: "resource", entityId: "resource-1" },
      listScrollTop: 300,
    });
    const restored = reduce(
      resources,
      actions.setView("intelligence"),
      actions.setView("resources"),
    );
    expect(restored.secondaryContext).toEqual({
      entityType: "resource",
      entityId: "resource-1",
    });
    expect(restored.modeStates.resources.resourceCategory).toBe("capital");
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
    const referralsRestored = exchangeWorkspaceReducer(
      intelligence,
      actions.setView("referrals"),
    );
    expect(referralsRestored).toMatchObject({
      referralStatusFilters: ["accepted", "converted"],
      connectionIndustryFilters: ["Engineering services"],
      connectionTerritoryFilters: ["51093"],
      compensationFilter: "configured",
      relationshipFilter: "trusted",
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
