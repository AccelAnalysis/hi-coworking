/**
 * Sample data for the private SayHi preview only (NEXT_PUBLIC_SAYHI_PREVIEW_DEMO).
 * Fictional names and codes; nothing here is a real customer or a real door
 * code. Production builds never set the flag, so this never renders there.
 */
import type { AccessGrantSummary } from "@/lib/accessCodeView";

export type DemoKind = "member" | "guest" | "empty";

export function demoKind(search: string): DemoKind | null {
  const value = new URLSearchParams(search).get("demo");
  return value === "member" || value === "guest" || value === "empty" ? value : null;
}

const HOUR = 3_600_000;

function nextWeekdayAt(base: number, daysAhead: number, hourEt: number) {
  const date = new Date(base + daysAhead * 24 * HOUR);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  // Eastern Time is UTC-4 in the preview window (before Nov 1) and UTC-5 after.
  const offset = date.getTime() < Date.UTC(2026, 10, 1, 6) ? 4 : 5;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hourEt + offset);
}

export type DemoBooking = {
  id: string; resourceId: string; resourceName: string; start: number; end: number;
  status: "CONFIRMED"; totalCents: number; subtotalCents: number; paymentMethod: string;
};

export function demoData(kind: DemoKind, now: number) {
  const base = now || Date.UTC(2026, 10, 2, 12);
  const bookings: DemoBooking[] = kind === "empty" ? [] : kind === "guest"
    ? [
      { id: "demo-guest-1", resourceId: "desk-1", resourceName: "Coworking desk", start: nextWeekdayAt(base, 1, 10), end: nextWeekdayAt(base, 1, 12), status: "CONFIRMED", totalCents: 3500, subtotalCents: 3500, paymentMethod: "STRIPE" },
    ]
    : [
      { id: "demo-member-1", resourceId: "desk-1", resourceName: "Coworking desk", start: nextWeekdayAt(base, 1, 9), end: nextWeekdayAt(base, 1, 13), status: "CONFIRMED", totalCents: 0, subtotalCents: 0, paymentMethod: "STRIPE" },
      { id: "demo-member-2", resourceId: "mode-conference", resourceName: "Conference room", start: nextWeekdayAt(base, 2, 14), end: nextWeekdayAt(base, 2, 15), status: "CONFIRMED", totalCents: 9900, subtotalCents: 9900, paymentMethod: "STRIPE" },
      { id: "demo-member-3", resourceId: "desk-2", resourceName: "Coworking desk", start: nextWeekdayAt(base, 4, 8), end: nextWeekdayAt(base, 4, 12), status: "CONFIRMED", totalCents: 0, subtotalCents: 0, paymentMethod: "STRIPE" },
    ];
  const codes = ["204816", "731590", "558203"];
  const grants: AccessGrantSummary[] = bookings.map((booking, index) => ({
    grantId: `demo-grant-${index}`,
    bookingId: booking.id,
    doorName: "Front door",
    startsAt: booking.start,
    endsAt: booking.end,
    grantStatus: index === 2 ? "pending" : "active",
    codeStatus: index === 2 ? "programming" : "active",
    codeLast2: null,
    codeId: null,
    code: index === 2 ? null : codes[index],
  }));
  const userDoc = kind === "member"
    ? { plan: "coworking", membershipStatus: "active", accountCreditCents: 0 }
    : { membershipStatus: "none", accountCreditCents: 0 };
  return { bookings, grants, userDoc, displayName: kind === "member" ? "Sample Member" : "Sample Guest" };
}
