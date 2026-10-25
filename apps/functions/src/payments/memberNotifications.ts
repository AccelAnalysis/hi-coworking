/**
 * In-app Notifications (the bell feed, notifications/{id}) for membership
 * refunds and cancellations, written by stripe_webhook next to the emails in
 * memberNoticeEmails.ts. Same collection and fields as the existing
 * "Payment Received" notices (createNotification in index.ts).
 *
 * Each notice has a deterministic doc ID and is written with create(), so a
 * webhook retry or replay never adds a duplicate or resets "read".
 * Writing is independent of the email (a missing Resend key still notifies).
 * Comp memberships (membershipSource "comp") get no cancellation notices.
 * Never throws: a failure is logged and the webhook carries on.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  COMP_MEMBERSHIP_SOURCE,
  firestoreNoticeStore,
  formatNoticeDate,
  planLabel,
  type NoticeMember,
} from "./memberNoticeEmails";
import { formatMoney, refundDestination } from "./stripeRefund";
import type { StripeRefundLine, StripeRefundSnapshot } from "./types";

export const MEMBER_NOTIFICATION_TYPES = {
  refundIssued: "membership_refund",
  refundFailed: "membership_refund_failed",
  cancellationScheduled: "membership_cancellation",
  membershipEnded: "membership_ended",
} as const;

export type MemberNotificationType =
  (typeof MEMBER_NOTIFICATION_TYPES)[keyof typeof MEMBER_NOTIFICATION_TYPES];

export const MEMBER_NOTIFICATION_LINK = "/my-hi";

export interface MemberNotification {
  id: string;
  uid: string;
  type: MemberNotificationType;
  title: string;
  body: string;
  linkTo: string;
  read: false;
  createdAt: number;
}

function notification(
  id: string,
  uid: string,
  type: MemberNotificationType,
  title: string,
  body: string,
  now: number,
): MemberNotification {
  return { id, uid, type, title, body, linkTo: MEMBER_NOTIFICATION_LINK, read: false, createdAt: now };
}

export function refundIssuedNotification(
  uid: string,
  snapshot: Pick<StripeRefundSnapshot, "currency" | "cardLast4" | "cardBrand">,
  refund: Pick<StripeRefundLine, "id" | "amountCents">,
  now: number,
): MemberNotification {
  const amount = formatMoney(refund.amountCents, snapshot.currency);
  return notification(
    `membership_refund_${refund.id}`,
    uid,
    MEMBER_NOTIFICATION_TYPES.refundIssued,
    "Your refund is on its way",
    `We've refunded ${amount} to ${refundDestination(snapshot)}. Refunds usually take 5–10 business days to appear on your statement.`,
    now,
  );
}

export function refundFailedNotification(
  uid: string,
  snapshot: Pick<StripeRefundSnapshot, "currency">,
  refund: Pick<StripeRefundLine, "id" | "amountCents">,
  now: number,
): MemberNotification {
  const amount = formatMoney(refund.amountCents, snapshot.currency);
  return notification(
    `membership_refund_failed_${refund.id}`,
    uid,
    MEMBER_NOTIFICATION_TYPES.refundFailed,
    "Your refund didn't go through",
    `Your refund of ${amount} couldn't be completed. Contact us and we'll sort it out.`,
    now,
  );
}

export function cancellationScheduledNotification(
  input: { uid: string; subscriptionId: string; activeUntilMs: number; planId?: string | null },
  now: number,
): MemberNotification {
  const date = formatNoticeDate(input.activeUntilMs);
  return notification(
    `membership_cancel_scheduled_${input.subscriptionId}_${input.activeUntilMs}`,
    input.uid,
    MEMBER_NOTIFICATION_TYPES.cancellationScheduled,
    "Your cancellation is confirmed",
    `Your ${planLabel(input.planId)} stays active until ${date}, and it won't renew after that.`,
    now,
  );
}

export function membershipEndedNotification(
  input: { uid: string; subscriptionId: string; endedAtMs: number; planId?: string | null },
  now: number,
): MemberNotification {
  const date = formatNoticeDate(input.endedAtMs);
  return notification(
    `membership_ended_${input.subscriptionId}`,
    input.uid,
    MEMBER_NOTIFICATION_TYPES.membershipEnded,
    "Your membership has ended",
    `Your ${planLabel(input.planId)} ended on ${date}, and you won't be charged for it again.`,
    now,
  );
}

export type NotificationOutcome =
  | "created"
  | "already_exists"
  | "skipped_missing_data"
  | "skipped_comp_membership"
  | "skipped_not_cancelled"
  | "skipped_different_subscription"
  | "failed";

export interface NotificationWriter {
  /** Creates the doc; resolves false when it already exists. */
  create(doc: MemberNotification): Promise<boolean>;
}

export function firestoreNotificationWriter(
  db: FirebaseFirestore.Firestore = admin.firestore(),
): NotificationWriter {
  return {
    async create(doc) {
      try {
        await db.collection("notifications").doc(doc.id).create(doc);
        return true;
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code === 6 || code === "already-exists") return false;
        throw error;
      }
    },
  };
}

export interface NotificationOptions {
  writer?: NotificationWriter;
  loadMember?: (uid: string) => Promise<NoticeMember | null>;
  now?: () => number;
}

/** Writes one notice once. Never throws. */
export async function writeMemberNotification(
  doc: MemberNotification,
  options: NotificationOptions = {},
): Promise<NotificationOutcome> {
  try {
    const writer = options.writer ?? firestoreNotificationWriter();
    const created = await writer.create(doc);
    if (created) logger.info("Member notification created", { uid: doc.uid, type: doc.type, id: doc.id });
    return created ? "created" : "already_exists";
  } catch (error) {
    logger.error("Member notification failed (non-fatal)", { uid: doc.uid, type: doc.type, error: String(error) });
    return "failed";
  }
}

async function loadMemberSafe(uid: string, options: NotificationOptions): Promise<NoticeMember | null> {
  const load = options.loadMember ?? ((id: string) => firestoreNoticeStore().loadMember(id));
  try {
    return await load(uid);
  } catch (error) {
    logger.warn("Member notification: could not load user doc", { uid, error: String(error) });
    return null;
  }
}

function storedSubscription(member: NoticeMember): string {
  const fromFeatures = member.features?.stripeSubscriptionId;
  if (typeof fromFeatures === "string" && fromFeatures) return fromFeatures;
  return member.stripeSubscriptionId || "";
}

/** "Active until {date}" notice. Skips comp members and other subscriptions. Never throws. */
export async function notifyCancellationScheduled(
  input: { uid: string; subscriptionId: string; activeUntilMs: number },
  options: NotificationOptions = {},
): Promise<NotificationOutcome> {
  const { uid, subscriptionId, activeUntilMs } = input;
  if (!uid || !subscriptionId || !(activeUntilMs > 0)) return "skipped_missing_data";
  const member = await loadMemberSafe(uid, options);
  if (member?.membershipSource === COMP_MEMBERSHIP_SOURCE) return "skipped_comp_membership";
  const stored = member ? storedSubscription(member) : "";
  if (stored && stored !== subscriptionId) return "skipped_different_subscription";
  const now = (options.now ?? Date.now)();
  return writeMemberNotification(
    cancellationScheduledNotification({ uid, subscriptionId, activeUntilMs, planId: member?.plan }, now),
    options,
  );
}

/**
 * "Membership ended" notice, only when customer.subscription.deleted actually
 * ended the membership (status "cancelled"). Skips comp members. Never throws.
 */
export async function notifyMembershipEnded(
  input: { uid: string; subscriptionId: string; endedAtMs: number; planId?: string },
  options: NotificationOptions = {},
): Promise<NotificationOutcome> {
  const { uid, subscriptionId } = input;
  if (!uid || !subscriptionId) return "skipped_missing_data";
  const member = await loadMemberSafe(uid, options);
  if (member?.membershipSource === COMP_MEMBERSHIP_SOURCE) return "skipped_comp_membership";
  if (member?.membershipStatus !== "cancelled") return "skipped_not_cancelled";
  const stored = storedSubscription(member);
  if (stored && stored !== subscriptionId) return "skipped_different_subscription";
  const now = (options.now ?? Date.now)();
  const endedAtMs = input.endedAtMs > 0 ? input.endedAtMs : now;
  return writeMemberNotification(
    membershipEndedNotification({ uid, subscriptionId, endedAtMs, planId: input.planId || member.plan }, now),
    options,
  );
}
