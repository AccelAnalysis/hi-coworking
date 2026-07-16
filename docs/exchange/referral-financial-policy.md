# Referral financial policy

## Scope and status

Voluntary uncompensated referrals remain supported. Paid referral collection is disabled by default, and automated payouts are always false in the current schema. The implementation provides quote, snapshot, hold, reserve, accumulation, readiness, reporting, and audited manual-payout intent; it moves no live money.

## Approved formula

For gross referral fee `R`:

```text
percentage fee = round(R × 10%)
platform service fee P = max(percentage fee, $5.00)
available before threshold A = R − P − Stripe fee recapture S − temporary reserve H
```

All values are integer cents with basis-point half-up rounding. The accepted policy and complete quote are snapshotted. Browser-calculated fees are ignored.

### Examples before configured Stripe recapture and reserve

| Gross referral fee | 10% calculation | Minimum adjustment | Platform service fee |
| ---: | ---: | ---: | ---: |
| $20.00 | $2.00 | $3.00 | $5.00 |
| $50.00 | $5.00 | $0.00 | $5.00 |
| $100.00 | $10.00 | $0.00 | $10.00 |

There is no universal $50 referral minimum. A $6.00 gross fee is valid under the default zero fee-estimate inputs because it leaves positive proceeds. A $5.00 gross fee is rejected because the $5.00 service fee leaves no positive proceeds. An administrator may later configure a higher explicit minimum.

Stripe payment and payout cost estimates are separate recapture inputs. Actual processing fees can be recorded later and reconciled; estimates are not represented as platform service fee.

## Holds and reserves

- Payout hold: 14 calendar days.
- New recipient reserve: 10% for 45 days.
- New-recipient qualification: first 90 days and until 3 successful settlements.
- Established recipient reserve: 5% for 30 days.
- Reserve is a temporary liability, not permanent platform revenue.
- Refund and dispute states block payout eligibility.

The lifecycle supports `unpaid`, `awaiting_payment`, `payment_processing`, `funded`, `holding`, `reserve_active`, `payout_eligible`, `accumulating`, `payout_pending`, `paid_out`, `partially_released`, `refunded`, `disputed`, `cancelled`, and `manual_review`.

The initial lifecycle initializer is intentionally narrow: it accepts only immutable accepted fixed-fee terms between two verified organizations while the referral-payment flag is enabled. Percentage/custom/non-cash terms remain in the existing Run 3 reporting/manual workflow until their payment basis is fully implemented.

## Accumulation and manual readiness

The minimum accumulated payout is $100. Small valid earnings are not rejected. One $25 balance remains `accumulating`; four eligible $25 balances can reach `payout_eligible`. Year-end, account closure, long-standing balance, and administrator release procedures require later policy approval.

The protected admin workflow changes an eligible record to `payout_pending` and records intended disposition. It explicitly writes `transferCompleted: false`; no Stripe transfer or payout is fabricated.

## Recovery order

1. Untransferred transaction proceeds.
2. Transaction-specific reserve.
3. Organization rolling reserve.
4. Future referral earnings.
5. Authorized connected-account recovery where legally and technically supported.
6. Platform operating reserve.
7. Direct collection from the responsible participant.

## Platform operating reserve

The target is the greatest of:

- $500;
- 5% of trailing 90-day gross paid-referral fees; or
- twice trailing 90-day refunds, disputes, and unrecovered processing costs.

This is platform accounting policy, not customer credits.

## Integrity

Existing Run 1–3 no-self-referral, same-organization, consent, evidence, dispute, participant approval, idempotency, and immutable-audit controls remain. The referrer cannot approve its own payout, and recipient state cannot fabricate referrer acceptance. Common ownership and duplicate signals require manual review; they do not automatically accuse a business.
