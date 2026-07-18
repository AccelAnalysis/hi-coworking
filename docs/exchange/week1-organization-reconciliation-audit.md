# Week 1 organization reconciliation audit

## Scope and immutable baseline

- Canonical source: `codex/exchange-run-4-founding-launch`
- Starting canonical SHA: `553da22d42a882a21fa5061fd5a6fc61d172767e`
- Preserved Week 1 source: `codex/exchange-week1-merge-source`
- Week 1 source SHA: `6c3d8de77ad092682a809b5d11ac8015471531c6`
- Reconciliation branch: `codex/exchange-week1-org-reconciliation`
- Opportunity Discovery PR #13 is intentionally untouched.

The two source branches diverged at `6b2c3f3b417868b78b60bf66d65f30cf5828abb5`. A wholesale merge was rejected because it would replace the canonical Exchange workspace and reintroduce obsolete membership and credit collections.

## Product decisions

1. `/exchange` continues to render `ExchangeWorkspace`.
2. Intelligence, Referrals, Opportunities, and Resources remain the only primary Exchange modes.
3. Organization search and onboarding are contextual flows, not a fifth mode.
4. Run 4 `exchangeMemberships`, `exchangeCreditAccounts`, `exchangeCreditGrants`, and `exchangeCreditTransactions` remain authoritative.
5. Week 1 `organizationMemberships`, `organizationCreditLots`, and `organizationCreditLedger` were not ported.
6. Full organization records remain protected; `publicOrganizations` is an allowlisted projection.
7. No production seed import, deployment, migration, or Stripe write is part of this branch.

## Per-file classification

| Week 1 file | Classification | Decision |
|---|---|---|
| `.env.example` | Port selectively | Corrected the callable region to us-central1 and added project mismatch diagnostics. |
| `.github/workflows/exchange-map-smoke.yml` | Port selectively | A focused current-architecture CI workflow replaces the Week 1 workflow. |
| `.github/workflows/exchange-security.yml` | Port selectively | A focused current-architecture CI workflow replaces the Week 1 workflow. |
| `.github/workflows/exchange-week-1-acceptance.yml` | Port selectively | A focused current-architecture CI workflow replaces the Week 1 workflow. |
| `.gitignore` | Already superseded | No change was necessary in the current branch. |
| `apps/functions/.env.demo-hi-coworking` | Already superseded | No change was necessary in the current branch. |
| `apps/functions/lib/exchange/credits.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/lib/exchange/membership.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/lib/exchange/model.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/lib/exchange/organizations.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/lib/index.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/lib/payments/ledger.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/lib/payments/stripeProvider.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/lib/payments/stripeWebhook.js` | Reject because it is generated output | TypeScript remains authoritative; CI rebuilds lib. |
| `apps/functions/package.json` | Already superseded | No change was necessary in the current branch. |
| `apps/functions/scripts/import-organizations.cjs` | Reimplement against current architecture | Added privacy reports, project guard, public projection, no-op behavior, and rollback evidence. |
| `apps/functions/scripts/prepare-organization-seeds.py` | Reimplement against current architecture | Added privacy reports, project guard, public projection, no-op behavior, and rollback evidence. |
| `apps/functions/scripts/verify-organization-seed.py` | Reimplement against current architecture | Added privacy reports, project guard, public projection, no-op behavior, and rollback evidence. |
| `apps/functions/src/exchange/credits.ts` | Already superseded | Run 4 exchangeMemberships and exchangeCredit* records are retained. |
| `apps/functions/src/exchange/membership.ts` | Already superseded | Run 4 exchangeMemberships and exchangeCredit* records are retained. |
| `apps/functions/src/exchange/model.ts` | Port selectively | Only organization normalization and matching moved to organizationModel.ts. |
| `apps/functions/src/exchange/organizations.ts` | Reimplement against current architecture | Claims now initialize Run 4 commercial records and write public projections/audit. |
| `apps/functions/src/index.ts` | Port selectively | Merged only organization contracts, exports, rules, and indexes. |
| `apps/functions/src/payments/ledger.ts` | Already superseded | Run 4 exchangeMemberships and exchangeCredit* records are retained. |
| `apps/functions/src/payments/stripeProvider.ts` | Already superseded | Run 4 exchangeMemberships and exchangeCredit* records are retained. |
| `apps/functions/src/payments/stripeWebhook.ts` | Already superseded | Run 4 exchangeMemberships and exchangeCredit* records are retained. |
| `apps/functions/src/payments/types.ts` | Already superseded | Run 4 exchangeMemberships and exchangeCredit* records are retained. |
| `apps/functions/test-fixtures/organization-seed.jsonl` | Adopt unchanged | Synthetic fixture remains safe and deterministic. |
| `apps/functions/test/exchange-model.test.cjs` | Port selectively | Rewritten for the canonical model, privacy projection, and project guard. |
| `apps/functions/test/organization-import.test.cjs` | Port selectively | Rewritten for the canonical model, privacy projection, and project guard. |
| `apps/web/next.config.ts` | Already superseded | No change was necessary in the current branch. |
| `apps/web/src/app/admin/exchange-claims/page.tsx` | Port selectively | Integrated with the current AppShell and stronger claimant-reason/idempotency behavior. |
| `apps/web/src/app/exchange/founding/page.tsx` | Already superseded | Run 4 membership, wallet, policy, and checkout architecture remains canonical. |
| `apps/web/src/app/exchange/membership/canceled/page.tsx` | Already superseded | Run 4 membership, wallet, policy, and checkout architecture remains canonical. |
| `apps/web/src/app/exchange/membership/page.tsx` | Already superseded | Run 4 membership, wallet, policy, and checkout architecture remains canonical. |
| `apps/web/src/app/exchange/membership/success/page.tsx` | Already superseded | Run 4 membership, wallet, policy, and checkout architecture remains canonical. |
| `apps/web/src/app/exchange/onboarding/page.tsx` | Port selectively | Integrated with the current AppShell and stronger claimant-reason/idempotency behavior. |
| `apps/web/src/app/exchange/page.tsx` | Reject because it replaces ExchangeWorkspace | Canonical route remains the prototype-derived workspace. |
| `apps/web/src/app/login/page.tsx` | Already superseded | Current registration and access behavior is preserved. |
| `apps/web/src/app/register/page.tsx` | Already superseded | Current registration and access behavior is preserved. |
| `apps/web/src/components/AppShell.tsx` | Port selectively | Only onboarding and claim-review links were added to the current shell. |
| `apps/web/src/components/PublicSiteGate.tsx` | Already superseded | Current registration and access behavior is preserved. |
| `apps/web/src/lib/functions.ts` | Port selectively | Merged only organization contracts, exports, rules, and indexes. |
| `data/seed/prepared/isle-of-wight-organizations.jsonl` | Requires migration | Real prepared data was not copied or imported; tooling and fixtures only. |
| `docs/exchange-claim-review.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/exchange-map-first-access.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/exchange-rollback.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/exchange-staging-checklist.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/exchange-week-1-acceptance.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/exchange-week-1-audit.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/founding-membership-architecture.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/isle-of-wight-seed-import.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/pr4-preservation-and-deferral.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/stripe-test-setup.md` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `docs/templates/isle-of-wight-organization-import.csv` | Already superseded | New reconciliation-specific documentation records the canonical decisions. |
| `firestore.indexes.json` | Port selectively | Merged only organization contracts, exports, rules, and indexes. |
| `firestore.rules` | Port selectively | Merged only organization contracts, exports, rules, and indexes. |
| `package-lock.json` | Port selectively | Only acceptance tooling/scripts were reconciled; the current dependency tree was preserved. |
| `package.json` | Port selectively | Only acceptance tooling/scripts were reconciled; the current dependency tree was preserved. |
| `playwright.config.ts` | Port selectively | Only acceptance tooling/scripts were reconciled; the current dependency tree was preserved. |
| `tests/browser/exchange-onboarding.spec.ts` | Reimplement against current architecture | Tests now assert ExchangeWorkspace and Run 4 collections instead of the legacy marketplace. |
| `tests/exchange/exchange-acceptance.test.ts` | Reimplement against current architecture | Tests now assert ExchangeWorkspace and Run 4 collections instead of the legacy marketplace. |
