/**
 * When the public Coming Soon gate expires on its own.
 *
 * Single source of truth for the launch countdown and the public site gate.
 * The moment is 8:00 AM America/New_York on Monday, November 16, 2026.
 * That date is after DST ends, so New York is on EST (UTC-05:00): 13:00 UTC.
 */
export const PUBLIC_LAUNCH_AT_ISO = "2026-11-16T08:00:00-05:00";

export const PUBLIC_LAUNCH_AT = Date.parse(PUBLIC_LAUNCH_AT_ISO);

/** True once the launch moment has arrived (inclusive). */
export function isPublicLaunchReached(now: number): boolean {
  return now >= PUBLIC_LAUNCH_AT;
}
