/** Keep recovery paths aligned with the finalizer's physical door resource.
 * seat-flex is a virtual inventory resource; desk-change access starts at its first real segment.
 */
export function accessResourceForBooking(booking: Record<string, unknown>): string | null {
  if (booking.bookingKind === "desk_change") {
    const segments = booking.segments;
    if (!Array.isArray(segments)) return null;
    const resource = segments[0]?.resourceId;
    return typeof resource === "string" && resource.length > 0 && resource !== "seat-flex" ? resource : null;
  }
  return typeof booking.resourceId === "string" && booking.resourceId.length > 0 ? booking.resourceId : null;
}
