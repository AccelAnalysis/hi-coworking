import { describe, expect, it } from "vitest";
import {
  bookingsToCancelAtMembershipEnd,
  membershipEndAt,
  membershipJustEnded,
} from "../../apps/functions/src/sayhi/membershipEnd";

const endAt = Date.UTC(2026, 10, 30, 5);
const day = 86_400_000;

describe("SayHi membership end", () => {
  it("fires when a live membership stops being live", () => {
    expect(membershipJustEnded({ membershipStatus: "active" }, { membershipStatus: "cancelled" })).toBe(true);
    expect(membershipJustEnded({ membershipStatus: "pastDue" }, { membershipStatus: "cancelled" })).toBe(true);
    expect(membershipJustEnded({ membershipStatus: "active" }, { membershipStatus: "pastDue" })).toBe(false);
    expect(membershipJustEnded({ membershipStatus: "cancelled" }, { membershipStatus: "cancelled" })).toBe(false);
    expect(membershipJustEnded({ membershipStatus: "trial" }, { membershipStatus: "active" })).toBe(false);
    expect(membershipJustEnded(undefined, { membershipStatus: "cancelled" })).toBe(false);
  });

  it("uses the recorded end, never a time in the future", () => {
    expect(membershipEndAt({ expiresAt: endAt }, endAt + day)).toBe(endAt);
    expect(membershipEndAt({ expiresAt: endAt + 5 * day }, endAt)).toBe(endAt);
    expect(membershipEndAt({}, endAt)).toBe(endAt);
  });

  it("cancels only confirmed plan bookings that start after the end", () => {
    const bookings = [
      { id: "plan-after", status: "CONFIRMED", start: endAt + day, totalCents: 0, includedHoursApplied: 2 },
      { id: "part-paid-after", status: "CONFIRMED", start: endAt + day, totalCents: 1750, includedHoursApplied: 1 },
      { id: "paid-room-after", status: "CONFIRMED", start: endAt + day, totalCents: 4000, includedHoursApplied: 0 },
      { id: "plan-before", status: "CONFIRMED", start: endAt - day, totalCents: 0, includedHoursApplied: 2 },
      { id: "already-cancelled", status: "CANCELLED", start: endAt + day, totalCents: 0 },
    ];
    expect(bookingsToCancelAtMembershipEnd(bookings, endAt).map((b) => b.id)).toEqual(["plan-after", "part-paid-after"]);
  });
});
