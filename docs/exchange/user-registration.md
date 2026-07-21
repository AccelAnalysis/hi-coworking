# User registration

## Lifecycle

The browser normalizes whitespace in the display name and lowercases/trims the email, creates the Firebase Auth identity, updates the Auth display name, and calls `account_initialize`. Navigation does not occur until the callable confirms the authoritative account. The next route is `/profile?onboarding=1`, with a visible path to `/exchange`; organization connection is optional.

Registration never writes a browser-selected role or protected Firestore authority. It creates no organization membership, administrator/review authority, `adminMarketingEmail` claim, Microsoft mailbox/OAuth connection, or marketing state.

## Interrupted provisioning

If Auth creation succeeds but `account_initialize` fails, the page retains the authenticated identity and changes the action to **Complete account setup**. The retry reuses its idempotency key. It does not delete the Auth identity or ask the user to register again.

Every normal sign-in calls the same idempotent initializer. The authenticated user-document listener also performs one bounded repair when `users/{uid}` is absent. After provisioning, the client refreshes the ID token so a server-added default claim becomes visible.

Expected callable failures are logged only through the safe diagnostic serializer. Emails, passwords, tokens, complete errors, and profile payloads are excluded.

## Configured evidence

On 2026-07-21 a guarded disposable account registered against `hi-coworking-plat`, received only `member`, received matching `users/{uid}` and private `profiles/{uid}` documents, had no organization membership or marketing claim, completed profile/enrichment, signed out and back in, returned to Exchange, and was deleted through the exact synthetic-identity guard.
