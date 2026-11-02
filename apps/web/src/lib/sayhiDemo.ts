/**
 * Sample data for the private SayHi preview only (NEXT_PUBLIC_SAYHI_PREVIEW_DEMO).
 * Fictional names and codes; nothing here is a real customer or a real door
 * code. Production builds never set the flag, so this never renders there.
 */
import type { AccessGrantSummary } from "@/lib/accessCodeView";
import type { BillingAddress } from "@/lib/billingAddressView";
import type { MemberKioskSummary } from "@/lib/frontDeskKiosk";

const HOUR = 3_600_000;

/** member, guest, empty, and ending (a member whose cancellation is scheduled). */
export type DemoKind = "member" | "guest" | "empty" | "ending";

export function demoKind(search: string): DemoKind | null {
  const value = new URLSearchParams(search).get("demo");
  return value === "member" || value === "guest" || value === "empty" || value === "ending" ? value : null;
}

/** /my-hi?demo=emails shows the follow-up email previews. */
export function isEmailPreview(search: string): boolean {
  return new URLSearchParams(search).get("demo") === "emails";
}

/** Fictional address for the preview only. */
const DEMO_BILLING_ADDRESS: BillingAddress = {
  line1: "100 Sample Street",
  line2: "Suite 2",
  city: "Exampleville",
  state: "VA",
  postalCode: "00000",
  country: "US",
};

function demoKioskSummary(kind: DemoKind, base: number): MemberKioskSummary | null {
  if (kind === "empty") return null;
  const guest = kind === "guest";
  const day = 24 * HOUR;
  const visit = (daysAgo: number, minutes: number, extra: Partial<MemberKioskSummary["visits"][number]>) => {
    const checkInAt = base - daysAgo * day;
    return {
      visitId: `demo-visit-${daysAgo}`,
      status: "closed",
      checkInAt,
      checkOutAt: checkInAt + minutes * 60_000,
      actualMinutes: minutes,
      overageMinutes: null,
      needsReview: false,
      overtimeMinutes: null,
      overtimeCents: null,
      chargeStatus: "not_charged",
      ...extra,
    };
  };
  const visits = guest
    ? [visit(3, 150, { overageMinutes: 30, overtimeMinutes: 30, overtimeCents: 875, chargeStatus: "charged" })]
    : [
      visit(2, 250, { overageMinutes: 10 }),
      visit(5, 285, { overageMinutes: 45, overtimeMinutes: 45, overtimeIncludedMinutes: 30, overtimeCents: 350, chargeStatus: "charged" }),
      visit(8, 235, {}),
    ];
  return {
    monthKey: "2026-11",
    visits,
    totalOverageMinutes: visits.reduce((sum, v) => sum + Number(v.overageMinutes || 0), 0),
  };
}


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
  const member = kind === "member" || kind === "ending";
  const userDoc = kind === "ending"
    ? {
      plan: "coworking",
      membershipStatus: "active",
      accountCreditCents: 0,
      cancelAtPeriodEnd: true,
      // Ends after the first sample booking, before the later ones.
      cancelAt: nextWeekdayAt(base, 1, 18),
    }
    : member
      ? { plan: "coworking", membershipStatus: "active", accountCreditCents: 0 }
      : { membershipStatus: "none", accountCreditCents: 0 };
  return {
    bookings,
    grants,
    userDoc,
    displayName: member ? "Sample Member" : "Sample Guest",
    billingAddress: kind === "empty" ? null : DEMO_BILLING_ADDRESS,
    kioskSummary: demoKioskSummary(kind, base),
  };
}
