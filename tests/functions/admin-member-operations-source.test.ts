import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "apps/functions/src/adminMemberOperations.ts",
  "utf8",
);
const membershipAuthoritySource = readFileSync(
  "apps/functions/src/adminMembershipAuthority.ts",
  "utf8",
);
const authoritySource = readFileSync(
  "apps/functions/src/adminMemberOperationsAuthority.ts",
  "utf8",
);
const bookingAuthoritySource = readFileSync(
  "apps/functions/src/adminMemberBookingAuthority.ts",
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
const deployWorkflow = readFileSync(
  ".github/workflows/firebase-live-admin-member-functions.yml",
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
    expect(membershipAuthoritySource).toContain("admin_membershipGetState");
    expect(membershipAuthoritySource).toContain("admin_membershipChangePlan");
    expect(membershipAuthoritySource).toContain("admin_membershipCancel");
    expect(membershipAuthoritySource).toContain("admin_membershipReactivate");
    expect(membershipAuthoritySource).toContain('proration_behavior: "always_invoice"');
    expect(membershipAuthoritySource).toContain('payment_behavior: "error_if_incomplete"');
    expect(membershipAuthoritySource).toContain("cancel_at_period_end: true");
    expect(membershipAuthoritySource).toContain("membership_plan_changed");
    expect(membershipAuthoritySource).toContain("membership_cancel_at_period_end");
    expect(membershipAuthoritySource).toContain("safeReturnOrigin");
  });

  it("treats ended Stripe subscriptions as restartable rather than cancellable", () => {
    expect(membershipAuthoritySource).toContain("ACTIVE_SUBSCRIPTION_STATUSES");
    expect(membershipAuthoritySource).toContain("const hasSubscription = ACTIVE_SUBSCRIPTION_STATUSES.has");
    expect(membershipAuthoritySource).toContain("canRestart: !hasSubscription");
    expect(membershipAuthoritySource).toContain("hasStripeSubscriptionRecord: true");
    expect(membershipAuthoritySource).toContain("stripe.customers.list");
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
    expect(bookingAuthoritySource).toContain("admin_bookingForMemberFinalize");
    expect(source).toContain('kind: "ADMIN_MEMBER"');
    expect(source).toContain('status: "HELD"');
    expect(source).toContain('purpose: "booking"');
    expect(bookingAuthoritySource).toContain("admin_onMemberBookingPaymentUpdated");
    expect(bookingAuthoritySource).toContain("createdByAdminUid");
  });

  it("requires Stripe provider evidence rather than trusting a manually changed ledger status", () => {
    expect(bookingAuthoritySource).toContain("verifyStripePayment");
    expect(bookingAuthoritySource).toContain('payment.provider !== "stripe"');
    expect(bookingAuthoritySource).toContain('session.payment_status !== "paid"');
    expect(bookingAuthoritySource).toContain('intent.status !== "succeeded"');
    expect(bookingAuthoritySource).toContain("resolveSuccessfulCharge");
    expect(bookingAuthoritySource).toContain("metadata.paymentId !== payment.id");
    expect(bookingAuthoritySource).toContain("linkedHold !== hold.id");
    expect(bookingAuthoritySource).toContain("metadata.uid !== hold.bookedForUid");
    expect(bookingAuthoritySource).toContain("session.amount_total");
  });

  it("refunds verified payments that cannot produce the quoted booking", () => {
    expect(bookingAuthoritySource).toContain("verified.completedAt > Number(initial.expiresAt");
    expect(bookingAuthoritySource).toContain("refundPaidHold");
    expect(bookingAuthoritySource).toContain("refundCheckoutPayment");
    expect(bookingAuthoritySource).toContain("EXPIRED_PAYMENT_REFUNDED");
    expect(bookingAuthoritySource).toContain("FULFILLMENT_FAILED_REFUNDED");
    expect(bookingAuthoritySource).toContain("PAYMENT_RECONCILIATION_REQUIRED");
    expect(bookingAuthoritySource).toContain("rawUsageReservations");
    expect(bookingAuthoritySource).toContain("rawCreditReservations");
    expect(bookingAuthoritySource).toContain("The member-hour reservation no longer matches");
    expect(bookingAuthoritySource).toContain("The account-credit reservation no longer matches");
  });

  it("exports the hardened handlers instead of the superseded module implementations", () => {
    expect(mainSource).not.toContain('export * from "./adminMemberOperations";');
    expect(mainSource).toContain('from "./adminMembershipAuthority";');
    expect(mainSource).toContain('from "./adminMemberOperationsAuthority";');
    expect(mainSource).toContain('from "./adminMemberBookingAuthority";');
    expect(deployIndex).toContain(
      'from "../../../apps/functions/src/adminMembershipAuthority";',
    );
    expect(deployIndex).toContain(
      'from "../../../apps/functions/src/adminMemberOperationsAuthority";',
    );
    expect(deployIndex).toContain(
      'from "../../../apps/functions/src/adminMemberBookingAuthority";',
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
    expect(deployIndex).not.toContain("RESEND_API_KEY");
    expect(deployWorkflow).toContain("adminMembershipAuthority.ts");
    expect(deployWorkflow).toContain("adminMemberOperationsAuthority.ts");
    expect(deployWorkflow).toContain("adminMemberBookingAuthority.ts");
    expect(packageJson.scripts["build:admin-member-deploy"]).toBeTruthy();
    expect(packageJson.scripts["deploy:admin-member"]).toContain(
      "firebase.admin.json",
    );
  });

  it("handles members without a live Stripe subscription and complimentary memberships", () => {
    const actionsPage = readFileSync("apps/web/src/app/admin/members/actions/page.tsx", "utf8");
    // Plan change explains a missing subscription instead of implying a payment failure.
    expect(membershipAuthoritySource).toContain('"This member has no active paid Stripe subscription, so there is no "');
    expect(membershipAuthoritySource).toContain("throw new HttpsError(\"failed-precondition\", NO_LIVE_SUBSCRIPTION_MESSAGE)");
    expect(membershipAuthoritySource).toContain("Admin plan change refused: no active paid Stripe subscription");
    // Comp members change plan in Firestore only, audited, with no Stripe charge.
    expect(membershipAuthoritySource).toContain('action: "membership_comp_plan_changed"');
    expect(membershipAuthoritySource).toContain("export const admin_membershipGrantComp");
    expect(membershipAuthoritySource).toContain("export const admin_membershipEndComp");
    expect(membershipAuthoritySource).toContain('action: "membership_comp_granted"');
    expect(membershipAuthoritySource).toContain('action: "membership_comp_ended"');
    expect(membershipAuthoritySource).toContain("stripeCharge: false");
    expect(membershipAuthoritySource).toContain('"This member already has an active paid Stripe subscription. Change "');
    expect(membershipAuthoritySource).toContain("Use End complimentary membership instead.");
    for (const name of ["admin_membershipGrantComp", "admin_membershipEndComp"]) {
      expect(mainSource).toContain(name);
      expect(deployIndex).toContain(name);
      expect(actionsPage).toContain(`"${name}"`);
    }
    // The admin page shows the server's explanation, not a generic payment message.
    expect(actionsPage).toContain("callableErrorMessage(");
    expect(actionsPage).not.toContain("left unchanged if payment could not be completed");
    expect(actionsPage).toContain("Grant complimentary membership");
    expect(actionsPage).toContain("End complimentary membership");
  });
});
