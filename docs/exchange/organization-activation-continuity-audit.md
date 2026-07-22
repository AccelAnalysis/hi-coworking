# Organization activation and continuity audit

## Scope and immutable baseline

- Repository: `AccelAnalysis/hi-coworking`
- Workstream: Organization Activation, Seeded Exchange Completion, Cross-Mode Workspace Continuity, and Viewer-Relative Authorization
- Branch: `codex/exchange-organization-activation-continuity`
- Starting SHA: `831fdcaf1cf1ae8dad82523ced7b87f36a449740`
- Baseline captured: 2026-07-22, America/New_York
- Firebase development project: `hi-coworking-plat`
- Functions region: `us-central1`
- Production deployment/import authorization: none

The worktree was clean before inventory and the existing user stashes were left untouched.

## GitHub and stacking decision

Live GitHub state, checked after `git fetch --all --prune`:

| Item | Live state | Head | Base | Decision |
| --- | --- | --- | --- | --- |
| PR #3 | open, draft, clean | `ccea0f3840e5248bc2eb7f8cfae5e8c3c946f47d` | `main` | Do not modify or merge |
| PR #19 | open, draft, clean | `831fdcaf1cf1ae8dad82523ced7b87f36a449740` | `codex/exchange-run-4-founding-launch` | Do not merge; use as stack base |
| Issue #16 | open | operational launch checklist | n/a | Retain as canonical launch-gate tracker |

PR #19 was not merged, so this branch was created from its current head and its
draft pull request must target `codex/exchange-configured-acceptance-and-seed-activation`.
It must be retargeted to the canonical Exchange branch after PR #19 merges.

The current PR #3 and PR #19 checks were green at inventory time. Green source
checks are not configured-development organization acceptance.

## Configured-development baseline

The active CLI project is exactly `hi-coworking-plat`. Emulator variables were
not active. Node `20.20.2`, npm `10.8.2`, and Firebase CLI `15.22.4` were used
for inventory.

### Deployed Functions

The deployed project contains 35 active Node 20 Functions. The configured core
account/profile endpoints are active:

- `account_initialize` (`account-initialize-00002-baw`)
- `profile_update` (`profile-update-00002-cuy`)
- `enrichment_search` (`enrichment-search-00003-viw`)
- `enrichment_link` (`enrichment-link-00002-jes`)

None of the seven canonical `exchange_organization*` or
`exchange_admin*OrganizationClaim*` endpoints is deployed. The older
`org_create` Function remains deployed as revision `org-create-00001-fin`; it is
not the canonical organization lifecycle and must not be used as acceptance
evidence.

### Configured data

The live Firestore database contains no top-level organization activation data:

- `orgs`: 0
- `publicOrganizations`: 0
- `orgMembers`: 0
- `organizationClaims`: 0
- `organizationSourceCandidates`: 0
- `organizationSeedImports`: 0
- `territories`: 0

Only unrelated existing collections were present. No seed, claim, organization,
or locality mutation was performed during inventory.

### Rules, indexes, Storage, and Hosting

- Source Firestore rules SHA-256: `fc30b919f9fd4e82283a89c40a3ff81c895cfaad3f6f8b70af29dae77de04c74`
- Live Firestore rules SHA-256: `fb98187116fccbaee05368410c0548cd59a64fd6d2b3aa385f9cde44bee2d690`
- Source Storage rules SHA-256: `4dd3c5f5d9751e30e23401dfb5229152bd789a2ca304504d35dacb0996c2f757`
- Live Storage rules SHA-256: `f9c5737e4830fa78c358a16abdbe302aeae71b88e16c40b1bf5535c1a3667704`
- Source composite indexes: 80; live ready composite indexes: 55
- Source-only composite indexes: 31, including organization, claims, and Opportunity Discovery indexes
- Live-only composite indexes: 6
- Hosting release: `1773955884029000`
- Hosting version: `dad753a453d799e0`
- Hosting release time: 2026-03-19T21:31:24.029Z

Rules, indexes, Storage, and Hosting are therefore deployment-review gates, not
assumed matches. The source aliases `default` and `prod` both currently resolve
to the development project; every authorized command must still name
`hi-coworking-plat` explicitly.

## Current organization source of truth

The intended canonical records are:

- private authoritative organization: `orgs/{organizationId}`;
- canonical role-bearing authority: `orgMembers/{organizationId}_{uid}`;
- public discovery projection: `publicOrganizations/{organizationId}`;
- claim workflow: `organizationClaims/{organizationId}_{uid}`;
- restricted match-only candidate: `organizationSourceCandidates/{candidateId}`;
- seed batch evidence: `organizationSeedImports/{batchId}`;
- commercial membership and wallet: `exchangeMemberships` and
  `exchangeCreditAccounts` (not organization authority).

The canonical organization lifecycle lives in
`apps/functions/src/exchange/organizations.ts`. Seven callables implement
search, creation, claim request/list/review, and competing-claim handling.

There is also a conflicting legacy `org_create`/`org_purchaseSeats` surface in
`apps/functions/src/index.ts`. It creates or mutates a weaker second path and is
still included by the full Firebase entry. It must be deprecated, blocked, or
routed through the canonical lifecycle; it cannot remain an alternate authority
model.

## Current organization authority model

Authority is intended to come from the composite `orgMembers` document plus an
active `orgs` document. Platform roles authorize platform administration but do
not establish organization membership.

The current implementation has a critical revocation defect:

- `loadOrgAuthority` validates document identity and organization status but
  does not require `orgMembers.status == "active"`;
- Firestore `isOrgMember` has the same omission;
- several opportunity, referral, entitlement, and personalization loaders use
  duplicate or legacy membership checks.

An inactive/former membership can therefore retain private reads or callable
authority. Exact-active membership must become a shared invariant in Functions,
rules, and tests before actor switching is introduced.

The existing `primaryOrganizationId` is only a preference/initial camera hint.
It is not authority. URL, profile, browser state, marker state, and cached role
strings must remain untrusted actor requests.

## Current public/private projection model

Positive foundation:

- full `orgs` records are not public;
- `publicOrganizations` is a separate projection;
- marker GeoJSON is built from a bounded public shape;
- home-based/privacy-suppressed addresses and coordinates are omitted;
- marker properties omit contacts, claim evidence, owner data, and source IDs.

Material gaps:

- `sanitizePublicOrganization` publishes location from absence of suppression,
  not explicit coordinate-publication approval;
- claim and verification status are conflated in one public field;
- non-active states other than the exact string `inactive` can project as active;
- the importer has a second, drifting projection implementation;
- every organization member can currently read the complete private `orgs`
  document rather than a role-bounded owner/admin/member allowlist;
- there is no viewer-relative public/private/relationship-safe/resource-public
  perspective endpoint;
- there is no final response allowlist per mode.

Most seriously, authenticated search currently queries restricted candidates,
and requesting a `source:` claim can create an `orgs` record and public projection
before administrative approval. Restricted candidate promotion must require an
explicit approved public seed/publication record; claim submission alone must
never publish restricted data.

## Current seed candidate lifecycle

Current ignored prepared artifacts contain:

- 5,128 organization candidates;
- 1,324 home-based/private-location-suppressed organizations;
- 3,804 rows carrying source coordinates;
- 3,545 restricted match-only candidates;
- 579 unmatched home-business rows excluded from the organization export.

The current verifier reports no duplicate IDs and no detected privacy violation,
but activation requirements are entirely absent:

- rows with `reviewStatus: approved`: 0;
- rows with `reviewedBy`: 0;
- rows with `reviewedAt`: 0;
- rows with `coordinatePublicationApproved`: 0;
- rows with `projectionVersion`: 0;
- rows with explicit source provenance: 0;
- rows with explicit privacy classification: 0.

No bounded sample is authorized. The correct current lifecycle stops at a human
review packet and approved-only export workflow.

The coordinate verifier also has a material geographic-validation gap: 57 rows
carry `(0, 0)` and one additional row lies outside Virginia while all rows claim
Isle of Wight FIPS `51093`. Global numeric ranges are insufficient. Those rows
must be list-only or rejected pending authoritative coordinate review.

The existing importer is dry-run-first and project-guarded, but it does not:

- require human approval;
- enforce the 100-row sample cap;
- require coordinate-publication approval;
- abort an apply on every invalid record;
- create a rollback snapshot before writes;
- write organization/public projection atomically;
- protect claimed state from seed replay;
- provide a rollback executor/rehearsal;
- provide a formal no-op replay result;
- reconcile duplicates against existing normalized identity/domain/source IDs.

## Current actor organization behavior

There is no first-class Exchange actor organization. Opportunity personalization
merges the viewer profile with every active-looking membership; Referrals uses
an all-authorized scope; Intelligence uses an individual scope. Saved opportunity
state is UID-scoped. A multi-organization user cannot select one explicit actor,
and private caches are not keyed by actor.

The referral composer contains a hard-coded “Acting as Tidewater Manufacturing
Alliance” label while not submitting an explicit validated actor organization.
That text is misleading and must be removed.

## Current selected organization behavior

`ExchangeWorkspaceState.selection` is one union used for organization, RFx,
territory, referral, relationship, or industry. It conflates primary subject and
secondary subject. Selecting an opportunity replaces organization context.

Organizations are loaded and rendered only in Opportunities. Referrals,
Intelligence, and Resources do not consume an organization subject. An
organization selected from the filtered organization list must also remain in
that filtered GeoJSON or its selected overlay disappears.

## Current map camera and layer behavior

Within one mounted `ExchangeMap`, the implementation is strong:

- Mapbox construction is isolated from data updates;
- stable sources are registered once;
- data updates use `setData`;
- selection and viewport synchronize separately;
- result fitting requires an explicit request;
- organization and RFx clusters are independent;
- reduced motion is honored.

Across modes, the component topology breaks continuity:

- Opportunities mounts its own `ExchangeMap`;
- Intelligence and Referrals share a separate `ExchangeContextMap` mount;
- Resources mounts another `ExchangeContextMap`;
- the context maps do not receive workspace viewport or subject selection.

Switching between these groups destroys and recreates Mapbox, loses the live
camera, and cannot keep an independent subject/context source. The active
context marker currently depends on the mode-result organization source.

## Current mode-switch, search, drawer, URL, and mode state

### Mode switching

`SET_VIEW` explicitly clears selection and closes desktop/mobile detail and
filter surfaces. Existing tests enforce that now-obsolete behavior.

### Search

One `searchQuery` survives reducer mode changes and the command bar changes its
placeholder by mode. This is a useful workspace-search foundation. However,
Resources searches four static category cards, and literal mobile navigation
links can drop the existing query and context.

### Drawer

There is no stable organization drawer header. Detail is tied to the one current
selection and closes on mode change. There is no actor/subject breadcrumb.

### URL and history

The existing URL codec is bounded and allowlisted. It represents view, surface,
search, filters, one selection, opportunity geography, and viewport. It has
careful push/replace/popstate handling and useful tests.

It does not represent requested actor, distinct subject, secondary context,
drawer state, or return route. Literal mobile tray links construct partial URLs
and discard existing state.

### Session/durable state

Only map camera is persisted, in local storage with a UID key and TTL. There is
no Exchange session model for per-mode selection, scroll position, panel state,
drafts, or recent transitions. Resource category, referral form state, saved
search form state, and list position are component-local and disappear when
their mode unmounts.

### Per-mode state

Opportunity, referral, and intelligence filters share one flat reducer. Referral
and Intelligence reuse several filter fields, so clearing one mode affects the
other. Resources is local-only. No per-mode secondary selection, subsection,
scroll, or draft reference exists.

## Current data-leakage and authorization risks

Priority risks before implementation:

1. Inactive/former membership is still treated as organization authority.
2. Restricted candidate claims can cause unauthorized public publication.
3. Members can directly read a complete private organization document.
4. Actor authority is not explicit and Opportunity personalization blends all
   memberships.
5. Private mode caches are not keyed by validated actor.
6. Seed location publication lacks explicit approval and geographic validation.
7. Legacy organization endpoints provide a second, weaker lifecycle.
8. The public sanitizer/importer can drift because projection logic is duplicated.
9. Existing source rules/indexes are not live, so source-only tests do not prove
   configured protection.

## Current configured deployment gaps

- no canonical organization/context Function is deployed;
- no guarded organization/context deployment entry/package exists;
- the full Function entry discovers unrelated payment, event, scheduled, social,
  and optional marketing surfaces and must not be used for this narrow deploy;
- live Firestore and Storage rules differ from source;
- 31 required source indexes are absent from live Firestore;
- Hosting is an old March revision;
- no locality geometry or territory record exists;
- no approved seed export or rollback artifact exists;
- no exact pre/post synthetic artifact inventory/cleanup command exists.

## Current acceptance gaps

Existing useful evidence includes reducer/URL/map-session tests, privacy-safe
marker transforms, clusters, 100/1,000/10,000 pure serialization fixtures, and
emulator organization create/claim happy paths. Marker transform measurements do
not prove Firestore/network/Mapbox worker/render/mobile behavior.

Missing acceptance includes:

- actor equals/differs from subject;
- unauthorized actor deep link;
- exact-active revocation/former-member denial;
- owner/admin/member projection differences;
- external claimed/unclaimed/resource-provider projections;
- forbidden-field response assertions for every mode;
- claim rejection, competing claims, idempotent review, and former-claimant denial;
- one Mapbox instance through all four modes;
- unchanged camera and persistent subject marker;
- external non-resource context marker in Resources;
- per-mode filter, selected item, list position, and panel restoration;
- actor-bound draft preservation and authority-change freeze;
- configured organization create/claim/review/browser acceptance;
- authoritative locality rendering;
- approved sample import, replay, and disposable rollback rehearsal;
- Firefox installation in configured CI, native Safari, full mobile, automated
  accessibility, and browser-scale marker performance.

## Implementation order forced by this audit

1. Enforce exact-active membership and remove the restricted publication path.
2. Establish one canonical projection/publication contract and retire the weak
   legacy organization entry points.
3. Add strict shared actor/subject/secondary/perspective contracts and
   server-final allowlists.
4. Add callable-only actor list/validation, perspective, bounded directory,
   save/contact/introduction, and approved-resource surfaces.
5. Partition global and per-mode state; add URL/session restoration and
   actor-bound draft safety.
6. Lift one map instance above modes and separate active context from mode
   results.
7. Add approved-only review/export/import/replay/rollback tooling and
   authoritative locality preparation.
8. Deploy only the reviewed development package/rules/indexes/Storage/Hosting,
   then run configured browser, security, privacy, accessibility, and cleanup
   acceptance.

No production project, seed import, Stripe operation, Microsoft send, merge, or
canonical branch mutation is authorized or implied by this audit.
