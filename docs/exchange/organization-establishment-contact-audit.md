# Organization establishment and contact audit

## Stack and starting state

- Repository: `AccelAnalysis/hi-coworking`
- Workstream branch: `codex/exchange-establishments-contact-routing`
- Exact starting SHA: `8e94efde96a85b7154b33a34cb8a7e26bfb9ea49`
- Base: PR #19 branch `codex/exchange-configured-acceptance-and-seed-activation`
- PR #21 was reviewed with zero review threads, made ready, and merged into PR #19 as `8e94efde96a85b7154b33a34cb8a7e26bfb9ea49`.
- PR #3 and `main` were not changed.

## Before

The UID profile held business identity, procurement identifiers, location labels, and enrichment values. Organizations held one flat address/coordinate pair and one billing email. The map emitted at most one organization point. Contact and introduction requests fell directly to active organization managers. Organization settings attempted browser writes that ordinary managers could not authorize under the deployed rules.

## Incorrect ownership and consumers found

- Person-owned profile: `businessName`, domain, organization city/state, NAICS, certifications, UEI, DUNS, CAGE, and organization website.
- Flat organization location: address, city, county, state, postal code, latitude, longitude, geohash, and publication flags.
- Direct contact assumptions: billing email and manager UID fallback.
- Public map: organization projection coordinates treated the firm and physical place as one entity.
- Seed pipeline: one review/export/import decision covered firm, location, and contact publication.
- Enrichment: selected business fields replaced UID-profile fields instead of becoming organization proposals.

## After

Versioned contracts now separate canonical person profile v2 fields (stored in
the backward-compatible profile schema v4), organization profile v3,
establishment v1, geocode v1, contact point v1, route v1, and seed package v2.
Private collections are callable-only. Public establishment/contact collections
are final server allowlists. The organization stays Subject; a selected
establishment is Secondary Subject. Compatibility flat fields remain
temporarily but are no longer the canonical write path.

## Safety invariants

- Exact-active organization owner/admin authority for every management mutation.
- Exactly one active primary establishment whenever active establishments exist.
- At most one active headquarters.
- Address publication and coordinate publication are independent.
- Mailing-only, virtual, and private-home records cannot publish an exact marker.
- Geocode confirmation does not imply publication.
- Enrichment and seed candidates remain proposals until explicit human/owner decisions.
- Route resolution never returns private destination values to an external initiator.
- Human-approved seed count and imported real seed count remain zero in this workstream.

## Remaining human gates

Native VoiceOver remains a release gate. Real seed approval/import is reserved for **Seed Review Administration and Bounded Organization Activation**.
