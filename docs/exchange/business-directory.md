# Exchange business directory

The business directory is an organization projection within the existing
Exchange workspace. It is not a separate application or organization model.

## Server surface

`exchange_organizationDirectory` is the canonical list/detail endpoint.

List requests support:

- name and broad text query;
- industries and public capability keywords;
- NAICS codes and certifications;
- locality across city, county, and state;
- claim, verification, and resource-provider states;
- map bounds, including antimeridian-aware longitude comparison;
- canonical Exchange mode; and
- bounded cursor pagination.

Page size is 1–50. Each call scans at most 250 active,
publication-approved public records and returns an opaque `{name,
organizationId}` continuation cursor. Post-filtering may produce fewer than the
requested page size; the client must follow `hasMore` rather than infer
completion from row count.

In Resources mode, the server returns only approved resource providers as mode
results.

## Detail behavior

Anonymous detail returns only the approved public allowlist. Authenticated
detail delegates to the same viewer-relative perspective resolver used by the
context drawer, so self/managed subjects may receive role-bounded private
detail while external subjects receive only public or relationship-safe data.

The browser never performs a direct private organization read. The directory
client maps the strict shared public projection to its bounded presentation
type and drops all other keys.

## List, map, and context synchronization

The workspace loads public directory pages once and safely reuses the bounded
public result across modes. The aggregate client ceiling is 1,000 organizations
per load; cursors are cycle-checked. A rejected request is not cached.

Workspace search, NAICS, capabilities, certifications, territory, and map
bounds filter both directory cards and organization result markers. IDs are
de-duplicated. Selecting a list or map organization sets the shared subject,
opens the stable organization drawer, and writes URL context. The subject then
survives mode changes even when it no longer matches the active result filter.

Only records with explicitly publishable coordinates become markers. Other
approved organizations remain list/detail discoverable.

## Viewer-relative actions

The perspective resolver determines which actions the drawer may present:

- save or unsave for the validated actor;
- request a governed public contact pathway;
- request a relationship-safe introduction;
- initiate referral or teaming where the mode and subject allow it;
- inspect public opportunities or resources; and
- request a claim for an eligible unclaimed subject.

The implemented drawer currently wires save/unsave, contact request, and
introduction request. Claim creation remains in the canonical organization
onboarding surface. Referral and teaming actions depend on their respective
workflows and must not be inferred merely from a displayed organization.

Saved organization records are keyed to the actor organization, not merely the
viewer UID. Contact and introduction writes require exact active actor
authority, are idempotency-protected, and return no protected contact or
relationship-path data.

## Projection exclusions

Directory list, map, and external detail exclude private addresses, suppressed
coordinates, personal contacts, membership and authority fields, claim review
evidence, verification documents, administrative/fraud flags, restricted
matching evidence, seed-review metadata, private referrals and relationships,
private opportunity state, and private analytics.

## Current evidence and remaining gate

Unit/callable tests cover bounded pagination, public mapping, actor-scoped
saves, public/private detail, Resources filtering, and routed safe actions.
There are currently zero configured organizations in the audited development
project and the new directory callable is not yet configured-accepted. Real
data, list/map/detail browser synchronization, URL restoration, empty states,
and marker-scale network/render behavior remain deployment gates.
