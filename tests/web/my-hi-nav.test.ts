import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMyHiPath,
  LEGACY_BOOKINGS_HREF,
  MY_HI_BOOKINGS_ID,
  MY_HI_HREF,
  MY_HI_LABEL,
} from "../../apps/web/src/lib/myHiNav";
import { MEMBER_HI_HOME } from "../../apps/web/src/lib/rfxQuarantine";
import { BILLING_PORTAL_RETURN_URL } from "../../apps/functions/src/memberBillingPortal";

const read = (path: string) => readFileSync(path, "utf8");

describe("My Hi navigation", () => {
  it("treats /my-hi and the legacy bookings route as My Hi", () => {
    expect(MY_HI_HREF).toBe("/my-hi");
    expect(MY_HI_LABEL).toBe("My Hi");
    expect(isMyHiPath("/my-hi")).toBe(true);
    expect(isMyHiPath("/my-hi/")).toBe(true);
    expect(isMyHiPath(LEGACY_BOOKINGS_HREF)).toBe(true);
    expect(isMyHiPath("/account/events")).toBe(false);
    expect(isMyHiPath("/notifications")).toBe(false);
    expect(isMyHiPath(null)).toBe(false);
  });

  it("labels the account entry My Hi in the header, account menu and mobile drawer", () => {
    const shell = read("apps/web/src/components/AppShell.tsx");
    expect(shell).not.toContain('href="/account/bookings"');
    expect(shell).not.toMatch(/>\s*Bookings\s*</);
    // Desktop header link, account menu item and mobile drawer item.
    expect(shell.match(/href=\{MY_HI_HREF\}/g)).toHaveLength(3);
    expect(shell.match(/\{MY_HI_LABEL\}/g)).toHaveLength(3);
    expect(shell.match(/aria-current=\{onMyHi \? "page" : undefined\}/g)).toHaveLength(3);
    expect(shell).toContain("const onMyHi = isMyHiPath(pathname);");
    expect(shell).toContain("min-h-11");
  });

  it("keeps bookings reachable from inside My Hi and keeps the bookings route", () => {
    const page = read("apps/web/src/app/account/bookings/page.tsx");
    expect(MY_HI_BOOKINGS_ID).toBe("bookings");
    expect(page).toContain("id={MY_HI_BOOKINGS_ID}");
    expect(page).toContain('aria-labelledby="my-hi-bookings-heading"');
    expect(page).toContain("href={`#${MY_HI_BOOKINGS_ID}`}");
    expect(page).toContain("Your upcoming bookings");
  });
});

describe("every member entry point lands on /my-hi", () => {
  it("self-serve Checkout returns to /my-hi with the welcome banner query", () => {
    expect(read("apps/web/src/app/pricing/page.tsx")).toContain(
      "/my-hi?payment=success&plan=${encodeURIComponent(tierId)}",
    );
  });

  it("an admin-sent membership Checkout link returns to /my-hi too", () => {
    const authority = read("apps/functions/src/adminMembershipAuthority.ts");
    expect(authority).toContain(
      "successUrl: `${origin}/my-hi?payment=success&plan=${encodeURIComponent(tier.id)}`",
    );
    expect(authority).not.toContain("/pricing?membership=reactivated");
  });

  it("the billing portal returns to /my-hi", () => {
    expect(BILLING_PORTAL_RETURN_URL).toBe("https://hi-coworking.com/my-hi");
  });

  it("the welcome email links to /my-hi", () => {
    expect(read("apps/functions/src/payments/membershipWelcomeEmail.ts")).toContain(
      "const accountUrl = `${origin}/my-hi`;",
    );
  });

  it("sign-in, role redirects and the old /account route go to /my-hi", () => {
    expect(MEMBER_HI_HOME).toBe("/my-hi");
    expect(read("apps/web/src/app/login/page.tsx")).toContain('router.push("/my-hi")');
    expect(read("apps/web/src/components/RequireAuth.tsx")).not.toContain("/account/bookings");
    expect(read("apps/web/src/app/account/page.tsx")).toContain('redirect("/my-hi")');
  });
});
