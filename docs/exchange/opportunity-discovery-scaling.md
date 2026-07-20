# Opportunity Discovery Scaling

## Target architecture

The browser submits a validated v1 discovery query and receives a bounded page. Filtering, text matching, sorting, visibility, and geographic constraints are evaluated server-side against `opportunityDiscovery` projection records. The browser never performs an unbounded RFx collection scan.

## Pagination

- Default page size: 40
- Maximum page size: 100
- Cursor state is versioned and opaque to the browser.
- Stable sort values plus record ID form the cursor tie-breaker.
- The web hook rejects stale responses and deduplicates record IDs before appending.
- Infinite scrolling is supplemented by an explicit accessible “Load more results” action.

## Query budgets

- Projection candidate windows are bounded.
- Membership and organization authority reads are capped.
- Response relationship lookups are limited to the current result page.
- Saved/recent searches have owner-scoped limits.
- Addenda and Q&A list operations have explicit maximums.
- The legacy compatibility path is capped at 400 approved/open RFx records and reports degraded behavior.

## Projection lifecycle

1. Approved/discoverable RFx records are transformed through `buildOpportunityDiscoveryProjection`.
2. The projection contains only allowlisted discovery fields.
3. Existing RFx records must be backfilled in emulator-safe batches.
4. Projection count, open-approved source count, and sampled field parity must be compared.
5. Composite indexes must become ready.
6. Projection-backed search must pass acceptance at 100, 1,000, and 10,000 synthetic records.
7. Only then may the compatibility path be disabled.

## Backfill safety

- Use synthetic or emulator data for development and load testing.
- Do not mutate production RFx records to create projections.
- Projection documents are replaceable derived data.
- Backfill writes should be idempotent.
- A failed batch may be retried from the last stable cursor.
- The compatibility path remains read-only against source RFx records.

## Counts

An exact count is returned only when the query provider has scanned the complete matching set within its explicit budget. Otherwise the API returns `qualified` or `unavailable`. The UI must not convert loaded-page length into an implied global exact count.

## Caching

- Browser state caches only already received pages for the active React lifecycle.
- Query results are not permanently stored in local storage.
- Saved/recent searches store normalized query state, not result documents.
- Provider-side caching may be added with a key based on projection version, normalized query, authority scope, cursor, and page size.
- Protected relationship overlays must never be shared across users.

## Retry and degradation

- Network/index/provider failures return compact retry states.
- Stale requests are ignored rather than allowed to overwrite newer filters.
- Previously loaded results remain visible during refresh/offline degradation.
- A failed Mapbox location provider does not prevent keyword/list discovery.
- Missing coordinates do not prevent records from appearing in the list.

## Synthetic fixtures

Required fixtures:

- 100 opportunities for browser workflow and visual acceptance
- 1,000 opportunities for pagination, filter combinations, and map interaction
- 10,000 opportunities for provider service tests and memory/query-budget checks

Fixtures must include duplicate coordinates, missing coordinates, approximate coordinates, remote records, multiple currencies, varied deadlines, saved/viewed/responded relationships, addenda, and public/member/restricted visibility.

## Performance targets

- First useful result content: p75 under 2.5 seconds on a normal broadband test profile after application shell load
- Keyword feedback without main-thread lock: input update under 100 ms
- Location suggestions: p75 under 1.5 seconds excluding provider outage
- Filter/sort transition: no stale-result flash after the new response resolves
- Drawer scroll: no long tasks above 200 ms attributable to card rendering in standard fixtures
- Map pan/zoom: no uncontrolled query loop; at most one settled viewport query per debounce interval
- Pagination: no duplicates and stable cursor order
- Memory: no unbounded growth after repeated filter changes and 20 page transitions

## Rollback

1. Keep the old RFx source collection unchanged.
2. Disable discovery gateway use in the web feature flag/build if the projection path is unstable.
3. Return to the prior Exchange repository implementation while preserving URL compatibility.
4. Retain projection documents for diagnosis or delete/rebuild them as derived data.
5. Do not roll back Firestore security protections to restore functionality.
6. Re-enable the compatibility path only as an explicitly degraded temporary measure.