# Organization search and creation

## Business-activation extension

Search now records authoritative completion for the representative and includes the viewer’s own exact-active organizations even when their directory projection is still a draft. That private self-result is produced only after membership lookup and is labeled “Your organization” or “Your organization — directory draft”; it is never returned to an external viewer.

Mandatory activation supports canonical public matches, governed claims, new creation, duplicate review, and external-source matches that require governed promotion. New organizations begin as directory drafts and continue to enrichment. There is no skip or individual-browse action.

Search covers legal/trade names and the existing organization projection’s capability, industry, NAICS, certification, and locality tokens. Establishment-name discovery remains dependent on its public or authorized actor projection.

Authenticated search uses a bounded callable with a per-user, per-minute rate record. It searches canonical organizations and restricted source candidates by normalized search tokens, then optionally queries USAspending with an eight-second timeout and safe empty-result degradation.

Results contain only a privacy-minimized projection, confidence score, match explanation, claim/verification state, and source names. Deduplication favors canonical local records over external candidates.

Creation performs duplicate search first. Strong matches are returned for explicit confirmation. A server-side idempotency fingerprint prevents retry duplication, and the transaction creates the private organization, owner membership, Run 4 free Exchange membership, zero-credit account, inactive/draft public projection, and audit event. The browser never assigns ownership directly.

External USAspending results cannot be claimed. A restricted source candidate must first be linked/imported by the governed claim callable.
