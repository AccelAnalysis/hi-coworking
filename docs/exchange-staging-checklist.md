# Exchange staging checklist

No staging Firebase project ID or Stripe credentials are stored in this repository. Do not substitute the production project.

## Configure a separate Firebase alias

```bash
firebase use --add
# Select the dedicated non-production project and name the alias "staging".
firebase use staging
firebase projects:list
```

Confirm the active project is non-production before every command. Configure the project-scoped Functions environment with `STRIPE_FOUNDING_PRICE_ID`, `STRIPE_FOUNDING_PRODUCT_ID`, `STRIPE_EXPECTED_MODE=test`, and the staging `APP_URL`. Set test secrets with `firebase functions:secrets:set` while the staging alias is active.

## Deploy to staging only

```bash
firebase deploy --project staging --only firestore:rules,firestore:indexes
firebase deploy --project staging --only functions
firebase deploy --project staging --only hosting
```

Import organizations with `--dry-run` first, record counts, then run the same batch ID without `--dry-run`. Configure the Stripe test webhook to the staging `stripe_webhook` URL and subscribe to the events in `docs/stripe-test-setup.md`.

## Manual acceptance evidence

- Registration/login reach organization onboarding.
- Search finds a seeded Isle of Wight organization without exposing home/contact data.
- Claim pending/approve/reject and competing claims behave as documented.
- A created organization begins Free and cannot be managed by an outsider.
- Real Stripe test Checkout shows exactly `$49.00 USD / month` for the intended product.
- Success return remains pending until signed webhook processing.
- Subscription activation allocates one founder number; paid invoice grants one 25-credit lot; replay changes neither count.
- Expired checkout releases its reservation; the 251st slot is rejected.

Record project ID, deployment commit, Stripe test price/product IDs (never secret keys), test event IDs, screenshots, timestamps, and cleanup actions in the PR.
