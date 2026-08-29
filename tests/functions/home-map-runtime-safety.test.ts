import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "apps/web/src/components/MapComponent.tsx",
  "utf8",
);

describe("home map runtime safety", () => {
  it("renders a user-facing fallback when map tiles are not configured", () => {
    expect(source).toContain(
      "process.env.NEXT_PUBLIC_OPENSTREETMAP_TILE_URL?.trim()",
    );
    expect(source).toContain("if (!tileUrl || mapFailed)");
    expect(source).toContain("Get directions");
    expect(source).not.toContain(
      'throw new Error("NEXT_PUBLIC_OPENSTREETMAP_TILE_URL is not configured")',
    );
  });

  it("contains map initialization failures inside the map component", () => {
    expect(source).toContain("try {");
    expect(source).toContain("setMapFailed(true)");
    expect(source).toContain(
      'console.error("Hi Coworking map could not be initialized", error)',
    );
  });
});
