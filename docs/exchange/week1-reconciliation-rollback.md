# Week 1 organization reconciliation rollback

This branch is additive and has no production actions.

Code rollback: revert the reconciliation commits or close the draft PR. The canonical `/exchange` route is unchanged, so no workspace restoration should be necessary.

Development data rollback:

1. Stop writes.
2. Locate the `organizationSeedImports/{batchId}` manifest or organization audit event.
3. Export affected records.
4. Remove only unclaimed records created by that batch after verifying `importBatchId`.
5. Remove their matching public projections and restricted candidates.
6. Never delete claimed organizations or memberships automatically.
7. Restore indexes/rules only by reverting this branch; do not loosen rules manually.

Profile saves are forward-compatible. `profileSchemaVersion: 2` and `legacyMigratedAt` do not remove legacy fields, so rollback does not require a profile data migration.
