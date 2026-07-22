# Configured-development organization seed import

> Version 2 addendum: approved input is now a governed package containing one organization plus zero or more approved establishments, contact points, and communication routes. Child ownership and `seedPackageHash` are validated before planning. Public establishment/contact projections are generated independently, and every child/public write is included in rollback and no-op replay. Version 1 remains a temporary compatibility input; new review/export work must use version 2. No real package was imported in the establishment/contact-routing workstream.

The importer accepts approved-only exports, never raw prepared candidates. It is
dry-run by default and is constrained to the exact configured project
`hi-coworking-plat` (or a `demo-*` emulator project). Production is rejected.

## Sample gate

Create both independently reviewed exports, then plan the bounded sample:

```bash
npm run seed:organizations:dev:dry
```

Validation completes before database reads. Any invalid row or duplicate ID
aborts the entire plan. The normal gate permits no more than 100 total records
across the organization and restricted inputs.

Review the plan counts and protected-record findings. An apply additionally
requires a new local rollback path, an exact project confirmation, and a batch ID:

```bash
node apps/functions/scripts/import-organizations.cjs \
  --project hi-coworking-plat \
  --environment development \
  --organizations data/seed/prepared/approved/isle-of-wight-organizations.sample.jsonl \
  --targeting data/seed/prepared/approved/exchange-targeting-restricted.sample.jsonl \
  --batch-id exchange_dev_iow_YYYYMMDD \
  --rollback-output data/seed/prepared/rollback/exchange_dev_iow_YYYYMMDD.json \
  --apply \
  --confirm-development hi-coworking-plat
```

Do not run that command until the human review and operational acceptance gates
are complete. Before the first database mutation, the importer writes a protected
`0600` rollback artifact containing exact before/after snapshots and hashes. A
sample uses one atomic Firestore batch when it fits; larger explicitly approved
runs use bounded batches while retaining the pre-write recovery artifact.

The importer:

- preserves existing owner, claim, status, and verification state;
- refuses changed input for an owned or claimed organization;
- writes restricted candidates only to the server-side candidate collection and
  marks them non-public;
- emits an allowlisted public projection with `publicationApproved: true`;
- publishes address or coordinate fields only when their reviewed flags are true;
- repairs a missing/stale public projection instead of reporting a false no-op.

## Replay and expansion gate

After a sample apply, rerun with the same approved files and `--expect-no-op`:

```bash
npm run seed:organizations:dev:replay
```

This succeeds only when no private record or public projection needs mutation.
Complete configured-browser acceptance, privacy acceptance, and a disposable
rollback rehearsal before considering expansion.

Full configured-development expansion requires all of:

- `--allow-full-development`;
- `--confirm-full-development hi-coworking-plat`;
- a `--sample-gate-manifest` for that project with `sampleAccepted`, `replayNoOp`,
  `rollbackRehearsalPassed`, `browserAccepted`, `markerBehaviorAccepted`,
  `publicProjectionAccepted`, `privacyAccepted`, and `zeroUnauthorizedFields`
  all true;
- manifest metadata identifying schema version `1`, environment `development`,
  the sample batch, a sample size from 1 through 100, and the accepting human and
  timestamp;
- the normal exact apply confirmation and a new rollback output path.

Only after that gate exists may full approved exports be generated:

```bash
npm run seed:organizations:export-organizations:full -- \
  --sample-gate-manifest data/seed/prepared/acceptance/sample-gate.json
npm run seed:organizations:export-targeting:full -- \
  --sample-gate-manifest data/seed/prepared/acceptance/sample-gate.json
npm run seed:organizations:dev:dry:full -- \
  --sample-gate-manifest data/seed/prepared/acceptance/sample-gate.json
```

Full exporters remain approved-only and validate every approved row. Expansion
remains capped at 10,000 total input rows. Those flags do not authorize
production.
