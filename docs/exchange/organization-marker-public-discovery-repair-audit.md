# PR #23 Organization Marker and Public Discovery Repair Audit

Date: 2026-07-23  
Repository: `AccelAnalysis/hi-coworking`  
Pull request: #23  
Branch: `codex/exchange-business-registration-map-activation`  
Base: `codex/exchange-establishments-contact-routing`  
Recorded starting head: `267168e14ef9095a08b1ee0e9dc93a4a7cce98fb`

## Scope and evidence boundary

This repair run used the GitHub repository and GitHub Actions evidence available through the connected GitHub integration. It did not have an authenticated browser session, Firebase CLI credentials, configured-development test-account credentials, or direct Firestore access. Therefore this document distinguishes code-level reproduction and CI evidence from configured-development UI evidence. No organization IDs, location IDs, private addresses, private coordinates, contacts, provider payloads, or test-account credentials are invented or recorded.

Configured two-account registration, persisted-record inspection, callable request/response capture, browser console capture, Firebase deployment, and synthetic-account cleanup remain required before PR #23 can be declared complete.

## Starting state

- PR #23 was open, draft, unmerged, and based on `codex/exchange-establishments-contact-routing`.
- The head was `267168e14ef9095a08b1ee0e9dc93a4a7cce98fb`.
- Exchange web build and Week 1 Organization Reconciliation had succeeded on that head.
- Exchange security failed before functional tests because `npm audit --omit=dev --audit-level=low` reported a moderate PostCSS advisory and high Sharp advisories through the web application's Next.js dependency path.
- The PR description identifies the configured-development Hosting release as `1784781980447000`, application commit `53e71732f950bc01b763bd502693869b6de63c6a`, but this run could not independently query Firebase Hosting to verify that deployment inventory.

## Code-level defect reproduction

### Establishment selection was not atomic

Before repair, one establishment marker click executed separate workspace operations:

1. open organization drawer;
2. set Subject organization with a browser-history push;
3. set establishment Secondary Subject with a second browser-history push.

Each history-bearing action serialized the intermediate reducer state. The first URL therefore contained a Subject without the establishment. The second URL added the establishment separately. Back/Forward could restore the intermediate subject-only state, and perspective resolution could run between the two transitions.

### Establishment was dropped from the perspective request

The client shared-state type allowed an `establishment` secondary context, and the server schema accepted:

```json
{
  "type": "establishment",
  "id": "<locationId>"
}
```

However, `toServerSecondary` did not serialize establishments. A selected marker could remain present in workspace state and URL state while the perspective callable received no establishment secondary context. This was confirmed as client/server contract drift.

### Perspective loading erased safe context

The organization-context hook cleared the current perspective when a new request began and also cleared it when the request failed. The drawer then received no organization projection and rendered its unavailable fallback. This made a transient request look like an authoritative unavailable result and allowed the UI to lose the safe public name already carried by the selected map feature.

### Public organization subscription was not server-live

The former public-organization `subscribe` function only attached listeners to an in-memory cache. It had no Firestore listener, callable invalidation source, visibility refresh, identity refresh, polling interval, or publication-generation signal. A second account that had already loaded the Exchange could remain stale after publication or suppression.

### Organization search used stale directory input

The server already exposes a bounded organization-directory callable with current query/filter evaluation. The persistent workspace map nevertheless loaded a broad client directory and filtered that array locally. Organization-oriented search could therefore use stale records and could not force current exact/partial name resolution.

### Territory refocus was a downstream symptom

The marker click path itself did not directly call locality focus. The observed territory refocus is consistent with selection/perspective context being cleared while map/results fallback logic remains active. The repair prevents a pending or retryable perspective request from clearing Subject, Secondary Subject, selected marker, drawer, or viewport. Configured browser evidence is still required to confirm there is no remaining independent fit-to-territory trigger.

## Implemented repair

### Atomic organization and establishment selection

Added one action creator that hydrates the complete selection snapshot in a single reducer transition:

- Subject organization ID;
- establishment Secondary Subject and parent organization ID;
- selected map entity;
- organization drawer open;
- right/detail panel open;
- mobile detail open;
- optional viewport.

Marker selection and Return to Organization Home now issue one action and one intentional history push.

### Complete client serialization for establishments

`toServerSecondary` now returns the shared establishment contract. Existing opportunity, referral, territory, organization, resource, and team mappings are preserved.

### Stable perspective loading and retry behavior

The hook now distinguishes:

- `idle`;
- `loading`;
- `resolved`;
- `retryable_error`;
- `unavailable`;
- `forbidden`.

For the same validated Actor/Subject pair, loading and retryable errors retain the last verified projection. Actor changes clear the prior projection so private data cannot cross an identity boundary. Only a resolved server response with unavailable projection semantics is treated as authoritative unavailability.

### Current server-backed directory refresh

The former cache-only subscription was replaced by a bounded callable refresh architecture that:

- keys cache entries by authenticated viewer UID, normalized query, and validated filters;
- uses a short bounded TTL;
- deduplicates concurrent requests;
- does not cache rejected promises;
- supports force refresh;
- refreshes when the tab becomes visible;
- refreshes when connectivity returns;
- refreshes on a bounded interval;
- uses current server search terms and filters;
- does not key public data by Actor URL state.

A compatibility export remains for existing view consumers, but it now delegates to the active server watcher rather than subscribing to an in-memory cache.

### Server-backed organization-oriented search

The persistent Exchange map now supplies the current search query, industries, capabilities, NAICS, certifications, locality, and resource-provider context to the directory callable. Returned organizations still pass view-specific client presentation filtering. List-only organizations remain selectable without a fabricated establishment marker.

### Refresh status

When verified organizations are already displayed, the map presents a small non-blocking status while the directory refreshes or when a refresh is delayed.

## Tests added

Added `tests/exchange/organization-marker-public-discovery-repair.test.ts` covering:

- establishment Secondary serialization;
- one atomic reducer transition for organization/establishment selection;
- one complete URL snapshot;
- list-only organization selection without a fabricated marker;
- concurrent server request deduplication;
- authenticated identity-bound cache separation;
- force refresh despite valid TTL;
- rejected request recovery without cache poisoning.

## CI evidence during repair

An intermediate head failed the web build because a legacy opportunities view still imported the old subscription export. The build artifact reported that exact missing export. The repository was then corrected by retaining the export as an active server-watcher compatibility wrapper.

The Exchange security workflow still exits at the production dependency audit before shared build, functions build, lint, Exchange tests, security tests, Run 3, Run 4, production build, and diff check. This behavior is not treated as a green functional or security result.

## Dependency diagnostic

The lockfile contains web-workspace nested copies installed through Next.js:

- Next.js `16.2.11` declares exact PostCSS `8.4.31`;
- Next.js `16.2.11` declares optional Sharp `^0.34.5`;
- the nested installation resolves Sharp `0.34.5`;
- root overrides and root lock entries already reference newer PostCSS and Sharp versions, but those overrides did not eliminate the nested web-workspace copies used by the audit path.

The unsafe automatic command proposes a major downgrade and was not used. The audit severity was not weakened, suppressed, or removed. A lockfile regeneration with a forward-compatible package-manager resolution remains required and must be validated with the full command matrix.

## Work not completed in this integration-only run

The following remain blocking:

- real UI creation of Accounts A and B;
- pre-repair configured-development failure capture;
- exact repeated browser Console error and callable request ID;
- exact persisted organization/location IDs;
- server-authoritative publication diagnostic and Organization Settings visibility panel;
- server validation that an establishment belongs to the selected Subject organization and is visible at the viewer's authorized projection level;
- configured own-marker and external-marker 20-click stress tests;
- already-open second-account publication and suppression acceptance;
- fresh-account exact, partial, capability, and locality search acceptance;
- list-only, unpublish, and private-home configured scenarios;
- exact persisted-record assertions;
- browser matrix, Axe, keyboard, and mobile-overflow acceptance;
- dependency lock remediation and green Exchange security workflow;
- Firebase Function, Hosting, rules, or index deployment;
- synthetic test-account and test-record cleanup audit.

## Safety and change controls

No seed organizations were reviewed, approved, or imported. No Stripe, mail, social, production, canonical-branch, PR merge, or unexpected Function deletion action occurred. PR #23 remains draft and unmerged.
