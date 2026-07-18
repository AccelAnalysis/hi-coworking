# Canonical Exchange organization model

Organizations are authoritative business identities stored in `orgs/{organizationId}`. Personal profiles remain in `profiles/{uid}`; the two identities are not interchangeable.

## Authoritative fields

The server creates schema version 2 records with canonical/normalized name, search tokens, collision-safe slug, normalized domain, address components, privacy state, city/county/state/ZIP, optional verified coordinates/geohash, home-based flag, NAICS codes, capability keywords, certifications, verification and claim states, source provenance/IDs, owner UID, status, and timestamps.

Legacy records are read compatibly. New writes add `schemaVersion: 2` and current search/projection fields without requiring destructive migration.

## Public/private boundary

`orgs` is member/staff scoped. `publicOrganizations` is generated only by trusted server/import code and excludes owner UID, billing data, source identifiers, claim evidence, targeting data, and private contact fields. When `homeBased` or `privacySuppressed` is true, street, ZIP, coordinates, and geohash are omitted.

`organizationSourceCandidates` is server-only. Restricted targeting rows cannot contain contact, demographic, military, age, birth-date, street, or precise-coordinate fields.
