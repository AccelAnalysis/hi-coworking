# Organization search and creation

Authenticated search uses a bounded callable with a per-user, per-minute rate record. It searches canonical organizations and restricted source candidates by normalized search tokens, then optionally queries USAspending with an eight-second timeout and safe empty-result degradation.

Results contain only a privacy-minimized projection, confidence score, match explanation, claim/verification state, and source names. Deduplication favors canonical local records over external candidates.

Creation performs duplicate search first. Strong matches are returned for explicit confirmation. A server-side idempotency fingerprint prevents retry duplication, and the transaction creates the organization, owner membership, Run 4 free Exchange membership, zero-credit account, public projection, and audit event. The browser never assigns ownership directly.

External USAspending results cannot be claimed. A restricted source candidate must first be linked/imported by the governed claim callable.
