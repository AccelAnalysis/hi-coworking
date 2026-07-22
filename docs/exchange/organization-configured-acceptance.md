# Organization activation and continuity configured acceptance

This document distinguishes local source/emulator evidence from configured
development evidence. The only authorized configured target is Firebase project
`hi-coworking-plat` in `us-central1`. No production action is authorized.

## Evidence snapshot

As of 2026-07-22, the audited configured project had no canonical organization,
membership, claim, seed, or territory records. None of the canonical
organization lifecycle/context callables was deployed, source rules and indexes
differed from live releases, and Hosting was an older March 2026 revision.

Current branch evidence is therefore:

| Area | Local/source evidence | Configured evidence | Status |
| --- | --- | --- | --- |
| Context contracts and projections | Shared, pure projection, and focused callable tests; builds pass | None for new endpoints | Source/emulator ready; configured pending |
| Cross-mode state and one map host | Exchange suite passed 118 tests | No deployed Hosting/browser run | Source ready; configured pending |
| Organization lifecycle | Search/create/claim/review source and focused callable coverage | Endpoints absent at audit | Deployment and synthetic acceptance pending |
| Directory and markers | Bounded callable/client, privacy transform, cluster and scale fixtures | Zero configured organizations | Real data/render acceptance pending |
| Seed lifecycle | 5,128 candidates, 3,545 restricted candidates, review/export/import/rollback tests | Zero human approvals and zero imports | Blocked at human-review gate |
| Locality | Runtime Polygon/MultiPolygon validation exists | Zero configured territories | Authoritative preparation/deploy/render pending |
| Security | Exact-active source invariant, final projection allowlists, rules/callable tests | New rules/callables not live | Configured denial/network proof pending |
| Accessibility | Semantic labels, focus styles, touch targets, reduced-motion branches | No configured axe/AT/cross-browser run | Manual and automated acceptance pending |

Local results must not be rewritten as configured acceptance. The final run must
record exact command output, deployment revisions, Function inventory, ruleset
and index state, Hosting version, browser artifacts, synthetic IDs, and cleanup.

## Required preflight

Before any deployment or mutation:

- confirm branch and commit under test;
- confirm `firebase use` and every explicit `--project` value are exactly
  `hi-coworking-plat`;
- confirm emulator variables are off for configured testing;
- inventory current Functions and review any deletion prompt;
- diff source and live Firestore rules, indexes, Storage rules, and Hosting;
- confirm no production alias/project is being targeted;
- confirm Stripe, Microsoft email, SendGrid, and social integrations are not
  required or invoked; and
- record rollback sources and commands.

Run the full validation commands from the workstream before deployment. A
focused test pass does not replace `npm ci`, audit, builds, lint, security/run3/
run4 suites, browser suites, secret scan, generated-export check, and
`git diff --check`.

## Configured lifecycle scenarios

Use uniquely marked synthetic users and organizations. Never use a seed or real
organization for destructive claim testing.

1. Create an organization as an ordinary authenticated user. Verify duplicate
   search, idempotent retry, private/public records, exact owner membership,
   free commercial state, audit, actor preference, and zero adjacent grants.
2. Discover a dedicated unclaimed synthetic organization and submit a claim
   with a non-sensitive reason. Verify pending state, caller-only claim list,
   public `claim_pending`, audit, and notification.
3. Reject one claim and verify no membership, retained history, notification,
   and correct organization state when no competitor remains.
4. Submit two claims for a second disposable organization. Approve one and
   verify exact owner authority, automatic competing rejection, idempotent
   repeated approval, former claimant denial, and independent verification
   status.
5. Remove or mark the approved membership former, refresh token/context, and
   verify actor removal and immediate denial of private calls.
6. Inspect public and private callable responses for forbidden fields and
   compare them with direct Firestore denials.

## Cross-mode browser scenarios

Run on deployed canonical Hosting with the configured backend:

- owner self subject through all four modes;
- actor A viewing external claimed organization B through all modes;
- external non-resource subject in Resources;
- approved unclaimed seed subject, only after human-approved import;
- authority loss while subject remains selected;
- referral draft continuity and actor-change freeze;
- map camera, search, locality, radius/bounds, drawer, per-mode filters, list
  position, Back, Forward, and refresh restoration;
- company-based Opportunity Discovery remaining personalized for actor A while
  subject B is selected; and
- unauthorized actor deep link degrading to a safe validated fallback.

For each external-subject scenario, capture callable responses or network
artifacts that demonstrate forbidden private fields were never returned.

## Browser and accessibility matrix

Minimum configured coverage is current Chromium, Firefox, WebKit/mobile Safari
where available, narrow mobile and desktop sizes, keyboard-only operation,
reduced motion, screen-reader labels, focus order, no horizontal overflow, and
an automated accessibility scan. Native Safari/VoiceOver should remain a
manual release gate when CI emulation cannot substitute for it.

## Seed and locality stop conditions

There are currently zero human-approved seed records. Do not import a sample,
claim replay/rollback evidence, or run seed-marker acceptance until an approved-
only export exists. The importer must remain capped at 100 for the first sample
and create a rollback artifact before writes.

Authoritative locality geometry must identify its source, vintage, FIPS, and
centroid; pass Polygon/MultiPolygon validation; and have rollback evidence.
Until it is prepared and deployed, locality rendering acceptance is pending.

## Cleanup and result standard

Inventory synthetic Auth users and every purpose-marked document before the
run. Cleanup must be exact and recoverable: remove only enumerated synthetic
records, then prove zero matching artifacts remain. Do not delete legacy or
unexpected Functions.

The configured workstream is not accepted until all required scenarios pass on
`hi-coworking-plat`. At this snapshot, configured deployment, configured
browser acceptance, locality evidence, seed import/replay/rollback, and
cross-browser accessibility remain open gates.
