import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: () => ({}),
  firestore: () => ({}),
}));

import {
  consentRowFromUser,
  memberAuditEntries,
  requireAdminCaller,
  safeSummary,
  smsConsentView,
  termsView,
} from "../../apps/functions/src/adminMemberRecord";

const source = readFileSync("apps/functions/src/adminMemberRecord.ts", "utf8");

function caller(role?: string) {
  return { auth: { uid: "caller-1", token: role ? { role } : {} } } as never;
}

describe("admin member record access", () => {
  it("rejects signed-out callers", () => {
    expect(() => requireAdminCaller({ auth: undefined } as never)).toThrow(/Sign in/);
  });

  it.each([undefined, "member", "staff", "externalVendor"])("rejects role %s", (role) => {
    expect(() => requireAdminCaller(caller(role))).toThrow(/Only admins/);
  });

  it.each(["admin", "master"])("allows role %s", (role) => {
    expect(requireAdminCaller(caller(role))).toBe("caller-1");
  });

  it("checks the role in both callables before any read", () => {
    for (const name of ["admin_memberRecordGet", "admin_consentList"]) {
      const body = source.slice(source.indexOf(`export const ${name}`));
      expect(body.indexOf("requireAdminCaller(request)")).toBeGreaterThan(-1);
      expect(body.indexOf("requireAdminCaller(request)")).toBeLessThan(body.indexOf("admin.firestore()"));
    }
  });

  it("uses equality queries only, so no composite index or rules change is needed", () => {
    expect(source).not.toMatch(/\.orderBy\(/);
    expect(source).not.toMatch(/onDocument|onSchedule|batch\(|runTransaction|\.set\(\{|\.update\(\{|\.delete\(\)/);
  });
});

describe("minimal fields", () => {
  it("drops consent wording and unknown SMS consent keys", () => {
    const view = smsConsentView({
      optIn: true,
      phone: "+15550000000",
      source: "preferences",
      textVersion: "v1",
      consentText: "long wording",
      consentedAt: 10,
      extra: "x",
    });
    expect(view).toEqual({
      optIn: true,
      phone: "+15550000000",
      source: "preferences",
      textVersion: "v1",
      consentedAt: 10,
      optedOutAt: null,
      optOutReason: null,
      updatedAt: null,
    });
    expect(smsConsentView(undefined)).toBeNull();
  });

  it("keeps terms version, source and time only", () => {
    expect(termsView({ version: "t1", source: "signup", acceptedAt: 5, text: "terms body" })).toEqual({ version: "t1", source: "signup", acceptedAt: 5 });
  });

  it("allow-lists audit details and drops free text and contact details", () => {
    expect(
      safeSummary({ fromPlan: "a", toPlan: "b", note: "called them", email: "x@example.invalid", stripeCheckoutSessionId: "cs_1", totalCents: 500, holdId: "h1" }),
    ).toEqual({ fromPlan: "a", toPlan: "b", totalCents: 500 });
  });

  it("merges every audit source newest first and never passes notes", () => {
    const rows = memberAuditEntries({
      memberOps: [{ id: "m1", action: "membership_plan_changed", adminUid: "a1", createdAt: 30, details: { toPlan: "pro" } }],
      payments: [{ id: "p1", action: "mark_paid", performedBy: "a2", createdAt: 20, paymentId: "pay1", previousStatus: "pending", newStatus: "paid", note: "secret note" }],
      credits: [{ id: "c1", performedBy: "a1", createdAt: 40, deltaCents: 500, afterCents: 900, reason: "goodwill", note: "private" }],
      roles: [{ id: "r1", actorUid: "a3", createdAt: 10, fromRole: null, toRole: "staff" }],
    });
    expect(rows.map((row) => row.id)).toEqual(["c1", "m1", "p1", "r1"]);
    expect(rows[0].summary).toEqual({ deltaCents: 500, creditCents: 900, reason: "goodwill" });
    expect(rows[3].summary).toEqual({ fromStatus: "none", toStatus: "staff" });
    expect(JSON.stringify(rows)).not.toMatch(/secret note|private/);
  });

  it("builds a consent row without the phone number", () => {
    const row = consentRowFromUser("u1", {
      displayName: "Test Member",
      email: "member@example.invalid",
      phone: "+15550000000",
      smsConsent: { optIn: false, optedOutAt: 7, optOutReason: "twilio-21610", phone: "+15550000000" },
      marketingOptOut: true,
    });
    expect(row).toMatchObject({ uid: "u1", smsOptIn: false, smsUpdatedAt: 7, smsOptOutReason: "twilio-21610", marketingOptOut: true, doNotContact: false });
    expect(JSON.stringify(row)).not.toContain("5550000000");
  });
});
