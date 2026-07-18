# Week 1 organization reconciliation acceptance

## Automated gates

- shared and Functions builds;
- web lint and production build;
- existing Exchange, security, Run 3, and Run 4 suites;
- canonical Exchange static regression;
- organization normalization/public-projection unit tests;
- seed dry-run/idempotency/privacy/project-guard tests;
- emulator-backed ordinary-user and legacy-admin profile saves;
- organization creation and claim approval;
- mobile 390×844, 393×852, and 430×932 screenshots;
- desktop 1280×800 and 1440×900 screenshots;
- clean diff check.

The focused workflow is `.github/workflows/exchange-week1-org-reconciliation.yml`. Generated browser screenshots are written under `docs/exchange/screenshots/week1-org-reconciliation/` during the acceptance run.

## Acceptance boundary

A green CI run validates source, emulator, and browser behavior. The configured shared development Firebase project still requires a manual smoke test because this branch does not deploy Functions or indexes. Mapbox live-provider acceptance also requires the configured public token.

## PR #13 rebase

After this branch is accepted into `codex/exchange-run-4-founding-launch`, update `codex/exchange-opportunity-discovery-100` onto the new canonical head. Resolve its organization assumptions in favor of `orgs`, `orgMembers`, and `publicOrganizations`; do not reintroduce Week 1 commercial collections.
