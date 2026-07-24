# The RFxchange Business Onboarding Journey

## Product success condition

The onboarding journey is successful when the authenticated business representative sees the organization's persisted marker on the Exchange map and the organization summary is selected.

The marker activation moment occurs before profile enrichment, full capability completion, or Founding Membership checkout.

## Canonical route sequence

1. `/register`
   - First name
   - Last name
   - Email
   - Password
   - Business-registration attestation
   - Terms and privacy acknowledgement
   - `/register?resume=1` safely recovers an authenticated account whose initialization was interrupted
2. `/exchange/onboarding`
   - Welcome and orientation
   - Geography selection
   - Organization search
   - Connect, governed claim, or duplicate-safe creation
   - Operational address confirmation
   - Server-side geocoding and candidate selection
   - Address visibility selection
   - Persisted marker activation
3. `/exchange?...&onboardingSuccess=1`
   - 3D camera centered on the confirmed business coordinates
   - Selected establishment and organization context
   - “Your business is now on The RFxchange.” success card
4. Optional post-marker routes
   - `/org/settings?id={organizationId}&tab=profile&onboarding=complete`
   - `/org/settings?id={organizationId}&tab=enrichment`
   - `/exchange/founding?organizationId={organizationId}`

## Authoritative state

The single authoritative onboarding state is `users/{uid}.exchangeOnboarding`.

```ts
{
  version: 2,
  welcomeAcknowledgedAt,
  geography: {
    fips,
    name,
    state,
    status,
    type,
    centroid,
    selectedAt
  },
  organizationSearchCompletedAt,
  organizationId,
  organizationPath, // connected | claim | created
  claimId,
  claimStartedAt,
  addressConfirmedAt,
  locationId,
  geocodingCompletedAt,
  markerActivatedAt,
  markerVisibility, // exact | approximate | locality | private
  profileCompletionOfferedAt,
  enrichmentOfferedAt,
  foundingMembershipOfferedAt,
  checkoutHandoffInitiatedAt,
  completedAt,
  updatedAt
}
```

Canonical organization, membership, claim, establishment, geocode, and public-projection records remain authoritative for their domains. The state getter reconciles missing onboarding milestones from those records without maintaining a competing workflow state collection.

## Geography enforcement

- Territory selection is resolved from the server-managed `territories` collection.
- Released territories permit full onboarding.
- Scheduled territories may be selected for preview but cannot activate a marker.
- Paused and archived territories are unavailable for full participation.
- Marker activation rechecks the stored territory status server-side.
- The confirmed address state and locality/county must correspond to the selected territory.
- Client-supplied FIPS values do not independently grant territory access.

## Organization paths

### Existing authorized organization

The user may select an active organization only when an active organization-membership record already authorizes the account.

### Seed organization claim

A claim creates or reuses a governed `organizationClaims` record. Pending claims:

- preserve the existing public organization record;
- do not grant owner or administrator permissions;
- do not permit address or marker changes;
- remain routed to the existing review administration workflow;
- allow public Exchange preview while review is pending.

### New organization

Creation uses the existing duplicate scoring, identity reservation, idempotency, owner-membership, free-membership, and workspace-preference behavior. Enrichment is not required to create the organization.

## Address and privacy model

The operational address and owner-confirmed geocode are stored in the private organization establishment.

| Visibility | Operational address | Public street | Public coordinate | Authorized actor marker |
| --- | --- | --- | --- | --- |
| Exact | Stored | Yes | Exact | Yes |
| Approximate | Stored | No | Deterministically shifted nearby | Yes |
| Locality | Stored | No | Locality-level rounded coordinate | Yes |
| Private | Stored | No | None | Yes |

The public projection is written or removed server-side during marker activation. UI hiding is not the security boundary. A private/home establishment is not marked as the preferred orientation during initial establishment validation; secure marker activation then assigns the authorized user's preferred organization and establishment without publishing the location.

## Marker activation transaction

The activation function verifies:

- authenticated account;
- active organization authority;
- active establishment ownership;
- released territory;
- confirmed physical address;
- confirmed nonzero geocode;
- selected geography and address match;
- supported visibility value.

It then:

1. updates organization publication settings when public visibility is selected;
2. writes the sanitized public organization projection;
3. writes or deletes the public location projection;
4. stores the preferred organization and establishment orientation;
5. records marker activation and onboarding completion;
6. writes an organization audit event;
7. returns the user to the map using the confirmed coordinates, close zoom, bearing, and pitch.

## Founding Membership boundary

The handoff carries:

- authenticated user identity;
- organization ID;
- selected geography;
- organization authority and eligibility;
- onboarding completion;
- current membership tier and status;
- Founding Member status;
- founder reservation status when present.

Checkout uses the existing `stripe_createExchangeMembershipCheckout` callable and organization membership record. The UI fails closed when policy, price, Stripe configuration, authority, or completed onboarding is unavailable. It never creates a simulated membership state.

## Analytics

Structured events are written without password, address, token, or sensitive identifier payloads:

- registration_started
- registration_completed
- geography_selected
- organization_search_performed
- organization_found
- organization_created
- organization_claim_started
- address_submitted
- geocoding_succeeded
- geocoding_failed
- marker_activated
- onboarding_completed
- profile_completion_started
- enrichment_started
- founding_membership_viewed
- checkout_handoff_initiated

## Deployment acceptance gate

Source completion is not production completion. Before the task can be marked done:

1. merge through the canonical Exchange branch chain;
2. deploy Functions, Firestore rules/indexes when changed, and Hosting to the intended Firebase project;
3. record the deployed commit SHA;
4. hard refresh and verify the current bundle;
5. execute the two-account public and private visibility tests;
6. execute mobile and desktop acceptance tests;
7. inspect console and network logs for repeated HTTP 400 responses;
8. capture the required screenshots from the deployed environment.
