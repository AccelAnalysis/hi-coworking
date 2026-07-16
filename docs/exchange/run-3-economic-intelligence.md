# Run 3 economic-development and referral intelligence

Status: implemented architecture and review boundary  
Recorded: 2026-07-13  
Production deployment or migration: **not performed**

## Product boundary

Run 3 keeps two referral domains separate.

- A **platform invitation** invites a person or organization to join Hi
  Coworking. It remains in the membership-invitation domain and is excluded
  from business-referral search, lifecycle, suggestions, relationships,
  reciprocity, conversion, compensation, and economic-development metrics.
- A **business referral** introduces a customer, lead, project, service need,
  partner, or opportunity from one business to another. It may use no
  compensation, cash compensation, custom terms, or a non-cash benefit.

Compensation is an optional policy on a business referral. It does not define
whether a record is a business referral.

## Exchange workspace

The Run 2 workspace now has the explicit views `opportunities`, `connections`,
and `intelligence`, addressed by `/exchange?view=<view>`.

- **Opportunities** preserves the approved/open RFx and territory workspace.
  Its integration points may start a referral or show an authorized RFx/team
  link; Run 3 does not replace the RFx domain.
- **Connections** is the secured business-referral workspace. It uses the
  Run 1 lifecycle and consent model, adds list/detail/timeline reads, structured
  service offers, recipient suggestions, transaction reporting, and a
  settlement-disabled calculation state.
- **Intelligence** presents bounded, authority-scoped network, relationship,
  gap, reciprocity, and referred-transaction measures. Values are returned
  only when supported by authoritative records, and platform aggregates are
  privacy-thresholded.

Membership invitations are not a Connections dataset or an Intelligence
metric.

## Authoritative records and projections

The implementation extends the Run 1 records rather than introducing a second
referral lifecycle.

| Record | Purpose | Authority boundary |
| --- | --- | --- |
| `businessReferrals` | Minimized parties, lifecycle, consent summary, optional compensation, immutable accepted terms, links, and current commerce state | Parties with current authority can read; all writes are callable-only |
| `businessReferralContacts` | Third-party name, email, telephone, and company details | Referrer, assigned staff/admin, and recipient only after disclosure is allowed |
| `businessReferralDisputes` | Referral dispute facts and private resolution workflow | Referral parties and assigned staff/admin; callable-only writes |
| `referralServiceOffers` | Immutable published offer versions and mutable draft/future versions | Managed by the provider or current organization owner/admin through callables |
| `referralTransactionReports` | Recipient report, referrer decision, calculation, and refund/status fields | Protected callable projections only; no direct client access |
| `businessReferralTimeline` | Append-only participant-safe lifecycle events | Protected callable projection only; no direct client writes or reads |
| `platformConfiguration/referralCommerce` | Current prospective fee configuration and immutable version children | Authenticated read through a callable; admin/master update through a callable |
| `referralRelationshipInsights`, `referralAnalyticsSnapshots` | Rebuildable projection namespaces | Direct reads and writes denied; current MVP computes bounded responses on demand |
| `referralRiskSignals`, `referralDuplicateFingerprints` | Future protected review namespaces | Direct reads and writes denied; no public graph or public accusation surface |

The referral, accepted terms, transaction report, and append-only event history
remain authoritative. An aggregate or relationship classification is
rebuildable context and is never the legal record of a referral or transaction.

## Callable surface

Run 3 exports the following secured paths in addition to the existing Run 1
lifecycle, consent, evidence, and dispute callables:

- `businessReferral_listMine`, `businessReferral_getDetail`, and
  `businessReferral_listTimeline`;
- `businessReferral_reportTransaction` and
  `businessReferral_reviewTransaction` (`confirm`, `dispute`, or `clarify`);
- `businessReferral_suggestRecipients`;
- `referralServiceOffer_create`, `referralServiceOffer_publish`,
  `referralServiceOffer_createVersion`, `referralServiceOffer_deactivate`,
  `referralServiceOffer_listMine`, and
  `referralServiceOffer_listDiscoverable`;
- `referralCommerce_getConfiguration` and
  `referralCommerce_updateConfiguration`; and
- `referralIntelligence_getOverview`,
  `referralIntelligence_listRelationships`,
  `referralIntelligence_getGapAnalysis`,
  `referralIntelligence_getEconomicImpact`, and
  `referralIntelligence_getReciprocalPatterns`.

Referral creation and the Run 3 offer, configuration, transaction-report, and
transaction-review mutations use strict input parsing, a caller-bound
idempotency key, an input fingerprint, optimistic expected versions where a
record already exists, an atomic transaction, and an `exchangeAudit` record.
Every callable re-reads current organization or referral authority instead of
trusting a client role or historical membership.

## Referral, RFx, and team links

Run 3 supports `relatedRfxId`, `relatedTeamId`, and the compatible
`relatedOpportunityId`. A related opportunity currently must be the same
authorized RFx; there is no invented generalized opportunity store.

- A linked RFx must be approved/open or currently manageable by the referrer.
- A linked team requires the canonical current team-member guard. When the
  recipient is an individual, that recipient must also have the canonical
  current team-member guard.
- A team linked with an RFx must belong to that RFx.
- A selected service offer must be a currently published, accepting version
  owned by the referral recipient.
- Same-user and same-organization referrals are rejected, including cases
  inferred from current cross-membership records.

`relatedResourceProgramId` is an extensible field only. Run 3 does not invent a
resource-program database, metric, or working link where no authoritative
program domain exists.

## Recipient suggestions

Suggestions are deterministic and server generated. They are not described as
AI. Candidate records come only from effective, published service offers that
accept referrals. Organization candidates must still be active; individual
candidates require a published public profile. The caller, the caller's
organizations, inactive offers, and unavailable providers are excluded.

The current scoring version is 1:

| Factor | Points |
| --- | ---: |
| Exact service-category match | 40 |
| Matching NAICS code | 20 per match, capped at 40 |
| Territory FIPS match | 20 |
| Verified published individual profile | 10 |

The returned score is capped at 100. Each result identifies the matched NAICS
codes, territory match, accepting-referrals state, compensation type, and
machine-readable reasons. An organization is not given verification points
until a published organization-verification domain exists. The score is a
discovery ranking, not a guarantee, authorization decision, trust score, or
payout decision.

The candidate scan is capped at 200 published accepting offers and the response
at 25 suggestions. A `truncated` flag tells the client when the returned result
may not describe the complete available set.

## Relationship intelligence

Relationship insights are computed for an authorized individual or
organization and grouped by the opposite referral subject. Platform-wide
relationship-detail requests are denied.

The classification version is 1 and exposes its sample size, factors, and
reason codes. The current factors are accepted-referral count, corroborated
confirmed-conversion count, median response time, current dispute indicators,
reversed or refunded transaction-report count, and verification state.

- `new`: no accepted referral history;
- `active`: at least one accepted referral;
- `established`: at least three accepted referrals and at least one converted
  referral with a current confirmed transaction outcome;
- `trusted`: verified, at least five accepted referrals, at least three
  converted referrals with current confirmed transaction outcomes, no lost
  disputes, and no reversals; and
- `review_required`: at least three accepted referrals plus either at least two
  lost disputes or a reversal ratio above 25%.

The server does not infer organization verification from private organization
data, and its current relationship response supplies `verified: false` and no
historical lost-dispute count. Therefore an organization relationship may
become established but is not automatically promoted to `trusted` by the live
MVP path. Synthetic demo fixtures can illustrate the approved trusted-state
explanation, but they are visibly labeled development data.

No relationship classification is a guarantee, credit rating, legal
certification, authorization decision, or automatic payout entitlement.

## Network, gaps, reciprocity, and economic measures

The precise formulas, statuses, cohort windows, suppression rules, and
calculation versions are defined in
`docs/exchange/run-3-analytics-definitions.md`.

Important integrity boundaries are:

- analytics include canonical business referrals only;
- the selectable 30-, 90-, or 365-day window is a referral-created cohort;
- own individual and own organization results may be exact;
- a platform scope requires admin/master and is suppressed below both five
  referrals and five distinct organizations;
- reported and confirmed referred-transaction values are separate;
- disputed, cancelled, and reversed reports do not improve confirmed values;
- refund amounts reduce confirmed values and calculated compensation measures;
- currency buckets remain separate, with no FX conversion;
- reciprocity is context, not automatic evidence of wrongdoing; and
- truncation and sample-size notices must remain visible.

The on-demand intelligence query is bounded to 250 referral records for an own
scope and 1,000 for the administrator platform scope. It accepts only 30-, 90-,
or 365-day windows and queries on `businessReferrals.createdAt`. Transaction
reports are fetched only for those referral IDs, in groups of at most 30 IDs,
with a 250-report ceiling per group. Published gap-supply offers are capped at
200. A truncated response describes only the returned cohort and must not be
presented as a complete population.

## Development review data

The Firebase emulator seed uses deterministic `.example.test` identities and a
dedicated demo project guard. The Java-free visual mode uses the same Exchange
views, selectors, cards, and gateway interface as the live path, displays a
prominent development-data banner, and is disabled by production runtime
guards. Synthetic values demonstrate states and layouts; they are not evidence
about real businesses and must never be combined with production analytics.

## Explicit limitations

Run 3 does not implement or claim:

- Stripe Connect, transfers, production settlement, merchant-of-record status,
  tax handling, or a `paid` state;
- an approved refund, chargeback, reserve, hold, or final accounting policy;
- cross-currency conversion or regional economic multipliers;
- jobs-supported values, contracts-influenced values, or resource-program
  values without an explicit authoritative source;
- a public relationship graph, public risk details, fraud accusations, or an
  AI model;
- production deployment, production migration, or Secret Manager changes; or
- live-token Mapbox/WebGL QA. No local Mapbox token was available during the
  documented audit, so only the existing missing-token/list fallback can be
  claimed unless a token is later configured and exercised.
