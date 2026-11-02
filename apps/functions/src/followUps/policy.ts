/**
 * Staff follow-up queue (Jonathan's decision, Oct 30, 2026, 9:00 PM).
 *
 * Jessica (Member & Event Operations) owns the human follow-ups in the SayHi
 * flow, and only these three:
 *
 *   no_checkout         a visit with no check-out. Billing is capped at the
 *                       booked end time plus one hour; she reviews the visit.
 *   no_checkin          a booking whose door code was never used and that had
 *                       no iPad check-in; she follows up with the member.
 *   form1583_paperwork  virtual address only (switched off by default): she
 *                       chases the paperwork (scheduling the live video
 *                       confirmation, checking the form and both IDs arrived).
 *                       The live signature confirmation itself is done by
 *                       Jonathan, a human staff member or a notary, never by
 *                       software or an AI assistant.
 *
 * Everything else in onboarding stays automated.
 *
 * Storage: staffFollowUps/{type}_{refId}. Server code writes it (create is
 * idempotent per type and reference), admins read it in Admin > Follow-ups,
 * and an admin callable marks an item done. No emails, texts or webhooks are
 * sent from here. Docs hold ids only (member uid, booking or visit id), never
 * names, emails, phone numbers or ID images.
 *
 * Pure helpers only; the Firestore writer is in ./store.ts.
 */

export const FOLLOW_UPS_COLLECTION = "staffFollowUps";

/** The queue owner. A role, not an account: anyone with admin access can work it. */
export const FOLLOW_UP_OWNER = "jessica" as const;
export const FOLLOW_UP_OWNER_TEAM = "Member & Event Operations" as const;

export const FOLLOW_UP_TYPES = ["no_checkout", "no_checkin", "form1583_paperwork"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const FOLLOW_UP_STATUSES = ["open", "done"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const NO_CHECKOUT_BILLING_CAP_MS = 60 * 60 * 1000;

export type FollowUpDoc = {
  id: string;
  owner: typeof FOLLOW_UP_OWNER;
  ownerTeam: typeof FOLLOW_UP_OWNER_TEAM;
  type: FollowUpType;
  memberId: string;
  bookingId: string | null;
  visitId: string | null;
  reason: string;
  /** Visit check-out time used for billing when there was no check-out. */
  billingCapAt: number | null;
  status: FollowUpStatus;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
};

export const FOLLOW_UP_REASONS: Record<FollowUpType, string> = {
  no_checkout:
    "No check-out was recorded. Billing is capped at the booked end time plus one hour. Review the visit and confirm the time.",
  no_checkin:
    "The door code for this booking was never used and there was no iPad check-in. Follow up with the member.",
  form1583_paperwork:
    "Virtual address paperwork: remind the customer to schedule the live video confirmation and check that the Form 1583 and both IDs arrived. The live signature confirmation is done in person or on video by a person: the owner, a Hi Coworking staff member or a notary.",
};

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  no_checkout: "No check-out",
  no_checkin: "No check-in",
  form1583_paperwork: "Form 1583 paperwork",
};

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isFollowUpType(value: unknown): value is FollowUpType {
  return typeof value === "string" && (FOLLOW_UP_TYPES as readonly string[]).includes(value);
}

/** Deterministic doc id so a retried task never creates a second item. */
export function followUpId(type: FollowUpType, refId: string): string {
  return `${type}_${refId}`;
}

export function buildFollowUp(input: {
  type: FollowUpType;
  memberId: string;
  bookingId?: string | null;
  visitId?: string | null;
  billingCapAt?: number | null;
  now: number;
}): FollowUpDoc {
  if (!isFollowUpType(input.type)) throw new Error("unknown follow-up type");
  if (!ID_RE.test(input.memberId)) throw new Error("follow-up needs a member id");
  const bookingId = input.bookingId && ID_RE.test(input.bookingId) ? input.bookingId : null;
  const visitId = input.visitId && ID_RE.test(input.visitId) ? input.visitId : null;
  const refId = input.type === "no_checkout" ? visitId : input.type === "no_checkin" ? bookingId : input.memberId;
  if (!refId) throw new Error(`follow-up ${input.type} needs its reference id`);
  return {
    id: followUpId(input.type, refId),
    owner: FOLLOW_UP_OWNER,
    ownerTeam: FOLLOW_UP_OWNER_TEAM,
    type: input.type,
    memberId: input.memberId,
    bookingId,
    visitId,
    reason: FOLLOW_UP_REASONS[input.type],
    billingCapAt: input.type === "no_checkout" && Number.isFinite(input.billingCapAt) ? Number(input.billingCapAt) : null,
    status: "open",
    createdAt: input.now,
    updatedAt: input.now,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  };
}

/**
 * Check-out time recorded for a visit nobody checked out of: the booked end
 * time plus one hour, never later than the automatic close and never before
 * check-in. Without a booked window the automatic close time stands.
 */
export function noCheckoutBillingCap(input: {
  checkInAt: number;
  autoCloseAt: number;
  bookedEnd: number | null | undefined;
}): number {
  const { checkInAt, autoCloseAt } = input;
  if (input.bookedEnd == null || !Number.isFinite(input.bookedEnd)) return autoCloseAt;
  const cap = Number(input.bookedEnd) + NO_CHECKOUT_BILLING_CAP_MS;
  return Math.max(checkInAt, Math.min(autoCloseAt, cap));
}

/** A no-show becomes a no-check-in follow-up only if the door code was never used either. */
export function needsNoCheckinFollowUp(input: { flagStatus: string | null; hasVisit: boolean; doorUnlocked: boolean }): boolean {
  return input.flagStatus === "no_show" && !input.hasVisit && !input.doorUnlocked;
}

/** Resolution note: optional, trimmed, max 500 characters. */
export function normalizeResolutionNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim().replace(/\s+/g, " ");
  return note ? note.slice(0, 500) : null;
}
