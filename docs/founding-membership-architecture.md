# Founding Membership architecture

## Boundary

Exchange membership is organization-level and intentionally separate from the existing user-level coworking-space plans. Existing desk-hour, booking, and space pricing behavior remains intact.

## Collections

- `orgs/{organizationId}`: normalized organization profile, safe search tokens, source provenance, claim and verification states.
- `orgMembers/{organizationId}_{uid}`: `owner`, `admin`, or `member`. Checkout authority is verified server-side from this record or a platform-admin custom claim.
- `organizationClaims/{organizationId}_{uid}`: server-created claim review request.
- `organizationMemberships/{organizationId}`: authoritative Free/Founding plan and Stripe lifecycle fields.
- `founderReservations/{organizationId}`: 30-minute temporary checkout reservation.
- `founderAllocation/state`: transactional `activeCount`, `reservationCount`, and `nextFounderNumber`.
- `organizationCreditLots/{sourceId}`: expiring credit lots with remaining amounts.
- `organizationCreditLedger/{entryId}`: immutable grant/spend/refund/adjustment/expiration/reversal audit entries.
- `organizationSourceCandidates/{sourceId}`: restricted targeting-list candidates. Client access is denied.
- `webhookEvents/{eventId}`: Stripe event idempotency.

## Membership state model

`free -> checkout_pending -> active|trialing -> past_due|canceled|suspended`

`incomplete` records an unsuccessful or incomplete subscription lifecycle. Browser return routes are informational only. Only verified Stripe webhook events synchronize membership.

## Entitlements

`apps/functions/src/exchange/model.ts` is the authoritative resolver. Free organizations receive profile, browse, receive, and response capabilities. Active or trialing Founding organizations add initiation/creation, founder analytics, badge, and credit-use capabilities. Client UI renders the returned capability list but does not determine authority.

## Founder cap and numbering

Checkout creation removes expired reservations and uses a Firestore transaction to ensure `activeCount + reservationCount < 250`. Activation uses the same allocation document in a transaction. `nextFounderNumber` is assigned once, sequentially, and cannot exceed 250. An abandoned checkout releases after 30 minutes. A canceled founder retains historical identity; `protectedRateEligible` becomes false when continuity ends.

Concurrent final-slot requests serialize on `founderAllocation/state`. The transaction either creates one reservation or rejects the request. A unique organization membership document and reservation document prevent duplicate checkouts for one organization.

## Credits

Each `invoice.paid` event for an Exchange Founding subscription creates a deterministic `stripe_invoice_{invoiceId}` lot and ledger entry for 25 credits. The Firestore transaction treats an existing lot as an idempotent replay. Lots expire 365 days after grant. Usable balance excludes expired, reversed, and already-consumed amounts. Future spend operations must decrement the oldest eligible lots first and append a ledger entry; Week 1 does not fabricate spending against unfinished actions.

## Rollback

The new collections are additive. To roll back application behavior, stop exporting the `exchange_*` functions and remove the Exchange routes. Do not delete membership, founder, webhook, payment, or ledger history. Preserve founder numbers and credit audit entries for reconciliation.
