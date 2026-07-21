# Account initialization

## Callable contract

`account_initialize` is an authenticated callable in `us-central1`.

Input:

- optional trimmed `displayName`, maximum 160 characters;
- required `registrationVersion: 1`;
- required bounded `idempotencyKey` containing only safe identifier characters.

The server derives UID, email, role, and timestamps from Admin Auth. Unknown fields are rejected. A claimless account receives only `member`; a supported existing Auth role is preserved. Browser input cannot request a role.

The transaction idempotently creates or repairs:

- `users/{uid}` with identity, membership defaults, registration version, and initialization metadata;
- `profiles/{uid}` as private/unpublished, version 0, schema 3 when newly created.

Existing profile data is merged and preserved. A schema-less existing profile remains legacy until `profile_update` performs the canonical migration. No organization, marketing, Microsoft, verification, or administrative state is created.

## Blocking-trigger decision

The source `authBeforeCreate` now calls the same provisioner and does not log UID/email. The configured project already had an older active `authBeforeCreate` revision, but the operator identity could not read the Identity Platform blocking-hook configuration. Updating a creation-blocking trigger without independently proving its control-plane configuration was outside the safe minimum deployment. Registration correctness therefore uses the deployed callable fallback and does not depend exclusively on the trigger.

The controlled core deployment includes only `account_initialize`, `profile_update`, `enrichment_search`, and `enrichment_link`. The active live blocking-trigger revision was not changed.

## Recovery and tests

Emulator tests cover idempotent replay, missing user/profile repair, browser role rejection, supported legacy-role preservation, unauthenticated denial, and schema-less legacy preservation. Configured disposable and synthetic legacy journeys prove ordinary initialization and master-role preservation against `hi-coworking-plat`.
