export type BookingHold = { holdId: string; holdSecret: string; expiresAt?: number };
export const LEGACY_HOLD_KEY = "hi-coworking-booking-hold";
export function bookingHoldKey(holdId: string): string { return `${LEGACY_HOLD_KEY}:${holdId}`; }
export function parseBookingHold(raw: string | null, expectedId?: string | null): BookingHold | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value.holdId !== "string" || !value.holdId || typeof value.holdSecret !== "string" || !value.holdSecret) return null;
    if (expectedId && value.holdId !== expectedId) return null;
    return value;
  } catch { return null; }
}
