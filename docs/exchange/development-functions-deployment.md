# Development Functions deployment

This run deploys the smallest coherent backend set required by the configured account/profile/enrichment journey. Use Node 20 and name the project on every command.

## Guards

```sh
test "$(firebase use)" = "hi-coworking-plat"
test "$(node --version | cut -d. -f1)" = "v20"
git branch --show-current
git status --short
npm run build:shared
npm run build:functions
```

The branch must be `codex/exchange-configured-acceptance-and-seed-activation`. Review `account-profile-enrichment-rollback.md` before deployment.

## Discovery and deployment

```sh
node scripts/core-functions-package.mjs generate

firebase deploy \
  --only functions:account_initialize,functions:profile_update,functions:enrichment_search,functions:enrichment_link \
  --config firebase.core-functions.json \
  --project hi-coworking-plat \
  --dry-run

firebase deploy \
  --only functions:account_initialize,functions:profile_update,functions:enrichment_search,functions:enrichment_link \
  --config firebase.core-functions.json \
  --project hi-coworking-plat

node scripts/core-functions-package.mjs clean
```

The generator copies only the compiled core module graph and writes a deployment-only package whose manifest contains exactly the four approved endpoints and only the existing `SAM_GOV_API_KEY` binding. It deliberately excludes the monorepo-only `@hi/shared` dependency, which these core modules do not import. The staging directory is gitignored and the guarded clean operation refuses to remove a package whose marker, endpoints, or runtime dependency contract does not match. It prevents unrelated social, Stripe, access, QuickBooks, event, and optional Microsoft integrations from becoming deployment prerequisites. The selection intentionally excludes `authBeforeCreate`, organization callables, scheduled jobs, Firestore/Storage rules, indexes, Hosting, Stripe, seed import, and optional Microsoft administrative marketing Functions.

## Post-deployment checks

Confirm that all four Functions are active, second generation, Node 20, and `us-central1`; confirm `authBeforeCreate` remains active; then run authenticated configured browser acceptance. Expected callable rejections are warnings with safe diagnostic codes, not uncaught overlays.

## Recorded deployment — 2026-07-21

The exact project and region guards passed. A normal full-source dry run first demonstrated two isolation problems without creating an active target: optional LinkedIn secret discovery and Cloud Build resolution of the workspace-only `@hi/shared@^0.0.0`. The generated 25.8 KB core package removed both unrelated prerequisites without changing application runtime source.

The four creates then completed successfully. Because the Firebase CLI returned before its post-deploy IAM step completed, each exact Cloud Run service was given the standard Firebase callable `allUsers` `roles/run.invoker` binding; handler authentication still rejects unauthenticated POSTs. A later `account_initialize` source fix produced active revision `account-initialize-00002-baw`. Function inventory, OPTIONS 204, unauthenticated 401, and authenticated browser calls all passed.

The initial authenticated enrichment call found a sparse-object persistence bug after provider execution. `enrichment_search` alone was rebuilt/redeployed through the same core package and the configured search/link journey then passed. The staging package was validated and removed after each deployment.

The source-alignment refresh completed with these active revisions:

- `account_initialize`: `account-initialize-00002-baw`;
- `profile_update`: `profile-update-00002-cuy`;
- `enrichment_search`: `enrichment-search-00003-viw`;
- `enrichment_link`: `enrichment-link-00002-jes`.

No Function was deleted. `authBeforeCreate`, rules, indexes, Storage rules, Hosting, organization callables, Stripe, seed import, and Microsoft functions were unchanged. Node 20 is the repository-required runtime but reaches upstream decommission on 2026-10-30; migration must be planned separately.
