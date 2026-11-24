# Spaces booking journey

## Customer path

The public `Spaces` navigation is transactional rather than an intermediate marketing page:

`Spaces → choose date/time range → see live availability → visually select a bookable spot → review → checkout → confirmation`

`/spaces` and `/book` intentionally render the same shared booking experience so old booking links continue to work without creating two booking implementations.

## Time selection

Customers select both a start and an end time in 30-minute increments during current operating hours. Availability is checked for the complete range, not one isolated hour.

Existing booking links that provide `date`, `time`, `duration`, or `resource` query parameters remain supported. A duration query parameter is converted into the corresponding end time when valid.

## Visual spot picker

The authoritative backend currently exposes these bookable resources:

- `seat-1` through `seat-6` — Desk 1 through Desk 6
- `mode-conference` — Meeting setup

The booking UI renders these resources in a visual workspace picker. The picker is explicitly labeled **schematic / not to scale** because the repository does not currently contain an authoritative physical floorplan. It therefore provides spatially understandable selection without representing invented coordinates as facility truth.

Availability and exclusivity remain server-authoritative. The meeting setup and individual desks continue to obey the mutual-exclusion behavior defined by the booking service.

## Progression

1. **When** — date, start, and end.
2. **Pick a spot** — live availability is rendered visually; unavailable resources are disabled.
3. **Review** — after selecting a resource, the customer must use an explicit `Continue with …` action. The server-authoritative quote, guest details when needed, membership/credit treatment, and payment action follow.

Checkout, transactional holds, membership included-hours handling, account credit, cancellation, rescheduling, confirmation, and access behavior are unchanged from the corrected booking foundation merged in PR #33.

## Seat map picker (flagged)

`NEXT_PUBLIC_SEAT_MAP_PICKER` defaults off. When off, customers still pick a desk from the card list (now with `aria-pressed`). When on, the picker shows a map (8 columns) beside a sticky selected-desk card (4 columns), stacking on mobile, with a Map/List toggle. The card list is the accessible alternative view.

The map is the published Admin layout background when one exists. Otherwise it is the built-in architectural plan (`ArchitecturalFloorPlan.tsx`, viewBox `-55 -55 950 595`), ported from Jonathan's reference picker (21 Nov 2026) and checked against the numbered D1–D7 plan. Seat centers live in `ARCHITECTURAL_SEAT_POINTS` in `packages/shared/src/seatCatalog.ts`.

Seat badges are drawn in the SVG at r 17.5 units. Each seat also has an invisible HTML button hit area of `max(44px, 8%)` of the plan width (about 55 px at 1440 wide, 44 px on a 390 px phone). The plan never renders narrower than 540 px, so on phones the main room fills the screen and the lounge and private office scroll in sideways. Hit areas never overlap (`apps/web/src/lib/seatMapGeometry.ts`).

Customers must choose a specific seat; nothing is preselected. Availability comes from the live schedule. D7 is shown as staff-only and is not sellable. The private office and lounge are drawn as rooms, never as selectable nodes. Planned guest seat-tier rates are displayed as a guide only; checkout still uses the current hourly path through Review booking. Seat IDs are not Stripe products. Member Equipped overage stays unset.
