# Exchange Week 1 acceptance record

| Requirement | Implementation location | Automated test | Manual test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|---|
| Clean reconciliation from current main | `docs/pr4-preservation-and-deferral.md` | Diff scope and full inherited suite | PR review | Code complete | PR #4 commit preserved; Category B/C absent | CI review pending |
| Search/create organization | `exchange/organizations.ts`, onboarding route | Emulator search/create + browser Path A | Staging source search | Code complete | Local emulator/browser pass | Remote USAspending/staging smoke pending |
| Claim authority | Claim callables and `/admin/exchange-claims` | Emulator approve/reject/competing/rules + browser Path B | Staging review UI | Code complete | Atomic owner assignment and audit pass | Staging operator sign-off pending |
| Strict Stripe test configuration | `exchange/membership.ts`, Stripe adapter | Unit catalog rejection matrix + mock checkout | Real Stripe retrieval/Checkout | Code complete | Validation precedes reservation locally | Real Stripe test credentials unavailable |
| Founder cap/lifecycle | Membership transactions | Unit 1/249/250/251 + concurrent emulator attempts | Inspect staging allocation | Code complete | Unique/idempotent allocation tests | Remote webhook lifecycle pending |
| Credits | `exchange/credits.ts` | Unit FIFO/reversal/expiry + emulator invoice replay/isolation | Inspect staging invoice lot | Code complete | One 25-credit lot per invoice locally | Real Stripe invoice pending |
| Firestore security | `firestore.rules`, indexes | 71 inherited security tests + Exchange denials | Rules deploy smoke | Code complete | Direct claim/credit/founder/source access denied | Staging rules deployment pending |
| Seed privacy/determinism | preparation/import/verifier scripts | Unit dry-run/idempotency + attached-source double regeneration | Staging dry-run/import | Deploy-ready | Identical hashes, zero privacy violations | Staging import not performed |
| Browser journeys | Playwright suite | Path A and Path B against emulators | Repeat on staging | Code complete | 2/2 local browser tests pass | Staging and real hosted Checkout pending |
| CI | GitHub Actions workflow | Runs all builds/tests/browser/seed checks | Observe branch run | Configured | Workflow committed | Result unavailable until pushed/run |
| Staging deployment | Staging checklist | N/A | Deploy and smoke | Not performed | No staging alias/project in repo | Project ID/authorization required |
| Real Stripe lifecycle | Stripe setup/checklist | Mocked only in CI | Real test Checkout + signed webhooks/replay | Not performed | No secrets used or exposed | Required for Week 1 acceptance |
| Production | Explicitly out of scope | N/A | N/A | Not performed | No production command run | Merge/deploy requires later authorization |

## Automated evidence

- Functions/shared/web TypeScript builds pass.
- Thirteen Node unit/import tests pass for normalization, capabilities, Stripe state, founder 1/249/250/251 behavior, credit expiry/FIFO, strict price/product/mode validation, webhook signatures, and seed dry-run/idempotency/privacy.
- Four Firebase emulator tests pass for search/create, server-only claim rules and competing approval, checkout authority/reservation/cap, and invoice-credit idempotency/expiry.
- Two Playwright journeys pass against Auth/Firestore/Functions emulators for the required Path A and Path B.
- Attached source regeneration produced 5,128 Isle of Wight organizations, 1,591 home-based classifications, and 3,564 restricted candidates twice with identical SHA-256 output. The public output exactly matches the committed JSONL, has no duplicate IDs, and has no protected home-location/contact fields.

## Environment truth

The emulator uses a mock Stripe client only when `EXCHANGE_STRIPE_MOCK_MODE=1` and the project ID starts with `demo-`. Production/staging code uses the real adapter. No real Stripe test checkout, remote webhook, or staging deployment was performed because no dedicated staging Firebase alias/project or Stripe test credentials were available in repository configuration.

## Acceptance boundary

Automated code acceptance is complete. Final operational acceptance requires the manual staging evidence in `docs/exchange-staging-checklist.md`, including real Stripe test mode and signed remote webhook verification. Production merge/deploy remains explicitly out of scope.
