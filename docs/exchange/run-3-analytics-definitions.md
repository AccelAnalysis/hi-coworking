# Run 3 referral analytics definitions

Status: calculation contract, version 1  
Recorded: 2026-07-13  
Production deployment: **not performed**

## Common scope and integrity rules

All metrics in this document use `REFERRAL_ANALYTICS_VERSION = 1` and canonical
`businessReferrals` records. Records marked as `platform_invite` or
`membership_invite` are excluded. Legacy mixed-referral analytics and public
`trustStats` are not inputs.

The supported windows are 30, 90, and 365 days. The lower bound is calculated
at request time as:

```text
windowStart = requestTime - windowDays * 86,400,000 milliseconds
```

A referral is included when `businessReferrals.createdAt >= windowStart` and it
is in the authorized subject scope. This is a **referral-created cohort**, not a
transaction-event period. Associated transaction reports are loaded by the
included referral IDs; their collection dates are not independently filtered.
The upper bound is the callable's read time.

Own-individual and own-organization scopes are `own_exact`. Organization scope
requires current membership. Platform scope requires admin/master and is
publishable only when the cohort has at least five referrals **and** at least
five distinct organization IDs across the referral parties. If either minimum
is not met, aggregate values are null/suppressed. Individual-only subjects do
not count as distinct organizations for this threshold.

The own-scope query is capped at 250 referrals; the platform query is capped at
1,000. Reports are loaded in groups of at most 30 referral IDs, with at most 250
reports in each group. Any exceeded ceiling sets `truncated: true`. A truncated
metric describes only the records returned, not the complete cohort.

Rates are returned as decimal ratios in `[0, 1]`, rounded to four decimal
places. A zero denominator returns `null`; it is never displayed as zero or
100%. Medians discard missing, negative, and non-finite samples. For an even
sample, the median is the arithmetic mean of the two middle values.

Unless a definition says otherwise, counts use the referral's **current**
status at calculation time, not a historical ever-entered status. This is an
important version-1 limitation for referrals later closed, declined, withdrawn,
or expired.

## Network overview

For an own scope, `subject` is exactly `uid:<callerUid>` or `org:<orgId>`.
`relevant referrals` are cohort referrals for which that subject is the
referrer or recipient.

| Metric | Numerator/value | Denominator | Included statuses | Excluded statuses or records | Sample and window |
| --- | --- | --- | --- | --- | --- |
| Referrals sent | Count where referrer subject equals `subject` | None | All lifecycle statuses | Non-business-referral records | Cohort referrals in the selected window |
| Referrals received | Count where recipient subject equals `subject` | None | All lifecycle statuses | Non-business-referral records | Cohort referrals in the selected window |
| Accepted referrals | Received count whose current status is `accepted`, `in_progress`, or `converted` | None | `accepted`, `in_progress`, `converted` | `draft`, `sent`, `declined`, `closed`, `withdrawn`, `expired` | Received cohort referrals |
| Confirmed conversions (`confirmedConversions` field) | Distinct received referrals whose current status is `converted` and that have a current corroborating transaction report | None | Referral `converted`; report `confirmed`, `transaction_confirmed`, `payout_calculated`, `payout_due`, or `settlement_unavailable` | Unconfirmed, clarification, disputed, cancelled, reversed, and refunded reports; duplicate referral/report IDs | Received cohort referrals; each referral counts at most once |
| Unique referral partners | Count of distinct opposite subject keys across relevant referrals | None | All statuses | Blank partner keys and self-subject keys | Relevant cohort referrals |
| Acceptance rate | Accepted-referral count | Referrals received | As above | As above | `null` when no received referrals |
| Conversion rate | Confirmed-conversion count | Accepted-referral count | As above | As above | `null` when no currently accepted/in-progress/converted referrals |
| Median response time | Median of `(respondedAt - sentAt) / 3,600,000` | Number of valid timestamp pairs | All statuses with `respondedAt >= sentAt` | Missing or negative pairs | Relevant cohort referrals; hours |
| Median conversion time | Median of `(closedAt - acceptedAt) / 86,400,000` | Number of valid pairs | Current status `converted`, with `closedAt >= acceptedAt` | Non-converted or incomplete pairs | Relevant cohort referrals; days |
| Repeat partner rate | Count of distinct partners appearing in at least two relevant referrals | Unique referral partners | All statuses | Partners with only one referral | `null` when no partners |
| Largest partner share | Highest referral count for one partner | Count of relevant referrals | All statuses | Blank/self partner | `null` when no relevant referrals; this is concentration, not wrongdoing |

For the administrator platform scope there is no single subject. Version 1
sets sent and received counts to the total cohort size, unique partners to the
number of distinct subject keys, and uses the cohort totals for the same rate
and timing formulas. The platform result is always thresholded.

## Relationship insight

Relationship detail is available only for an own individual or organization
scope. Each opposite subject is one relationship. Platform relationship-detail
requests are denied.

| Factor | Definition |
| --- | --- |
| Sample size / accepted referrals | Count of pair referrals whose current status is `accepted`, `in_progress`, or `converted` |
| Confirmed conversions | Distinct pair referrals whose current lifecycle status is `converted` and whose current transaction report status is `confirmed`, `transaction_confirmed`, `payout_calculated`, `payout_due`, or `settlement_unavailable`; disputed, clarification, unconfirmed, refunded, cancelled, and reversed reports do not qualify |
| Median response hours | Median valid `sentAt` to `respondedAt` interval for the pair |
| Disputes opened | Count of pair referrals currently carrying `activeDisputeId` or `commerceStatus == disputed`; historical resolved disputes are not counted by the on-demand version-1 path |
| Disputes lost | Pure classifier input; the on-demand version-1 path currently supplies zero because no adjudicated-loss projection exists |
| Reversals | Count of associated transaction reports currently in `reversed` or `refunded` status |
| Verified | Pure classifier input; the on-demand version-1 path supplies false because it does not infer organization verification from private organization data |

Classification order matters:

1. `review_required` when sample size is at least 3 and either lost disputes are
   at least 2 or `reversals / max(1, sampleSize) > 0.25`.
2. Otherwise `trusted` when verified is true, sample size is at least 5,
   confirmed-conversion count is at least 3, lost disputes are zero, and reversals are
   zero.
3. Otherwise `established` when sample size is at least 3 and confirmed-conversion count
   is at least 1.
4. Otherwise `active` when sample size is at least 1.
5. Otherwise `new`.

The returned calculation version is 1. A relationship state is contextual
explanation, not a guarantee, credit rating, certification, authorization
decision, fraud conclusion, or payout entitlement.

## Reciprocal pattern measures

For each own-scope partner:

- `forwardCount` is referrals sent from the subject to the partner;
- `reverseCount` is referrals received from the partner;
- `pairCount` and `sampleSize` are `forwardCount + reverseCount`;
- `balanceRatio` is `min(forwardCount, reverseCount) /
  max(1, max(forwardCount, reverseCount))`, rounded to four decimals; and
- `pairShare` is `pairCount / max(1, firstPartyTotal + secondPartyTotal)`,
  rounded to four decimals.

The current callable supplies the full returned referral-cohort size for both
`firstPartyTotal` and `secondPartyTotal`, so its version-1 pair-share denominator
is twice that cohort size. This definition must be versioned if a separately
bounded partner population is introduced.

Classifications are evaluated in this order:

| Classification | Numerator/threshold | Denominator/sample |
| --- | --- | --- |
| `review_recommended` | `pairCount >= 5`, `pairShare >= 0.8`, and at least two corroborating signal types | Pair sample and cohort-derived pair share |
| `concentrated_pair` | `pairCount >= 5` and `pairShare >= 0.6` | Pair sample and cohort-derived pair share |
| `high_reciprocity` | `pairCount >= 5` and `balanceRatio >= 0.6` | Forward/reverse pair counts |
| `normal_reciprocity` | Every other case | Pair sample |

Corroborating signal types are any rapid cross-referral count above zero,
repeated-amount count above one, and disputed/reversed/refunded report count
above zero. The current callable supplies only the last signal; rapid and
repeated-amount inputs default to zero until an authorized projection exists.
Patterns do not alter calculations and are not a fraud accusation.

## Industry and territory gaps

Demand is built from the authorized referral cohort. A referral contributes to
its category cell, each NAICS-code cell, and its single territory-FIPS cell when
those values exist. It may therefore contribute to more than one industry cell.

Supply is built from at most 200 service-offer versions with current status
`published` and `acceptingReferrals == true`. Active recipients are distinct
provider subjects (`org:<id>` or `uid:<id>`) per cell.

| Metric | Numerator/value | Denominator | Included statuses | Privacy/sample rule |
| --- | --- | --- | --- | --- |
| Demand count | Distinct referral IDs in the cell | None | All current statuses | Own scope exact; platform cell requires at least 5 referrals and 5 distinct organization IDs |
| Active recipient count | Distinct active-offer provider subjects in the cell | None | Published, accepting service offers | Suppressed together with its platform cell when demand minimums fail |
| Unanswered demand count | Distinct cell referrals whose current status is `sent`, `declined`, `expired`, or `closed` | Demand count is available separately, not used as a returned rate | Listed statuses | Same cell suppression |
| Sample size | Distinct demand referral IDs | None | All statuses | Null when suppressed |
| Distinct organization count | Distinct non-empty referrer and recipient organization IDs represented in demand | None | All statuses | Null when suppressed |

Individual-only parties do not contribute an organization ID. A platform cell
is suppressed if either minimum fails; suppressed counts are null rather than
zero. Gap values are observations about the returned cohort, not forecasts.

## Economic-development counts

| Metric | Numerator/value | Denominator | Included statuses | Exclusions and qualification |
| --- | --- | --- | --- | --- |
| Referrals initiated | Count of canonical business referrals | None | All lifecycle statuses | Platform invitations and noncanonical records |
| Referrals accepted | Count currently `accepted`, `in_progress`, or `converted` | None | Listed statuses | Current `closed`, `declined`, `withdrawn`, `expired`, `draft`, and `sent` records |
| Confirmed conversions | Distinct referrals currently `converted` with at least one current corroborating transaction report | None | Referral `converted`; report `confirmed`, `transaction_confirmed`, `payout_calculated`, `payout_due`, or `settlement_unavailable` | Disputed, clarification, unconfirmed, refunded, cancelled, reversed, and duplicate report/referral IDs contribute no confirmed conversion |
| Businesses connected | Distinct referrer and recipient subject keys | None | All statuses | Blank keys; subject keys can represent an individual or organization |
| Industries connected | Distinct non-empty service category values plus distinct NAICS codes | None | All statuses | Missing values; category and NAICS are one combined version-1 set |
| Territories connected | Distinct non-empty territory FIPS values | None | All statuses | Missing values |
| RFx opportunities linked | Distinct `relatedRfxId`/compatible linked RFx IDs | None | All statuses | Missing and duplicate IDs |
| Teams linked | Distinct `relatedTeamId`/compatible linked team IDs | None | All statuses | Missing and duplicate IDs |
| Non-cash benefit referrals | Count with compensation type `benefit` | None | All statuses | Cash, custom, and no-compensation policies |

These counts inherit the selected referral-created cohort and the platform
suppression envelope. Jobs supported, contracts influenced, and resources or
programs accessed are not calculated in version 1 because Run 3 has no
authoritative source for them.

Version 1 also does not emit a count of newly formed relationships, a complete
trusted/active relationship count, a compensation-type distribution, or an
industry/territory diversity rate. Relationship detail is a separately capped
list, so a client must not convert that list into a complete population count
when `truncated` is true. The distinct industry and territory counts above are
the only implemented diversity-adjacent measures. Unsupported measures are
omitted rather than inferred.

## Currency-specific referred-transaction values

Each valid uppercase three-letter currency has a separate bucket. Values are
integer cents. Invalid currency codes are skipped. Buckets are never summed or
converted across currencies.

Let:

```text
collected = nonnegative collectedTransactionCents
refund = min(collected, nonnegative refundAmountCents)
remainingRatio = collected == 0 ? 0 : (collected - refund) / collected
```

| Metric | Numerator/value | Included report statuses | Excluded statuses | Refund/reversal treatment |
| --- | --- | --- | --- | --- |
| Reported referred transaction value | Sum of `collected` | Every status except `cancelled` and `reversed` | `cancelled`, `reversed` | A `refunded` report remains in reported gross value; refund is disclosed separately |
| Confirmed referred transaction value | Sum of `collected - refund` | `confirmed`, `transaction_confirmed`, `payout_calculated`, `payout_due`, `settlement_unavailable`, `refunded` | `transaction_reported`, `awaiting_confirmation`, `disputed`, `cancelled`, `reversed`, and all other statuses | Confirmed refund is subtracted; reversed value contributes zero |
| Refunded referred transaction value | Sum of `refund` | Same confirmed-status set | Every other status | Refund is capped at collected amount |
| Gross referral payout | Sum of `round(storedGrossPayout * remainingRatio)` | Same confirmed-status set and a stored calculation | Every other status or missing calculation | Prorated for the confirmed refund |
| Calculated platform fee | Sum of `round(storedPlatformFee * remainingRatio)` | Same confirmed-status set and a stored calculation | Every other status or missing calculation | Prorated for the confirmed refund |
| Net referrer benefit | Sum of `round(storedNetPayout * remainingRatio)` | Same confirmed-status set and a stored calculation | Every other status or missing calculation | Prorated for the confirmed refund; cash only |

For these nonnegative proration values, JavaScript `Math.round` produces the
nearest integer cent with a .5 fraction rounded upward. This refund proration is
an analytics version-1 technical rule, not an approved settlement or accounting
allocation policy.

The current transaction confirmation callable normally stores calculated cash
reports as `settlement_unavailable`, so those reports qualify as confirmed
metrics without implying that funds moved. A disputed report is excluded from
confirmed amounts. A single recipient report may increase only reported value;
referrer confirmation is required for the confirmed set.

## Referral compensation calculation measures

Financial calculations use `REFERRAL_CALCULATION_VERSION = 1`, separately from
analytics version 1. The qualifying calculation basis is:

```text
compensationBasisCents = min(
  qualifyingTransactionCents,
  collectedTransactionCents
)
```

For percentage terms, gross payout is the accepted basis-point percentage of
that basis. For fixed terms, the snapshotted fixed amount is used when the basis
is greater than zero. `none`, `custom`, and `benefit` return zero automatic cash
amounts with explicit statuses. Platform fee is the snapshotted basis-point
percentage of gross payout, never of customer transaction value. The complete
formula and technical rounding boundary are in
`docs/exchange/run-3-referral-commerce.md`.

## Reported, confirmed, estimated, and unsupported labels

- **Reported** means a recipient supplied a transaction report; it is not
  independently verified merely by evidence or upload.
- **Confirmed** transaction value means the report reached the version-1
  confirmed-status set after the referrer's decision and is net of its recorded
  refund. It does not mean Hi Coworking settled money.
- **Converted referral** means the business-referral lifecycle is currently
  `converted`; it must not be relabeled as a confirmed monetary transaction.
- **Calculated** compensation means deterministic version-1 arithmetic under
  the immutable terms snapshot; it does not create a payable or paid right.
- **Estimated** values require an explicit source and label. Run 3 calculates
  no regional multiplier and no estimated jobs-supported value.
- **Unsupported** measures must be omitted, not represented by demo-only or
  fabricated production values.
