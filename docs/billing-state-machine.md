# Billing State Machine

## Production Billing Principle

The frontend may request checkout.

The frontend may redirect the user to Stripe.

The frontend may show success or cancel UI.

The frontend must never grant a paid benefit.

Only a verified backend webhook may grant paid benefits.

## Required State Machine

```text
Frontend action
-> backend validates request
-> backend creates pending internal record
-> backend creates Stripe Checkout Session
-> customer pays in Stripe
-> Stripe webhook verifies event
-> payment ledger becomes paid
-> paid benefit is granted
```

## Hi Coworking Product Rules

- Membership payment paid -> user membership becomes active.
- Booking payment paid -> booking becomes CONFIRMED.
- Booking confirmed -> access grant is created.
- Bookstore payment paid -> book purchase/download is fulfilled.
- Event payment paid -> registration, sponsorship, or vendor table is finalized.

## Not Proof Of Payment

The following must not be treated as proof of payment:

- Stripe success URL
- `dashboard?payment=success`
- `dashboard?booking=success`
- frontend local state
- client-side Firestore writes
- browser redirect completion
- user-submitted status or amount

## Checkout Mode Rules

- Membership subscriptions use Stripe Checkout `subscription` mode.
- One-time purchases, including bookings, bookstore purchases, events, sponsorships, vendor tables, and add-ons, use Stripe Checkout `payment` mode.

## Booking Lifecycle

Correct paid booking lifecycle:

```text
PENDING
-> paid webhook received
-> CONFIRMED
-> access grant created
```

If checkout expires or payment fails:

```text
PENDING
-> CANCELLED or EXPIRED
```

## Phase 1 Acceptance Checklist

- [ ] The production billing principle is documented.
- [ ] The required billing state machine is documented.
- [ ] Hi Coworking product-specific paid-benefit rules are documented.
- [ ] Non-proof-of-payment signals are documented.
- [ ] Stripe Checkout mode rules are documented.
- [ ] The correct booking lifecycle is documented.
- [ ] The legacy `createBooking` callable is marked as not production billing safe.
- [ ] Runtime billing behavior is unchanged.
- [ ] No function names, exports, booking logic, webhook logic, Firestore rules, Stripe logic, or frontend code are changed.
