import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("Exchange mobile map layering", () => {
  it("keeps map providers isolated below all interactive workspace layers", () => {
    const layering = source("apps/web/src/features/exchange/map/exchangeMapLayering.css");
    const tray = source("apps/web/src/features/exchange/components/ExchangeMobileWorkspaceTray.tsx");
    const filters = source("apps/web/src/features/exchange/components/ExchangeMobileDrawer.tsx");
    const details = source("apps/web/src/features/exchange/components/ExchangeDetailSheet.tsx");
    const navigation = source("apps/web/src/features/exchange/components/ExchangeMobileNavigation.tsx");
    const command = source("apps/web/src/features/exchange/components/ExchangeCommandBar.tsx");

    expect(layering).toContain("isolation: isolate");
    expect(layering).toContain('[data-map-provider="leaflet-openstreetmap"]');
    expect(layering).toContain('[data-map-provider="mapbox"]');
    expect(tray).toContain("z-[1200]");
    expect(command).toContain("z-[1100]");
    expect(navigation).toContain("z-[1300]");
    expect(details).toContain("z-[1350]");
    expect(filters).toContain("z-[1400]");
    expect(navigation).toContain("z-[1500]");
  });

  it("uses only the shared search-bar filter button on Opportunity mobile maps", () => {
    const command = source("apps/web/src/features/exchange/components/ExchangeCommandBar.tsx");
    const toolbar = source("apps/web/src/features/exchange/components/ExchangeMobileToolbar.tsx");

    expect(command).toContain("Open filters");
    expect(command).toContain("SlidersHorizontal");
    expect(toolbar).not.toContain("Layers3");
    expect(toolbar).not.toContain("Map layers and filters");
  });

  it("makes required Mapbox configuration and render failures visible", () => {
    const map = source("apps/web/src/features/exchange/map/ExchangeMap.tsx");

    expect(map).toContain("data-map-token-state");
    expect(map).toContain("data-map-token-fingerprint");
    expect(map).toContain("Mapbox token not detected");
    expect(map).toContain("Mapbox public token required");
    expect(map).toContain("Mapbox configuration check failed");
    expect(map).toContain("Mapbox passed access checks but did not render");
    expect(map).not.toContain("OpenStreetMap fallback");
  });
});
