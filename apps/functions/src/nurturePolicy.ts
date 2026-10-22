/** Stable episode identity: retries and later bookings must not re-enroll first-booking nurture. */
export function nurtureEpisode(signal: string, sourceRefId?: string): string {
  return signal === "BOOKING_CONFIRMED" ? "first-booking" : sourceRefId || "lifecycle";
}

/** Inactivity resets only after a new booking, not at each daily scan. */
export function inactiveEpisode(lastBookingAt: number): string {
  return `inactive:${lastBookingAt}`;
}

export function hasMarketingConsent(data: Record<string, unknown>): boolean {
  return data.marketingOptIn === true && data.marketingOptOut !== true && data.doNotContact !== true;
}

/** Read compatibility for legacy per-booking and daily win-back IDs; no data rewrite required. */
export function previousEnrollmentBlocks(
  previous: Record<string, unknown>, signal: string, sourceRefId: string | undefined, now: number,
): boolean {
  if (signal === "BOOKING_CONFIRMED") return true;
  if (signal !== "MEMBER_INACTIVE") return false;
  if (previous.sourceRefId === sourceRefId) return true;
  const currentActivity = /^inactive:\d+$/.test(sourceRefId || "") ? Number(sourceRefId!.slice(9)) : 0;
  const enrolledAt = Number(previous.enrolledAt || 0);
  // Unparseable historical evidence requires review, never a fresh marketing send.
  if (!currentActivity || !Number.isFinite(enrolledAt) || enrolledAt <= 0) return true;
  // A legacy daily enrollment after the last booking belongs to the same inactivity episode.
  if (enrolledAt >= currentActivity) return true;
  // Even after new activity, retain a conservative 90-day win-back cooldown across key migration.
  return now - enrolledAt < 90 * 24 * 60 * 60 * 1000;
}
