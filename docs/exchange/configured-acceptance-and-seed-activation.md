# Configured-development acceptance and seed-activation evidence

Evidence originally captured on 2026-07-20 from canonical Exchange SHA
`ccea0f3840e5248bc2eb7f8cfae5e8c3c946f47d`, then extended on PR #19 with
configured-development, seed-review, organization-marker, and optional
administrative marketing-email work. This is a development-only workstream. No
production project, live Stripe object, or `main` branch was modified.

## Current decision

The branch must remain draft. Code-side profile, enrichment, organization seed,
marker, and administrative marketing-email regressions are testable, but the
configured Exchange acceptance cannot pass until the required core callables,
canonical rules, indexes, and Hosting build are reviewed and deployed to
`hi-coworking-plat`.

The privacy-reviewed seed preparation and development dry run completed; the
full seed was not applied because publication permission and human record
approval are not established merely by possessing the source files.

The former SendGrid deployment blocker has been removed. SendGrid and the
inactive Twilio SMS provider are no longer active source providers or deployment
secret bindings. Optional Microsoft 365 administrative marketing email reads its
credential only when an authorized marketing send is attempted, so missing
Microsoft configuration must not block core Exchange deployment or operation.

## Implementation inventory

| Area | Existing implementation | Configured status | Missing work | Planned action |
| --- | --- | --- | --- | --- |
| Readiness | Advisory/strict checker, project guard, Mapbox probe | Both checker modes passed with one alias warning in the original assessment | `default` and `prod` aliases both name the development project | Keep every command explicitly scoped to `hi-coworking-plat`; separate aliases before release |
| Accounts | Idempotent development bootstrap | Five dedicated synthetic roles established | Legacy account remains a read-only diagnostic identity | Keep credentials in protected operator stores; never commit identifiers or passwords |
| Profiles | Strict `profile_update`, schema normalization, browser diagnostic | Required callable was absent during original configured test; direct request returned HTTP 404 | Deploy and run four-account acceptance | Deploy only the reviewed minimum coherent callable set |
| Enrichment | Authenticated search/link callables and profile UI | Both callables were absent during original configured test | Provider and configured browser acceptance | Deploy after configuration review; retain manual-entry fallback |
| Organizations/claims | Search, create, claim, review, audit, notifications | Required callables and current rules were absent during original configured test | Configured mutation acceptance | Deploy the exact organization callable set plus reviewed rules/indexes |
| Seed preparation | Canonical XLSX preparation, verifier, dry-run-first importer | Preparation, privacy verification, projection verification, and live-project dry run passed | Human approval, coordinate publication permission, applied import, idempotency, rollback rehearsal | Use the review queue and approved-only export; do not apply the full set without approval |
| Organization markers | Existing Mapbox instance, stable sources/layers, URL selection | Code-side implementation and scale transform passed | Configured data and real Mapbox/browser measurements | Rerun after approved sample import and canonical Hosting deployment |
| Admin marketing email | App-only Microsoft Graph provider, `adminMarketingEmail` capability, consent/suppression, test/send/idempotency/audit, unsubscribe route | Code implemented; module disabled unless separately configured | Entra app, Mail.Send consent, Application RBAC, mailbox/aliases, Secret Manager, controlled external test, recipient-visible alias verification | Keep independent from core deployment; do not claim acceptance before external evidence |
| CI/browser | Emulator and configured Playwright suites | Local canonical UI reached profile in Chromium and mobile emulation; save failed at missing callable | Configured mutations, Firefox/Safari matrix, accessibility pass | Leave configured/manual gates non-green until deployment blockers are removed |

## Exact development environment from original assessment

- Firebase project: `hi-coworking-plat`
- Functions region: `us-central1`
- Hosting site: `hi-coworking-plat`
- Application URL: `https://hi-coworking-plat.web.app`
- Firestore: `(default)`, Native mode, `nam5`
- Storage bucket: `hi-coworking-plat.firebasestorage.app`, `US-EAST1`
- Deployed Functions inventory observed: 31; required acceptance callables observed: 0
- Deployed composite indexes observed: 55, all `READY`
- Canonical source composite indexes observed: 80; 31 source-only and 6 live-only after normalized comparison
- Browser Firebase project and CLI project both resolved to `hi-coworking-plat`
- Mapbox public token passed the localhost origin and Streets v12 access probe; dashboard restriction policy was not independently inspectable
- Stripe configuration identified test mode; no Stripe write was required or performed
- `.firebaserc` mapped both `default` and `prod` to `hi-coworking-plat`

The GitHub `exchange-development` Environment was established with protected
configured-smoke secret names. Values are not recorded here.

## Dedicated identity matrix

The idempotent bootstrap ran only after exact development-project confirmation.
It established dedicated synthetic identities for:

- ordinary member;
- organization owner;
- unrelated member;
- issuer manager;
- administrative claim reviewer.

Non-administrative workflow identities retain the canonical `member` custom
claim; organization authority must come from server-side membership records.
The bootstrap does not create a Microsoft mailbox, connect a mailbox, grant
member OAuth, or set `adminMarketingEmail`.

The existing legacy super-admin is retained for regression diagnosis only. Its
read-only inventory showed a legacy `master` role/user record with no profile,
profile schema version, or organization identifier. Passwords, emails, UIDs,
and tokens are intentionally omitted.

## Profile acceptance result

The canonical local web build was exercised against configured Auth/Firestore:

1. The ordinary development member authenticated and reached `/exchange`.
2. `/profile` rendered and submitted the canonical save action.
3. The UI reported a callable diagnostic rather than `Saved`.
4. Credential-free `OPTIONS` and minimal `POST` probes to `profile_update`
   returned HTTP 404.
5. The deployed Functions inventory independently confirmed that
   `profile_update` was absent, so there was no Function log or authorization
   decision to inspect.

The live Hosting build redirected a valid login to `/dashboard`, demonstrating
Hosting drift from the canonical Exchange route. Current-schema profile saving
therefore failed because of deployment drift, not because the branch weakened or
bypassed validation. Organization-owner, reviewer, and legacy saves were not
repeated after the shared routing blocker was proven. Emulator regression covers
ordinary null/optional normalization, canonical organization authority, and
controlled legacy schema normalization.

## Enrichment repair and result

The server creates a short-lived, caller-bound enrichment request and persists
the exact server-returned candidate selected by `requestId` and `matchId`.
Browser-supplied candidate objects cannot nominate or overwrite the stored match.
Cross-user, fabricated, expired, and replayed selections fail closed. Provider
status is explicitly `ok`, `not_configured`, or `unavailable`, and manual profile
entry remains available.

Configured enrichment was not accepted because `enrichment_search` and
`enrichment_link` were absent from the project at the time of the configured
probe. No provider call was claimed or executed through a deployed callable.

## Human-readable deployment diff

No deployment was performed by the original acceptance run. The original narrow
Functions dry run stopped during global parameter discovery because the old
source declared SendGrid and Twilio secrets. That evidence is now superseded:
those provider bindings have been removed, and Firebase runs a fresh Functions
build before deployment.

The minimum coherent core deployment remains:

- `profile_update`;
- `enrichment_search`;
- `enrichment_link`;
- `exchange_organizationSearch`;
- `exchange_organizationCreate`;
- `exchange_organizationRequestClaim`;
- `exchange_organizationListMyClaims`;
- `exchange_adminListOrganizationClaims`;
- `exchange_adminGetOrganizationClaim`;
- `exchange_adminReviewOrganizationClaim`;
- reviewed Firestore rules;
- reviewed required indexes;
- Storage rules only where required;
- canonical Hosting after backend smoke tests.

The optional Microsoft marketing callables may be deployed in disabled mode with
no Microsoft secret binding. A marketing send remains unavailable until the
runtime can read the separately configured Secret Manager credential and all
Microsoft tenant/mailbox gates are complete.

Expected downtime is none for new callables. Indexes build asynchronously; rules
and Hosting changes take effect as new releases and require a post-deploy smoke.

## Seed privacy review and dry run

Private source workbooks are gitignored. Four inputs were located:

- Isle of Wight companies workbook;
- Isle of Wight home-business subset;
- cleaned targeting workbook;
- demographic-analysis workbook.

Preparation reads only the allowlisted `Company Details` fields. It does not
ingest executive names, gender, direct phones, financial history, marketing
scores, EINs, or parent-company contact data.

The targeting source contains demographic, military, street, email, phone,
birth-date, and age fields and must remain private. The prepared restricted
projection retains only organization name, city, state, normalized search
tokens, source label, and restriction flags.

Preparation and verification results:

- company source rows: 5,128;
- public-organization candidates: 5,128;
- company duplicate identity groups: 0;
- home-business source rows: 1,903;
- home identities matched and suppressed: 1,324;
- unmatched home identities excluded: 579;
- marker-coordinate candidates after suppression: 3,804;
- list-only home/suppressed organizations: 1,324;
- invalid source coordinates: 0;
- targeting source rows: 3,607;
- targeting rows rejected for no account name: 43;
- normalized targeting duplicate groups: 19 (38 rows);
- duplicate targeting rows suppressed: 19;
- restricted targeting candidates: 3,545;
- public projection forbidden-field violations: 0;
- suppressed precise-location violations: 0;
- fabricated coordinates: 0.

All 5,128 company rows identify Isle of Wight County, Virginia. Source-provided
coordinates are labeled approximate; preparation never geocodes or assigns a
centroid. The protected organization seed may retain source IDs and approved
business contact fields, while `publicOrganizations` excludes source IDs, phones,
owner data, claim evidence, and suppressed precise locations.

The configured-development dry run predicted:

- organizations/public projections: 5,128 creates;
- restricted candidates: 3,545 creates;
- updates, skips, duplicates, and invalid rows: zero.

No seed write, configured replay, snapshot, or rollback rehearsal was performed.
The full dataset requires the administrative review queue, approved-only export,
coordinate publication decisions, a bounded sample import, no-op replay, and
rollback rehearsal before full application.

## Organization marker implementation

The existing Mapbox instance has a separate privacy-minimized organization
GeoJSON source, clusters/counts/points/labels, selected overlay, marker/card/detail
synchronization, URL selection, bounded 500-record Firestore pages capped at
10,000, module-level request reuse, and stale-result supersession.

Home-based, privacy-suppressed, inactive, hidden, deleted, missing-coordinate,
non-finite, and out-of-range records remain list-only or excluded and never
receive fabricated markers.

Pure transform-and-serialize measurements from the original run were:

| Records | Elapsed | Payload |
| ---: | ---: | ---: |
| 100 | 0.35 ms | 34,716 bytes |
| 1,000 | 1.32 ms | 349,775 bytes |
| 10,000 | 12.70 ms | 3,527,536 bytes |

These do not prove Firestore latency, network transfer, Mapbox worker processing,
first render, mobile memory, frame behavior, or native Safari acceptance.

## Administrative Microsoft marketing email

The active implementation is documented in
`docs/exchange/microsoft-admin-marketing-email.md`.

Key boundaries:

- one centrally controlled Microsoft 365 mailbox;
- application-only Microsoft Graph `Mail.Send`;
- Exchange Online Application RBAC to scope the app to the mailbox;
- server-controlled sender aliases and Reply-To addresses;
- explicit `adminMarketingEmail` custom claim, with master override;
- no implicit access for ordinary admins, review admins, staff, organization
  owners, or members;
- no delegated member OAuth, mailbox linking, member compose, or mailbox creation;
- explicit subscribed status plus recorded source/evidence;
- unsubscribe, suppression, bounce, administrator exclusion, and development
  allowlist enforcement;
- safe plain-text-to-HTML rendering;
- per-send and hourly recipient limits;
- recipient-count confirmation and idempotent campaign claiming;
- bounded audit metadata;
- optional runtime Secret Manager lookup only during send;
- no SMS provider implementation.

Microsoft email is not accepted yet. No Entra tenant configuration, application
consent, mailbox scope, alias setting, client credential, controlled test send, or
recipient-visible alias verification was performed by this branch.

## Browser and accessibility

Original configured results:

- Chromium desktop: login/navigation passed; profile save failed at absent callable.
- iPhone 14 browser emulation: login/navigation passed; profile save failed at the same callable.
- configured mutation cases were intentionally skipped;
- emulator Chromium passed the existing organization/profile scenarios and five responsive sizes;
- the Opportunity Discovery browser runner skipped without configured preview/Mapbox/fixture opt-in;
- Firefox, native Safari, configured five-viewport matrix, configured cross-mode company acceptance, and configured accessibility were not accepted.

## Validation and merge decision

PR workflows must be evaluated on the final head SHA. Source builds and emulator
suites do not substitute for configured deployment acceptance or Microsoft tenant
acceptance.

PR #19 must remain draft until the larger configured-development gates in its PR
description are resolved. Removing SendGrid resolves a deployment dependency but
does not itself prove profile, enrichment, organization, seed, marker, browser,
accessibility, or Microsoft email acceptance.

No production deployment, production import, production migration, live Stripe
write, referral payout, member mailbox connection, or `main` modification was
performed.
