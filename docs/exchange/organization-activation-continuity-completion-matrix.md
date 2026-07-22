# Organization activation and continuity completion matrix

## Establishment/contact-routing continuation

| Capability | Result |
|---|---|
| Person versus organization ownership | Profile v4 person fields; legacy business fields are proposals only |
| Organization versus establishment | Organization v3 with separate establishment v1 records |
| Primary/headquarters invariants | Transactional exact-one-primary and at-most-one-headquarters |
| Geocoding | Bounded provider abstraction, confirmation session, provenance, private-home suppression |
| Public projections | Final location/contact allowlists with independent publication flags |
| Multi-location map | One organization card; multiple approved markers; establishment Secondary Subject |
| Actor anchoring | Server-authoritative preferred/primary/headquarters fallback |
| Contact/routing | Explicit visibility and purpose routes; no destination disclosure |
| Enrichment | Field-provenanced proposals; no silent organization overwrite |
| Legacy migration | Dry-run default, exact-project/hash/rollback guarded |
| Seed compatibility | Governed v2 package; approval/import counts remain zero |
| PR #21 continuity | Integrated into PR #19 at `8e94efde96a85b7154b33a34cb8a7e26bfb9ea49` |
| Configured owner workflow | Live geocode, private/public decisions, establishment/contact edit, routes, enrichment review |
| Configured matrix | 7/7 Chromium, Firefox, desktop WebKit, and three mobile WebKit projects |
| Development inventory | 21/21 selected and 87/87 total Functions active; 93/93 indexes ready |
| Security and cleanup | 120/120 emulator tests; zero synthetic Auth users/documents after the final matrix |

The detailed tables below preserve the 43-row PR #21 activation/continuity
assessment and its historical percentages. The continuation rows above and the
current evidence snapshot record this establishment/contact-routing extension.
The configured target is only `hi-coworking-plat`; no production action, seed
import, PR #3 merge, or `main` merge occurred.

## Evidence snapshot

- Branch: `codex/exchange-establishments-contact-routing`
- Exact starting/base SHA: PR #19 head
  `8e94efde96a85b7154b33a34cb8a7e26bfb9ea49` after PR #21 integration.
- Functions: the exact isolated package contains 21 endpoints and 18 compiled
  files. All selected endpoints are active Gen 2 Node.js 20; all 87 regional
  Functions are active.
- Firestore indexes: 93/93 live composite indexes are `READY`.
- Firestore rules and Hosting were deployed; Storage rules were unchanged.
  Hosting is `https://hi-coworking-plat.web.app`.
- Configured lifecycle: one guarded test passed organization creation,
  discovery, pending claim/list/detail, rejection, competing approval,
  idempotency, projection privacy, direct-access denials, revocation, and
  post-revocation denial.
- Configured establishment/continuity: 7/7 projects passed in 3.0 minutes at
  1280×800, 1440×900, Firefox, desktop WebKit/Safari, and mobile WebKit at
  390×844, 393×852, and 430×932.
- Synthetic cleanup audits returned zero Auth users and zero marked documents
  after the final configured matrix.
- Authoritative territory `territories/51093` is released from the official
  Census TIGERweb January 1, 2025 county layer; apply, no-op replay, and
  read-only rollback rehearsal passed.
- Seed preparation contains 5,128 candidates; configured human-approved source
  candidates and `organizationSeedImports` both remain zero. This is a correct
  stop at the human gate.

“Configured accepted” means the applicable development gate passed. “Partial”
means later product depth remains. “Blocked—human approval” means code/tooling
is ready but the authorized external decision does not exist.

## Organization lifecycle and context authority

| Phase 22 row | Before | After | Files changed | Contracts | Callables | Rules | Indexes | Tests | Configured evidence | External requirement | Remaining risk | Honest status |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Organization search | 45% | 95% | `organizations.ts`; `organizationModel.ts`; core package | Approved-public search; restricted sources excluded | `exchange_organizationSearch` | Public projection only; restricted direct read denied | Search token query ready | Model, reconciliation, configured lifecycle | Synthetic unclaimed organization discovered; sources omitted | Human-approved real directory data | USAspending availability/ranking | Configured accepted |
| Organization creation | 50% | 97% | `organizations.ts`; lifecycle configured test | Schema v2 split; identity/idempotency reservations | `exchange_organizationCreate` | Browser cannot create authority records directly | Transaction needs no new composite | Unit/function plus configured lifecycle | Created private/public/member/free membership/zero-credit account; retry no-op | None for development | Real duplicate adjudication at scale | Configured accepted |
| Organization claims | 45% | 97% | `organizations.ts`; rules; claim docs | Deterministic caller claim; claim != verification | request/list callables | Claims caller/admin bounded; direct review denied | `requestedBy + updatedAt` ready | Pending/list/privacy/configured test | Pending claim, caller list, notification record, public `claim_pending` | None for synthetic development | Operational notification delivery is separate | Configured accepted |
| Claim review | 40% | 97% | `organizations.ts`; admin claim UI/package | Admin list/detail; approve/reject transaction | Three admin claim callables | Platform admin callable boundary | Status and organization/status indexes ready | Reject/approve/idempotency/configured test | Admin list/detail, rejection, approval, retry all passed | None for synthetic development | Human review policy/SLA | Configured accepted |
| Competing claims | 35% | 96% | `organizations.ts`; lifecycle test | Exactly one owner; competing pending claims rejected | admin review callable | Transaction-only mutation | `organizationId + status` ready | Two-claim configured scenario | Winner approved, loser rejected, repeat approval idempotent | None | Extreme concurrent load not stress-tested live | Configured accepted |
| Actor organization selection | 0% | 96% | shared context; workspace callable/hook/bar | Requested actor separated from validated actor | `exchange_listActorOrganizations` | Preference cannot grant authority | UID membership query ready | Shared/reducer/browser/revocation | Authorized actor retained; invalid former actor fell back to individual | None | Multi-tab preference contention | Configured accepted |
| Actor authority | 25% | 96% | `security.ts`; rules; actor-scoped mode functions | Exact document ID + active member + active org | All actor-scoped callables revalidate | Exact-active parity | Actor-aware composites ready | 118 security tests plus configured denial | Removed member vanished and private action returned `PERMISSION_DENIED` | None | Legacy full-entry retirement remains operational follow-up | Configured accepted |
| Subject selection | 15% | 96% | workspace reducer/types/map/context UI | Subject independent of actor and secondary | perspective/directory | Selection grants no authority | None specific | Reducer/URL/session/browser | External subject retained through four modes and revocation | None | List-only subjects intentionally lack point markers | Configured accepted |
| Viewer-relative projection | 0% | 97% | shared context; perspective resolver; gateway | Context/projection/action allowlists | perspective/resource/action callables | Private direct reads denied | Deterministic relationship lookups | Pure/function/browser response sentinels | Self=`private_owner`; external=`public_claimed`; sentinels absent | None | Relationship-safe real fixture depth | Configured accepted |

## Mode-specific perspectives

| Phase 22 row | Before | After | Files changed | Contracts | Callables | Rules | Indexes | Tests | Configured evidence | External requirement | Remaining risk | Honest status |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intelligence self perspective | 30% | 91% | Intelligence hook/gateway/workspace | Explicit actor-scoped analytics | Five intelligence callables + perspective | Active actor revalidated | Analytics composites ready | Run 3/security/context/browser | Self context survives Intelligence switch | Real analytics history | Fine-grained analytics body depth | Configured shell/context accepted; data partial |
| Intelligence external perspective | 5% | 91% | perspective resolver/drawer | Public or relationship-safe only | Perspective callable | No external private analytics | No graph query | Privacy sentinels/browser | External public subject shown; private fields never returned | Consented relationship fixtures | Public intelligence depth | Configured privacy accepted |
| Referral self perspective | 35% | 91% | Connections data/workspace; referral functions | Actor carried by query/draft/action | 16 business-referral callables | Exact-active actor | Referral composites ready | Run 3/4/security/browser | Actor and subject survive Referrals mode | Transactional referral fixture | Full configured referral draft submission | Configured context accepted; workflow partial |
| Referral external perspective | 10% | 91% | perspective/actions/drawer | Bounded public actions/relationship indicator | context/contact/introduction/referral | Request docs direct-deny | Relationship key deterministic | No-path/idempotency/privacy/browser | External projection stayed public in Referrals | Consented real relationship | Full referral-to-subject UX | Configured privacy accepted |
| Opportunity self perspective | 55% | 94% | discovery/personalization/recent/saved hooks | Explicit actor on queries and private state | RFx discovery/state callables | Actor revalidated | Actor-aware indexes ready | Discovery/security/browser | Self owner context and actor-scoped heading accepted | Real RFx data | Old UID-only state migration policy | Configured accepted |
| Opportunity external perspective | 20% | 95% | Opportunity view/perspective/personalization | Actor A results related to subject B | perspective + `rfx_discover` family | Subject never scopes private actor state | Discovery indexes ready | Heading/privacy/browser | Actor A retained while B selected; actor-relative heading passed | Real ranking corpus | Subject-related ranking quality | Configured accepted |
| Resources self perspective | 25% | 87% | Resources view/state/perspective | Actor/private status context | resource-status + perspective | Direct private recommendations unavailable | No dedicated recommendation index | Projection/reducer/browser | Self context survives Resources mode | Complete resources product/data | Personalized recommendation engine | Configured context accepted; product partial |
| Resources external perspective | 10% | 92% | persistent map/perspective/drawer | Resource-public or context-marker-only | resource status/directory/perspective | Only approved public providers are results | Public directory ready | Non-provider/browser | External non-provider remained context without becoming a result | Approved provider corpus | Full programs/actions UX | Configured accepted |

## Cross-mode continuity

| Phase 22 row | Before | After | Files changed | Contracts | Callables | Rules | Indexes | Tests | Configured evidence | External requirement | Remaining risk | Honest status |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Map camera continuity | 45% | 97% | root workspace/map hook | One bounded shared viewport and one map host | None | None | None | Persistent-host/unit/browser | Original map DOM node remained connected across all modes; camera URL retained | None | Long-session Mapbox/GPU profiling | Configured accepted |
| Subject marker continuity | 20% | 95% | map sources/layers/GeoJSON | Independent context and result sources | Directory/perspective | Explicit publication/coordinate gate | Directory ready | Marker/privacy/browser | Synthetic external marker/context survived every mode | Human-approved real organization coordinates | List-only subject messaging | Configured accepted |
| Search continuity | 55% | 97% | reducer/root/mode workspaces | One workspace query with mode interpretation | Mode queries | Search grants no authority | Mode indexes ready | Reducer + 7-project browser | All four mounted mode inputs retained exact query through switch/reload | None | Very long query/session cases | Configured accepted |
| Locality continuity | 35% | 94% | reducer/URL/session/territory | Shared locality and authoritative FIPS context | territory list/directory | Released territory only | Territory ready | State/locality/import/browser | Camera/locality context retained; `51093` released | None | Rich multi-locality UX | Configured accepted |
| Radius/bounds continuity | 45% | 94% | URL/map/directory discovery | Bounded radius/bounds restored | Directory/discovery | Bounds grant no authority | Ready | Codec/reducer/browser | Camera coordinates/zoom survived URL and mode cycle | None | Antimeridian UI | Configured accepted |
| URL restoration | 60% | 97% | URL codec/workspace | Allowlisted actor request, subject, secondary, surfaces, camera | Actor request revalidated | URL is never authority | None | Round-trip/security/browser | Actor, subject, query, drawer, camera restored | None | Future schema-version migration | Configured accepted |
| Back/Forward | 55% | 96% | root workspace/URL codec | Complete hydration | Actor revalidated | None | None | Unit + 7-project browser | Back then Forward restored actor and subject | None | Long history chains | Configured accepted |
| Refresh restoration | 35% | 96% | workspace session/URL/hook | URL wins shareable; actor-bound session for transient | Actor list validates | Session grants no authority | None | Session injection/expiry/browser | Hard reload restored actor, subject, drawer, and query | None | Multi-tab conflict policy | Configured accepted |
| Drawer continuity | 10% | 96% | context drawer/bar/reducer | Drawer state independent of mode | Perspective/actions | Server allowlists fields | None | Mobile/reducer/axe/browser | Same external drawer remained visible through four modes and history | Native AT manual pass | Advanced focus restoration | Configured accepted |
| Per-mode filter restoration | 15% | 92% | four mode state families/views | Independent mode snapshots | Mode queries consume snapshots | None | Ready | Reducer/component suites | Shared query verified configured; per-mode state verified locally | Populated configured filter corpus | Deep component-local filter cases | Source accepted; configured depth partial |
| List scroll restoration | 0% | 83% | four views/reducer | Bounded scroll per mode | None | None | None | Reducer/component tests | No populated long-list configured fixture | Approved/populated long lists | Refresh-induced list shifts | Partial |
| Draft preservation | 5% | 72% | state/session/referral workflow | Actor-bound draft references; freeze on actor change | Referral workflow | Submit revalidates actor | None | Reducer/session/source tests | No configured draft submission in this run | Dedicated workflow fixtures | Non-referral draft integrations | Partial |

## Directory, seed, geography, and configured release

| Phase 22 row | Before | After | Files changed | Contracts | Callables | Rules | Indexes | Tests | Configured evidence | External requirement | Remaining risk | Honest status |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Directory | 35% | 94% | workspace callable/gateway/repository | Strict public projection; bounded cursor/page | directory/save/contact/introduction | Public read; private/action callable-only | Directory/saved ready | Pagination/mapping/configured probes | Live endpoint returned 200; synthetic public projections resolved | Human-approved population | Post-filter scanning at large scale | Configured accepted |
| Markers | 60% | 92% | GeoJSON/map sources/layers | Privacy-minimized context/result properties | Directory | Coordinate publication required | Directory ready | 100/1k/10k transforms + browser | Synthetic approved coordinates rendered; no fabricated org coordinates | Human-approved coordinates | Real-corpus rendering | Configured synthetic accepted |
| Clustering | 72% | 90% | map config/layers/events | Separate organization/RFx clusters | None | No private GeoJSON | None | 100/1k/10k fixtures | One live map accepted at all viewports | Real large corpus | Browser GPU profile at 10k | Local scale + configured shell accepted |
| Seed review | 20% | 80% | review/export/lifecycle scripts/docs | Hash-bound review and field approvals | None | Restricted inputs server-only | None | 16 lifecycle tests | Packet generated; 0 approvals | Authorized human decisions | 5,128 records need review | Blocked—human approval |
| Sample import | 20% | 40% | approved importer/docs | Approved-only, ≤100, rollback-before-write | Admin script | Canonical atomic writes | None | Guard/dry/duplicate/claimed tests | 0 imported by design | At least one human-approved record | No lawful input exists | Blocked—human approval |
| No-op replay | 5% | 40% | importer/replay docs | `--expect-no-op` after approved sample | Admin script | No browser path | None | Replay/repair tests | Organization seed replay not run; territory replay passed separately | Approved sample first | Cannot prove organization replay without import | Blocked by sample import |
| Rollback | 5% | 60% | seed rollback/import scripts/docs | Exact before/after hashes; stale/claimed refusal | Admin script | Exact project/environment | None | Rehearsal/tamper/refusal tests | No organization seed manifest because no import | Approved sample first | Live organization rollback awaits lawful sample | Tooling ready; configured blocked |
| Locality boundaries | 10% | 97% | territory importer/test/doc | Official source/FIPS/vintage/geometry/hash | `territory_list_released` | Released territory rule | Territory index ready | 6 importer tests + live operations | `51093` applied; replay no-op; rollback rehearsal ready | None | Future Census vintage update | Configured accepted |
| Configured deployment | 15% | 98% | exact package scripts; Firebase config; deployment doc | Exact manifests/dependencies/hashes | 43 workstream callables active | Firestore + Storage deployed | 88 ready | Dry runs/builds/probes/inventory | No deletions; auth-required probes 401; directory 200 | None | Node 20/function SDK lifecycle follow-up | Configured accepted |
| Configured browser acceptance | 10% | 96% | guarded Playwright spec/config/acceptance doc | Synthetic marked actor/subject; response sentinels | Live context/directory | Live rules | Live indexes | 7/7 projects | Desktop/mobile/browser/privacy/axe/overflow/history/revocation passed; cleanup zero | Approved seed scenario after human gate | Native Safari/VoiceOver and draft/long-list depth | Configured accepted for applicable gates |

## Quality and release readiness

| Phase 22 row | Before | After | Files changed | Contracts | Callables | Rules | Indexes | Tests | Configured evidence | External requirement | Remaining risk | Honest status |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Security | 35% | 96% | security/perspective/rules/actor-scoped functions | Exact-active + final allowlists | Lifecycle/context/mode actions | Private/restricted/review direct reads denied | Ready | 118 security + configured lifecycle/browser | Direct private/restricted/review reads 403; external sentinels absent; revocation immediate | None | Legacy endpoints and dependency updates | Configured accepted |
| Accessibility | 45% | 93% | context UI/persistent workspace/active filters | Named controls/status/drawer | Fail-closed errors | n/a | n/a | Axe in all 7 projects | Zero critical/serious violations after contrast repair; no overflow at all viewports | Native Safari/VoiceOver manual gate | Advanced AT/focus audit | Automated configured accepted |
| Performance | 50% | 90% | one map; stable sources; caches/stale guards | Bounded pages/properties; actor-keyed caches | Directory 50/page; actors 100 max | No private bulk reads | Ready | Transform scales/persistent host/browser | One map node stayed connected; seven journeys completed | Real high-volume data/profile | Four persistent view trees and GPU/load profiling | Substantial; profiling follow-up |
| Production readiness | 15% | 35% | Entire workstream/docs | Development contract complete; prod gates explicit | No production deployment | No production release | No production index action | Development evidence only | No production action performed | Merge stack, product/ops/security review, approved data | Separate Issuer/Responder/Evaluation/Teaming/Resources/commerce/comms workstreams | Not production-ready |

## Overall assessment

The predecessor PR #21 table's weighted **89%** remains historical context for
the broader activation/continuity product. This establishment/contact-routing
workstream is **98% complete** at configured-development handoff: implementation,
deployment, automated accessibility/security, cross-browser acceptance, and
cleanup are complete. The remaining two percent is the explicit native
VoiceOver manual release gate. Human seed approval/import is not unfinished work
in this run; it is intentionally the separately authorized next workstream.
