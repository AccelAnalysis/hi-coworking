# Organization activation and continuity security

## Business-registration and actor-marker addendum

Representative attestation is policy evidence, not organization authority. Activation state derives connection and management authority only from active `orgs` plus exact-active composite `orgMembers`. A pending claim is explicitly blocked from private actor markers, organization mutation, opportunity issuance, and private contact routing.

The actor location callable returns only organization/location IDs, safe labels, type/designation flags, coordinate, visibility classification, and marker state. It omits street addresses, contacts, billing, provider data, notes, claim evidence, and verification evidence. The client may admit unpublished coordinates only when `privateActorVisible` came from this membership-gated response and only into the unclustered actor-context source. Public repositories and GeoJSON retain explicit publication gates.

The activation callable is read-only with respect to authority. Progress recording revalidates membership on every action and requires owner/admin for enrichment and orientation preference. Map completion requires active membership. `issuerOrganizationId` narrows results but never bypasses Opportunity Discovery visibility rules.

## Establishment and route addendum

Private locations, contacts, communication routes, geocode sessions/caches, and delivery audits deny every browser read/write, including owner, staff, Actor URL, and selected Subject. Management callables re-read exact-active organization status and composite membership and require owner/admin for mutation.

Public location/contact reads pass Firestore final-key allowlists plus server projection allowlists. Unapproved street data, one-sided/unapproved coordinates, private/home locations, private contacts, billing contacts, routes, destination IDs, and raw provider payload are excluded. Address/geocode confirmation never implies publication. Route responses contain no private destination value.

Authority revocation takes effect on the next callable/read because Actor selection and Secondary establishment state are preferences, not authorization grants.

The central security rule is that organization authority comes only from an
exact active canonical membership and an active canonical organization. Actor,
subject, URL, session, profile, marker, and platform-role concepts remain
separate.

## Trust boundaries

- Firebase Authentication establishes viewer identity.
- Platform token role authorizes platform administration only.
- `orgMembers/{organizationId}_{uid}` plus `orgs/{organizationId}` establishes
  organization authority.
- `publicOrganizations` is the only public organization projection.
- URL/session actor IDs are requests, never grants.
- Admin SDK access in a callable does not waive response allowlisting.

`loadOrgAuthority` and `requireActiveOrgAuthority` require an active
organization, exact composite membership identity, active membership status,
matching UID/org fields, and manager role where requested. Removing or changing
the membership status must revoke authority immediately on the next server
check.

## Direct-access policy

Firestore rules enforce these browser boundaries:

- private `orgs` reads are staff-only; ordinary organization detail uses
  callables;
- users may read their own membership, while managers/staff have bounded
  membership administration visibility;
- only active, publication-approved `publicOrganizations` are public;
- claims, restricted candidates, search rate limits, actor preferences, saved
  organizations, contact/introduction requests, identity reservations, and
  private Opportunity Discovery state are direct-deny;
- seed import records are administrator-readable and server-written; and
- organization and sensitive workflow writes are server-authoritative.

Storage retains default deny and separate path-bound controls. The organization
context callables do not return Storage bearer URLs or verification evidence.

## Projection and relationship safety

The public sanitizer and perspective functions are final allowlists. External
subjects cannot receive owner/member data, private addresses or contacts,
restricted seed evidence, verification documents, private analytics,
relationships, referrals, compensation, notes, saved/viewed opportunities,
alerts, drafts, responses, private fit, or private resource recommendations.

The relationship resolver reads only one actor-subject record, validates both
participant keys, and returns a bounded indicator. Contact requests route to
current subject managers or a platform review queue without returning protected
details. Introduction requests disclose only that a trusted introduction may
be available, never who forms the path.

## Actor-scoped mode data

- Referrals uses organization scope and explicit actor organization instead of
  an all-authorized scope.
- Intelligence requests organization scope for a validated actor.
- Opportunity Discovery validates the actor server-side before search,
  personalization, save/view, saved-search, and recent-search operations.
- Organization personalization uses only the selected actor, not every
  membership.
- Saved/viewed document IDs and saved/recent search records include actor scope.
- Client hooks blank actor-sensitive data and discard stale requests on actor
  change.

The relevant actor-aware saved/recent-search composite indexes must be reviewed,
deployed, and proven ready before configured acceptance.

## Lifecycle safeguards

Organization creation performs duplicate search, identity reservation,
request fingerprinting, idempotency, exact owner membership, public projection,
and audit in one transaction. Claim requests cannot promote restricted source
matches. Claim approval is platform-admin-only, transactional, idempotent, and
rejects competitors without disclosing their identities.

Seed export/import is separately project-guarded, approved-only, coordinate-
permission-aware, capped at 100 for the first sample, pre-snapshotted, and
claimed-record-protective. With zero human approvals, import is blocked.

## Test matrix

Source and emulator suites cover or define coverage for:

- unauthenticated denial and exact active owner/admin/member authority;
- malformed and former membership denial;
- URL/marker/browser state not changing validated authority;
- self, managed, external claimed, unclaimed seed, resource provider, and
  unavailable projections;
- rejection of unexpected private projection fields;
- direct private collection denial;
- actor-scoped directory saves, contact, introductions, referrals,
  intelligence, and opportunities;
- relationship-path non-disclosure;
- address/coordinate suppression; and
- approved-only seed, duplicate, replay, and rollback guards.

## Remaining risk and acceptance

Configured development acceptance passed on `hi-coworking-plat`: the exact 21
selected endpoints are active Gen 2 Node.js 20, all 93 indexes are ready, the
Firestore rules are deployed, 120 emulator security/function/rule/migration
tests pass, and the seven-project browser matrix passed external-response/DOM
inspection, revocation with an unsaved draft, cross-mode Secondary Subject
continuity, and exact synthetic cleanup. Storage rules were unchanged.

Native VoiceOver remains a manual release gate. Node.js 20 and the pinned
Firebase Functions SDK require a later bounded runtime upgrade. The workstream
branch is draft and stacked, and no production-readiness claim is made.
