# Hi Coworking Events v2

## Purpose

Events v2 turns the former Events feature into one dependable lifecycle:

Create → Publish → Register/Pay → Waitlist → Remind → Check In → Complete → Follow Up.

This implementation deliberately reuses the transaction architecture introduced for the current space-booking journey: server-authoritative pricing, temporary inventory holds, Stripe webhook finalization, idempotent refunds, and server-only operational state.

## Collections

### `events`
Legacy event documents remain the public catalog during migration. Events v2 additionally maintains:

- `confirmedQuantity`: confirmed ticket quantity.
- `heldQuantity`: quantity temporarily reserved during checkout/waitlist claim.
- `registrationCount`: compatibility mirror of confirmed quantity during cutover.
- `slug`: added by migration for future human-readable routing.
- `timezone`: defaults to `America/New_York` during migration.

Availability is `seatCap - confirmedQuantity - heldQuantity` when a seat cap exists.

### `eventHolds`
Temporary server-only inventory reservations. Holds are created atomically before paid checkout and expire automatically. A hold contains authoritative ticket price, quantity, customer ownership, Stripe/payment references, and a hashed management secret.

### `eventRegistrations`
Durable registration records. Cancellation never deletes the record. Commercial status and attendance status are separate so staff can distinguish a refund/cancellation from attendance/no-show behavior.

### `eventWaitlist`
Ordered guest/member queue. When inventory opens, the next fitting entry gets a real `eventHold`, ensuring the offered capacity is reserved during its claim window.

## Public registration

The rebuilt event detail route no longer requires an account. A visitor provides name/email; signed-in members use their account automatically. Both paths call `events_beginRegistrationV2`.

The server determines whether the selected ticket is free or paid. This closes the former loophole where a client could call the free-registration endpoint for an event whose base price was zero but whose selected ticket type was paid.

For paid registration, the server:

1. resolves authoritative pricing;
2. creates an atomic capacity hold;
3. creates the unified payment-ledger entry;
4. creates Stripe Checkout with the hold/payment identifiers in metadata;
5. consumes the hold through the Stripe webhook or the return-page finalizer.

The browser returning from Stripe is not treated as proof of payment.

## Cancellation/refunds

`eventPolicy.ts` currently implements the approved baseline:

- Free registration: cancellable before the event, no refund record.
- Paid registration: full refund at least 24 hours before event start.
- Inside 24 hours: cancellation releases seats but the ticket is non-refundable.
- Hi-cancelled event: full paid refund.

Cancellation releases the full registration quantity, retains the registration record, and promotes the waitlist. Stripe refunds use the payment adapter's idempotent refund method.

## Staff operations

`/staff/events/manage?id=<eventId>` provides a mobile-friendly attendee roster and check-in surface. Check-in quantity is stored independently from purchased quantity. `events_adminCompleteV2` marks remaining confirmed/non-checked-in registrations as no-shows when an event is completed.

## Migration

`apps/functions/src/scripts/migrateEventsV2.ts` is dry-run by default.

Dry-run:

```bash
npx ts-node apps/functions/src/scripts/migrateEventsV2.ts
```

Apply:

```bash
npx ts-node apps/functions/src/scripts/migrateEventsV2.ts --apply
```

The migration is additive: legacy event registration/waitlist subcollections are not deleted. It creates top-level v2 records and initializes v2 event counters/slug/timezone fields.

## Cutover sequence

1. Deploy Functions/Hosting with v2 endpoints while legacy endpoints remain available.
2. Run migration dry-run and inspect counts/anomalies.
3. Run migration apply against the intended Firebase project.
4. Verify a free guest registration, free member registration, paid guest checkout, paid member checkout, cancellation/refund, waitlist promotion, and staff check-in.
5. Once production clients are confirmed on v2, convert `events_registerFree`, `events_createTicketCheckout`, `events_cancelRegistration`, and `events_joinWaitlist` into fail-closed compatibility shims, matching the booking journey's retired-endpoint pattern.
6. Simplify the remaining admin campaign/social/sponsorship UI separately; it is not part of the transaction-critical cutover.

## Required production checks

Before enabling paid events broadly, verify Stripe secret/webhook configuration and exercise webhook replay/idempotency. SendGrid-driven transactional confirmations/reminders should be validated before treating email delivery as part of the registration SLA; registration itself must remain successful when a communication provider is unavailable.
