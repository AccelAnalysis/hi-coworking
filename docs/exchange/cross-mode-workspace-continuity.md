# Cross-mode workspace continuity

Intelligence, Referrals, Opportunities, and Resources are four perspectives
over one Exchange workspace. A mode switch keeps context and replaces only the
mode-owned interpretation and result content.

## One persistent map

`ExchangeWorkspace` mounts one `ExchangeWorkspaceMap` above all four mode
views. The mode views remain mounted and the inactive three are hidden. A mode
therefore cannot construct another Mapbox instance or discard component-local
draft state.

Mapbox construction depends only on the stable container and immutable initial
configuration. Data changes call `GeoJSONSource.setData`; selection uses feature
state and selected overlay sources; panel changes request only `resize()`.
Result fitting occurs only after an explicit fit request. Ordinary mode,
filter, data, and selection changes do not recenter the map.

The map separates organization mode results from the active context source.
Actor and subject markers are unclustered context features and remain visible
when they are absent from a mode query. In Resources, a non-provider subject is
still the subject context marker and never becomes a resource result.

## Global state retained across modes

- validated actor organization;
- requested actor as an untrusted request;
- subject organization;
- workspace search text;
- opportunity locality, radius, and bounds;
- map longitude, latitude, zoom, bearing, and pitch;
- organization drawer state;
- left/right/mobile panel state where safe; and
- the persistent actor/subject context display.

The secondary context is restored from the destination mode's stored state.
If that mode has no secondary selection, the subject organization remains the
primary selection.

## Per-mode state

| Mode | Preserved state |
| --- | --- |
| Opportunities | Full discovery filters and sort, saved-search ID, secondary item, list position, subsection, response/saved-search draft references |
| Referrals | Connection/status/industry/territory/compensation/relationship filters, secondary referral, list position, subsection, referral draft reference |
| Intelligence | Industry/territory/relationship filters, metric, secondary item, list position, subsection |
| Resources | Category, eligibility/provider/service filters, secondary resource, list position, subsection, resource-contact draft reference |

The state contract has draft-reference slots for referral, contact request,
teaming invitation, organization claim, opportunity response, saved search, and
resource contact workflows. A reference is not proof that every corresponding
server draft workflow is complete.

## Mode-switch transition

`SET_VIEW` snapshots the outgoing mode's filters and secondary context, changes
the canonical view, and restores the destination mode. It does not clear actor,
subject, search, geography, viewport, or organization drawer state. The new
perspective request blanks the prior projection while the server recalculates
authorization.

The four mode containers remain mounted to retain safe local component state.
List components write bounded scroll positions back to their mode state and
restore those positions when revisited. Resources writes its selected category
to the resources mode state.

## Actor switch transition

Continuity is actor-bound. Before a requested actor switch, the current session
is written under `{uid, validatedActorOrganizationId}`. The old private
perspective is cleared immediately. Only after server validation may the new
actor's session be restored. If no session exists, mode state and secondary
detail are reset so the previous actor's private work cannot cross scopes.

The referral composer captures the actor that opened the draft. If authority
changes, submission is disabled and the safe local draft remains visible. The
other draft-reference slots establish storage boundaries but still need
workflow-specific configured acceptance.

## URL, session, and durable camera

- The URL carries shareable, bounded interaction state including mode, requested
  actor, subject, secondary item, search, geography, drawer/detail state, and
  camera.
- Session storage carries safe transient/global and per-mode state for 24 hours
  by default, keyed by viewer UID and validated actor. It excludes authority,
  fetched records, membership, and token data.
- The existing UID-bound local map session remains a durable camera fallback.

On the first actor binding, session state is restored and an explicit URL is
then applied so a deep link wins. Browser history hydration applies complete
URL defaults, which allows Back or Forward to clear state as well as restore it.

## Current evidence and remaining acceptance

Reducer, URL, session, map-source/layer, persistent-map-host, mobile-link, and
scroll-state tests cover the source contract. The latest local Exchange suite
passed 118 tests. Configured Mapbox lifecycle instrumentation, Back/Forward and
refresh testing, mobile Safari, cross-browser drafts, and live authority-loss
acceptance remain pending on `hi-coworking-plat`.
