/**
 * Door staff alerts (Jonathan, Nov 24, 2026, 5:22 PM ET): a code that failed
 * or may still work after removal, a lock that went offline, and a low lock
 * battery go to Jonathan and Jessica.
 *
 * Each alert is:
 * - an open item on Admin > Access (an accessEvents doc with eventType
 *   "staff_alert", staff-read only by the existing rules), and
 * - one email through the existing `mail` queue (mail_sendQueued) to the
 *   staff alert inbox list. The recipients are fixed in the sender
 *   (DOOR_ALERT_TO, see staffAlertRecipients), never taken from the queue doc.
 *
 * Alerts never carry a door code or any digits of one, and never a member's
 * name, email or phone: only booking and grant references, times and the
 * reason. Doc ids are deterministic so a retried webhook or sweep never
 * raises the same alert twice.
 *
 * Pure (no Firebase imports) so the rules are unit-tested.
 */

export const STAFF_ALERT_EVENT_TYPE = "staff_alert";
export const STAFF_ALERT_TEMPLATE = "door_staff_alert";
export const ADMIN_ACCESS_URL = "https://hi-coworking.com/admin/access";

export const STAFF_ALERT_KINDS = [
  "code_failed",
  "code_delayed",
  "code_remove_failed",
  "code_changed_outside",
  "lock_offline",
  "low_battery",
] as const;
export type StaffAlertKind = (typeof STAFF_ALERT_KINDS)[number];

/**
 * Who gets door alerts: Jonathan (jholman@accelanalysis.com, already the
 * owner address in this repo) and the Hi Coworking team inbox, which is the
 * existing staff alert recipient (LEAD_ALERT_TO). Jessica's own address is
 * not in the repo; add it with DOOR_ALERT_TO (comma-separated) in the mail
 * source env to reach her directly.
 */
export const DEFAULT_DOOR_ALERT_TO = ["jholman@accelanalysis.com", "hicoworking@accelanalysis.com"] as const;
export const DOOR_ALERT_TO_PARAM = "DOOR_ALERT_TO";

const EMAIL_RE = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

export function staffAlertRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env[DOOR_ALERT_TO_PARAM] || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  const list = configured.length ? configured : [...DEFAULT_DOOR_ALERT_TO];
  return [...new Set(list.filter((address) => EMAIL_RE.test(address)))];
}

export const STAFF_ALERT_TITLES: Record<StaffAlertKind, string> = {
  code_failed: "A door code could not be set",
  code_delayed: "A door code is taking longer than usual",
  code_remove_failed: "A door code may still work",
  code_changed_outside: "A door code was changed outside Hi Coworking",
  lock_offline: "The door lock is offline",
  low_battery: "The door lock battery is low",
};

const STAFF_ALERT_ACTIONS: Record<StaffAlertKind, string> = {
  code_failed: "Open Admin > Access and tap Retry. If it fails again, unlock remotely or give the guest a one-off code from the Yale Access app.",
  code_delayed: "No action yet. If the code is not active close to the start time, tap Retry in Admin > Access.",
  code_remove_failed: "The code may still open the door. Check the lock in the Yale Access app and remove it there if needed.",
  code_changed_outside: "Someone changed or deleted this booking's code in the lock's app. Check it and tap Retry if the guest still needs a code.",
  lock_offline: "New codes cannot reach the lock while it is offline. Check the lock's Wi-Fi bridge and power. Remote unlock and the front desk cover arrivals.",
  low_battery: "Replace the lock batteries soon.",
};

export type StaffAlertInput = {
  kind: StaffAlertKind;
  doorId: string;
  doorName?: string;
  bookingId?: string;
  grantId?: string;
  /** Short machine reason (e.g. a Seam error type). Never a code or a person's details. */
  reason?: string;
  batteryLevel?: number;
  /** Booking window, for code alerts. */
  startsAt?: number;
  endsAt?: number;
  now: number;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function safeId(value: string | undefined): string | undefined {
  return value && SAFE_ID.test(value) ? value : undefined;
}

/** Strips anything that could be a door code (4+ digit runs) and caps length. */
export function safeReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const cleaned = reason.replace(/[0-9]{4,}/g, "••••").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  return cleaned || undefined;
}

function easternDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Deterministic alert id. Code alerts: one per kind and grant. Lock alerts:
 * at most one per kind, door and day.
 */
export function staffAlertId(input: Pick<StaffAlertInput, "kind" | "doorId" | "grantId" | "bookingId" | "now">): string {
  const ref = safeId(input.grantId) || safeId(input.bookingId);
  const door = safeId(input.doorId) || "door";
  if ((input.kind === "lock_offline" || input.kind === "low_battery") || !ref) {
    return `alert_${input.kind}_${door}_${easternDay(input.now)}`;
  }
  return `alert_${input.kind}_${ref}`;
}

function easternTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** The accessEvents doc for an alert (open until staff resolve it). */
export function buildStaffAlertEvent(input: StaffAlertInput) {
  const id = staffAlertId(input);
  const reason = safeReason(input.reason);
  const battery = typeof input.batteryLevel === "number" && Number.isFinite(input.batteryLevel)
    ? Math.max(0, Math.min(1, input.batteryLevel))
    : undefined;
  return {
    id,
    provider: "seam" as const,
    eventType: STAFF_ALERT_EVENT_TYPE,
    alertKind: input.kind,
    alertStatus: "open" as const,
    doorId: input.doorId,
    ...(safeId(input.bookingId) ? { bookingId: input.bookingId } : {}),
    ...(safeId(input.grantId) ? { grantId: input.grantId } : {}),
    ...(battery !== undefined ? { batteryLevel: battery } : {}),
    notes: [STAFF_ALERT_TITLES[input.kind], reason ? `(${reason})` : ""].filter(Boolean).join(" "),
    createdAt: input.now,
  };
}

/** The mail-queue doc for an alert. No `to`: the sender adds the staff list. */
export function buildStaffAlertMail(input: StaffAlertInput) {
  const reason = safeReason(input.reason);
  const rows: Array<[string, string]> = [];
  if (input.doorName) rows.push(["Door", input.doorName.slice(0, 80)]);
  if (safeId(input.bookingId)) rows.push(["Booking", `#${input.bookingId!.slice(-6)}`]);
  if (typeof input.startsAt === "number" && typeof input.endsAt === "number") {
    rows.push(["Code window", `${easternTime(input.startsAt)} to ${easternTime(input.endsAt)} ET`]);
  }
  if (typeof input.batteryLevel === "number" && Number.isFinite(input.batteryLevel)) {
    rows.push(["Battery", `${Math.round(Math.max(0, Math.min(1, input.batteryLevel)) * 100)}%`]);
  }
  if (reason) rows.push(["Reason", reason]);
  rows.push(["When", `${easternTime(input.now)} ET`]);
  return {
    template: STAFF_ALERT_TEMPLATE,
    toStaff: true,
    data: {
      kind: input.kind,
      title: STAFF_ALERT_TITLES[input.kind],
      action: STAFF_ALERT_ACTIONS[input.kind],
      rows: rows.map(([label, value]) => `${label}: ${value}`),
      adminUrl: ADMIN_ACCESS_URL,
    },
  };
}

/** Low battery: Seam's own low-battery event, or a reading under 20%. */
export const LOW_BATTERY_THRESHOLD = 0.2;
export function isLowBattery(level: unknown, status?: unknown): boolean {
  if (status === "low" || status === "critical") return true;
  return typeof level === "number" && Number.isFinite(level) && level >= 0 && level < LOW_BATTERY_THRESHOLD;
}
