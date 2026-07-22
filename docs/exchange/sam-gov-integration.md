# SAM.gov integration contract

## Boundary

SAM.gov is a server-side pull provider. Browser code calls authenticated Hi-Coworking Functions; only the Functions runtime calls SAM.gov. `SAM_GOV_API_KEY` must remain a Firebase secret and must never appear in a public environment variable, response payload, source URL, or log.

Public discovery integrations use synchronous GET requests. Hi-Coworking does not depend on a SAM.gov webhook or push feed. Large extract APIs may return a later download token/link, but they remain caller-initiated pulls.

## Endpoint and method matrix

| Exchange purpose | Provider endpoint | Method | Exchange pattern |
| --- | --- | --- | --- |
| Entity verification and profile enrichment | `/entity-information/v4/entities` | GET | On-demand server lookup with bounded cache |
| Federal opportunity ingestion | `/opportunities/v2/search` | GET | Scheduled server polling with date windows and pagination |
| Exclusion checks | `/entity-information/v4/exclusions` | GET | On-demand UEI/name check plus periodic refresh |
| Federal agency hierarchy | `/prod/federalorganizations/v1/orgs` | GET | Periodic reference-data synchronization |
| USAspending recipient matching | `/api/v2/recipient/duns/` | POST | On-demand filtered JSON search |
| USAspending award analytics | `/api/v2/search/spending_by_award/` | POST | Server-side filtered intelligence queries |

POST is not a replacement for the public SAM Entity or Opportunity GET APIs. SAM POST operations apply to separate sensitive/reporting workflows and must not be introduced into member-facing Exchange discovery.

## Entity search contract

The production request is:

- endpoint: `https://api.sam.gov/entity-information/v4/entities`;
- method: `GET`;
- headers: `Accept: application/json`;
- required query: `api_key`, `includeSections=entityRegistration,coreData`, `page=0`, `size=10`;
- identifier precedence: UEI, then CAGE, then legal name/location;
- location parameters: `physicalAddressCity` and `physicalAddressProvinceOrStateCode`.

The response parser reads:

- `entityData[].entityRegistration.legalBusinessName`;
- `entityData[].entityRegistration.ueiSAM`;
- `entityData[].entityRegistration.cageCode`;
- `entityData[].entityRegistration.registrationStatus`;
- `entityData[].entityRegistration.registrationExpirationDate`;
- `entityData[].coreData.physicalAddress.city`;
- `entityData[].coreData.physicalAddress.stateOrProvinceCode`;
- public business-type descriptions under `coreData.businessTypes`.

DUNS is retained only for legacy USAspending reconciliation. UEI is the primary federal identifier.

## Opportunity synchronization contract

A future SAM opportunity worker must poll `/opportunities/v2/search` from a scheduled backend job. It must supply `postedFrom` and `postedTo` in `MM/dd/yyyy`, page with `limit` and zero-based `offset`, upsert by `noticeId`, preserve source provenance, and keep its own change snapshots because the public endpoint returns only the latest active version.

The worker must use overlapping incremental windows, retry 429/5xx responses with bounded exponential backoff, stop retrying malformed 400 requests, and write a synchronization ledger containing the requested window, page progress, completion status, and last successful run. It must feed the canonical Opportunity Discovery projection rather than create a second opportunity UI or map.

## Operational gates

- Use a SAM.gov key with sufficient daily quota for the expected call volume.
- Prefer a non-federal system account for production when approved.
- If SAM.gov requires IP allowlisting, route Functions/Cloud Run egress through a reserved static outbound IP.
- Run configured-development acceptance after every endpoint/version/query-contract change.
- Treat `unavailable` as a provider degradation, not as permission to fabricate entity or opportunity data.
