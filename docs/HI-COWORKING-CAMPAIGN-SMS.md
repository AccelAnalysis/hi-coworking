# Campaign sender: events_processCampaignJobs

`events_processCampaignJobs` sends event-marketing campaign jobs
(`campaignJobs/{jobId}`) by email (Resend), SMS (Twilio), push (FCM) and
in-app notification. It deploys from its own isolated source,
`firebase/campaign-functions`, with `firebase.campaign.json`.

## Why a separate bundle

The main source (`apps/functions`) also loads `eventMarketing.ts`, which
declares `LINKEDIN_*` and `X_*` secrets. The Firebase CLI resolves every
secret declared in the source it analyzes, even with `--only`, so a deploy from
`firebase.json` fails until those exist. The processor now lives in
`apps/functions/src/campaignJobs.ts`; the campaign bundle imports only that
module. `eventMarketing.ts` re-exports it, so the main source is unchanged.

Secrets bound to the function (names only):

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- `HI_COWORKING_RESEND_API_KEY` (campaign email)

## Trigger

Scheduled: `*/5 * * * *`, time zone `America/New_York` (Cloud Scheduler).
Deploying creates the Scheduler job; nothing runs at deploy time. The first run
is the next five-minute boundary after the deploy finishes.

Each run reads `campaignJobs` where `status == "pending"` (equality only, so no
composite index is needed), keeps the jobs whose `scheduledFor` is due, oldest
first, and processes up to 25.

Jobs are created only by `events_enqueueCampaignJobs` (the Admin campaigns
page) or by an admin writing `campaignJobs` directly. The enqueue callable is
in the main source and is not part of this bundle.

## SMS switch: HI_COWORKING_SMS_ENABLED (default false)

No campaign text is sent unless `HI_COWORKING_SMS_ENABLED` is exactly `true`.
It is a non-secret param. `firebase/campaign-functions/.env.hi-coworking-plat`
sets it to `false`, so a non-interactive deploy never prompts and never turns
SMS on. Keep it `false` until the Twilio A2P 10DLC campaign is approved.

While it is `false`:

- No Twilio client is created.
- Email, push and in-app still go out for due jobs.
- A job whose campaign includes `sms` ends in status `sms_held` (not `sent`,
  not `failed`) with `smsHeldAt` and `smsHeldReason: "sms-disabled"`. The same
  happens with `sms-provider-unconfigured` if SMS is on but a Twilio secret is
  empty.
- Held jobs are not re-read while SMS is off, so they never block the pending
  queue.

When it is `true` (and Twilio is configured), each run also picks up to 25
`sms_held` jobs, claims each one (`processing_sms`), and sends only the SMS leg
(email, push and in-app are not repeated). Recipients and SMS consent are
re-read at that moment, so later opt-outs are honored. A held text that would
now be late is expired instead (`status: "sent"`, `smsOutcome: "expired"`):

- announce, reminder: only before the event starts
- starting_soon: only within 1 hour of its slot, and before the start
- follow_up (or no event start): only within 72 hours of its slot

Only recipients with a recorded opt-in (`users/{uid}.smsConsent`) are texted,
and every body carries the sender name and STOP footer (see
`providers/smsCompliance.ts`).

The switch does not gate email. Campaign email goes out for any due job whose
campaign includes `email`.

### Turning SMS on (after A2P approval)

1. Set `HI_COWORKING_SMS_ENABLED=true` in
   `firebase/campaign-functions/.env.hi-coworking-plat` in a PR.
2. After merge, redeploy with the command below.

To turn it off again, set it back to `false` and redeploy.

## Deploy

From a clean checkout of `main`:

```bash
npm ci
npx firebase deploy --config firebase.campaign.json --project hi-coworking-plat --only functions:events_processCampaignJobs --non-interactive
```

`firebase.campaign.json` builds the bundle in its predeploy step. Always pass
the `--only` filter: the bundle deploys into the default codebase, so a deploy
without it would offer to delete every other default function. Never pass
`--force`.

## Rollback

```bash
npx firebase functions:delete events_processCampaignJobs --region us-central1 --project hi-coworking-plat
```

Deleting the function removes its Scheduler job. Queued `campaignJobs` stay in
Firestore untouched.
