# Canonical Exchange workspace correction

## Governing product rule

The Hi-Coworking Exchange is the prototype-derived, full-viewport `ExchangeWorkspace`. The legacy RFx page is a compatibility surface and must never be used as the implementation of `/exchange`.

## Canonical entry

`apps/web/src/app/exchange/page.tsx` must:

- render `ExchangeWorkspace`;
- use `AppShell variant="workspace"`;
- preserve the dedicated map-centered command environment;
- support the unified businesses, opportunities, referrals, teaming, resources, connections, and intelligence views;
- avoid importing `apps/web/src/app/rfx/page.tsx` or `RfxFeedPage`.

## Authentication behavior

After successful registration or sign-in, users enter `/exchange` directly. Organization connection, verification, membership selection, and billing are progressive actions and must not prevent basic Exchange browsing.

## Compatibility routes

The legacy routes remain compatibility redirects:

- `/rfx` → `/exchange?view=opportunities`
- `/directory` → `/exchange?view=businesses`
- `/referrals` → `/exchange?view=referrals`

## Regression protection

`tests/run4/exchange-launch-ui.test.ts` verifies that:

- the canonical route imports `ExchangeWorkspace`;
- the workspace shell remains active;
- the route does not import the legacy RFx page;
- registration and sign-in redirect to `/exchange`;
- organization connection is described as optional for browsing.

## Branch preservation

The newer Week 1 organization-claim, Isle of Wight seed, founder-cap, and stricter acceptance work remains preserved on `codex/exchange-week1-merge-source`. It must be reconciled into this full Exchange foundation deliberately rather than replacing the workspace.
