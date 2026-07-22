# Organization activation and continuity configured acceptance

## Scope and result

Configured acceptance ran only against Firebase project `hi-coworking-plat`,
Functions region `us-central1`, and canonical Hosting
`https://hi-coworking-plat.web.app` on 2026-07-22. The final deployed web code is
commit `f3c55f9`; backend code is `c54c0cd443b1800af7de602a9e7091b6c06613e3`.
No production, seed-import, Stripe, mail, social, or merge action occurred.

Applicable organization lifecycle, actor/subject authorization, external
projection privacy, cross-mode map/search/drawer continuity, history/refresh,
mobile layout, automated accessibility, and cleanup gates passed. Organization
seed browsing remains inapplicable and blocked because human-approved count is
zero. Populated long-list scroll, configured draft submission, and native
Safari/VoiceOver remain explicit depth/manual follow-ups rather than claimed
evidence.

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

Final result: **7/7 passed** in 2.2 minutes.

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
an external claimed non-resource organization, active memberships, public and
private records, and an actor preference. It verified:

- owner self projection is `self` / `private_owner`;
- actor A remains selected while external subject B is viewed;
- external subject B is `external_claimed` / `public_claimed`;
- private external billing, internal-note, owner, and capability-gap sentinels
  never appear in DOM or captured callable responses;
- the same single persistent map host stays connected through Opportunities,
  Referrals, Intelligence, Resources, and return to Opportunities;
- Resources keeps the non-provider external organization as context rather
  than a resource result;
- all four mounted mode search controls retain the workspace query;
- actor, subject, query, drawer, camera coordinates, and zoom remain in URL;
- hard refresh, Back, and Forward restore actor and subject;
- no horizontal document overflow at each viewport;
- axe reports no critical or serious WCAG 2 A/AA/2.1 AA violations;
- removing the actor membership causes safe individual fallback after refresh;
  and
- the external subject remains selected/public after actor authority loss.

The first configured browser attempt found that Hosting rewrote `/login` to the
root export. `cleanUrls: true` fixed that route. The next attempt exposed a
strict-payload bug: an absent secondary subject was serialized as `null`; the
client now omits absent optional fields and keeps the server schema strict. The
matrix also found and corrected one serious low-contrast “Active” label. The
final seven-project run used the corrected deployed bytes.

Each browser fixture ran `finally` cleanup with exact marker checks and Auth-
first deletion. The independent post-suite audit returned:

```json
{"orgs":0,"publicOrganizations":0,"orgMembers":0,"users":0,"exchangeWorkspacePreferences":0,"fixtureAuthUsers":0}
```

## Additional live evidence

- All 43 selected workstream callables inventory as `ACTIVE`.
- Auth-required representative endpoints return 401 rather than ingress 403.
- Anonymous empty directory query returns 200 after its index became ready.
- All 88 composite indexes inventory as `READY`.
- Firestore and Storage rule deployments compiled and released.
- The in-app browser smoke opened live `/exchange` and observed the correct
  guarded sign-in surface (`Welcome back` and the Exchange sign-in copy).
- Authoritative territory `51093` is released; its replay was a no-op and its
  rollback rehearsal reported ready without applying a rollback.

## Remaining non-claims

- No approved seed organization exists, so no sample or expanded organization
  seed import, organization seed replay, organization seed rollback, or seeded
  marker browser scenario is claimed.
- No populated configured long-list fixture was used to measure scroll
  restoration.
- No configured referral draft was submitted; draft preservation has strong
  reducer/session/source evidence only.
- Automated WebKit is not a substitute for a native Safari/VoiceOver manual
  release pass.
- The branch is stacked and unmerged; this is development acceptance, not
  production readiness.
