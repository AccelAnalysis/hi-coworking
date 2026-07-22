# Organization location geocoding

## Provider-neutral flow

The server accepts a structured address, applies exact-active manager authority and a per-UID rate limit, checks a normalized 24-hour cache, and returns at most five normalized candidates. The user selects a candidate from a short-lived server session. Saving consumes that session and records provider, provider place ID when present, normalized address, coordinate, precision, confidence, source, and confirmation identity/time.

Raw provider payloads and credentials are neither persisted nor logged. Errors contain provider type only, never the submitted address.

## Providers

The no-secret development default is the U.S. Census Bureau Geocoding Services API for U.S. addresses. Optional Mapbox Geocoding v6 is behind the same interface. Because confirmed coordinates are persisted, the Mapbox adapter always requests permanent mode and requires a server-side token/configuration; temporary results must not be cached or stored.

## Privacy and correctness

- Zero/zero, missing, non-finite, or out-of-range coordinates are rejected.
- Confirmation does not approve address or coordinate publication.
- Private-home geocoding may orient its authorized owner but is excluded from public projections and GeoJSON.
- Mailing-only and virtual records never publish markers.
- City/county/service area can be public without street address or exact coordinate publication.
- Accessible candidate radios and a coordinate preview provide a keyboard-operable map-confirmation alternative.
