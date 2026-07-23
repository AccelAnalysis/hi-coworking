# PR #23 Organization Marker and Public Discovery Repair Audit

Date: 2026-07-23  
Repository: `AccelAnalysis/hi-coworking`  
Pull request: #23  
Branch: `codex/exchange-business-registration-map-activation`  
Base: `codex/exchange-establishments-contact-routing`  
Recorded starting head: `267168e14ef9095a08b1ee0e9dc93a4a7cce98fb`  
Validated repair commit: `c49a0f99c363f3d56563e439d473387e46affd77`

## Evidence boundary

This run had GitHub repository and GitHub Actions access. It did not have an authenticated configured-development browser session, Firebase CLI credentials, disposable test-account credentials, or direct Firestore access. Code defects and the complete local/CI command matrix were therefore reproduced and verified, but configured-development two-account evidence, exact browser Console output, persisted-record inspection, and development deployment were not fabricated or claimed.

No private addresses, private coordinates, contacts, provider payloads, account credentials, or synthetic organization/location IDs are recorded in this audit.

## Starting state

- PR #23 was open, draft, unmerged, and based on `codex/exchange-establishments-contact-routing`.
- The starting head was `267168e14ef9095a08b1ee0e9dc93a4a7cce98fb`.
- Exchange web build and Week 1 Organization Reconciliation were green on the starting head.
- Exchange security stopped at `npm audit --omit=dev --audit-level=low` because of a moderate PostCSS advisory and high Sharp advisories through the web/Next dependency path.
- The unsafe automated suggestion would have changed Next across a major compatibility boundary; it was not used.
- The PR description identified configured-development Hosting release `1784781980447000` from application commit `53e71732f950bc01b763bd502693869b6de63c6a`. Firebase Hosting was not independently queried in this run.

## Confirmed root causes

### Non-atomic marker selection

An establishment-marker click performed separate actions for the Subject organization and establishment Secondary Subject, each with its own history push. This created an intermediate subject-only URL, two browser-history entries, and an opportunity for perspective resolution to run between transitions.

### Client/server Secondary Subject drift

The shared contract and server schema supported:

```json
{
  "type": "establishment",
  "id": "<locationId>"
}
```

The client serializer omitted establishments. Workspace and URL state could therefore identify an establishment while `exchange_resolveOrganizationPerspective` received no establishment Secondary Subject.

### False unavailable and selection loss

The organization-context hook cleared the last perspective when a new request started and again on failure. A pending or retryable callable error therefore looked like an authoritative unavailable result, allowing the drawer and selected marker context to disappear.

### Apparent territory refocus

The marker click path did not directly invoke locality focus. The observed refocus is consistent with selection/perspective context clearing and the map falling back to its normal territory/results behavior. The repaired path retains Subject, Secondary Subject, marker, drawer, and viewport during loading and retryable failure. Configured browser verification is still required to exclude an independent remaining camera trigger.

### Cross-account stale discovery

The former public-organization `subscribe` API observed only an in-memory cache. It had no server invalidation source, visibility refresh, identity refresh, polling interval, or publication-generation signal. Organization search also filtered a previously loaded client array rather than issuing current server-backed organization search input.

### Missing server establishment validation

The perspective callable did not validate that an establishment belonged to the selected Subject organization or that the viewer was resolving the appropriate private or approved public projection.

## Implemented repair

### Atomic selection

One reducer action now applies the complete organization/establishment snapshot:

- Subject organization ID;
- establishment Secondary Subject ID;
- parent organization ID;
- selected map entity;
- organization drawer state;
- desktop/mobile detail state;
- optional viewport.

One marker click now produces one reducer transition, one URL snapshot, and one intentional browser-history push. Organization-only selection has an equivalent atomic action and does not fabricate an establishment.

### Complete Secondary Subject contract

`toServerSecondary` now serializes establishment, opportunity, referral, territory, organization, resource, and team contexts. Establishments are sent as `{ type: "establishment", id: establishmentId }`.

The perspective callable now validates establishment ownership against:

- `organizationLocations` for an authorized self/managed private perspective, requiring an active organization-owned establishment; or
- `publicOrganizationLocations` for an external perspective, requiring organization ownership, coordinate publication approval, and valid finite public coordinates.

The selected establishment is preserved in the returned perspective. The validation never grants organization authority from establishment selection.

### Stable perspective states

The client now distinguishes `idle`, `loading`, `resolved`, `retryable_error`, `unavailable`, and `forbidden`.

For the same validated Actor/Subject pair, loading and retryable errors retain the last verified projection, safe organization name, marker selection, drawer, and camera. Actor changes clear prior private context. Only a resolved server unavailable projection is treated as authoritative unavailability.

### Current public-directory refresh

The cache is keyed by authenticated UID, normalized query, and validated filters. It now provides:

- bounded TTL;
- concurrent-request deduplication;
- force refresh;
- rejected-request recovery without cache poisoning;
- refresh on identity change, tab visibility, restored connectivity, and a bounded interval;
- separation of private/self additions by authenticated viewer;
- no public cache key derived from unvalidated Actor URL state.

The compatibility subscription export delegates to the active server watcher rather than a cache-only listener.

### Server-backed organization search

The Exchange map sends the current organization-oriented query and relevant industries, capabilities, NAICS, certifications, locality, and resource-provider filters to the directory callable. Current results are deduplicated by canonical organization ID before marker/list presentation. List-only organizations remain searchable without a fabricated marker.

### Publication diagnostic

Added `exchange_getOrganizationPublicationDiagnostic`, limited to an exact-active organization owner/admin or platform administrator. It reports server-confirmed organization, establishment, and discovery gates and reasons, including final public-sanitizer status and expected canonical IDs.

The callable does not return private addresses, private coordinates, contacts, evidence bodies, provider payloads, or tokens. Organization Settings now displays an `Exchange visibility status` panel using the server result rather than inferring publication from selected checkboxes.

### Privacy-safe observability

Perspective logging now includes request ID, callable name, hashed viewer UID, Actor organization ID, Subject organization ID, Secondary type/ID, projection level, and failure code. It does not log addresses, contacts, auth tokens, or private document bodies.

## Tests and validation

Permanent tests cover:

- establishment Secondary serialization;
- atomic establishment and organization-only selection;
- complete single URL snapshot;
- list-only discovery without fabricated markers;
- concurrent directory-request deduplication;
- identity-bound cache separation;
- forced refresh;
- rejected-request recovery;
- approved directory/marker diagnostic;
- private-sentinel exclusion from diagnostic output;
- list-only diagnostic behavior;
- private-home marker suppression.

A guarded final validation run passed all of the following against the exact committed repair and regenerated dependency manifests:

- `npm audit --omit=dev --audit-level=low`;
- repaired dependency-tree verification;
- clean `npm ci`;
- `npm run build:shared`;
- `npm run build:functions`;
- `npm run lint`;
- `npm run test:exchange`;
- `npm run test:security`;
- `npm run test:run3`;
- `npm run test:run4`;
- `npm run build` with the official CI Firebase demo environment;
- `git diff --check`.

The dependency remediation pins safe web-workspace versions and regenerates the lockfile without weakening the audit step or severity. The committed web manifest resolves PostCSS `8.5.22` and Sharp `0.35.3`. No unsafe Next downgrade was used.

## Configured-development work still required

PR #23 is not complete until the following are performed with real configured-development access:

- create Accounts A and B through the real business-only UI;
- record exact organization/location IDs;
- reproduce and capture the exact pre-repair Console/callable error if it remains obtainable;
- run own-marker and external-marker 20-click stress tests;
- verify one history transition per click in the browser;
- verify all four modes, Back, Forward, and refresh preservation;
- verify already-open Account B sees publish and unpublish changes within the bounded interval;
- verify fresh-account exact-name, partial-name, capability, NAICS, certification, and locality discovery;
- verify list-only and private-home scenarios;
- inspect exact final persisted records and public/private field isolation;
- run browser matrix, Axe, keyboard, mobile-overflow, Console, and page-error acceptance;
- query exact configured Function/Hosting/rules/index inventory;
- deploy only the reviewed development resources if the configured acceptance passes;
- audit and remove disposable accounts/records created by configured acceptance.

## Safety and change controls

No seed organizations were reviewed, approved, or imported. No Stripe, mail, social, production, canonical-branch, or merge action occurred. No Firebase Function, Hosting, rules, or index resource was deployed in this run. Temporary repair workflows and scripts were removed after the validated repair commit. PR #23 remains draft and unmerged.
