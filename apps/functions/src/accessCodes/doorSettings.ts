/**
 * Door access settings (Jonathan, Nov 24, 2026, 5:22 PM ET).
 *
 * - Every confirmed booking gets its own code.
 * - The code works from `bufferMinutes` before the booking starts to
 *   `bufferMinutes` after it ends. Default 15; staff change it in Admin >
 *   Access (siteSettings/doorAccess). A change applies to codes made after
 *   it; existing codes keep their window.
 *
 * Pure (no Firebase imports) so the rules are unit-tested.
 */

export const DOOR_ACCESS_SETTINGS_ID = "doorAccess";
export const DEFAULT_BUFFER_MINUTES = 15;
export const MAX_BUFFER_MINUTES = 60;

export type DoorAccessSettings = { bufferMinutes: number };

/** Reads siteSettings/doorAccess; anything missing or out of range falls back to the default. */
export function parseDoorAccessSettings(data: unknown): DoorAccessSettings {
  const raw = data && typeof data === "object" ? (data as { bufferMinutes?: unknown }).bufferMinutes : undefined;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < 0 || value > MAX_BUFFER_MINUTES) {
    return { bufferMinutes: DEFAULT_BUFFER_MINUTES };
  }
  return { bufferMinutes: Math.round(value) };
}

/** The window a booking's code works in, in epoch ms. */
export function codeWindow(start: number, end: number, bufferMinutes: number): { startsAt: number; endsAt: number } {
  const buffer = Math.max(0, Math.min(MAX_BUFFER_MINUTES, Math.round(bufferMinutes))) * 60 * 1000;
  return { startsAt: start - buffer, endsAt: end + buffer };
}

/**
 * The live door that gates a resource. Single-field query results are
 * filtered here so no composite Firestore index is needed.
 */
export function pickDoor<T extends { status?: unknown; seamDeviceId?: unknown }>(doors: Array<{ id: string; data: T }>): { id: string; data: T } | null {
  return doors.find((door) => door.data.status !== "archived" && typeof door.data.seamDeviceId === "string" && door.data.seamDeviceId.length > 0) ?? null;
}
