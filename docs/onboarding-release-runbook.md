# Onboarding recovery release runbook

This change is a **candidate repair**, not a production certification. See
`onboarding-release-acceptance.md` for the acceptance evidence. No production
payments, door credentials, customer emails, merge, or deployment were performed
while preparing it.

## Release prerequisites

1. Confirm the intended Firebase project and existing Stripe/Seam test environments.
   Run the eight acceptance scenarios before unattended paid onboarding is enabled.
2. Inspect authoritative Stripe monthly prices and subscription metadata/mapping.
   Annual checkout is deliberately unavailable until authoritative annual prices
   and annual paid-through tests exist; a URL cannot silently change annual to monthly.
3. Verify the configured Seam webhook signing secret is the Svix-format signing
   secret for the current endpoint. Unsigned, stale, and invalid requests now fail
   closed. Do not weaken signature validation to make an incorrectly configured
   endpoint work.
4. Verify the Firebase Trigger Email extension or an equivalent mail processor is
   installed and consumes `mail` documents containing recipient email and message.
   Confirm its delivery callback state is supported by `access_onMailUpdated`.
   Queued mail is NOT delivery, and provider acceptance is NOT inbox receipt.
5. Verify every bookable resource has an appropriate configured door, and the
   selected Seam test device supports scheduled codes and the subscribed events.
   Demonstrate actual code activation and usable instructions in a controlled test.
6. Confirm staffing/alerts for OPEN booking payment recovery cases and access cases
   requiring attention; these must not be left as unattended database documents.

## Deployment coverage (requires explicit approval)

The booking split workflow alone is **not sufficient**. Review and deploy the
exact tested source commit, including the public and transaction booking bundles,
`stripe_createCheckoutSession`, `stripe_webhook`, booking recovery administration,
access creation/mail/webhook/retry/escalation functions, affected nurture/contact
functions, and Hosting. Inspect `apps/functions/src/main.ts` for the exported names.
New Firestore triggers/schedules must be included, not just callable endpoints.

Keep dependencies locked. Build shared/functions/split bundles and the web app
before deployment. Confirm the deployed functions source/version and Hosting
version, then repeat test-mode acceptance. Do not infer deployment from a merged
PR or a green frontend preview.

## Paid booking recovery

The payment ledger's `paid` state is distinct from fulfillment. Successful verified
Stripe events finalize bookings on the backend without a browser return. A late
cash-only payment can claim its original space only after a fresh transactional
capacity check. Expired credit/hour reservations, lost capacity, missing holds,
and mismatches produce a deterministic `bookingPaymentRecovery/booking_<paymentId>`
OPEN case instead of a false confirmation.

Payment administrators see OPEN cases in **Admin → Payments → Booking recovery**.
The queue includes payment/hold/customer references, amount, currency, and reason.
The UI deliberately cannot manufacture a refund or mark a charge refunded.

For each case:

1. Check the authoritative Stripe transaction and the payment ledger. Check whether
   another retry already produced a confirmed booking or a provider refund.
2. Contact the verified purchaser through the approved operational channel. Offer
   a suitable alternate reservation or a refund according to established policy.
3. If an alternate is accepted, use the existing authorized booking administration
   flow, avoid charging again, and verify capacity, purchaser identity, and access.
4. If a refund is required, use the authorized provider workflow and wait for verified
   provider evidence. An OPEN case is not itself a refund authorization.
5. An authorized operator records the resolution, actor, timestamp, and authoritative
   replacement booking/refund reference on the recovery case. An alternate booking
   must have the original `paymentId`; record its ID as `replacementBookingId` and
   set recovery `status: "RESOLVED"` only after the alternate is confirmed. Set its status to a
   terminal resolution only after evidence exists; never set payment status merely
   to make the dashboard look resolved. Replays preserve terminal case records.
6. Confirm the customer sees the correct final status and receives usable instructions
   or the refund communication. Escalate overdue cases; no unresolved charge is a
   successful onboarding completion.

The candidate includes visibility and durable recovery routing, not autonomous
refund execution or staff response guarantees. A staffing/delivery demonstration
remains a release gate.

## Door access recovery

- Programming, activation, and delivery are separate states. A confirmed booking
  or `programming` code must not be presented as ready.
- Pre-provider failures may be retried with leased/fenced claims. After an ambiguous
  provider attempt, reconcile Seam state before issuing another PIN.
- Do not reset `providerAttempted` manually to force a retry: it could duplicate a
  credential. Use the staff reconciliation procedure and verified provider state.
- Late provider events must not reactivate cancelled/revoked bookings.
- Lack of a `code_used` event is not proof of absence. Automatic no-show revocation
  is gated on explicit enablement and a staff-confirmed no-show. Unknown attendance
  is surfaced for review while ordinary time-window expiration remains in force.

## Account recovery and communication

Guest checkout never rewrites an existing profile/role/membership or provides a
sign-in token for an existing email account. New-account checkout sign-in is a
short-lived one-time claim; a lost response or later return uses verified inbox
recovery rather than indefinitely reusing the hold secret.

Confirm password-reset/email delivery in test mode. Contact inquiries without an
explicit promotional preference must not enter acquisition nurture. First-booking
and inactivity-episode enrollments are deduplicated. Existing ambiguous send claims
require reconciliation instead of blind repeat sending.

Before rollout, review already-enqueued legacy first-booking and daily win-back
messages through the authorized marketing operations process. Backward-compatible
enrollment checks prevent new duplicates but do not silently cancel or rewrite
historical queues. Unknown legacy timestamps conservatively block re-enrollment
until reviewed; a new inactivity episode also retains a 90-day cooldown.

## Explicit Stripe mode and isolated test catalog (PR100 follow-up)

The runtime now requires non-secret `STRIPE_MODE=live` or `STRIPE_MODE=test`.
It must agree with the bound Stripe key's mode and the Firebase project identity.
Live mode is allowed only in the established live project `hi-coworking-plat`;
test mode is rejected there. Use a separately approved staging project (or the
`demo-hi-coworking` emulator project) for test mode. Missing/invalid mode, unknown
key mode, missing project identity and cross-mode combinations fail closed.
This code/configuration preparation is **not deployment or secret-binding approval**.

`apps/functions/src/payments/stripeConfig.ts` selects the server-side catalog;
clients cannot select a mode or submit their own membership Price ID. Live IDs
remain unchanged. The following active USD/month licensed prices (interval count
1) were verified in HiCoworking account `acct_1U3gxLAHu8lEXCs8` on 2026-10-22:

| Tier | Monthly amount | Live Price | Isolated test Price |
|---|---:|---|---|
| virtual | $49 | `price_1U9J0xAHu8lEXCs8UHv7AAiz` | `price_1UTSpMAHu8lEXCs8ckhUivNq` |
| coworking | $129 | `price_1U9J1CAHu8lEXCs8X1o0O5hG` | `price_1UTSpJAHu8lEXCs8kWSFrW6V` |
| coworking_plus | $199 | `price_1U9J1KAHu8lEXCs8xZETzk7F` | `price_1UTSpFAHu8lEXCs8LLnGZSDp` |

Never replace live IDs with test IDs or share a production Firestore database for
test payment fulfillment. Existing checkout attempts are mode-bound; legacy
attempts are treated as live and cannot be reused in test mode. Webhook event,
retrieved Checkout Session and Subscription `livemode` must match the configured
provider. Entitlement lookup recognizes only the selected mode's Price IDs.

Before approved deployment, set the non-secret mode in that exact project's
configuration and verify the corresponding secret binding privately. The demo CI
writes an ephemeral `.env.demo-hi-coworking` with `STRIPE_MODE=test`; it is not a
production configuration file and must not be committed. Annual billing remains
disabled. Actual Stripe-to-staging delivery and real provider acceptance are still
release gates even when emulator and mocked tests pass.
