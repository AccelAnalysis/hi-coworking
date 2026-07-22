# Organization seed rollback

> Version 2 addendum: rollback manifests may include `organizationLocations`, `publicOrganizationLocations`, `organizationContactPoints`, `publicOrganizationContactPoints`, and `organizationCommunicationRoutes` in addition to organization and restricted-matching documents. Each entry retains before/after state and an after hash. Rollback must refuse a claimed, ownership-changed, or subsequently modified record. Organization-location legacy migration has its own exact-hash rollback script and is not conflated with seed import rollback.

Every configured-development apply must create its protected rollback manifest
before Firestore is changed. Retain that ignored `0600` file with the batch's
acceptance evidence.

The executor accepts only versioned manifests for the exact project and
environment and only these collections:

- `orgs`;
- `publicOrganizations`;
- `organizationSourceCandidates`.

Each current document must exactly match the recorded post-import hash. The
executor refuses rollback when a document changed after import or when an
organization was claimed/assigned. It restores exact prior snapshots, deletes
only records created by the batch, and treats already-restored records as no-ops.

## Disposable rehearsal

Rehearsal is in-memory and performs no Firebase initialization or writes. It
applies a bounded subset of recorded post-import snapshots to a disposable map,
rolls them back, and verifies the prior-state hashes:

```bash
npm run seed:organizations:rollback:rehearse -- \
  --manifest data/seed/prepared/rollback/exchange_dev_iow_YYYYMMDD.json
```

The default subset is 10; `--subset-size` must be between 1 and 100.

## Live dry run and guarded apply

A live rollback dry run reads current configured-development documents but does
not mutate them:

```bash
node apps/functions/scripts/rollback-organization-seed.cjs \
  --manifest data/seed/prepared/rollback/exchange_dev_iow_YYYYMMDD.json \
  --project hi-coworking-plat \
  --environment development
```

Only after reviewing a clean dry-run report may the operator add all three write
confirmations:

```text
--apply
--confirm-development hi-coworking-plat
--confirm-batch exchange_dev_iow_YYYYMMDD
```

Rollback mutations use batches of at most 450 and mark the corresponding
`organizationSeedImports` record `rolled_back`. The executor offers no production
mode and never overrides the claimed/modified-record refusal.
