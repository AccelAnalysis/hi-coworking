import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authPath, membershipPath, safeNextPath } from "../../apps/web/src/lib/purchaseNavigation";

describe("purchase navigation", () => {
  it("round trips the exact plan and interval through signup and sign-in", () => {
    for (const tier of ["virtual", "coworking", "dedicated"]) {
      for (const interval of ["month", "year"] as const) {
        const next = membershipPath(tier, interval);
        const signup = new URL(authPath("register", next), "https://test.invalid");
        const signin = new URL(authPath("login", signup.searchParams.get("next")!), "https://test.invalid");
        expect(safeNextPath(signin.searchParams.get("next"))).toBe(next);
      }
    }
  });

  it.each([
    "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test",
    "/\nevil.test", "/%0devil.test", "javascript:alert(1)", "/login?next=/pricing", "/register", "/%zz",
  ])("rejects unsafe or looping next path %s", (path) => {
    expect(safeNextPath(path)).toBe("/account/bookings");
  });

  it("preserves booking query and anchor", () => {
    expect(safeNextPath("/book?date=2026-11-03&resource=seat-1#review")).toBe("/book?date=2026-11-03&resource=seat-1#review");
  });

  it("keeps route intent on back/forward and requires explicit payment", () => {
    for (const page of ["login", "register", "pricing"]) {
      const source = readFileSync(`apps/web/src/app/${page}/page.tsx`, "utf8");
      expect(source).toContain('addEventListener("popstate"');
    }
    const pricing = readFileSync("apps/web/src/app/pricing/page.tsx", "utf8");
    expect(pricing).toContain('requestedInterval === "year"');
    expect(pricing).toContain("Choose monthly billing instead");
    expect(pricing).toContain("Manage membership");
    expect(pricing).toContain('if (!user || hasMembership) return');
  });

  it("never treats return query as confirmation or automatically replaces an account", () => {
    const page = readFileSync("apps/web/src/app/book/complete/page.tsx", "utf8");
    expect(page).toContain('getDoc(doc(db, "bookings", alreadyConfirmed))');
    expect(page).toContain('snapshot.data().status !== "CONFIRMED"');
    expect(page).toContain('if (!result.data.success)');
    expect(page).toContain('kind: "recovery"');
    expect(page).toContain("Switch to the purchaser’s account");
    expect(page).not.toContain('localStorage.removeItem');
    expect(page).toContain("Check status again");
  });
});

describe("booking return hold isolation", () => {
  it("never uses another checkout's recovery secret", async () => {
    const { bookingHoldKey, parseBookingHold } = await import("../../apps/web/src/lib/bookingRecovery");
    const stored = JSON.stringify({ holdId: "first", holdSecret: "secret", expiresAt: 1 });
    expect(bookingHoldKey("first")).not.toBe(bookingHoldKey("second"));
    expect(parseBookingHold(stored, "second")).toBeNull();
    expect(parseBookingHold(stored, "first")?.holdId).toBe("first");
    // Expired holds still need reconciliation: never discard a possibly paid hold by clock alone.
    expect(parseBookingHold(stored)?.expiresAt).toBe(1);
    expect(parseBookingHold("bad json")).toBeNull();
    expect(parseBookingHold('{"holdId":"first"}')).toBeNull();
  });
  it("membership return reads server entitlements, not a payment query", () => {
    const page = readFileSync("apps/web/src/app/pricing/complete/page.tsx", "utf8");
    expect(page).toContain('userDoc?.membershipStatus === "active"');
    expect(page).not.toContain("URLSearchParams");
    expect(page).toContain("Do not purchase again");
  });
});

describe("operational recovery UI", () => {
  it("shows cancelled server results as errors instead of booking success", () => {
    const page = readFileSync("apps/web/src/app/book/complete/page.tsx", "utf8");
    expect(page).toContain('if (result.data.status === "cancelled")');
    expect(page).toContain('setState({ kind: "error", message: result.data.message })');
  });
  it("offers read-only recovery cases with explicit loading failure and action references", () => {
    const page = readFileSync("apps/web/src/app/admin/payments/page.tsx", "utf8");
    const panel = readFileSync("apps/web/src/components/BookingPaymentRecoveryPanel.tsx", "utf8");
    expect(page).toContain('<RequireAuth requiredRole="admin">');
    expect(page).toContain("<BookingPaymentRecoveryPanel />");
    expect(panel).toContain("booking_adminListPaymentRecovery");
    for (const field of ["holdId", "paymentId", "requiredAction", "reason", "createdAt", "userId"]) expect(panel).toContain(`item.${field}`);
    expect(panel).toContain("This does not mean the queue is empty");
    expect(panel).toContain("Refresh recovery");
    expect(panel).toContain("This panel is read-only");
    expect(panel.match(/httpsCallable</g)).toHaveLength(1);
    expect(panel).not.toMatch(/setDoc|updateDoc|deleteDoc/);
  });
});
