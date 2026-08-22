# Hi Coworking PR visual previews

## Purpose

Same-repository pull requests build an isolated static visual-review artifact and, when the Firebase Hosting deployment credential is configured, publish that artifact to a Firebase Hosting preview channel.

The preview workflow never targets the Firebase `live` channel and must never use this repository's `gh-pages` branch for PR previews.

## Important legacy-site boundary

`gh-pages` is production-sensitive legacy infrastructure. Its `CNAME` is `hi-coworking.com`, so adding a GitHub Pages PR publisher to this repository would share a publication surface with the public site.

PR previews therefore use Firebase Hosting preview channels instead. Do not repurpose `gh-pages`, its `CNAME`, or the public site's root files for previews.

## Architecture

The workflow is intentionally split in two:

1. **Unprivileged PR build** — `.github/workflows/pr-preview-build.yml`
   - runs on same-repository pull requests;
   - checks out the exact PR head SHA using a read-only Git fetch that does not traverse the repository's malformed legacy gitlinks;
   - runs `npm ci` and the normal static Next.js export;
   - builds with demo Firebase browser configuration so preview UI cannot use the live Firestore, Functions, Storage, or Authentication project through the compiled client settings;
   - optionally embeds the repository Actions variable `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` for map rendering;
   - writes a preview-only `robots.txt` that disallows indexing;
   - uploads `apps/web/out` plus exact PR/SHA metadata as a short-lived GitHub Actions artifact;
   - receives no Firebase deployment credential.

2. **Trusted Firebase publisher** — `.github/workflows/firebase-pr-preview-publish.yml`
   - runs only after a successful PR-preview build;
   - executes from the workflow definition on the default branch rather than executing PR code with deployment credentials;
   - downloads the artifact and verifies PR number, repository, open state, and exact current head SHA;
   - rejects stale or fork artifacts;
   - constructs a Hosting-only `firebase.json` around the already-built static files;
   - deploys only to Firebase project `hi-coworking-plat`, channel `pr-<number>`;
   - never specifies `channelId: live`;
   - posts or updates the tappable Firebase preview URL on the PR;
   - sets each channel to expire seven days after its most recent deployment.

## Preview URL

Firebase assigns the actual Hosting preview URL. The trusted publisher posts it on the PR after deployment succeeds. The channel ID is deterministic:

```text
pr-<pull-request-number>
```

The URL remains stable for that PR as new commits are deployed to the same channel.

## One-time Firebase credential

The trusted publisher requires a Hosting service-account JSON stored as one of these GitHub repository secrets:

```text
FIREBASE_SERVICE_ACCOUNT_HI_COWORKING_PLAT
```

Preferred, or the fallback:

```text
FIREBASE_SERVICE_ACCOUNT
```

Firebase's supported setup path is to authenticate locally with the Firebase CLI and run:

```text
firebase init hosting:github
```

for Firebase project `hi-coworking-plat`, then store the generated Hosting service-account JSON under the preferred repository-secret name above.

Until that secret exists, PR builds remain safe and green, but the trusted publisher posts a clear PR notice that the deployment credential is the missing one-time prerequisite. No live Hosting channel or legacy Pages content is changed.

## Security properties

- PR code never receives the Firebase Hosting deployment credential.
- The privileged publisher does not check out or execute PR source code.
- Only a successful static artifact matching the current exact PR head can be deployed.
- Fork PRs are not deployed.
- Compiled preview JavaScript uses non-production Firebase browser placeholders.
- Hosting deployment is scoped to a named preview channel, not `live`.
- Preview channels automatically expire after seven days.
- `gh-pages` and `hi-coworking.com` are outside the preview publication path.

## Map rendering

The map renders when repository Actions variable `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured with a public Mapbox token whose allowed origins include the Firebase preview domains. If the variable is absent or its origin restrictions exclude the preview URL, the static preview still builds but the Mapbox surface will remain inactive.

## Merge-quality checks

PR preview publication is a visual-review aid, not production acceptance. `.github/workflows/exchange-security.yml` remains the repository's build, lint, emulator-security, and merge-quality signal.

Normal production builds continue to use the repository's unchanged static-export Next.js configuration and existing Firebase release path.
