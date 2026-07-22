# Organization location migration

Migration version 1 converts a qualifying legacy flat organization address into deterministic `legacy_{organizationId}` establishment data.

The planner requires street, city, and state. City/state-only rows remain list-only. It never fabricates coordinates. Home/privacy-suppressed records keep address and exact coordinate publication false. Existing compatibility fields are retained. The organization receives primary/headquarters IDs only when a valid establishment is created.

`migrate-organization-locations.cjs` is dry-run by default, bounded to 500, exact-project guarded, deterministic, hash-recorded, and idempotent through a migration version plus deterministic ID. Claimed organizations are skipped unless separately and explicitly included. Apply requires exact configured-development confirmation and a protected rollback path.

Rollback checks the recorded migration hash before deleting created private/public location documents and restoring the exact prior organization snapshot. Rehearsal is non-mutating by default.

No migration apply is part of seed approval. Compatibility readers remain until configured acceptance passes.
