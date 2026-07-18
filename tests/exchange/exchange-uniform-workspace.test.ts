import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("uniform Exchange workspace contract", () => {
  it("uses Mapbox Standard and documents the browser token location", () => {
    const config = read("apps/web/src/features/exchange/map/mapConfig.ts");
    const example = read("apps/web/.env.example");
    expect(config).toContain("mapbox://styles/mapbox/standard");
    expect(config).toContain('EXCHANGE_MAP_DIMENSIONS = ["2d", "3d"]');
    expect(example).toContain("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.");
  });

  it("falls back instead of leaving a permanently gray Mapbox loading surface", () => {
    const map = read("apps/web/src/features/exchange/map/ExchangeMap.tsx");
    expect(map).toContain("MAPBOX_LOAD_TIMEOUT_MS");
    expect(map).toContain('tokenState="provider-error"');
    expect(map).toContain("Retry Mapbox");
    expect(map).toContain("token URL restrictions");
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

  it("keeps the Opportunity map mounted while list results expand in the mobile drawer", () => {
    const opportunities = read("apps/web/src/features/exchange/views/ExchangeOpportunitiesView.tsx");
    expect(opportunities).toContain('className="absolute inset-0 h-full min-h-0 w-full border-0"');
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

  it("renders context maps on desktop and uses glass overlay surfaces", () => {
    const workspace = read("apps/web/src/features/exchange/components/ExchangeWorkspace.tsx");
    const resources = read("apps/web/src/features/exchange/views/ExchangeResourcesView.tsx");
    expect(workspace).toContain('className="absolute inset-0 z-0 hidden lg:block"');
    expect(workspace).toContain("backdrop-blur-2xl");
    expect(resources).toContain('className="absolute inset-0 h-full min-h-0 w-full border-0"');
    expect(resources).toContain("bg-white/72");
  });
});
