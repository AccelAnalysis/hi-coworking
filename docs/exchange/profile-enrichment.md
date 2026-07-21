# Profile enrichment

## Search

`enrichment_search` requires an authenticated account, applies a per-user rate limit, and strictly accepts a bounded business name plus optional city, state, UEI, CAGE, legacy DUNS, and domain. It calls providers only on the server, normalizes/deduplicates candidates, scores them, and returns explicit provider status: `ok`, `not_configured`, or `unavailable`.

The server stores a short-lived request owned by the caller with only the normalized candidates needed for linking. Provider failures do not block manual profile entry. Raw provider payloads and secrets are not returned or published.

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

## Configured provider result

On 2026-07-21 the deployed search returned ten normalized candidates for the configured acceptance query. USAspending returned `ok` and supplied the linked candidate. SAM.gov was invoked with the existing server secret but returned HTTP 400 and was accurately reported as `unavailable`. This is the remaining provider-specific operational requirement; it is not reported as 100%.
