# PR #13 Opportunity Discovery reconciliation inventory

This inventory was prepared from the clean canonical Exchange commit
`a987fd5f1013d2e05299348dab2956866a24bb78` before Opportunity Discovery code
was restored. The source is
`origin/codex/exchange-opportunity-discovery-100` at
`62b082175e3de3af4c8731e6023382b6d982a5ff`.

## Selective import candidates

The 39 paths added only on PR #13 are candidates for selective restoration:

- the versioned shared discovery contract and its tests;
- isolated Functions modules for discovery, fallback, gateway, governance,
  personalization, and recent searches, plus their focused test;
- isolated web gateways, hooks, state helpers, location provider, NAICS catalog,
  three UI components, focused tests, and the emulator-oriented browser spec;
- validation, fixture, index-merge, and emulator-first backfill scripts;
- the opt-in validation workflow and public environment-variable example;
- Opportunity Discovery architecture, accessibility, performance, scaling,
  security, index, and acceptance documentation.

These files are absent at the canonical starting commit. They will still be
reviewed for obsolete contracts, unsafe projections, fabricated coordinates,
stale architecture claims, and duplication before they are retained.

## Manual reconciliation targets

The following existing canonical areas must not be replaced from PR #13:

- `apps/functions/src/index.ts`, `rfxQueries.ts`, profiles, territories, and all
  current organization Functions;
- shared package exports and package metadata;
- Exchange command bar, filters, active filters, cards, results, detail,
  Opportunities view, URL state, reducer, actions, workspace types, map, and
  Functions client wiring;
- root package metadata, lockfile, Firestore rules and indexes, Playwright
  configuration, and canonical tests.

Only Opportunity Discovery additions will be hand-applied to those files after
comparison with the current implementation.

## Canonical work intentionally excluded

PR #13 deletes or predates newer organization claims and onboarding, seeded
organization tooling, profile repair, territory and camera behavior,
configured-development readiness, referral and membership foundations, browser
coverage, Firestore authorization, and other Run 3/Run 4 work. Those deletions
and older replacements are out of scope and will not be imported.

No generated Functions output, secret file, dependency upgrade, deployment,
production data operation, Stripe write, seed import, or account bootstrap is
part of this reconciliation.
