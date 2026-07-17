# Exchange Week 1 rollback

The data model is additive. Rollback application behavior without deleting audit or billing history.

1. Disable campaign links and Exchange onboarding entry points.
2. Redeploy the last known-good Functions/hosting commit to the staging alias.
3. Remove the Stripe test webhook endpoint or disable its event delivery.
4. Do not delete `organizationMemberships`, founder allocation/reservations, subscription events, payments, credit lots/ledger, claims, or `exchangeAudit` records.
5. If an import batch is incorrect, identify documents by `importBatchId`; review claimed/edited organizations before any compensating mutation. Never bulk-delete claimed records.
6. Reconcile founder counts, reservations, Stripe subscriptions, and invoice credit lots before retrying deployment.

For a staging rollback, check out or build the recorded last-known-good commit and target the explicit project ID on every command:

```bash
git switch --detach <last-known-good-commit>
npm ci
npm run build:shared
npm run build:functions
npm run build
firebase deploy --project <staging-project-id> --only firestore:rules,firestore:indexes
firebase deploy --project <staging-project-id> --only functions
firebase deploy --project <staging-project-id> --only hosting
```

Disable the Stripe **test-mode** webhook endpoint before rolling back Functions when its event contract is incompatible. Do not delete audit, membership, founder, payment, claim, or credit records as part of rollback.

Production rollback is out of scope because this acceptance run does not authorize or perform a production deployment.
