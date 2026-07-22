# Multi-location map context

The PR #21 persistent-map instance remains mounted across Intelligence, Referrals, Opportunities, and Resources.

The organization stays Subject. An establishment marker selection sets that organization as Subject and `{ entityType: "establishment", entityId: locationId, organizationId }` as Secondary Subject. Workspace/session/URL normalization preserves the establishment through mode changes.

Directory cards remain one per organization. Approved establishment points may be many. Marker properties contain organization ID, location ID, public label/summary, and approved coordinate only—never address/contact/private geocode payload. Resources filters location markers through the parent organization's approved provider status, so a non-resource establishment does not become a resource.

Initial Actor orientation precedence is saved viewport, preferred establishment, authorized primary, headquarters, another authorized active location, released locality, then regional default. The private Actor-anchor callable returns only an authorized coordinate pair and source; that coordinate is not inserted into public GeoJSON.

Compatibility organization markers remain only for firms with no migrated public establishment projection. No coordinate is fabricated for list-only organizations.
