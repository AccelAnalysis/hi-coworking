# Hi Coworking PR visual previews

## Purpose

Every same-repository pull request can produce a tappable static visual preview without deploying the PR to the live Firebase Hosting site.

The preview system is intentionally separate from `www.hi-coworking.com` and from the `hi-coworking-plat` Firebase Hosting release path.

## Preview URL

For pull request `N`, the published preview is:

```text
https://accelanalysis.github.io/hi-coworking/pr-N/
```

The Exchange view is:

```text
https://accelanalysis.github.io/hi-coworking/pr-N/exchange/
```

The publisher posts or updates the preview link on the pull request after deployment succeeds.

## Safety boundary

The build workflow:

- runs only for PRs whose head branch belongs to `AccelAnalysis/hi-coworking`;
- checks out the exact PR head SHA without persisting Git credentials;
- has read-only repository permissions;
- uses demo Firebase public configuration values;
- does not deploy Firebase Hosting, Functions, Firestore rules, indexes, Storage rules, or data;
- does not receive Firebase service-account credentials;
- uploads only the static Next.js export as an artifact.

A separate trusted workflow downloads the successful artifact, verifies that its PR number and head SHA still match the open PR, publishes it under the PR-specific GitHub Pages path, and posts the URL on the PR.

Fork PRs are not published.

## Runtime behavior

This is a visual-review surface, not a production-like backend environment. Authentication, Firestore writes, Functions, Storage, Stripe, and other server-backed operations intentionally fail closed because the preview uses non-production Firebase placeholders.

The map renders when the repository Actions variable `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured with a public token authorized for the GitHub Pages preview origin. If that variable is absent, the rest of the static interface still builds and the map component remains inactive.

## Merge-quality checks

The preview workflow is not a substitute for application verification. `.github/workflows/exchange-security.yml` remains the merge-quality build, lint, emulator-security, and production-build signal.

The preview-specific Next.js settings are enabled only when `HI_COWORKING_PAGES_PREVIEW=1`; normal Firebase builds keep the existing production export behavior.

## Lifecycle

- Opening, reopening, marking ready, or pushing a new commit to a same-repository PR requests a new preview build.
- Newer PR commits cancel older in-progress preview builds.
- The publisher rejects stale artifacts if the PR head changed before publication.
- Closing or merging the PR removes its `pr-N` directory and updates the PR comment to show that the preview was removed.
- `robots.txt` and preview HTML request `noindex,nofollow` so the review surface is not intended for search indexing.

## One-time GitHub Pages requirement

The repository must have GitHub Pages enabled with **Build and deployment → Source: GitHub Actions**. Private repositories require a GitHub plan that supports Pages. Once enabled, the workflows manage publication and cleanup automatically.
