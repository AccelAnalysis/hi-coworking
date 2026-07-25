# The RFxchange Business Onboarding Journey

## Product success condition

The onboarding journey is successful when an authenticated business representative sees the organization's persisted marker selected on the 3D Exchange map.

The marker is the first value moment. Profile enrichment, capability completion, verification workflows, and Founding Membership conversion occur after the marker is active.

## Canonical experience

`Create account → choose community → identify business → confirm location and privacy → see business on the 3D Exchange → explore, enrich profile, or become a Founding Member`

The browser should not expose extra workflow screens merely because several server records must be created or reconciled.

## Canonical route sequence

1. `/register`
   - First name
   - Last name
   - Email
   - Password
   - Business/organization attestation
   - Terms and privacy acknowledgement
   - Creates Firebase Authentication sign-in and automatically initializes the RFxchange account
   - Retries initialization after an auth-token refresh when necessary
   - Rolls back the newly created sign-in when initialization cannot complete, rather than intentionally keeping a partial registration

2. `/exchange/onboarding`
   - Opens directly at Community; there is no separate user-action Welcome gate
   - Community search accepts U.S. city, county, ZIP code, or locality text
   - Search may discover places beyond currently configured Exchange territories, but only a server-managed territory record can authorize participation
   - Released communities permit full onboarding
   - Scheduled communities may be selected but cannot activate a marker before release
   - Paused, archived, or not-yet-configured communities cannot grant full participation
   - Business search follows geography selection
   - User connects an already-authorized business, submits a governed claim, or creates a duplicate-safe new organization
   - User confirms the operational address through the server-side geocoder
   - User selects exact, approximate, locality-only, or private visibility
   - User selects **Place My Business on the Exchange**

3. `/exchange?...&onboardingSuccess=1`
   - 3D camera centers on the confirmed business coordinates
   - Organization and establishment context are selected
   - Success card states: `Your business is now on The RFxchange.`
   - User may immediately:
     - Explore the Exchange
     - Enrich & Complete Profile
     - Open Founding Membership

4. Optional post-marker routes
   - `/org/enrichment?organizationId={organizationId}`
   - `/org/settings?id={organizationId}&tab=profile&onboarding=complete`
   - `/exchange/founding?organizationId={organizationId}`

## Sign-in and resume behavior

A returning user signs in once and the server resolves the authoritative resume route.

- Completed v2 onboarding routes directly to the Exchange.
- Incomplete v2 onboarding routes directly to `/exchange/onboarding`.
- Legacy pre-v2 accounts remain eligible to enter the Exchange without being unexpectedly forced through the new guided activation journey.
- Legacy accounts missing account documents are repaired automatically with `account_initialize`, then re-evaluated.
- There is no `/register?resume=1` or **Complete account setup** detour.
- The application should not route an incomplete v2 user through the Exchange workspace simply to redirect them back to onboarding.

## Authoritative state

The single onboarding state is `users/{uid}.exchangeOnboarding`:

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

Canonical organization, membership, claim, establishment, geocode, payment, and public-projection records remain authoritative for their own domains. The state getter reconstructs missing onboarding milestones from those records rather than maintaining a competing browser workflow state.

`welcomeAcknowledgedAt` is retained as a compatibility milestone, but it is not a separate visible onboarding page. New v2 accounts receive the milestone during authoritative account initialization so the first user decision is Community.

## Performance contract

The onboarding interface should feel like three decisions, not a series of backend jobs.

### Initial load

Initial onboarding loads only:

- authoritative activation state;
- territory availability.

Organization memberships and claims are loaded only when the user reaches the Business step.

### Step progression

Completed steps update local UI immediately after the authoritative write succeeds. The browser does not reload the full activation, territory, organization, and claim model after every action.

### Marker completion

The browser performs:

1. one establishment upsert that consumes the owner-confirmed geocode candidate;
2. one `marker_activated` progress call.

The marker activation transaction derives the address-confirmed and geocoding-completed milestones from the persisted establishment, validates the full state, activates projections, and records onboarding completion. Separate serial client calls for `address_confirmed` and `geocoding_completed` are not required.

### Success card

Rendering the success card does not fire multiple progress writes. Enrichment and Founding offer events are recorded only when the relevant CTA is selected.

## Geography enforcement

- The search UI may use Mapbox place search to resolve user-entered city, county, ZIP, locality, or region text.
- Mapbox search is discovery only; it cannot grant territory access.
- A selectable community must map to a server-managed `territories/{fips}` record.
- Territory selection is written server-side from that record.
- Released territories permit full onboarding.
- Scheduled territories can be saved but cannot activate a marker.
- Paused and archived territories are unavailable for full participation.
- Marker activation rechecks territory status server-side.
- The confirmed address state and locality/county must correspond to the selected territory.
- Editing client state, query parameters, coordinates, or FIPS values cannot bypass these checks.

## Organization paths

### Existing authorized organization

The user may select an active organization only when an active organization-membership record already authorizes the account.

### Seed organization claim

A claim creates or reuses a governed `organizationClaims` record. Pending claims:

- preserve the existing public organization record;
- do not grant owner or administrator permissions;
- do not permit address or marker changes;
- remain routed to the review administration workflow;
- allow public Exchange preview while review is pending.

### New organization

Creation uses duplicate scoring, identity reservation, idempotency, owner membership, free Exchange membership, and workspace preference behavior. Enrichment is not required before organization creation or marker activation.

## Address and privacy model

The operational address and owner-confirmed geocode are stored in the private organization establishment.

| Visibility | Operational address | Public street | Public coordinate | Authorized actor marker |
| --- | --- | --- | --- | --- |
| Exact | Stored | Yes | Exact | Yes |
| Approximate | Stored | No | Deterministically shifted nearby | Yes |
| Locality | Stored | No | Locality-level rounded coordinate | Yes |
| Private | Stored | No | None | Yes |

The public projection is written or removed server-side during marker activation. UI hiding is not the security boundary.

## Marker activation transaction

The activation function verifies:

- authenticated account;
- active organization authority;
- active establishment ownership;
- released territory;
- confirmed physical address;
- confirmed nonzero owner-selected geocode;
- selected geography and address match;
- supported visibility value.

It then:

1. updates organization publication settings when public visibility is selected;
2. writes the sanitized public organization projection;
3. writes or deletes the public location projection;
4. stores preferred organization and establishment orientation;
5. records address/geocode milestones, marker activation, and onboarding completion;
6. writes an organization audit event;
7. returns the user to the Exchange at the confirmed coordinates with close zoom, bearing, and 3D pitch.

## Post-marker enrichment

The primary profile-completion CTA is **Enrich & Complete Profile** and opens `/org/enrichment?organizationId={organizationId}`.

The guided sequence is:

`search trusted sources → review a candidate → select individual identity fields → apply selected fields to the organization → manually complete anything enrichment could not supply`

The organization enrichment page:

- uses the existing protected `enrichment_search` callable and its SAM.gov/USAspending providers;
- seeds the search from the already-confirmed organization name, location, domain, and known identifiers;
- displays confidence and provider attribution as matching aids, not as verification;
- allows the representative to accept or reject each available identity field;
- saves accepted legal-name/UEI/CAGE/DUNS suggestions through the existing server-authoritative organization profile update callable;
- preserves all unchecked organization values;
- never grants verification, ownership, Founding status, or premium permissions.

After enrichment, the user continues to the organization profile for description, industries, capabilities, certifications, media, documents, and any identity fields a source could not supply.

UEI, CAGE, DUNS, capabilities, certifications, and richer organization identity are not prerequisites for the first marker value moment.

## Founding Membership boundary

The handoff carries:

- authenticated user identity;
- organization ID;
- selected geography;
- organization authority;
- onboarding completion;
- current membership tier and status;
- Founding Member status;
- founder reservation state when present.

Founding checkout requires organization billing authority and prior organization marker activation. The server checks marker completion from authoritative user activation records rather than trusting a client flag. Business verification is not a prerequisite to purchase Founding Membership itself; verification remains required for protected credit purchasing and other trust-sensitive workflows.

The wallet does not bypass this post-marker handoff; nonmembers are routed through the Founding Membership page where current eligibility and pricing are evaluated before Stripe opens.

Checkout uses `stripe_createExchangeMembershipCheckout`. The UI and server fail closed when policy, price, Stripe configuration, capacity, authority, or marker completion is unavailable. No premium permissions are activated until Stripe confirms the subscription through the webhook-backed membership state.

## Analytics

Structured events are written without password, address, token, or sensitive identifier payloads. Events include registration, geography selection, organization search/selection/creation/claim, geocoding outcomes, marker activation, enrichment offer/review, Founding offer, and checkout handoff.

Analytics must not add blocking network hops to the visible journey.

## Deployment acceptance gate

Source completion is not production completion. Before the journey is marked done:

1. merge through the canonical Exchange branch chain;
2. deploy Functions, Firestore rules/indexes when changed, and Hosting to the intended Firebase project;
3. record the deployed commit SHA;
4. hard refresh and verify the current bundle;
5. create a genuinely new account and complete the entire path through marker activation;
6. test an existing incomplete v2 account and confirm direct resume without redirect loops;
7. confirm a legacy pre-v2 account can still enter the Exchange;
8. test arbitrary geography search, released territory selection, scheduled territory handling, and an unmanaged location;
9. execute two-account public, approximate, locality-only, and private visibility tests;
10. test organization enrichment from trusted-source search through selected-field application and manual profile completion;
11. execute mobile and desktop acceptance tests;
12. inspect console and network logs for repeated HTTP 400 responses or unnecessary duplicate calls;
13. verify Founding checkout from a newly created owner organization when checkout policy is open;
14. confirm direct wallet access cannot bypass the marker prerequisite;
15. capture required screenshots from the deployed environment.
