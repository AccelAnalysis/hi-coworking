# Organization seed human review

Preparation never implies approval. Every generated row begins with
`reviewStatus: "pending"`, blank reviewer identity, null review time, and both
field-publication approvals set to `false`.

## Review record contract

The reviewer must preserve the candidate data and these generated fields:

- `reviewPacketVersion`: currently `1`;
- `reviewCandidateHash`: SHA-256 over the immutable candidate payload;
- `privacyClassification`: `public_business`, `suppressed_home_business`, or
  `restricted_match_only` as generated;
- `sourceProvenance`: the exact, source-only provenance records generated from
  `sources`;
- `projectionVersion`: currently `1`.

The reviewer controls these explicit decisions:

- `reviewStatus`: `pending`, `approved`, or `rejected`;
- `reviewedBy`: a durable reviewer identifier for approved/rejected rows;
- `reviewedAt`: a positive epoch-millisecond timestamp for approved/rejected rows;
- `addressPublicationApproved`: whether reviewed street/postal fields may enter
  the public projection;
- `coordinatePublicationApproved`: whether reviewed coordinates may enter the
  public projection.

The two publication flags are independent of organization approval. They may
remain false on an approved organization, which keeps those fields out of the
public projection. A flag must remain false when the corresponding field is
absent. Restricted and privacy-suppressed rows cannot carry those fields at all.

Changing candidate content without regenerating the packet invalidates
`reviewCandidateHash`. Do not add comments, personal data, or evidence text to a
row; keep supporting review evidence in the protected review system of record.

## Export gate

After a reviewer has updated the protected packets, run:

```bash
npm run seed:organizations:export-organizations
npm run seed:organizations:export-targeting
```

If both inputs participate in one sample, pass `-- --limit N` to each command
so their exported row counts total no more than 100. The importer independently
enforces that combined ceiling.

Each exporter:

- accepts only exact project `hi-coworking-plat` in environment `development`;
- validates the candidate hash, provenance, privacy classification, review
  identity/time, coordinate geography, and field decisions;
- exports only `approved` rows;
- refuses duplicate or invalid approved rows;
- refuses to produce an empty export;
- defaults to and cannot exceed 100 rows while the sample gate is active;
- creates protected `0600` output and manifest files without overwriting evidence.

Current local evidence has 5,128 organization rows and 3,545 restricted rows
pending, with zero human approvals. Therefore both export commands are expected
to stop at the human-review gate until real review occurs.

A larger approved-only export is unavailable until the bounded sample's replay,
rollback, browser, marker, projection, and privacy evidence is recorded in the
expansion gate described in [seed-development-import.md](./seed-development-import.md).
