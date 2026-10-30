# Hi Coworking self-serve billing (Stripe Customer Portal)

Members manage their own billing from **SayHi** (https://hi-coworking.com/my-hi).
The membership card has a **Manage membership & billing** button. It calls the
callable `members_createBillingPortalSession`, which opens a Stripe Customer
Portal session for the member's own Stripe customer and sends them there.
In the portal they can update their payment method, view and download invoices,
switch between Virtual Office, Coworking and Coworking Plus, and cancel at the
end of the paid period. Stripe sends them back to /my-hi.

Emails never contain a portal URL: portal sessions are short-lived and tied to
one customer. Emails link to /my-hi instead.

## Pieces

| Piece | Where | Deploy |
| --- | --- | --- |
| `members_createBillingPortalSession` (callable, needs sign-in, secret `STRIPE_SECRET_KEY`) | `apps/functions/src/memberBillingPortal.ts` | core bundle (`firebase.core.json`) |
| `customer.subscription.updated` handling in `stripe_webhook` | `apps/functions/src/payments/stripeSubscription.ts`, `stripeProvider.ts`, `stripeWebhook.ts` | core bundle |
| Button, "Ends on {date}", payment-needed note | `apps/web/src/components/BillingPortalButton.tsx`, `apps/web/src/app/account/bookings/page.tsx` | hosting (auto on merge) |
| Portal configuration and webhook event | Stripe account `acct_1U3gxLAHu8lEXCs8` | created by API, once (below) |

Core deploy, after the Stripe steps:

```
npx firebase deploy --config firebase.core.json --project hi-coworking-plat --only functions:members_createBillingPortalSession,functions:stripe_webhook --non-interactive
```

(or the "Deploy core functions" workflow, which deploys all 45 core functions with `--only`.)

## How the callable finds the customer

Only server-written fields are used (members can't write them under
`firestore.rules`), in order: the customer on the member's current
subscription (`features.stripeSubscriptionId` / `stripeSubscriptionId`, used
only when its `metadata.uid` is empty or matches the caller), then
`payments.providerRefs.stripeCustomerId` on the newest membership payment, then
the cached `users/{uid}.stripeCustomerId` / `features.stripeCustomerId`. The
subscription comes first because a returning member can get a new Stripe
customer at Checkout (it passes `customer_email` only), so a cached ID may be stale.
It never looks customers up by email. With no customer it returns
`failed-precondition` and the message "We couldn't find billing details for
your account. Email hicoworking@accelanalysis.com and we'll help."

The portal configuration comes from `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`
(a `bpc_` ID, not a secret) if set, otherwise the active configuration with
`metadata[hi_coworking_portal]=member`, otherwise the account default.

## customer.subscription.updated

Applied in a transaction to the member found the same way as invoice events.
It sets `plan` from the subscription's price (unknown prices keep the plan and
log a warning), `cancelAtPeriodEnd` and `cancelAt` (ms, shown as "Ends on
{date}" on SayHi), and fills `stripeCustomerId` / `features.stripeSubscriptionId`
when missing. It never changes `membershipStatus` or `expiresAt`: access still
ends only on `customer.subscription.deleted`, and payment state stays with the
invoice events. It skips members who are not active/trial/pastDue (a cancelled
membership is never revived), subscriptions that are canceled or incomplete,
events for a different subscription than the one on file, events older than
the last one applied (`lastSubscriptionEventAt`), and no-op updates. A newer
event that changes nothing still advances `lastSubscriptionEventAt`, so a
delayed older event can't restore a cancellation or plan the member undid.

## Stripe setup (run once, after approval)

1. Create the portal configuration (`POST /v1/billing_portal/configurations`):

```
curl https://api.stripe.com/v1/billing_portal/configurations \
  -u "$STRIPE_SECRET_KEY:" \
  -d "name=Hi Coworking members" \
  -d "business_profile[headline]=Hi Coworking: manage your membership and billing" \
  -d "business_profile[privacy_policy_url]=https://hi-coworking.com/privacy" \
  -d "business_profile[terms_of_service_url]=https://hi-coworking.com/terms" \
  -d "default_return_url=https://hi-coworking.com/my-hi" \
  -d "metadata[hi_coworking_portal]=member" \
  -d "features[payment_method_update][enabled]=true" \
  -d "features[invoice_history][enabled]=true" \
  -d "features[customer_update][enabled]=true" \
  -d "features[customer_update][allowed_updates][]=name" \
  -d "features[customer_update][allowed_updates][]=email" \
  -d "features[customer_update][allowed_updates][]=address" \
  -d "features[subscription_cancel][enabled]=true" \
  -d "features[subscription_cancel][mode]=at_period_end" \
  -d "features[subscription_cancel][proration_behavior]=none" \
  -d "features[subscription_cancel][cancellation_reason][enabled]=true" \
  -d "features[subscription_cancel][cancellation_reason][options][]=too_expensive" \
  -d "features[subscription_cancel][cancellation_reason][options][]=unused" \
  -d "features[subscription_cancel][cancellation_reason][options][]=switched_service" \
  -d "features[subscription_cancel][cancellation_reason][options][]=missing_features" \
  -d "features[subscription_cancel][cancellation_reason][options][]=other" \
  -d "features[subscription_update][enabled]=true" \
  -d "features[subscription_update][default_allowed_updates][]=price" \
  -d "features[subscription_update][proration_behavior]=create_prorations" \
  -d "features[subscription_update][products][0][product]=prod_V9cFRNLo2xF5MN" \
  -d "features[subscription_update][products][0][prices][]=price_1U9J0xAHu8lEXCs8UHv7AAiz" \
  -d "features[subscription_update][products][1][product]=prod_V9cFGUvFguSMZl" \
  -d "features[subscription_update][products][1][prices][]=price_1U9J1CAHu8lEXCs8X1o0O5hG" \
  -d "features[subscription_update][products][2][product]=prod_V9cFev5LYNsuCN" \
  -d "features[subscription_update][products][2][prices][]=price_1U9J1KAHu8lEXCs8xZETzk7F"
```

   Plan changes use `create_prorations`: the difference is added to the next
   monthly invoice, so no mid-cycle invoice is raised. Cancellation is
   `at_period_end` with no refund proration, matching "your membership stays
   active until the end of the period you've paid for".

2. Add `customer.subscription.updated` to the live webhook endpoint
   `we_1UUC3xAHu8lEXCs8b0dSCGFq` (`enabled_events` replaces the list, so send
   all five):

```
curl https://api.stripe.com/v1/webhook_endpoints/we_1UUC3xAHu8lEXCs8b0dSCGFq \
  -u "$STRIPE_SECRET_KEY:" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=invoice.payment_failed" \
  -d "enabled_events[]=invoice.payment_succeeded" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=customer.subscription.updated"
```

3. Optional: set `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` to the new `bpc_` ID.
   Not needed when the metadata above is set.
