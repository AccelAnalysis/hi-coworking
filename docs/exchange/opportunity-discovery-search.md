# Opportunity Discovery Search

## Contract

Discovery uses the v1 contract in `packages/shared/src/opportunityDiscovery.ts`. Clients send normalized keyword, filter, location, sort, cursor, and page-size state through the existing `rfx_listManaged` callable using an explicit discovery operation. Browser clients cannot set issuer verification, authoritative relationship, ranking authority, protected response state, or projection visibility.

## Projection

`apps/functions/src/opportunityDiscovery.ts` builds an allowlisted `opportunityDiscovery` projection from approved, discoverable RFx records. It excludes bid content, competing responses, evaluation records, protected contacts, private organization data, and administrative fields that are not needed for discovery.

Projection version: `1`.

## Ranking

The built-in provider applies deterministic weighting:

1. Exact title match
2. Exact RFx number or identifier
3. Exact NAICS or capability match
4. Title token match
5. Place-of-performance match when indexed
6. Issuer-name match
7. Description match
8. Broader synonym or prefix match

Recommended ordering additionally considers freshness, organization capability fit, territory fit, and new/updated relationship state. Stable record IDs are the final tie-breaker.

## Normalization and matching

- Unicode is normalized and diacritics removed.
- Punctuation is converted to spaces.
- Repeated whitespace is collapsed.
- Multiword queries require all normalized tokens in the bounded candidate set.
- Common RFx, construction, HVAC, electrical, roofing, technology, and consulting synonyms are expanded.
- Code and label searches use the same query contract.
- Exact phrases are supported by the server contract.

The built-in provider offers basic typo/prefix resilience but is not a substitute for a configured full-text engine with edit-distance ranking. No third-party hosted search provider has been introduced in this branch.

## Scale and migration

The target path queries versioned projection records with cursor pagination. A bounded server compatibility path exists for pre-projection records and reports itself as degraded. It must be removed only after backfill and index readiness are verified.

The browser never downloads the full opportunity corpus for final filtering.

## Failure behavior

- Invalid queries return `invalid-argument` with safe validation details.
- Stale browser results are ignored using request versions.
- Missing composite indexes produce a safe degraded result and warning.
- Projection migration fallback is capped and disclosed.
- Complex counts are labeled qualified instead of presented as exact.
- Offline users retain already loaded results; new server searches require connectivity.

## Recent and saved searches

Recent searches are normalized, account scoped, deduplicated by fingerprint, and capped. Saved searches store only the validated v1 query and sort state. They cannot contain executable code or raw Firestore query fragments.

Alert frequencies are `immediate`, `daily`, `weekly`, or `disabled`. Preferences may be stored, but external delivery remains off until a consented notification channel is configured.

## Optional future hosted provider

A future hosted provider must document cost, security, index ingestion, deletion propagation, outage fallback, local development, migration, and rollback. It must preserve the v1 query/result contract so the Exchange UI remains provider independent.