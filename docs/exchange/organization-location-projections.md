# Organization location projections

## Private source

`organizationLocations` is server-authoritative and directly unreadable. Authorized management uses a callable that returns a final role-bounded private projection. External Subject or URL context cannot authorize it.

## Public allowlist

`publicOrganizationLocations` contains only location ID, organization ID, public label/type, primary/headquarters flags, approved service-area summary, independent address/coordinate approval flags, approved street/postal fields, approved coordinate/geohash/precision, public-contact-available indicator, version, and update time.

Rules reject public documents with an unapproved street field, one-sided coordinates, or fields outside the allowlist. Server projection also suppresses private-home, inactive, mailing-only-marker, and virtual-marker cases.

Organization public projections contain a count and optional primary public summary, not embedded private location records. Compatibility flat coordinates remain readable only until guarded migration acceptance; new map records use the public establishment projection.
