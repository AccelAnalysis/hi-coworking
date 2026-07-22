# Organization and context deployment

## Recorded configured-development release

The workstream was deployed only to Firebase project `hi-coworking-plat` in
`us-central1` on 2026-07-22. Production was not targeted. Every Firebase command
named the project explicitly, and every Function deployment used explicit
selectors; no broad `functions` deployment, `--force`, deletion acceptance, or
legacy Function replacement occurred.

The backend packages were built from `c54c0cd443b1800af7de602a9e7091b6c06613e3`.
The final web artifact, including clean-route handling, strict optional callable
payloads, and the accessibility contrast correction, was built and deployed
from committed code at `f3c55f9`.

## Exact Function packages

`scripts/core-functions-package.mjs` produced an exact package containing four
existing reviewed core endpoints and 14 new organization/context endpoints.
Only the 14 new endpoints were selected for deployment:

- `exchange_organizationSearch`
- `exchange_organizationCreate`
- `exchange_organizationRequestClaim`
- `exchange_organizationListMyClaims`
- `exchange_adminListOrganizationClaims`
- `exchange_adminGetOrganizationClaim`
- `exchange_adminReviewOrganizationClaim`
- `exchange_listActorOrganizations`
- `exchange_resolveOrganizationPerspective`
- `exchange_organizationDirectory`
- `exchange_saveOrganization`
- `exchange_requestOrganizationContact`
- `exchange_requestOrganizationIntroduction`
- `exchange_getOrganizationResourceStatus`

`scripts/exchange-workstream-functions-package.mjs` discovered and hashed the
complete compiled dependency closure before staging. Its exact 29-callable
supplemental selector set was:

- 16 `businessReferral_*` callables
- 5 `referralIntelligence_*` callables
- 6 `referralServiceOffer_*` callables
- `rfx_listManaged`
- `territory_list_released`

Both packages used exact manifests, production dependency manifests, staged
file inventories, and per-file hashes. Each compiled closure contained 15
files. Payment, Stripe, events, marketing, scheduled, trigger, social, and mail
surfaces were absent. Dry-run review preceded each deployment.

## Live inventory

Post-deployment inventory found all 43 selected callables `ACTIVE`, Gen 2, and
Node 20. The 14 organization/context revisions are:

| Function | Revision |
| --- | --- |
| `exchange_organizationSearch` | `exchange-organizationsearch-00001-fub` |
| `exchange_organizationCreate` | `exchange-organizationcreate-00001-vez` |
| `exchange_organizationRequestClaim` | `exchange-organizationrequestclaim-00001-tip` |
| `exchange_organizationListMyClaims` | `exchange-organizationlistmyclaims-00001-riy` |
| `exchange_adminListOrganizationClaims` | `exchange-adminlistorganizationclaims-00001-jax` |
| `exchange_adminGetOrganizationClaim` | `exchange-admingetorganizationclaim-00001-koh` |
| `exchange_adminReviewOrganizationClaim` | `exchange-adminrevieworganizationclaim-00001-xoq` |
| `exchange_listActorOrganizations` | `exchange-listactororganizations-00001-xip` |
| `exchange_resolveOrganizationPerspective` | `exchange-resolveorganizationperspective-00001-lix` |
| `exchange_organizationDirectory` | `exchange-organizationdirectory-00001-cuz` |
| `exchange_saveOrganization` | `exchange-saveorganization-00001-hip` |
| `exchange_requestOrganizationContact` | `exchange-requestorganizationcontact-00001-wus` |
| `exchange_requestOrganizationIntroduction` | `exchange-requestorganizationintroduction-00001-veb` |
| `exchange_getOrganizationResourceStatus` | `exchange-getorganizationresourcestatus-00001-hoq` |

Representative unauthenticated HTTP probes reached the callable handlers and
returned 401 rather than Cloud Run ingress 403. After index readiness,
`exchange_organizationDirectory` returned HTTP 200 for an anonymous empty
query. No existing Function was deleted or unexpectedly redeployed.

## Rules, indexes, Storage, and Hosting

- Firestore index deployment completed without `--force`. The source set plus
  six preserved live-only composites produced 88 live indexes, all `READY`.
- Firestore rules dry-run/compile and release completed. The compiler reported
  unused-helper warnings and two invalid names inside unused helpers; these did
  not prevent release and remain a cleanup follow-up.
- Storage rules dry-run/compile and release completed.
- Hosting built 59 static routes / 605 exported files and released to
  `https://hi-coworking-plat.web.app`.
- `cleanUrls: true` was required because the initial SPA rewrite served the
  root export for `/login`; the corrected route now serves the login artifact.
- The final Hosting deployment was rebuilt from committed code `f3c55f9`.

## Configured acceptance and data effects

The guarded lifecycle test exercised the live lifecycle endpoints and removed
all synthetic Auth/Firestore fixtures. The guarded seven-project browser suite
exercised the live perspective, actor-list, directory, map, URL/history, and
revocation paths, then also removed all fixtures. Independent post-run audits
returned zero matching records/users.

The official Isle of Wight County territory was the only persistent data write:
`territories/51093` remains released. Its protected rollback artifact was
created before apply, replay was a no-op, and rollback rehearsal was read-only.
No organization seed record was imported because human-approved count is zero.

## Rollback and follow-up

Rollback inputs are the prior reviewed commit/artifacts, prior rules and
Storage definitions, preserved Hosting history, explicit Function selectors,
and the protected territory rollback manifest. Index deletion remains excluded
from automatic rollback.

Node 20 is scheduled for deprecation on 2026-04-30 and decommission on
2026-10-30 according to the deployment warning, and the repository's
`firebase-functions` dependency is behind the current release. Runtime/dependency
upgrade and Firestore helper-warning cleanup should be handled in a separate,
reviewed workstream. No production, Stripe, mail, social, seed, or merge action
is recorded here.
