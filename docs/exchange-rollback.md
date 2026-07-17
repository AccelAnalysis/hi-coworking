# Exchange Week 1 rollback

The data model is additive. Rollback application behavior without deleting audit or billing history.

1. Disable campaign links and Exchange onboarding entry points.
2. Redeploy the last known-good Functions/hosting commit to the staging alias.
3. Remove the Stripe test webhook endpoint or disable its event delivery.
4. Do not delete `organizationMemberships`, founder allocation/reservations, subscription events, payments, credit lots/ledger, claims, or `exchangeAudit` records.
5. If an import batch is incorrect, identify documents by `importBatchId`; review claimed/edited organizations before any compensating mutation. Never bulk-delete claimed records.
6. Reconcile founder counts, reservations, Stripe subscriptions, and invoice credit lots before retrying deployment.

Production rollback is out of scope because this acceptance run does not authorize or perform a production deployment.
