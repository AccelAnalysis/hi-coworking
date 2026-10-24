import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEMBERSHIP_TIERS } from "../../packages/shared/src";
import {
  WELCOME_NEXT_STEPS,
  hourlyRate,
  membershipSummary,
  welcomeBannerCopy,
} from "../../apps/web/src/lib/membershipCopy";

const tier = (id: string) => MEMBERSHIP_TIERS.find((t) => t.id === id)!;

describe("membership copy on /my-hi", () => {
  it("summarizes every plan from the plan definitions", () => {
    expect(membershipSummary(tier("virtual"))).toBe(
      "Book a coworking desk whenever you need one, at $17.50/hr. Book up to 14 days ahead.",
    );
    expect(membershipSummary(tier("coworking"))).toBe(
      "10 coworking desk hours included each month, then $14/hr. Book up to 90 days ahead.",
    );
    expect(membershipSummary(tier("coworking_plus"))).toBe(
      "15 coworking desk hours included each month, then $12.25/hr. Book up to 90 days ahead.",
    );
    for (const t of MEMBERSHIP_TIERS) expect(membershipSummary(t)).not.toMatch(/undefined|NaN|\b0 coworking/);
    expect(hourlyRate(1750)).toBe("$17.50/hr");
  });

  it("names the active plan once the webhook has activated it", () => {
    const copy = welcomeBannerCopy({ membershipActive: true, activeTier: tier("virtual"), returnedTier: tier("virtual") });
    expect(copy.state).toBe("active");
    expect(copy.title).toBe("Welcome to Hi Coworking. Your Virtual Office plan is active.");
  });

  it("shows an activating state, naming the plan from the return URL when known", () => {
    expect(welcomeBannerCopy({ membershipActive: false, returnedTier: tier("coworking") })).toMatchObject({
      state: "activating",
      title: "Payment received. Welcome to Hi Coworking.",
    });
    expect(welcomeBannerCopy({ membershipActive: false, returnedTier: tier("coworking") }).body).toContain("Coworking Member plan");
    expect(welcomeBannerCopy({ membershipActive: false }).body).toContain("your membership now");
  });

  it("links next steps only to pages that exist", () => {
    for (const step of WELCOME_NEXT_STEPS) {
      expect(existsSync(`apps/web/src/app${step.href}/page.tsx`), step.href).toBe(true);
    }
  });
});

describe("Checkout return wiring", () => {
  it("keeps the query string when /my-hi forwards to the account page", () => {
    const myHi = readFileSync("apps/web/src/app/my-hi/page.tsx", "utf8");
    expect(myHi).toContain('"use client"');
    expect(myHi).not.toContain('redirect("/account/bookings")');
    expect(myHi).toContain("router.replace(`/account/bookings${window.location.search}${window.location.hash}`)");
  });

  it("returns from Checkout with the plan id", () => {
    const pricing = readFileSync("apps/web/src/app/pricing/page.tsx", "utf8");
    expect(pricing).toContain("/my-hi?payment=success&plan=${encodeURIComponent(tierId)}");
  });

  it("renders the banner as a polite live region with a labelled dismiss button", () => {
    const banner = readFileSync("apps/web/src/components/MembershipWelcomeBanner.tsx", "utf8");
    expect(banner).toContain('role="status"');
    expect(banner).toContain('aria-live="polite"');
    expect(banner).toContain('aria-label="Dismiss welcome message"');
    expect(banner).toContain("h-11 w-11");
    expect(banner).toContain("motion-safe:animate-spin");
  });
});
