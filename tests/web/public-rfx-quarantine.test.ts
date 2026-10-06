import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_HI_HOME,
  ADMIN_RFX_QUARANTINE_PREFIXES,
  MEMBER_HI_HOME,
  MEMBER_RFX_QUARANTINE_PREFIXES,
  PUBLIC_HI_HOME,
  PUBLIC_RFX_QUARANTINE_PREFIXES,
  isQuarantinedRfxPath,
  quarantineDestination,
} from "../../apps/web/src/lib/rfxQuarantine";

const root = resolve(process.cwd());

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("public RFx Exchange quarantine", () => {
  it("sends former product URLs to a Hi Coworking page", () => {
    expect(quarantineDestination("/rfx")).toBe(PUBLIC_HI_HOME);
    expect(quarantineDestination("/rfx/detail")).toBe(PUBLIC_HI_HOME);
    expect(quarantineDestination("/platform")).toBe(PUBLIC_HI_HOME);
    expect(quarantineDestination("/directory/profile")).toBe(PUBLIC_HI_HOME);
    expect(quarantineDestination("/referrals")).toBe(PUBLIC_HI_HOME);
    expect(quarantineDestination("/org/dashboard")).toBe(PUBLIC_HI_HOME);
    expect(quarantineDestination("/exchange/map")).toBe(PUBLIC_HI_HOME);
    expect(quarantineDestination("/dashboard")).toBe(MEMBER_HI_HOME);
    expect(quarantineDestination("/profile")).toBe(MEMBER_HI_HOME);
    expect(quarantineDestination("/admin/rfx")).toBe(ADMIN_HI_HOME);
    expect(quarantineDestination("/admin/analytics/export")).toBe(ADMIN_HI_HOME);
    expect(quarantineDestination("/events")).toBeNull();
    expect(quarantineDestination("/book")).toBeNull();
    expect(quarantineDestination("/admin/events")).toBeNull();
    expect(quarantineDestination("/admin/members")).toBeNull();
    expect(isQuarantinedRfxPath("/rfx?tab=my")).toBe(true);
    expect(isQuarantinedRfxPath("/bookstore")).toBe(false);
  });

  it("permanently redirects those URLs in Firebase Hosting", () => {
    const hosting = JSON.parse(read("firebase.json")).hosting;
    const redirects = hosting.redirects as Array<{ source: string; destination: string; type: number }>;

    for (const prefix of [
      ...PUBLIC_RFX_QUARANTINE_PREFIXES,
      ...MEMBER_RFX_QUARANTINE_PREFIXES,
      ...ADMIN_RFX_QUARANTINE_PREFIXES,
    ]) {
      const destination = quarantineDestination(prefix);
      for (const source of [prefix, `${prefix}/**`]) {
        const match = redirects.find((redirect) => redirect.source === source);
        expect(match, source).toMatchObject({ destination, type: 301 });
      }
    }

    expect(redirects.some((redirect) => String(redirect.destination).includes("rfx"))).toBe(false);
  });

  it("does not advertise RFx Exchange on the public coming-soon page", () => {
    const comingSoon = read("apps/web/src/components/ComingSoonExperience.tsx");
    expect(comingSoon).not.toMatch(/RFx|\/rfx|Exchange/i);
    expect(comingSoon).toContain('href="/events"');
    expect(comingSoon).toContain('href="/bookstore"');

    const gate = read("apps/web/src/components/PublicSiteGate.tsx");
    expect(gate).not.toContain("/platform");
    expect(read("apps/web/src/app/layout.tsx")).not.toContain("SoftHideRfxchange");
    expect(existsSync(resolve(root, "apps/web/src/components/SoftHideRfxchange.tsx"))).toBe(false);
    expect(read("apps/web/src/components/AppShell.tsx")).not.toMatch(/\/rfx|\/platform|\/directory|\/profile/);
    expect(read("apps/web/src/app/privacy/page.tsx")).not.toMatch(/RFx|Member Directory|NAICS/);
  });

  it("keeps routed pages free of the old product UI and preserves the screens off-route", () => {
    const routedPages = walk(resolve(root, "apps/web/src/app")).filter((path) => path.endsWith("/page.tsx"));
    for (const page of routedPages) {
      const source = readFileSync(page, "utf8");
      expect(source, page).not.toMatch(/RFx Marketplace|Explore the RFx|Register for the RFx/);
    }

    for (const preserved of [
      "rfx-feed.tsx",
      "rfx-new.tsx",
      "platform.tsx",
      "directory.tsx",
      "referrals.tsx",
      "admin-rfx.tsx",
    ]) {
      expect(existsSync(resolve(root, "apps/web/src/quarantine/rfx-exchange", preserved))).toBe(true);
    }
  });
});
