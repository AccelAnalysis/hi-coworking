# Hi Coworking Booking Cancellation & Refund Policy

Approved: August 27, 2026

## Desk bookings

- Cancel 24 hours or more before start: 100% refund to the original payment method and 100% of included membership hours restored.
- Cancel 6 hours to less than 24 hours before start: no cash refund; 50% of the paid booking value is returned as Hi Coworking account credit and 50% of included membership hours are restored.
- Cancel less than 6 hours before start: no refund, no account credit, and no included membership hours restored.
- No-show: no refund, no account credit, and no included membership hours restored.

## Meeting / whole-space bookings

- Cancel 48 hours or more before start: 100% refund to the original payment method and 100% of included membership hours restored.
- Cancel 24 hours to less than 48 hours before start: no cash refund; 50% of the paid booking value is returned as Hi Coworking account credit and 50% of included membership hours are restored.
- Cancel less than 24 hours before start: no refund, no account credit, and no included membership hours restored.
- No-show: no refund, no account credit, and no included membership hours restored.

## Hi Coworking cancellation / facility closure / emergency

If Hi Coworking cancels the booking, or the facility is unavailable because of a closure or emergency, the customer receives either:

- a 100% refund to the original payment method; or
- at the customer's choice, 100% Hi Coworking account credit.

Any included membership hours applied to the booking are fully restored.

## Operational rule

Late-cancellation value is issued as Hi Coworking account credit rather than a partial Stripe refund. Full timely refunds and Hi Coworking-caused cancellations use the original payment method unless the customer chooses full account credit for a Hi Coworking-caused cancellation.

The executable policy source is `apps/functions/src/bookingPolicy.ts`, with boundary tests in `tests/functions/booking-policy.test.ts`.
