# Exchange credit ledger and expiration

## Definition

One Exchange credit has a nominal value of one dollar and is usable only by an eligible verified business or organization for configured actions inside Hi Exchange. Credits are not cash, gift cards, transferable value, or redeemable currency. They are nontransferable, generally nonrefundable, and expire 12 calendar months after issuance.

Purchased and subscription-allocated credits have identical spending and expiration behavior.

## Accounting model

- `exchangeCreditAccounts/{organizationId}` is a server-owned projection.
- `exchangeCreditGrants/{grantId}` is the remaining-source ledger.
- `exchangeCreditTransactions/{transactionId}` records positive and negative events.
- Grants/transactions are the source of truth; scalar legacy balances are not.

Every grant records organization, source, original/remaining whole credits, grant time, optional expiry, source reference, idempotency identity, policy version, actor, status, and timestamps. Every transaction records organization, actor, amount, action/source reference, related grants, idempotency, policy, and time.

No transfer endpoint exists.

## Calendar expiration

Expiration uses UTC calendar arithmetic, not 365 days. July 15, 2026 plus 12 calendar months is July 15, 2027 at the same UTC time. End-of-month grants remain end-of-month where the target month is shorter. Legacy imports with unknown provenance receive no invented expiry and are flagged for review.

The scheduled expiration Function:

1. Scans active grants in a bounded batch.
2. Rechecks grant state transactionally.
3. Uses deterministic `expiration_{grantId}` transaction identity.
4. Sets remaining credits to zero and status to `expired`.
5. Decrements the account projection without going below zero.
6. Writes a job-run audit summary.

Replays are idempotent.

## Spending

Protected actions resolve their cost from private policy. The server then verifies organization membership, action permission, verification status, action enablement, and usable grants. Grants are consumed by earliest expiry, then grant date, then deterministic ID. Expired/revoked/consumed grants do not participate.

Grant changes, account projection, and the negative ledger entry occur in one Firestore transaction. Concurrent requests cannot both consume the same remaining credits.

Core browsing, claims, profile completion, resource discovery, public summaries, alerts, legitimate voluntary referral sending, and referral notice are not charged.

## Reversals

Audited reversal is appropriate for a withdrawn listing before review, verified duplicate, technical failure, or platform removal unrelated to the organization. Non-selection, non-conversion, or changed mind is not sufficient.

Payment refund/dispute handling revokes the remaining portion of the related grant. If credits were already spent, the account records a deficit and manual-review condition; it does not fabricate a negative correction back to zero. Ledger and payment evidence remain immutable.

## Initial packs

| Key | Credits | Amount | Enabled initially |
| --- | ---: | ---: | ---: |
| `exchange_credits_25` | 25 | $25.00 | No |
| `exchange_credits_60` | 60 | $60.00 | No |
| `exchange_credits_120` | 120 | $120.00 | No |

No volume discount is present. Each pack requires an approved Stripe Price and independent policy enablement.

## Legacy migration

The dry-run script reports user scalar balances as ambiguous unless authoritative organization ownership is known. Known organization balances can become idempotent `legacy_import` grants without invented historical source or expiry. Physical membership fields are untouched. Apply mode is restricted to emulator/demo projects in this assignment.
