# Exchange map geography and camera contract

The Exchange opportunity workspace uses Mapbox Streets v12 as its required map runtime. It does not silently substitute another provider when the token, style, origin, or WebGL preflight fails.

## Territory geography

Territory status and geometry are controlled from the Admin Territory Manager.

- `released` territory boundaries remain visible with a restrained green treatment.
- `scheduled` boundaries are gray context with an amber centroid and release label.
- `paused` and `archived` boundaries are a stronger gray mask. They are not discoverable results and are not interactive map entities.
- A boundary is rendered only when the territory contains an authoritative GeoJSON `Polygon` or `MultiPolygon` geometry with finite, closed rings.
- The admin callable rejects malformed geometry and bounds the coordinate count and serialized size. The live application never generates a locality outline or guesses a missing centroid.

The legacy `territory_list_released` callable returns three privacy-minimized map projections: `released`, `scheduled`, and `unreleased`. Notes, history, administrator identity, and other operations fields do not cross this boundary.

## Initial camera precedence

The opportunity map resolves its first camera in this order:

1. A complete camera in the current Exchange URL (`lng`, `lat`, `z`, with optional `b` and `p`).
2. The signed-in user's last valid map camera from local browser storage.
3. A valid coordinate on the user's configured primary organization, or the first accessible organization with owner and manager memberships preferred. This opens at zoom `14.5`, pitch `58`, and bearing `-14`.
4. The centroid of the first released territory returned by the server.
5. The public Exchange default.

The per-user saved camera expires after 180 days. Invalid, future-dated, malformed, or out-of-range state is discarded. Demo mode does not read organization records or persist a user camera.

Map movement continues to update the existing URL-backed viewport contract. Browser back/forward can therefore restore an explicit camera without recreating the Mapbox instance. The 2D/3D control follows restored pitch and does not overwrite a restored bearing or pitch during initialization.

## Operational boundary import

Admins must obtain locality geometry from an authoritative source and paste the geometry object into the territory editor. Feature wrappers must be reduced to their `geometry` object before import. A missing geometry is shown as such in the manager and remains unrendered in the live map; it is never replaced with an approximate rectangle or a geocoded point.
