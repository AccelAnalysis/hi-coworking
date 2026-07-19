# Exchange configured-development acceptance

This runbook validates the integrated Exchange against the configured Firebase development environment without weakening production security or making configured-environment checks a blocking pull-request gate.

## Principles

- Emulator development remains available at all times.
- No Firestore rule or Cloud Function bypass is introduced for development.
- Valid dedicated test identities are provisioned instead of weakening authorization.
- Configured-development checks are advisory by default.
- Writes require explicit opt-in and exact project confirmation.
- The manual GitHub workflow does not deploy Functions, rules, indexes, Storage rules, seeds, or migrations.
- The safer default for claim-review smoke testing is rejection, not approval.

## 1. Prepare local browser configuration

Copy the example environment file:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Populate the Firebase browser values for `hi-coworking-plat` and set:

```dotenv
NEXT_PUBLIC_FIREBASE_PROJECT_ID=hi-coworking-plat
NEXT_PUBLIC_EXPECTED_FIREBASE_PROJECT_ID=hi-coworking-plat
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.replace-with-your-public-token
```

Never put a Mapbox secret token beginning with `sk.` in browser configuration.

## 2. Run the advisory readiness check

```bash
npm run check:exchange-dev -- --project hi-coworking-plat
```

The default command reports blockers and warnings but does not prevent local development. Use strict mode only when recording a formal configured-development acceptance result:

```bash
npm run check:exchange-dev:strict -- --project hi-coworking-plat
```

The checker never prints Firebase or Mapbox credential values. It reports only whether required values are present and whether project IDs agree.

## 3. Create dedicated development identities

Use two dedicated addresses containing `exchange-dev` or `exchange-smoke`. Do not use a founder, staff, customer, or other general-purpose account.

```bash
export EXCHANGE_DEV_TEST_EMAIL='member+exchange-dev@example.com'
export EXCHANGE_DEV_TEST_PASSWORD='replace-with-a-long-development-password'
export EXCHANGE_DEV_ADMIN_EMAIL='admin+exchange-dev@example.com'
export EXCHANGE_DEV_ADMIN_PASSWORD='replace-with-a-different-long-development-password'
```

Preview the account plan:

```bash
npm run bootstrap:exchange-dev:dry
```

Apply only after reviewing the plan and confirming Application Default Credentials target the intended Firebase project:

```bash
node apps/functions/scripts/bootstrap-development-accounts.cjs \
  --project hi-coworking-plat \
  --apply \
  --confirm-development hi-coworking-plat
```

The bootstrap creates or normalizes only dedicated test accounts, sets verified `member` and `admin` custom claims, and writes matching `users` records. It rejects ordinary email addresses and does not alter Firestore rules or callable authorization.

After changing custom claims, sign out and sign in again so Firebase refreshes the ID token.

## 4. Start the configured-development browser locally

```bash
npm ci
npm run dev
```

Confirm that the application is available at:

```text
http://127.0.0.1:3000
```

Set smoke-test inputs:

```bash
export EXCHANGE_DEV_BASE_URL='http://127.0.0.1:3000'
export EXCHANGE_DEV_REQUIRE_SMOKE='true'
```

Run the non-destructive smoke first:

```bash
npm run test:browser:configured-dev
```

This validates:

- member sign-in;
- canonical `/exchange` access;
- visible Exchange modes;
- profile-page access;
- profile save through the deployed callable.

## 5. Enable controlled development writes

Organization creation and claim review are skipped unless mutations are explicitly enabled:

```bash
export EXCHANGE_DEV_ALLOW_MUTATIONS='true'
```

The organization-creation test uses a timestamped disposable name.

For claim testing, first import or create a dedicated unclaimed test organization. Then set:

```bash
export EXCHANGE_DEV_CLAIM_ORGANIZATION_NAME='Exchange Development Claim Fixture LLC'
export EXCHANGE_DEV_CLAIM_ORGANIZATION_CITY='Smithfield'
export EXCHANGE_DEV_CLAIM_REVIEW_ACTION='reject'
```

Run:

```bash
npm run test:browser:configured-dev
```

Use `approve` only for a disposable organization intentionally reserved for ownership-transfer acceptance. Rejection is the default because it exercises submission, admin access, review notes, notifications, and a terminal claim decision without transferring ownership.

## 6. Manual GitHub workflow

The workflow **Exchange configured-development smoke** is `workflow_dispatch` only. It never runs automatically on pull requests and therefore cannot block ordinary development.

Configure the `exchange-development` GitHub Environment with these secrets:

- `EXCHANGE_DEV_BASE_URL`
- `EXCHANGE_DEV_TEST_EMAIL`
- `EXCHANGE_DEV_TEST_PASSWORD`
- `EXCHANGE_DEV_ADMIN_EMAIL`
- `EXCHANGE_DEV_ADMIN_PASSWORD`
- `EXCHANGE_DEV_FIREBASE_API_KEY`
- `EXCHANGE_DEV_FIREBASE_AUTH_DOMAIN`
- `EXCHANGE_DEV_FIREBASE_STORAGE_BUCKET`
- `EXCHANGE_DEV_FIREBASE_MESSAGING_SENDER_ID`
- `EXCHANGE_DEV_FIREBASE_APP_ID`
- `EXCHANGE_DEV_MAPBOX_PUBLIC_TOKEN`

The workflow supports an explicit `allow_mutations` input and optional dedicated claim fixture. Failed traces, screenshots, and videos are retained as short-lived artifacts.

## 7. Seed-data acceptance

Run the privacy verifier and importer dry run:

```bash
npm run seed:organizations:verify
npm run seed:organizations:dev:dry
```

The importer performs no write unless `--apply` is supplied. Follow `docs/exchange/isle-of-wight-seed-import.md` for the exact development confirmation command and rollback batch requirements.

## 8. Record the acceptance result

Record all of the following in the release issue or PR:

- canonical commit SHA;
- tested base URL;
- Firebase project ID;
- Function region and deployed callable names;
- ordinary-account profile-save result;
- legacy or dedicated admin profile-save result;
- organization-creation result;
- claim submission and review result;
- notification result;
- Mapbox result;
- browser/project combination;
- imported seed batch ID;
- defects and exact error codes;
- whether mutations were enabled;
- rollback references.

## Development access boundary

A failed configured-development check is evidence that deployment, configuration, account provisioning, or data is incomplete. It must not be “fixed” by allowing direct protected Firestore writes, trusting client roles, bypassing organization authority, disabling profile validation, or making production Functions permissive.

Use emulator mode for isolated development and dedicated valid identities for configured-development acceptance. Preserve the server-authoritative security model.
