# Events v2 operations

Events v2 turns the former event pages into a server-authoritative operating lifecycle:

`create → publish → register/pay → waitlist → cancel/refund → remind → check in → complete → follow up`

## Public transaction boundary

Public event discovery uses `events_v2ListPublicEvents` and `events_v2GetPublicEvent`. These functions return a sanitized projection and intentionally omit private joining metadata such as `virtualUrl`.

Raw `events/{eventId}` Firestore documents are admin-readable only. Event v2 registration, hold, waitlist, refund, and notification records are server-only and are accessed through callable functions.

The legacy transaction callables are fail-closed:

- `events_registerFree`
- `events_createTicketCheckout`
- `events_cancelRegistration`
- `events_joinWaitlist`

This prevents stale clients from bypassing Events v2 capacity holds, pricing, refund policy, or waitlist reservations.

## Paid registration lifecycle

1. `events_v2BeginRegistration` resolves the authoritative event/ticket price and membership eligibility.
2. An atomic Firestore transaction reserves overall event capacity and ticket-type inventory in `eventHolds`.
3. A payment-ledger record is created and a Stripe Checkout Session is opened.
4. The existing Stripe webhook marks the payment ledger `paid`.
5. `events_v2OnPaymentUpdated` consumes the hold exactly once and creates `eventRegistrations/{registrationId}`.
6. If payment arrives after a hold expired, the finalizer attempts to reacquire capacity. If inventory is gone, it commits an automatic full-refund job instead of creating an invalid registration.

Hold duration is currently 15 minutes. Waitlist offers reserve capacity for 30 minutes.

## Cancellation and refunds

Customer cancellation uses `events_v2GetCancellationQuote` before `events_v2CancelRegistration`.

Default policy: a paid registration is fully refundable when cancelled at least 24 hours before event start. The cutoff is stored per event and can be changed in the event editor.

Cancellation releases the complete ticket quantity immediately, then promotes the next eligible waitlist entry. Refunds are processed asynchronously from `eventRefundJobs` with Stripe idempotency keys and retries.

If Hi cancels an event, all paid active registrations are queued for full refunds regardless of the normal customer cutoff.

## Waitlist

`eventWaitlist` is ordered by `joinedAt`. A promotion creates a real `eventHolds` reservation before the offer email is sent. An expired offer releases both overall and ticket-type inventory before the next person is promoted.

## Communications

Transactional email jobs live in `eventNotificationJobs` and are processed by `events_v2ProcessNotificationJobs` through the existing SendGrid provider.

Supported jobs include:

- registration confirmation
- 24-hour reminder
- 1-hour reminder
- waitlist joined / offer
- registration cancellation
- refund confirmation
- event cancellation
- optional follow-up

Email provider failure does not roll back a registration or payment transaction.

## Recurring events

Recurring series remain an advanced admin workflow. Occurrence generation is explicitly timezone-aware and keeps the configured local wall-clock time through daylight-saving transitions.

Daily horizon refresh preserves each existing occurrence's:

- confirmed quantity
- held quantity
- ticket sold count
- ticket held count

Template refreshes therefore cannot reset live occurrence inventory.

## Staff operations

`/staff/events` provides:

- event roster
- attendee search
- registered / checked-in / waiting counts
- check-in
- free walk-in registration

Paid walk-ins are intentionally rejected from the shortcut and must use the normal paid registration flow so Stripe and the payment ledger remain reconciled.

## Legacy data migration

The migration utility does not delete legacy data.

Build first:

```bash
npm run build:shared
npm run build:functions
```

Dry run:

```bash
node apps/functions/lib/scripts/migrateEventsV2.js
```

Apply after reviewing counts and anomalies:

```bash
node apps/functions/lib/scripts/migrateEventsV2.js --apply
```

The migration:

- adds slug, timezone, v2 counters, reminder defaults, and refund cutoff to event records
- copies nested legacy registrations to `eventRegistrations`
- copies nested legacy waitlist entries to `eventWaitlist`
- preserves legacy `registrationCount` when nested registration records are absent
- reports count mismatches as anomalies when nested records exist
- initializes ticket `heldCount`

Use production Admin SDK credentials / the approved deployment environment when running against the live Firebase project.

## Validation gates

PR validation covers:

- shared and Functions TypeScript builds
- isolated booking deployment build
- secret-binding checks
- lint
- Firestore and Storage rules tests
- Functions emulator tests
- migration tests
- static web build
- `git diff --check`

Events v2 adds dedicated tests for:

- concurrent last-seat registration
- paid-ticket free-path bypass prevention
- waitlist capacity reservation after cancellation
- sanitized public event projection
- fail-closed legacy registration endpoint
- raw Firestore Events v2 privacy boundary
- recurring-event DST wall-clock behavior
