# Business registration and map activation audit

Audit date: 2026-07-22. Starting branch: `codex/exchange-establishments-contact-routing`. Starting SHA: `a368d4d0b33df0d1382c0d107623f04d33ae0e04`.

PR #19 was an open, mergeable draft at `8e94efde96a85b7154b33a34cb8a7e26bfb9ea49`; PR #22 was an open, mergeable draft at the starting SHA. Both had four successful checks and no unresolved review threads.

## Reproduced failures

- Registration stated that organization connection was optional and redirected to `/profile?onboarding=1`.
- The legacy profile mixed person data, organization suggestions, procurement data, and navigation to organization setup.
- Direct `/exchange` access worked without an active organization.
- Onboarding offered Exchange browsing and a “Skip for now” action.
- The 2D/3D control occupied `(1171,125)–(1268,171)` at 1280×720 but was trapped inside the map’s isolated `z-0` stacking context. `elementFromPoint` hit sibling workspace controls instead of either dimension button.
- The actor map anchor was camera-only. No private actor establishment feature entered map GeoJSON.
- The anchor precedence was preferred, primary, headquarters rather than preferred, headquarters, primary.
- Establishment selection did not populate the selected-organization source, so it received no enlarged marker treatment.
- Opportunity projections carried `issuerOrganizationId`, but discovery did not expose an exact issuer filter.

The disposable reproduction identity and its account/profile shells were removed Auth-first after exact guard checks. No memberships, claims, seed imports, or opportunities were created.

## Configured baseline

Firebase project `hi-coworking-plat` reported 87/87 active Functions and 93/93 ready composite indexes. The live organization corpus contained one existing configured organization and no `organizationSeedImports`, source candidates, or claims. Human-approved seed count and imported real-seed count were both zero.

Hosting release `1784740769213000` finalized at 2026-07-22T17:19:29Z. Firebase Hosting does not store a Git SHA. All 13 live Exchange chunk ETags matched the current PR #22 build cache, and all 101 current `_next/static` assets matched the deployed cache; this proves static-asset source equivalence to the starting head but is not represented as an unavailable Firebase commit label.

## Implemented repair

Registration v2 requires representative attestation and person essentials, then routes to mandatory organization onboarding. `exchange_getBusinessActivationState` derives progress from authoritative records. Private actor locations are returned only after exact-active membership validation and contain no address/contact/provider payload. A workspace-level control layer now owns the sole 2D/3D control. Activation uses zoom 16.5, pitch 55, bearing -20, drawer-aware padding, an unclustered selected marker, and a 16px selected radius.

Configured deployment and post-deployment browser evidence are recorded in `organization-configured-acceptance.md`; until that section is completed, the code is implemented and locally verified but not represented as live.
