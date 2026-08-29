import { describe, expect, it } from "vitest";
import {
  normalizeBooking,
  normalizeMember,
  normalizePayment,
  toMillis,
} from "../../apps/web/src/lib/adminMemberData";

describe("Admin Member Management live-data compatibility", () => {
  it("normalizes Firestore Timestamp-like values", () => {
    const millis = 1_788_019_200_000;
    expect(toMillis({ toMillis: () => millis })).toBe(millis);
    expect(toMillis({ seconds: millis / 1000 })).toBe(millis);
    expect(toMillis({ _seconds: millis / 1000 })).toBe(millis);
  });

  it("keeps legacy member records renderable when fields are missing", () => {
    const member = normalizeMember({
      createdAt: { seconds: 1_700_000_000 },
      accountCreditCents: "2500",
    }, "legacy-user");

    expect(member.uid).toBe("legacy-user");
    expect(member.email).toBe("");
    expect(member.membershipStatus).toBe("none");
    expect(member.accountCreditCents).toBe(2500);
    expect(member.createdAt).toBe(1_700_000_000_000);
  });

  it("keeps legacy bookings renderable without resource metadata", () => {
    const booking = normalizeBooking({
      userId: "user-1",
      start: { seconds: 1_788_019_200 },
      end: { seconds: 1_788_022_800 },
      status: "confirmed",
      totalPrice: "17.5",
    }, "booking-1");

    expect(booking.resourceId).toBe("");
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.start).toBe(1_788_019_200_000);
    expect(booking.totalPrice).toBe(17.5);
  });

  it("defaults incomplete legacy payment fields instead of throwing", () => {
    const payment = normalizePayment({
      uid: "user-1",
      amount: "4900",
      createdAt: "2026-08-29T12:00:00-04:00",
    }, "payment-1");

    expect(payment.purpose).toBe("other");
    expect(payment.status).toBe("unknown");
    expect(payment.amount).toBe(4900);
    expect(payment.createdAt).toBeTypeOf("number");
  });
});
