import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/functions/src/adminMemberOperations.ts", "utf8");
const deployIndex = readFileSync("firebase/admin-member-functions/src/index.ts", "utf8");
const deployConfig = JSON.parse(readFileSync("firebase.admin.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("Admin member operations source contract", () => {
  it("exposes the authoritative membership lifecycle", () => {
    expect(source).toContain("admin_membershipGetState");
    expect(source).toContain("admin_membershipChangePlan");
    expect(source).toContain("admin_membershipCancel");
    expect(source).toContain("admin_membershipReactivate");
    expect(source).toContain('proration_behavior: "always_invoice"');
    expect(source).toContain('payment_behavior: "error_if_incomplete"');
    expect(source).toContain("cancel_at_period_end: true");
    expect(source).toContain("membership_plan_changed");
    expect(source).toContain("membership_cancel_at_period_end");
  });

  it("keeps account-credit adjustments transactional, bounded and audited", () => {
    expect(source).toContain("admin_accountCreditAdjust");
    expect(source).toContain("MAX_CREDIT_ADJUSTMENT_CENTS");
    expect(source).toContain("accountCreditAdjustments");
    expect(source).toContain("reservedCents");
    expect(source).toContain("tx.set(userRef, { accountCreditCents: afterCents");
  });

  it("books on behalf through hold, quote, payment and finalization rather than direct client writes", () => {
    expect(source).toContain("admin_bookingForMemberGetAvailability");
    expect(source).toContain("admin_bookingForMemberQuote");
    expect(source).toContain("admin_bookingForMemberBeginCheckout");
    expect(source).toContain("admin_bookingForMemberFinalize");
    expect(source).toContain('kind: "ADMIN_MEMBER"');
    expect(source).toContain('status: "HELD"');
    expect(source).toContain('purpose: "booking"');
    expect(source).toContain("admin_onMemberBookingPaymentUpdated");
    expect(source).toContain("createdByAdminUid");
  });

  it("ships through an isolated deploy codebase so unrelated secrets are not analyzed", () => {
    expect(deployConfig.functions).toHaveLength(1);
    expect(deployConfig.functions[0].codebase).toBe("admin-member-ops");
    expect(deployConfig.functions[0].source).toBe("firebase/admin-member-functions");
    expect(deployIndex).toContain("admin_membershipChangePlan");
    expect(deployIndex).toContain("admin_bookingForMemberBeginCheckout");
    expect(deployIndex).toContain("admin_accountCreditAdjust");
    expect(deployIndex).not.toContain("SENDGRID");
    expect(packageJson.scripts["build:admin-member-deploy"]).toBeTruthy();
    expect(packageJson.scripts["deploy:admin-member"]).toContain("firebase.admin.json");
  });
});
