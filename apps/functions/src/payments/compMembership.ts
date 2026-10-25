/**
 * Complimentary ("comp") memberships granted by an admin (pure, no Firebase
 * imports so it can be unit tested and shared by every deploy codebase).
 *
 * A comp membership gives a member a plan's entitlements with no Stripe
 * subscription and no charge. It is recorded on users/{uid}:
 *
 * - membershipSource: "comp"
 * - membershipStatus: "active", plan: <tier id>
 * - compEndsAt: ms timestamp, or null for open-ended
 * - expiresAt: same as compEndsAt (null when open-ended)
 * - compReason, compGrantedBy, compGrantedAt
 *
 * Stripe never sees a comp membership, so Stripe webhooks must not change it
 * (see shouldIgnoreStripeMembershipEvent), the billing portal is hidden for
 * it, and renewal reminders skip it. A paid Checkout later replaces it:
 * provisionMembership sets membershipSource back to "stripe".
 */

export const COMP_MEMBERSHIP_SOURCE = "comp";
export const STRIPE_MEMBERSHIP_SOURCE = "stripe";
export const COMP_REASON_MIN_LENGTH = 3;
export const COMP_REASON_MAX_LENGTH = 500;
/** The latest end date an admin can set: about two years out. */
export const COMP_MAX_DURATION_MS = 731 * 24 * 60 * 60 * 1000;

export interface CompMembershipState {
  membershipStatus?: string | null;
  membershipSource?: string | null;
  plan?: string | null;
  compEndsAt?: number | null;
}

export function isCompMembership(user: CompMembershipState | null | undefined): boolean {
  return user?.membershipSource === COMP_MEMBERSHIP_SOURCE;
}

/** True when a comp membership had an end date and that date has passed. */
export function compMembershipEnded(
  user: CompMembershipState | null | undefined,
  now: number,
): boolean {
  if (!isCompMembership(user)) return false;
  const endsAt = Number(user?.compEndsAt || 0);
  return endsAt > 0 && endsAt <= now;
}

/** A comp membership that is currently giving the member access. */
export function isActiveCompMembership(
  user: CompMembershipState | null | undefined,
  now: number,
): boolean {
  return (
    isCompMembership(user)
    && user?.membershipStatus === "active"
    && Boolean(user?.plan)
    && !compMembershipEnded(user, now)
  );
}

/**
 * Stripe subscription events (renewal, failed payment, subscription
 * updated/deleted) describe a paid subscription. A member on an active comp
 * membership has no paid subscription, so such events (for example a late
 * event for an old subscription) must not change their membership.
 */
export function shouldIgnoreStripeMembershipEvent(
  user: CompMembershipState | null | undefined,
): boolean {
  return isCompMembership(user) && user?.membershipStatus === "active";
}

export interface CompGrantInput {
  tierId: string;
  reason: string;
  /** ms timestamp, or null/undefined for open-ended. */
  endsAt?: number | null;
}

export type CompGrantValidation =
  | { ok: true; reason: string; endsAt: number | null }
  | { ok: false; error: string };

export function validateCompGrant(
  input: CompGrantInput,
  validTierIds: readonly string[],
  now: number,
): CompGrantValidation {
  if (!validTierIds.includes(String(input.tierId || ""))) {
    return { ok: false, error: "Choose a valid membership plan." };
  }
  const reason = String(input.reason || "").trim();
  if (reason.length < COMP_REASON_MIN_LENGTH) {
    return {
      ok: false,
      error: "Add a short reason for the complimentary membership (at least 3 characters).",
    };
  }
  if (reason.length > COMP_REASON_MAX_LENGTH) {
    return {
      ok: false,
      error: `Keep the reason under ${COMP_REASON_MAX_LENGTH} characters.`,
    };
  }
  if (input.endsAt === null || input.endsAt === undefined) {
    return { ok: true, reason, endsAt: null };
  }
  const endsAt = Number(input.endsAt);
  if (!Number.isFinite(endsAt) || endsAt <= now) {
    return { ok: false, error: "The end date must be in the future." };
  }
  if (endsAt > now + COMP_MAX_DURATION_MS) {
    return {
      ok: false,
      error: "The end date can be at most two years from today. Leave it blank for no end date.",
    };
  }
  return { ok: true, reason, endsAt: Math.round(endsAt) };
}

/** users/{uid} fields for granting (or re-granting) a comp membership. */
export function compGrantUpdates(
  grant: { tierId: string; reason: string; endsAt: number | null },
  adminUid: string,
  now: number,
): Record<string, unknown> {
  return {
    membershipStatus: "active",
    membershipSource: COMP_MEMBERSHIP_SOURCE,
    plan: grant.tierId,
    compEndsAt: grant.endsAt,
    expiresAt: grant.endsAt,
    compReason: grant.reason,
    compGrantedBy: adminUid,
    compGrantedAt: now,
    compEndedAt: null,
    compEndedBy: null,
    // No Stripe billing applies to a comp membership.
    pastDue: false,
    pastDueAt: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    membershipCancellationPending: false,
    membershipCancellationEffectiveAt: null,
    updatedAt: now,
  };
}

/** users/{uid} fields for moving an active comp membership to another plan. */
export function compPlanChangeUpdates(
  tierId: string,
  now: number,
): Record<string, unknown> {
  return { plan: tierId, updatedAt: now };
}

/**
 * users/{uid} fields for ending a comp membership: "cancelled" when an admin
 * ends it, "expired" when its end date passes.
 */
export function compEndUpdates(
  kind: "cancelled" | "expired",
  endedBy: string,
  now: number,
): Record<string, unknown> {
  return {
    membershipStatus: kind,
    plan: null,
    expiresAt: now,
    compEndedAt: now,
    compEndedBy: endedBy,
    updatedAt: now,
  };
}
