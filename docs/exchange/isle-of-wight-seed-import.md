# Isle of Wight organization seed import

No production import is performed by this branch.

1. Keep the supplied high-resolution workbooks outside the public application.
2. Run `prepare-organization-seeds.py` to produce privacy-minimized organization JSONL and a separate server-only restricted candidate JSONL.
3. Run `verify-organization-seed.py` on the public organization output.
4. Run the importer with `--dry-run --project demo-hi-coworking`.
5. Review created/updated/skipped/duplicate/invalid rows and the privacy report.
6. Repeat the same dry run; unchanged rows must report skipped.
7. Validate in emulators.
8. A non-demo write requires an exact `--confirm-production <projectId>` value in addition to `--project`.

The importer writes deterministic IDs, source hashes, batch IDs, provenance timestamps, full protected `orgs` records, sanitized `publicOrganizations` projections, server-only candidates, and an `organizationSeedImports` rollback manifest. It never fabricates coordinates. Privacy-suppressed rows fail validation if they contain street, ZIP, phone, coordinate, or geohash fields.

Rollback uses the recorded `importBatchId` across `orgs`, `publicOrganizations`, and `organizationSourceCandidates`. Review claimed/modified records before removing any imported record.
