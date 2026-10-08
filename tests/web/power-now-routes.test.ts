import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POWER_NOW_PATHS } from "../../apps/web/src/lib/powerNowLead";
import { resolvePowerNowPath } from "../../apps/web/src/lib/powerNowLocation";

describe("Power NOW clean paths", () => {
  it("treats /power-now/<path> like ?path=, and lets a valid query win", () => {
    expect(resolvePowerNowPath("/power-now/pitch", "")).toBe("pitch");
    expect(resolvePowerNowPath("/power-now/watch/", "?utm_source=linkedin&utm_medium=social")).toBe("watch");
    expect(resolvePowerNowPath("/power-now/contribute", "?utm_campaign=night")).toBe("contribute");
    expect(resolvePowerNowPath("/power-now", "?path=pitch&utm_source=email")).toBe("pitch");
    expect(resolvePowerNowPath("/power-now/pitch", "?path=watch&utm_source=email")).toBe("watch");
    expect(resolvePowerNowPath("/power-now/watch", "?path=nope&utm_source=email")).toBe("watch");
    expect(resolvePowerNowPath("/power-now", "?path=nope")).toBeNull();
    expect(resolvePowerNowPath("/power-now/pitch/extra", "")).toBeNull();
    expect(resolvePowerNowPath("/power-nowhere", "")).toBeNull();
  });

  it("exports a static page for each path and rewrites those URLs to the Power NOW document", () => {
    const page = readFileSync("apps/web/src/app/power-now/[path]/page.tsx", "utf8");
    expect(page).toContain("generateStaticParams");
    expect(page).toContain("PowerNowPage");
    expect(page).toContain("dynamicParams = false");
    for (const path of POWER_NOW_PATHS) {
      expect(page).not.toContain(`"${path}"`);
    }

    const hosting = JSON.parse(readFileSync("firebase.json", "utf8")).hosting as {
      rewrites: Array<{ source: string; destination?: string }>;
    };
    const catchAll = hosting.rewrites.findIndex((rewrite) => rewrite.source === "**");
    expect(catchAll).toBeGreaterThan(0);
    for (const path of POWER_NOW_PATHS) {
      const index = hosting.rewrites.findIndex((rewrite) => rewrite.source === `/power-now/${path}`);
      expect(index, path).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(catchAll);
      expect(hosting.rewrites[index]).toMatchObject({ destination: "/power-now.html" });
    }
  });

  it("reads the clean path and still keeps query UTMs on the page", () => {
    const source = readFileSync("apps/web/src/app/power-now/PowerNowPage.tsx", "utf8");
    expect(source).toContain("resolvePowerNowPath");
    expect(source).toContain("utm_source");
    expect(source).toContain("params.set(\"path\", path)");
  });
});
