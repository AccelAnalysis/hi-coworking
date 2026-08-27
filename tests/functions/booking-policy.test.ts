import { describe, expect, it } from "vitest";
import {
  evaluateCustomerCancellation,
  operatorCancellationDecision,
} from "../../apps/functions/src/bookingPolicy";

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
