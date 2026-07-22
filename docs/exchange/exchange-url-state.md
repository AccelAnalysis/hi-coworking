# Exchange URL and history state

The Exchange URL is a bounded, public interaction-state representation. It can
request an actor and restore a subject, but it cannot establish authority.

## URL allowlist

| State | Query representation |
| --- | --- |
| Canonical view and surface | `view`, `mode` |
| Workspace search | `q` |
| Requested actor and subject | `actorOrg`, `subjectOrg` |
| Secondary selection | `secondaryEntity`, `secondarySelected` |
| Open organization/detail surfaces | `drawer=organization`, `panel=detail` |
| Geography | `place`, `placeLat`, `placeLng`, `radius`, `west`, `south`, `east`, `north`, `includeRemote` |
| Camera | bounded longitude, latitude, zoom, bearing, and pitch parameters |
| Opportunity filters | territory, NAICS, industries, capabilities, status, type, buyer/work/visibility, certifications, set-asides, classifications, personalization, budget, sort, and saved search |
| Referral filters | connection mode, referral status, industry, territory, compensation, and relationship |
| Intelligence mode | metric and relevant relationship/industry/territory filters |

Stable defaults are omitted when serializing. Parsing always produces complete
safe defaults so Back or Forward can remove prior state rather than accidentally
merging stale values.

## Validation and privacy

The codec bounds string lengths, list counts, IDs, money, radius, bounds, and
camera values. It rejects control characters, invalid enum values, incomplete
viewports, and cross-view secondary selections. Unknown query parameters are
dropped on parse/serialize.

The URL never contains:

- validated actor authority;
- viewer UID, tokens, or custom claims;
- memberships or roles;
- fetched public or private documents;
- drafts or free-form draft messages;
- private contacts, analytics, or relationship data;
- panel dimensions or hover state; or
- arbitrary object properties.

`actorOrg` is passed to `exchange_listActorOrganizations` as
`requestedActorOrganizationId`. The server must validate exact active
membership and may replace it with a safe fallback. Only that result populates
`actorOrganizationId`.

## History behavior

Discrete user navigation uses `router.push`, including mode changes, subject or
secondary selection, and explicit actor requests. High-frequency state such as
map movement uses a debounced `router.replace`. Self-authored queries are
tracked to avoid a router feedback loop.

The workspace listens for `popstate`, clears pending replacement state, parses
the complete historical query, and hydrates the reducer. Forward navigation
uses the same path. The map compares the restored camera with its live camera
before `jumpTo`, preventing a move-end/URL update loop.

## Refresh and session precedence

The initial reducer is hydrated from the URL. After actor validation, the
matching `{uid, actor}` session may restore transient per-mode state. On the
first actor binding, an explicit URL is reapplied after session restoration so
the deep link remains authoritative for shareable interaction state. Neither
source can validate an actor.

On later actor switches, only the new actor's session may restore. A missing
session clears the old actor's mode detail state. Sessions have a versioned,
bounded TTL and exclude actor authority.

Mobile links within the Exchange preserve the current query allowlist. Links
that intentionally leave the Exchange do not carry Exchange context into the
destination route.

## Evidence and remaining gate

URL round-trip tests cover requested actor, subject, secondary context, open
surfaces, camera, filters, invalid values, unknown fields, and default clearing.
Session and mobile-link tests cover actor binding and context preservation.
Configured Back/Forward, hard refresh, unauthorized deep link, and return-from-
Profile/Admin/Organization browser scenarios remain pending.
