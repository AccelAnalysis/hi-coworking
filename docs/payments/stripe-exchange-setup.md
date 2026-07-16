# Stripe setup for Exchange launch

## Status

Code foundations are complete, but live Stripe setup was not performed. Founding Checkout, credit purchasing, referral payments, Connect onboarding, transfers, and payouts remain disabled.

## Required Stripe catalog

Create manually after product/price approval:

1. One Exchange Founding Membership Product.
2. One recurring monthly Price for approved Founding pricing.
3. One Product/one-time Price for `exchange_credits_25` at $25.00.
4. One Product/one-time Price for `exchange_credits_60` at $60.00.
5. One Product/one-time Price for `exchange_credits_120` at $120.00.

Do not use placeholder IDs. Store approved Product/Price IDs only in the private versioned policy. The public projection reports readiness but omits Stripe identifiers.

## Required environment

- Firebase secret `STRIPE_SECRET_KEY`
- Firebase secret `STRIPE_WEBHOOK_SECRET`
- HTTPS `APP_BASE_URL` environment value
- Existing deployed `stripe_webhook` endpoint registered in Stripe

The browser submits only organization ID, stable plan/pack key, and an allowlisted relative return destination. The Function resolves amount, currency, quantity, Price, customer, policy version, verification, and billing permission.

## Required webhook events

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `invoice.paid`
- `invoice.payment_succeeded` for compatibility
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`
- `refund.created`
- `charge.dispute.created`
- `charge.dispute.closed`

The existing provider verifies `Stripe-Signature` before the existing `webhookEvents/{eventId}` idempotency claim. Exchange events are then routed by authoritative metadata and stored Checkout/payment correlation.

## Authoritative metadata

Checkout metadata includes organization, purchaser/payment identity, Exchange product type, plan or pack key/version, credits, policy/pricing/entitlement version, and server-resolved Price. Subscription metadata carries organization and policy identity. Do not accept client metadata as price, quantity, tier, or verification evidence.

## Fulfillment

- A success redirect never provisions membership or credits.
- Founding membership is updated from verified subscription state and actual Stripe item period boundaries.
- Included credits are granted once per eligible paid invoice source reference.
- Credit packs grant once only after verified successful payment.
- Refund/dispute processing preserves payment, event, intent, and grant history; remaining credits are revoked and already-spent value becomes deficit/manual review.
- Cancellation removes paid rights but preserves free Exchange access and historical recognition according to policy.

## Manual production-readiness checklist

1. Approve price, included credits, capacity, close date, terms, and support policy.
2. Create Stripe catalog in test mode and record real IDs in a new private policy version.
3. Configure secrets and `APP_BASE_URL`.
4. Register the existing webhook endpoint and required events.
5. Verify signature failures, duplicate delivery, async payment, invoice replay, cancellation, refund, and dispute in test mode.
6. Verify Billing Portal configuration and return destination.
7. Verify organization billing permissions and verified-business enforcement.
8. Verify ledger reconciliation, expiration, deficits, and admin readiness.
9. Deploy with protected commerce flags false.
10. Enable one flag through protected policy administration only after evidence is approved.

Rollback by disabling protected commerce flags first. Preserve Stripe/internal ledgers and event evidence. Do not delete or rewrite financial history.
