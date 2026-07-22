# Actor, subject, and viewer context

The Exchange uses separate context concepts for identity, authority, and the
thing being examined. A selected marker is never evidence that the viewer may
act for that organization.

## Context vocabulary

| Concept | Meaning | Authority source | May survive a mode change? |
| --- | --- | --- | --- |
| Viewer | The authenticated person | Firebase Authentication and server-read platform claims | Yes |
| Requested actor | The organization ID requested by URL, session, or an explicit switch | Untrusted browser input | Yes, as a request only |
| Validated actor | The active organization the viewer is currently representing | Exact active `orgMembers/{organizationId}_{uid}` plus active `orgs/{organizationId}` | Yes |
| Subject | The organization currently selected for viewing | Selection state plus a server-resolved projection | Yes |
| Secondary subject | The current opportunity, referral, resource, territory, team, or related organization | Mode-owned selection state | When meaningful; preserved separately by mode |

The shared versioned contracts live in
`packages/shared/src/exchangeOrganizationContext.ts`. The browser's workspace
types live in
`apps/web/src/features/exchange/state/exchangeWorkspaceTypes.ts`.

## Authority resolution

`exchange_listActorOrganizations` derives the viewer's choices from canonical
membership records. A membership counts only when all of the following are
true:

- its document ID is exactly `{organizationId}_{uid}`;
- `orgId` and `uid` match the document ID and authenticated viewer;
- membership `status` is `active`;
- role is `owner`, `admin`, or `member`; and
- the referenced organization exists with `status: active`.

The callable bounds a viewer to 100 actor memberships. It selects, in order,
an authorized requested actor, an authorized server-stored preference, the
first authorized actor, or no actor. An unauthorized requested ID produces a
safe fallback and `fallbackApplied: true`; it never produces authority.

Persisting an actor selection requires a second exact-authority check inside a
transaction. The resulting `exchangeWorkspacePreferences/{uid}` record is a
preference only and is never readable or writable directly by the browser.

Role capabilities are server-derived. Owners and administrators receive the
full current actor capability set. Members receive the bounded Exchange,
profile, opportunity-response, and referral capability set. Explicit
membership permissions can narrow that set, but cannot add a capability that
the canonical role does not permit.

## Subject resolution

Selecting an organization sets `subjectOrganizationId`, opens the stable
organization drawer, and keeps `actorOrganizationId` unchanged. Selecting an
opportunity, referral, resource, territory, team, or relationship sets the
secondary context instead of replacing the organization subject.

`exchange_resolveOrganizationPerspective` combines the authenticated viewer,
validated actor, subject, active canonical mode, and optional secondary subject.
It returns one of these subject context types:

- `self`;
- `managed`;
- `external_claimed`;
- `external_unclaimed`;
- `resource_provider`;
- `issuer`; or
- `unavailable`.

The response is a final server allowlist. The client does not fetch a private
organization document and hide fields in React.

## Explicit switching behavior

The context bar presents an accessible “Working as” selector and a separate
viewing control. Only choosing a listed organization initiates an actor switch.
Before switching, the current actor-bound workspace session is written. The
new request is validated by the server, perspective data is synchronously
cleared, and an actor-specific session is restored only after validation.

If the new actor has no session, mode selections, panels, and drafts from the
old actor are cleared rather than copied. Private request caches are also
blanked on actor changes, and stale asynchronous responses are discarded.

Closing the drawer keeps the subject selected. Clearing the subject clears only
the subject and organization drawer; it does not change the actor.

## Security invariants

- URL, session storage, local storage, profile fields, legacy role strings, and
  marker properties cannot grant organization authority.
- Platform `admin` or `master` status permits claim administration but does not
  create an organization membership.
- A former or malformed membership is not an actor.
- Subject selection never changes actor selection.
- A perspective is blanked before actor, subject, or mode re-resolution, so
  private fields cannot remain visible across contexts.
- Opportunity, referral, and intelligence requests carry the validated actor
  explicitly and are revalidated by their server endpoints.
- Draft submission is frozen if the actor changes while the workflow is open.

## Current evidence and remaining gate

Shared-contract, projection, workspace-callable, reducer, URL, session, and
mobile-link tests exercise the distinction. The implementation remains on a
draft stacked branch. Configured-development deployment and browser proof
against `hi-coworking-plat`, including live authority revocation, remain pending.
