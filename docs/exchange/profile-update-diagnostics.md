# Profile update diagnostics

## Confirmed code-path finding

The client and Functions source both use `profile_update`, and the web SDK targets `us-central1`. The prior UI caught every callable failure and replaced it with the same generic sentence. That masking—not a missing client implementation—was the confirmed code defect.

The branch now classifies:

- `FUNCTION_NOT_DEPLOYED`
- `WRONG_FIREBASE_PROJECT`
- `UNAUTHENTICATED`
- `STALE_AUTH_TOKEN`
- `PERMISSION_DENIED`
- `INVALID_PROFILE_DATA`
- `LEGACY_PROFILE_REQUIRES_MIGRATION`
- `STORAGE_REFERENCE_INVALID`
- `NETWORK_UNAVAILABLE`
- `UNKNOWN`

Development displays the safe diagnostic code; production displays only actionable user text. The server attaches structured codes to validation and asset-path failures and migrates legacy profiles in the save transaction. Raw secrets, token contents, private field values, and server stack traces are never returned.

## Deployment check

If the configured development environment returns `FUNCTION_NOT_DEPLOYED`, deploy the current `profile_update` export to `us-central1` in the exact project named by `NEXT_PUBLIC_FIREBASE_PROJECT_ID`. If it returns `WRONG_FIREBASE_PROJECT`, correct the local environment and restart Next.js. Browser acceptance covers an ordinary user and a legacy `master` account against emulators.
