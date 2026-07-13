# Run 2 Exchange workspace foundation

Status: implementation and release evidence
Recorded: 2026-07-13
Production deployment: **not performed**

## 1. Run 1 final branch and SHA

- Worktree: `/Users/jonathanholman/Code/Hi-Coworking/hi-coworking-exchange-run-1`
- Branch: `codex/exchange-run-1-secure-foundation`
- Starting/base SHA: `a9f16ff91421f8ba5699baf9e2e0059e43dbc69e`
- Final SHA: `125454aa387ef2472a993a7a29e9fd8b216d6a97`
- Final source/security commit: `5587c68 fix(exchange): close authority and private storage gaps`
- Final evidence commit: `125454a docs(exchange): close Run 1 release evidence`

The remaining Run 1 Functions source/generated JavaScript, callable integration,
rules, indexes, tests, and documentation were reconciled, tested, committed, and
left in a clean worktree before Run 2 began. No production deploy, migration,
secret, billing, credit, or financial change was made.

## 2. Run 1 remote and PR state

The Run 1 branch is pushed and its remote SHA matches
`125454aa387ef2472a993a7a29e9fd8b216d6a97`. Draft pull request
[#1](https://github.com/AccelAnalysis/hi-coworking/pull/1) targets `main`. Run 1
was not merged as part of Run 2.

Run 1 local closure gates passed: clean install, zero production audit findings,
shared/Functions/web builds, lint with only five pre-existing warnings, 35
Functions tests, 14 rules tests, 22 migration tests, and the combined 71-test
security suite. The PR's final hosted status is recorded in the release handoff
and final response rather than inferred here.

## 3. Run 2 base branch and SHA

- Worktree: `/Users/jonathanholman/Code/Hi-Coworking/hi-coworking-exchange-run-2`
- Branch: `codex/exchange-run-2-workspace-foundation`
- Base branch: `codex/exchange-run-1-secure-foundation`
- Exact base SHA: `125454aa387ef2472a993a7a29e9fd8b216d6a97`

The original dirty `main` worktree remained read-only and was not reset,
cleaned, rebased, stashed, or used as the implementation base. Its separate
local billing work was not absorbed.

## 4. Stacked branch state

Run 2 is intentionally stacked because Run 1 was not merged. Its pull-request
base is `codex/exchange-run-1-secure-foundation`, not `main`; its head is
`codex/exchange-run-2-workspace-foundation`. Neither pull request is merged by
this run.

## 5. Design-reference interpretation

The production interpretation is recorded in
`docs/exchange/run-2-design-interpretation.md`. It preserves the compact command
area, dominant discovery surface, collapsible context panels, and synchronized
selection. It adapts the prototype's global supply-chain view into regional
approved/open RFx and released/scheduled territories. It rejects prototype
contacts, risk claims, analytics, relationship arcs, globe behavior, unsupported
tabs, mock commerce, Three.js/React Three Fiber, Recharts, Framer Motion, and a
second mapping framework.

## 6. Workspace architecture

`/exchange` is a thin authenticated static-export-compatible route. The
feature-oriented `apps/web/src/features/exchange` boundary separates:

- reducer actions/types and the public URL codec;
- bounded repository reads, stale-response protection, record merging, and
  memoized selectors;
- command bar, filters, desktop panels, progressive result lists, responsive
  drawer/sheet, entity details, and reusable state views;
- Mapbox construction, configuration, GeoJSON, sources, layers, events,
  selection, viewport, resize, and cleanup;
- small formatting, filtering, and focus-management utilities.

Fetched data is not stored in the interaction reducer. Protected server logic
is not moved into the browser.

## 7. Shell contract

`AppShell` now has an explicit `variant="site" | "workspace"` contract. `site`
is the default and retains existing footer, width, and content behavior.
`workspace` opts into `h-dvh`, full width, `min-h-0`, contained scrolling, and
no standard footer. `/exchange` is the only route using the workspace variant.

The authenticated navigation retains account/notification controls and adds an
Exchange entry. At widths below `1280px`, the expanded link set becomes an
accessible drawer with `aria-expanded`, focus containment, Escape close, body
scroll lock, route/breakpoint close, and focus restoration.

## 8. Reducer state

One reducer owns the `opportunities` view, `map | list | split` mode, RFx or
territory selection, search, NAICS, territory, discoverable RFx-status,
territory-status and released-territory-first ranking filters, desktop panel
state, mobile drawer/sheet state, and normalized Mapbox viewport. Explicit
actions cover search/filter changes and reset, surface mode, selection, panel
open/close, mobile open/close, viewport, and full URL hydration.

Defaults are split mode, no selection or explicit filters, expanded left panel,
closed details, and released-territory-first ranking. The internal `localFirst`
name remains for URL/state compatibility; the UI and documentation state that
it is ranking only and never grants locality, permission, or transaction
eligibility.

## 9. URL schema

The allowlisted shareable schema is:

```text
view=opportunities
mode=map|list|split
q=<public search text>
territory=<fips[,fips]>
naics=<2-6 digit code[,code]>
rfxStatus=open
territoryStatus=released|scheduled
local=1|0
entity=rfx|territory
selected=<bounded public identifier>
lng=<longitude>&lat=<latitude>&z=<zoom>&b=<bearing>&p=<pitch>
```

The parser bounds lengths/counts, validates enum/numeric/geographic values, and
ignores invalid values. Defaults are omitted. Drawer animation, fetched records,
identity/auth state, and private fields cannot enter the URL. Search, NAICS, and
viewport writes are debounced `replace` operations; deliberate mode, filter,
and selection changes use `push`. Pending replaces are cancelled before pushes,
local writes are identified without rehydrating stale state, and `popstate`
authoritatively restores Back/Forward state.

## 10. Map lifecycle

`useExchangeMap` captures immutable first-render token/viewport options in refs.
Its construction effect depends only on stable container and helper identities,
not records, filters, selection, panels, URL state, or inline callback identity.
It constructs at most one Mapbox instance for each mounted component and calls
`map.remove()` only during unmount or an explicit retry remount.

Separate effects/ref-backed helpers update source data with `setData`, selected
feature state plus a nonclustered selected-RFx overlay, URL-restored viewport,
explicit fit requests, and resize signals. Base and layer interaction handlers
are registered once and their callbacks dereference the latest callback ref.
Cleanup removes handlers, observers, animation frames, and the map.

## 11. Map source and layer registry

Six stable GeoJSON source IDs cover clustered RFx, the selected RFx overlay,
released territory points/boundaries, and scheduled territory points/boundaries.
Twelve stable layer IDs cover released/scheduled fill, outline, points and
scheduled labels plus RFx clusters, cluster counts, ordinary points, selected
point, and labels.

RFx use `promoteId: "id"`, clustering with radius 45/max zoom 12, and an
independent selected-point source so a list-selected RFx remains visible when
its ordinary point is inside a cluster. Territory and RFx selection uses feature
state. GeoJSON conversion rejects invalid geometry/coordinates while retaining
the source record for list discovery.

## 12. Data-access paths

The repository uses only secured Run 1 paths:

- `getOpenRfxListFromFirestore(200)` for the bounded discovery baseline;
- `getOpenRfxByViewportGeohash(bounds, 220)` for bounded latest-viewport RFx;
- `listReleasedTerritoriesFn({})`, split defensively into released/scheduled;
- best-effort `listManagedRfxFn({ maxResults: 200 })` only to label links into
  existing owned-RFx workflows.

Every RFx is rechecked client-side as approved/open before presentation. The
latest viewport replaces the prior viewport cache, duplicates use newest-first
stable resolution, and at most one already-loaded approved/open selected RFx is
pinned across later pans. Arbitrary selected IDs do not trigger a read. Version
counters and a viewport debounce discard stale responses. No protected write,
broad collection read, private profile/referral read, team-wide reload, or
selection-driven fetch was added.

## 13. Loading and error states

The route keeps authentication behind `RequireAuth` and Suspense. Reusable safe
copy covers initial loading, true empty, filtered empty/reset, unknown error and
retry, permission denial, unavailable deep-link selection, missing token, map
failure, no geocoded RFx, and scheduled-territory explanation. Browser
online/offline state and viewport-refresh failures use non-destructive degraded
banners so an existing safe snapshot remains visible.

A missing `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` selects list mode, disables map-only
controls, names the missing configuration, and never renders a blank/crashed map.
Unknown errors are not mislabeled as permission failures and raw stack/internal
details are never displayed.

## 14. Desktop behavior

At `1440 × 900`, authenticated site navigation and a compact Exchange command
bar sit above a footerless full-height workspace. The 320px discovery panel
collapses without remounting the map. The central surface supports map, list,
and split. An RFx/territory selection opens a closeable context panel and leaves
selection, filters, and viewport stable. The list progressively renders bounded
chunks while ensuring the selected record is present and scrolled into view.

## 15. Tablet behavior

At `1024 × 768`, the site navigation moves to its accessible drawer so links do
not collide. Exchange search and mode/action controls remain usable, the
discovery panel remains collapsible, and split remains available at the exact
supported threshold. The navigation drawer's backward focus wrap, Escape close,
and focus restoration were exercised manually.

## 16. Mobile behavior

At `390 × 844`, the desktop columns are replaced by a compact two-row command
area, map/list controls, filter access, refresh/create controls, and a full-width
discovery surface. Filters open in an `aria-modal` drawer with backdrop, stable
ID/`aria-controls`, focus containment, Escape, Apply/Clear, active-filter chips,
and restored trigger focus. Selection opens an accessible detail bottom sheet;
explicit dismissal clears the selection but not filters. Controls use mobile
touch sizing, safe-area padding, contained scroll regions, and reduced-motion
CSS.

## 17. Accessibility decisions

- A semantic heading and list alternative exist even when the map is present.
- Mode controls use pressed state; panel/drawer controls expose expanded and
  controlled state; icon controls have accessible names.
- App navigation, filter drawer, and detail sheet manage initial focus, wrap
  Tab/Shift+Tab, support Escape/backdrop/close, lock background scrolling, and
  restore focus when a trigger exists.
- Blocking state surfaces make hidden workspace controls inert.
- Text accompanies every status/color; focus rings are visible; mobile targets
  are approximately 44px; smooth list scrolling respects reduced motion.

## 18. Performance decisions

- One Mapbox construction per mounted map; stable callback refs; explicit
  handler cleanup; `setData` and feature-state updates.
- Map code is dynamically loaded only when the Exchange map component is
  rendered; token-missing/list-only users retain the shell and list path.
- Bounded 200-record baseline and 220-record latest viewport, stale-response
  protection, a one-record selection pin, and no selection-triggered reload.
- Memoized filter-only selector input prevents viewport/panel/selection changes
  from rebuilding GeoJSON.
- Debounced high-frequency URL/viewport writes, explicit fit-to-results, and
  ResizeObserver plus panel signals instead of automatic viewport resets.
- Progressive 40/60-card list chunks avoid rendering the entire bounded cache
  immediately.

## 19. Existing-route compatibility

`/rfx`, `/directory`, and `/referrals` retain their routes, default site shell,
footer, and navigation. `/rfx/new`, `/rfx/detail`, and `/rfx/evaluate` remain the
authoritative create/detail/evaluation workflows and are linked from Exchange;
no secure editor/evaluator was duplicated in the workspace. The reusable
`MarketplaceMap` adapter preserves the existing RFx/territory property contract.

One intentional visual compatibility change is recorded: the former decorative
Hi hub marker and delayed 3D-building extrusion are not recreated by the new
regional data-focused map adapter. RFx points, clusters, territories, selection,
viewport, fit, controls, and attribution remain supported.

## 20. Referral-commerce scope decision

`docs/exchange/referral-commerce-decision.md` preserves business referrals as
private business-to-business introductions distinct from platform membership
invitations. It records the approved future 100-basis-point fee as 1% of the
**gross referral payout**, not the customer transaction, and requires structured
offers plus immutable accepted-rate/term snapshots.

Run 2 contains no fee calculation, offer publishing, checkout, Stripe Connect,
transfer, settlement, dispute, fraud/trust score, referral analytics, or false
operational UI. A future `connections` view can extend the shell/reducer/URL and
responsive panel framework, but remains hidden pending secure data/actions and
legal/finance approval.

## 21. Tests added

Seven Vitest files cover:

- reducer defaults/actions, panels, mobile state, hydration, and invalid input;
- URL parsing/serialization, defaults, bounds, filters, deep links, viewport,
  public allowlisting, and history-compatible state;
- filtering/NAICS normalization, approved/open and released/scheduled selectors,
  memoization, ranking semantics, and bounded record/pin merging;
- GeoJSON validation, stable IDs, sources/layers, clustering, selected overlays,
  feature state, viewport reading, and event registration/cleanup;
- site/workspace shell contracts and existing route defaults;
- reusable loading/empty/error/permission/token/no-geocode/scheduled state copy.

The CI workflow now runs on every pull request and includes `npm run
test:exchange` in addition to the retained security/build/lint gates.

## 22. Exact test results

Final local clean-install results:

- `npm ci`: passed; 1,170 packages added, 1,174 audited, 21.34s. npm emitted
  the known Node 22-versus-required-Node-20 engine warning and reported three
  moderate dev-inclusive findings.
- `npm audit --omit=dev`: passed; 0 vulnerabilities, 0.73s.
- `npm run build:shared`: passed, 1.39s.
- `npm run build:functions`: passed, 2.94s.
- `npm run lint`: passed with **0 errors** and the same **5 pre-existing
  warnings**, 6.61s.
- `npm run test:exchange`: **7 files, 60/60 tests passed**; Vitest 907ms,
  wall time 2.10s.
- web TypeScript (`npx tsc --noEmit` in `apps/web`): passed in the integrated
  pre-gate verification.
- demo-emulator static `npm run build`: passed, **52/52 routes** generated,
  including `/exchange`, `/rfx`, `/directory`, and `/referrals`; 19.51s wall
  time (Next compile 6.7s, TypeScript 5.7s).
- `git diff --check`: passed, 0.01s.
- strong credential-value scan: clean across the then-current 53 source/evidence
  changes; the subsequently added architecture record contains no credentials.

The four emulator-backed commands were invoked locally, but the Firebase CLI
stopped before Vitest because this host has no Java runtime (`java -version`
exited 1). These are environment blocks, not passing local runs:

- `npm run test:functions`: environment-blocked after shared/Functions builds,
  5.57s.
- `npm run test:rules`: environment-blocked, 1.40s.
- `npm run test:migrations`: environment-blocked after the Functions build,
  4.05s.
- `npm run test:security`: environment-blocked after shared/Functions builds,
  5.14s.

The exact Run 1 base used by Run 2 had already passed all four locally (35
Functions, 14 rules, 22 migrations, and 71 combined security tests), and Run 2
does not modify Functions, rules, indexes, or those tests. The Run 2 pull-request
workflow installs Temurin Java 21 and reruns the combined 71-test security suite;
its hosted result is reported in the final handoff.

Manual browser results:

- `1440 × 900`, `1024 × 768`, and `390 × 844` screenshots captured at their
  exact dimensions under `docs/exchange/screenshots`.
- App navigation and mobile filter/detail focus wrapping, Escape close, and
  trigger restoration passed.
- Multi-code NAICS committed as `naics=541330%2C236220` and hydrated correctly.
- Browser Back removed `territoryStatus=scheduled` and its checked state;
  Forward restored both.
- Direct selected-RFx URLs opened desktop detail context and mobile detail sheet.
- Missing-token list fallback and safe backend-error/retry state rendered.

## 23. Files changed

Shell and route:

- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/components/appShellContract.ts`
- `apps/web/src/app/exchange/page.tsx`

Exchange feature:

- `apps/web/src/features/exchange/components/*` (15 component/copy files)
- `apps/web/src/features/exchange/state/*` (4 reducer/action/type/URL files)
- `apps/web/src/features/exchange/data/*` (5 repository/hook/selector/state files)
- `apps/web/src/features/exchange/map/*` (8 lifecycle/config/GeoJSON files)
- `apps/web/src/features/exchange/utils/*` (3 utility files)

Compatibility, tests, configuration, and evidence:

- `apps/web/src/components/rfx/MarketplaceMap.tsx`
- `tests/exchange/*.test.ts` (7 files)
- `.github/workflows/exchange-security.yml`
- `package.json`
- `docs/exchange/run-2-design-interpretation.md`
- `docs/exchange/referral-commerce-decision.md`
- `docs/exchange/run-2-workspace-foundation.md`
- `docs/exchange/screenshots/run-2-{1440x900,1024x768,390x844}.jpg`

No Firestore/Storage rule, index, Functions authority, private referral schema,
lockfile, dependency, secret, or production configuration was changed.

## 24. Known limitations

- The local environment had no Mapbox token, so responsive QA proved the
  required list fallback but could not manually exercise live WebGL controls,
  attribution, cluster expansion, or map-load retry. Map lifecycle behavior is
  covered by pure module tests, TypeScript, and the production build.
- Local QA intentionally ran Auth only; Firestore/Functions were unavailable,
  so it exercised safe error/retry and deep-link states rather than live records,
  long production titles, scheduled release dates, or a populated map/list.
- A valid selected RFx remains stable only after it has entered the bounded
  baseline/viewport cache. An arbitrary deep link outside that cache reports
  unavailable and never causes an ID-based discovery fetch.
- The bounded list uses progressive rendering, not window virtualization.
- The `/rfx` adapter intentionally omits the old decorative Hi marker and 3D
  building extrusion.
- The internal `localFirst` state/URL key is retained for compatibility although
  the visible meaning is released-territory-first ranking.

## 25. Deferred capabilities

Deferred from Run 2: full business-referral/Connections workspace and commerce;
settlement and financial code; businesses/resources/places; grants, loans,
incentives, technical assistance, workforce, properties/sites; relationship
graphs; AI matching/recommendations; watchlists/Attention Center; analytics and
operations dashboards; migrations; production deployment; and unrelated
booking, floor-plan, kiosk, or platform redesign.

## 26. Run 3 prerequisites

Before expanding the workspace:

1. Merge/rebase the Run 1 and Run 2 review chain deliberately and preserve the
   security baseline.
2. Provide a non-production Mapbox token and seeded approved/open RFx plus
   released/scheduled territory fixtures for full browser integration QA.
3. Decide whether selected-record deep links need a new bounded server-authorized
   resolution path without coupling ordinary viewport fetching to selection.
4. Measure populated-list/map performance and choose a virtualization threshold.
5. Decide whether the old decorative hub/3D treatment belongs in the reusable
   map without weakening lifecycle stability or accessibility.
6. For business-referral commerce, approve rounding, payment/funds flow, tax,
   legal terms, refund/chargeback, timing, evidence, disputes, and trust/fraud
   policy before implementing any financial code or UI.
