import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

import { preserveExchangeContextInHref } from "../../apps/web/src/features/exchange/components/ExchangeMobileWorkspaceTray";

describe("Exchange mobile workspace links", () => {
  it("preserves actor, subject, selection, drawer, search, and camera context", () => {
    const href = preserveExchangeContextInHref(
      [
        "actorOrg=actor-1",
        "subjectOrg=subject-2",
        "entity=rfx",
        "selected=rfx-9",
        "panel=detail",
        "drawer=organization",
        "q=stormwater",
        "lng=-76.7075",
        "lat=36.9",
        "z=9.7",
      ].join("&"),
      "/exchange?view=resources&q=provider",
    );
    const query = new URL(href, "https://example.test").searchParams;

    expect(query.get("view")).toBe("resources");
    expect(query.get("q")).toBe("provider");
    expect(query.get("actorOrg")).toBe("actor-1");
    expect(query.get("subjectOrg")).toBe("subject-2");
    expect(query.get("entity")).toBe("rfx");
    expect(query.get("selected")).toBe("rfx-9");
    expect(query.get("panel")).toBe("detail");
    expect(query.get("drawer")).toBe("organization");
    expect(query.get("lng")).toBe("-76.7075");
    expect(query.get("lat")).toBe("36.9");
    expect(query.get("z")).toBe("9.7");
  });

  it("does not leak Exchange query state into routes outside the workspace", () => {
    expect(preserveExchangeContextInHref(
      "actorOrg=actor-1&subjectOrg=subject-2",
      "/profile",
    )).toBe("/profile");
  });
});
