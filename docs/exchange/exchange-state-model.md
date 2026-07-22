# Exchange state model

The Exchange state model separates shared workspace context from state owned by
each canonical mode. It stores identifiers and interaction state, not fetched
private organization records or authority evidence.

## Canonical mode mapping

The four canonical modes are `opportunities`, `referrals`, `intelligence`, and
`resources`. Legacy views are normalized as follows:

- `businesses`, `teaming`, and `opportunities` map to Opportunities;
- `connections` and `referrals` map to Referrals;
- `intelligence` maps to Intelligence; and
- `resources` maps to Resources.

This mapping permits existing routes and UI labels without creating another
workspace or map.

## Shared workspace state

`ExchangeWorkspaceState` carries:

- active view and map/list/split surface;
- untrusted requested actor and separately validated actor;
- organization subject and mode-owned secondary context;
- persistent organization drawer state;
- one workspace search query;
- opportunity geography, including label, center, radius, bounds, and remote
  behavior;
- current Mapbox camera;
- desktop and mobile panel state; and
- a record of four independent `ExchangeModeState` objects.

`selection` remains as a presentation compatibility field. Organization
selection is normalized into `subjectOrganizationId`; other entities are
normalized into `secondaryContext`. Authority never comes from either field.

## Mode-owned state

Every canonical mode owns:

- a bounded filter snapshot;
- its secondary selection;
- list scroll position;
- optional panel subsection;
- bounded draft references; and
- for Resources, the selected resource category.

Opportunity filters include discovery, visibility, classification,
personalization, budget, saved-search, and sort state. Referral and Intelligence
filters are independent even where their field names overlap. Resource filters
are stored only in the Resources mode snapshot.

## Reducer invariants

All external hydration and action payloads are normalized and bounded. Entity
IDs reject control characters and slashes where server contracts require it;
search, labels, filter counts, money, viewport, and scroll positions have
explicit limits.

Important transitions are:

- `SET_VIEW`: snapshot outgoing mode and restore destination mode without
  clearing global context;
- `SET_REQUESTED_ACTOR_ORGANIZATION`: store only an authority request;
- `SET_VALIDATED_ACTOR_ORGANIZATION`: store a server-confirmed actor;
- `SET_SUBJECT_ORGANIZATION`: set subject and open the organization drawer;
- `SET_SECONDARY_CONTEXT`: change the current mode item without replacing the
  subject;
- `SET_MODE_*`: update list position, filters, subsection, Resources category,
  or draft references for one mode; and
- `HYDRATE_FROM_URL` / `HYDRATE_FROM_SESSION`: apply different allowlists for
  shareable and transient state.

## Persistence ownership

| Store | Permitted state | Prohibited state |
| --- | --- | --- |
| URL | Shareable mode, requested actor, subject, secondary selection, search, filters, geography, drawer/detail state, viewport | Validated authority, viewer identity, memberships, fetched records, drafts, private fields |
| Actor-bound session storage | Safe global interaction state, per-mode state, draft references, scroll, temporary panels | Requested or validated authority as state, tokens, claims, memberships, fetched entities |
| UID-bound local map session | Last safe camera fallback | Organization authority or private mode data |
| Server preferences | Last validated actor organization | Any grant independent of current membership |
| Server actor-scoped records | Saved opportunities/searches/organizations and authorized workflow data | Cross-actor records returned solely by UID |

Session envelopes are versioned, expire after 24 hours by default, and cannot
exceed seven days. Reads require an exact UID and validated-actor binding.
Malformed, expired, future-dated, or mismatched records are removed or ignored.

## Async data ownership

Organization perspective, referrals, intelligence, and opportunities clear
actor-sensitive client data when their actor key changes. Request generations
discard late responses. Public directory projections may be shared across
modes because they contain only the public allowlist.

## Evidence and known limits

Unit tests exercise context distinction, per-mode filters and selection,
scroll, draft references, Resources state, camera, URL hydration, actor-bound
session validation, and private-field injection rejection. Complete configured
history, refresh, multi-tab, and workflow-draft acceptance is still pending.
