import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "apps/functions/src/adminMemberOperations.ts",
  "utf8",
);
const authoritySource = readFileSync(
  "apps/functions/src/adminMemberOperationsAuthority.ts",
  "utf8",
);
const mainSource = readFileSync(
  "apps/functions/src/main.ts",
  "utf8",
);
const deployIndex = readFileSync(
  "firebase/admin-member-functions/src/index.ts",
  "utf8",
);
const deployConfig = JSON.parse(
  readFileSync("firebase.admin.json", "utf8"),
);
const packageJson = JSON.parse(
  readFileSync("package.json", "utf8"),
);

describe("Admin member operations source contract", () => {
  it("exposes the authoritative membership lifecycle", () => {
    expect(authoritySource).toContain("admin_membershipGetState");
    expect(source).toContain("admin_membershipChangePlan");
    expect(source).toContain("admin_membershipCancel");
    expect(source).toContain("admin_membershipReactivate");
    expect(source).toContain('proration_behavior: "always_invoice"');
    expect(source).toContain('payment_behavior: "error_if_incomplete"');
    expect(source).toContain("cancel_at_period_end: true");
    expect(source).toContain("membership_plan_changed");
    expect(source).toContain("membership_cancel_at_period_end");
  });

  it("treats ended Stripe subscriptions as restartable rather than cancellable", () => {
    expect(authoritySource).toContain("ACTIVE_SUBSCRIPTION_STATUSES");
    expect(authoritySource).toContain("const hasSubscription = ACTIVE_SUBSCRIPTION_STATUSES.has");
    expect(authoritySource).toContain("canRestart: !hasSubscription");
    expect(authoritySource).toContain("hasStripeSubscriptionRecord: true");
  });

  it("keeps account-credit adjustments transactional, bounded, idempotent and audited", () => {
    expect(authoritySource).toContain("admin_accountCreditAdjust");
    expect(authoritySource).toContain("MAX_CREDIT_ADJUSTMENT_CENTS");
    expect(authoritySource).toContain("accountCreditAdjustments");
    expect(authoritySource).toContain("reservedCents");
    expect(authoritySource).toContain("exactReplay");
    expect(authoritySource).toContain('"already-exists"');
    expect(authoritySource).toContain("tx.set(");
    expect(authoritySource).toContain("accountCreditCents: afterCents");
  });

  it("books on behalf through hold, quote, payment and finalization rather than direct client writes", () => {
    expect(source).toContain("admin_bookingForMemberGetAvailability");
    expect(source).toContain("admin_bookingForMemberQuote");
    expect(source).toContain("admin_bookingForMemberBeginCheckout");
    expect(authoritySource).toContain("admin_bookingForMemberFinalize");
    expect(source).toContain('kind: "ADMIN_MEMBER"');
    expect(source).toContain('status: "HELD"');
    expect(source).toContain('purpose: "booking"');
    expect(authoritySource).toContain("admin_onMemberBookingPaymentUpdated");
    expect(authoritySource).toContain("createdByAdminUid");
  });

  it("does not confirm an expired paid hold without consuming its quoted reservations", () => {
    expect(authoritySource).toContain("stripePaymentCompletedAt");
    expect(authoritySource).toContain("paymentWasWithinHold");
    expect(authoritySource).toContain("refundExpiredPaidHold");
    expect(authoritySource).toContain("refundCheckoutPayment");
    expect(authoritySource).toContain("EXPIRED_PAYMENT_REFUNDED");
    expect(authoritySource).toContain("rawUsageReservations");
    expect(authoritySource).toContain("rawCreditReservations");
    expect(authoritySource).toContain("The member-hour reservation no longer matches");
    expect(authoritySource).toContain("The account-credit reservation no longer matches");
  });

  it("exports the hardened handlers instead of the superseded module implementations", () => {
    expect(mainSource).not.toContain('export * from "./adminMemberOperations";');
    expect(mainSource).toContain('from "./adminMemberOperationsAuthority";');
    expect(deployIndex).toContain(
      'from "../../../apps/functions/src/adminMemberOperationsAuthority";',
    );
    expect(deployIndex).toContain("admin_bookingForMemberFinalize");
    expect(deployIndex).toContain("admin_membershipGetState");
    expect(deployIndex).toContain("admin_accountCreditAdjust");
  });

  it("ships through an isolated deploy codebase so unrelated secrets are not analyzed", () => {
    expect(deployConfig.functions).toHaveLength(1);
    expect(deployConfig.functions[0].codebase).toBe("admin-member-ops");
    expect(deployConfig.functions[0].source).toBe(
      "firebase/admin-member-functions",
    );
    expect(deployIndex).toContain("admin_membershipChangePlan");
    expect(deployIndex).toContain("admin_bookingForMemberBeginCheckout");
    expect(deployIndex).not.toContain("SENDGRID");
    expect(packageJson.scripts["build:admin-member-deploy"]).toBeTruthy();
    expect(packageJson.scripts["deploy:admin-member"]).toContain(
      "firebase.admin.json",
    );
  });
});
