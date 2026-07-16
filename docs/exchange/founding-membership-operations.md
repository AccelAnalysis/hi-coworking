# Exchange Founding Membership operations

## Purpose and ownership

Exchange Founding Membership is an organization subscription with key `exchange_founding`. It is not a personal subscription and does not include physical coworking, desks, meeting rooms, booking windows, or physical membership hours.

Only an active member with `manage_billing` may open subscription Checkout or the Billing Portal. The organization must satisfy the configured verified-business requirement. Platform staff authority continues to come from custom claims.

## Readiness gate

Founding enrollment must remain closed until all of the following are true:

1. The organization claim and ownership workflow is operational.
2. The organization is verified.
3. The Founding amount has explicit product approval.
4. A real Stripe Product and recurring monthly Price are configured.
5. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured in the deployment environment.
6. `APP_BASE_URL` is an approved HTTPS origin.
7. The existing Stripe webhook endpoint subscribes to required events.
8. Included-credit allocation has been tested with invoice replay.
9. Terms disclose organization ownership, expiration, nontransferability, refund policy, and no physical access.
10. Billing Portal, admin support, rules, alerts, and rollback are verified.
11. Policy capacity and enrollment closing date are approved when used.
12. Both `foundingMembership.checkoutEnabled` and `exchangeFoundingCheckoutEnabled` are true.

Missing amount or Stripe Price keeps the campaign public but Checkout closed. A placeholder Price is never submitted.

## Lifecycle

- `customer.subscription.created|updated` writes Stripe status and actual item period boundaries to `exchangeMemberships/{orgId}`.
- `active` activates paid Founding rights.
- `past_due`, `incomplete`, `paused`, and `cancelled` remove paid rights while free Exchange access remains.
- Founding recognition and active entitlement are separate fields.
- Recognition after cancellation follows `retainRecognitionAfterCancellation`.
- Protected price continuity follows `preservePriceOnlyWhileContinuouslyActive`; a later re-enrollment must not silently restore an expired grandfathered Price.
- Subscription credits are granted only from a verified paid invoice event, exactly once for its source reference. A browser success redirect grants nothing.

## Capacity and campaign close

Before creating Checkout the Function evaluates the server policy, close date, and current Founding count. Capacity is checked again operationally before enabling the campaign. Closing the campaign should set both Checkout flags false; disabling the public campaign is a separate product decision.

## Delinquency and cancellation

The policy supports a delinquency grace period, but the initial value is zero pending approval. Invoice failure changes Exchange membership to `past_due`. Cancellation retains the free tier and historical records. Do not delete the Stripe relationship, payment ledger, membership history, or credit grants.

## Support procedure

1. Confirm actor organization and `manage_billing` permission.
2. Inspect `/admin/exchange-launch` readiness without exposing secrets.
3. Use Stripe Dashboard read-only evidence and the internal payment/checkout intent.
4. Replay only through Stripe-supported webhook delivery; idempotency prevents duplicate grants.
5. For a refund/dispute, preserve history and revoke remaining purchased credits. If spent value cannot be revoked, create a deficit/manual-review condition.
6. Never mark membership active from a browser redirect or a manual Firestore client write.
