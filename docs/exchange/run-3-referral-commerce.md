# Run 3 business-referral commerce foundation

Status: calculation and workflow foundation implemented; settlement disabled  
Recorded: 2026-07-13  
Production deployment or financial activation: **not performed**

## Approved boundary

Run 3 implements structured business-referral offers, immutable accepted terms,
recipient transaction reporting, referrer review, deterministic calculations,
evidence references, dispute/clarification states, and analytics. It does not
move money and does not turn platform membership invitations into commerce.

The initial platform fee is **100 basis points (1%) of the gross referral
payout**. It is not 1% of the underlying customer transaction.

`commerceEnabled` and `settlementEnabled` are separate. The schema and callable
contract require `settlementEnabled: false`; an administrator cannot enable it
through the Run 3 update path.

## Versioned service offers

`referralServiceOffers` stores one document per offer version. Each version has
an immutable series identity (`offerId`), an exact version-document identity
(`id`), a numeric `version`, a mutable optimistic `stateVersion`, provider
identity, discovery fields, compensation terms, effective time, and
publication/deactivation authority.

Supported compensation types are:

- `none`: a first-class no-compensation offer;
- `fixed`: a positive integer-cent amount;
- `percentage`: 1–10,000 basis points and either
  `first_collected_invoice` or `total_collected_contract`;
- `custom`: explanatory terms that require manual handling and are not an
  automatic monetary formula; and
- `benefit`: an explicitly non-cash benefit description.

The offer also supports currency, attribution window, payout trigger, optional
payment deadline, refund explanation, and included/excluded charge labels.
Free-form fields explain terms but do not override structured calculation
fields.

An individual manages their own offer. An organization offer requires the
caller's current owner/admin membership in an active organization. Publishing
requires the expected draft `stateVersion`, makes the version effective, and
deactivates any previously published version in the same series. Editing a
published/inactive offer creates a new draft version; it does not rewrite the
old document. Deactivation does not change an accepted referral.

All mutations are callable-only, idempotent, optimistic-versioned, atomic, and
audited. Discoverable listing includes only effective, published, accepting
offers whose organization is active or whose individual profile is published.

## Immutable acceptance snapshot

The recipient must explicitly acknowledge terms when accepting a Run 3
referral. Offer-backed or compensated organization acceptance requires current
organization owner/admin authority. The server reads the exact published offer
and current commerce configuration in the acceptance transaction, then locks:

- offer series ID, exact offer-version document ID, and numeric offer version;
- compensation type and structured fixed/percentage basis or non-cash/custom
  description;
- currency, attribution window, payout trigger, payment deadline, refund
  explanation, and included/excluded charges;
- platform-fee basis points and platform-fee configuration version;
- recipient actor UID, optional organization ID, and acceptance time; and
- financial calculation version.

The snapshot is stored on `businessReferrals.acceptedTermsSnapshot`. No callable
offers an edit path. A later offer deactivation, new offer version, or fee
configuration update applies prospectively and cannot rewrite an accepted
referral.

## Platform configuration

The trusted default when no configuration document exists is:

```text
configuration ID             referralCommerce
schema version               1
platform fee                 100 basis points
configuration version        1
commerce enabled             true
settlement enabled           false
```

The live document is `platformConfiguration/referralCommerce`. Admin/master
may create the next prospective version with an expected current version and
an idempotency key. The transaction preserves the prior and next versions under
the document's `versions` subcollection, increments the version, records the
actor and effective time, and writes an audit event. Optional prospective
fields are `payoutHoldDays` (0–365) and
`manualEvidenceThresholdCents` (a nonnegative safe integer). These fields are
configuration scaffolding; they do not activate settlement.

Authenticated users may retrieve the allowlisted configuration through
`referralCommerce_getConfiguration`. Direct Firestore access is denied.

## Calculation version 1

Inputs and outputs use integer cents and integer basis points. Three-letter
currency codes are normalized to uppercase and must match the accepted terms.
Negative, fractional, unsafe-integer, currency-mismatched, or out-of-range
inputs fail.

The basis for an automatic cash calculation is:

```text
compensationBasisCents
  = min(qualifyingTransactionCents, collectedTransactionCents)
```

The gross payout is:

```text
none        -> 0; status no_compensation
fixed       -> snapshotted fixedCompensationCents when basis > 0, otherwise 0
percentage  -> compensationBasisCents * snapshotted rate
custom      -> 0; status manual_terms_required
benefit     -> 0; status non_cash_benefit
```

For an automatic cash calculation:

```text
grossReferralPayoutCents
  = structured compensation formula applied to the basis

platformFeeCents
  = grossReferralPayoutCents * snapshottedPlatformFeeBasisPoints

netReferrerPayoutCents
  = grossReferralPayoutCents - platformFeeCents
```

The fee calculation never uses `qualifyingTransactionCents` or
`collectedTransactionCents` directly. It uses gross referral payout only.

### Deterministic technical rounding

Version 1 uses BigInt intermediate multiplication and integer division rounded
half-up to the nearest cent:

```text
roundBasisPointsHalfUp(amountCents, basisPoints)
  = floor((amountCents * basisPoints + 5,000) / 10,000)
```

This is a deterministic **technical MVP rule only**. Finance and legal approval
of rounding, allocation, refund, reserve, and settlement policy is still
required before money movement. The rule's existence in code is not that
approval.

### Example

```text
Qualifying and collected transaction:  $10,000.00
Referral compensation:                         10%
Gross referral payout:                   $1,000.00
Platform fee: 1% of gross payout            $10.00
Net referrer payout:                       $990.00
```

The version-1 result stores the source amounts, calculation basis, gross payout,
snapshotted fee rate, fee, net amount, currency, calculation version, and
calculation status.

## Transaction reporting and dual review

Transaction reporting is optional and separate from the primary referral
lifecycle. Conversion moves a compensated referral to
`awaiting_transaction`; it does not create `due`, `paid`, or settled value.
No-compensation referrals remain valid business referrals without a financial
workflow.

The recipient, or a current owner/admin for the recipient organization, may
report an accepted/in-progress/converted referral. The callable requires:

- expected referral version and a caller-bound idempotency key;
- the immutable accepted terms;
- positive qualifying and collected amounts, with collected no greater than
  qualifying and each no greater than 1,000,000,000,000 cents;
- collection time, accepted-terms currency, and optional contract reference;
  and
- at most ten canonical private evidence paths whose objects pass server-side
  type and size checks.

The recipient report begins as `transaction_reported` with a pending referrer
decision. Full evidence contents and invoice data are not copied into the
referral or timeline.

The referrer, or a current owner/admin for the referring organization, may use
`businessReferral_reviewTransaction` with the report's expected version and an
idempotency key:

- `confirm` calculates from the accepted snapshot. Automatic cash calculations
  become `settlement_unavailable`; none/custom/benefit calculations become
  `transaction_confirmed` with their explicit non-cash/manual status.
- `clarify` requires a private note and becomes `awaiting_confirmation`.
- `dispute` requires a private note and becomes `disputed`.

The private review note is not included in participant-safe transaction
projections, timeline metadata, suggestions, or analytics. A disputed report
does not improve confirmed values or relationship confidence.

Fixed compensation and `first_collected_invoice` percentage terms permit only
one confirmed payout calculation for the referral. Replays return the original
result only when actor, action, idempotency key, and request fingerprint match.

## Timeline and audit

Referral lifecycle events and commerce events are append-only, server written,
and readable only through a current-authority callable projection. Events
include report, review, calculation/settlement-disabled, terms-lock, dispute,
consent, progress, conversion, and closure states where applicable.

Timeline metadata may include minimized state, calculation version, currency,
or evidence count. It must not include a customer name, email, telephone,
invoice detail, evidence path or contents, private note, or dispute narrative.
Administrative mutations also write `exchangeAudit` records.

## Refund and reversal boundary

The transaction schema reserves `partial`, `full`, and `cancelled` refund
states plus `reversed` and `refunded` report statuses. Analytics version 1 can
subtract a stored confirmed refund and exclude a reversal. Run 3 does **not**
add a general participant callable that adjudicates or settles a refund,
chargeback, or reversal. It does not infer one from an upload or unilateral
assertion.

A production workflow still requires approved refund, partial-refund,
chargeback, reserve, hold, challenge-period, dispute, and allocation policy.
Until such a workflow is authorized, refund fields are protected
server-authoritative contract space, not a promise of automatic handling.

## Settlement-disabled presentation

Every completed automatic calculation must present:

```text
Calculation complete — platform settlement is not yet enabled.
```

Run 3 does not create a `paid` state. A screenshot, proof URL, evidence upload,
button click, checkout opening, single party assertion, or ordinary Stripe
charge cannot establish payout or settlement.

Before production settlement, separate authorization and implementation are
required for a marketplace payout provider, merchant-of-record decision, tax
and withholding, legal agreements, approved rounding and refund policy,
chargebacks, reserves and holds, payout disputes, account onboarding, sanctions,
prohibited-category review, retention, and operational reconciliation.
