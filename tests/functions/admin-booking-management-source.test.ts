import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// access.ts opens Firestore when it loads; these tests only need pure math.
vi.mock("../../apps/functions/src/access", () => ({
  createAccessGrant: vi.fn(),
  revokeAccessGrant: vi.fn(),
  seamApiKey: { value: () => "" },
}));
import {
  adminCancellationAmounts,
  customerCancellationAmounts,
  operatorCancellationAmounts,
} from "../../apps/functions/src/bookingManagement";

const HOUR = 60 * 60 * 1000;
const booking = {
  resourceId: "seat-1",
  start: Date.UTC(2030, 0, 7, 15),
  totalCents: 2000,
  accountCreditAppliedCents: 500,
};

describe("Admin cancellation amounts", () => {
  it("gives a full card refund and returns applied credit when Hi Coworking cancels for a refund", () => {
    const amounts = operatorCancellationAmounts(booking, "refund");
    expect(amounts.decision.outcome).toBe("FULL_REFUND");
    expect(amounts.decision.restoreIncludedHoursPercent).toBe(100);
    expect(amounts.refundCents).toBe(2000);
    expect(amounts.accountCreditCents).toBe(500);
  });

  it("returns the whole value as credit when Hi Coworking cancels for credit", () => {
    const amounts = operatorCancellationAmounts(booking, "credit");
    expect(amounts.decision.outcome).toBe("ACCOUNT_CREDIT_100");
    expect(amounts.refundCents).toBe(0);
    expect(amounts.accountCreditCents).toBe(2500);
  });

  it("applies the member policy unchanged when the member asked to cancel", () => {
    const early = booking.start - 3 * 24 * HOUR;
    expect(adminCancellationAmounts(booking, "policy", early))
      .toEqual(customerCancellationAmounts(booking, early));
    const late = booking.start - HOUR;
    expect(adminCancellationAmounts(booking, "policy", late).refundCents).toBe(0);
  });

  it("ignores bad stored amounts", () => {
    const amounts = operatorCancellationAmounts({ totalCents: -5, accountCreditAppliedCents: Number.NaN }, "credit");
    expect(amounts.refundCents).toBe(0);
    expect(amounts.accountCreditCents).toBe(0);
  });
});

describe("Admin booking actions wiring", () => {
  it("deploys the admin callables with the Admin member bundle", () => {
    const index = readFileSync("firebase/admin-member-functions/src/index.ts", "utf8");
    for (const name of ["admin_bookingCancelPreview", "admin_bookingCancel", "admin_bookingReschedule"]) {
      expect(index).toContain(name);
    }
    const workflow = readFileSync(".github/workflows/firebase-live-admin-member-functions.yml", "utf8");
    for (const file of ["adminBookingManagement.ts", "bookingManagement.ts", "bookingPolicy.ts"]) {
      expect(workflow).toContain(`apps/functions/src/${file}`);
    }
  });

  it("requires an admin, checks the operating calendar and audits every change", () => {
    const source = readFileSync("apps/functions/src/adminBookingManagement.ts", "utf8");
    expect(source).toContain('role !== "admin" && role !== "master"');
    expect(source).toContain("assertWindowWithinOperatingCalendar(start, end)");
    expect(source).toContain('action: "booking_cancelled_by_admin"');
    expect(source).toContain('action: "booking_moved_by_admin"');
    expect(source).toContain("ownerUid: null");
  });

  it("keeps the member callables on the member's own bookings", () => {
    const source = readFileSync("apps/functions/src/bookingManagement.ts", "utf8");
    expect(source).toContain("ownerUid: request.auth.uid");
    expect(source).toContain('actorRole: "member"');
  });
});
