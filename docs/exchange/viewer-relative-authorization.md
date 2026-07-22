# Viewer-relative organization authorization

Organization data is projected for a particular authenticated viewer, validated
actor, subject, and Exchange mode. The server returns only fields and actions
allowed in that perspective.

## Resolution pipeline

1. Require an authenticated viewer and read the platform role from the token.
2. Resolve the requested actor against exact active canonical memberships.
3. Load the subject's approved public projection and, only when the viewer is
   self or a manager, the private organization record.
4. Validate any subject membership by exact document identity, active status,
   canonical role, and active organization state.
5. Resolve only the actor-subject relationship record and reduce it to a safe
   indicator. Do not return a relationship graph or path.
6. Select context type, projection level, allowed actions, mode-result
   eligibility, and mode-specific heading.
7. Apply the final public or role-bounded private allowlist before returning.

The implementation is in
`apps/functions/src/exchange/organizationWorkspace.ts` and
`apps/functions/src/exchange/organizationPerspective.ts`. The response is
validated by `ExchangeOrganizationPerspective` in
`packages/shared/src/exchangeOrganizationContext.ts`.

## Projection levels

| Projection | Who receives it | Boundary |
| --- | --- | --- |
| `private_owner` | Current owner acting for or managing the subject | Public base plus owner/admin private fields and owner identifier |
| `private_admin` | Current administrator acting for or managing the subject | Public base plus administrator private fields; no owner-only identifier |
| `private_member` | Current member acting for the subject | Public base plus bounded member analytics fields; no address, billing email, or owner identifier |
| `relationship_safe` | External subject with explicitly disclosable actor-subject relationship | Approved public organization plus a bounded relationship indicator |
| `public_claimed` | External claimed organization or approved issuer | Approved public organization only |
| `public_seed` | Approved unclaimed organization | Approved public seed projection only |
| `resource_public` | Approved resource provider | Approved public organization and approved public resource categories |
| `unavailable` | Missing, inactive, unapproved, or otherwise suppressed subject | No organization fields and no actions |

Claim status and verification status are deliberately independent. “Claimed”
means authority was approved; it does not imply independent business
verification.

## Mode boundaries

| Mode | Self or managed subject | External subject |
| --- | --- | --- |
| Intelligence | Role-bounded private organization fields and private analytics action | Approved public profile and relationship-safe context only; no private gaps, graphs, recommendations, comparisons, or performance |
| Referrals | Actor-scoped referral data and role-bounded actions | Public capabilities, safe contact/referral actions, and “trusted introduction may be available”; no path, private score, history, notes, compensation, or pipeline |
| Opportunities | Actor-scoped saved/viewed/search/personalization and response action | Public subject context while results remain personalized for the actor; heading is “Opportunities for [Actor] related to [Subject].” |
| Resources | Actor-personalized resource context | Only approved public provider information; a non-provider subject is `contextMarkerOnly` and is not converted into a resource result. Heading is “Resources for [Actor] near or relevant to [Subject].” |

The generic organization drawer renders only the returned allowlist. Mode data
hooks separately bind referrals, intelligence, Opportunity Discovery, saved
items, saved searches, recent searches, and viewed state to the validated actor
scope.

## Public allowlist

An approved public response may include identity, published locality,
description, website, NAICS codes, industries, capabilities, certifications,
claim and verification states, approved resource/issuer states, referral/contact
availability, and explicitly approved location fields.

Address fields require `addressPublicationApproved: true`. Coordinates require
all of:

- `publicationApproved: true`;
- `coordinatePublicationApproved: true`;
- finite in-range latitude and longitude; and
- no home-based or privacy-suppressed classification.

The public projection excludes owner and membership fields, billing data,
private contacts, claim evidence, review flags, restricted candidate evidence,
private analytics, referrals, opportunity state, and relationship paths.

## Relationship-safe disclosure

The resolver loads only the deterministic actor-subject relationship document.
It verifies both participant subject keys before considering it. The response is
reduced to `exists`, a bounded type, disclosure level, and
`trustedIntroductionMayBeAvailable`. A requested introduction records only that
a relationship may exist; it does not disclose who forms the path.

## Client cache and transition safety

Actor, subject, mode, token, and visibility changes invalidate the perspective.
The hook clears the previous perspective synchronously and ignores responses
from superseded requests. Referral, intelligence, and opportunity hooks use the
same actor-change blanking pattern. Public directory data may be reused across
modes, but private perspectives are not cached across actors.

## Rules boundary

Direct browser reads of `orgs`, claims, workspace preferences, saved
organizations, contact requests, introduction requests, restricted candidates,
and private Opportunity Discovery state are denied. `publicOrganizations` is
the only directly readable organization collection, and only active,
publication-approved documents qualify. The viewer-relative callables use the
Admin SDK but still enforce the same final response allowlists.

## Evidence and limitations

Focused shared-contract, pure projection, callable-emulator, Firestore-rules,
and cross-mode tests cover external-field rejection, role projection,
resource-context behavior, former-member denial, and actor-scoped operations.
Configured deployment, configured browser/network inspection, and live
cross-browser privacy verification are still required. Until those pass, this
model is source- and emulator-ready, not configured-accepted.
