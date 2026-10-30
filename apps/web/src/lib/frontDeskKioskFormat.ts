/**
 * Pure helpers for the front-desk kiosk (no Firebase imports, so tests can
 * load them directly).
 */
import type { BookedWindow } from "./frontDeskKiosk";

// ------------------------------------------------------------ formatting ----

const TIME_ZONE = "America/New_York";

export function formatClock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
}

export function formatDayTime(epoch: number): string {
  return new Date(epoch).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
}

/** "2 hr 15 min", "45 min", "0 min". */
export function formatMinutes(minutes: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours && rest) return `${hours} hr ${rest} min`;
  if (hours) return `${hours} hr`;
  return `${rest} min`;
}

export function formatWindow(window: BookedWindow): string | null {
  if (!window) return null;
  return `${formatClock(window.start)} – ${formatClock(window.end)}`;
}

/** Idempotency key for one tap. */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Network or transport failure, as opposed to a server refusal with copy. */
export function isOfflineError(caught: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const code = (caught as { code?: unknown } | null)?.code;
  const message = String((caught as { message?: unknown } | null)?.message || "");
  return code === "functions/unavailable" || (code === "functions/internal" && message.trim() === "internal");
}

export const KIOSK_STAFF_MESSAGE = "Please see staff.";
export const MEMBER_SCREEN_RESET_SECONDS = 45;
export const RESULT_SCREEN_RESET_SECONDS = 20;

// ------------------------------------------------ Eastern time inputs ----

function easternParts(epoch: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(epoch));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Epoch -> "YYYY-MM-DDTHH:mm" in America/New_York, for datetime-local inputs. */
export function toEasternInputValue(epoch: number): string {
  const p = easternParts(epoch);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * "YYYY-MM-DDTHH:mm" read as America/New_York wall time -> epoch ms,
 * whatever the browser's own time zone is. Handles EST/EDT.
 */
export function fromEasternInputValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Try both possible Eastern offsets and keep the one that round-trips.
  for (const offsetHours of [4, 5]) {
    const candidate = asUtc + offsetHours * 60 * 60 * 1000;
    if (toEasternInputValue(candidate) === value.trim()) return candidate;
  }
  return null;
}
