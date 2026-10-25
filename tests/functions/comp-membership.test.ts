import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMP_MAX_DURATION_MS,
  compEndUpdates,
  compGrantUpdates,
  compMembershipEnded,
  compPlanChangeUpdates,
  isActiveCompMembership,
  isCompMembership,
  shouldIgnoreStripeMembershipEvent,
  validateCompGrant,
} from "../../apps/functions/src/payments/compMembership";
import { failedPaymentUpdates, renewalUpdates } from "../../apps/functions/src/payments/stripeInvoice";
import { subscriptionUpdatedUpdates } from "../../apps/functions/src/payments/stripeSubscription";

const now = 1_793_200_000_000;
const DAY = 24 * 60 * 60 * 1000;
const TIERS = ["virtual", "coworking", "coworking_plus"];
const comp = {
  membershipStatus: "active",
  membershipSource: "comp",
  plan: "coworking",
  compEndsAt: null as number | null,
};

describe("comp membership predicates", () => {
  it("recognises comp memberships and their end date", () => {
    expect(isCompMembership(comp)).toBe(true);
    expect(isCompMembership({ ...comp, membershipSource: "stripe" })).toBe(false);
    expect(isCompMembership(undefined)).toBe(false);
    expect(compMembershipEnded(comp, now)).toBe(false);
    expect(compMembershipEnded({ ...comp, compEndsAt: now + DAY }, now)).toBe(false);
    expect(compMembershipEnded({ ...comp, compEndsAt: now }, now)).toBe(true);
    expect(isActiveCompMembership(comp, now)).toBe(true);
    expect(isActiveCompMembership({ ...comp, compEndsAt: now - 1 }, now)).toBe(false);
    expect(isActiveCompMembership({ ...comp, plan: null }, now)).toBe(false);
    expect(isActiveCompMembership({ ...comp, membershipStatus: "cancelled" }, now)).toBe(false);
  });

  it("ignores Stripe membership events only for an active comp", () => {
    expect(shouldIgnoreStripeMembershipEvent(comp)).toBe(true);
    expect(shouldIgnoreStripeMembershipEvent({ ...comp, membershipStatus: "expired" })).toBe(false);
    expect(shouldIgnoreStripeMembershipEvent({ membershipStatus: "active", plan: "virtual" })).toBe(false);
  });
});

describe("validateCompGrant", () => {
  it("accepts an open-ended grant with a reason", () => {
    expect(validateCompGrant({ tierId: "virtual", reason: "  Founding partner  " }, TIERS, now))
      .toEqual({ ok: true, reason: "Founding partner", endsAt: null });
  });

  it("accepts a future end date up to about two years", () => {
    expect(validateCompGrant({ tierId: "coworking", reason: "Staff", endsAt: now + 30 * DAY }, TIERS, now))
      .toEqual({ ok: true, reason: "Staff", endsAt: now + 30 * DAY });
    expect(validateCompGrant({ tierId: "coworking", reason: "Staff", endsAt: now + COMP_MAX_DURATION_MS + DAY }, TIERS, now).ok)
      .toBe(false);
  });

  it("rejects an unknown plan, a missing reason or a past end date", () => {
    expect(validateCompGrant({ tierId: "gold", reason: "Staff" }, TIERS, now).ok).toBe(false);
    expect(validateCompGrant({ tierId: "virtual", reason: " a " }, TIERS, now).ok).toBe(false);
    expect(validateCompGrant({ tierId: "virtual", reason: "x".repeat(501) }, TIERS, now).ok).toBe(false);
    expect(validateCompGrant({ tierId: "virtual", reason: "Staff", endsAt: now - 1 }, TIERS, now).ok).toBe(false);
    expect(validateCompGrant({ tierId: "virtual", reason: "Staff", endsAt: Number.NaN }, TIERS, now).ok).toBe(false);
  });
});

describe("comp Firestore updates", () => {
  it("grants an active comp membership and clears Stripe billing flags", () => {
    const updates = compGrantUpdates({ tierId: "virtual", reason: "Sponsor", endsAt: now + DAY }, "admin-1", now);
    expect(updates).toMatchObject({
      membershipStatus: "active",
      membershipSource: "comp",
      plan: "virtual",
      compEndsAt: now + DAY,
      expiresAt: now + DAY,
      compReason: "Sponsor",
      compGrantedBy: "admin-1",
      compGrantedAt: now,
      pastDue: false,
      pastDueAt: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
    });
  });

  it("changes a comp plan without touching billing fields", () => {
    expect(compPlanChangeUpdates("coworking_plus", now)).toEqual({ plan: "coworking_plus", updatedAt: now });
  });

  it("ends a comp membership as cancelled or expired", () => {
    expect(compEndUpdates("expired", "system", now)).toEqual({
      membershipStatus: "expired",
      plan: null,
      expiresAt: now,
      compEndedAt: now,
      compEndedBy: "system",
      updatedAt: now,
    });
    expect(compEndUpdates("cancelled", "admin-1", now).membershipStatus).toBe("cancelled");
  });
});

describe("Stripe webhook helpers leave an active comp membership alone", () => {
  it("renewal invoices do not change a comp membership", () => {
    expect(renewalUpdates(comp, { invoiceId: "in_1", periodEndMs: now + 30 * DAY, plan: "virtual", subscriptionId: "sub_old" }, now))
      .toBeNull();
  });

  it("failed invoices do not mark a comp member past due", () => {
    expect(failedPaymentUpdates(comp, { invoiceId: "in_2", periodEndMs: now + 30 * DAY }, now)).toBeNull();
  });

  it("subscription updates do not change a comp plan", () => {
    expect(subscriptionUpdatedUpdates(comp, {
      subscriptionId: "sub_old",
      customerId: "cus_old",
      uid: "member-1",
      status: "active",
      priceId: "price_1U9J0xAHu8lEXCs8UHv7AAiz",
      cancelAtPeriodEnd: true,
      cancelAtMs: now + DAY,
      eventCreatedMs: now,
    }, now)).toEqual({ apply: false, reason: "comp_membership" });
  });

  it("paid members are still handled as before", () => {
    const paid = { membershipStatus: "active", plan: "virtual" };
    expect(renewalUpdates(paid, { invoiceId: "in_3", periodEndMs: now + 30 * DAY, plan: "virtual", subscriptionId: "sub_1" }, now))
      .not.toBeNull();
    expect(failedPaymentUpdates(paid, { invoiceId: "in_4" }, now)).toMatchObject({ pastDue: true });
  });
});

describe("webhook and sweep wiring (source contract)", () => {
  const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
  const nurture = readFileSync("apps/functions/src/nurture.ts", "utf8");

  it("payment failures and subscription deletion skip an active comp membership", () => {
    expect(webhook).toContain("if (shouldIgnoreStripeMembershipEvent(current))");
    expect(webhook).toContain("Complimentary membership left unchanged by Stripe payment failure");
  });

  it("a paid Checkout replaces a comp membership", () => {
    expect(webhook).toContain("membershipSource: STRIPE_MEMBERSHIP_SOURCE");
    expect(webhook).toContain("compEndsAt: null");
  });

  it("comp end dates are enforced by the nurture_process schedule and renewal reminders skip comp", () => {
    expect(nurture).toContain("export async function expireEndedCompMemberships");
    expect(nurture).toContain('compEndUpdates("expired", "system", now)');
    expect(nurture).toContain('action: "membership_comp_expired"');
    expect(nurture).toMatch(/nurture_process[\s\S]*expireEndedCompMemberships\(Date\.now\(\)\)/);
    expect(nurture).toContain("!isCompMembership(data) && expiresAt > now");
  });
});
