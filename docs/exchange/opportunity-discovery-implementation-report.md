# Opportunity Discovery reconciliation report

Date: 2026-07-20
Repository: `AccelAnalysis/hi-coworking`
Target branch: `codex/exchange-run-4-founding-launch`
Reconciliation branch: `codex/exchange-opportunity-discovery-reconciliation`
Canonical starting commit: `a987fd5f1013d2e05299348dab2956866a24bb78`
PR #13 source commit: `62b082175e3de3af4c8731e6023382b6d982a5ff`

## Reconciliation approach

PR #13 was used as a source archive, not merged or cherry-picked. Isolated
Opportunity Discovery modules were restored and repaired. Every shared
Exchange surface, Functions export, rule, index, and package change was
hand-applied over the newer canonical branch.

The reconciliation intentionally preserves:

- the canonical map-first `/exchange` workspace and existing Mapbox instance;
- camera and URL precedence, 2D/3D controls, mobile drawer, and desktop panels;
- Intelligence, Referrals, Opportunities, Resources, and Menu navigation;
- organization anchors, claims/onboarding, profile and territory behavior;
- current authorization, membership, referral, Run 3, and Run 4 foundations;
- legacy RFx management behavior for requests without a discovery operation.

No production deployment, Firebase project mutation, seed import, account
bootstrap, Stripe operation, secret addition, or dependency upgrade is part of
this branch.

## Delivered architecture

- A versioned shared query/result/governance contract is exported from
  `@hi/shared/opportunity-discovery` and used by the web and Functions types.
- The existing `rfx_listManaged` callable acts as a compatibility gateway only
  when a recognized discovery operation is present.
- A callable-only `opportunityDiscovery` projection excludes transactional RFx,
  responder, evaluation, private contact, administrative, and ranking fields
  from browser responses.
- Only approved/open RFx receive a public projection. Draft, moderated,
  rejected, closed, awarded, cancelled, and archived states remain in canonical
  authority-scoped management flows.
- Cursor pagination reads one look-ahead document and advances from the last
  consumed source record, preventing skipped pages.
- A bounded server fallback scans at most 400 approved/open legacy RFx while
  projection backfill is incomplete and explicitly returns degraded warnings.
- Saved opportunities, recent views, saved/recent searches, governance,
  addenda, acknowledgments, and Q&A remain server-authorized and browser-rule
  denied.
- Restricted opportunities are visible only to verified staff/admin,
  individual owners, or exact active organization owner/admin memberships.
- Organization and user personalization is derived from canonical server data;
  browser role or relationship flags are not trusted.

## Discovery experience

The canonical Opportunities mode now supports keyword search; curated NAICS
labels and codes; independent capabilities; procurement, buyer, work,
visibility, certification, set-aside, award, teaming, deadline, and budget
filters; personalization; saved/recent searches; and eleven URL-backed sort
modes.

Cards and details expose decision context, authoritative location confidence,
deadline and budget data, issuer identity, save/share/team actions,
relationship state, and governed addenda/Q&A without exposing competitor data.
Advanced controls use progressive disclosure and active filters are capped at
four visible chips plus overflow.

## Geography and map preservation

Location search is behind a Mapbox Geocoding v6 provider abstraction with a
deterministic test provider. Coordinates are range-checked, non-point and
duplicate suggestions are ignored, and rate-limit/provider failures have safe
messages. Point/radius and viewport-bounds queries are distinct contract states.

Every result carries an explicit location-confidence state. Results without
valid opportunity coordinates remain in the authorized list, never receive a
fabricated marker, and show a no-coordinate explanation. “Search this map
area” is contextual after meaningful movement. The existing camera precedence,
map lifecycle, cluster behavior, fit controls, and 2D/3D controls were retained.

## Index and workflow reconciliation

The canonical Firestore index file retains every pre-existing definition and
adds 27 query-shaped definitions: 21 projection search variants and six saved,
recent, governance, and fallback definitions. Projection indexes cover the
base, first-token, and single-territory shapes for every physical server sort,
with `__name__` direction matching the cursor sort. No index was deployed.

The dedicated workflow installs locked dependencies, builds shared and
Functions code, runs focused contract/provider/state tests, compiles the
opt-in Playwright acceptance suite, validates 100,
1,000, and 10,000 synthetic fixtures, checks index presence/order/duplicates,
runs canonical Exchange/development/organization/security/Run 3/Run 4 gates,
builds the production web app, checks whitespace, and removes generated
Functions output. Configured-development Mapbox browser acceptance stays
manual and opt-in.

## Validation evidence

The local gate passed 13 focused shared/Functions tests, nine web state and
location-provider tests, 67 static integration checks, 27 index definitions,
three synthetic fixture sets (100, 1,000, and 10,000 records), 15 compiled
Playwright scenarios, 88 Exchange tests, nine configured-development tests,
11 organization Node tests plus seven organization Vitest checks, 90 combined
security/Functions/rules/migration tests, 35 Run 3 tests, 34 Run 4 tests, lint
with zero errors, and the production Next.js build. Exact commands and
remaining external gates are recorded in `opportunity-discovery-acceptance.md`.

## Deliberately not claimed

- Firestore indexes are defined but not deployed or observed in a live project.
- Projection backfill is emulator-first tooling only and was not run against
  production data.
- External saved-search alert delivery remains disabled.
- The NAICS UI is a curated launch catalog, not the complete official dataset.
- Live configured-development Mapbox, full viewport screenshot, assistive
  technology, and load/performance acceptance remain explicit later gates.

This branch is a production-shaped reconciliation, not a production launch or
a claim of 100% operational acceptance.
