# Profile save contract

`profile_update` is the only browser profile write path. It requires Firebase authentication and derives the target UID from the verified request; there is no target-UID input.

## Mutation semantics

- `expectedVersion` is required and must equal the authoritative `profileVersion`.
- Omitted fields preserve the stored value.
- `null` clears only an explicitly nullable scalar or asset field.
- An empty form string is normalized by the browser to `null` for clearable fields.
- Arrays replace existing arrays; `[]` intentionally clears an array.
- Unknown fields are rejected.
- `published` is always explicit.

The strict schema bounds text/array lengths, accepts only HTTP(S) profile links, validates NAICS/certification arrays, and validates canonical asset path shapes. The handler separately proves each canonical asset belongs to the authenticated UID. Choosing a canonical storage path removes the legacy permanent bearer URL.

## Transaction and response

The transaction creates or updates `profiles/{uid}`, increments `profileVersion`, sets schema 3/server timestamps, normalizes a legacy profile, calculates completeness/readiness, preserves verification/enrichment fields not explicitly changed, and creates or deletes the allowlisted `publicProfiles/{uid}` projection. A stale save returns `PROFILE_VERSION_CONFLICT` with the current version and request ID.

The response includes success, request ID, version/schema, completeness, readiness, publication/projection state, server update time, and a sanitized canonical owner response. The browser merges that response and reloads authoritative Firestore state after navigation/refresh.

## Privacy

Private profile state, attestation, raw enrichment data, review metadata, email, and internal identifiers are never copied to the public projection. Public data passes explicit top-level and nested allowlists. Raw video paths and cross-user asset paths are excluded.

## Completeness and readiness

Completeness is bounded at 100 and uses business information, location, procurement identifiers, certifications, canonical assets, and profile links. `seat_ready` is the default. `bid_ready` requires verified status plus a capability statement. `procurement_ready` additionally requires an enrichment match, at least 70 completeness, and trust statistics. Enrichment alone is not verification.
