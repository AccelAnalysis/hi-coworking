# Organization claim workflow

The canonical lifecycle is `unclaimed → claim_pending → claimed`, with
`rejected` retained on the claim record as review history. Claim authority and
independent business verification are separate states.

## Eligible subjects

A signed-in user may request a claim only for an existing, active canonical
organization. The subject must already have passed its governed publication
path. IDs prefixed as external or restricted source matches are rejected; a
claim request cannot promote restricted matching evidence into `orgs` or
`publicOrganizations`.

The claimant supplies an authority explanation of at least ten characters.
The deterministic claim document is
`organizationClaims/{organizationId}_{uid}`. Repeating a pending or already
approved request is safe. Claim documents, review notes, restricted evidence,
and administration state are never directly readable or writable from the
browser.

## Request transaction

`exchange_organizationRequestClaim`:

- verifies authentication and canonical organization eligibility;
- creates or reopens the caller-bound claim as `pending`;
- changes organization claim state to `claim_pending`;
- updates an existing approved public projection through the canonical
  sanitizer;
- creates a caller notification; and
- writes an Exchange audit event.

The callable never grants membership. `exchange_organizationListMyClaims`
returns at most 50 claims owned by the caller, ordered by update time.

## Administrative review

Only current platform `admin` or `master` custom claims may call:

- `exchange_adminListOrganizationClaims`;
- `exchange_adminGetOrganizationClaim`; or
- `exchange_adminReviewOrganizationClaim`.

Platform claim-review authority does not make that administrator a member of
the organization.

Approval runs in one Firestore transaction and:

- changes the selected claim to `approved`;
- creates or updates an exact active owner membership for the claimant;
- initializes free commercial membership and zero-credit account only when
  absent;
- assigns authoritative owner/claimed state;
- stores the organization as the claimant's validated actor preference;
- rejects all other pending claims for the same organization;
- refreshes the public projection with the canonical allowlist;
- notifies the successful and competing claimants; and
- writes an immutable audit event.

Repeating the same terminal decision is idempotent. A different decision after
terminal review fails closed. Approval also refuses to replace an already
claimed owner with a competing claimant.

## Rejection and competing claims

Rejection changes only the selected claim to `rejected`. If another pending
claim exists, organization state remains `claim_pending`; otherwise it returns
to `unclaimed`. Approving one competing claim transactionally rejects the other
pending claims with a non-disclosing reason.

Rejected and competing claimants receive no membership. Any former membership
must still satisfy exact active status before appearing in the actor list or
authorizing another callable.

## Privacy properties

- Claim approval does not publish an address or coordinates that lack explicit
  field-level publication approval.
- Home-based or privacy-suppressed location is removed by the public sanitizer.
- Claim reason, requester email, reviewer identity/note, source identifiers,
  and competing claimant identities are not part of public search or detail.
- `claimed` does not mean `verified`; verification status is preserved
  independently.

## Current evidence and remaining gate

Source implements request, caller list, administrator list/detail, approve,
reject, competing-claim rejection, notifications, auditing, idempotent terminal
review, membership creation, and public projection updates. Source-shape and
workspace tests cover core boundaries; complete configured-development request,
approval, rejection, competing claims, token refresh, former-claimant denial,
and synthetic cleanup are still pending on `hi-coworking-plat`.
