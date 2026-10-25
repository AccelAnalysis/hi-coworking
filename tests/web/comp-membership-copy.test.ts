import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compMembershipEnded,
  compMembershipLabel,
  isCompMembership,
  showBillingPortal,
} from "../../apps/web/src/lib/membershipCopy";
import { callableErrorMessage } from "../../apps/web/src/lib/callableError";

const now = Date.UTC(2026, 9, 25, 12);

describe("complimentary membership on /my-hi", () => {
  it("hides the Stripe billing portal for comp members", () => {
    expect(showBillingPortal({ membershipStatus: "active", membershipSource: "comp", plan: "virtual" })).toBe(false);
    expect(showBillingPortal({ membershipStatus: "active", plan: "virtual" })).toBe(true);
    expect(showBillingPortal({ membershipStatus: "active", membershipSource: "stripe", plan: "virtual" })).toBe(true);
    expect(showBillingPortal({ membershipStatus: "pastDue" })).toBe(true);
    expect(showBillingPortal({ membershipStatus: "cancelled" })).toBe(false);
    expect(showBillingPortal(null)).toBe(false);
  });

  it("treats a comp past its end date as ended", () => {
    expect(isCompMembership({ membershipSource: "comp" })).toBe(true);
    expect(compMembershipEnded({ membershipSource: "comp", compEndsAt: now - 1 }, now)).toBe(true);
    expect(compMembershipEnded({ membershipSource: "comp", compEndsAt: now + 1 }, now)).toBe(false);
    expect(compMembershipEnded({ membershipSource: "comp", compEndsAt: null }, now)).toBe(false);
    expect(compMembershipEnded({ membershipSource: "stripe", compEndsAt: now - 1 }, now)).toBe(false);
  });

  it("labels comp memberships with their end date in Eastern time", () => {
    expect(compMembershipLabel({ compEndsAt: null })).toBe("Complimentary membership");
    expect(compMembershipLabel({ compEndsAt: Date.UTC(2027, 0, 1, 4, 59) })).toBe("Complimentary through December 31, 2026");
  });

  it("wires the comp state into the My Hi page", () => {
    const page = readFileSync("apps/web/src/app/account/bookings/page.tsx", "utf8");
    expect(page).toContain("showBillingPortal(membershipFields)");
    expect(page).toContain("!compMembershipEnded(membershipFields, now)");
    expect(page).toContain("&& !compMembership\n");
  });
});

describe("callableErrorMessage", () => {
  it("shows the server's explanation for expected refusals", () => {
    expect(callableErrorMessage({ code: "functions/failed-precondition", message: "No paid subscription." }, "Generic")).toBe("No paid subscription.");
    expect(callableErrorMessage({ code: "functions/invalid-argument", message: "Add a reason." }, "Generic")).toBe("Add a reason.");
  });

  it("falls back for internal and unknown errors", () => {
    expect(callableErrorMessage({ code: "functions/internal", message: "INTERNAL" }, "Generic")).toBe("Generic");
    expect(callableErrorMessage(new Error("network"), "Generic")).toBe("Generic");
    expect(callableErrorMessage(null, "Generic")).toBe("Generic");
    expect(callableErrorMessage({ code: "functions/failed-precondition", message: "x".repeat(401) }, "Generic")).toBe("Generic");
  });
});
