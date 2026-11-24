import { describe, expect, it } from "vitest";
import { isSameDayUpgradeEligible } from "../../apps/functions/src/bookingUpgrade";
import { requestOverlapsSlot } from "../../apps/functions/src/conferenceSlotRequests";
import { facilityWallTimeToTimestamp } from "../../apps/functions/src/bookingFlexShared";
import {
  OFFERABLE_RESOURCES as functionOfferable,
  defaultOfferedFor,
  isResourceOffered,
  parseResourceOffering,
} from "../../apps/functions/src/resourceOffering";
import {
  OFFERABLE_RESOURCES as sharedOfferable,
  isResourceOffered as sharedIsOffered,
  parseResourceOffering as sharedParse,
} from "../../packages/shared/src/resourceOffering.ts";

const date = "2030-01-02"; // Wednesday
const start = facilityWallTimeToTimestamp(date, "08:00");
const noon = facilityWallTimeToTimestamp(date, "12:00");
const five = facilityWallTimeToTimestamp(date, "17:00");
const nowMorning = facilityWallTimeToTimestamp(date, "09:00");

describe("same-day upgrade eligibility", () => {
  it("allows a confirmed same-day half-day desk or office booking that has not ended", () => {
    expect(isSameDayUpgradeEligible({
      status: "CONFIRMED",
      resourceId: "seat-1",
      start,
      end: noon,
    }, nowMorning).ok).toBe(true);
    expect(isSameDayUpgradeEligible({
      status: "CONFIRMED",
      resourceId: "private-office",
      start,
      end: noon,
    }, nowMorning).ok).toBe(true);
  });

  it("rejects conference rooms, desk changes, ended visits, and full-day bookings", () => {
    expect(isSameDayUpgradeEligible({
      status: "CONFIRMED",
      resourceId: "mode-conference",
      start,
      end: noon,
    }, nowMorning).ok).toBe(false);
    expect(isSameDayUpgradeEligible({
      status: "CONFIRMED",
      resourceId: "seat-3",
      bookingKind: "desk_change",
      start,
      end: noon,
    }, nowMorning).ok).toBe(false);
    expect(isSameDayUpgradeEligible({
      status: "CONFIRMED",
      resourceId: "seat-3",
      start,
      end: noon,
    }, five).ok).toBe(false);
    expect(isSameDayUpgradeEligible({
      status: "CONFIRMED",
      resourceId: "seat-3",
      start,
      end: five,
    }, nowMorning).ok).toBe(false);
    expect(isSameDayUpgradeEligible({
      status: "CANCELLED",
      resourceId: "seat-3",
      start,
      end: noon,
    }, nowMorning).ok).toBe(false);
  });
});

describe("after-hours request overlap", () => {
  it("treats pending and approved requests as blocking, and declined as free", () => {
    const eveningFour = { startMinutes: 16 * 60, endMinutes: 20 * 60 };
    const afternoonOne = { startMinutes: 13 * 60, endMinutes: 17 * 60, status: "pending" };
    const afternoonNoon = { startMinutes: 12 * 60, endMinutes: 16 * 60, status: "approved" };
    const declined = { startMinutes: 13 * 60, endMinutes: 17 * 60, status: "declined" };
    expect(requestOverlapsSlot(afternoonOne, eveningFour)).toBe(true);
    expect(requestOverlapsSlot(afternoonNoon, eveningFour)).toBe(false);
    expect(requestOverlapsSlot(declined, eveningFour)).toBe(false);
  });
});


describe("resource offering defaults", () => {
  it("keeps the functions helper in sync with shared and leaves the private office off by default", () => {
    expect(functionOfferable).toEqual([...sharedOfferable]);
    expect(isResourceOffered("private-office")).toBe(false);
    expect(sharedIsOffered("private-office")).toBe(false);
    expect(isResourceOffered("seat-1")).toBe(true);
    expect(isResourceOffered("mode-conference")).toBe(true);
    expect(defaultOfferedFor("private-office")).toBe(false);
    expect(isResourceOffered("private-office", { "private-office": true })).toBe(true);
    expect(isResourceOffered("private-office", { "private-office": false })).toBe(false);
    expect(isResourceOffered("seat-2", { "seat-2": false })).toBe(false);
    expect(parseResourceOffering({ offered: { "seat-1": true, bad: "no" } })).toEqual({ "seat-1": true });
    expect(sharedParse({ offered: { "private-office": false } })).toEqual({ "private-office": false });
    expect(parseResourceOffering(undefined)).toEqual({});
  });
});
