import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExchangeUrlState } from "../../apps/web/src/features/exchange/state/exchangeUrlState";

const read = (path: string) => readFileSync(path, "utf8");

describe("Run 4 Exchange launch navigation", () => {
  it.each(["intelligence", "referrals", "opportunities", "resources"])("accepts the %s primary Exchange view", (view) => {
    expect(parseExchangeUrlState(`?view=${view}`).view).toBe(view);
  });

  it("keeps the prototype-based workspace as the canonical Exchange entry", () => {
    const exchangeRoute = read("apps/web/src/app/exchange/page.tsx");
    expect(exchangeRoute).toContain("ExchangeWorkspace");
    expect(exchangeRoute).toContain('variant="workspace"');
    expect(exchangeRoute).not.toContain("RfxFeedPage");
    expect(exchangeRoute).not.toContain('../rfx/page');
  });

  it("sends new representatives into mandatory organization activation while preserving sign-in resume", () => {
    const login = read("apps/web/src/app/login/page.tsx");
    const register = read("apps/web/src/app/register/page.tsx");
    const exchange = read("apps/web/src/app/exchange/page.tsx");
    expect(login).toContain('router.push("/exchange")');
    expect(register).toContain('router.push("/exchange/onboarding")');
    expect(register).toContain("accountInitializeFn");
    expect(register).toContain("businessRepresentativeAttestation");
    expect(register).not.toMatch(/Connecting an organization remains optional/i);
    expect(exchange).toContain("guidedActivationRequired");
    expect(exchange).toContain("activationReady");
  });

  it("uses the approved five-item mobile order and removes Businesses and Teaming from primary navigation", () => {
    const mobile = read("apps/web/src/features/exchange/components/ExchangeMobileNavigation.tsx");
    const desktop = read("apps/web/src/features/exchange/components/ExchangeViewTabs.tsx");
    const tokens = [
      'label: "Intelligence"',
      'label: "Referrals"',
      'label: "Opportunities"',
      'label: "Resources"',
      '<span>Menu</span>',
    ];
    let prior = -1;
    for (const token of tokens) {
      const position = mobile.indexOf(token);
      expect(position).toBeGreaterThan(prior);
      prior = position;
    }
    expect(desktop).not.toContain('label: "Businesses"');
    expect(desktop).not.toContain('label: "Teaming"');
    expect(desktop).toContain('label: "Intelligence"');
    expect(desktop).toContain('label: "Referrals"');
    expect(desktop).toContain('label: "Opportunities"');
    expect(desktop).toContain('label: "Resources"');
  });

  it("normalizes legacy business, teaming, and connections states into the current product model", () => {
    const workspace = read("apps/web/src/features/exchange/components/ExchangeWorkspace.tsx");
    expect(workspace).toContain('view === "connections"');
    expect(workspace).toContain('return "referrals"');
    expect(workspace).toContain('view === "businesses" || view === "teaming"');
    expect(workspace).toContain('return "opportunities"');
  });

  it("keeps teaming inside an opportunity detail modal", () => {
    const detail = read("apps/web/src/features/exchange/components/ExchangeEntityDetail.tsx");
    expect(detail).toContain("Team up");
    expect(detail).toContain("Opportunity teaming");
    expect(detail).toContain("Request a partner introduction");
  });

  it("keeps legacy primary routes as Exchange compatibility redirects", () => {
    expect(read("apps/web/src/app/directory/page.tsx")).toContain("/exchange?view=opportunities");
    expect(read("apps/web/src/app/rfx/page.tsx")).toContain("/exchange?view=opportunities");
    expect(read("apps/web/src/app/referrals/page.tsx")).toContain("/exchange?view=referrals");
    const shell = read("apps/web/src/components/AppShell.tsx");
    const memberLinks = shell.slice(shell.indexOf("const memberLinks"), shell.indexOf("const staffLinks"));
    expect(memberLinks).toContain("/exchange");
    expect(memberLinks).not.toContain('href: "/rfx"');
    expect(memberLinks).not.toContain('href: "/directory"');
    expect(memberLinks).not.toContain('href: "/referrals"');
  });

  it("discloses accurate credit and physical-membership terms", () => {
    const founding = read("apps/web/src/app/exchange/founding/page.tsx");
    const wallet = read("apps/web/src/app/exchange/wallet/page.tsx");
    const dashboard = read("apps/web/src/app/dashboard/page.tsx");
    for (const source of [founding, wallet]) {
      expect(source).toMatch(/nominal value of one dollar/i);
      expect(source).toMatch(/nontransferable/i);
      expect(source).toMatch(/no cash-redemption value/i);
      expect(source).toMatch(/12 calendar months/i);
    }
    expect(founding).toMatch(/does not include desk hours/i);
    expect(dashboard).toContain("physicalWorkspaceEnabled");
  });

  it("shows enrollment as closed when protected price configuration is incomplete", () => {
    const founding = read("apps/web/src/app/exchange/founding/page.tsx");
    expect(founding).toContain("Founding enrollment is not yet open");
    expect(founding).toContain("No unapproved price or placeholder Stripe identifier");
  });
});
describe("Run 4 migration safety contract", () => {
  it("requires an explicit project, defaults to dry run, and refuses production apply", () => {
    const migration = read("scripts/migrate-exchange-run4.mjs");
    expect(migration).toContain("Explicit --project=<firebase-project-id> is required");
    expect(migration).toContain('mode: apply ? "apply" : "dry-run"');
    expect(migration).toContain('!projectId.startsWith("demo-")');
    expect(migration).toContain("Apply mode is restricted to demo projects or the Firestore emulator");
    expect(migration).toContain("physicalMembershipFieldsPreserved: true");
    expect(migration).toContain("ambiguousUserCredits");
  });
});
