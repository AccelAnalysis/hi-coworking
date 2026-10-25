import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canManageBooking,
  cancellationSummary,
  easternEpoch,
  easternParts,
  memberMatchesSearch,
  startTimeOptions,
  timeLabel,
  weekendMessage,
} from "../../apps/web/src/lib/adminBookingActions";

describe("Admin booking action helpers", () => {
  it("lists only start times where the whole booking fits in open hours", () => {
    expect(startTimeOptions([{ startTime: "08:00", endTime: "17:00" }], 120)).toEqual([
      "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00",
      "12:30", "13:00", "13:30", "14:00", "14:30", "15:00",
    ]);
    expect(startTimeOptions([{ startTime: "08:00", endTime: "09:00" }, { startTime: "13:15", endTime: "15:00" }], 60))
      .toEqual(["08:00", "13:30", "14:00"]);
    expect(startTimeOptions([{ startTime: "08:00", endTime: "17:00" }], 0)).toEqual([]);
  });

  it("round-trips Eastern wall time across daylight saving", () => {
    for (const [date, time] of [["2026-11-02", "09:30"], ["2027-03-15", "16:00"]]) {
      expect(easternParts(easternEpoch(date, time))).toEqual({ date, time });
    }
  });

  it("only offers actions on confirmed bookings that have not ended", () => {
    const now = Date.UTC(2026, 9, 26, 15);
    expect(canManageBooking({ status: "CONFIRMED", end: now + 1 }, now)).toBe(true);
    expect(canManageBooking({ status: "CONFIRMED", end: now }, now)).toBe(false);
    expect(canManageBooking({ status: "CANCELLED", end: now + 1 }, now)).toBe(false);
    expect(canManageBooking({ status: "CONFIRMED", end: null }, now)).toBe(false);
  });

  it("flags weekend dates and searches members by name, email or uid", () => {
    expect(weekendMessage("2026-10-24")).toMatch(/closed on weekends/);
    expect(weekendMessage("2026-10-26")).toBeNull();
    const member = { uid: "abc123", displayName: "Dana Smith", email: "dana@example.test" };
    expect(memberMatchesSearch(member, "smith")).toBe(true);
    expect(memberMatchesSearch(member, "DANA@")).toBe(true);
    expect(memberMatchesSearch(member, "abc1")).toBe(true);
    expect(memberMatchesSearch(member, "zzz")).toBe(false);
    expect(memberMatchesSearch(member, "  ")).toBe(true);
  });

  it("describes what the member gets in plain words", () => {
    expect(timeLabel("13:30")).toBe("1:30 PM");
    expect(cancellationSummary({
      choice: "refund", outcome: "FULL_REFUND", reason: "", refundCents: 2000, accountCreditCents: 500, includedHoursToRestore: 2,
    })).toBe("The member gets $20.00 refunded to the card, $5.00 added as account credit, 2 included hours restored.");
    expect(cancellationSummary({
      choice: "policy", outcome: "NO_REFUND", reason: "", refundCents: 0, accountCreditCents: 0, includedHoursToRestore: 0,
    })).toBe("The member gets no refund, credit or hours back.");
  });
});

describe("Admin booking actions UI wiring", () => {
  it("puts Move and Cancel on the member record and the member actions page", () => {
    for (const file of ["apps/web/src/app/admin/members/page.tsx", "apps/web/src/app/admin/members/actions/page.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain("<AdminBookingActions");
    }
    const component = readFileSync("apps/web/src/components/AdminBookingActions.tsx", "utf8");
    expect(component).toContain('"admin_bookingCancel"');
    expect(component).toContain('"admin_bookingReschedule"');
    expect(component).toContain('role="alertdialog"');
    expect(component).toContain("Confirm cancellation");
  });

  it("labels the member search and booking fields", () => {
    const actions = readFileSync("apps/web/src/app/admin/members/actions/page.tsx", "utf8");
    expect(actions).toContain('htmlFor="member-search"');
    expect(actions).toContain('htmlFor="member-select"');
    expect(actions).toContain('aria-describedby="book-day-status"');
  });
});
