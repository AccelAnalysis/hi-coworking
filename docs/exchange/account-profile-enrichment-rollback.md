# Account, profile, and enrichment rollback

Target project: `hi-coworking-plat` only. Target region: `us-central1` only.

## Pre-deployment state

On 2026-07-21, none of the initial deployment targets existed:

- `account_initialize` — absent;
- `profile_update` — absent;
- `enrichment_search` — absent;
- `enrichment_link` — absent.

`authBeforeCreate` existed at Cloud Run revision `authbeforecreate-00001-bak` with 100% traffic and is deliberately excluded from the initial deployment. Firestore rules, indexes, Storage rules, Hosting, Stripe, seed data, and Microsoft integrations are also excluded.

## Exact rollback

Because all four target Functions are new, rollback is deletion rather than traffic reversal:

```sh
firebase functions:delete account_initialize profile_update enrichment_search enrichment_link \
  --region us-central1 \
  --project hi-coworking-plat \
  --force
```

Verify deletion:

```sh
firebase functions:list --project hi-coworking-plat
```

Then restore the prior Hosting/source revision through the normal PR workflow if a frontend using these Functions was deployed. Do not delete Auth users or Firestore profile/user documents as a blanket rollback. A single synthetic acceptance identity may be deleted only after its exact UID is resolved and its dedicated documents are enumerated.

If a later, separately approved deployment updates `authBeforeCreate`, preserve its then-current revision before deployment. The pre-run reference revision is:

```sh
gcloud run services update-traffic authbeforecreate \
  --region us-central1 \
  --project hi-coworking-plat \
  --to-revisions authbeforecreate-00001-bak=100
```
