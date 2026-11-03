/**
 * Door-code usage and the no-show rule. Pure functions with no Firebase
 * imports, so the rules can be tested on their own.
 *
 * The no-show sweep used to look for a `code_used` event that nothing ever
 * wrote, so it revoked every active code 30 minutes in, even for members
 * who had opened the door. Now the verified Seam webhook records each use
 * of a member's code, and the sweep revokes only when every check worked and
 * none of them showed the member arrived. Anything missing, unknown or
 * failed keeps the code: wrongly locking out a member who is in the building
 * is far worse than leaving an unused code live until the booking ends.
 */

/** Our internal code status for a Seam access-code event, if it changes one. */
export function seamCodeStatusFor(eventType: string): "active" | "revoked" | "failed" | undefined {
  switch (eventType) {
    case "access_code.set_on_device": // Seam's real event names
    case "access_code.set": // older name the handler used; kept so nothing regresses
      return "active";
    case "access_code.removed_from_device":
    case "access_code.removed":
      return "revoked";
    case "access_code.failed_to_set_on_device":
    case "access_code.failed":
      return "failed";
    default:
      return undefined;
  }
}

const INTERNAL_EVENT_TYPES: Record<string, string> = {
  "lock.unlocked": "door_unlocked",
  "device.connected": "device_online",
  "device.disconnected": "device_offline",
};

/** Our accessEvents type for a Seam event, if we log it. */
export function internalEventTypeFor(eventType: string): string | undefined {
  const status = seamCodeStatusFor(eventType);
  if (status === "active") return "code_active";
  if (status === "revoked") return "code_revoked";
  if (status === "failed") return "code_failed";
  return INTERNAL_EVENT_TYPES[eventType];
}

/**
 * The few Seam fields we keep with an access event. Seam events can carry
 * the PIN (`code`) and device or workspace details, so the raw payload is
 * never stored. Only allow-listed IDs, type, method and time are kept.
 */
export function sanitizeSeamEvent(event: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const keep: Array<[string, string]> = [
    ["event_id", "seamEventId"],
    ["event_type", "seamEventType"],
    ["device_id", "seamDeviceId"],
    ["access_code_id", "seamCodeId"],
    ["method", "method"],
    ["occurred_at", "occurredAt"],
  ];
  for (const [from, to] of keep) {
    const value = event[from];
    if (typeof value === "string" && value.length > 0 && value.length <= 100) out[to] = value;
  }
  return out;
}

/** A Seam unlock made with one of our access codes. */
export function isCodeUnlock(event: { event_type?: unknown; access_code_id?: unknown }): boolean {
  return event.event_type === "lock.unlocked" && typeof event.access_code_id === "string" && event.access_code_id.length > 0;
}

/** When the unlock happened: Seam's occurred_at if valid and not in the future, else now. */
export function unlockTime(occurredAt: unknown, now: number): number {
  const parsed = typeof occurredAt === "string" ? Date.parse(occurredAt) : NaN;
  return Number.isFinite(parsed) && parsed <= now ? parsed : now;
}

/** Access events that show the member got in (or staff let them in). */
export const PRESENCE_EVENT_TYPES = ["code_used", "door_unlocked", "door_unlock_requested", "admin_override"] as const;

export type NoShowInput = {
  now: number;
  /** Minutes after the booking start before a no-show can be called. */
  noShowGraceMinutes: number;
  grant: Record<string, unknown> | null;
  booking: Record<string, unknown> | null;
  door: Record<string, unknown> | null;
  codes: Array<Record<string, unknown>>;
  /** Access events for this grant or booking (any type). */
  events: Array<Record<string, unknown>>;
  /** The member's kiosk visits. */
  visits: Array<Record<string, unknown>>;
};

export type NoShowDecision = { revoke: true } | { revoke: false; reason: string };

const keep = (reason: string): NoShowDecision => ({ revoke: false, reason });
const isSet = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== false;
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Decides whether a grant is a no-show. Revokes only when the grant, booking,
 * door and code are all known and in the expected state, the no-show time has
 * passed, and nothing shows the member arrived.
 */
export function decideNoShow(input: NoShowInput): NoShowDecision {
  const { grant, booking, door, now } = input;
  if (!grant) return keep("grant_missing");
  if (grant.status !== "active") return keep("grant_not_active");
  const bookingId = str(grant.bookingId);
  const doorId = str(grant.doorId);
  const userId = str(grant.userId);
  if (!bookingId || !doorId || !userId) return keep("grant_incomplete");

  // Any recorded use of the code, on the grant or on any of its codes.
  if (isSet(grant.firstUsedAt) || isSet(grant.lastUsedAt)) return keep("code_used");
  if (input.codes.some((c) => isSet(c.firstUsedAt) || isSet(c.lastUsedAt))) return keep("code_used");
  if (input.events.some((e) => (PRESENCE_EVENT_TYPES as readonly string[]).includes(String(e.eventType)))) {
    return keep("code_used");
  }

  if (!booking) return keep("booking_missing");
  const start = Number(booking.start);
  const end = Number(booking.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return keep("booking_incomplete");
  if (String(booking.status ?? "").toUpperCase() !== "CONFIRMED") return keep("booking_not_confirmed");
  if (booking.userId !== userId) return keep("booking_mismatch");
  if (isSet(booking.checkedInAt)) return keep("checked_in");

  // Measured from the real booking start, not the grant start (which is
  // moved earlier by the entry grace period).
  if (now < start + input.noShowGraceMinutes * 60_000) return keep("too_early");
  if (now >= end) return keep("booking_ended");

  // Checked in at the front desk iPad (or by a door unlock) during the booking.
  const overlaps = input.visits.some((v) => {
    const checkInAt = Number(v.checkInAt);
    if (!Number.isFinite(checkInAt) || checkInAt >= end) return false;
    return v.checkOutAt == null || Number(v.checkOutAt) > start;
  });
  if (overlaps) return keep("checked_in");

  // Without a lock that is online and a code Seam confirmed on it, a missing
  // unlock event proves nothing: the webhook may not be reaching us.
  if (!door) return keep("door_missing");
  if (door.status !== "online") return keep("door_not_online");
  if (!input.codes.some((c) => c.status === "active")) return keep("code_not_confirmed_on_lock");
  if (input.codes.some((c) => c.status !== "active" && c.status !== "revoked" && c.status !== "expired")) {
    return keep("code_state_unknown");
  }

  return { revoke: true };
}
