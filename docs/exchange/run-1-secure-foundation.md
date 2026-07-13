# Run 1 — Secure and stabilize the Exchange foundation

Status: branch implementation and production handoff. The Run 1 code is isolated
on `codex/exchange-run-1-secure-foundation`; it has not been deployed to Firebase
and no production migration, backfill, data inventory, secret rotation, billing
change, or credit change was performed. Every production count in this document
is therefore **UNKNOWN** until an authorized operator runs the documented dry
runs against `hi-coworking-plat` and records their reports.

This is the governing implementation, migration, deployment, and rollback record
for Run 1. It also corrects the referral model: the primary Exchange referral is
a private business-to-business introduction, while a platform invitation is a
separate membership-acquisition domain.

## 1. Verified local repository identity

The repository identity check returned `MATCH` before implementation:

- Git worktree: yes.
- Repository-root folder expected by the task: `hi-coworking`.
- Origin repository: `AccelAnalysis/hi-coworking`.
- Base branch: `main`.
- Firebase project: `hi-coworking-plat`.
- Isolated Run 1 branch: `codex/exchange-run-1-secure-foundation`.

The original checkout was one local commit ahead of `origin/main` and contained
28 modified paths plus seven untracked paths, including overlapping Functions,
shared-schema, referral, teaming, and payment work. It was not reset, cleaned,
stashed, overwritten, or absorbed. A sibling worktree based on the fetched
`origin/main` was used for Run 1.

## 2. Local repository root

- Original checkout preserved unchanged by Run 1:
  `/Users/jonathanholman/Code/Hi-Coworking/hi-coworking`
- Isolated Run 1 worktree:
  `/Users/jonathanholman/Code/Hi-Coworking/hi-coworking-exchange-run-1`

The physical Run 1 worktree folder has a worktree suffix; Git confirms that it
belongs to the repository whose canonical checkout folder is `hi-coworking`.

## 3. Git remote

`origin` resolves to:

```text
https://github.com/AccelAnalysis/hi-coworking.git
```

No open or recently merged pull request returned by the connected GitHub search
overlapped this run. The remote `feature/firebase-deployment` branch was a
history-disconnected legacy site branch and was not used as a base.

## 4. Baseline commit

- Baseline SHA: `a9f16ff91421f8ba5699baf9e2e0059e43dbc69e`
- Baseline ref: fetched `origin/main`
- Baseline subject: `Add Platform Overview page with Coming Soon bypass, update
  contact info to hicoworking@accelanalysis.com and add phone 757-236-0651`

The Run 1 branch was created directly from that SHA. No destructive reset was
used.

## 5. Firebase project confirmation

`.firebaserc` maps both `default` and `prod` to `hi-coworking-plat`. The Firebase
CLI active project also resolved to `hi-coworking-plat`. `firebase.json` points
Firestore rules to `firestore.rules`, indexes to `firestore.indexes.json`,
Storage rules to `storage.rules`, Functions to `apps/functions`, and Hosting to
`apps/web/out`. The configured Functions region is `us-central1`.

Run 1 did not switch Firebase projects. All automated security tests target the
explicit emulator-only project `demo-hi-coworking`, not the production alias.

## 6. Original architecture

The baseline was an npm-workspace monorepo with:

- a Next.js static-export client in `apps/web`;
- Firebase Cloud Functions in `apps/functions` on Node 20;
- shared Zod schemas in `packages/shared/src/index.ts`;
- top-level Firestore collections and Firebase Storage;
- one production Firebase project for Auth, Firestore, Functions, Storage, and
  Hosting.

Relevant baseline collections included `users`, `profiles`, `orgs`,
`orgMembers`, `territories`, `rfx`, `rfxResponses`, `rfxTeams`,
`rfxTeamInvites`, `teamDocuments`, mixed `referrals`, `referralPolicies`,
verification collections, notifications, payments, and credit transactions.
Relevant client Storage paths included `capabilityStatements`, `profilePhotos`,
`profileVideos`, `verificationDocs`, `rfxProposals`, and `rfxDocuments`.

The client called `rfx_publish` for its main creation form, but competing direct
Firestore helpers still existed for protected RFx, response, evaluation, award,
referral, team, organization, and verification changes. Profiles mixed public
directory fields with privileged verification, enrichment, trust, and readiness
state. RFx ownership was predominantly individual through `createdBy`.

The baseline had no version-controlled Firestore indexes, rules-unit test
harness, callable emulator tests, migration tests, or CI workflow. Its emulator
ports also differed from the web client's expected ports.

## 7. Original security gaps

The pre-implementation assessment found these material gaps:

- `users/{uid}` permitted self-service edits without a sufficiently narrow
  privileged-field boundary, risking role, plan, membership, feature, expiry,
  and credit manipulation.
- `profiles/{uid}` mixed public and private data and allowed owners to affect
  server-reviewed verification, badges, trust, enrichment, and readiness state.
- ordinary callers could create approved/open RFx data or send approval-like
  fields; direct protected writers competed with callables.
- response creation and RFx count increment were separate client writes. A
  response could succeed while its count failed, encouraging duplicate retries.
- response status, score, evaluator, award, and close state were not consistently
  server-authoritative.
- organization ownership and membership were applied inconsistently; stale
  creator identity could outlive organization authority.
- territory checks differed between publishing, responding, and teaming and
  sometimes treated the existence of any released territory as eligibility.
- `referrals` mixed platform invitations and commercial introductions, exposed
  private customer data too broadly, and embedded payout assumptions into the
  apparent universal lifecycle.
- team invitations lacked `teamId`; indirect `rfxId + inviter` resolution could
  attach an invitation to the wrong team.
- team `members` and `memberUids` could diverge and were insufficient as a
  revocation-safe authorization source.
- Storage rules did not match several actual client paths, and the nominal
  proposal path permitted every authenticated account to read and write.
- sensitive Firestore documents stored permanent Firebase download URLs, which
  are bearer tokens and do not become private merely because rules are tightened.
- verification document identity, owner/reviewer separation, and atomic audit
  behavior were incomplete.
- Exchange lifecycle transitions lacked a unified append-only audit trail and
  high-risk calls lacked request-bound idempotency.

Adjacent payment, OAuth, webhook, and digital-purchase findings were not treated
as a reason to weaken Exchange controls. Run 1 tightens overlapping rules and
records deeper provider work as a later, separately reviewed scope.

### Baseline dependency and quality state

The repository uses npm workspaces and `package-lock.json`. Node 20 is the
Functions runtime; a first install under Node 22 produced the expected engine
warning, so final commands use Node 20. At the recorded baseline,
`build:shared` and the TypeScript Functions build passed, although the emitted
teaming module could not load under Node 20 because it required the uncompiled
TypeScript entry of `@hi/shared`. Web lint failed on five pre-existing
`react/no-unescaped-entities` errors in the platform page plus five warnings. The
web app compiled but static prerender stopped when its six public Firebase
variables were absent.

The baseline had no tests or CI. `npm audit` reported 29 advisories (2 low, 17
moderate, 8 high, 2 critical), including direct affected versions of
`firebase-admin` and Next.js. Run 1 upgrades the Firebase Functions/Admin runtime,
updates Next.js to `^16.2.10`, and pins patched transitive PostCSS/UUID versions.
Broader dependency modernization remains a separately reviewed task so this
authorization run does not become an uncontrolled framework migration.

## 8. Threat model

### Assets

Protected assets are account entitlements and credits; private profiles and
verification evidence; RFx drafts, bids, commercial attachments, scores, and
awards; team membership and documents; third-party referral contact data,
commercial notes, evidence, disputes, and optional compensation terms; audit and
idempotency records; and organization authority.

### Adversaries and failure modes

- An unauthenticated visitor attempts to discover member-only or private data.
- An ordinary authenticated user treats authentication as authorization,
  self-elevates, forges ownership, or writes protected lifecycle fields.
- A valid participant acts outside their side of a transaction—for example, a
  referrer accepts for a recipient, a respondent evaluates itself, or a former
  organization member continues to manage organization data.
- A malicious client bypasses UI checks, supplies unknown fields, forged IDs,
  Storage paths, timestamps, counts, scores, status, or organization IDs.
- A retry, double click, scheduler replay, or concurrent actor duplicates a
  record, count, credit charge, invite acceptance, award, conversion, or audit.
- Legacy ambiguity causes the system to infer the wrong team, referral domain,
  respondent, organization, or attachment.
- A bearer download URL leaks beyond Firestore authorization.
- Staff or administrators use a broad override without assignment, reason, or
  audit.
- A migration runs against the wrong project, partially rewrites data, or
  silently skips ambiguous records.

### Trust boundaries and controls

The browser is untrusted. Custom claims establish platform staff/admin roles;
Firestore mirrors do not. Firestore and Storage rules enforce least-privilege
reads and deny protected client writes. Callable Functions parse strict Zod
inputs, re-read authoritative state, validate exact organization and entity
relationships, and transact related writes. Canonical Storage paths, short-lived
upload grants, submitted-response markers, exact team membership guards,
request fingerprints, optimistic versions, deterministic identities, and
append-only audit records narrow replay and confused-deputy risks. Missing or
ambiguous authority fails closed.

Residual risks are listed in section 36 and must be considered before production
release.

## 9. Final authorization model

Authorization is layered rather than inferred from sign-in alone:

1. Firebase Auth establishes the UID and verified token claims.
2. Claim-backed `admin`, `master`, and `staff` roles control platform powers.
3. Protected business actions re-read account, profile, membership, territory,
   organization, entity status, deadline, and version as applicable.
4. Organization authority requires an active `orgs/{orgId}` document and exact
   deterministic `orgMembers/{orgId}_{uid}` identity. Management actions require
   `owner` or `admin` organization role.
5. Entity authority is side-specific: issuer, respondent, team prime/member,
   referral referrer/recipient, assigned staff, or administrator.
6. Protected writes are Functions-only. The narrow exceptions are safe
   self-service user fields, owner-scoped legacy referral-policy fields,
   notification read state, and deterministic saved RFx records.
7. Public discovery uses `publicProfiles` and approved/open RFx only. Private
   source records are not a public-directory API.
8. Administrative overrides are explicit, bounded, reasoned where supported,
   and audited. Missing state never silently becomes authority.

## 10. User-field ownership

`users/{uid}` remains the authoritative account document. Owners may read their
own record; staff may read for support. Ordinary clients may change only:

- `displayName`;
- `membershipTrack`;
- `updatedAt` accompanying those changes.

The document identity and email must remain unchanged. Direct client create and
delete are denied. Role, membership status, plan, expiry, features, credits,
lifetime purchased credits, billing/entitlement state, moderation, and other
administrative values remain server-owned. Staff authority comes from custom
claims, not the user document's mirrored `role`.

## 11. Profile-field ownership

`profiles/{uid}` is private and server-written. `profile_update` accepts a strict
owner-editable allowlist: business name, biography, NAICS codes, claimed
certifications, UEI/DUNS/CAGE values, HTTP(S) website/LinkedIn links, canonical
profile asset paths or legacy-compatible URLs, and publication choice.

The server binds `uid`, timestamps, canonical paths, completeness, readiness, and
the `publicProfiles/{uid}` projection. Selecting a canonical asset removes its
legacy bearer URL from the private source and public projection. Cross-account
asset paths are rejected.

Owners cannot directly write verification status/reviewer/rejection fields,
verified certifications, badges, trust statistics, enrichment data, calculated
completeness/readiness, moderation state, or audit values. Claimed certifications
remain distinct from verified certifications. Verification submission and review
use their own protected Functions and evidence locks.

`publicProfiles` contains an explicit allowlisted projection only. It can include
published business identity and descriptive fields, selected canonical assets,
claimed and verified certifications, badges, sanitized trust statistics,
verification/readiness values, and timestamps. The source `profiles` document is
never the public directory record. Whether UEI, DUNS, CAGE, trust, and
verification values should all be public is an owner/legal policy decision noted
in section 36.

## 12. RFx publishing flow

The canonical path is `rfx_publish`:

1. Authenticate and strictly parse the allowlisted request.
2. Bind the idempotency key to a canonical request fingerprint.
3. Re-read the actor's user/profile state, exact organization authority when
   supplied, and the target `territories/{fips}` record.
4. Require a verified profile, active membership/eligible plan, a released
   territory, and authoritative territory centroid. Only an admin/master with an
   explicit reason can use the documented territory override.
5. Serialize per-user or per-organization active-RFx quota through
   `exchangeUsage`; calculate any excess-plan credit cost and deduct it once in
   the same transaction.
6. Ignore caller identity, count, approval, status, audit actor, and geohash.
   Assign schema version 2, IDs, ownership, timestamps, visibility, normalized
   territory centroid/geohash, response count zero, and version 1.
7. Ordinary publishers receive `status: under_review` and
   `adminApprovalStatus: pending`. Admin/master publishers may create the
   approved/open invariant.
8. Create the RFx, usage/credit changes, audit event, and completed idempotency
   record atomically.

`rfx_update` permits an authorized individual owner or current organization
manager to edit only draft/under-review business fields and requires
`expectedVersion`. `rfx_moderate` is admin/master-only and rechecks territory and
deadline before creating approved/open or rejected state. `rfx_cancel` requires
current owner/organization-manager/admin authority; cancelling an award requires
an explicit audited admin override and transactionally revokes the accepted
response. Direct Firestore RFx writes are denied.

`rfx_listManaged` replaces creator-only management discovery. It returns an
allowlisted representation of individually owned RFx and organization RFx only
for current active owner/admin memberships. An organization-scoped RFx never
falls back to stale creator identity.

## 13. RFx response flow

`rfx_submitResponse` creates one immutable submitted response per RFx and
respondent subject:

1. The client first calls `rfx_prepareResponseUploads` for each proposed canonical
   `rfxResponses/{rfxId}/{actorUid}/...` path. The callable repeats eligibility,
   issuer-conflict, organization, approval, status, and deadline checks.
2. It writes a server-only, exact-path upload grant under
   `rfxResponseUploadGrantScopes/{rfxId}/uploadGrants/{uid}`. A grant lasts two
   hours, is cumulative only while still valid, and allows at most 26 unique
   paths.
3. Storage rules permit create only for the path-bound UID, approved/open RFx,
   unexpired deadline, non-issuer, unsubmitted response, valid exact-path grant,
   permitted MIME type, and maximum 25 MiB object.
4. Submission validates its strict input, canonical path/metadata, required RFx
   documents, and actual stored object metadata. It rechecks the clock before
   entering and immediately before staging the write.
5. The transaction re-reads RFx, account, profile, territory, organization,
   issuer conflicts, existing responses, upload grant, and response capacity.
6. A deterministic response identity and subject comparison prevent a second
   response. Idempotency returns the original result only for the same request
   fingerprint; reuse for different input fails.
7. The transaction creates the response, increments `rfx.responseCount` once,
   updates response usage, writes audit, consumes the upload grant, and writes
   `rfxResponseAccess/{rfxId}/respondents/{submitterUid}` with the exact submitted
   attachment paths and optional respondent organization.

The marker is the post-submit Storage authority source. Sibling files that were
uploaded but not referenced in the submitted response remain unreadable. Current
respondent-organization membership, rather than the historical submitter alone,
governs organization response reads. Expired grants are scanned hourly in bounded
batches; if no response marker exists, the worker removes grant-listed orphan
objects.

The response cap is 400 per RFx so award transactions remain within Firestore
write limits. Direct Firestore response creation, score/status mutation, and
response-count mutation are denied.

## 14. RFx evaluation flow

`rfx_evaluateResponse` permits only the individual RFx owner, a current
owner-organization manager, authorized staff, or admin/master. A respondent may
not evaluate its own response; members of the responding organization may not
evaluate it through another issuer/staff relationship; and an issuing
organization cannot evaluate a self-response.

Legal response transitions are:

```text
submitted (or legacy pending) -> under_review
submitted (or legacy pending) -> declined
under_review                  -> declined
submitted (or legacy pending) -> accepted
under_review                  -> accepted
```

Criteria IDs must match the RFx criteria, values are bounded from 0 to 100, and
weighted criteria total 100. Terminal responses cannot be rewritten. Optional
RFx version checks provide optimistic concurrency.

Acceptance runs one transaction that confirms no other winner, accepts the
selected response, declines every submitted/under-review competitor, sets the
RFx to `awarded`, records the selected response ID, updates active usage, and
writes aggregate response/RFx audit events. An inconsistent legacy RFx with more
than 400 responses fails closed for administrative review rather than risking a
partial award.

## 15. Referral authorization model and corrected domain purpose

### 15.1 Existing referral implementation findings

The baseline `referrals` collection represented both concepts. The shared type
defaulted to `platform_invite` but also contained `business_intro`, provider and
customer identity, policy snapshots, conversion, payout, dispute, and `paid`
state. The `/referrals` page combined referral and team-invitation concepts,
direct queries were broader than the privacy model, and the payout-oriented
policy UI made compensation appear central.

The repository proves that both shapes are supported in code. It does **not**
prove how many production documents belong to either shape. Production totals,
typed versus inferred counts, ambiguous records, invalid records, and active
user dependencies are all **UNKNOWN** because no production assessment was run.

### 15.2 Intended business-referral purpose

The primary Exchange referral is a private introduction in which one business
owner refers a customer, lead, project, service need, partner, or other business
opportunity to another business owner. Hi Coworking facilitates the introduction,
protects the information, helps the recipient act, and records progress and
outcome. Payment is optional, not the purpose or universal terminal state.

### 15.3 Difference between platform invitations and business referrals

| Concern | Platform invitation / membership referral | Business referral Exchange |
| --- | --- | --- |
| Purpose | Invite a person or business to join Hi Coworking | Introduce a customer, lead, project, need, or opportunity to another business |
| Typical private data | Invitee email and attribution | Third-party contact, commercial need, notes, evidence, progress, outcome |
| Actors | Inviter and verified invitee | Referrer, recipient, their authorized organizations, assigned staff/admin |
| Lifecycle | Pending, claimed/cancelled, expired | Draft, sent, accepted/declined, in progress, converted/closed, withdrawn/expired |
| Incentive | Credits or membership promotion may apply | Compensation is optional and defaults to none |
| Exchange priority | Secondary capability | Primary referral capability |

A platform invite never grants access to a business referral.

### 15.4 Existing collection compatibility

No collection was renamed or deleted. `referrals` remains the secured legacy
compatibility collection. New legacy-compatible creation through `referral_create`
creates **platform invitations only** and rejects attempts to create a new
commercial introduction. `platformInvite_listReceived` returns only explicitly
typed or safely inferred platform invitations matched to a UID or verified email.

`platformInvites` has a forward schema and least-privilege rules boundary, but
Run 1 intentionally continues writing membership invitations to `referrals` to
avoid an unmeasured production cutover. New commercial introductions use the
separate `businessReferrals` domain, with `businessReferralContacts` and
`businessReferralDisputes` for more sensitive subdomains.

`legacyBusinessReferral_listReceived` returns only unambiguous provider/provider-
organization records and redacts inline contact fields unless the legacy record
proves confirmed consent or explicit recipient disclosure. Ambiguous mixed
records fail closed.

### 15.5 Final business-referral authorization model

- Creation binds `referrerUid` to the actor. A supplied referring organization
  requires current owner/admin authority.
- A recipient UID and/or active recipient organization must exist; a user or
  organization cannot refer to itself.
- Only the referrer side can send or withdraw. Only the recipient side can
  accept, decline, progress, convert, or close.
- Referrer-side authority cannot impersonate the recipient and recipient-side
  authority cannot impersonate the referrer, even when one user has memberships
  on both sides.
- Full referral reads are limited to the individual parties, current active
  organization parties, assigned staff, and admin/master. Ordinary unassigned
  staff do not receive blanket access to business-referral data.
- Direct writes to referrals, contacts, and disputes are denied; strict callables
  enforce versions, transitions, immutable identities, actor/timestamp fields,
  and audit.
- Disputes may be opened by an authorized party in a disputable state. Only an
  assigned staff member or admin/master may resolve; an assigned non-admin staff
  opener cannot resolve their own dispute, and only the referral's current
  `activeDisputeId` can be cleared.

Legacy platform-invite actions remain invitee-bound by UID or verified email.
Legacy commercial actions remain provider/provider-organization-bound. Only an
admin/master may verify a legacy settlement, and the former payout checkout now
fails closed because it collected funds without proving disbursement.

### 15.6 Privacy and consent assumptions

The main `businessReferrals` record contains a minimized party summary. Names,
email addresses, and phone numbers live in the same-ID
`businessReferralContacts` document. The referrer and assigned staff/admin may
read it; the recipient side may read it only when
`recipientDisclosureAllowed == true`, which is updated transactionally with
confirmed or withdrawn consent.

Permitted create-time consent values are `not_required`, `pending`, or
`confirmed`. Direct third-party contact details cannot be labeled
`not_required`; they require an explicit consent state. With pending consent,
the recipient can receive the minimized referral without direct contact details.
Withdrawal revokes disclosure and moves an active referral to `withdrawn`.
Imported legacy contacts are `unknown_legacy`, are not disclosed, and require
review.

Referral and dispute evidence use private canonical Storage paths. Recipient
evidence reads require confirmed/not-required consent; referrers, assigned staff,
and admin/master retain the documented incident/administration access.

These controls are technical safeguards, not a legal determination that the
referrer has a valid basis to disclose information. Owner/legal review is
required for consent language, `not_required` policy, data minimization,
jurisdiction, retention, access logging, export/deletion, and administrative
access.

### 15.7 Business-referral status model

The enforced business lifecycle is:

```text
draft -> sent -> accepted -> in_progress -> converted
               |          |               -> closed
               |          -> closed
               -> declined
draft|sent -> withdrawn
sent       -> expired
```

Sending establishes a 30-day expiry. A bounded hourly worker moves unanswered,
expired `sent` records to `expired`. `converted` requires a `converted` outcome;
`closed` requires a non-converted outcome. Outcome actor and timestamp are
server-assigned. Active disputes block progress.

### 15.8 Optional compensation model

`compensationPolicy` is optional and defaults to `{ type: "none", status:
"none" }`. Supported policy types are `none`, `fixed`, `percentage`, and
`custom`. Non-none terms begin `proposed`, become `agreed` and locked when the
recipient accepts, may become `due` on conversion, and are cancelled on decline,
withdrawal, non-converted closure, or expiry. A dispute temporarily records and
replaces the prior financial status.

There is no Run 1 amendment workflow after acceptance and no settlement provider
for the new business-referral model. A referral does not automatically become
`paid`. Tax, licensing, payment-provider, accounting, and contract policy require
separate owner/legal/finance approval.

### 15.9 Migration strategy

`assessLegacyReferrals` classifies every legacy record as platform invite,
business introduction, ambiguous, or invalid without modifying the source.
Untyped records are inferred only when their field sets are mutually exclusive.
Apply mode may **copy**, never move, an unambiguous business introduction to
`businessReferrals/legacy_{legacyId}`, place contact details in the separate
contact document with `unknown_legacy` consent, and create a deterministic
`legacyReferralMappings/{legacyId}` record plus audit. It does not copy platform
invites, guess mixed records, delete source data, or treat legacy payout state as
trusted compensation.

The script is dry-run by default, paginated, idempotent, and requires exact
project confirmation in apply mode. Production source/target counts remain
**UNKNOWN**. Exact commands and release gates are in section 32.

### 15.10 Referral items deferred to Run 2

Run 2 must build the responsive business-referral Exchange workspace: sent and
received lists, creation, accept/decline, contact reveal, progress, conversion,
closure, private timeline and notes, business-profile integration, RFx/team/
opportunity links, Attention Center notifications, and usable error/loading
states. Platform invite incentives must appear separately from that workspace.

### 15.11 Referral items deferred to Run 3

Run 3 owns policy-approved retention, export, deletion, consent-subject requests,
compensation amendments and settlement, deeper dispute case management,
legacy-collection retirement after measured adoption, generalized opportunity
integration, analytics, and any cross-jurisdiction privacy automation.

## 16. Team authorization model

New teams are created by `team_create` only for a valid approved/open RFx in a
released territory. The creator must pass transaction eligibility and becomes
the single prime. The transaction creates the team, canonical
`members`/`memberUids`, a deterministic authoritative membership guard under
`rfxTeamMemberships/{teamId}/members/{uid}`, audit, and idempotency state.

`team_listMine` returns only teams backed by the caller's exact guard. Team reads
and team-document reads require both the denormalized member UID and the exact
guard; removing the guard immediately removes authority even if stale array data
remains.

Only the current prime can invite, revoke, change roles/scopes, or remove a
member. Invitations bind exact `teamId`, `rfxId`, inviter, invitee, and a shared
non-prime role. A deterministic invite guard prevents duplicate active invites;
existing members cannot be re-invited. Acceptance verifies the authenticated
invitee, team/RFx/inviter identity, status, expiry, capacity, prime guard, and
duplicate membership, then atomically updates the invitation, member arrays,
member guard, duplicate guard, and audit. Decline and revoke are likewise
server-authoritative. The sole prime cannot be removed or demoted.

`team_expire_invites` runs every 15 minutes in bounded batches and supports both
canonical epoch-millisecond expiry and legacy Firestore `Timestamp` values.

## 17. Team invitation migration

`backfillTeamInvitationTeamIds` is dry-run by default and reports total scanned,
already valid, exactly resolved, ambiguous, missing team, invalid RFx, invalid
role, duplicates, accepted-without-member, pending-existing-member, Timestamp
expiry values, failed writes, and review-required IDs.

A missing `teamId` is resolved only when `rfxId + inviterUid` matches exactly one
team whose RFx and prime identity are consistent. Zero or multiple matches are
not guessed. Apply mode writes exact resolutions, normalizes legacy Timestamp
expiries, and persists unresolved cases in `rfxTeamInviteReviews` for
administrative review, with audit.

`backfillTeamMemberships` separately validates exact team identity, RFx, role,
array parity, uniqueness, member limit, and exactly one matching prime. It creates
or reconciles membership guards only for valid teams, deletes stale guards, and
records invalid teams in `rfxTeamMembershipReviews`. Both scripts require an
explicit project and matching confirmation to apply and are safe to repeat.

Production invitation/team counts are **UNKNOWN**. Membership guards must be
reconciled, and invalid teams explicitly reviewed, before deploying rules that
depend on those guards.

## 18. Territory policy

The RFx target `territoryFips` is authoritative for publishing, response, and
team formation. It must identify an existing `released` territory; missing,
unknown, paused, archived, or coordinate-invalid territory fails closed.

Publishing uses the territory's authoritative centroid to calculate geohash.
Ordinary users cannot pair a released FIPS code with arbitrary coordinates.
Territory create/update validates latitude in `[-90, 90]` and longitude in
`[-180, 180]`.

Because the current data model has no authoritative business home/service area,
a verified external business may respond to an RFx in a released target
territory without proving that its own home territory is released. Teaming also
uses the RFx territory. Admin/master may override missing/unreleased territory
only through a documented explicit reason path where implemented, and the
override is audited.

Remote and multi-territory opportunities are not represented by a missing FIPS;
an explicit service-area/multi-territory model is deferred. Geocoding failure
does not become authorization. `rfx_backfillGeo` can derive missing geohashes
only from validated territory centroids, is dry-run by default, uses a document-
ID cursor, and requires exact project confirmation to apply.

## 19. Organization-ownership assumptions

Forward-compatible Exchange records use `ownerUid` plus optional `orgId`, while
legacy `createdBy` remains readable for individually scoped records. A record
with `orgId` is organization-scoped: current exact organization membership
supersedes historical creator identity.

- Individual or organization owned: RFx publishing, RFx responses, teams, and
  business-referral sides where their input supports `orgId`.
- Individual actor remains recorded: every action and audit event retains the
  authenticated UID.
- Organization management action: requires active org and `owner`/`admin` role.
- Organization participant read: requires current active exact membership; a
  former member loses access.
- Legacy individual records: continue to use `createdBy`/participant UID when no
  organization scope exists.

Run 1 charges the acting user's protected plan/credits for user-billed actions,
even when the created RFx is organization-owned. Organization billing,
delegation beyond the existing roles, team-prime transfer, and a full
organization-platform redesign are deferred.

## 20. Storage authorization model

New sensitive records store canonical Storage paths, not permanent download URLs,
as their authorization source. The client reads authorized objects with the
authenticated Firebase SDK into short-lived in-memory blob URLs. The rules end
with default deny.

| Path | Read authority | Create authority and limits | Mutation policy |
| --- | --- | --- | --- |
| `capabilityStatements/{uid}/{file}` | owner/staff, or anonymous only for the exact asset selected by a published projection | owner; document/image allowlist; 10 MiB | no overwrite; owner/admin delete |
| `profilePhotos/{uid}/{file}` | owner/staff, or anonymous only for the exact selected photo/poster | owner; image allowlist; 5 MiB | no overwrite; owner/admin delete |
| `profileVideos/{uid}/{raw|processed|posters}/{file}` | owner/staff; anonymous only for exact selected processed video or poster | owner; video allowlist; 100 MiB | no overwrite; owner/admin delete; raw history stays private |
| `verificationDocs/{uid}/{type}/...` | owner and staff/admin | path-bound owner; private-document allowlist; 15 MiB | no overwrite; owner cannot delete after evidence lock; admin may delete |
| `rfxResponses/{rfxId}/{uid}/...` | pre-submit uploader draft; after submit, only exact marker paths for current respondent side, issuer side, or staff/admin | path-bound UID with valid exact upload grant; 25 MiB | no overwrite; submitter delete only before submission; admin delete |
| `teamDocuments/{teamId}/{uid}/...` | exact current guarded team members/staff | guarded member/uploader; 25 MiB | no overwrite; uploader while member or admin delete |
| `businessReferralEvidence/{referralId}/{uid}/...` | referrer, assigned staff/admin, or consent-authorized recipient | exact referral party/uploader; 15 MiB | no overwrite; referrer-uploader may delete only in draft; admin delete |
| `businessReferralDisputeEvidence/{referralId}/{uid}/...` | same consent-sensitive party model | exact party/uploader; 15 MiB | no overwrite; admin delete |

Legacy `/proposals/{rfxId}/{responseId}/...` remains read-only for exact response
participants. Client-era `rfxProposals/{rfxId}/{respondentUid}/...` and
`rfxDocuments/{rfxId}/{respondentUid}/...` are also read-only and only when the
response-marker migration proves the exact response, respondent, optional
organization, and referenced object path. Siblings and URL-only records remain
denied. New writes use `rfxResponses` only.

## 21. Audit model

`exchangeAudit` is server-write-only, append-only for clients, and staff-readable.
Each event records ID, actor UID/role, action, entity type/ID, optional organization,
previous/new status, a small primitive metadata map, and timestamp.

Run 1 writes audit in the same transaction as material RFx publication/update/
moderation/cancellation/response/evaluation/award, team/invitation/membership,
business-referral/consent/dispute, platform-invite/legacy-settlement, profile
publication, verification, and migration state wherever transactional APIs allow.
System schedulers and migrations use explicit system actor IDs.

Audit metadata excludes secrets, tokens, entire records, documents, full contact
payloads, and payment credentials. `verificationAuditLog` remains the
verification-specific history; governed verification writes also emit the
cross-Exchange audit event. Audit records are retained through rollback.

## 22. Idempotency model

`exchangeIdempotency/{uid}:{action}:{key}` is server-only. A completed entry
binds the caller, action, entity, result, expiry, and SHA-256 fingerprint of the
canonical normalized request. The same key and same request replays the original
result; the same key with different input fails.

High-risk strategies are:

- RFx publish: request-bound idempotency plus transactional quota, credit, RFx,
  audit, and deterministic credit transaction ID.
- Response submit: deterministic respondent-subject response ID, query-time
  duplicate check, request-bound idempotency, atomic counter/usage/marker/audit.
- Team create: idempotency and atomic single-prime membership guard.
- Team invite: deterministic active-invite guard; accept/revoke/expire clear it
  transactionally; accepted actions are safe to replay only after exact parity
  checks.
- Platform invite and business-referral create: request-bound idempotency.
- Business-referral transitions: expected versions, side-specific authority,
  legal terminal states, and exact active-dispute identity.
- Legacy settlement: admin claim, immutable ledger reference, request-bound
  idempotency, and no URL assertion.
- Verification submission: request-bound idempotency and deterministic evidence
  document IDs/locks.
- RFx/verification mutable decisions: optimistic versions and terminal-state
  checks.
- Saved RFx: deterministic `{uid}_rfx_{entityId}` document identity.

Idempotency records currently expire logically after seven days; cleanup policy
is a later operational item.

## 23. Collections changed

### New or newly authoritative

- `publicProfiles`
- `businessReferrals`
- `businessReferralContacts`
- `businessReferralDisputes`
- `platformInvites` (prepared boundary; compatibility writer remains legacy)
- `exchangeAudit`
- `exchangeIdempotency`
- `exchangeUsage`
- `savedExchangeItems`
- `rfxResponseAccess/{rfxId}/respondents`
- `rfxResponseUploadGrantScopes/{rfxId}/uploadGrants`
- `rfxTeamInviteGuards`
- `rfxTeamMemberships/{teamId}/members`
- `rfxTeamInviteReviews`
- `rfxTeamMembershipReviews`
- `verificationEvidenceLocks`
- `legacyReferralMappings`

### Existing collections with secured contracts

`users`, `profiles`, `orgs`, `orgMembers`, `territories`, `rfx`,
`rfxResponses`, `rfxTeams`, `rfxTeamInvites`, `teamDocuments`, `referrals`,
`referralPolicies`, `referralDisputes`, `verificationDocuments`,
`verificationAuditLog`, `verificationFlags`, `userSuggestions`, `notifications`,
`payments`, `paymentAudit`, and `creditTransactions`.

No production collection was renamed, deleted, copied, or mutated in Run 1.

## 24. Schemas changed

Shared schemas now distinguish platform invites, legacy mixed referrals, business
referrals, consent-gated contact records, and domain-specific disputes. Business
referrals include side-specific UID/org identity, referral type, minimized party
summary, consent, lifecycle, actor-bound outcome, optional compensation, links,
version, expiry, dispute identity, and compatibility metadata.

RFx schema version 2 adds authoritative `ownerUid`, optional `orgId`, normalized
geo, approval invariant, version, response count, selected response, and lifecycle
timestamps. Response schema version 2 adds authoritative respondent identity,
optional respondent organization, canonical proposal/document paths, evaluation
state, idempotency key, and version. Legacy `pending` response status is treated
as submitted for compatibility.

Team invitation schema now requires exact `teamId`, non-prime shared role,
canonical epoch expiry, status, response/revocation fields, and version-compatible
timestamps. Team documents and teams use canonical Storage paths, shared roles,
member array parity, and versioning. Separate membership guards are the
revocation-safe read authority.

Profile schemas add canonical owner-bound asset paths and preserve legacy URL
fields only for compatibility. Verification schemas bind evidence to UID, type,
canonical path, status, reviewer, version, and evidence lock. Shared eligibility,
audit, saved-item, and credit-transaction contracts were added or aligned.

All new protected callable inputs use strict schemas and reject unknown fields.
Persisted Run 1 timestamps use epoch milliseconds; the team migration and expiry
worker recognize legacy Firestore Timestamp values.

## 25. Functions changed

### Profiles, verification, and territory

- `profile_update`: owner allowlist, canonical path ownership, server calculations,
  private/public projection transaction, publication audit.
- `verification_submit`: canonical stored-object verification, deterministic
  evidence IDs/locks, fingerprinted idempotency, atomic profile/audit updates.
- `verification_review`: staff/admin boundary, no self-review, exact
  document-owner match, evidence prerequisites, optimistic version, atomic audit.
- `verification_flag`: staff/admin only, no self-flag, server audit.
- `territory_create` / `territory_update`: admin/master and coordinate bounds.

### RFx

- `rfx_publish`, `rfx_update`, `rfx_moderate`, `rfx_cancel`
- `rfx_prepareResponseUploads`, `rfx_submitResponse`,
  `rfx_cleanupResponseUploadGrants`
- `rfx_evaluateResponse`, `rfx_listManaged`, `rfx_backfillGeo`

Their behavior is described in sections 12–14 and 18. Legacy competing protected
client writes were removed from active call sites.

### Teams

- `team_listMine`, `team_create`, `team_invite`, `team_respond_invite`,
  `team_revoke_invite`, `team_manage_member`, `team_expire_invites`

These enforce exact identity, current membership guards, single-prime parity,
legal invitation state, atomic membership, and fail-closed legacy review.

### Referrals

- Legacy/platform boundary: `referral_create`, `platformInvite_listReceived`,
  `legacyBusinessReferral_listReceived`, `referral_contact`, `referral_accept`,
  `referral_decline`, `referral_convert`, `referral_markPaid`, and the deliberately
  disabled `referral_createPayoutCheckout`.
- Primary business domain: `businessReferral_create`, `businessReferral_send`,
  `businessReferral_respond`, `businessReferral_progress`,
  `businessReferral_updateConsent`, `businessReferral_confirmConsent`,
  `businessReferral_withdrawConsent`, `businessReferral_createDispute`,
  `businessReferral_resolveDispute`, and `businessReferral_expireSent`.

### Runtime integration

The Functions package was upgraded to supported `firebase-functions` and
`firebase-admin` versions compatible with the Node 20 build, and the Functions
export entry point registers the new callables/schedulers. Existing adjacent
Functions that imported changed APIs were compiled and region-compatible; their
unrelated product behavior was not redesigned.

## 26. Firestore rules changed

The final Exchange rules use claim-backed staff/admin helpers, exact active
organization membership, organization-exclusive RFx ownership, side-specific
referral authority, and guarded team membership.

- `users`: owner/staff read; only the three safe self-service fields may change.
- `profiles`: private source; server-only writes. `publicProfiles`: read only when
  published; server-only writes.
- `orgs`/`orgMembers`: no all-authenticated enumeration; exact member/manager/
  staff reads; protected writes.
- `rfx`/`rfxResponses`: approval-aware discovery and exact participant reads;
  all writes server-only.
- `rfxTeams`, invitations, team documents, team guards/reviews: exact current
  participant reads and server-only lifecycle writes.
- `referrals`: only unambiguous legacy parties, assigned staff, or admin; broad
  staff access is retained only for platform invites, not third-party business
  introductions.
- `businessReferrals`, contacts, and disputes: party/assignment/admin reads with
  separate consent disclosure; server-only writes.
- `platformInvites`: inviter or verified-email invitee and staff reads;
  server-only writes.
- verification: owner/staff evidence and history reads; staff flags; server-only
  writes.
- `exchangeAudit`: staff read, server write. Idempotency, usage, response markers,
  upload grants, and evidence locks are client-inaccessible.
- saved items: own deterministic RFx records only; referenced RFx must exist;
  update denied.
- notifications: owner may change only `read` and `readAt`.

Rules are query-aware: public/profile/RFx pages use constrained collections;
received legacy referrals use server-filtered callables where Firestore cannot
prove domain purity for an email query.

## 27. Storage rules changed

The final rules match actual canonical client paths, validate exact entity
relationships, distinguish create/update/delete, enforce MIME and size limits,
and deny fallback paths. Key decisions are in section 20.

Two controls deserve explicit deployment attention:

1. submitted RFx file access requires an exact `rfxResponseAccess` marker and
   exact listed path;
2. public profile asset access grants anonymous rules access to exactly the
   selected canonical immutable object in a published `publicProfiles` record.

Publishing or unpublishing therefore changes rules-based profile access without
making sibling/history objects public. Raw video is never the public video path.
Possession of an already issued Firebase download token remains a separate legacy
risk because a token can bypass the intended application read flow; rules alone
do not revoke it.

## 28. Client paths changed

- Profile save now calls `profile_update`; profile, directory, and profile-detail
  screens consume private/source versus `publicProfiles` appropriately.
- Capability statement, photo, and video UI persists canonical paths and resolves
  permitted assets through authenticated `getBlob`/object URLs. New file names
  are unique and path-safe.
- RFx create sends only allowlisted publisher fields with an idempotency key.
- RFx owner/admin screens use update/moderate/cancel callables and version data;
  server-filtered `rfx_listManaged` supplies individual and current organization
  authority.
- Response form prepares exact upload grants before upload and submits through
  `rfx_submitResponse`; evaluator downloads canonical private paths through the
  authenticated SDK and evaluates through the callable.
- RFx browse/recommendation/map queries require approved/open state and use the
  versioned indexes/geohash fields.
- Saved RFx state moved behind `savedExchange.ts` to deterministic Firestore
  documents. A one-time, validated, idempotent import preserves legacy local
  saves.
- Team creation/invite/respond/revoke/manage paths use callables and
  `team_listMine`; legacy invitation UI receives exact IDs.
- `/referrals` preserves the existing platform-invite experience but labels and
  filters the domains, uses server-mediated received lists, and no longer sends
  new business introductions through the legacy creator. The complete new
  business-referral workspace is intentionally deferred.
- Admin verification actions use protected callables; private evidence is no
  longer represented as an authoritative public URL.

The command-center/navigation redesign and unrelated booking, floor-plan,
landing-page, and payment redesigns were not undertaken.

## 29. Tests added

The new Vitest/Firebase Emulator foundation includes:

- 8 Firestore rules scenarios covering user self-escalation, profile projection,
  RFx/response server authority, legacy/new referral party and consent access,
  team/invitation privacy, saved-item identity, and verification privacy;
- 5 Storage rules scenarios covering exact upload grants/response paths,
  selected public profile assets, current organization response access,
  verification locks, team guards, referral consent/evidence, size, MIME, and
  cross-user denial;
- 20 emulator-backed callable cases for RFx authority, managed org scope,
  quota, upload grants, geo cursor, atomic response/count, high-cardinality award,
  team identity/expiry, referral domain separation/redaction/settlement,
  business-referral consent/outcome, and verification owner/reviewer identity;
- 10 pure contract/projection scenarios for strict HTTP(S)/canonical assets,
  public allowlisting, cross-account paths, business-referral lifecycle/outcome/
  consent/disputes, and RFx/team persisted shapes;
- 18 migration scenarios across legacy referral classification, team invitation
  links, Timestamp expiry, team membership guards, public profile projections,
  and RFx response-access markers, including dry-run, ambiguity, cursor,
  idempotency, and exact project confirmation.

The root scripts are:

```bash
npm run build:shared
npm run build:functions
npm run lint
npm run build
npm run test:rules
npm run test:functions
npm run test:migrations
npm run test:security
git diff --check
```

CI runs Node 20, Java 21, clean install, both builds, lint, the complete emulator
security suite, a static web build with demo Firebase values, and whitespace
validation. Current exact results are:

- `npm run test:functions`: **PASS**, 2 files and 30/30 tests.
- `npm run test:rules`: **PASS**, 2 files and 13/13 tests.
- `npm run test:migrations`: **PASS**, 2 files and 18/18 tests.
- `npm run test:security`: **PASS**, 6 files and 61/61 tests in 36.37 seconds,
  including the shared and Functions builds plus Authentication, Firestore,
  Functions, and Storage emulator coverage.
- demo-environment `npm run build`: **PASS**, including the Next.js TypeScript
  phase and 51/51 static routes.
- deterministic Node 20 `npm ci`: **PASS** against the committed lockfile.
- `npm run lint`: **PASS** (exit 0), with five pre-existing warnings outside the
  Run 1 Exchange changes and zero errors.
- `npm audit --omit=dev --audit-level=low`: **PASS**, zero production
  vulnerabilities after the reviewed `postcss` `^8.5.19` and `uuid` `^11.1.1`
  overrides and the Node 20-compatible `universal-analytics` `0.5.3` pin. Full
  development `npm audit` reports three moderate advisories only in the
  `firebase-tools -> @google-cloud/pubsub -> @opentelemetry/core` toolchain. npm
  offers only a breaking `firebase-tools` downgrade, not a non-breaking fix.
- `npm run typecheck --workspace apps/web`: **NOT AVAILABLE** because the web
  workspace defines no `typecheck` script. This is not reported as a pass; the
  web build's TypeScript phase passed, and the Functions TypeScript build is a
  separate required gate.

The hosted CI run remains to be recorded after push/PR; this document does not
fabricate it. No test contacted production.

## 30. Index changes

`firestore.indexes.json` now versions 27 composite indexes:

- `publicProfiles`: published + business name.
- `rfx`: discovery by status/approval/date; map by status/approval/geohash;
  creator, owner, and organization management/date; creator/status quota.
- `rfxResponses`: RFx/date, respondent/date, respondent/status.
- `rfxTeamInvites`: invitee/date, status/expiry, RFx/date.
- `referrals`: referrer/date, referrer/type/date, provider/date, invited email/date.
- `businessReferrals`: referrer/date, recipient/date, status/expiry.
- `orgMembers`: UID/date and organization/date.
- `territories`: status/name and status/release date.
- `exchangeAudit`: entity type/entity ID/date.
- `savedExchangeItems`: UID/date.
- collection-group `uploadGrants`: grant type/expiry for orphan cleanup.

Indexes must be deployed and reach `READY` before Functions, rules, schedulers, or
clients issue the dependent production queries.

## 31. Environment variables required

Run 1 adds no new production application secret. Existing product Functions still
require their separately managed secrets; this branch does not rotate or print
them. The current source declares these existing Secret Manager bindings:
`RECAPTCHA_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, `SAM_GOV_API_KEY`, `SENDGRID_API_KEY`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`,
`SEAM_API_KEY`, and `SEAM_WEBHOOK_SECRET`. Verify their versions and IAM bindings
without reading values before a Functions release. The existing
`INTUIT_USE_SANDBOX` setting also controls the pre-existing Intuit environment.

Local/CI web builds require the existing public Firebase variables:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Existing optional/product-specific web settings are
`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`,
`NEXT_PUBLIC_LEADS_SUBMIT_URL`, and `NEXT_PUBLIC_USE_FIREBASE_EMULATOR`. Run 1 does
not introduce or rotate them; use the existing reviewed production values.

CI also uses `SKIP_BOOKSTORE_SYNC=true` so a security build does not depend on an
external content sync. Functions require Node 20. Emulator tests require Java 21
and set emulator hosts through `firebase emulators:exec`.

Production migration scripts require approved Google Application Default
Credentials with the minimum Firestore access needed for assessment/apply and an
explicit project. Credentials must not be committed, pasted into reports, or
stored in shell history. `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` may identify the
project; apply-capable scripts additionally require `--project` where supported
and an exact `--confirm-project` guard.

## 32. Migration instructions

### Safety rules

- No production migration was run. All production scanned/affected counts are
  **UNKNOWN**.
- Obtain owner approval, maintenance window, audit destination, and a Firestore/
  Storage backup before any apply step.
- Build the exact reviewed commit under Node 20, use approved credentials, and
  confirm `gcloud config get-value project` and `firebase use` both show
  `hi-coworking-plat`.
- Run a bounded dry run first, then the complete dry run. Archive the JSON report
  and resolve every `failed`, `invalid`, `ambiguous`, or review-required result
  that gates access.
- Apply one migration at a time. Re-run dry run afterward; it must report current
  or zero pending changes. Never infer or manually force ambiguous identity.

From the reviewed repository root:

```bash
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
npm ci
npm run build:shared
npm run build:functions
```

Use the approved production credential mechanism, then run these **dry runs**:

```bash
node apps/functions/lib/scripts/backfillPublicProfiles.js \
  --project=hi-coworking-plat --limit=100 --page-size=100

node apps/functions/lib/scripts/backfillRfxResponseAccess.js \
  --project=hi-coworking-plat --limit=100 --page-size=100

node apps/functions/lib/scripts/backfillTeamInvitationTeamIds.js \
  --project=hi-coworking-plat --limit=100 --page-size=100

node apps/functions/lib/scripts/backfillTeamMemberships.js \
  --project=hi-coworking-plat --limit=100 --page-size=100

GOOGLE_CLOUD_PROJECT=hi-coworking-plat \
  node apps/functions/lib/scripts/assessLegacyReferrals.js \
  --limit=100 --page-size=100
```

Remove `--limit` for the complete public-profile, invitation, membership, and
legacy-referral dry runs. The response-marker script deliberately defaults to a
1,000-record page window and supports a deterministic cursor; continue until
`complete: true`:

```bash
node apps/functions/lib/scripts/backfillRfxResponseAccess.js \
  --project=hi-coworking-plat --limit=1000 --page-size=200 \
  --after-id=NEXT_AFTER_ID
```

An empty first page omits `--after-id`. `invalid` and `ambiguous` make that script
exit nonzero by design because those responses cannot safely receive a marker.

Only after approval of the complete reports, the corresponding **apply** forms
are:

```bash
node apps/functions/lib/scripts/backfillPublicProfiles.js \
  --apply --project=hi-coworking-plat --confirm-project=hi-coworking-plat

node apps/functions/lib/scripts/backfillRfxResponseAccess.js \
  --apply --project=hi-coworking-plat --confirm-project=hi-coworking-plat \
  --limit=1000 --page-size=200

node apps/functions/lib/scripts/backfillTeamInvitationTeamIds.js \
  --apply --project=hi-coworking-plat --confirm-project=hi-coworking-plat

node apps/functions/lib/scripts/backfillTeamMemberships.js \
  --apply --project=hi-coworking-plat --confirm-project=hi-coworking-plat

GOOGLE_CLOUD_PROJECT=hi-coworking-plat \
  node apps/functions/lib/scripts/assessLegacyReferrals.js \
  --apply --confirm-project=hi-coworking-plat
```

Continue response-marker apply pages with the returned `nextAfterId`. That script
accepts only one unambiguous response per `{rfxId, respondentUid}` and exact
entity-bound paths under `rfxResponses`, legacy `rfxProposals`, or legacy
`rfxDocuments`; it preserves unrelated marker metadata and replaces every field
used as Storage authority. URL-only, duplicate, conflicting-identity, or other
noncanonical legacy responses require an owner-approved remediation plan before
Storage rules deployment.

The legacy-referral apply is optional during Run 1 release: it copies only
unambiguous business introductions and never deletes legacy source. Do not run it
until owner/legal review approves handling of `unknown_legacy` consent and legacy
compensation. Platform invites remain in place.

`rfx_backfillGeo` is an admin/master callable rather than a local script. Invoke
it page by page after Functions deployment. Dry-run request:

```json
{ "maxDocs": 300, "apply": false }
```

Continue with the returned `nextAfterId`. Approved apply request:

```json
{
  "maxDocs": 300,
  "afterId": "PREVIOUS_NEXT_AFTER_ID",
  "apply": true,
  "projectId": "hi-coworking-plat",
  "confirmProject": "hi-coworking-plat"
}
```

The callable ignores arbitrary legacy coordinates and uses only validated
territory centroids. Record `processed`, `wouldUpdate`, `updated`, `skipped`,
invalid-centroid count, cursor, and completion for every page.

Additional required inventories currently have no automatic apply: privileged
legacy user/profile values, bearer download URLs/tokens, unreferenced Storage
siblings, URL-only response evidence, and inconsistent RFx response counts. These
remain explicit release gates or owner-accepted limitations; do not improvise
destructive corrections.

## 33. Deployment sequence

No step below was executed in production. After merge, use this exact order:

1. Freeze Exchange writes for the maintenance window. Record the release commit,
   current Hosting release, deployed Functions manifest, rule versions, and index
   state. Export the affected Firestore collections and inventory affected
   Storage prefixes to an approved, retention-protected backup location.
2. Re-run all CI commands from section 29 on the merge commit. Abort on any
   failure or unreviewed diff.
3. Deploy indexes only:

   ```bash
   firebase deploy --project hi-coworking-plat --only firestore:indexes
   ```

   Wait until all 27 required indexes report `READY`.
4. Deploy the reviewed Run 1 Functions before any client or restrictive rules.
   The release set is the Functions listed in section 25, including all new
   RFx/referral/team/profile/verification callables and the three new schedulers.
   Use the explicit selection below and review Firebase's planned manifest before
   confirming:

   ```bash
   RUN1_FUNCTIONS="functions:profile_update,functions:verification_submit,functions:verification_review,functions:verification_flag,functions:territory_create,functions:territory_update,"
   RUN1_FUNCTIONS+="functions:rfx_publish,functions:rfx_update,functions:rfx_moderate,functions:rfx_cancel,functions:rfx_prepareResponseUploads,functions:rfx_submitResponse,functions:rfx_evaluateResponse,functions:rfx_listManaged,functions:rfx_backfillGeo,functions:rfx_cleanupResponseUploadGrants,"
   RUN1_FUNCTIONS+="functions:team_listMine,functions:team_create,functions:team_invite,functions:team_respond_invite,functions:team_revoke_invite,functions:team_manage_member,functions:team_expire_invites,"
   RUN1_FUNCTIONS+="functions:referral_create,functions:platformInvite_listReceived,functions:legacyBusinessReferral_listReceived,functions:referral_contact,functions:referral_accept,functions:referral_decline,functions:referral_convert,functions:referral_markPaid,functions:referral_createPayoutCheckout,"
   RUN1_FUNCTIONS+="functions:businessReferral_create,functions:businessReferral_send,functions:businessReferral_respond,functions:businessReferral_progress,functions:businessReferral_updateConsent,functions:businessReferral_confirmConsent,functions:businessReferral_withdrawConsent,functions:businessReferral_createDispute,functions:businessReferral_resolveDispute,functions:businessReferral_expireSent"
   firebase deploy --project hi-coworking-plat --only "$RUN1_FUNCTIONS"
   ```

   If the release process cannot select and verify that exact set, stop instead
   of deploying an unreviewed full manifest.
5. Run and archive the complete production dry runs from section 32. Production
   affected counts become known only here. Resolve or explicitly approve every
   ambiguity and invalid record.
6. Apply, in order: public profile projections; RFx response-access markers; team
   invitation identity/expiry; team membership guards. Re-run each assessment to
   prove idempotent convergence. Apply legacy-referral copy and RFx geo only if
   their separate owner approvals were granted.
7. Confirm `rfxTeamInviteReviews`, `rfxTeamMembershipReviews`, response-marker
   review output, and bearer/legacy Storage inventory have an approved disposition.
   Do not tighten a boundary that would strand active users without an accepted
   compatibility plan.
8. Deploy Firestore rules:

   ```bash
   firebase deploy --project hi-coworking-plat --only firestore:rules
   ```

   Smoke-test account/profile, directory, RFx discovery/management, team,
   referral, verification, notifications, and saved-item reads/writes with test
   users for every role and organization side.
9. Deploy Storage rules:

   ```bash
   firebase deploy --project hi-coworking-plat --only storage
   ```

   Smoke-test selected public profile assets; private verification; upload-grant,
   pre-submit, submitted exact-path, issuer, and unrelated RFx attachment access;
   current/removed team member access; and referral consent access.
10. Build and deploy the reviewed web client:

    ```bash
    npm run build
    firebase deploy --project hi-coworking-plat --only hosting
    ```

11. Run the 18 manual scenarios from the Run 1 specification in production-safe
    test accounts: publish/moderate/respond/evaluate, team invite/accept denial,
    referral privacy/legal transitions, verification self-review denial,
    protected uploads, and retry idempotency.
12. Unfreeze Exchange writes only after smoke tests pass. Monitor Functions errors,
    `permission-denied`/`failed-precondition` rates, scheduler backlogs, index
    errors, Storage denials, audit creation, response-count parity, and user
    support signals through the rollback window.

## 34. Rollback plan

Rollback prioritizes confidentiality and preserving evidence; it must not reopen
the baseline broad access merely to restore convenience.

1. Re-freeze Exchange writes and stop the affected client workflow. Preserve logs,
   audit, idempotency, and migration reports.
2. Roll Hosting back through the Firebase release history or rebuild/redeploy the
   recorded prior SHA with its original environment.
3. Redeploy the recorded prior Function versions for changed entry points, or
   disable new UI entry points while a forward fix is prepared. Keep new data and
   unknown schema fields; old readers must ignore them rather than delete them.
4. Prefer a forward least-privilege rule fix. Roll rules back only to a reviewed
   version that does not restore unrelated-user access. Firestore and Storage
   rules can be rolled independently if the failure is isolated.
5. Leave additive indexes in place; they are safe during rollback and deleting
   them can cause a second outage.
6. Do not delete `exchangeAudit`, idempotency records, legacy mappings, review
   records, response markers, or team guards as a generic rollback.
7. Migration data is additive/derived but still requires the pre-release export
   for reversal. Restore the affected documents from that export if a projection,
   invitation, membership guard, response marker, or geo write is proven wrong.
   Do not hand-delete inferred fields without matching the archived report and
   audit identity.
8. Legacy referral copy never removes the source. If a copied record is wrong,
   quarantine its new-domain use, retain mapping/audit, and resolve through an
   approved corrective migration rather than erasing history.
9. Re-run emulator/production-safe smoke tests and reconcile counts before
   unfreezing. Record cause, exact rollback versions, affected IDs/counts, and any
   follow-up data repair.

## 35. Deferred Run 2 items

Run 2, **Complete Exchange command-center MVP**, must build on these boundaries
rather than reintroducing direct protected writes. Its prerequisites and scope
include:

- a unified `/exchange` command center and responsive navigation/command bar;
- complete business-referral sent, received, create, accept/decline, contact,
  progress, conversion, closure, timeline, notes, and notification experience;
- business-profile, RFx, team, and future opportunity linking;
- platform-invitation incentives displayed separately from business referrals;
- Attention Center integration;
- managed saved/watch experiences beyond RFx and any approved local-import UX;
- admin review queues for ambiguous legacy referrals, team links/memberships,
  response markers, and Storage compatibility;
- organization-aware UX for choosing and explaining ownership/billing scope;
- explicit remote/service-area/multi-territory product decisions;
- operational dashboards for audit, scheduler backlog, permission failures, and
  compatibility adoption.

Run 3 remains responsible for generalized opportunity/grant/loan/incentive/
technical-assistance/workforce/property/site directories, relationship graph,
analytics/AI matching, policy-approved data-subject operations and retention,
compensation amendment/settlement, legacy retirement, and deeper payment/provider
hardening outside this Run 1 boundary.

## 36. Known limitations

- No production data was read or changed. Production counts, legacy shape
  distribution, active dependencies, and migration duration are **UNKNOWN**.
- No production deployment, migration, browser smoke test, secret rotation,
  credit change, or billing change occurred in Run 1.
- The production dependency audit is clean, but the development-only Firebase
  CLI dependency chain retains three moderate
  `@google-cloud/pubsub`/OpenTelemetry 1.x advisories. npm offers only a breaking
  `firebase-tools` downgrade; this remains a documented tooling limitation rather
  than an unreviewed downgrade in the release path.
- Existing Firebase download URLs remain bearer tokens. Public-profile projection
  keeps a validated legacy HTTP(S) URL only when no canonical path exists, and
  tightening rules does not revoke previously issued tokens. Inventory and token
  rotation need explicit owner approval.
- New profile video uploads are raw/private. A processing pipeline must create a
  canonical `processed` object before it can be the exact publicly selected video;
  Run 1 does not implement transcoding.
- Exact, response-referenced `rfxProposals` and `rfxDocuments` objects can remain
  read-compatible through a migrated response marker, but all writes and sibling
  reads are denied. URL-only or noncanonical response attachments still require
  inventory/remediation before the new Storage boundary can replace legacy access.
- The response marker is keyed by RFx and submitter UID. Duplicate legacy
  responses for that key fail migration as ambiguous. RFx response/award capacity
  is intentionally capped at 400 for transactional safety.
- Upload grants expire after two hours; cleanup scans at most 100 per hourly run.
  Storage deletion is best-effort, so operational orphan monitoring is still
  needed.
- Business-referral and dispute evidence can be uploaded before the final
  Firestore record/action. Run 1 has validation but no general orphan-retention
  worker for those prefixes.
- The complete business-referral UI, new-domain list/notification experience, and
  platform-invite split are not complete. The current `/referrals` page remains a
  secured legacy compatibility surface.
- `platformInvites` is a prepared schema/rules boundary; the compatibility writer
  still stores membership invitations in `referrals` until production use is
  measured.
- New business-referral compensation has no amendment or settlement workflow.
  Legacy payout checkout is intentionally disabled; legacy settlement verification
  is admin/master-only and is not proof that a new compensation program is legally
  approved.
- Staff can read a business referral only when assigned (admin/master retains
  administrative access), but a complete staff-assignment/case-management UI is
  deferred.
- Consent controls do not determine legal basis. Owner/legal review is required
  for third-party sharing language, `not_required`, withdrawal consequences,
  retention, export/deletion, jurisdiction, minors/sensitive information,
  administrative access, evidence retention, and incident response.
- Owner/legal/product review is also required before publicly projecting UEI,
  DUNS, CAGE, trust metrics, badges, or verification state.
- Organization billing and delegated roles are not redesigned; acting-user plan/
  credits remain the documented billing source for Run 1.
- There is no authoritative business home/service-area model. Remote and
  multi-territory RFx require a future explicit contract.
- Team dissolution, prime transfer, multi-prime teams, and repair of invalid legacy
  teams remain administrative follow-up.
- Idempotency records have a seven-day logical expiry but no dedicated cleanup
  worker in this run.
- Index build time and custom-claim propagation can create temporary release
  delays. Deployment must wait for index readiness and refreshed claims.
- Adjacent payment/OAuth/webhook findings require separate scoped review. This
  document does not claim that all non-Exchange platform security is remediated.

## Appendix A — Pre-implementation security and dependency assessment

This appendix preserves the required 20-point assessment against the actual
baseline rather than assuming prior reports were current.

1. **Existing collections and schemas.** Identity, entitlement, credit, and
   moderation fields were mixed in `users`; public/private/asserted/reviewed
   profile fields were mixed in `profiles`; RFx was creator-only; `referrals`
   mixed domains; team invites lacked `teamId`.
2. **Existing client write paths.** Direct writes existed for profiles, RFx,
   responses/counts, evaluation/award, referrals/policies, team invitations,
   organizations/members, and notification state. Some were broken by rules;
   others bypassed policy.
3. **Existing callable Functions.** Callables covered RFx publication/geo,
   referral lifecycle/payout, teams, verification, territory, organizations, and
   payments, but most accepted ad-hoc casts and duplicated contracts. A second
   team-invite path bypassed prime authorization.
4. **Existing direct Firestore writes.** Response creation and count increment
   were separate. Partial success could leave a response while the UI reported
   failure and encouraged retry.
5. **Existing Storage paths.** Rules named `proposals` while clients used
   `rfxProposals`/`rfxDocuments`; verification/video/team paths were incomplete;
   nominal proposals were all-authenticated; permanent URLs were persisted.
6. **Existing permission model.** Protected Functions trusted mutable Firestore
   role/plan/credit mirrors and treated authentication as membership without
   consistent active/expiry/suspension checks.
7. **Existing organization ownership.** Deterministic membership documents and
   owner/admin/member roles existed, but RFx, response, team, and referral paths
   applied them inconsistently; org data was over-enumerable.
8. **Existing territory policy.** Publication/team checks differed, missing data
   could default released, response had no server check, and the client used any
   released territory as eligibility.
9. **Existing approval/moderation.** `rfx_publish` accepted approval input,
   defaulted approved/open, and the normal client sent approved; admin UI could
   create contradictory status/approval pairs.
10. **Existing credit/membership enforcement.** Mutable user values, incomplete
    membership/expiry checks, missing publish idempotency, and query-then-create
    quotas created duplicate charge/allocation risk.
11. **Existing audit coverage.** Verification/payment had fragmented logs; RFx,
    responses, awards, cancellations, teams, invitations, referrals,
    organization authority, and overrides lacked unified atomic audit.
12. **Existing automated tests.** None for rules, Storage, callables, migrations,
    integration, browser, or CI.
13. **Security vulnerabilities.** Self-elevation/self-verification, forged
    RFx/responses/scores, broad referral reads, arbitrary team invitations,
    cross-user file access, broad notifications, and mixed-profile exposure.
14. **Data-integrity vulnerabilities.** Non-atomic counts, multiple winners,
    illegal status jumps, duplicate actions, divergent team arrays, mutable
    payout snapshots, and verification owner/document mismatch.
15. **Race conditions.** Publish quotas, profile save/review, invitation create/
    accept, response award, referral settlement, org slug/seats, and triggers.
16. **Privacy exposure.** Mixed profiles, all-authenticated referral/proposal
    reads, unconsented third-party contact, and over-broad org/territory metadata.
17. **Backward-compatibility risks.** Legacy ownership/status/timestamps/counts,
    missing team IDs, mixed referrals, permanent URLs, and possibly forged fields
    require tolerant readers but strict new writers.
18. **Required migrations.** Public projections, response markers/count review,
    team invitation identity/expiry, team membership guards, legacy referral
    classification, RFx geo, privileged-value review, and Storage token/path
    inventory. No production migration was authorized in Run 1.
19. **Files likely to change.** Shared schemas, Exchange Functions/exports,
    client protected call sites, Firestore/Storage rules, indexes/emulators,
    scripts/tests/CI, and this document.
20. **Dependencies among changes.** Contracts and authorization helpers precede
    Functions; compatible Functions precede migrations/rules; identity/access
    backfills precede restrictive rules; Storage markers/grants precede Storage
    rules/client; indexes precede dependent queries; documentation and rollback
    close the release.
