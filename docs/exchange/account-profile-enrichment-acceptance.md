# Account, profile, and enrichment acceptance

Date: 2026-07-21

Project: `hi-coworking-plat`

Region: `us-central1`

Branch: `codex/exchange-configured-acceptance-and-seed-activation`
Starting SHA: `39ae5f407705b88d3588d51f343b9e1afc96821c`

Percentages combine implementation, automated security coverage, deployed availability, and configured-browser evidence. “Rules unchanged” means the protected callable path required no relaxation or rules deployment.

| Capability | Before | After | Files changed | Callable | Rules | Tests | Configured evidence | Remaining external requirement | Status |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| Firebase Auth registration | 45% | 100% | `register/page.tsx` | `account_initialize` | unchanged | focused + browser | disposable registration passed | none | Complete |
| User-record provisioning | 35% | 100% | `accounts.ts` | `account_initialize` | unchanged | emulator + browser | user/profile shell observed | none | Complete |
| Account recovery | 10% | 95% | `authContext.tsx`, `register/page.tsx` | `account_initialize` | unchanged | idempotency/repair tests | sign-in repair exercised | prolonged outage UX monitoring | Operational |
| Default member claims | 60% | 100% | `accounts.ts` | `account_initialize` | unchanged | role/unknown-input tests | only `member`; no marketing claim | none | Complete |
| Profile creation | 35% | 100% | `profiles.ts`, `profileModel.ts` | `profile_update` | unchanged | emulator + browser | disposable version 1 | none | Complete |
| Profile update | 45% | 100% | profile client/server | `profile_update` | unchanged | emulator + matrix | seven configured projects passed | none | Complete |
| Profile clearing | 50% | 95% | profile schema/client | `profile_update` | unchanged | null/array emulator tests | deployed handler exercised | dedicated configured clear probe optional | Operational |
| Profile persistence | 25% | 100% | profile client/server | `profile_update` | unchanged | full browser | refresh and new login passed | none | Complete |
| Profile publication | 75% | 92% | `publicProfiles.ts`, `profiles.ts` | `profile_update` | unchanged | emulator publish/unpublish | callable deployed | configured public toggle inspection | Operational |
| Public-profile privacy | 80% | 98% | `publicProfiles.ts` | `profile_update`, `enrichment_link` | unchanged | allowlist/security tests | private disposable stayed unpublished | configured published fixture optional | Strong |
| Legacy profile normalization | 40% | 100% | `accounts.ts`, `profiles.ts` | both account/profile | unchanged | emulator + browser | synthetic master schema 3/version 1 | none | Complete |
| Profile concurrency | 0% | 98% | `profiles.ts`, profile UI | profile/enrichment link | unchanged | stale-version tests | versions 0→1→2 observed | multi-tab configured race optional | Strong |
| Profile diagnostics | 25% | 98% | diagnostics helpers/UI | all four | unchanged | classifier/static/browser | prior 404 and successful calls recorded | revision header automation | Strong |
| Asset references | 70% | 92% | `publicProfiles.ts`, `profiles.ts` | `profile_update` | unchanged | ownership/path tests | deployed contract exercised without upload | configured upload matrix | Operational |
| Enrichment search | 35% | 100% | `enrichment.ts`, profile UI | `enrichment_search` | unchanged | provider/emulator/browser | ten candidates returned | none for fallback path | Complete |
| SAM.gov provider | 40% | 70% | `enrichment.ts` | `enrichment_search` | unchanged | graceful-status tests | invoked; HTTP 400 → unavailable | repair/validate SAM credential/request | Blocked externally |
| USAspending provider | 45% | 100% | `enrichment.ts` | `enrichment_search` | unchanged | provider + browser | `ok`, selected result linked | none | Complete |
| Candidate review | 30% | 100% | profile UI | `enrichment_link` | unchanged | browser | fields previewed/selected | none | Complete |
| Candidate ownership | 70% | 100% | `enrichment.ts` | `enrichment_link` | unchanged | cross-user/expiry/replay | caller request linked | none | Complete |
| Attestation | 70% | 100% | profile UI/server | `enrichment_link` | unchanged | strict + browser | exact text/two acknowledgements | none | Complete |
| Enrichment linking | 30% | 100% | `enrichment.ts` | `enrichment_link` | unchanged | emulator + browser | configured 200 and persistence | none | Complete |
| Field-level merge | 0% | 100% | enrichment UI/server | `enrichment_link` | unchanged | selective merge tests | selected fields applied | none | Complete |
| Provenance | 45% | 100% | `enrichment.ts`, shared schema | `enrichment_link` | unchanged | provenance tests | ≥2 field records persisted | none | Complete |
| Readiness recalculation | 70% | 98% | `profileModel.ts` | profile/link | unchanged | unit/emulator/browser | recalculated with linked profile | live verified/trust fixture | Strong |
| Configured-development deployment | 0% | 100% | core entry/config/package script | four core | unchanged | dry-run/inventory/probes | all ACTIVE, Node 20, us-central1 | runtime upgrade by Oct 2026 | Complete now |
| Configured browser acceptance | 0% | 98% | Playwright spec/config | four core | unchanged | full disposable + matrix | end-to-end Chromium; saves all projects | full enrichment on every browser optional | Strong |
| Mobile acceptance | 55% | 96% | profile UI/config | profile/update | unchanged | three viewports | 390×844, 393×852, 430×932 passed | real-device Safari | Strong |
| Accessibility | 60% | 92% | profile UI | n/a | unchanged | semantic/browser checks | keyboard-native controls, alert focus | formal screen-reader/axe audit | Operational |
| Security | 82% | 98% | account/profile/enrichment | all four | unchanged | rules/functions/security | unauth 401; role/privacy guards | configured cross-user red-team probe | Strong |
| Rollback | 20% | 100% | rollback/deployment docs | four core | unchanged | guarded package validation | exact delete/traffic commands recorded | none | Complete |

## Decision

The core journey is operational in configured development and the prior profile-save blocker is removed. The workstream is reported at **97%**, not 100%: SAM.gov has not produced a successful configured response, and the repaired blocking-trigger source was deliberately not rolled onto the live creation hook without readable control-plane confirmation. USAspending provides the operational enrichment path and manual entry remains available.
