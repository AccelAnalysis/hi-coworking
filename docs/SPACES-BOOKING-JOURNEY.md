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
