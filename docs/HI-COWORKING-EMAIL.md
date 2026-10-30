# Hi Coworking outbound email (Resend)

All outbound app email goes through Resend from `hello@hi-coworking.com`.
Inbound mail for the domain stays on Microsoft 365; Resend only sends.

Every message carries `Reply-To: hicoworking@accelanalysis.com`, the monitored
inbox. `hello@hi-coworking.com` is a sending address only: it has no tested
inbox yet, so email copy never asks people to write to it. Copy that says
"reply to this email or write to us" names `hicoworking@accelanalysis.com`.

The client is `apps/functions/src/providers/emailProvider.ts`
(`ResendEmailProvider`). It calls the Resend REST API with `fetch`, so there is
no SDK dependency.

## Who sends

| Function | Mail | Resend call |
| --- | --- | --- |
| `nurture_process` (every 15 min) | Nurture campaign steps | `POST /emails`, tags `hi-coworking-nurture` + stage, idempotency key `nurture/<deliveryId>/<payload hash>` |
| `events_v2ProcessNotificationJobs` (every 5 min) | Event confirmations, reminders, waitlist, cancellations, refunds | `POST /emails`, tag `event-transactional`, idempotency key `event-notification/<jobId>/<payload hash>` |
| `events_processCampaignJobs` | Event marketing campaign email | `POST /emails/batch` in chunks of 100, one rendered copy per recipient |
| `stripe_webhook` (core bundle) | Membership welcome email on `checkout.session.completed` with `purpose=membership` | `POST /emails`, tags `membership_welcome` + `transactional`, idempotency key `membership-welcome/<checkoutSessionId>/<payload hash>` |
| `stripe_webhook` (core bundle) | Membership refund confirmation (`charge.refunded`, `refund.updated`), cancellation scheduled (`customer.subscription.updated` with a cancel date), membership ended (`customer.subscription.deleted`) | `POST /emails`, tags `refund_confirmation` / `membership_cancellation_scheduled` / `membership_ended` + `transactional`, idempotency key `<tag>/<sentEmails key>` |

The Power NOW confirmation sent by `expo_submitNasaLead` is separate. It has
its own Resend client in `apps/functions/src/expo/powerNowConfirmation.ts`,
reads `RESEND_API_KEY`, and sends from accelanalysis.com. See
[POWER-NOW-CONFIRMATION-EMAIL.md](./POWER-NOW-CONFIRMATION-EMAIL.md).

## Secret and settings

| Name | Kind | Where | Required |
| --- | --- | --- | --- |
| `HI_COWORKING_RESEND_API_KEY` | Secret Manager secret, bound with `defineSecret` in `providers/emailSecret.ts` | `firebase functions:secrets:set HI_COWORKING_RESEND_API_KEY --project hi-coworking-plat` | Yes |
| `HI_COWORKING_EMAIL_FROM` | Env var | `apps/functions/.env.hi-coworking-plat` | No. Default `Hi Coworking <hello@hi-coworking.com>`. A bare address gets the "Hi Coworking" display name. |
| `HI_COWORKING_EMAIL_REPLY_TO` | Env var | `apps/functions/.env.hi-coworking-plat` | No. Default `hicoworking@accelanalysis.com` (`DEFAULT_EMAIL_REPLY_TO`). A message that sets its own `replyTo` wins over both. |

Never put the key in git, an `.env` file, or a workflow. The repository is public.

The key is deliberately not `RESEND_API_KEY`: that name already holds the
Power NOW key for accelanalysis.com, and a key restricted to hi-coworking.com
under the same name would break those confirmations.

### Create the key

1. Resend dashboard → **API Keys** → **Create API Key**.
2. Name it, for example, `hi-coworking-plat functions`.
3. Permission: **Sending access**. Domain: **hi-coworking.com**.
4. Copy the key once, run the `secrets:set` command above, and paste it at the prompt.
5. Redeploy the mail workers so they bind the new secret version (see **Deploy** below).

## Deploy

Deploy the mail workers from the isolated source in `firebase/mail-functions`,
not from `apps/functions`. The main source also loads `eventMarketing.ts`,
which declares `TWILIO_*`, `LINKEDIN_*` and `X_*` secrets. The Firebase CLI
asks for every secret declared in the source it analyzes, even with `--only`,
so a deploy from `apps/functions` fails with "no value for the secret:
TWILIO_ACCOUNT_SID" until Twilio is set up. The isolated source declares only
`HI_COWORKING_RESEND_API_KEY`.

From a clean checkout of `main`:

```bash
npm ci
npx firebase deploy --config firebase.mail.json --project hi-coworking-plat \
  --only functions:nurture_process,functions:events_v2ProcessNotificationJobs --non-interactive
```

`firebase.mail.json` builds the bundle in its predeploy step. Always pass the
`--only` filter: the bundle deploys into the default codebase, so a deploy
without it would offer to delete every other default function (the CLI refuses
that in non-interactive mode without `--force`; never pass `--force`).

The manual GitHub workflow **Hi Coworking Firebase mail functions** runs the
same deploy from `main` after you type `deploy mail functions`. It never runs on
push or merge.

`stripe_webhook` is not in this bundle either. It deploys from the core
bundle (`firebase.core.json`), which binds `HI_COWORKING_RESEND_API_KEY` for
the membership welcome email:

```bash
npx firebase deploy --config firebase.core.json --project hi-coworking-plat \
  --only functions:stripe_webhook --non-interactive
```

The welcome email is transactional: it ignores the marketing opt-out and has no
unsubscribe link. It sends at most once per Checkout session, tracked in
`sentEmails/<checkoutSessionId>` (status `sending`, `sent`, or `failed`). A send
failure is logged and recorded but never fails the webhook or the membership
activation; a later redelivery of the same event retries the send.

### Refund and cancellation notices

`stripe_webhook` also sends three transactional member notices
(`apps/functions/src/payments/memberNoticeEmails.ts`), each at most once:

| Notice | Trigger | `sentEmails` key | Skipped when |
| --- | --- | --- | --- |
| Refund confirmation | A succeeded or pending refund on a membership charge (`charge.refunded`, `refund.updated`), up to 30 days old | `refund_<refundId>` | Not a membership payment |
| Cancellation scheduled ("active until {date}") | `customer.subscription.updated` that the membership handler applied with a cancel date | `cancel_scheduled_<subscriptionId>_<cancelAtMs>` | Comp membership (`membershipSource: "comp"`), or a different subscription than the one on file |
| Membership ended | `customer.subscription.deleted` that set `membershipStatus: "cancelled"` | `membership_ended_<subscriptionId>` | Comp membership, membership still active, or a different subscription |

Refunds also update `payments/<id>` (`refunded` or `partially_refunded`,
`amountRefunded`, `refundedAt`, `stripeRefundIds`), set `users/<uid>.lastRefund`
for SayHi, and write a `notifications/refund_<refundId>` doc (type `payment`).
A refund never changes the membership itself; cancelling the subscription does.

The live webhook endpoint must subscribe to `charge.refunded`,
`refund.updated` and `refund.failed` for the refund notices to work.

`events_processCampaignJobs` is not in this bundle. It binds the Twilio
secrets, so it deploys from its own bundle, `firebase/campaign-functions`
(see `HI-COWORKING-CAMPAIGN-SMS.md`).

### Rolling out a Reply-To or sender change

The Reply-To default lives in `providers/emailProvider.ts`, which each mail
function bundles at deploy time. A change takes effect only after every
sending function is redeployed:

| Function | Bundle | Deploy |
| --- | --- | --- |
| `nurture_process`, `events_v2ProcessNotificationJobs` | `firebase.mail.json` | Manual: the mail workflow or the `firebase.mail.json` command above |
| `events_processCampaignJobs` | `firebase.campaign.json` | Manual: `npx firebase deploy --config firebase.campaign.json --project hi-coworking-plat --only functions:events_processCampaignJobs --non-interactive` |
| `stripe_webhook` (membership welcome) | `firebase.core.json` | Manual: the core workflow or the `firebase.core.json` command above |

A push to `main` that touches `emailProvider.ts` also redeploys the admin
event bundle automatically, but none of its functions send email.

### Stale event notifications

`events_v2ProcessNotificationJobs` expires, instead of sending, any reminder
whose event has already started and any registration confirmation or waitlist
notice whose event has already ended (status `expired`). Jobs queue up while
the worker is not deployed, so the first run after a deploy would otherwise
send reminders for past events. Follow-ups, cancellations and refund notices
still send late.

## Errors and logging

A rejected send throws `EmailSendError` with the HTTP status, Resend's error
code (for example `validation_error`), and a `retryable` flag (429, 5xx,
timeouts and network errors). Logs carry only the status, code, message id,
tag names and batch size. They never carry the key, recipient addresses, or
Resend's error message text, which can echo addresses. Requests time out after
10 seconds.

The callers keep their existing retry behavior: nurture backs off and marks
the enrollment failed after repeated errors, and event notification jobs retry
up to 3 times.

## Quota

Resend's free plan allows 100 emails a day and 3,000 a month, shared by every
domain on the account (including Power NOW). Check the plan before sending an
event campaign to a large list.

## One-time cleanup after the switch

Once Resend sends are verified in production, the old provider's secret can be
removed: `firebase functions:secrets:destroy SENDGRID_API_KEY --project hi-coworking-plat`,
then revoke the key and close the SendGrid account.
