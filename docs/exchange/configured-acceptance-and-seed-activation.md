# Configured-development acceptance and seed-activation evidence

Evidence captured on 2026-07-20 from canonical Exchange SHA
`ccea0f3840e5248bc2eb7f8cfae5e8c3c946f47d`. This is a development-only
workstream. No production project, live Stripe object, or `main` branch was
modified.

## Decision

The branch must remain draft. Code-side profile, enrichment, organization seed,
and marker regressions are testable, but configured acceptance cannot pass while
the required callables, canonical rules, indexes, and Hosting build are absent
from `hi-coworking-plat`. The privacy-reviewed seed preparation and development
dry run completed; the seed was not applied because publication permission and
human record approval are not established by the source files.

## Implementation inventory

| Area | Existing implementation | Configured status | Missing work | Planned action |
| --- | --- | --- | --- | --- |
| Readiness | Advisory/strict checker, project guard, Mapbox probe | Both checker modes pass with one alias warning | `default` and `prod` aliases both name the development project | Keep every command explicitly scoped to `hi-coworking-plat`; separate aliases before release |
| Accounts | Idempotent development bootstrap | Five dedicated synthetic roles established | Legacy account remains a read-only diagnostic identity | Keep credentials in protected operator stores; never commit identifiers or passwords |
| Profiles | Strict `profile_update`, schema normalization, browser diagnostic | Required callable is not deployed; direct request returns HTTP 404 | Deploy and run four-account acceptance | Deploy only the named callable after the configuration gate is clear |
| Enrichment | Authenticated search/link callables and profile UI | Both callables are not deployed | Provider and configured browser acceptance | Deploy after configuration; retain manual-entry fallback |
| Organizations/claims | Search, create, claim, review, audit, notifications | Required callables and current rules are not deployed | Configured mutation acceptance | Deploy the exact organization callable set plus reviewed rules/indexes |
| Seed preparation | Canonical XLSX preparation, verifier, dry-run-first importer | Preparation, privacy verification, projection verification, and live-project dry run pass | Human approval, coordinate publication permission, applied import, idempotency, rollback rehearsal | Do not apply until approval; use a unique reviewed batch ID |
| Organization markers | Existing Mapbox instance, stable sources/layers, URL selection | Code-side implementation and scale transform pass | Configured data, real Mapbox clustering/browser measurements | Re-run on deployed Hosting after approved seed import |
| CI/browser | Emulator and configured Playwright suites | Local canonical UI reaches profile in Chromium and Mobile Safari; save fails at missing callable | Configured mutations, Firefox/Safari matrix, accessibility pass | Leave workflow/manual gates non-green until deployment blockers are removed |

## Exact development environment

- Firebase project: `hi-coworking-plat`
- Functions region: `us-central1`
- Hosting site: `hi-coworking-plat`
- Application URL: `https://hi-coworking-plat.web.app`
- Firestore: `(default)`, Native mode, `nam5`
- Storage bucket: `hi-coworking-plat.firebasestorage.app`, `US-EAST1`
- Deployed Functions inventory: 31; required acceptance callables deployed: 0
- Deployed composite indexes: 55, all `READY`
- Canonical source composite indexes: 80; 31 source-only and 6 live-only after normalized comparison
- Browser Firebase project and CLI project both resolve to `hi-coworking-plat`
- Mapbox: public `pk.` token passed the localhost origin and Streets v12 access probe; dashboard restriction policy was not independently inspectable
- Stripe: configured secret identifies test mode; no Stripe write is required or performed
- Firebase alias warning: `.firebaserc` maps both `default` and `prod` to `hi-coworking-plat`

The GitHub `exchange-development` Environment was established with the required
configured-smoke secret names. Values are protected and are not recorded here.

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
The existing legacy super-admin is retained for regression diagnosis only. Its
read-only inventory shows a legacy `master` role/user record with no profile,
profile schema version, or organization identifier. Passwords, emails, UIDs,
and tokens are intentionally omitted.

## Profile acceptance result

The canonical local web build was exercised against configured Auth/Firestore:

1. The ordinary development member authenticated and reached `/exchange`.
2. `/profile` rendered and submitted the canonical save action.
3. The UI reported a callable diagnostic rather than `Saved`.
4. Credential-free `OPTIONS` and minimal `POST` probes to `profile_update`
   returned HTTP 404.
5. The deployed Functions inventory independently confirms that
   `profile_update` is absent, so there is no Function log or authorization
   decision to inspect.

The live Hosting build redirected a valid login to `/dashboard`, demonstrating
Hosting drift from the canonical Exchange route. Current-schema profile saving
therefore fails because of deployment drift, not because the branch weakened or
bypassed validation. Organization-owner, reviewer, and legacy saves were not
repeated after the shared routing blocker was proven. Emulator regression covers
ordinary null/optional normalization, canonical organization authority, and
controlled legacy schema normalization.

## Enrichment repair and result

The server now creates a short-lived, caller-bound enrichment request and
persists the exact server-returned candidate selected by `requestId` and
`matchId`. Browser-supplied candidate objects cannot nominate or overwrite the
stored match. Cross-user, fabricated, expired, and replayed selections fail
closed. Provider status is explicitly `ok`, `not_configured`, or `unavailable`,
and manual profile entry remains available.

Configured enrichment is not accepted because `enrichment_search` and
`enrichment_link` are absent from the project. The SAM.gov secret name is
configured, but no provider call was claimed or executed through a deployed
callable.

## Human-readable deployment diff

No deployment was performed. A narrow Functions dry run stopped before a write
because global parameter discovery requires `SENDGRID_API_KEY`, which is not
configured. Other absent parameter names are Twilio, LinkedIn, and X integration
settings; none were fabricated.

| Resource | Current configured version | Proposed source version | Write impact | Rollback |
| --- | --- | --- | --- | --- |
| `profile_update` | Absent | Branch Functions source, `us-central1` | New callable; profile writes only after authenticated requests | Delete the new Function in `us-central1` if rollback is required |
| `enrichment_search`, `enrichment_link` | Absent | Branch Functions source, `us-central1` | New cache/request/profile/audit writes after authenticated requests | Delete new Functions; retain audit/profile data for governed cleanup |
| Four `exchange_organization*` callables | Absent | Canonical organization source, `us-central1` | New governed organization/claim writes | Delete new Functions; do not delete claimed records blindly |
| Three `exchange_admin*OrganizationClaim*` callables | Absent | Canonical organization source, `us-central1` | Admin-only claim review, membership, notification, and audit writes | Delete new Functions; reverse ownership only through reviewed migration |
| Firestore rules | Ruleset `c3f7dd07-66d3-46a0-b29d-57d2f86f1cc5`, updated 2026-07-07; 14,943 bytes | `firestore.rules`, SHA-256 `fc30b919…`, 34,243 bytes | Immediate authorization change; adds canonical organization/public projections and later security boundaries | Restore the recorded ruleset after emulator and diff review |
| Storage rules | Ruleset `1b2c2e04-bf2f-4cf4-9222-59a4e32949f4`, updated 2026-02-16; 2,427 bytes | `storage.rules`, SHA-256 `4dd3c5f5…`, 10,454 bytes | Immediate authorization change | Restore the recorded ruleset after emulator and diff review |
| Firestore indexes | 55 ready | 80 source definitions; 31 missing, 6 live-only | Asynchronous index builds; broad deployment could remove live-only indexes | Create only reviewed required indexes or restore deleted definitions |
| Hosting | Deployed build routes successful login to `/dashboard` | Canonical branch routes successful login to `/exchange` | Static Hosting release replacement | Roll back to the prior Hosting release |

The exact intended Functions selection is:

`profile_update`, `enrichment_search`, `enrichment_link`,
`exchange_organizationSearch`, `exchange_organizationCreate`,
`exchange_organizationRequestClaim`, `exchange_organizationListMyClaims`,
`exchange_adminListOrganizationClaims`,
`exchange_adminGetOrganizationClaim`, and
`exchange_adminReviewOrganizationClaim`.

Expected downtime is none for new callables. Indexes build asynchronously; rules
and Hosting changes take effect as new releases and require a post-deploy smoke.

## Seed privacy review and dry run

Private source workbooks are gitignored. Four inputs were located:

- Isle of Wight companies workbook;
- Isle of Wight home-business subset;
- cleaned targeting workbook;
- demographic-analysis workbook.

The company workbooks also contain financial-history and executive/contact
sheets. Preparation reads only the allowlisted `Company Details` fields and does
not ingest executive names, gender, direct phones, financial history, marketing
scores, EINs, or parent-company contact data.

The targeting source contains 3,607 rows and 22 columns, including demographic,
military, street, email, phone, birth-date, and age fields. The demographic
analysis reports 3,549 Virginia records and 27 records classified to Isle of
Wight County, and also contains row-level data-quality examples. Both files must
remain private. The prepared restricted projection retains only organization
name, city, state, normalized search tokens, source label, and restriction flags.

Preparation and verification results:

- company source rows: 5,128;
- public-organization candidates: 5,128;
- company duplicate identity groups: 0;
- home-business source rows: 1,903;
- home identities matched and suppressed: 1,324;
- unmatched home identities excluded because no company record exists: 579;
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
coordinates are labeled `approximate`; the preparation step never geocodes or
assigns a centroid. The protected organization seed may retain source IDs and
approved business contact fields, while `publicOrganizations` excludes source
IDs, phones, owner data, claim evidence, and suppressed precise locations.

Configured-development dry run (`apply: false`) completed in 8.8 seconds:

| Collection path | Creates | Updates | Skips | Duplicates | Invalid |
| --- | ---: | ---: | ---: | ---: | ---: |
| `orgs` plus public projection | 5,128 | 0 | 0 | 0 | 0 |
| restricted source candidates | 3,545 | 0 | 0 | 0 | 0 |

No development import was applied. Consequently, configured idempotency and
rollback were not executed; unit coverage proves dry-run safety and no-op replay
after an applied fixture import. Applying this real dataset remains gated on
human record approval and confirmation that its source coordinates may be
published in a publicly readable development projection.

## Organization marker implementation and scale evidence

The existing Mapbox map now has a distinct organization GeoJSON source,
clustering/count/point/label layers, a selected-item overlay, and feature-state
selection. The canonical opportunity result list includes public organization
cards and a privacy-minimized detail panel. Selection is synchronized through
the existing URL/workspace reducer. Bounded 500-record pages cap the public
projection at 10,000 records; organization data is not queried during pan/zoom.

Home-based, privacy-suppressed, inactive, missing-coordinate, non-finite, and
out-of-range records never produce a marker. They remain eligible for list/search
when otherwise active. Marker properties contain only ID, name, city/state,
territory, claim/verification state, and coordinate confidence.

Pure transform-and-serialize measurements on this machine:

| Organizations | Elapsed | GeoJSON payload |
| ---: | ---: | ---: |
| 100 | 0.35 ms | 34,716 bytes |
| 1,000 | 1.32 ms | 349,775 bytes |
| 10,000 | 12.70 ms | 3,527,536 bytes |

The regression guard is 500 ms and fewer than 400 serialized bytes per marker.
These are code-side projection measurements, not claims about Mapbox worker
clustering, map-ready time, memory, Mobile Safari responsiveness, or configured
network latency. Those measurements remain blocked by deployment and approved
configured data.

## Browser evidence and artifact privacy

The configured browser test disables Playwright traces because traces retain
Firebase bearer headers. An earlier trace capture was removed to the local Trash
and is recoverable there; no trace is committed or attached. Sanitized evidence
contains Function name, response status, and failure class only.

Against the local canonical UI plus configured Firebase:

- Chromium desktop: login/Exchange/profile navigation passed; profile save failed at the absent callable;
- Mobile Safari emulation (iPhone 14): navigation retry repaired an app-router interruption; profile save then failed at the same absent callable;
- mutation tests: skipped because mutation mode was intentionally disabled;
- Firefox and native Safari: not accepted;
- configured accessibility and five-viewport matrix: not accepted;
- live Hosting: valid login redirected to stale `/dashboard`.

No configured organization creation, claim review, company-based cross-mode,
marker/list synchronization, or accessibility success is claimed.

Against the fully local Firebase emulator suite, two Chromium browser scenarios
passed. A new ordinary user created an organization, received the canonical
owner membership and free commercial records, saved a current-schema profile,
and retained `/exchange`. A separate claimant submitted a seeded-company claim;
a synthetic legacy `master` reviewer approved it; ownership and audit records
were verified; and that legacy reviewer's profile was normalized to schema 2 on
save. The responsive capture loop exercised 390×844, 393×852, 430×932,
1280×800, and 1440×900. These synthetic emulator results do not substitute for
configured-development acceptance.

The Opportunity Discovery browser runner was also invoked, but all 15 scenarios
correctly skipped because its preview/Mapbox/fixture opt-in was not supplied.
No browser, cross-mode, or accessibility pass is inferred from skipped tests.

## Automated validation summary

The final source validation sequence recorded these passing results (some
focused suites intentionally exercise overlapping contracts):

| Command or scope | Result |
| --- | --- |
| Shared, Functions, and web builds | Pass |
| Lint | 0 errors; 6 existing non-blocking warnings |
| `test:exchange` | 11 files; 96 tests passed |
| `test:development-readiness` | 12 tests passed |
| `test:week1-org` | 15 Node tests plus 8 Vitest tests passed |
| `test:security` | 10 files; 92 tests passed |
| `test:run3` | 7 files; 35 tests passed |
| `test:run4` | 5 files; 34 tests passed |
| `test:migrations` | 3 files; 24 tests passed |
| `test:opportunity-discovery` | 14 Node tests, 9 Vitest tests, 67 static checks, and 27-index validation passed |
| Emulator-backed organization browser acceptance | 2 tests passed |
| Configured-development browser acceptance | 2 profile scenarios failed at the absent callable; 4 mutation scenarios skipped |
| Opportunity Discovery browser acceptance | 15 scenarios skipped because the explicit configured-preview opt-in was absent |

Seed verification passed for 5,128 organization candidates and 3,545
restricted matching candidates. The configured dry run remained non-mutating.
The exact marker transform figures are recorded above; no Mapbox-worker or
browser-performance claim is made from that pure transform benchmark.

## Remaining gates

1. Configure the missing deployment parameters or separate unrelated parameter
   discovery so the narrow callable deployment can be planned and executed.
2. Review the full rules and index drift before deploying; do not delete the six
   live-only indexes accidentally.
3. Obtain explicit human approval and coordinate-publication confirmation for
   the prepared development seed.
4. Deploy only to `hi-coworking-plat`, apply the approved seed under a unique
   batch ID, re-run for idempotency, and rehearse rollback.
5. Create the configured organization-state fixture matrix through the deployed
   canonical callables.
6. Complete current-schema, owner, reviewer, and legacy profile acceptance;
   enrichment; organization creation/claims; cross-mode; browser; responsive;
   accessibility; and full marker-performance acceptance.
