import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_CAPABILITIES } from "../../apps/web/src/lib/adminCapabilities";

const read = (p: string) => readFileSync(resolve(__dirname, "../../apps/web/src", p), "utf8");

describe("admin capability flags (audit P1-3)", () => {
  it("marks undeployed tools as not live", () => {
    expect(ADMIN_CAPABILITIES.eventCampaigns.live).toBe(false);
  });
  it("marks the deployed follow-up queue and door access as live", () => {
    expect(ADMIN_CAPABILITIES.followUps.live).toBe(true);
    // Door access switched on Nov 24, 2026 (Jonathan).
    expect(ADMIN_CAPABILITIES.doorAccess.live).toBe(true);
  });
  it("labels tiles and shows the note on each tool page", () => {
    const dashboard = read("app/admin/dashboard/page.tsx");
    expect(dashboard).toContain("Not live yet");
    expect(dashboard).toContain('capability: "doorAccess"');
    expect(dashboard).toContain('href: "/admin/events/campaigns"');
    expect(dashboard).toContain('href: "/admin/events/social"');
    expect(read("app/admin/access/page.tsx")).toContain("ADMIN_CAPABILITIES.doorAccess.note");
    const campaigns = read("app/admin/events/campaigns/page.tsx");
    expect(campaigns).toContain("!ADMIN_CAPABILITIES.eventCampaigns.live");
  });
});

describe("Coming Soon toggle (audit P1-15)", () => {
  it("asks for confirmation and labels the action, not the state", () => {
    const dashboard = read("app/admin/dashboard/page.tsx");
    const mode = read("lib/publicLaunch.ts");
    expect(dashboard).toContain("publicSiteModeView");
    expect(dashboard).toContain("onClick={openSiteModeConfirm}");
    expect(dashboard).toContain("<ConfirmSheet");
    expect(dashboard).toContain("updatedBy: user.uid");
    expect(dashboard).not.toContain("Coming Soon: ON");
    expect(mode).toContain("Open the site to the public?");
    expect(mode).toContain("Return the site to Coming Soon?");
    expect(mode).toContain("Open site to public…");
    expect(mode).toContain("Return to Coming Soon…");
  });
});

describe("Event campaigns errors (audit P2-7)", () => {
  it("catches load, select, save and enqueue failures and shows them", () => {
    const campaigns = read("app/admin/events/campaigns/page.tsx");
    expect(campaigns.match(/catch \(caught\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(campaigns).toContain('role="alert">{pageError}');
  });
});
