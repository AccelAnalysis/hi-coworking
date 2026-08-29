export const EVENT_HOLD_MS = 15 * 60 * 1000;
export const EVENT_WAITLIST_CLAIM_MS = 30 * 60 * 1000;
export const EVENT_PAID_REFUND_CUTOFF_HOURS = 24;
export const EVENT_MAX_TICKETS_PER_REGISTRATION = 10;

export type EventCancellationDecision = {
  canCancel: boolean;
  refundEligible: boolean;
  refundCents: number;
  policyMessage: string;
};

export function evaluateEventCancellation(input: {
  eventStartTime: number;
  amountPaidCents: number;
  status: string;
  now?: number;
  eventCancelledByHi?: boolean;
}): EventCancellationDecision {
  const now = input.now ?? Date.now();
  if (!["CONFIRMED", "active"].includes(input.status)) {
    return {
      canCancel: false,
      refundEligible: false,
      refundCents: 0,
      policyMessage: "This registration is no longer active.",
    };
  }

  if (input.eventCancelledByHi) {
    return {
      canCancel: true,
      refundEligible: input.amountPaidCents > 0,
      refundCents: Math.max(0, input.amountPaidCents),
      policyMessage: input.amountPaidCents > 0
        ? "Hi Coworking cancelled this event, so the registration is eligible for a full refund."
        : "Hi Coworking cancelled this event.",
    };
  }

  if (input.amountPaidCents <= 0) {
    return {
      canCancel: true,
      refundEligible: false,
      refundCents: 0,
      policyMessage: "You can cancel this free registration at any time before the event.",
    };
  }

  const hoursUntilStart = (input.eventStartTime - now) / 3_600_000;
  if (hoursUntilStart >= EVENT_PAID_REFUND_CUTOFF_HOURS) {
    return {
      canCancel: true,
      refundEligible: true,
      refundCents: input.amountPaidCents,
      policyMessage: `Paid registrations cancelled at least ${EVENT_PAID_REFUND_CUTOFF_HOURS} hours before the event receive a full refund.`,
    };
  }

  return {
    canCancel: true,
    refundEligible: false,
    refundCents: 0,
    policyMessage: `This registration is inside the ${EVENT_PAID_REFUND_CUTOFF_HOURS}-hour refund cutoff. You can still cancel and release the seats, but the ticket is non-refundable.`,
  };
}
