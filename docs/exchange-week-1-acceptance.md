# Exchange Week 1 acceptance record

Status: **Code complete — manual acceptance pending.** No staging deployment or real Stripe test-mode transaction has been performed.

| Requirement | Implementation location | Automated test evidence | Staging test evidence | Stripe evidence | Result | Remaining issue |
|---|---|---|---|---|---|---|
| Clean reconciliation from current main | `docs/pr4-preservation-and-deferral.md` | Full inherited and Exchange suites; clean generated diff | Not applicable | Not applicable | Pass | Human PR review |
| Search/create organization | `exchange/organizations.ts`, onboarding route | Emulator search/create; Playwright Path A | Not performed | Not applicable | Code complete | Authorized staging project and URL |
| Claim authority | Claim callables and `/admin/exchange-claims` | Emulator approve/reject/competing/rules; Playwright Path B | Not performed | Not applicable | Code complete | Staging operator sign-off |
| Strict Stripe test configuration | `exchange/membership.ts`, Stripe adapter | Catalog rejection matrix and injected mock Checkout | Not performed | No real Product/Price retrieval | Code complete | Test IDs and Firebase secrets unavailable |
| Founder cap/lifecycle | Membership transactions | Founder 1/249/250/251, concurrency, expiration and replay | Not performed | No real subscription | Code complete | Signed staging webhook lifecycle |
| Credits | `exchange/credits.ts` | FIFO/expiry/reversal plus invoice replay and organization isolation | Not performed | No real paid invoice | Code complete | Real test invoice and replay |
| Firestore security | `firestore.rules`, indexes | 71/71 combined tests; standalone rules 14/14, Functions 35/35, migrations 22/22 | Not deployed | Not applicable | Code complete | Deploy to designated staging only |
| Seed privacy/determinism | Preparation/import/verifier scripts | Two identical generations; local-emulator dry run/import/rerun | Not imported | Not applicable | Deploy-ready | Staging authorization |
| Browser journeys | Playwright suite | Path A and Path B pass against Auth/Firestore/Functions emulators | Not performed | Mock boundary only | Code complete | Hosted staging and real Checkout |
| Dependency runtime security | Root dependency override | `npm audit --omit=dev`: 0 vulnerabilities | Not applicable | Not applicable | Pass | Three moderate Firebase CLI-only advisories remain |
| CI | GitHub Actions | Final reviewed head had three green checks | Not applicable | Mocked only | Pass | New evidence commit must also remain green |
| Staging deployment | Staging checklist | Configuration inspection only | Not performed | Not configured | Blocked | Project owner must designate a project and enable required services |
| Real Stripe lifecycle | Stripe setup/checklist | Signed-webhook adapter and replay tests | Not performed | No test Checkout/webhook | Blocked | Test secrets, Product/Price IDs, endpoint and staging URL |
| Production safety | Explicit scope boundary | Secret scan and target inspection | No production command run | No live operation | Pass | Production remains out of scope |

## Pre-deployment revalidation — 2026-07-17

- Branch and remote head matched `8e5fe94467555e9db8cbc448a090e1a30055bfb5` before this evidence/security update. PR #5 was mergeable, draft, and had no reviews, comments, or unresolved review threads.
- Node `20.20.2`: clean `npm ci`; shared and Functions builds; web TypeScript and production export of 57/57 routes; 13/13 unit/import tests; 71/71 combined security/functions/migration tests; standalone rules 14/14, Functions 35/35, and migrations 22/22; Exchange emulator 7/7; Playwright 2/2; lint 0 errors with five pre-existing warnings.
- `websocket-driver` was pinned to the fixed `0.7.5` release after the clean install exposed a critical transitive runtime advisory. Runtime audit now reports zero vulnerabilities. Three moderate advisories remain only in the Firebase CLI dependency graph.
- Seed preparation produced 5,128 organizations, 1,591 home-based classifications, and 3,564 restricted candidates twice with identical SHA-256 hashes. Public output matched the committed JSONL; duplicate and home-privacy violations were zero.
- Full local-emulator dry run: 5,128 organizations and 3,564 restricted candidates would be created; zero updated, skipped, duplicated, or invalid. Local-emulator import created those counts, and the immediate rerun skipped all 5,128/3,564 records with zero writes.
- No staging import was run. No staging project is configured in `.firebaserc`; it contains only `default` and `prod`, both mapped to `hi-coworking-plat`. The authenticated account can see `hi-coworking-plat-dev`, but the repository and project owner have not designated it as staging, and Secret Manager is not enabled there.
- Actual repository Functions region is `us-central1` (`firebase.json`, web client, tests, and existing deployment documentation). A request to use `us-east1` must be resolved explicitly before deployment; changing the shared region would affect existing functions and URLs.
- No Stripe CLI or Stripe environment credential names were available. No secret was read, printed, written, or requested in chat.

## Acceptance boundary

Operational acceptance still requires an explicitly designated staging Firebase project, secure Stripe test configuration, controlled deployment, the two hosted journeys, a real signed webhook activation/invoice/replay, and sanitized evidence. Production merge/deploy and Stripe live mode remain out of scope.
