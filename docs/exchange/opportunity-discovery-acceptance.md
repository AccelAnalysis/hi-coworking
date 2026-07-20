# Opportunity Discovery Acceptance

Date: 2026-07-20
Branch: `codex/exchange-opportunity-discovery-reconciliation`

## Required browser matrix

| Viewport | Class | Behavioral UAT | Density review | Screenshot | Status |
| --- | --- | --- | --- | --- | --- |
| 390 × 844 | Mobile | Required | Required | Required | Not run |
| 393 × 852 | Mobile | Required | Required | Required | Not run |
| 430 × 932 | Mobile | Required | Required | Required | Not run |
| 768 × 1024 | Tablet portrait | Required | Required | Required | Not run |
| 1024 × 768 | Tablet landscape | Required | Required | Required | Not run |
| 1280 × 800 | Desktop | Required | Required | Required | Not run |
| 1440 × 900 | Desktop | Required | Required | Required | Not run |
| 1728 × 1117 | Desktop | Required | Required | Required | Not run |

Screenshots belong in `docs/exchange/screenshots/opportunity-discovery-100/`. No screenshots have been fabricated in this branch.

## Workflow checklist

- [ ] Initial Opportunities view is map-first and search is immediately visible.
- [ ] Only the command-bar Filters button opens the mobile filter sheet.
- [ ] Location suggestions work by keyboard and pointer.
- [ ] Selecting a place and radius updates results, distance, cards, map, and URL.
- [ ] Search this map area appears only after meaningful movement.
- [ ] Clear map-area filter restores broader discovery.
- [ ] Keyword, industry label, NAICS code, and capability searches return expected records.
- [ ] Every sort option survives refresh and browser back/forward.
- [ ] Compound procurement filters are server evaluated.
- [ ] Active filters stay to one compact row with overflow.
- [ ] Cards remain scannable with realistic titles/tags.
- [ ] Save state is synchronized between card and detail.
- [ ] Selected card, marker, drawer, and detail stay synchronized.
- [ ] Cluster expansion is predictable and does not duplicate markers.
- [ ] 2D/3D remains reachable and persists through discovery changes.
- [ ] Results without coordinates remain available in the list and are not fabricated on the map.
- [ ] Detail provides decision context without requiring immediate navigation away.
- [ ] Addenda, acknowledgment, Q&A, and procurement calendar are usable.
- [ ] Refer, share, team, respond, continue/view response, and evaluate routes reflect authority.
- [ ] Saved search can be created, run, and deleted.
- [ ] Recent search can be restored.
- [ ] Infinite loading occurs inside the result panel/drawer without page scroll.
- [ ] Empty, error, offline, Mapbox error, and degraded states are compact and actionable.
- [ ] Mobile drawer supports minimized, partial, and expanded states.
- [ ] Persistent mobile navigation order remains Intelligence, Referrals, Opportunities, Resources, Menu.
- [ ] Bottom navigation remains above the result drawer and controls do not overlap.
- [ ] Desktop map remains full screen behind floating results/detail panels.
- [ ] No horizontal overflow or unsafe-area obstruction.
- [ ] Keyboard, screen reader, contrast, and reduced-motion checks pass.

## UI-density review

Acceptance must answer yes to each item:

1. The next likely action is clear in every state.
2. Advanced filters are discoverable without being permanently visible.
3. The command bar does not become a dashboard toolbar.
4. Filter chips do not consume a second large row.
5. Cards do not become miniature detail pages.
6. Secondary actions live in compact icon/overflow treatments.
7. Map controls do not overlap the 2D/3D control, drawers, or navigation.
8. The map retains useful visible area on every mobile viewport.
9. Detail sections use disclosure rather than one dense continuous page.
10. Statuses are restrained to the most decision-relevant states.

## Final acceptance matrix

| Feature | Before | Current code estimate | Primary implementation | Proof required | Remaining configuration/blocker |
| --- | ---: | ---: | --- | --- | --- |
| Geographic browsing | 88% | 96% | Mapbox map, bounds, fit, confidence model | Browser/map tests | Projection coordinates and browser UAT |
| Keyword search | 80% | 94% | Projection tokens, deterministic ranking | Provider unit/load tests | Backfill/index readiness; advanced typo engine optional |
| Industry search | 65% | 91% | Label/code/capability UX | Catalog and browser tests | Complete official NAICS generated dataset |
| Location search | 20% | 92% | Mapbox v6 adapter, radius, distance, URL | Live provider/browser tests | Authorized token/domain exercise |
| Sorting | 35% | 96% | Shared URL-backed sort model | Unit/E2E tests | Index readiness for all server sorts |
| Filtering | 75% | 95% | Procurement/personalization contract and UI | Combination/security tests | Configured browser acceptance |
| Map clusters and bubbles | 88% | 94% | Existing cluster/selection/2D-3D plus enriched source | Playwright/map tests | Full-page aggregation strategy at very high result counts |
| Opportunity cards | 82% | 97% | Scannable enriched cards, save/share/team | Component/E2E tests | Browser density acceptance |
| Opportunity detail | 85% | 96% | Decision context, authority, governance | E2E/security tests | Issuer data completeness |
| Saved opportunities | 55% | 97% | Server owner scope + card/detail workflow | Security/E2E tests | Configured browser acceptance |
| Saved searches and alerts | 0% | 90% | Normalized CRUD/recent/alert preferences | Owner-scope/E2E tests | Edit UI refinement; external delivery disabled |
| Server-side scale | 30% | 86% | Projection provider, cursor, budgets, fallback | 10k performance test | Backfill/index deployment; compatibility path removal |
| Accessibility | 75% | 90% | Accessible controls and list equivalent | Axe/manual AT review | Required acceptance not run |
| Mobile acceptance | 85% | 91% | Canonical drawer/shell preserved | 3 mobile + tablet viewports | Screenshots/UAT not run |
| Desktop acceptance | 90% | 94% | Floating map-first shell preserved | 3 desktop viewports | Screenshots/UAT not run |
| Security | 85% | 96% | Projection allowlist, callable authority, owner scope | 90-test emulator gate passed | Live-project acceptance and CI review |
| Production build | 88% | 100% | Code integrated on feature branch | Local production build passed | CI confirmation |

## Local validation record

The following gates passed on 2026-07-20:

| Gate | Result |
| --- | --- |
| Locked dependency installation | `npm ci` passed; local Node 22 differs from repository Node 20 |
| Shared and Functions builds | Passed with zero TypeScript errors |
| Focused discovery suite | 14 Node tests, 9 Vitest tests, 67 static checks passed |
| Firestore discovery indexes | 27 definitions present, unique, ordered, and current |
| Synthetic fixtures | 100, 1,000, and 10,000 records schema validated |
| Configured browser suite compile | 15 Playwright scenarios enumerated; execution remains opt-in |
| Lint | Zero errors; six existing warnings |
| Canonical Exchange | 88/88 passed |
| Configured-development readiness | 9/9 passed |
| Week 1 organization reconciliation | 11 Node tests and 7 Vitest checks passed |
| Security, Functions, rules, migrations | 90/90 passed in Firebase emulators |
| Run 3 | 35/35 passed |
| Run 4 | 34/34 passed |
| Production Next.js build | Passed; 57 static/SSG routes generated |
| Whitespace validation | `git diff --check` passed |

The authenticated browser workflow, live restricted Mapbox token/domain,
viewport screenshots, manual assistive-technology review, and measured load
targets were not run. The unauthenticated static production build was inspected
and correctly redirected `/exchange` to sign-in; that is security evidence,
not a substitute for the configured browser matrix.

## Honest completion percentage

Current implementation estimate: **94%**.

This is not a production acceptance result. The final percentage must be recalculated after CI, emulator tests, live Mapbox exercise, complete NAICS ingestion, performance measurements, accessibility review, and all viewport screenshots. A failed or unperformed gate prevents a 100% claim.
