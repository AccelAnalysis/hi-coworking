# Run 2 Exchange design interpretation

Status: implementation decision record
Recorded: 2026-07-13
Product: **Hi Exchange — Regional business and opportunity workspace**

## References inspected

The following source references were inspected before broad implementation:

- `Design References/Procurement Platform Mockup Image.png` (2816 × 1536);
- `Design References/procurementplatform.tsx`;
- `Design References/3d_procurement_platform.tsx`.

The image and prototypes communicate a command-center composition: a compact
top command area, a dominant spatial surface, a collapsible results/context
panel on the left, and a selection-specific detail panel on the right. The two
prototype files are illustrative mock applications. They use hard-coded global
supply-chain data, Three.js or React Three Fiber, Recharts, Framer Motion,
prototype contacts, relationship arcs, and unsupported analytics. They are not
production dependencies or data contracts.

## 1. Reference patterns to preserve

- A map-centered workspace that uses the full available viewport.
- Clear visual hierarchy between command bar, discovery surface, results, and
  selected-record context.
- Collapsible desktop panels that make spatial room without navigating away.
- Persistent search near the top of the experience.
- A closeable, context-sensitive detail region.
- Dense but scannable status cards and compact controls.
- Coordinated map/list selection.

## 2. Reference patterns to adapt

- The global globe becomes the existing regional Mapbox 2D/2.5D map.
- Supplier nodes become approved, open RFx points and released/scheduled
  territory shapes or centroids.
- Prototype analytics/navigation become a bounded RFx/territory result list and
  real filters supported by production data.
- The dark operations-center aesthetic becomes a Hi Coworking slate, indigo,
  emerald, and amber workspace with readable light panels and a dark command
  bar.
- Fixed prototype sidebars become responsive panels, a mobile filter dialog,
  and a mobile detail bottom sheet.
- Hover-only cues gain labels, focus states, and touch behavior.

## 3. Reference patterns to reject

- Supply-chain, supplier-tier, facility, logistics, resiliency, risk, and
  manufacturing terminology.
- Palantir-like identity, globe behavior, arbitrary dependency arcs, live-risk
  claims, simulated analytics, and mock alerts.
- Mock businesses, contacts, transactions, scores, and operational claims.
- Three.js, React Three Fiber, Drei, Recharts, Framer Motion, and a second map
  framework for this workspace.
- Unsupported tabs for businesses, connections, grants, finance, properties,
  referrals, analytics, or an Attention Center.
- Color-only status communication and ambiguous icon-only navigation.

## 4. Hi Coworking terminology

- Product name: **Hi Exchange**.
- Description: **Regional business and opportunity workspace**.
- Current entities: **RFx opportunities** and **territories**.
- Territory states: **Released** and **Scheduled**.
- Primary actions: **Create RFx**, **View RFx**, **Evaluate RFx** when managed,
  **Show on map**, **Fit results**, **Filters**, and **Clear filters**.
- The workspace does not call RFx issuers suppliers and does not describe
  scheduled territories as transaction-enabled.

## 5. Icon choices

Use the existing `lucide-react` dependency. Search, SlidersHorizontal, Map,
List, Columns3, PanelLeftClose/Open, PanelRightClose, MapPin, CalendarDays,
CircleDot, Plus, ExternalLink, RefreshCw, WifiOff, TriangleAlert, X, and
ChevronUp/Down match their actual actions. Every icon-only control receives an
accessible name and title; important actions also retain visible text where
space permits.

## 6. Desktop layout

- Existing authenticated site navigation remains at the top.
- A compact Hi Exchange command bar sits below it.
- The workspace body fills the remaining viewport height.
- A collapsible 320–360 px left results panel, flexible map/list surface, and
  conditional 340–380 px right detail panel form the desktop composition.
- The central map remains mounted while desktop panels open or close.
- Split mode shows the map plus a compact list without duplicating data fetches.

## 7. Tablet layout

- The command bar wraps only secondary controls and keeps search usable.
- The left panel becomes narrower or overlays the central surface.
- The right detail context overlays rather than compressing the map below a
  usable width.
- Map and list remain available; split mode may be normalized to map or list at
  constrained widths without losing reducer state.

## 8. Mobile layout

- The three-column desktop layout is not reproduced.
- A compact command bar provides search, map/list mode, and filter access.
- Filters use a modal drawer with a backdrop, focus containment, Escape close,
  restored focus, Apply, and Clear.
- A selected RFx or territory opens a bottom sheet with a stable scroll region.
- Safe-area padding protects controls and sheet actions.
- The list is a complete non-map discovery alternative.

## 9. Command-bar behavior

The command bar identifies Hi Exchange, exposes search, current result count,
map/list/split presentation controls where supported, filter count/access,
clear filters, Create RFx, and an exit link to the dashboard. Controls are
keyboard reachable, compact, and placed away from Mapbox controls.

## 10. Left-panel behavior

The left panel contains the current result summary, entity/filter controls, RFx
and territory cards, selection state, and true/filtered empty states. Collapse
is reducer-owned, updates `aria-expanded`, preserves results and selection, and
causes `map.resize()` rather than map reconstruction.

## 11. Right-panel behavior

The right panel renders only the selected RFx or territory. It is closeable and
keyboard accessible, shows factual production fields, and links to established
RFx workflows. It does not perform secure editing, evaluation, referral, or
settlement actions.

## 12. Mobile drawer behavior

The drawer is transient UI state and therefore absent from the URL. It uses
`role="dialog"`, `aria-modal="true"`, an accessible title, backdrop dismissal,
Escape close, focus containment, and focus restoration. Active filters remain
visible as count/chips after dismissal.

## 13. Bottom-sheet behavior

Selection opens the sheet on mobile. Closing the selected record explicitly
clears selection; changing mode or closing other panels does not. The sheet uses
CSS transitions that are disabled by `prefers-reduced-motion`, keeps a stable
scroll region, and does not own or recreate the map.

## 14. Map interaction

- Select RFx points and territory features.
- Expand clusters deliberately.
- Clear selection with an empty-background click.
- Emit debounced viewport changes.
- Fit results only on explicit request.
- Preserve Mapbox attribution and navigation controls.
- Fall back to list mode when the token or map load is unavailable.

## 15. List interaction

Cards use semantic buttons/links, visible selection, entity/status text, and
keyboard focus. Selecting a list record synchronizes the map and detail context;
map selection scrolls the matching card into view when practical.

## 16. Selection behavior

Selection is the reducer-owned discriminated union `{entityType, entityId}`.
It is shareable through `entity` and `selected` URL parameters, survives
presentation-mode changes, emphasizes the corresponding map feature/card, and
never triggers a full data reload.

## 17. Search and filtering behavior

Search matches only public discovery fields such as RFx title, description,
issuer display name, location, NAICS code, territory name, state, and FIPS.
Filters cover NAICS, territory, territory status, and **Released territories
first** ranking. The URL parser accepts only the discoverable `open` RFx status;
Run 2 does not expose a broader status picker. The internal `localFirst` field is
retained for URL/state compatibility, but it is explicitly a ranking preference,
not a member-locality or eligibility decision. Memoized selectors derive results
from bounded baseline and latest-viewport caches plus, at most, one already-loaded
selected RFx. Clear resets filters without resetting viewport or silently
selecting another record.

## 18. Loading and empty states

Authentication loading prevents unauthorized flashes. Initial data loading uses
contained skeletons. True empty, filtered empty, error/retry, permission denied,
missing Mapbox token, map failure, offline/degraded, no-geocoded-RFx, and
scheduled-territory states have distinct, safe copy and actions.

## 19. Accessibility adaptations

- A list alternative exists for every map-discoverable record.
- Drawers/sheets manage focus and Escape behavior.
- Panel and mode controls expose names, `aria-pressed` or `aria-expanded`, and
  visible focus rings.
- Status always includes text.
- Live result/error updates use restrained status regions.
- Touch targets are at least approximately 44 px on mobile.
- Motion respects reduced-motion preferences.

## 20. Performance adaptations

- Construct one Mapbox instance per mounted Exchange map.
- Register sources, layers, and events once after map load.
- Update data via `GeoJSONSource.setData`.
- Update selection through feature-state or paint expressions.
- Store callbacks in refs so inline identities do not recreate listeners.
- Debounce URL/viewport writes and bound Firestore results.
- Memoize filtering and avoid selection-driven fetching.
- Use ResizeObserver and explicit panel-transition resize signals.

## 21. Production components to reuse

- `AppShell` through a new explicit workspace variant.
- `RequireAuth` and `useAuth` for the existing auth boundary.
- Run 1 `getOpenRfxListFromFirestore`, viewport RFx query, and
  `listReleasedTerritoriesFn` paths behind a small repository.
- Shared `RfxDoc` and `TerritoryDoc` contracts.
- Existing RFx detail, evaluation, and create routes.
- Existing Mapbox dependency and established regional center.

## 22. New components to create

Create a feature-oriented `features/exchange` boundary containing the workspace,
command bar, results/filter panels, entity cards/details, responsive drawer and
sheet, state views, reducer/URL utilities, repository hook/selectors, and map
lifecycle/source/layer/event modules. Keep the `/exchange` route thin.

## 23. Prototype dependencies not to adopt

Do not add Three.js, React Three Fiber, Drei, Recharts, Framer Motion, a globe
engine, or another map library. Existing Lucide, React, Next.js, Tailwind, and
Mapbox are sufficient.

## 24. Mock versus production data

The references assume global facilities, routes, suppliers, risks, spend,
contacts, scores, marketplace inventory, and simulated actions. Production
currently authorizes only approved/open RFx discovery plus released/scheduled
territories for this workspace. Some RFx have no coordinates and some
territories may have only centroids or only boundaries; the UI must preserve
those records in list mode. No prototype contact, risk, commerce, or analytics
field is mapped or fabricated.

## Current implementation audit decisions

- `/rfx` currently mixes discovery, saved RFx, teams, protected actions, filters,
  and map state. It remains backward compatible; Run 2 extracts only read-only
  presentation/map concepts for `/exchange`.
- The former `MarketplaceMap` reconstructed Mapbox whenever data, selection, or
  callback identities changed. The reusable Exchange map now splits construction,
  data, selection, viewport, resize, and cleanup lifecycles.
- The former `AppShell` contract had a `fullWidth` boolean but always rendered
  the footer. The explicit `variant="workspace"` contract preserves the default
  site shell while removing footer/width/scroll constraints only when requested.
- Next.js uses static export, so the route remains client-rendered behind
  `RequireAuth`; URL hydration uses client navigation APIs without server-only
  assumptions.
- Discovery reads remain bounded to Run 1 approved/open RFx queries and the
  released/scheduled territory callable. Protected writes and private profile,
  team, or referral data do not enter the workspace.
