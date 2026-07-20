# Opportunity Discovery Security

## Public discovery boundary

The browser consumes an allowlisted `opportunityDiscovery` projection. Transactional RFx documents remain the source of authority. The projection intentionally excludes:

- Bid and response contents
- Competing responder identity
- Evaluation scores and reviewer notes
- Protected contacts
- Private organization data
- Payment, referral-fee, or billing data
- Administrative verification inputs
- Server ranking authority inputs that a browser could forge

## Callable-only collections

The following records are written/read through authenticated callable Functions and Firebase Admin SDK rather than direct browser collection access:

- `opportunitySavedItems`
- `opportunityRecentViews`
- `opportunitySavedSearches`
- `opportunityRecentSearches`
- `rfxAddenda`
- `rfxAddendumAcknowledgments`
- `rfxQuestions`
- `opportunityNotificationJobs`
- `opportunityDiscovery` relationship overlays

Existing default-deny Firestore behavior must remain in place for collections without an explicit direct-client rule. No rule should be relaxed merely to make the discovery UI work.

## Authorization

- Saved items and searches are owner scoped.
- Active organization membership is verified from canonical membership records.
- Issuer management requires staff/admin, source owner, or active organization management authority.
- Response state is derived from response records for the authenticated user or active organizations.
- Browser-provided saved/viewed/responded/managed/eligible flags are ignored.
- Member/restricted visibility is rechecked server-side.
- Addendum publication and Q&A responses require issuer-management authority.
- Addendum acknowledgments require the authenticated actor and, when supplied, organization membership.

## Change governance

Addenda are append-only version records. Material changes and deadline changes are explicit. A new addendum does not mutate a previous addendum. Required acknowledgments are separate records. Q&A begins private, and only an authorized issuer response may publish a public answer. Public responses exclude asker identity.

Every governed write uses a bounded schema, idempotency key, audit event, and server timestamp/value. Notification jobs are created with external delivery disabled.

## Required emulator security tests

1. Anonymous users cannot read non-public discovery records.
2. Browser clients cannot write projection or authoritative relationship fields.
3. A user cannot read or modify another user’s saved items/searches/recent views.
4. A member cannot manage an issuer RFx without management authority.
5. A responder cannot read competing protected submissions.
6. An issuer cannot expose protected responder data through the projection.
7. Addendum creation fails without issuer authority.
8. Previous addendum versions cannot be overwritten by client code.
9. Q&A writes fail without authentication or correct issuer authority.
10. Private Q&A does not expose asker identity or content to unrelated users.
11. Replayed idempotency keys return the original safe result; changed payloads are rejected.
12. Query limits and membership caps return safe errors.

## Secrets

Mapbox/Firebase/search credentials must not be committed. Public Mapbox tokens must be origin restricted and limited to required scopes. Hosted-search secrets, if introduced later, must remain server-side and must never use a `NEXT_PUBLIC_*` variable.

## Security acceptance status

The repository Firebase emulator gate passes with 90 combined rules,
Functions, and migration tests, including the discovery gateway and direct
collection denial coverage. Production authorization has not been exercised or
changed, and no production deploy was performed from this branch. Live-project
acceptance remains a later operational gate and must not be inferred from the
emulator result.
