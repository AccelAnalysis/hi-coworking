import { describe, expect, it } from "vitest";
import {
  exchangeUrlStateToString,
  parseExchangeUrlState,
  serializeExchangeUrlState,
} from "../../apps/web/src/features/exchange/state/exchangeUrlState";
import { exchangeWorkspaceReducer } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceReducer";
import { exchangeWorkspaceActions as actions } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceActions";
import { createInitialExchangeWorkspaceState } from "../../apps/web/src/features/exchange/state/exchangeWorkspaceTypes";

describe("Exchange URL state", () => {
  it("omits stable defaults", () => {
    expect(exchangeUrlStateToString(createInitialExchangeWorkspaceState())).toBe("");
  });

  it("serializes and parses multiple filters canonically", () => {
    const state = {
      ...createInitialExchangeWorkspaceState(),
      surfaceMode: "map" as const,
      searchQuery: "stormwater",
      territoryFilters: ["51093", "51740"],
      naicsFilters: ["237110", "541330"],
      rfxStatusFilters: ["open" as const],
      territoryStatusFilters: ["released" as const, "scheduled" as const],
      localFirst: false,
    };
    const encoded = exchangeUrlStateToString(state);
    expect(encoded).toBe(
      "mode=map&q=stormwater&territory=51093%2C51740&naics=237110%2C541330&rfxStatus=open&territoryStatus=released%2Cscheduled&local=0",
    );
    expect(parseExchangeUrlState(encoded)).toMatchObject({
      surfaceMode: "map",
      searchQuery: "stormwater",
      territoryFilters: ["51093", "51740"],
      naicsFilters: ["237110", "541330"],
      rfxStatusFilters: ["open"],
      territoryStatusFilters: ["released", "scheduled"],
      localFirst: false,
    });
  });

  it("restores RFx and territory selection deep links", () => {
    expect(parseExchangeUrlState("entity=rfx&selected=rfx-101").selection).toEqual({
      entityType: "rfx",
      entityId: "rfx-101",
    });
    expect(
      parseExchangeUrlState("entity=territory&selected=51093").selection,
    ).toEqual({ entityType: "territory", entityId: "51093" });
  });

  it("round-trips an actor request, subject, secondary context, and open surfaces", () => {
    const state = {
      ...createInitialExchangeWorkspaceState(),
      actorOrganizationId: "actor-validated-1",
      subjectOrganizationId: "subject-2",
      secondaryContext: { entityType: "rfx" as const, entityId: "rfx-101" },
      selection: { entityType: "rfx" as const, entityId: "rfx-101" },
      organizationDrawerOpen: true,
      rightPanelOpen: true,
    };
    const encoded = exchangeUrlStateToString(state);
    expect(encoded).toContain("actorOrg=actor-validated-1");
    expect(encoded).toContain("subjectOrg=subject-2");
    expect(encoded).toContain("entity=rfx&selected=rfx-101&panel=detail");
    expect(encoded).toContain("drawer=organization");

    const parsed = parseExchangeUrlState(encoded);
    expect(parsed).toMatchObject({
      requestedActorOrganizationId: "actor-validated-1",
      subjectOrganizationId: "subject-2",
      secondaryContext: { entityType: "rfx", entityId: "rfx-101" },
      organizationDrawerOpen: true,
      rightPanelOpen: true,
    });
    expect((parsed as { actorOrganizationId?: string }).actorOrganizationId).toBeUndefined();
  });

  it("treats a URL actor as a bounded request and never as validated authority", () => {
    const parsed = parseExchangeUrlState(
      "actor=unauthorized-org&subject=public-org&drawer=organization",
    );
    expect(parsed.requestedActorOrganizationId).toBe("unauthorized-org");
    expect(parsed.subjectOrganizationId).toBe("public-org");
    expect((parsed as Record<string, unknown>).actorOrganizationId).toBeUndefined();
    expect(parseExchangeUrlState(
      "actorOrg=%3Cscript%3E&subjectOrg=org%2Fchild&entity=rfx&selected=bad%2Fpath",
    )).toMatchObject({
      requestedActorOrganizationId: undefined,
      subjectOrganizationId: undefined,
      secondaryContext: null,
    });
  });

  it("round-trips a bounded map viewport", () => {
    const state = {
      ...createInitialExchangeWorkspaceState(),
      viewport: {
        longitude: -76.70751234,
        latitude: 36.90006789,
        zoom: 9.754321,
        bearing: -10,
        pitch: 45,
      },
    };
    const encoded = exchangeUrlStateToString(state);
    expect(encoded).toBe("lng=-76.70751&lat=36.90007&z=9.75432&b=-10&p=45");
    expect(parseExchangeUrlState(encoded).viewport).toEqual({
      longitude: -76.70751,
      latitude: 36.90007,
      zoom: 9.75432,
      bearing: -10,
      pitch: 45,
    });
  });

  it("ignores invalid values without partially accepting a viewport", () => {
    const state = parseExchangeUrlState(
      "mode=globe&view=connections&naics=abc,541511&territory=%3Cscript%3E,51093&rfxStatus=secret,open&territoryStatus=paused,scheduled&local=yes&entity=rfx&selected=&lng=-76&lat=36",
    );
    expect(state).toMatchObject({
      view: "connections",
      surfaceMode: "split",
      naicsFilters: ["541511"],
      territoryFilters: ["51093"],
      rfxStatusFilters: ["open"],
      territoryStatusFilters: ["scheduled"],
      localFirst: true,
      selection: null,
      viewport: undefined,
    });
  });

  it("round-trips Connections filters and referral selection", () => {
    const state = parseExchangeUrlState(
      "view=connections&connectionMode=received&q=controls&referralStatus=sent,accepted&industry=Engineering%20services&connectionTerritory=51093&compensation=configured&relationship=trusted&entity=referral&selected=ref-42",
    );
    expect(state).toMatchObject({
      view: "connections",
      connectionMode: "received",
      searchQuery: "controls",
      referralStatusFilters: ["sent", "accepted"],
      connectionIndustryFilters: ["Engineering services"],
      connectionTerritoryFilters: ["51093"],
      compensationFilter: "configured",
      relationshipFilter: "trusted",
      selection: { entityType: "referral", entityId: "ref-42" },
    });
    expect(exchangeUrlStateToString(state)).toContain("view=connections");
    expect(exchangeUrlStateToString(state)).toContain("entity=referral");
  });

  it("validates Intelligence metrics and rejects cross-view selections", () => {
    expect(parseExchangeUrlState(
      "view=intelligence&metric=impact&relationship=established&entity=relationship&selected=relationship-1",
    )).toMatchObject({
      view: "intelligence",
      intelligenceMetric: "impact",
      relationshipFilter: "established",
      selection: { entityType: "relationship", entityId: "relationship-1" },
    });
    expect(parseExchangeUrlState(
      "view=connections&entity=relationship&selected=relationship-1",
    ).selection).toBeNull();
    expect(parseExchangeUrlState(
      "view=opportunities&entity=referral&selected=ref-1",
    ).selection).toBeNull();
  });

  it("accepts full URLs and leading question marks", () => {
    expect(
      parseExchangeUrlState("https://example.test/exchange?mode=list&q=water"),
    ).toMatchObject({ surfaceMode: "list", searchQuery: "water" });
    expect(parseExchangeUrlState("?mode=map").surfaceMode).toBe("map");
  });

  it("does not serialize transient panels, auth data, or arbitrary private fields", () => {
    const state = {
      ...createInitialExchangeWorkspaceState(),
      rightPanelOpen: true,
      mobileFilterOpen: true,
      authToken: "private-token",
      userEmail: "person@example.test",
    };
    const params = serializeExchangeUrlState(state);
    expect(params.toString()).toBe("");
    expect(params.has("authToken")).toBe(false);
    expect(params.has("userEmail")).toBe(false);
    expect(params.has("rightPanelOpen")).toBe(false);
  });

  it("drops unknown query parameters during a parse/serialize cycle", () => {
    const parsed = parseExchangeUrlState(
      "mode=list&token=secret&email=person%40example.test&drawer=open",
    );
    expect(exchangeUrlStateToString(parsed)).toBe("mode=list");
  });

  it("uses complete defaults so browser history can clear previous state", () => {
    const selected = exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      actions.hydrateFromUrl(parseExchangeUrlState(
        "mode=list&actorOrg=actor-request&subjectOrg=subject-1&drawer=organization&entity=rfx&selected=1&panel=detail",
      )),
    );
    const restored = exchangeWorkspaceReducer(
      selected,
      actions.hydrateFromUrl(parseExchangeUrlState("")),
    );
    expect(restored.surfaceMode).toBe("split");
    expect(restored.selection).toBeNull();
    expect(restored.requestedActorOrganizationId).toBeUndefined();
    expect(restored.subjectOrganizationId).toBeUndefined();
    expect(restored.secondaryContext).toBeNull();
    expect(restored.organizationDrawerOpen).toBe(false);
    expect(restored.rightPanelOpen).toBe(false);
  });

  it("ignores overlong search and out-of-range viewport values", () => {
    const overlong = "x".repeat(201);
    const state = parseExchangeUrlState(
      `q=${overlong}&lng=181&lat=36&z=9`,
    );
    expect(state.searchQuery).toBe("");
    expect(state.viewport).toBeUndefined();
  });
});
