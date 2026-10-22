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
