# Opportunity and RFx Discovery — 100% Audit

Date: 2026-07-18  
Branch: `codex/exchange-opportunity-discovery-100`  
Baseline branch: `codex/exchange-run-4-founding-launch`  
Starting commit: `553da22d42a882a21fa5061fd5a6fc61d172767e`

## Executive assessment

The baseline implementation was a strong map-centered Exchange experience but not a complete production discovery system. It had a working Mapbox 2D/3D shell, clusters, mobile result drawer, desktop floating panels, basic RFx/territory search and filters, selection synchronization, offline/error states, and URL-backed core state. Its principal discovery limitation was a fixed browser snapshot followed by client-side substring matching and filtering.

Baseline opportunity-discovery estimate: **88%** from the product review.  
Implementation branch estimate before external configuration and browser acceptance: **94%**.

The branch must not be labeled 100% until all release blockers in this document are closed.

## Before-state classification

| Requirement | Before state | Finding |
| --- | --- | --- |
| Geographic browsing | Partial | Map browsing, territory layers, marker clusters, and viewport state existed. True place/radius search and map-area server queries did not. |
| Keyword search | Partial | Client-side normalized substring matching over a bounded result set. |
| Industry search | Partial | NAICS code filtering existed; human-readable hierarchy and capability search did not. |
| Location search | Missing | No geocoder adapter, place suggestions, radius contract, distance sort, or URL-backed place state. |
| Sorting | Missing/partial | Local-first preference existed; no complete shared sort model. |
| Procurement filtering | Partial | NAICS, territory, territory status, open RFx, and local-first existed. |
| Map clusters and bubbles | Strong partial | Working clusters, selected marker, expansion, 2D/3D, fit behavior, and list synchronization. No server viewport query or confidence metadata. |
| Opportunity cards | Strong partial | Scannable core cards and actions existed, but saved state and enriched procurement metadata were incomplete. |
| Opportunity detail | Strong partial | Selected panel and full RFx routes existed; addenda/Q&A/change awareness and authoritative relationship summaries were incomplete. |
| Saved opportunities | Backend utility only | Not consistently connected to visible cards and detail. |
| Saved searches and alerts | Missing | No normalized saved-query workflow. |
| Server-side scale | Missing | Fixed bounded Firestore retrieval, then browser filtering. |
| Accessibility | Partial | Existing shell had accessible controls, but new search/filter/listbox workflows required complete review. |
| Browser acceptance | Partial | Earlier responsive work existed; no evidence set for this complete discovery scope. |

## Architecture decisions

1. **Separate discovery projection.** Public/member discovery uses `opportunityDiscovery` projection documents rather than exposing transactional RFx documents. Protected response, evaluation, bid, private contact, and organization data is excluded.
2. **Versioned contracts.** The shared query and projection contract is versioned at v1 and validated with Zod.
3. **One canonical workspace.** `/exchange` remains the canonical map-centered workspace. Legacy `/rfx` behavior remains outside the primary navigation and Businesses/Teaming are not restored as primary tabs.
4. **Provider abstraction.** Mapbox geocoding is behind `OpportunityLocationSearchProvider`; text discovery is behind the server projection provider and can be replaced without rewriting UI components.
5. **Server authority.** Saving, recent views, response relationship, organization fit, issuer management, addenda, Q&A, and saved searches are derived or written server-side.
6. **Progressive disclosure.** The command bar remains concise. Advanced procurement and personalized filters live in organized filter sections. Cards stay scannable; complete context lives in the detail panel.
7. **No fabricated geography.** Missing or territory-only coordinates are never presented as exact opportunity locations. Results without authoritative coordinates remain available in the non-map list.
8. **Degraded migration path.** A bounded, server-side legacy RFx compatibility path exists only while projection backfill is incomplete. It reports degraded/qualified results and is not considered the final scale architecture.

## Traceability matrix

| Capability | Implementation files | Tests/evidence required |
| --- | --- | --- |
| Discovery contract | `packages/shared/src/opportunityDiscovery.ts` | Contract, normalization, validation, Haversine tests |
| Projection safety | `apps/functions/src/opportunityDiscovery.ts` | Projection allowlist and protected-field tests |
| Projection migration | `apps/functions/src/opportunityDiscoveryFallback.ts` | Backfill/fallback tests; emulator backfill evidence |
| Query gateway | `apps/functions/src/opportunityDiscoveryGateway.ts`, `apps/functions/src/rfxQueries.ts` | Legacy callable regression and operation-routing tests |
| Personalization | `apps/functions/src/opportunityPersonalization.ts` | Organization authority, response state, saved/viewed filters |
| Location provider | `apps/web/src/features/exchange/data/opportunityLocationSearchProvider.ts` | Provider parsing, cancellation, error-state tests |
| Location UI | `apps/web/src/features/exchange/components/OpportunityLocationSearch.tsx` | Keyboard/listbox/browser tests |
| Workspace state | `exchangeWorkspaceTypes.ts`, `exchangeWorkspaceActions.ts`, `exchangeWorkspaceReducer.ts` | Reducer validation and reset tests |
| URL state | `exchangeUrlState.ts` | Full round-trip, browser back/forward tests |
| Server discovery hook | `useOpportunityDiscovery.ts` | Stale-response, pagination, deduplication tests |
| Industry/capability | `naicsCatalog.ts`, `ExchangeFilters.tsx` | Label/code matching and keyboard tests |
| Sort/filter UX | `ExchangeCommandBar.tsx`, `ExchangeFilters.tsx`, `ExchangeActiveFilters.tsx` | Responsive density and URL persistence tests |
| Cards | `ExchangeRfxCard.tsx` | Save/share/selection/focus behavior tests |
| Results pagination | `ExchangeResultsList.tsx` | Infinite-load and dedupe tests |
| Detail | `ExchangeEntityDetail.tsx` | Relationship/action routing tests |
| Addenda/Q&A | `opportunityGovernance.ts`, `OpportunityGovernancePanel.tsx`, `useOpportunityGovernance.ts` | Authority, immutability, visibility, idempotency tests |
| Saved/recent searches | `SavedOpportunitySearchManager.tsx`, `opportunityRecentSearches.ts`, `opportunityDiscoveryState.ts` | Owner scoping and query normalization tests |
| Map-area search | `ExchangeOpportunitiesView.tsx` | Contextual control and bounds URL tests |
| Map interaction | Existing `map/*` plus enriched RFx input | Cluster, selection, fit, map instance, 2D/3D regression tests |
| Responsive shell | Existing mobile drawer/tray/navigation plus Opportunities integration | Required viewport screenshots and Playwright workflows |

## Current completion classification

### Complete in code

- Versioned discovery projection/query contract.
- Dedicated Mapbox location-search adapter and test provider.
- City, ZIP, address, named-place suggestions, radius options, distance calculation, nearest sort, and URL-backed location state.
- Shared URL-backed sorting and advanced procurement-filter state.
- Human-readable industry/capability filter UX with versioned NAICS source metadata.
- Cursor-capable server gateway, stale-response rejection, deduplication, and incremental loading.
- Saved opportunity workflow connected to cards and detail.
- Account-scoped recent searches and normalized saved searches.
- Server-derived profile/organization personalization.
- Governed addenda, acknowledgment, Q&A visibility, audit, and notification-job records.
- Map-area search, fit-results control, and no-fabricated-coordinate messaging.
- Compact active-filter overflow and progressive-disclosure filter/detail design.

### Partially complete or configuration-dependent

- Full Census NAICS hierarchy: the launch UI includes a versioned curated subset; complete generated ingestion remains required.
- Projection coverage: new/changed RFx projection synchronization and a complete emulator/prod backfill must be exercised before compatibility fallback removal.
- Firestore indexes: definitions must be deployed and observed in the target Firebase project.
- Keyword typo tolerance: the built-in provider supports normalization, weighted fields, prefix behavior, common synonyms, and deterministic scores; a more advanced hosted provider is optional but not configured.
- Exact counts: complex relevance, geographic, and compound personalized queries disclose qualified counts.
- Map clusters: clusters represent the loaded page, not an independently aggregated full-result tile service.
- Alerts: preferences and notification jobs are stored, but external delivery is intentionally disabled pending consent and channel configuration.

### Blocked pending external acceptance

- Live Mapbox location-search exercise using an authorized token and configured domain restrictions.
- Firebase emulator security/function suite execution and target-project composite-index readiness.
- Required Playwright browser UAT and screenshot capture at every specified viewport.
- Automated accessibility scan plus documented manual screen-reader/keyboard review.
- Performance measurements at 100, 1,000, and 10,000 synthetic records.

## Release blockers that prevent a 100% claim

1. Projection backfill and ongoing synchronization have not been exercised against the Firebase emulator and target project.
2. Composite indexes have not been confirmed active in the target project.
3. Mapbox forward geocoding has not been exercised with the target project’s authorized token/domain configuration.
4. Browser UAT screenshots at the required dimensions have not yet been produced from a runnable authenticated preview.
5. Automated and manual accessibility acceptance has not yet been recorded.
6. The complete official NAICS dataset has not yet replaced the curated launch subset.
7. External alert delivery remains deliberately disabled.

## Honest status rule

The feature remains below 100% while any blocker above is open. Code compilation alone, a green unit suite alone, or visible controls alone is insufficient.