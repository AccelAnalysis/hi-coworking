# Account, profile, and enrichment audit

Audit date: 2026-07-21

Configured development project: `hi-coworking-plat`

Region: `us-central1`

Hosting site: `hi-coworking-plat`
Branch: `codex/exchange-configured-acceptance-and-seed-activation`

## Safety baseline

- Local and remote branch heads both started at `39ae5f407705b88d3588d51f343b9e1afc96821c`.
- PR #19 was open and draft against `canonical`; PR #3 remained open and untouched.
- The sole pre-existing local lockfile ordering change was stashed before implementation.
- Firebase CLI project selection and browser configuration both resolved to `hi-coworking-plat`; browser emulator mode was false.
- Node 20.20.2 is used for the final clean install, compilation, discovery, validation, and deployment.
- No production project, Stripe object, organization seed import, or Microsoft member-mailbox action is in scope.

## Before-state evidence

The configured project exposed only `authBeforeCreate` from the journey’s backend set. It was active as a second-generation Node 20 Function in `us-central1`. `account_initialize`, `profile_update`, `enrichment_search`, and `enrichment_link` were absent. This directly explained the configured profile-save HTTP 404 and meant configured enrichment was also impossible.

Source inspection found these additional gaps:

- registration navigated directly to `/exchange` after Auth creation and display-name update;
- there was no callable account-repair path or authoritative confirmation gate;
- the blocking trigger logged UID and email and created no private profile shell;
- profile updates had no `expectedVersion`, no conflict signal, and no canonical response profile;
- omitted and clear operations were not consistently distinguishable for scalar fields;
- browser diagnostics masked multiple failure classes and logged an expected rejection with `console.error`;
- enrichment accepted no field-level selection, applied no candidate fields, stored no per-field provenance, and audited outside the profile transaction;
- provider results were sorted but not deduplicated across providers;
- the profile onboarding rendered verification before a new user had saved minimum profile context.

Identity Platform’s administrative config endpoint returned HTTP 403 to the active local Google identity, so the blocking-hook registration could not be independently enumerated through that endpoint. The deployed Function inventory is authoritative for Function presence; the new callable fallback removes registration correctness from dependence on that unverified control-plane read.

The configured inventory at baseline was:

- relevant deployed Function: only `authBeforeCreate`, gcfv2 Node 20, `us-central1`, active revision `authbeforecreate-00001-bak`;
- relevant missing callables: `account_initialize`, `profile_update`, `enrichment_search`, and `enrichment_link`;
- callable source/export chain: `profile_update` existed in TypeScript, `index.ts`, `firebaseEntry.ts`, `package.json` main, compiled `lib/firebaseEntry.js`, and Firebase discovery, but not in the deployed inventory;
- failing endpoint: `https://us-central1-hi-coworking-plat.cloudfunctions.net/profile_update`, HTTP 404 / `functions/not-found`, classified as `FUNCTION_NOT_DEPLOYED`; no server request/log correlation ID existed because the handler was absent;
- browser project/expected-project: `hi-coworking-plat`; region `us-central1`; emulator mode false;
- App Check enforcement on the four callables: disabled (authentication and authorization remain required);
- live Hosting release: `sites/hi-coworking-plat/releases/1773955884029000`, version `dad753a453d799e0`, deployed 2026-03-19; it was not changed because it drifted from canonical routing;
- live Firestore rules release: ruleset `c3f7dd07-66d3-46a0-b29d-57d2f86f1cc5`, updated 2026-07-07; unchanged;
- live Storage rules release: ruleset `1b2c2e04-bf2f-4cf4-9222-59a4e32949f4`, updated 2026-02-16; unchanged;
- live composite indexes: 55 READY versus 80 canonical source definitions, with 31 source-only and 6 live-only after normalized comparison; unchanged.

## Implemented boundary

- `account_initialize` reads identity and claims from Admin Auth, never from browser role input. It idempotently creates/repairs `users/{uid}` and `profiles/{uid}`, defaults claimless identities to `member`, preserves a trusted existing claim, and creates no organization, admin, marketing, or mailbox state.
- `authBeforeCreate` uses the same document provisioner in source and no longer logs UID/email. It is not part of the initial four-Function deployment set.
- registration normalizes email/name, confirms `account_initialize`, refreshes the ID token, then enters progressive `/profile?onboarding=1`; interrupted initialization has a same-session retry.
- sign-in and missing-user listeners invoke the idempotent repair path.
- `profile_update` requires `expectedVersion`, returns a request ID, incremented version, timestamps, readiness/completeness, projection status, and a sanitized canonical profile.
- nullable clearable scalars, explicit empty arrays, and omitted fields have distinct mutation behavior.
- enrichment search validates strictly, reports each provider explicitly, deduplicates candidates, and records caller-owned expiring searches.
- enrichment linking accepts only a server-recorded candidate and exact selected fields, enforces version/relink confirmation, applies selected values, writes per-field provenance, recalculates readiness, refreshes a public projection when applicable, consumes the request, and records audits in one transaction.
- callable errors are reduced to a shared safe structure; raw payloads, tokens, emails, and provider responses are excluded.

## Validation evidence so far

- shared TypeScript build: pass;
- Functions TypeScript build under Node 20: pass;
- Next.js production build: pass;
- focused contract/static tests: 31 pass;
- complete `exchange-callables.test.ts` emulator suite, including new account/profile/enrichment cases: pass;
- web lint: zero errors, six unrelated pre-existing warnings.

Configured deployment and browser acceptance evidence is recorded separately in `configured-development-acceptance.md` after execution.

## Final configured evidence

All four previously absent core callables are ACTIVE as second-generation Node 20 Functions in `us-central1`. Preflight and unauthenticated rejection prove routing/auth boundaries; authenticated current-user, disposable-registration, provider, link, and legacy-migration probes prove handler/transaction paths.

The disposable Chromium journey persisted schema 3/version 2 after USAspending linkage, field-level provenance, and a new login, then returned to the canonical `/exchange` workspace. Existing member, owner, and administrator profile saves passed. The synthetic legacy master retained `master`, migrated to schema 3/version 1 through the strict profile callable, and reloaded successfully. The configured member save also passed across seven browser/viewport projects.

The exact remaining operational limitations are:

- SAM.gov returned HTTP 400 despite the configured server secret, so only its graceful `unavailable` behavior—not successful results—is accepted;
- the source repair for `authBeforeCreate` was not deployed because the Identity Platform blocking-hook configuration could not be independently read; callable initialization is authoritative;
- Hosting, source/live rules, and index drift were recorded but deliberately not deployed in this backend-focused run;
- Node 20 decommission requires a separately reviewed runtime upgrade.

Overall completion is 97%, not 100%, because the configured SAM.gov provider is not operational and the live blocking-trigger revision remains intentionally unchanged.
