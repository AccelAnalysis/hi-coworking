export type BookingPolicyResourceType = "SEAT" | "MODE";
export type CancellationOutcome = "FULL_REFUND" | "ACCOUNT_CREDIT_50" | "NO_REFUND";

export interface CancellationPolicyDecision {
  outcome: CancellationOutcome;
  refundPercent: number;
  accountCreditPercent: number;
  restoreIncludedHoursPercent: number;
  reason: string;
}

export const BOOKING_CANCELLATION_POLICY = {
  seat: {
    fullRefundHoursBeforeStart: 24,
    partialCreditHoursBeforeStart: 6,
  },
  mode: {
    fullRefundHoursBeforeStart: 48,
    partialCreditHoursBeforeStart: 24,
  },
  noShow: {
    refundPercent: 0,
    accountCreditPercent: 0,
    restoreIncludedHoursPercent: 0,
  },
  operatorCancellation: {
    refundPercent: 100,
    accountCreditPercent: 100,
    restoreIncludedHoursPercent: 100,
  },
} as const;

/**
 * Approved Hi Coworking customer cancellation policy (Aug. 27, 2026).
 *
 * Desk / seat:
 * - >=24h before start: full refund and all included hours restored.
 * - 6h to <24h: no cash refund; 50% of paid value becomes Hi Coworking account credit;
 *   50% of included hours are restored.
 * - <6h or no-show: no refund/credit and included hours are not restored.
 *
 * Meeting / whole-space mode:
 * - >=48h before start: full refund and all included hours restored.
 * - 24h to <48h: no cash refund; 50% of paid value becomes Hi Coworking account credit;
 *   50% of included hours are restored.
 * - <24h or no-show: no refund/credit and included hours are not restored.
 *
 * Hi Coworking cancellation or facility closure/emergency:
 * - 100% original-method refund OR customer-selected 100% account credit;
 * - all included membership hours restored.
 */
export function evaluateCustomerCancellation(
  resourceType: BookingPolicyResourceType,
  bookingStart: number,
  cancelledAt: number,
  noShow = false,
): CancellationPolicyDecision {
  if (noShow) {
    return {
      outcome: "NO_REFUND",
      refundPercent: 0,
      accountCreditPercent: 0,
      restoreIncludedHoursPercent: 0,
      reason: "No-show bookings are fully forfeited.",
    };
  }

  const hoursBeforeStart = (bookingStart - cancelledAt) / 3_600_000;
  const rules = resourceType === "MODE"
    ? BOOKING_CANCELLATION_POLICY.mode
    : BOOKING_CANCELLATION_POLICY.seat;

  if (hoursBeforeStart >= rules.fullRefundHoursBeforeStart) {
    return {
      outcome: "FULL_REFUND",
      refundPercent: 100,
      accountCreditPercent: 0,
      restoreIncludedHoursPercent: 100,
      reason: "Cancellation was made within the full-refund window.",
    };
  }

  if (hoursBeforeStart >= rules.partialCreditHoursBeforeStart) {
    return {
      outcome: "ACCOUNT_CREDIT_50",
      refundPercent: 0,
      accountCreditPercent: 50,
      restoreIncludedHoursPercent: 50,
      reason: "Late cancellation receives 50% Hi Coworking account credit.",
    };
  }

  return {
    outcome: "NO_REFUND",
    refundPercent: 0,
    accountCreditPercent: 0,
    restoreIncludedHoursPercent: 0,
    reason: "Cancellation was inside the non-refundable window.",
  };
}

export function operatorCancellationDecision(
  preferAccountCredit = false,
): CancellationPolicyDecision {
  return {
    outcome: preferAccountCredit ? "ACCOUNT_CREDIT_50" : "FULL_REFUND",
    refundPercent: preferAccountCredit ? 0 : 100,
    accountCreditPercent: preferAccountCredit ? 100 : 0,
    restoreIncludedHoursPercent: 100,
    reason: preferAccountCredit
      ? "Hi Coworking cancellation: customer selected full account credit."
      : "Hi Coworking cancellation: full original-method refund.",
  };
}
