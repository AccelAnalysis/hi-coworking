# Organization projections

The canonical private organization and the public directory organization are
different records with different trust boundaries.

## Sources of truth

- `orgs/{organizationId}` is the private authoritative organization record.
- `orgMembers/{organizationId}_{uid}` is the canonical authority record.
- `publicOrganizations/{organizationId}` is the privacy-minimized discovery
  projection.
- `organizationSourceCandidates/{candidateId}` is restricted matching evidence
  and is never a public projection.

Browser clients cannot directly read `orgs`. Public discovery reads only an
active and publication-approved public record. Authenticated private and
viewer-relative detail is produced by callables with final field allowlists.

## Canonical public projection

`sanitizePublicOrganization` is the publication boundary used by manual
creation, claim transitions, perspective resolution, and seed import. The
public allowlist contains only:

- stable ID, schema version, name, normalized name, and slug;
- publishable city, county, state, and territory FIPS;
- claim status and independent verification status;
- public organization type, industries, description, and website;
- NAICS codes, capabilities, certifications, and search tokens;
- approved resource-provider categories and approved issuer status;
- referral/contact availability;
- active/publication state and update time; and
- separately approved address or coordinate fields.

An organization is discoverable only when its source is active and
`publicationApproved` is exactly true. Any other status fails closed.

## Address and coordinate gates

Address and coordinate decisions are independent. An approved organization can
remain list-only.

Address publication requires:

- organization publication approval;
- no home-based or privacy-suppressed classification; and
- `addressPublicationApproved: true`.

Coordinate publication requires:

- organization publication approval;
- no home-based or privacy-suppressed classification;
- `coordinatePublicationApproved: true`; and
- finite latitude/longitude that survives range validation.

No marker code derives a centroid or invents a point for an organization. A
list-only organization remains discoverable without a marker.

## Role-bounded private projections

All three private projections use a bounded public/private base. They do not
return the raw `orgs` document.

| Role | Additional fields currently allowed |
| --- | --- |
| Member | `homeBased`, `privacySuppressed`, `internalCapabilityGaps`, and optional `readinessTier` |
| Administrator | Member fields plus address lines, postal code, and billing email |
| Owner | Administrator fields plus `ownerUid` |

These fields are organization-detail fields, not a blanket grant to all private
analytics collections. Mode endpoints must independently authorize their data.

## Viewer-relative external projections

An external subject receives one of `relationship_safe`, `public_claimed`,
`public_seed`, `resource_public`, or `unavailable`. Each uses the same approved
public organization allowlist. `relationship_safe` adds only the separately
returned relationship indicator; `resource_public` permits only approved public
resource categories.

The response contract is strict. Unexpected keys such as membership, owner,
private capability gaps, relationship paths, private contacts, or opportunity
state cause contract validation to fail rather than becoming UI-hidden data.

## Claim and verification semantics

`claimStatus` is `unclaimed`, `claim_pending`, or `claimed` and records authority
workflow state. `verificationStatus` is independent. Claim approval does not set
independent business verification, and public copy must not imply otherwise.

## Explicit exclusions

Public and external responses exclude:

- private or suppressed address/location;
- owner, billing, membership, permissions, and authority fields;
- personal email or private phone numbers;
- claim evidence, reviewer notes, and verification documents;
- raw source identifiers and restricted matching evidence;
- fraud, review, targeting, and seed-review metadata;
- private referrals, relationships, compensation, notes, and graphs;
- saved/viewed opportunities, alerts, drafts, responses, and private fit; and
- private intelligence, recommendations, comparisons, and financial estimates.

## Evidence and remaining gate

Projection tests cover explicit publication flags, home-business suppression,
claim/verification separation, role bounds, and rejection of private fields by
the shared contracts. Seed-import tests verify that its projection matches the
same decisions. Configured-development network-response inspection and external
subject browser acceptance remain pending.
