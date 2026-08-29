import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync("apps/functions/src/main.ts", "utf8");
const guardSource = readFileSync(
  "apps/functions/src/adminPaymentLegacyGuard.ts",
  "utf8",
);
const pageSource = readFileSync(
  "apps/web/src/app/admin/payments/page.tsx",
  "utf8",
);
const isolatedIndex = readFileSync(
  "firebase/payment-status-guard-functions/src/index.ts",
  "utf8",
);
const isolatedPackage = readFileSync(
  "firebase/payment-status-guard-functions/package.json",
  "utf8",
);
const isolatedConfig = JSON.parse(
  readFileSync("firebase.payment-status-guard.json", "utf8"),
);
const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const firestoreRules = readFileSync("firestore.rules", "utf8");

describe("provider-authoritative Payment Ledger", () => {
  it("keeps the legacy callable name deployed fail-closed", () => {
    expect(mainSource).toContain(
      'export { admin_markPaymentStatus } from "./adminPaymentLegacyGuard";',
    );
    expect(mainSource).not.toContain(
      "legacy.admin_markPaymentStatus",
    );
    expect(guardSource).toContain(
      "Manual payment status changes are retired.",
    );
    expect(guardSource).toContain('"failed-precondition"');
    expect(guardSource).not.toContain("updatePaymentStatus");
    expect(guardSource).not.toContain("provisionMembership");
  });

  it("does not expose generic financial-state mutation controls in Admin", () => {
    expect(pageSource).not.toContain(
      'functions, "admin_markPaymentStatus"',
    );
    expect(pageSource).not.toContain("Mark Paid");
    expect(pageSource).not.toContain("Mark Failed");
    expect(pageSource).not.toContain("Confirm refunded");
    expect(pageSource).toContain(
      "Financial state is read-only here.",
    );
    expect(pageSource).toContain(
      "transaction changes happen in the workflow that created the charge",
    );
  });

  it("preserves safe accounting and originating-lifecycle actions", () => {
    expect(pageSource).toContain("admin_syncPaymentToQBO");
    expect(pageSource).toContain("admin_backfillQBO");
    expect(pageSource).toContain("Manage membership");
    expect(pageSource).toContain("Manage event");
    expect(pageSource).toContain("Manage order");
  });

  it("keeps client writes to the unified payment ledger prohibited", () => {
    const paymentRuleStart = firestoreRules.indexOf(
      "match /payments/{paymentId}",
    );
    expect(paymentRuleStart).toBeGreaterThan(-1);
    const paymentRule = firestoreRules.slice(
      paymentRuleStart,
      paymentRuleStart + 500,
    );
    expect(paymentRule).toContain(
      "allow create, update, delete: if false",
    );
  });

  it("deploys the guard from an isolated default-codebase bundle without retired secrets", () => {
    expect(isolatedConfig.functions.source).toBe(
      "firebase/payment-status-guard-functions",
    );
    expect(isolatedConfig.functions.codebase).toBeUndefined();
    expect(isolatedIndex.trim()).toBe(
      'export { admin_markPaymentStatus } from "../../../apps/functions/src/adminPaymentLegacyGuard";',
    );
    expect(isolatedIndex).not.toContain("TWILIO");
    expect(isolatedIndex).not.toContain("SENDGRID");
    expect(isolatedPackage).not.toContain("twilio");
    expect(rootPackage.scripts["build:payment-status-guard-deploy"]).toBeTruthy();
    expect(rootPackage.scripts["deploy:payment-status-guard"]).toContain(
      "firebase.payment-status-guard.json",
    );
    expect(rootPackage.scripts["deploy:payment-status-guard"]).toContain(
      "functions:admin_markPaymentStatus",
    );
  });
});
