import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("uniform Exchange workspace contract", () => {
  it("uses a compatible Mapbox basemap and documents the browser token location", () => {
    const config = read("apps/web/src/features/exchange/map/mapConfig.ts");
    const layers = read("apps/web/src/features/exchange/map/mapLayers.ts");
    const map = read("apps/web/src/features/exchange/map/ExchangeMap.tsx");
    const example = read("apps/web/.env.example");
    expect(config).toContain("mapbox://styles/mapbox/streets-v12");
    expect(config).toContain('EXCHANGE_MAP_DIMENSIONS = ["2d", "3d"]');
    expect(config).toContain('buildings3d: "exchange-buildings-3d"');
    expect(layers).toContain('type: "fill-extrusion"');
    expect(map).toContain("setLayoutProperty");
    expect(example).toContain("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.");
  });

  it("requires a completed tile render before declaring Mapbox ready", () => {
    const hook = read("apps/web/src/features/exchange/map/useExchangeMap.ts");
    expect(hook).toContain("renderReadyRef");
    expect(hook).toContain("map.areTilesLoaded()");
    expect(hook).toContain('map.on("idle", handleIdle)');
    expect(hook).toContain('NavigationControl({ showCompass: false }), "bottom-right"');
  });

  it("validates the compiled Mapbox token, browser origin, style access, and WebGL", () => {
    const map = read("apps/web/src/features/exchange/map/ExchangeMap.tsx");
    const diagnostics = read("apps/web/src/features/exchange/map/mapboxDiagnostics.ts");
    const checker = read("scripts/check-mapbox-env.mjs");
    expect(map).toContain("validateMapboxRuntime");
    expect(map).toContain("data-map-token-fingerprint");
    expect(map).toContain("Mapbox configuration check failed");
    expect(diagnostics).toContain("mapboxgl.supported()");
    expect(diagnostics).toContain("styles/v1/mapbox/streets-v12");
    expect(diagnostics).toContain('referrerPolicy: "strict-origin-when-cross-origin"');
    expect(checker).toContain("--origin=");
    expect(checker).toContain("Mapbox style check passed");
  });

  it("does not silently replace required Mapbox with another provider", () => {
    const map = read("apps/web/src/features/exchange/map/ExchangeMap.tsx");
    expect(map).toContain("MAPBOX_LOAD_TIMEOUT_MS");
    expect(map).toContain("Mapbox passed access checks but did not render");
    expect(map).toContain("Retry Mapbox check");
    expect(map).not.toContain("ExchangeLeafletFallback");
  });

  it("keeps Firestore opportunity discovery usable when optional Functions are absent", () => {
    const repository = read("apps/web/src/features/exchange/data/exchangeRepository.ts");
    expect(repository).toContain("listReleasedTerritoriesFn({}).catch(() => null)");
    expect(repository).toContain("territoryResult?.data.released ?? []");
    expect(repository).toContain("backend functions are not available");
  });

  it("keeps Opportunity search and filters in the shared command bar", () => {
    const commandBar = read("apps/web/src/features/exchange/components/ExchangeCommandBar.tsx");
    expect(commandBar).toContain("Business name, opportunity, industry, or location");
    expect(commandBar).toContain("Open filters");
    expect(commandBar).not.toContain('opportunityOverlay ? "hidden"');
  });

  it("keeps the Opportunity fit-results action below the mobile 2D/3D switch", () => {
    const toolbar = read("apps/web/src/features/exchange/components/ExchangeMobileToolbar.tsx");
    expect(toolbar).toContain('data-exchange-map-control="fit-results"');
    expect(toolbar).toContain("top-[5.75rem]");
    expect(toolbar).not.toContain("justify-between");
  });

  it("keeps list results as overlays while the root workspace owns the map", () => {
    const workspace = read("apps/web/src/features/exchange/components/ExchangeWorkspace.tsx");
    const opportunities = read("apps/web/src/features/exchange/views/ExchangeOpportunitiesView.tsx");
    expect(workspace).toContain("<ExchangeWorkspaceMap");
    expect(workspace.match(/<ExchangeWorkspaceMap\b/g)).toHaveLength(1);
    expect(workspace).toMatch(/<ExchangeOpportunitiesView[\s\S]*?workspaceMap[\s\S]*?\/>/);
    expect(opportunities).toContain("!workspaceMap && initialMapViewport ? <ExchangeMap");
    expect(opportunities).toContain("ExchangeMobileWorkspaceTray");
    expect(opportunities).toContain("{resultsContent(true)}");
    expect(opportunities).not.toContain('effectiveMode === "list" && "pointer-events-none invisible');
  });

  it("loads additional result tiles automatically as the drawer is scrolled", () => {
    const results = read("apps/web/src/features/exchange/components/ExchangeResultsList.tsx");
    expect(results).toContain("IntersectionObserver");
    expect(results).toContain('rootMargin: "240px 0px"');
    expect(results).toContain("loadMore");
  });

  it("uses one persistent map host across all four canonical modes", () => {
    const workspace = read("apps/web/src/features/exchange/components/ExchangeWorkspace.tsx");
    const workspaceMap = read("apps/web/src/features/exchange/components/ExchangeWorkspaceMap.tsx");
    const opportunities = read("apps/web/src/features/exchange/views/ExchangeOpportunitiesView.tsx");
    const resources = read("apps/web/src/features/exchange/views/ExchangeResourcesView.tsx");

    expect(workspace.match(/<ExchangeWorkspaceMap\b/g)).toHaveLength(1);
    expect(workspaceMap.match(/<ExchangeMap\b/g)).toHaveLength(1);
    expect(workspaceMap).toContain('data-exchange-map-host="persistent"');
    expect(workspace).toContain('activeView === "opportunities"');
    expect(workspace).toContain('activeView === "referrals"');
    expect(workspace).toContain('activeView === "intelligence"');
    expect(workspace).toContain('activeView === "resources"');
    expect(workspace).toMatch(/<ExchangeResourcesView[\s\S]*?workspaceMap[\s\S]*?\/>/);
    expect(workspace.indexOf("<ExchangeWorkspaceMap")).toBeLessThan(
      workspace.indexOf("<ExchangeOpportunitiesView"),
    );
    expect(workspace.match(/<ExchangeOpportunitiesView\b/g)).toHaveLength(1);
    expect(workspace.match(/<ConnectionsWorkspace\b/g)).toHaveLength(1);
    expect(workspace.match(/<IntelligenceWorkspace\b/g)).toHaveLength(1);
    expect(workspace.match(/<ExchangeResourcesView\b/g)).toHaveLength(1);
    expect(opportunities).toContain("!workspaceMap && initialMapViewport");
    expect(resources).toContain("!workspaceMap ? (");
    expect(workspaceMap).toContain('activeView === "opportunities" ? rfx : []');
    expect(workspaceMap).toContain("contextOrganizations={activeContextOrganizations}");
    expect(workspace).toContain("backdrop-blur-2xl");
    expect(resources).toContain("bg-white/72");
  });

  it("binds the persistent map and workspace lifecycle to the authenticated viewer", () => {
    const workspace = read("apps/web/src/features/exchange/components/ExchangeWorkspace.tsx");
    const workspaceMap = read("apps/web/src/features/exchange/components/ExchangeWorkspaceMap.tsx");
    const opportunities = read("apps/web/src/features/exchange/views/ExchangeOpportunitiesView.tsx");

    expect(workspace).toContain("getExchangeWorkspaceIdentityKey");
    expect(workspace).toContain("key={identityKey}");
    expect(workspace).toContain("viewerUid={authenticatedUid}");
    expect(workspaceMap).toContain("resolveInitialExchangeMapViewport");
    expect(workspaceMap).toContain("loadPrimaryBusinessAnchor(viewerUid)");
    expect(workspaceMap).toContain("updateViewport(bounds)");
    expect(opportunities).toContain("if (workspaceMap) return;");
    expect(opportunities).not.toMatch(/receiveBounds[\s\S]{0,240}updateViewport\(bounds\)/);
  });
});
