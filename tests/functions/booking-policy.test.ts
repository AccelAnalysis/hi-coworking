import { describe, expect, it } from "vitest";
import {
  evaluateCustomerCancellation,
  operatorCancellationDecision,
} from "../../apps/functions/src/bookingPolicy";
import {
  findDeskChangePlans,
  resolveChoice,
  resourceConflicts,
  type BusyRecord,
} from "../../apps/functions/src/bookingFlexShared";

const START = Date.UTC(2026, 7, 30, 16, 0, 0);
const hoursBefore = (hours: number) => START - hours * 3_600_000;

describe("Hi Coworking cancellation/refund policy", () => {
  it("gives desk bookings a full refund at 24 hours or more", () => {
    expect(evaluateCustomerCancellation("SEAT", START, hoursBefore(24))).toMatchObject({
      outcome: "FULL_REFUND",
      refundPercent: 100,
      accountCreditPercent: 0,
      restoreIncludedHoursPercent: 100,
    });
  });

  it("gives desk bookings 50% account credit from 6 to under 24 hours", () => {
    expect(evaluateCustomerCancellation("SEAT", START, hoursBefore(6))).toMatchObject({
      outcome: "ACCOUNT_CREDIT_50",
      refundPercent: 0,
      accountCreditPercent: 50,
      restoreIncludedHoursPercent: 50,
    });
    expect(evaluateCustomerCancellation("SEAT", START, hoursBefore(23.9)).outcome)
      .toBe("ACCOUNT_CREDIT_50");
  });

  it("forfeits desk bookings inside six hours and for no-shows", () => {
    expect(evaluateCustomerCancellation("SEAT", START, hoursBefore(5.9))).toMatchObject({
      outcome: "NO_REFUND",
      restoreIncludedHoursPercent: 0,
    });
    expect(evaluateCustomerCancellation("SEAT", START, hoursBefore(30), true).outcome)
      .toBe("NO_REFUND");
  });

  it("gives meeting/whole-space bookings a full refund at 48 hours or more", () => {
    expect(evaluateCustomerCancellation("MODE", START, hoursBefore(48))).toMatchObject({
      outcome: "FULL_REFUND",
      refundPercent: 100,
      restoreIncludedHoursPercent: 100,
    });
  });

  it("gives meeting/whole-space bookings 50% account credit from 24 to under 48 hours", () => {
    expect(evaluateCustomerCancellation("MODE", START, hoursBefore(24))).toMatchObject({
      outcome: "ACCOUNT_CREDIT_50",
      accountCreditPercent: 50,
      restoreIncludedHoursPercent: 50,
    });
    expect(evaluateCustomerCancellation("MODE", START, hoursBefore(47.9)).outcome)
      .toBe("ACCOUNT_CREDIT_50");
  });

  it("forfeits meeting/whole-space bookings inside 24 hours", () => {
    expect(evaluateCustomerCancellation("MODE", START, hoursBefore(23.9))).toMatchObject({
      outcome: "NO_REFUND",
      refundPercent: 0,
      accountCreditPercent: 0,
      restoreIncludedHoursPercent: 0,
    });
  });

  it("fully remedies Hi Coworking/facility cancellations", () => {
    expect(operatorCancellationDecision(false)).toMatchObject({
      outcome: "FULL_REFUND",
      refundPercent: 100,
      restoreIncludedHoursPercent: 100,
    });
    expect(operatorCancellationDecision(true)).toMatchObject({
      outcome: "ACCOUNT_CREDIT_100",
      accountCreditPercent: 100,
      restoreIncludedHoursPercent: 100,
    });
  });
});

const FLEX_HOUR = 60 * 60 * 1_000;
const FLEX_START = Date.UTC(2030, 0, 2, 14, 0, 0, 0);
const FLEX_END = FLEX_START + 6 * FLEX_HOUR;

function fragmentedDeskBusy(): BusyRecord[] {
  return [
    {
      resourceId: "seat-1",
      start: FLEX_START + 3 * FLEX_HOUR,
      end: FLEX_END,
      status: "CONFIRMED",
    },
    {
      resourceId: "seat-2",
      start: FLEX_START,
      end: FLEX_START + 3 * FLEX_HOUR,
      status: "CONFIRMED",
    },
    ...["seat-3", "seat-4", "seat-5", "seat-6"].map((resourceId) => ({
      resourceId,
      start: FLEX_START,
      end: FLEX_END,
      status: "CONFIRMED",
    })),
  ];
}

describe("one-desk-change availability policy", () => {
  it("offers one explicit change only when no desk spans the full stay", () => {
    const plans = findDeskChangePlans(FLEX_START, FLEX_END, fragmentedDeskBusy());

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      kind: "desk_change",
      changeAt: FLEX_START + 3 * FLEX_HOUR,
      segments: [
        {
          resourceId: "seat-1",
          start: FLEX_START,
          end: FLEX_START + 3 * FLEX_HOUR,
        },
        {
          resourceId: "seat-2",
          start: FLEX_START + 3 * FLEX_HOUR,
          end: FLEX_END,
        },
      ],
    });
  });

  it("keeps a continuous desk preferred whenever one is available", () => {
    const busy = fragmentedDeskBusy().filter((record) => record.resourceId !== "seat-3");

    expect(resourceConflicts("seat-3", FLEX_START, FLEX_END, busy)).toBe(false);
    expect(findDeskChangePlans(FLEX_START, FLEX_END, busy)).toEqual([]);
  });

  it("treats confirmed segment occupancy as an authoritative conflict", () => {
    const busy: BusyRecord[] = [{
      resourceId: "seat-2",
      start: FLEX_START + FLEX_HOUR,
      end: FLEX_START + 2 * FLEX_HOUR,
      status: "CONFIRMED_OCCUPANCY",
      expiresAt: FLEX_END,
    }];

    expect(resourceConflicts("seat-2", FLEX_START, FLEX_END, busy)).toBe(true);
    expect(resourceConflicts("seat-1", FLEX_START, FLEX_END, busy)).toBe(false);
  });

  it("re-resolves the plan ID against current occupancy", () => {
    const originalBusy = fragmentedDeskBusy();
    const plan = findDeskChangePlans(FLEX_START, FLEX_END, originalBusy)[0];
    expect(plan).toBeDefined();

    const newlyBusy: BusyRecord[] = [
      ...originalBusy,
      {
        resourceId: "seat-1",
        start: FLEX_START,
        end: FLEX_START + FLEX_HOUR,
        status: "CONFIRMED",
      },
    ];

    expect(() => resolveChoice(
      { deskChangePlanId: plan.planId },
      FLEX_START,
      FLEX_END,
      newlyBusy,
    )).toThrow(/no longer available/i);
  });
});
