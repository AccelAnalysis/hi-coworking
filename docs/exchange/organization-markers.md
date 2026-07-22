# Organization markers and map ownership

Organization markers are privacy-minimized presentation records derived from
approved public projections. The map never receives the private organization
document.

## Layer ownership

The persistent Exchange map implements four conceptual layer families:

1. Base geography: Mapbox basemap, 3D buildings, territory fills, boundaries,
   points, and release labels.
2. Active context: unclustered actor/subject organization source, context
   styling and label, and selected overlays.
3. Mode results: clustered organization results and clustered RFx results.
4. Temporary interaction: feature-state selection, hover cursor, explicit
   result-fit behavior, and geography preview/bounds supplied by existing
   controls.

The current stable source IDs include separate `organizations`,
`contextOrganizations`, and `selectedOrganization` sources. Sources and layers
are registered once after style load and later updated with `setData` or
feature-state.

## Marker publication gate

An organization creates a point only when all of these conditions hold:

- non-empty stable ID and name;
- `status` is exactly `active`;
- neither `homeBased` nor `privacySuppressed` is true;
- `coordinatePublicationApproved` is exactly true; and
- longitude and latitude are finite and in range.

Marker properties are limited to ID, name, publishable city/state/territory,
claim and verification state, coordinate confidence, and context type. They do
not include address, contact, owner, membership, source evidence, review state,
private analytics, referral state, or opportunity state.

No organization coordinate is fabricated. Records that fail the marker gate
remain list-only. Territory centroids and boundaries are validated separately
and cannot be substituted for an organization's location without an approved
policy and explicit projection.

## Context versus results

Actor and subject markers are copied from the same approved projection or from
the final viewer-relative organization projection, then subjected to the same
coordinate gate. They render in an unclustered context source with distinct
styles for actor, subject, and actor-plus-subject.

The context source is independent of mode filtering and pagination. A selected
subject therefore remains visible when outside the active result set. The
selected organization overlay can source its point from either context or mode
results, so clustering does not hide the selection.

In Resources:

- ordinary result markers include only organizations whose public
  `resourceProviderStatus` is `approved`;
- an external non-provider subject may remain in the context source;
- the subject is not relabeled or counted as a resource; and
- no resources privately recommended to the external subject are returned.

## Clustering and interaction

Organization results use a dedicated clustered source with radius 48 and
cluster maximum zoom 13. RFx uses a different clustered source. Cluster clicks
ask the corresponding source for expansion zoom. Context and selected sources
are not clustered.

Map clicks set organization subject or mode-owned secondary selection.
Background clicks clear only secondary context. Map movement emits bounded
camera and bounds state. Result fitting is an explicit user request and honors
reduced-motion preference.

## Scale evidence

Pure GeoJSON/source/layer tests cover privacy suppression, list-only behavior,
separate context source, selected overlays, clusters, and fixtures at 100,
1,000, and 10,000 records. Those tests prove bounded transformation and stable
layer contracts; they do not prove Firestore fetch, Mapbox worker, mobile GPU,
or configured browser performance.

## Remaining gate

Configured development currently lacks approved organization coordinates and
authoritative locality geometry. Real Mapbox marker rendering, list/map/detail
synchronization, cluster expansion, 100-row approved sample behavior, resource
context, mobile performance, and suppressed-location network inspection remain
pending. No fabricated marker should be added to unblock that acceptance.
