import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("Safari 15 / iPadOS 15 support (front-desk kiosk iPad)", () => {
  const web = JSON.parse(read("apps/web/package.json")) as { browserslist?: string[] };

  it("keeps Next's modern browser targets and adds Safari 15 and iOS Safari 15", () => {
    expect(web.browserslist).toEqual(
      expect.arrayContaining(["chrome 111", "edge 111", "firefox 111", "safari 15", "ios_saf 15"]),
    );
  });

  it("does not raise the Safari floor above 15", () => {
    for (const entry of web.browserslist ?? []) {
      const match = /^(safari|ios_saf)\s+([\d.]+)$/.exec(entry.trim());
      if (match) expect(Number(match[2])).toBeLessThanOrEqual(15);
    }
  });

  it("has a post-build syntax check that CI runs against the export", () => {
    const root = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(root.scripts["check:safari15"]).toContain("scripts/check-legacy-safari-syntax.mjs");
    expect(read(".github/workflows/hi-coworking-product-ci.yml")).toContain("npm run check:safari15");
  });
});
