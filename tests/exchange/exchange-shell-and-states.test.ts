import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppShellLayout } from "../../apps/web/src/components/appShellContract";
import {
  getExchangeStateCopy,
  type ExchangeStateKind,
} from "../../apps/web/src/features/exchange/components/exchangeStateCopy";
import { resolveExchangeBlockingState } from "../../apps/web/src/features/exchange/data/exchangePresentationState";

const workspaceRoot = resolve(import.meta.dirname, "../..");

function source(path: string): string {
  return readFileSync(resolve(workspaceRoot, path), "utf8");
}

describe("AppShell contract", () => {
  it("keeps the site shell and footer as the default", () => {
    const layout = resolveAppShellLayout();
    expect(layout).toMatchObject({ workspace: false, showFooter: true });
    expect(layout.rootClassName).toContain("min-h-dvh");
    expect(layout.mainClassName).toContain("max-w-7xl");
  });

  it("preserves the existing full-width site shell behavior", () => {
    const layout = resolveAppShellLayout("site", true);
    expect(layout.showFooter).toBe(true);
    expect(layout.mainClassName).toContain("bg-slate-50");
    expect(layout.mainClassName).not.toContain("max-w-7xl");
  });

  it("makes workspace layout full-height and footerless", () => {
    const layout = resolveAppShellLayout("workspace");
    expect(layout).toMatchObject({ workspace: true, showFooter: false });
    expect(layout.rootClassName).toContain("h-dvh");
    expect(layout.rootClassName).toContain("overflow-hidden");
    expect(layout.mainClassName).toContain("min-h-0");
  });

  it("uses workspace mode on the canonical Exchange and redirects legacy product routes into its views", () => {
    expect(source("apps/web/src/app/exchange/page.tsx")).toContain('variant="workspace"');
    expect(source("apps/web/src/app/rfx/page.tsx")).toContain('redirect("/exchange?view=opportunities")');
    expect(source("apps/web/src/app/directory/page.tsx")).toContain('redirect("/exchange?view=businesses")');
    expect(source("apps/web/src/app/referrals/page.tsx")).toContain('redirect("/exchange?view=referrals")');
  });
});

describe("Exchange presentation states", () => {
  it.each([
    [{ loading: true, sourceCount: 0, resultCount: 0, isFiltered: false }, "loading"],
    [{ loading: false, errorKind: "permission" as const, sourceCount: 0, resultCount: 0, isFiltered: false }, "permission"],
    [{ loading: false, errorKind: "offline" as const, sourceCount: 0, resultCount: 0, isFiltered: false }, "error"],
    [{ loading: false, sourceCount: 0, resultCount: 0, isFiltered: false }, "empty"],
    [{ loading: false, sourceCount: 4, resultCount: 0, isFiltered: true }, "filtered-empty"],
    [{ loading: false, sourceCount: 4, resultCount: 4, isFiltered: false }, null],
  ])("resolves %# to %s", (input, expected) => {
    expect(resolveExchangeBlockingState(input)).toBe(expected);
  });

  it("provides safe copy for every reusable state", () => {
    const kinds: ExchangeStateKind[] = [
      "loading",
      "empty",
      "filtered-empty",
      "error",
      "permission",
      "selection-unavailable",
      "token-missing",
      "map-error",
      "no-geocoded-rfx",
    ];
    for (const kind of kinds) {
      const copy = getExchangeStateCopy(kind);
      expect(copy.title.length).toBeGreaterThan(5);
      expect(copy.description.length).toBeGreaterThan(10);
      expect(copy.description).not.toMatch(/stack|firebase|firestore/i);
    }
  });

  it("names the token configuration and keeps list mode available", () => {
    const copy = getExchangeStateCopy("token-missing");
    expect(copy.description).toContain("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
    expect(copy.description).toContain("List view remains available");
  });

  it("retains explicit retry, no-geocode, and scheduled-territory affordances", () => {
    expect(source("apps/web/src/features/exchange/components/ExchangeStateView.tsx"))
      .toContain("onRetry");
    expect(getExchangeStateCopy("no-geocoded-rfx").description).toContain("list view");
    expect(source("apps/web/src/features/exchange/components/ExchangeEntityDetail.tsx"))
      .toContain("This status does not enable current transactions");
  });
});
