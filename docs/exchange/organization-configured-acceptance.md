# Organization establishment and contact-routing configured acceptance

## Business-registration/map-activation extension (pending live rerun)

The extension begins at PR #22 head `a368d4d0b33df0d1382c0d107623f04d33ae0e04`. Local shared, Functions, and 59-page web builds pass after adding business-only registration, authoritative activation state, private actor location projections, exact issuer filtering, the workspace control layer, and the close 3D activation camera.

The configured Playwright matrix now additionally asserts one connected Map dimension group, in-viewport 2D/3D bounding boxes, successful center-point hit testing, 3D/2D state transitions, control-node continuity through all four views, no horizontal overflow, and a screenshot per project:

| Project | Viewport | Expected control position |
| --- | --- | --- |
| Chromium | 1280×800 | top/right safe-area inset; drawer-aware desktop right offset |
| Chromium | 1440×900 | top/right safe-area inset; drawer-aware desktop right offset |
| Firefox | 1280×800 | top/right safe-area inset; drawer-aware desktop right offset |
| Desktop WebKit | 1440×900 | top/right safe-area inset; drawer-aware desktop right offset |
| Mobile WebKit | 390×844 | top/right safe-area inset above bottom drawer |
| Mobile WebKit | 393×852 | top/right safe-area inset above bottom drawer |
| Mobile WebKit | 430×932 | top/right safe-area inset above bottom drawer |

Do not read the historical 7/7 result below as evidence for these new assertions. The extension’s live deployment, exact test totals, screenshot artifact paths, and post-run cleanup audit must be appended after the reviewed development deployment.

## Establishment/contact-routing extension

Configured acceptance covers single-location, multi-location, home-based,
external-contact, authority-revocation, and enrichment-proposal scenarios. The
live owner journey used Census geocoding, keyboard candidate selection, map
preview, independent private-address/public-coordinate decisions,
establishment refresh and edit, private email/telephone creation and email
edit, referral and opportunity routes, explicit enrichment decisions, and
database/public-projection evidence.

The browser matrix is Chromium 1280×800 and 1440×900, Firefox, desktop WebKit,
and mobile WebKit 390×844, 393×852, and 430×932. Automated accessibility covers
keyboard operation, accessible status/error surfaces, Axe, and horizontal-
overflow checks. Native VoiceOver remains a manual release gate.

The workstream began at exact PR #19 head
`8e94efde96a85b7154b33a34cb8a7e26bfb9ea49` after PR #21 was reviewed, made
ready, and merged into the PR #19 branch. PR #3 and `main` were not changed.

## Scope and result

Configured acceptance ran only against Firebase project `hi-coworking-plat`,
Functions region `us-central1`, and canonical Hosting
`https://hi-coworking-plat.web.app` on 2026-07-22. The exact isolated deployment
package contained 21 reviewed endpoints and 18 compiled Function files. All 21
are active Gen 2 Node.js 20 Functions; the complete regional inventory is 87/87
active. No unexpected Function deletion occurred.

Firestore rules and five new composite indexes were deployed; the complete
index inventory is 93/93 `READY`. Hosting serves `/org/settings` with HTTP 200,
and the new enrichment-review callable answers preflight with HTTP 204. Storage
rules were reviewed but unchanged, so there was no Storage deployment in this
extension. No production, real seed-import, Stripe, mail, social, PR #3, or
`main` action occurred.

Applicable organization lifecycle, actor/subject authorization, external
projection privacy, cross-mode map/search/drawer continuity, history/refresh,
mobile layout, automated accessibility, and cleanup gates passed. Organization
seed activation remains blocked because both the human-approved and imported
counts are zero. Native Safari/VoiceOver remains the sole manual accessibility
gate rather than claimed evidence.

## Configured lifecycle journey

Reproducible guarded command:

```bash
GCLOUD_PROJECT=hi-coworking-plat \
EXCHANGE_DEV_ORGANIZATION_LIFECYCLE=true \
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
node --test tests/functions/exchange-organization-lifecycle.configured.cjs
```

Result: **1/1 passed** in 32.4 seconds. The test created four uniquely named
`@example.test` users carrying `developmentTestPurpose`, two explicit unclaimed
claim fixtures, one canonical created organization, and one restricted direct-
access fixture. It verified:

- canonical creation as an ordinary user;
- idempotent create retry;
- private `orgs` and approved public projection split;
- exact active owner membership;
- free Exchange membership and zero-credit account, with no adjacent grant;
- public search discovery without source provenance;
- claim submission and caller-only list;
- admin pending list and detail;
- rejection and idempotent rejection retry;
- two competing claims, one approval, and automatic rejection of the other;
- independent `verificationStatus: unverified` after claim approval;
- no publication of address, postal code, or coordinates;
- self `private_owner` perspective after approval;
- direct external reads: private org 403, restricted candidate 403, claim
  review 403, approved public projection 200;
- membership status transition to `removed`;
- immediate actor-list fallback to individual;
- post-revocation perspective downgraded to `public_claimed`; and
- post-revocation actor-scoped mutation returned `PERMISSION_DENIED`.

The test deletes Auth users first, validates exact fixture identity before every
cleanup, then removes only enumerated synthetic documents and actor/audit rows.
An independent audit returned:

```json
{"orgs":0,"publicOrganizations":0,"orgMembers":0,"organizationSourceCandidates":0,"fixtureAuthUsers":0}
```

## Configured cross-mode browser journey

Reproducible guarded command:

```bash
EXCHANGE_DEV_BASE_URL=https://hi-coworking-plat.web.app \
EXCHANGE_DEV_ORGANIZATION_CONTINUITY=true \
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
npx playwright test \
  --config=playwright.config.development.ts \
  tests/browser/exchange-organization-continuity-configured.spec.ts \
  --workers=1 --reporter=line
```

Final clean result: **7/7 passed** in 3.0 minutes.

| Project | Viewport/device | Result |
| --- | --- | --- |
| configured-development-chromium | Chromium 1280×800 | Passed |
| configured-development-chromium-large | Chromium 1440×900 | Passed |
| configured-development-firefox | Firefox 1280×800 | Passed |
| configured-development-safari | desktop WebKit/Safari 1440×900 | Passed |
| configured-development-mobile-safari | iPhone/WebKit 390×844 | Passed |
| configured-development-mobile-safari-393 | iPhone/WebKit 393×852 | Passed |
| configured-development-mobile-safari-430 | iPhone Pro Max/WebKit 430×932 | Passed |

Every project created two marked synthetic users, an actor/self organization,
an external claimed non-resource organization, five establishment types,
public and private contact points, a referral route, active memberships, and an
actor preference. The Chromium project additionally exercised the full owner
management workflow. Collectively the matrix verified:

- owner self projection is `self` / `private_owner`;
- actor A remains selected while external subject B is viewed;
- external subject B is `external_claimed` / `public_claimed`;
- private external billing, internal-note, owner, and capability-gap sentinels
  never appear in DOM or captured callable responses;
- the same single persistent map host stays connected through Opportunities,
  Referrals, Intelligence, Resources, and return to Opportunities;
- selecting an establishment preserves the organization as Subject and the
  establishment as Secondary Subject through all four modes;
- one organization card represents multiple establishments while only approved
  physical coordinates become markers;
- mailing-only and private-home locations never create exact public markers;
- the owner can search live bounded geocodes, confirm and edit an establishment,
  and separately decide address and coordinate publication;
- email and telephone contacts can be entered and edited with explicit
  visibility, and referral/opportunity routes persist;
- private contact destinations are absent from external DOM and callable
  responses while a contact request resolves through the configured route;
- address/contact enrichment remains private proposal data until an explicit
  owner classification, does not replace organization identity or primary
  location, and does not publish without separate approval;
- Resources keeps the non-provider external organization as context rather
  than a resource result;
- all four mounted mode search controls retain the workspace query;
- actor, subject, query, drawer, camera coordinates, and zoom remain in URL;
- hard refresh, Back, and Forward restore actor and subject;
- no horizontal document overflow at each viewport;
- axe reports no critical or serious WCAG 2 A/AA/2.1 AA violations;
- an unsaved establishment draft is not submitted after membership removal;
- removing the actor membership causes safe individual fallback after refresh;
  and
- the external subject remains selected/public after actor authority loss.

This extension's configured passes found and corrected a success-notice race,
strict undefined payload/writes, WebKit Secondary Subject loss during mode
switching, and a mobile WebKit router-navigation race. The final matrix used the
corrected deployed bytes and a clean synthetic baseline.

Each browser fixture ran `finally` cleanup with exact marker checks and Auth-
first deletion. The independent post-suite audit returned:

```json
{"fixtureDocs":0,"fixtureAuthUsers":0,"organizationSeedImports":0,"humanApprovedSourceCandidates":0}
```

## Additional live evidence

- The exact 21-endpoint establishment package regenerated with 18 compiled
  Function files and matching content hashes, then was safely removed.
- All 21 selected endpoints inventory as active Gen 2 Node.js 20; all 87
  regional Functions inventory as `ACTIVE`.
- All 93 composite indexes inventory as `READY`.
- The new enrichment-review endpoint returned HTTP 204 to `OPTIONS`; canonical
  Hosting returned HTTP 200 for `/org/settings`.
- Firestore rules compiled and released. Storage rules remain unchanged.
- Automated totals are 120 security/rules/functions/migrations, 132 Exchange,
  16 establishment/geocode/contact/route, 31 development-readiness/seed, 37 Run
  3, and 34 Run 4 tests, all passing. Lint has zero errors and five unrelated
  pre-existing warnings; the production build generated 59/59 static pages.
- Authoritative territory `51093` is released; its replay was a no-op and its
  rollback rehearsal reported ready without applying a rollback.

## Remaining non-claims

- No approved seed organization exists, so no sample or expanded organization
  seed import, organization seed replay, organization seed rollback, or seeded
  marker browser scenario is claimed.
- Automated WebKit is not a substitute for a native Safari/VoiceOver manual
  release pass.
- Node.js 20 and the currently pinned Firebase Functions SDK have lifecycle
  warnings that belong in a bounded dependency-runtime follow-up.
- The branch remains stacked and unmerged; this is configured development
  acceptance, not production readiness.
