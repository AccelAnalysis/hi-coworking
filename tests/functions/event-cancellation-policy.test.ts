import { describe, expect, it, vi } from "vitest";
import { cancellationDecision } from "../../apps/functions/src/eventsV2/core";
import type { EventDocV2, RegistrationDocV2 } from "../../apps/functions/src/eventsV2/types";

function registration(amountPaidCents = 2500): RegistrationDocV2 {
  return {
    id: "reg-policy",
    eventId: "evt-policy",
    displayName: "Policy Guest",
    email: "guest@example.test",
    quantity: 1,
    publicUnitPriceCents: amountPaidCents,
    discountCents: 0,
    finalUnitPriceCents: amountPaidCents,
    amountPaidCents,
    currency: "usd",
    status: "CONFIRMED",
    attendanceStatus: "NOT_CHECKED_IN",
    checkedInQuantity: 0,
    source: "web",
    manageSecretHash: "hash",
    registeredAt: Date.now(),
  };
}

function event(startTime: number, refundCutoffHours = 24): EventDocV2 {
  return {
    id: "evt-policy",
    title: "Policy Event",
    description: "Test event",
    format: "in-person",
    startTime,
    endTime: startTime + 60 * 60 * 1000,
    status: "published",
    refundCutoffHours,
  };
}

describe("event cancellation policy", () => {
  it("returns a full paid refund at or before the configured cutoff", () => {
    const now = Date.UTC(2026, 7, 28, 12, 0, 0);
    vi.setSystemTime(now);
    const decision = cancellationDecision(
      registration(2500),
      event(now + 24 * 60 * 60 * 1000, 24),
    );
    expect(decision).toEqual({
      canCancel: true,
      refundEligible: true,
      refundCents: 2500,
      cutoffHours: 24,
    });
    vi.useRealTimers();
  });

  it("allows cancellation but not a refund inside the cutoff", () => {
    const now = Date.UTC(2026, 7, 28, 12, 0, 0);
    vi.setSystemTime(now);
    const decision = cancellationDecision(
      registration(2500),
      event(now + 23 * 60 * 60 * 1000, 24),
    );
    expect(decision.canCancel).toBe(true);
    expect(decision.refundEligible).toBe(false);
    expect(decision.refundCents).toBe(0);
    vi.useRealTimers();
  });

  it("never fabricates a refund for a free registration", () => {
    const now = Date.UTC(2026, 7, 28, 12, 0, 0);
    vi.setSystemTime(now);
    const decision = cancellationDecision(
      registration(0),
      event(now + 7 * 24 * 60 * 60 * 1000, 24),
    );
    expect(decision.canCancel).toBe(true);
    expect(decision.refundEligible).toBe(false);
    expect(decision.refundCents).toBe(0);
    vi.useRealTimers();
  });
});
