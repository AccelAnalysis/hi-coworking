# Organization and context deployment

Deployment is development-only and must target exactly `hi-coworking-plat` in
`us-central1`. The source package is prepared for deployment, but no deployment
record is claimed by this document.

## Narrow Function package

`apps/functions/src/coreFirebaseEntry.ts` and
`scripts/core-functions-package.mjs` define the reviewed narrow package. It
contains the four existing account/profile/enrichment endpoints plus these 14
organization/context endpoints:

- `exchange_organizationSearch`;
- `exchange_organizationCreate`;
- `exchange_organizationRequestClaim`;
- `exchange_organizationListMyClaims`;
- `exchange_adminListOrganizationClaims`;
- `exchange_adminGetOrganizationClaim`;
- `exchange_adminReviewOrganizationClaim`;
- `exchange_listActorOrganizations`;
- `exchange_resolveOrganizationPerspective`;
- `exchange_organizationDirectory`;
- `exchange_saveOrganization`;
- `exchange_requestOrganizationContact`;
- `exchange_requestOrganizationIntroduction`; and
- `exchange_getOrganizationResourceStatus`.

The generated manifest and marker must contain exactly all 18 approved
endpoints. The staging package excludes unrelated payment, event, scheduled,
social, optional Microsoft marketing, and legacy full-entry modules. The old
deployed `org_create` is not acceptance evidence and must not be unexpectedly
deleted by this deployment.

## Pre-deployment review

Use Node 20. Record branch, commit, CLI versions, active project, Function
inventory/revisions, live/source rules hashes, index diff, Storage-rules diff,
Hosting version, and rollback inputs. Confirm no Firebase emulator environment
variables are active.

Run the complete validation matrix before staging. At minimum include all
required builds, lint, Exchange, security, run3, run4, production build, audit,
secret scan, and `git diff --check`; focused suites alone are insufficient.

Generate and validate the narrow package:

```bash
node scripts/core-functions-package.mjs generate
```

Inspect `.firebase-deploy/account-profile-functions/functions.yaml`, its marker,
runtime dependencies, and `firebase.core-functions.json`. Refuse a package with
an unexpected endpoint or dependency.

## Deployment order

1. Deploy only the explicitly named organization/context Functions from the
   narrow package. Include the existing four core endpoints only when their
   unchanged/reviewed revisions are intentionally part of the package.
2. Deploy required reviewed Firestore indexes and wait until every relevant
   index is ready.
3. Deploy reviewed Firestore rules.
4. Deploy reviewed Storage rules.
5. Run backend and direct-access acceptance.
6. Build and deploy development Hosting only after backend acceptance.

Every Firebase command must include `--project hi-coworking-plat`. Use explicit
`--only functions:<name>` selectors for the approved endpoints. Do not accept a
prompt to delete an unexpected Function. Do not use the monorepo full Function
entry for this workstream.

Rules, index, Storage, and Hosting deployments use the canonical `firebase.json`
only after their diffs are reviewed. Hosting must be the static artifact built
from the exact tested commit.

## Post-deployment verification

- List deployed Functions and compare names, region, runtime, generation, and
  revision with the approved plan.
- Verify no unexpected Function was deleted or redeployed.
- Probe callable CORS and unauthenticated denial, then run authenticated
  lifecycle/context acceptance.
- Confirm required composite indexes are ready before directory/claim/saved
  state testing.
- Verify direct private Firestore and Storage access fails, while approved
  public projection reads succeed.
- Record ruleset, index, and Hosting release IDs.
- Run configured browser, privacy, accessibility, and synthetic cleanup checks.
- Validate the generated export inventory and remove the staging package only
  with its guarded cleanup operation.

## Rollback

Before deployment, retain the prior commit/artifact, Function revisions,
rules/index definitions, Storage rules, and Hosting version. A rollback should:

1. redeploy the prior reviewed narrow Function package with the same explicit
   project and endpoint selectors;
2. redeploy the prior Firestore and Storage rules files;
3. restore the prior Hosting version or redeploy its recorded artifact;
4. avoid deleting indexes until a separate impact review proves removal safe;
5. remove only explicitly inventoried synthetic data; and
6. rerun inventory, callable denial, and public/private smoke tests.

Seed data uses the separate guarded rollback executor. It must not be treated as
part of a code deployment rollback.

## Current status

The narrow source package and endpoint inventory are implemented. Configured
Function, index, rules, Storage, and Hosting deployment for this workstream is
pending. No production, Stripe, Microsoft external send, or seed import is
authorized or recorded here.
