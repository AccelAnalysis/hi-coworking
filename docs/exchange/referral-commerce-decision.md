# Referral commerce decision record

Status: binding product direction; Run 3 foundation implemented, settlement deferred
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

## Approved fee rule

The Run 3 business-referral calculation foundation implements this rule:

- the receiving business publishes a structured referral-eligible service offer
  and its compensation formula before accepting referrals;
- a referrer submits a business referral under those published terms;
- a qualifying paid customer transaction produces a **gross referral payout**;
- Hi Coworking retains a platform fee from that gross referral payout;
- the initial platform fee is **100 basis points (1%) of the gross referral
  payout**;
- the fee is **not** 1% of the underlying customer transaction;
- the calculated remainder is the net referrer payout for any later approved
  settlement; Run 3 itself creates no payment entitlement; and
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

Monetary calculations use integer cents and basis points. Calculation version 1
uses BigInt intermediate multiplication and deterministic half-up rounding to
the nearest cent. This is a technical MVP rule only and still requires finance
and legal approval before settlement.

## Structured service-offer decision

Run 3 uses an explicit versioned `ReferralServiceOffer` schema rather than
free-form copy as calculation authority. An offer identifies the receiving
provider, eligible service/category, NAICS and territory discovery fields,
compensation type and structured formula, effective time, currency, attribution
window, and optional payout/refund explanations. `none` is a first-class
compensation type and `benefit` is non-cash.

Publishing locks an immutable version. A change creates a future draft version;
deactivation does not rewrite an accepted referral. Recipient acceptance binds
the exact offer series/version and platform-fee configuration version into an
immutable accepted-terms snapshot.

## Anti-gaming concerns

Implementation must address self-referrals, related-party referrals, duplicate
leads, pre-existing customer relationships, fabricated or circular
transactions, split/combined invoices, refunded or charged-back transactions,
off-platform evidence, collusion, identity/account abuse, retroactive offer
changes, false attestations, repeated claims on one transaction, and attempts to
manipulate any future trust score. A score or payout must not be inferred from a
single party's unverified assertion.

## Run 3 commerce states

The optional business-referral commerce substate is separate from the primary
referral lifecycle. The Run 3 schema supports `none`, `awaiting_transaction`,
`transaction_reported`, `awaiting_confirmation`, `transaction_confirmed`,
`payout_calculated`, `payout_due`, `settlement_unavailable`, `disputed`,
`cancelled`, `reversed`, and `refunded`.

Run 3 transaction confirmation ends an automatic cash calculation at
`settlement_unavailable`. No Run 3 path creates `paid`, transfers money, or
establishes payment entitlement. Reserved payout/refund states do not authorize
settlement or an unimplemented refund workflow.

## Run 3 implemented boundary

Run 3 implements:

- versioned structured offers and prospective platform configuration;
- a default 100-basis-point fee with `commerceEnabled` distinct from the
  schema-locked `settlementEnabled: false`;
- explicit recipient acceptance and immutable terms/fee snapshots;
- version-1 integer-cent calculations in which the fee applies to gross
  referral payout only;
- recipient reporting, referrer confirm/dispute/clarify decisions, protected
  evidence references, append-only timeline events, and audit;
- reported-versus-confirmed, currency-specific analytics; and
- the required settlement-disabled presentation.

## Decisions required before production settlement

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

## Run 3 boundary

Run 3 activates the secured Connections and Intelligence foundation described
above, but does not authorize Stripe Connect, transfers, merchant-of-record
behavior, tax/withholding, production settlement, a paid state, production
migration, deployment, or secret creation. Its exact formulas and security
constraints are recorded in `run-3-referral-commerce.md`,
`run-3-analytics-definitions.md`, and `run-3-security-and-privacy.md`.
