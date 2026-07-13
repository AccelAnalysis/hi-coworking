# Referral commerce decision record

Status: binding product direction; implementation deferred
Recorded: 2026-07-13

## Purpose and domain separation

Hi Coworking has two distinct referral-related domains:

1. **Platform invitations** are membership-acquisition invitations that invite a
   person or organization to join Hi Coworking.
2. **Business referrals** are private business-to-business introductions in
   which one business connects a prospective customer or opportunity to another
   business.

They must remain separate in data, language, lifecycle, permissions,
notifications, reporting, and future commerce. A platform invitation is not a
business introduction, and a business referral is not evidence of membership
acquisition.

## Approved future fee rule

When business-referral commerce is later authorized and implemented:

- the receiving business publishes a structured referral-eligible service offer
  and its compensation formula before accepting referrals;
- a referrer submits a business referral under those published terms;
- a qualifying paid customer transaction produces a **gross referral payout**;
- Hi Coworking retains a platform fee from that gross referral payout;
- the initial platform fee is **100 basis points (1%) of the gross referral
  payout**;
- the fee is **not** 1% of the underlying customer transaction;
- the remaining referral payout is payable to the referrer; and
- each accepted referral stores an immutable snapshot of the applicable fee
  rate and offer terms so later prospective admin changes cannot rewrite an
  accepted agreement.

Example only:

```text
Qualifying customer transaction:  $10,000
Referral compensation:                 10%
Gross referral payout:              $1,000
Hi Coworking fee: 1% of payout         $10
Net referrer payout:                   $990
```

Future monetary calculations must use integer cents and basis points. No
rounding rule is invented by this record.

## Structured service-offer requirement

A future offer must use an explicit versioned schema rather than free-form copy
as the financial authority. At minimum it will need the receiving business,
eligible service, eligibility/qualification conditions, compensation formula,
effective interval, currency, acceptance terms, fee-rate policy reference, and
version. Acceptance must bind the referral to an immutable snapshot of the
offer and platform-fee basis points.

## Anti-gaming concerns

Implementation must address self-referrals, related-party referrals, duplicate
leads, pre-existing customer relationships, fabricated or circular
transactions, split/combined invoices, refunded or charged-back transactions,
off-platform evidence, collusion, identity/account abuse, retroactive offer
changes, false attestations, repeated claims on one transaction, and attempts to
manipulate any future trust score. A score or payout must not be inferred from a
single party's unverified assertion.

## Candidate future settlement states

The final state machine requires legal, finance, and payment-provider approval.
Candidate states for design review include `awaiting_transaction`,
`transaction_reported`, `awaiting_confirmation`, `qualified`, `held`,
`payable`, `paid`, `reversed`, `refunded`, `disputed`, and `cancelled`. These
names are not an operational schema and create no current payment entitlement.

## Decisions required before financial implementation

- Rounding and allocation policy.
- Stripe Connect or alternative payout architecture.
- Merchant-of-record and funds-flow responsibility.
- Tax reporting and withholding treatment.
- Referral and platform legal agreements.
- Settlement timing, reserves, and hold periods.
- Refund, partial-refund, cancellation, and chargeback treatment.
- Transaction and evidence thresholds.
- Dual-confirmation and non-response policy.
- Dispute, appeal, and administrative authority.
- Anti-fraud controls and any trust-score policy.
- Data retention, export, deletion, and audit requirements.
- Jurisdiction, prohibited categories, sanctions, and privacy review.

## Run 2 boundary

Run 2 does **not** implement referral service-offer publishing, fee or payout
calculations, transaction attestations, settlement, transfers, Stripe Connect,
holds, refunds, disputes, fraud scoring, or referral analytics. It does not
expose a Connections or Business Referrals workspace tab and does not represent
settlement as operational.

The Exchange shell, reducer, URL framework, and responsive panels are designed
so a future authorized `connections` view can be added without replacing the
workspace foundation. That extension remains hidden until it has complete,
secure data and actions.
