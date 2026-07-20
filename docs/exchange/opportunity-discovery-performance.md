# Opportunity Discovery Performance

Date: 2026-07-20
Branch: `codex/exchange-opportunity-discovery-reconciliation`

## Test status

The architecture and targets are defined. The local environment has validated
fixture shape and focused emulator behavior, but the measured browser/load
results below have not been recorded. Empty values are intentional release
blockers, not implied passes.

## Required environments

- Node version defined by the repository
- Firebase Auth, Firestore, and Functions emulators
- Synthetic discovery projections only
- Mapbox test token restricted to the acceptance origin
- Chromium browser profile with normal broadband and 4× CPU slowdown secondary run

## Dataset profiles

| Fixture | Purpose | Required composition | Result |
| --- | --- | --- | --- |
| 100 | Functional/browser baseline | All location-confidence states, remote, deadlines, saved/viewed/responded, addenda/Q&A | Schema validated |
| 1,000 | Pagination/filter/map stability | Duplicate coordinates, dense clusters, varied industries, compound filters | Schema validated |
| 10,000 | Provider/query budget | Broad text tokens, geographic spread, stable cursors, count qualification | Schema validated |

## Metrics

| Metric | Target | 100 | 1,000 | 10,000 |
| --- | ---: | ---: | ---: | ---: |
| Initial useful results, p75 | < 2.5 s | Not run | Not run | Not run |
| Keyword input response | < 100 ms | Not run | Not run | Not run |
| Search response, p75 | < 1.5 s local emulator / < 2.5 s remote | Not run | Not run | Not run |
| Location suggestion, p75 | < 1.5 s | Not run | Not run | Not run |
| Page append | < 1.0 s emulator | Not run | Not run | Not run |
| Duplicate records | 0 | Not run | Not run | Not run |
| Uncontrolled viewport requests | 0 | Not run | Not run | Not run |
| Main-thread long tasks >200 ms | 0 discovery-caused during standard scroll | Not run | Not run | Not run |
| Heap growth after 20 query transitions | bounded/stable | Not run | Not run | Not run |

## Instrumentation

The discovery page returns provider name, query duration, count accuracy, truncation, degraded state, and warnings. Browser measurements should additionally capture Web Vitals, performance timeline long tasks, Firestore/Functions invocation count, document reads, result page size, duplicate IDs, and Mapbox source-update count.

## Pass criteria

- Stable cursor order across repeated runs.
- No duplicate IDs after pagination.
- Aborted/stale queries never replace current results.
- Map remains interactive while cards append.
- Result drawer scrolling does not resize cards after settled content.
- Memory returns to a stable band after old query results become unreachable.
- Qualified counts are labeled; no loaded-page count is represented as global exact.
- The 10,000-record service test does not perform an unbounded RFx source scan.

## Current conclusion

No performance percentage can be raised to 100% until the measurements above are attached. The compatibility fallback is intentionally capped and must not be used as evidence for 10,000-record scale.
