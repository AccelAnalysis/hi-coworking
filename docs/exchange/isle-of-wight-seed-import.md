# Isle of Wight organization seed import

No production import is performed by this branch.

## Prepare and verify

1. Keep the supplied high-resolution workbooks outside the public application.
2. Run `prepare-organization-seeds.py` to produce:
   - `data/seed/prepared/isle-of-wight-organizations.jsonl`
   - `data/seed/prepared/exchange-targeting-restricted.jsonl`
3. Run `npm run seed:organizations:verify` on the public organization output.
4. Review all home-based suppression, source provenance, organization counts, and invalid rows before any write.

## Dry run first

The importer is now dry-run by default. Omitting `--apply` never writes records.

```bash
npm run seed:organizations:dev:dry
```

Or run the equivalent explicit command:

```bash
node apps/functions/scripts/import-organizations.cjs \
  --project hi-coworking-plat \
  --environment development \
  --organizations data/seed/prepared/isle-of-wight-organizations.jsonl \
  --targeting data/seed/prepared/exchange-targeting-restricted.jsonl
```

Review the created, updated, skipped, duplicate, and invalid counts. Repeat the dry run; unchanged records should become skipped after an applied import.

## Apply to the configured development environment

Because `.firebaserc` currently points both `default` and `prod` at `hi-coworking-plat`, never rely on an implicit Firebase alias. A development write requires all of the following:

- explicit `--project hi-coworking-plat`;
- explicit `--environment development`;
- explicit `--apply`;
- exact `--confirm-development hi-coworking-plat`;
- reviewed dry-run and rollback reports.

```bash
node apps/functions/scripts/import-organizations.cjs \
  --project hi-coworking-plat \
  --environment development \
  --organizations data/seed/prepared/isle-of-wight-organizations.jsonl \
  --targeting data/seed/prepared/exchange-targeting-restricted.jsonl \
  --batch-id exchange_dev_iow_YYYYMMDD \
  --apply \
  --confirm-development hi-coworking-plat
```

This development confirmation is intentionally separate from production release approval. It prevents misleading instructions that describe every non-emulator write as production while still requiring an exact project confirmation.

## Production boundary

A production write requires:

```text
--environment production --apply --confirm-production <exact-project-id>
```

Do not use the production form until the release checklist, backup, migration rehearsal, and rollback approval are complete.

## Data and rollback contract

The importer writes deterministic IDs, source hashes, batch IDs, provenance timestamps, protected `orgs` records, sanitized `publicOrganizations` projections, server-only candidates, and an `organizationSeedImports` rollback manifest. It never fabricates coordinates.

Privacy-suppressed rows fail validation if they contain street, ZIP, phone, coordinate, or geohash fields.

Rollback uses the recorded `importBatchId` across:

- `orgs`
- `publicOrganizations`
- `organizationSourceCandidates`

Review claimed or subsequently modified records before removing any imported record. Do not delete an organization merely because it originated in a seed batch after a user has claimed or enriched it.
