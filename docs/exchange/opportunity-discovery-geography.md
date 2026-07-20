# Opportunity Discovery Geography

## Provider

The web application uses `OpportunityLocationSearchProvider`. The production adapter is `MapboxLocationSearchProvider`; tests can inject `TestLocationSearchProvider`.

Default endpoint:

`https://api.mapbox.com/search/geocode/v6/forward`

The token is supplied through `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`. It is never written to logs or persisted in search records. Forward search requests use autocomplete, a bounded result count, United States context, and temporary/non-permanent geocoding.

## User inputs

The location combobox accepts city, county, state, ZIP code, street address, and named place. The shared query contract also supports organization-derived locations and explicit map bounds. Radius choices are 10, 25, 50, 100, and 250 miles; the contract permits safe custom values from 1 to 500 miles.

## Request behavior

- Suggestions begin after two characters.
- Requests are debounced.
- Previous requests are aborted when the query changes.
- Keyboard navigation uses an accessible combobox/listbox pattern.
- Empty, no-result, unavailable-provider, rate-limit, and generic-error states are concise.
- The selected place, coordinates, radius, bounds, and remote-inclusion state are URL backed.

## Distance

Distance is calculated with the Haversine formula in miles. Distance is displayed only when both the selected origin and opportunity projection have valid coordinates. Nearest ordering uses deterministic tie-breakers.

## Confidence model

Every projected coordinate is classified as one of:

- `exact`
- `approximate`
- `place_of_performance`
- `issuer_address`
- `eligible_territory`
- `territory_centroid`
- `withheld`
- `remote`
- `not_geocoded`

Legacy coordinates without an authoritative confidence field are promoted only to `approximate`, never `exact`.

A territory centroid must not be presented as the exact opportunity location. Records without valid coordinates stay in the result list and are omitted from point layers. Remote/flexible records may match a place/radius query only when the user explicitly includes remote opportunities.

## Map-area search

After meaningful map movement, the Exchange shows a contextual “Search this map area” action. The action stores west, south, east, and north bounds in the same location query state. It is not permanently displayed, and it can be cleared independently.

Viewport updates remain debounced and stale discovery responses are ignored. The Mapbox instance is preserved during ordinary filter and result updates.

## Fit behavior

- Fit results uses only valid plotted coordinates and visible territory geometry.
- Selecting an opportunity preserves synchronized card/detail context.
- The map never fabricates a marker simply to make a record visible.

## Privacy

The application does not automatically collect continuous user device location. “Near my organization” should derive from a governed organization location when that workflow is enabled. Unnecessary location-search text is not stored; saved/recent search records contain only normalized selected search state.