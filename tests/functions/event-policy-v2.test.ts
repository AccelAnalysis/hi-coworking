import { describe, expect, it } from "vitest";
import {
  EVENT_PAID_REFUND_CUTOFF_HOURS,
  evaluateEventCancellation,
} from "../../apps/functions/src/eventPolicy";

describe("Events v2 cancellation policy", () => {
  const now = Date.UTC(2026, 7, 28, 12, 0, 0);

  it("allows free registrations to cancel without inventing a refund", () => {
    const result = evaluateEventCancellation({
      eventStartTime: now + 60 * 60 * 1000,
      amountPaidCents: 0,
      status: "CONFIRMED",
      now,
    });
    expect(result.canCancel).toBe(true);
    expect(result.refundEligible).toBe(false);
    expect(result.refundCents).toBe(0);
  });

  it("fully refunds a paid registration outside the cutoff", () => {
    const result = evaluateEventCancellation({
      eventStartTime: now + (EVENT_PAID_REFUND_CUTOFF_HOURS + 1) * 60 * 60 * 1000,
      amountPaidCents: 7500,
      status: "CONFIRMED",
      now,
    });
    expect(result.refundEligible).toBe(true);
    expect(result.refundCents).toBe(7500);
  });

  it("releases a late paid registration without promising a refund", () => {
    const result = evaluateEventCancellation({
      eventStartTime: now + (EVENT_PAID_REFUND_CUTOFF_HOURS - 1) * 60 * 60 * 1000,
      amountPaidCents: 7500,
      status: "CONFIRMED",
      now,
    });
    expect(result.canCancel).toBe(true);
    expect(result.refundEligible).toBe(false);
    expect(result.refundCents).toBe(0);
  });

  it("fully refunds when Hi cancels an event", () => {
    const result = evaluateEventCancellation({
      eventStartTime: now + 60 * 60 * 1000,
      amountPaidCents: 7500,
      status: "CONFIRMED",
      eventCancelledByHi: true,
      now,
    });
    expect(result.refundEligible).toBe(true);
    expect(result.refundCents).toBe(7500);
  });

  it("does not re-cancel an inactive registration", () => {
    const result = evaluateEventCancellation({
      eventStartTime: now + 48 * 60 * 60 * 1000,
      amountPaidCents: 7500,
      status: "REFUNDED",
      now,
    });
    expect(result.canCancel).toBe(false);
  });
});
