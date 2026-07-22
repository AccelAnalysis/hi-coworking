# Profile enrichment

## Search

`enrichment_search` requires an authenticated account, applies a per-user rate limit, and strictly accepts a bounded business name plus optional city, state, UEI, CAGE, legacy DUNS, and domain. It calls providers only on the server, normalizes/deduplicates candidates, scores them, and returns explicit provider status: `ok`, `not_configured`, or `unavailable`.

The SAM.gov provider uses the public Entity Management v4 endpoint with a server-held `SAM_GOV_API_KEY`, `GET`, `includeSections=entityRegistration,coreData`, and bounded pagination. UEI takes precedence over CAGE, and CAGE takes precedence over name/location matching. Name/location searches use the documented `physicalAddressCity` and `physicalAddressProvinceOrStateCode` parameters. The parser reads `entityRegistration` and `coreData.physicalAddress`; it never treats the response as a flat record.

USAspending continues to use the documented filtered recipient-search `POST` body. Provider failures do not block manual profile entry. Degraded results are cached for only five minutes; healthy results are cached for 24 hours.

The server stores a short-lived request owned by the caller with only the normalized candidates needed for linking. Provider error diagnostics retain status, message, detail, error code, and transaction ID only after API-key redaction. Raw provider payloads and secrets are not returned or published.

## Review and link

The browser shows source, confidence, match reason, current value, proposed value, and a checkbox for each available canonical field. Nothing is silently applied. The caller must type the exact authority attestation, acknowledge authorization and consequences, and select at least one field.

`enrichment_link` re-reads the unexpired caller-owned request, rejects fabricated/cross-user/replayed candidates, verifies optimistic profile version, and requires explicit confirmation before replacing a different existing link. In one transaction it:

- applies only approved fields;
- records provider/request/match/timestamp provenance for each applied field;
- records link-level provenance and attestation;
- recalculates completeness/readiness;
- refreshes an existing public projection through its privacy allowlist;
- consumes the request;
- writes verification and Exchange audit events.

An enrichment match remains distinct from an organization claim and final verification.

## Configured provider acceptance

The 2026-07-21 configured run proved that the secret was mounted and the server called SAM.gov, but the former request returned HTTP 400 because it used an unsupported state parameter and parsed the nested response incorrectly. The repository correction moves Entity Management to v4, uses the documented GET query, parses the nested public response, redacts structured error details, and adds pure client regression tests.

A new authenticated configured-development search must still be run after deploying the corrected Functions revision. Do not mark SAM.gov operational until that run returns `providerStatus.samGov = "ok"` for a known entity and the returned UEI/CAGE/location values are confirmed against SAM.gov.
