# Run 4 — Exchange founding launch

## Repository reconciliation

- Canonical repository: `AccelAnalysis/hi-coworking`
- Firebase project identity: `hi-coworking-plat`
- Isolated worktree: `/Users/jonathanholman/Code/Hi-Coworking/hi-coworking-exchange-run-4`
- Branch: `codex/exchange-run-4-founding-launch`
- Base: `485192e1c082c33189f6e86781f975024aa5b8dd`
- Base commit subject: `feat(exchange): add referral intelligence and economic impact`

Run 3 was not present on `origin/main`. It existed as an uncommitted implementation in the isolated Run 3 worktree on top of the merged Run 1/Run 2 line. The implementation was verified with Node 20 and Java 21: 83 security/rules/function/migration tests, 35 Run 3 tests, 64 Exchange tests, Functions/shared builds, web production build, and lint with five unrelated warnings. It was then preserved as commit `485192e` before this worktree was created. The dirty primary checkout was not changed.

## Audit findings before Run 4

### Runs 1–3

- Run 1 established custom-claim staff authority, protected referral contact/evidence, exact organization membership checks, deny-by-default financial collections, idempotency records, and server Functions for protected state changes.
- Run 2 established `/exchange` as a responsive map/list/split workspace with reusable map lifecycle, URL-backed state, RFx and territory layers, mobile drawers, and compatibility with existing RFx data.
- Run 3 added organization-aware business referrals, immutable accepted service-offer terms, transaction reporting/review, disputes, recipient suggestions, relationship intelligence, gap analysis, reciprocal-pattern context, economic impact, and privacy suppression.
- Run 4 preserves those boundaries. It does not replace referral privacy, RFx authority, or analytics calculations.

### Commercial architecture found

- Physical membership was stored on `users/{uid}` with `membershipStatus`, `plan`, `expiresAt`, and physical tiers `virtual`, `coworking`, and `coworking_plus`.
- Legacy Stripe subscription Checkout accepted a physical tier and provisioned the individual user with a synthetic 35-day expiry.
- Credits were a scalar `users/{uid}.credits` value plus user-level `creditTransactions`.
- Legacy credit packs and action costs were compile-time constants and were not an organization accounting ledger.
- Organizations use `orgs/{orgId}` and exact `orgMembers/{orgId}_{uid}` membership documents. Owner/admin roles already support protected organization management.
- Stripe webhook verification and generic payment/webhook ledgers already existed. Run 4 extends this path; it does not add a competing webhook endpoint.
- Primary navigation still advertised Directory, RFx, and Referrals as separate products. The dashboard led with desk bookings and physical membership.

### Authorization and rules found

- Platform staff/admin authority is read from Firebase Auth custom claims. Mirrored Firestore roles are convenience data only.
- Organization authority is established by an active organization plus an exact active member relationship.
- Firestore and Storage rules already protect Run 1–3 referral, RFx, evidence, and team membership records.
- Generated `apps/functions/lib` output is committed and is regenerated from `src`; Run 4 follows that policy.

## Implemented organization commercial domain

The new domain uses the established `orgs`/`orgMembers` names and adds:

- `exchangeMemberships/{organizationId}`
- `exchangeCreditAccounts/{organizationId}`
- `exchangeCreditGrants/{grantId}`
- `exchangeCreditTransactions/{transactionId}`
- `exchangeCommercialPolicies/current`
- `exchangeCommercialPolicyVersions/{policyVersion}`
- `exchangePublicConfiguration/current`
- `exchangeCheckoutIntents/{stripeCheckoutSessionId}`
- `referralFinancialAccounts/{lifecycleId}`
- `referralFinancialEvents/{eventId}`
- `exchangeAuditEvents/{eventId}`
- `exchangeJobRuns/{runId}`

Credits, subscriptions, Stripe identifiers, and paid entitlements are organization owned. A signed-in user without an organization keeps permitted free browsing but cannot purchase or spend organization credits.

Organization permissions are explicit:

| Permission | Member default | Owner/admin default |
| --- | ---: | ---: |
| `view_exchange` | Yes | Yes |
| `edit_profile` | Yes | Yes |
| `respond_to_opportunities` | Yes | Yes |
| `manage_referrals` | Yes | Yes |
| `spend_credits` | Explicit grant | Yes |
| `purchase_credits` | Explicit grant | Yes |
| `manage_billing` | No | Yes |
| `manage_members` | No | Yes |

Legacy members without a `permissions` array receive the non-billing/non-credit baseline so existing organizations can use free Exchange workflows during migration.

## Exchange membership separation

`ExchangeTierId` is `free | founding`. Its status and Stripe period boundaries live on the organization Exchange membership. Physical `users.plan`, physical membership status, desk hours, and booking logic remain intact and are not interpreted as Exchange rights.

| Capability | Personal/free browsing | Free organization | Active Founding organization |
| --- | ---: | ---: | ---: |
| Browse permitted Exchange map/data | Yes | Yes | Yes |
| Claim/create profile under existing rules | Yes | Yes | Yes |
| Public opportunity/resource summaries | Yes | Yes | Yes |
| Receive authorized referrals/invitations | Yes | Yes | Yes |
| Organization actions | No | Permission/policy dependent | Permission/policy dependent |
| Buy/spend credits | No | Verified + permission + enabled policy | Verified + permission + enabled policy |
| Founding recognition | No | No | Yes; historical recognition is distinct from active rights |
| Paid entitlements | No | No | Only while status is `active` |
| Physical desk hours | Separate product | Separate product | Not included |

Past-due, paused, incomplete, or cancelled Founding organizations retain free Exchange access. Historical recognition follows policy separately from active entitlements.

## Unified Exchange and dashboard

- `/exchange` remains canonical and map oriented.
- Views now include `businesses`, `opportunities`, `referrals`, `teaming`, `resources`, and `intelligence`.
- The Run 2 opportunity map and Run 3 referral/intelligence views remain the underlying implementation.
- `/directory`, `/rfx`, and `/referrals` are compatibility redirects into the relevant Exchange view.
- Primary navigation now emphasizes Dashboard, Exchange, and Membership & Credits rather than separate Directory/RFx/Referrals products.
- `/exchange/founding` is the public founding campaign.
- `/exchange/wallet` is the authenticated organization wallet and membership area.
- `/admin/exchange-launch` is the protected readiness and accounting summary.
- The dashboard now starts with Exchange context, launch market, verification, membership, credits, profile readiness, opportunities, teaming, referrals, and resources. Physical workspace is a subordinate planned-later section governed by `physicalWorkspaceEnabled`.

## Central policy and default feature flags

The authoritative configuration is `exchangeCommercialPolicies/current`. The browser receives only the sanitized public projection.

| Flag | Initial value |
| --- | ---: |
| `exchangeEnabled` | `true` |
| `exchangeFoundingCampaignEnabled` | `true` |
| `exchangeFoundingCheckoutEnabled` | `false` |
| `exchangeCreditPurchasesEnabled` | `false` |
| `exchangeReferralPaymentsEnabled` | `false` |
| `referralAutomatedPayoutsEnabled` | `false` (schema literal) |
| `bookstoreEnabled` | `false` |
| `eventsEnabled` | `false` |
| `physicalWorkspaceEnabled` | `false` |

The launch market is configured as Isle of Wight County, Virginia. Business classification must distinguish located in market, serves market, outside initial market, and future-expansion seed; no county-specific authorization is scattered through callables.

## Completed, required, and deferred

### Code completed

- Organization entitlement resolver and permission checks.
- Separate free/founding Exchange membership contracts.
- Public/private versioned policy projections.
- Expiring append-only credit grants and transactions.
- Atomic earliest-expiration spending and concurrency protection.
- Idempotent scheduled expiration.
- Idempotent purchase/subscription grants and reversal deficit handling.
- Founding subscription, credit-pack, and Billing Portal callables.
- Existing signature-verified webhook extension for Checkout, invoice, subscription, refund, and dispute events.
- Referral quote, reserve, payout threshold, operating reserve target, lifecycle initialization, readiness query, and manual payout-intent approval.
- Rules, tests, migration assessment, UI, and operational docs.

### Configuration required

- Approved Founding amount and capacity.
- Approved included credits and action costs/quotas.
- Approved Stripe Product and recurring Price IDs.
- Approved Stripe Products/Prices for each enabled credit pack.
- `APP_BASE_URL` and existing Stripe secrets.
- Stripe webhook subscription and production endpoint verification.
- Terms/legal approval and support playbook.
- Admin policy publication and sanitized projection.

### Deliberately disabled or not performed

- Founding Checkout, credit purchases, and referral payments.
- Automated referral payouts and live Connect onboarding.
- Bookstore, events, and physical-space launch promotion.
- Production migration or Firebase deployment.
- Live Stripe Product/Price/customer/subscription/webhook/Connect/transfer/payout changes.

## Migration, deployment, and rollback

1. Run `scripts/migrate-exchange-run4.mjs --project=<explicit-id>` in dry-run mode and archive both human-readable and JSON output.
2. Resolve ambiguous user-owned credits, missing organizations, placeholder Stripe IDs, invalid compensated referrals, and claim/verification review records.
3. Publish a reviewed private policy with all protected commerce flags still false.
4. Deploy rules/indexes and Functions, then the web application.
5. Verify free Exchange and organization entitlement reads.
6. In a controlled environment, validate Stripe webhook/Portal/Checkout readiness.
7. Enable one protected commerce flag only after its readiness gate is fully green.

Rollback is flag-first: disable checkout/purchases/referral payments, preserve ledgers and webhook evidence, roll web/Functions back, and never delete grants, transactions, financial events, or policy versions. Physical membership records are never migrated into Exchange membership, so rollback does not alter physical access.
