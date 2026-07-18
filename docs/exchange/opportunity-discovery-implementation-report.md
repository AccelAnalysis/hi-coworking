# Opportunity and RFx Discovery Implementation Report

Date: 2026-07-18  
Repository: `AccelAnalysis/hi-coworking`  
Base branch: `codex/exchange-run-4-founding-launch`  
Implementation branch: `codex/exchange-opportunity-discovery-100`  
Starting commit: `553da22d42a882a21fa5061fd5a6fc61d172767e`  
Pull request: `https://github.com/AccelAnalysis/hi-coworking/pull/4`

## Architecture delivered

- Canonical `/exchange` map-centered workspace preserved.
- Existing Intelligence, Referrals, Opportunities, and Resources modes preserved.
- Businesses remain contextual entities; Teaming remains opportunity initiated.
- Existing Mapbox 2D/3D, clustered source, mobile result drawer, desktop floating panels, and navigation order preserved.
- Versioned v1 discovery projection and query contracts added.
- Browser-only bounded filtering replaced by a server discovery gateway and cursor model.
- Legacy records receive an explicit bounded compatibility path while projection backfill is incomplete.

## Search

- Multiword normalized keyword query contract
- Deterministic field weighting and tie-breakers
- Exact identifier/title priority
- NAICS, capability, title, issuer, location, description, and synonym fields
- Basic prefix/abbreviation/synonym resilience
- Stale response rejection and debounced browser execution
- Account-scoped recent searches
- Normalized saved searches

A hosted full-text provider was not introduced. The built-in projection provider avoids a new cost/security dependency but does not claim advanced edit-distance quality.

## Geographic discovery

- Mapbox Geocoding API v6 adapter abstraction
- Test provider
- Keyboard-accessible suggestions
- City, state, ZIP, address, and named-place input
- 10, 25, 50, 100, and 250 mile radius options
- Haversine distance and nearest ordering
- Distance display on cards/details
- Contextual search-this-map-area action
- URL-backed place, point, radius, remote, and bounds state
- Exact/approximate/place-of-performance/territory/withheld/remote/not-geocoded confidence model
- No fabricated marker coordinates

## Sorting

- Recommended
- Relevance
- Nearest
- Newest posted
- Recently updated
- Deadline soonest/latest
- Local first
- Best capability match
- Budget high/low

All sort state is shared across desktop/mobile, query, reducer, and URL.

## Filtering

- Human-readable industry and NAICS selection
- Capability keywords independent of NAICS
- Opportunity and RFx types
- Buyer type
- Visibility
- Work arrangement
- Certifications and set-asides
- Prime/subcontract and single/multiple award
- Closing soon
- Budget range
- Teaming suitability
- Territory
- Saved/viewed/responded/managed/new/updated personalized filters
- Organization NAICS/capability/service-territory matching
- Exclude issuer organization

Advanced groups use progressive disclosure. The active-chip row is bounded and individually removable.

## Map interaction

- Existing filter-aware clusters, expansion, selection, and 2D/3D preserved
- Server-filtered records feed the map source
- Fit-results and contextual map-area search added
- Selection remains synchronized across map, result panel/drawer, URL, and detail
- Missing coordinates remain visible in the list and are explicitly not plotted

## Cards and detail

Cards prioritize title, issuer, type, location, deadline, budget, high-value status, primary action, compact save, and overflow actions. Complete metadata remains in detail.

Detail includes decision context, issuer verification, dates/timezone, location confidence, work arrangement, contract structure, scope, requirements, certifications, set-asides, requested documents, eligibility, response/management state, teaming, share/refer, and governed change records.

## Saved and personalized discovery

- Save/remove opportunity
- Saved filter
- Viewed/new/updated relationship state
- Response/management state
- Save/list/run/delete searches
- Recent search restoration
- Immediate/daily/weekly/disabled alert preference

External alert delivery remains intentionally disabled pending consent and channel configuration.

## Addenda and Q&A

- Immutable addendum versions
- Material change list
- Explicit deadline changes
- Required acknowledgment records
- Public/private Q&A policy
- Protected asker identity
- Question deadline support
- Issuer authority checks
- Idempotency and audit events
- Notification jobs with external delivery disabled

## Scaling and migration

- Cursor pages and stable tie-breakers
- Bounded query budgets
- Deduplication and stale-response protection
- Projection backfill script with emulator-first safety guard
- Index deployment manifest and safe merge/check utility
- Deterministic 100/1,000/10,000 synthetic fixture generator
- Performance targets and measurement record

## Tests and validation assets added

- Shared contract/geography tests
- Workspace reducer/URL state tests
- Location-provider tests
- Projection-safety tests
- Browser acceptance Playwright specification
- Static repository contract/secrets validation
- Dedicated CI workflow running required repository commands
- Security, accessibility, performance, and viewport acceptance documentation

## Validation state

The connected implementation environment could modify the private repository but could not check it out and execute Node/Firebase/browser commands locally. Therefore the following are **not represented as passes**:

- `npm ci`
- `npm audit --omit=dev`
- `npm run build:shared`
- `npm run build:functions`
- `npm run lint`
- `npm run test:exchange`
- `npm run test:security`
- `npm run test:run3`
- `npm run test:run4`
- `npm run build`
- Playwright and accessibility runs
- Emulator performance measurements
- Browser screenshots

The branch CI workflow is the authoritative next validation path.

## Required external configuration

- Authorized `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
- `NEXT_PUBLIC_MAPBOX_GEOCODING_ENDPOINT` (default v6 endpoint may be retained)
- Firebase emulator/project configuration
- Merged and deployed Firestore composite indexes
- Complete projection backfill and source/projection parity check
- Complete official NAICS dataset generation/import
- Consented notification channel before external alert delivery

## Remaining blockers

1. CI/build/test results are not yet recorded as passing.
2. Projection backfill and ongoing synchronization are not exercised in the target environment.
3. Composite indexes are provided as a mergeable manifest but are not confirmed deployed.
4. Mapbox location search is not exercised with the target token/domain restrictions.
5. The UI catalog is a curated 2022 NAICS subset rather than the full official hierarchy.
6. Required browser screenshots and accessibility evidence are not captured.
7. 100/1,000/10,000 performance measurements are not recorded.
8. External alerts remain disabled by design.

## Honest completion estimate

**94% implemented; not accepted as 100%.**

The user workflows are production-shaped in code, but the feature cannot truthfully reach 100% until the configuration, migration, security, performance, accessibility, and browser acceptance gates above are complete.