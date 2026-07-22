# Isle of Wight organization seed lifecycle

No Firebase import or production seed workflow is authorized by preparation. The
configured-development gate remains closed until a human has reviewed and
explicitly approved a bounded sample.

## Verified preparation state

The 2026-07-22 local preparation and verification run produced:

- 5,128 organization candidates, including 1,324 privacy-suppressed home businesses;
- 3,736 coordinate-eligible organizations and 1,392 list-only organizations;
- 70 source coordinate rows suppressed as zero sentinels or outside the configured
  FIPS 51093 validation envelope;
- 3,545 restricted matching candidates;
- zero duplicate organization IDs, home privacy violations, coordinate violations,
  or restricted-targeting privacy violations in the prepared outputs;
- 5,128 organization and 3,545 restricted candidates pending human review;
- zero human approvals, approved exports, imports, or Firebase writes.

The envelope (`36.64..37.22`, `-77.02..-76.43`) is deliberately conservative
input validation, not an authoritative county boundary. A rejected coordinate
makes the organization list-only; the preparation code never fabricates a point.

## Lifecycle

```text
private workbooks
  -> prepared candidates
  -> protected pending review packets
  -> human review
  -> approved-only sample exports (maximum 100 combined import records)
  -> strict configured-development dry run
  -> pre-write rollback snapshot
  -> explicitly confirmed sample apply
  -> no-op replay + browser/privacy acceptance + rollback rehearsal
  -> separately approved expansion
```

Run preparation and structural verification:

```bash
npm run seed:organizations:prepare
npm run seed:organizations:verify
```

Generate protected review packets once:

```bash
npm run seed:organizations:review-packet
```

The generated `data/seed/prepared` tree is gitignored. Review packets and their
manifest are created with mode `0600`, and the generator refuses to overwrite
them. See [seed-review.md](./seed-review.md) for the human gate.

Only after review may an operator create the two approved sample exports:

```bash
npm run seed:organizations:export-organizations
npm run seed:organizations:export-targeting
npm run seed:organizations:dev:dry
```

The dry run reads the exact configured development project and plans changes,
but does not write. Raw prepared candidates are never valid importer input.
See [seed-development-import.md](./seed-development-import.md) for the apply and
expansion gates and [seed-rollback.md](./seed-rollback.md) for recovery.

## Privacy contract

- Home-business street, postal, phone, and precise coordinate fields are removed
  during preparation.
- Restricted matching rows exclude personal, demographic, contact, address, and
  precise-location fields and never receive a public projection.
- Public projection is allowlisted. Review identity, source IDs, ownership data,
  and restricted matching fields are never copied into `publicOrganizations`.
- An approved organization is publishable, but street/postal and coordinates are
  independently included only when the corresponding human-reviewed flag is true.
- Existing claimed or owned organization records cannot be changed by this importer.

## Production boundary

The scripts in this lifecycle reject `--environment production`; there is no
production confirmation escape hatch. Production migration requires a separate,
explicitly reviewed release workflow that is not part of this workstream.
