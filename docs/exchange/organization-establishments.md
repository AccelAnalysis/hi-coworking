# Organization establishments

An organization is the legal or operating firm. An establishment is a governed physical, virtual, service, or mailing location belonging to that firm.

## Canonical contract

`organizationLocations/{locationId}` contains organization ID, label, location type, status, physical and optional mailing address, service area, operating hours, geocode provenance, privacy state, publication decisions, record version, creator, and timestamps.

Location types are headquarters, branch, office, retail, production, warehouse, service location, coworking, virtual, mailing only, and other.

## Primary and headquarters

When active locations exist, exactly one is primary. Primary controls the preferred firm location for summaries and map orientation. Headquarters is an explicit, separate designation; it may equal primary but is not inferred from it. At most one active location is headquarters. Mailing-only cannot be primary or headquarters.

The transaction reads the full organization location set before any private or
public write. When an authorized owner explicitly marks an active location as
primary or headquarters, the transaction atomically clears that designation
from the previous location, updates both affected projections, and then
validates exactly one active primary and at most one active headquarters. This
makes designation transfer a single intentional save rather than requiring a
temporarily invalid intermediate state.

## Multi-location behavior

One organization directory card may summarize `publicLocationCount` and `primaryPublicLocation`. Each approved physical establishment can emit a map marker carrying both `organizationId` and `locationId`. Virtual, mailing-only, private-home, list-only, or coordinate-unapproved locations emit no exact marker.
