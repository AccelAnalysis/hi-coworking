import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: [] as unknown[][], error: [] as unknown[][], warn: [] as unknown[][] }));
vi.mock("firebase-functions/logger", () => ({
  info: (...args: unknown[]) => { logs.info.push(args); },
  warn: (...args: unknown[]) => { logs.warn.push(args); },
  error: (...args: unknown[]) => { logs.error.push(args); },
}));

import {
  MEMBER_NOTIFICATION_TYPES,
  cancellationScheduledNotification,
  membershipEndedNotification,
  notifyCancellationScheduled,
  notifyMembershipEnded,
  refundFailedNotification,
  refundIssuedNotification,
  writeMemberNotification,
  type MemberNotification,
  type NotificationWriter,
} from "../../apps/functions/src/payments/memberNotifications";
import type { NoticeMember } from "../../apps/functions/src/payments/memberNoticeEmails";
import { notificationTypeSchema } from "../../packages/shared/src/index";

const ACTIVE_UNTIL = Date.UTC(2026, 10, 24, 15); // November 24, 2026 ET
const ENDED_AT = Date.UTC(2026, 9, 24, 22); // October 24, 2026 ET

function memoryWriter() {
  const docs = new Map<string, MemberNotification>();
  const writer: NotificationWriter = {
    async create(doc) {
      if (docs.has(doc.id)) return false;
      docs.set(doc.id, doc);
      return true;
    },
  };
  return { writer, docs };
}

const member: NoticeMember = {
  email: "member@example.com",
  displayName: "Jordan Smith",
  membershipStatus: "active",
  plan: "coworking",
  features: { stripeSubscriptionId: "sub_test_1" },
};

beforeEach(() => {
  logs.info.length = 0;
  logs.warn.length = 0;
  logs.error.length = 0;
});

describe("membership notification copy", () => {
  it("refund issued", () => {
    const note = refundIssuedNotification("member-1", { currency: "usd" }, { id: "re_1", amountCents: 4900 }, 5);
    expect(note).toEqual({
      id: "membership_refund_re_1",
      uid: "member-1",
      type: "membership_refund",
      title: "Your refund is on its way",
      body: "We've refunded $49.00 to your original payment method. Refunds usually take 5–10 business days to appear on your statement.",
      linkTo: "/my-hi",
      read: false,
      createdAt: 5,
    });
    const card = refundIssuedNotification("member-1", { currency: "usd", cardLast4: "4242", cardBrand: "visa" }, { id: "re_1", amountCents: 1000 }, 5);
    expect(card.body).toContain("$10.00 to your Visa card ending in 4242");
  });

  it("refund failed", () => {
    const note = refundFailedNotification("member-1", { currency: "usd" }, { id: "re_1", amountCents: 4900 }, 5);
    expect(note).toMatchObject({
      id: "membership_refund_failed_re_1",
      type: "membership_refund_failed",
      title: "Your refund didn't go through",
      body: "Your refund of $49.00 couldn't be completed. Contact us and we'll sort it out.",
      linkTo: "/my-hi",
    });
  });

  it("cancellation scheduled", () => {
    const note = cancellationScheduledNotification(
      { uid: "member-1", subscriptionId: "sub_test_1", activeUntilMs: ACTIVE_UNTIL, planId: "coworking" }, 5);
    expect(note).toMatchObject({
      id: `membership_cancel_scheduled_sub_test_1_${ACTIVE_UNTIL}`,
      type: "membership_cancellation",
      title: "Your cancellation is confirmed",
      body: "Your Coworking membership stays active until November 24, 2026, and it won't renew after that.",
    });
  });

  it("membership ended", () => {
    const note = membershipEndedNotification(
      { uid: "member-1", subscriptionId: "sub_test_1", endedAtMs: ENDED_AT, planId: "virtual" }, 5);
    expect(note).toMatchObject({
      id: "membership_ended_sub_test_1",
      type: "membership_ended",
      title: "Your membership has ended",
      body: "Your Virtual Office membership ended on October 24, 2026, and you won't be charged for it again.",
    });
  });

  it("uses notification types the shared schema and bell feed know", () => {
    for (const type of Object.values(MEMBER_NOTIFICATION_TYPES)) {
      expect(notificationTypeSchema.safeParse(type).success).toBe(true);
    }
    const page = readFileSync("apps/web/src/app/notifications/page.tsx", "utf8");
    expect(page).toMatch(/membership_refund: \{ icon: RotateCcw/);
    expect(page).toMatch(/membership_refund_failed: \{ icon: AlertCircle/);
    expect(page).toMatch(/membership_cancellation: \{ icon: CalendarClock/);
    expect(page).toMatch(/membership_ended: \{ icon: CalendarX/);
  });
});

describe("membership notification writing", () => {
  it("writes each notice once across webhook retries", async () => {
    const { writer, docs } = memoryWriter();
    const note = refundIssuedNotification("member-1", { currency: "usd" }, { id: "re_1", amountCents: 4900 }, 5);
    expect(await writeMemberNotification(note, { writer })).toBe("created");
    expect(await writeMemberNotification({ ...note, createdAt: 9 }, { writer })).toBe("already_exists");
    expect(docs.size).toBe(1);
    expect(docs.get(note.id)?.createdAt).toBe(5);
  });

  it("never throws when the write fails", async () => {
    const writer: NotificationWriter = { async create() { throw new Error("unavailable"); } };
    const note = refundFailedNotification("member-1", { currency: "usd" }, { id: "re_1", amountCents: 4900 }, 5);
    expect(await writeMemberNotification(note, { writer })).toBe("failed");
    expect(logs.error).toHaveLength(1);
  });

  it("notifies a scheduled cancellation once per subscription and end date", async () => {
    const { writer, docs } = memoryWriter();
    const opts = { writer, loadMember: async () => member, now: () => 7 };
    const input = { uid: "member-1", subscriptionId: "sub_test_1", activeUntilMs: ACTIVE_UNTIL };
    expect(await notifyCancellationScheduled(input, opts)).toBe("created");
    expect(await notifyCancellationScheduled(input, opts)).toBe("already_exists");
    expect(await notifyCancellationScheduled({ ...input, activeUntilMs: ACTIVE_UNTIL + 86_400_000 }, opts)).toBe("created");
    expect(docs.size).toBe(2);
  });

  it("gives comp members no cancellation notifications", async () => {
    const { writer, docs } = memoryWriter();
    const comp = { ...member, membershipSource: "comp", membershipStatus: "cancelled" };
    const opts = { writer, loadMember: async () => comp };
    expect(await notifyCancellationScheduled({ uid: "member-1", subscriptionId: "sub_test_1", activeUntilMs: ACTIVE_UNTIL }, opts))
      .toBe("skipped_comp_membership");
    expect(await notifyMembershipEnded({ uid: "member-1", subscriptionId: "sub_test_1", endedAtMs: ENDED_AT }, opts))
      .toBe("skipped_comp_membership");
    expect(docs.size).toBe(0);
  });

  it("skips another subscription and a membership that did not end", async () => {
    const { writer, docs } = memoryWriter();
    expect(await notifyCancellationScheduled(
      { uid: "member-1", subscriptionId: "sub_other", activeUntilMs: ACTIVE_UNTIL },
      { writer, loadMember: async () => member },
    )).toBe("skipped_different_subscription");
    expect(await notifyMembershipEnded(
      { uid: "member-1", subscriptionId: "sub_test_1", endedAtMs: ENDED_AT },
      { writer, loadMember: async () => member },
    )).toBe("skipped_not_cancelled");
    expect(docs.size).toBe(0);
  });

  it("notifies a membership that ended once", async () => {
    const { writer, docs } = memoryWriter();
    const ended = { ...member, membershipStatus: "cancelled" };
    const opts = { writer, loadMember: async () => ended };
    const input = { uid: "member-1", subscriptionId: "sub_test_1", endedAtMs: ENDED_AT, planId: "virtual" };
    expect(await notifyMembershipEnded(input, opts)).toBe("created");
    expect(await notifyMembershipEnded(input, opts)).toBe("already_exists");
    expect(docs.size).toBe(1);
    expect([...docs.values()][0].body).toContain("Virtual Office membership ended on October 24, 2026");
  });
});

describe("stripe_webhook notification wiring", () => {
  const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
  const handler = readFileSync("apps/functions/src/payments/stripeRefundHandler.ts", "utf8");

  it("writes the bell-feed notices next to the emails", () => {
    expect(webhook).toContain("await notifyCancellationScheduled(");
    expect(webhook).toContain("await notifyMembershipEnded(");
    expect(handler).toContain("writeMemberNotification(refundIssuedNotification(");
    expect(handler).toContain("writeMemberNotification(refundFailedNotification(");
  });
});
