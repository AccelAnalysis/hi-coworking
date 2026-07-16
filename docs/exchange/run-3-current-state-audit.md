# Run 3 current-state audit

Status: pre-implementation audit and architecture boundary
Recorded: 2026-07-13
Audited integration SHA: `19f5d6838ab53045773047ddd704382b9fc08b0c`
Production deployment or data access: **not performed**

## Repository reconciliation

Run 3 is isolated in
`/Users/jonathanholman/Code/Hi-Coworking/hi-coworking-exchange-run-3` on
`codex/exchange-run-3-economic-intelligence`. The branch starts from the remote
Run 1 line after Run 2 was merged into it, then merges current `origin/main`.
The merge is content-neutral for Run 1 and leaves the Run 2 commits visible in
the Run 3 ancestry. The original dirty `main` checkout was inspected read-only
and was not reset, cleaned, stashed, rebased, or edited.

At the audited SHA, `origin/main...HEAD` contains the four Run 2 commits and the
two integration merge commits. Run 1 is already on current remote `main`; Run 2
is present through merge `91408e1`. The Firebase aliases still resolve to
`hi-coworking-plat`. No deployment, migration, secret change, billing change,
credit mutation, or production read was authorized or performed.

## Integrated baseline

The clean integrated before-state was tested using an isolated official Node
20 runtime (`v20.20.2`) and Temurin Java 21 runtime (`21.0.11`) outside the
repository:

- `npm ci`: passed; 1,170 packages added and 1,174 audited. npm reported three
  moderate development-tooling findings.
- `npm run build:shared`: passed.
- `npm run build:functions`: passed.
- `npm run lint`: passed with zero errors and the five pre-existing warnings.
- `npm run test:exchange`: passed, 7 files and 60/60 tests.
- `npm run test:security`: passed, 7 files and 71/71 emulator-backed tests.
- demo-environment `npm run build`: passed, including all 52 static routes.
- `git diff --check`: passed.

Ports 3000 and 3001 belong to existing servers from other worktrees and must not
be stopped. Port 3002 is free and is reserved for Run 3. No non-empty Mapbox
token exists in the Run 3, Run 2, original-worktree environment files, or the
current process. Live-token WebGL QA is therefore not part of the audited
before-state and must not be claimed unless a token is later supplied and
actually exercised.

## Existing Exchange workspace

The Run 2 `/exchange` workspace is a production-shaped Opportunities view for
approved/open RFx and released/scheduled territories. It already has:

- a single interaction reducer and validated URL codec;
- search, filters, selection, history, viewport, map/list/split modes, desktop
  panels, a mobile filter drawer, and a mobile detail sheet;
- a bounded secured repository and stale-response protection;
- a one-instance Mapbox lifecycle plus safe missing-token list fallback; and
- 60 pure Exchange state, selector, shell, and map tests.

The only accepted view is currently `opportunities`. `ExchangeWorkspace.tsx`,
the command bar, reducer/action/type files, and URL codec are the central Run 3
integration seam. Connections and Intelligence do not exist. Non-Opportunity
views must not initialize Mapbox or issue RFx discovery reads.

## Referral domains and legacy boundary

The governing domain separation is already correct in the Run 1 contracts:

- a platform invitation invites a person or organization to join Hi Coworking;
- a business referral introduces a customer, lead, project, service need,
  partner, or other business opportunity from one business to another; and
- business-referral compensation is optional and defaults to none.

The legacy `/referrals` route still presents platform invitations, safely
redacted legacy business introductions, and team invitations on one page. Its
creation form creates only `platform_invite` records, which is correct for the
writer, but its product copy still describes the new business-referral
workspace as deferred. `referralPolicies` is legacy client-writable free-form
policy data and cannot become calculation authority. This route must remain a
membership-invitation compatibility surface and direct users to Exchange
Connections for secured business referrals.

Platform invitations must not enter Connections lists, service offers,
suggestions, trust, conversion rates, reciprocity analysis, gap analysis, or
economic-development metrics.

## Existing secured business-referral foundation

Run 1 already provides the authoritative primary domain:

- `businessReferrals`: minimized party identities, current UID/organization
  scopes, lifecycle, consent summary, optional compensation proposal, RFx/team
  links, optimistic version, expiry, outcome, and active-dispute identity;
- `businessReferralContacts`: same-ID protected third-party contact data with
  consent-gated recipient disclosure;
- `businessReferralDisputes`: protected dispute records;
- `businessReferralStorageGrantScopes` and private evidence namespaces using
  exact short-lived grants and authenticated byte transfer;
- `exchangeAudit`: staff-only operational audit;
- `exchangeIdempotency`: request-bound replay protection; and
- callables for create, send, accept/decline, progress, consent, evidence access,
  dispute creation/resolution, and expiry.

Current organization authority is re-read through the canonical
`orgMembers/{orgId}_{uid}` record. When an organization scope is present it
supersedes historical participant UID authority. Direct client writes to the
new referral, contact, and dispute collections are denied. Recipient contact
access remains dependent on the referral's disclosure decision.

## Missing capabilities

The audited baseline has no primary-domain list, detail, or party-readable
timeline API and no Connections UI. `exchangeAudit` cannot be reused as the
timeline because ordinary referral parties cannot read it and its purpose is
administrative audit.

The baseline also lacks:

- versioned referral service offers;
- immutable accepted offer and platform-fee snapshots;
- server-authoritative commerce configuration;
- transaction reporting, clarification, dual confirmation, calculation,
  reversal/refund handling, and settlement-disabled presentation;
- relationship insights, deterministic recipient suggestions, gaps,
  reciprocity context, or economic-impact projections;
- organization-scoped and Run 3 filtered indexes; and
- emulator seed data or a production-impossible visual demo mode.

## Security findings to repair

The audit found the following Run 3-relevant gaps in otherwise secured Run 1
code:

1. `businessReferral_create` proves only that a linked RFx exists. It must prove
   approved/open discoverability or exact current management authority.
2. Team linking trusts denormalized `primeUid`/`memberUids` fields. It must
   require the canonical `rfxTeamMemberships/{teamId}/members/{uid}` guard so
   revocation wins over stale arrays.
3. Conversion currently changes non-none legacy compensation to `due`. A
   recipient's conversion assertion must instead begin optional transaction
   reporting and can never establish a confirmed calculation or paid state.
4. A broad organization-authority catch turns operational failures into false.
   Only expected authorization denial should be normalized; other failures must
   propagate safely.
5. Active organization membership is sufficient for ordinary recipient
   lifecycle participation, but publishing offers, accepting compensated locked
   terms, transaction reporting, and financial confirmation require current
   owner/admin management authority.
6. Accepted terms, fee rates, calculations, transaction confirmation,
   relationship state, risk signals, aggregates, scores, and timeline events do
   not yet have server-only contracts.

All new callable output must be explicitly allowlisted because Admin SDK reads
are not constrained by Firestore rules.

## Legacy analytics that must not be reused

`onReferralWritten` and `profile.trustStats` operate on the legacy mixed
`referrals` collection, not `businessReferrals`. The trigger performs an
unbounded provider scan, treats legacy converted/paid fields as authoritative,
assumes a 14-day payout rule, treats zero payouts as 100% on-time, and can
publish `reliable_payee`/`fast_responder` through `publicProfiles`.

Those values are not Run 3 relationship or trust evidence. They must not feed
Connections, suggestions, platform aggregates, economic metrics, or a
`trusted` classification. The legacy Stripe referral-purpose checkout is also
not payout or transfer proof and must remain disconnected from Run 3.

## Approved minimal Run 3 architecture

Run 3 will extend rather than duplicate the secured foundation:

- keep accepted immutable terms on the authoritative business referral;
- store immutable/versioned service offers in `referralServiceOffers`;
- store each recipient report and referrer review in
  `referralTransactionReports`;
- add a server-generated append-only `businessReferralTimeline` that excludes
  contact PII, invoice detail, evidence paths, and narrative bodies;
- use `platformConfiguration/referralCommerce` with a safe server default of
  100 basis points, commerce and settlement separately controlled, and
  settlement disabled;
- create rebuildable, scoped relationship and analytics projections from
  authoritative referral/timeline/transaction records;
- calculate with shared integer-cent/basis-point functions and safe BigInt
  intermediate multiplication;
- perform deterministic recipient matching from published discovery fields and
  published active offers only; and
- expose all protected reads and writes through bounded, strictly parsed,
  current-authority callables.

Own-organization metrics may be exact. Platform/economic-development cells must
be suppressed unless both the record and distinct-organization minimums are
met. Reported and confirmed amounts remain separate and currency-specific.
Refunded/reversed/disputed data cannot improve confirmed metrics.

## Duplicate-control boundary

The protected contact record currently stores normalized plaintext email but no
safe duplicate fingerprint. A production fingerprint requires a versioned HMAC
key from Secret Manager, scoped to the authorized recipient/review context.
Run 3 may add only the configuration contract and manual-review unavailable
state when the key is absent. It must not commit a secret or fall back to an
unsalted public hash. A match is a review signal, not identity proof.

## Local review architecture

The live path uses authenticated bounded callables. The emulator path will use
fixed synthetic `.example.test` identities and hard-fail unless both Auth and
Firestore emulator hosts are configured for exactly `demo-hi-coworking`.

The Java-free visual fallback uses the same components, selectors, and public
view models behind an in-memory gateway. It activates only when
`NEXT_PUBLIC_EXCHANGE_DEMO_MODE=true` and `NODE_ENV !== "production"`, displays
a prominent `Development demo data` banner, and has no production write path.
Production builds must reject the flag.

## Explicit non-goals

This run will not implement Stripe Connect, transfers, production settlement,
merchant-of-record behavior, tax/withholding, chargeback automation, automatic
forfeiture, public risk accusations, cross-currency conversion, economic
multipliers, a public relationship graph, an AI claim, a production migration,
or deployment. Resource-program links will remain an honest unavailable/extensible
interface until an authoritative domain exists.
