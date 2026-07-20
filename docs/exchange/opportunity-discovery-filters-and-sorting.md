# Opportunity Discovery Filters and Sorting

## Progressive-disclosure model

The default command bar is limited to keyword search, location, Filters, sort where space permits, and concise result status. Advanced controls remain in the filter surface. Mobile has one Filters entry point beside search; no duplicate map-level filter icon is permitted.

Active filters are summarized as a bounded row of four removable chips plus a `+N more` indicator. Clear all is available without allowing chips to cover the map.

## Filter groups

### Opportunity type

- Goods
- Services
- Construction
- Professional services
- Mixed requirement
- RFx type
- Prime or subcontracting
- Single or multiple award
- Teaming suitable

### Industry and capabilities

- Versioned NAICS labels and codes
- Parent/child code prefix matching
- Multi-select
- Independent capability keywords
- Organization NAICS/capability personalization

### Location

- Named place
- Radius
- Current map bounds
- Territory FIPS
- Remote inclusion
- Work arrangement

### Dates and budget

- Closing soon
- Posted/deadline ranges in the server contract
- Budget minimum/maximum
- Currency in the server contract

### Buyer and eligibility

- Government, nonprofit, private, and institutional issuer
- Public, member-only, and restricted visibility
- Required certifications
- Set-aside/supplier-diversity designations
- Server-derived eligibility and issuer-management relationship

### Personalization

- Matches organization
- Matches NAICS
- Matches capabilities
- Matches service territory
- Saved
- Viewed
- Responded
- Managed
- New since last visit
- Updated since viewed
- Exclude opportunities issued by the user’s organization

Personalized filters are evaluated from authenticated profile, organization membership, saved-item, recent-view, and response records. Browser flags are not authoritative.

## Sorting

The shared sort model supports:

- Recommended
- Relevance
- Nearest
- Newest posted
- Recently updated
- Deadline soonest
- Deadline latest
- Local first
- Best capability match
- Budget high to low
- Budget low to high

Response-count/least-competition ordering is not exposed unless disclosure policy explicitly permits it.

Recommended combines deterministic relevance, freshness, profile/organization fit, service-territory fit, and new/updated state. Best capability match compares indexed opportunity capabilities with authenticated organization/profile capabilities and selected capability filters.

Every sort is URL backed and uses stable record IDs as final tie-breakers. Browser refresh and back/forward restore the same state.

## Counts

Counts are exact only when the server query can establish the complete result set. Compound relevance, personalization, and bounded migration queries return qualified counts or no total rather than a misleading number.

## Authorization boundary

Filters narrow discoverable records; they do not grant access. Visibility, eligibility, issuer management, response state, and protected procurement records remain enforced server-side.