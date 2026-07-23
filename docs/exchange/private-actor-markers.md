# Private actor markers

`exchange_getActorMapAnchor` first validates exact-active membership, then returns a privacy-minimized list containing only organization/location IDs, safe names, location type, primary/headquarters/preferred flags, coordinate, visibility classification, and marker state.

It never returns street address, email, telephone, billing fields, provider payload, private notes, claim evidence, or verification evidence. Coordinates enter only the actor-context source. The public GeoJSON gate remains unchanged for external records.

Membership removal causes the callable to deny on the next request; the client then clears actor locations. URL actor values and cached workspace state cannot restore the projection.
