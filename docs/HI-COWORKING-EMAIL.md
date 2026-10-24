# Hi Coworking outbound email (Resend)

All outbound app email goes through Resend from `hello@hi-coworking.com`.
Inbound mail for the domain stays on Microsoft 365; Resend only sends.

The client is `apps/functions/src/providers/emailProvider.ts`
(`ResendEmailProvider`). It calls the Resend REST API with `fetch`, so there is
no SDK dependency.

## Who sends

| Function | Mail | Resend call |
| --- | --- | --- |
| `nurture_process` (every 15 min) | Nurture campaign steps | `POST /emails`, tags `hi-coworking-nurture` + stage, idempotency key `nurture/<deliveryId>/<payload hash>` |
| `events_v2ProcessNotificationJobs` (every 5 min) | Event confirmations, reminders, waitlist, cancellations, refunds | `POST /emails`, tag `event-transactional`, idempotency key `event-notification/<jobId>/<payload hash>` |
| `events_processCampaignJobs` | Event marketing campaign email | `POST /emails/batch` in chunks of 100, one rendered copy per recipient |

The Power NOW confirmation sent by `expo_submitNasaLead` is separate. It has
its own Resend client in `apps/functions/src/expo/powerNowConfirmation.ts`,
reads `RESEND_API_KEY`, and sends from accelanalysis.com. See
[POWER-NOW-CONFIRMATION-EMAIL.md](./POWER-NOW-CONFIRMATION-EMAIL.md).

## Secret and settings

| Name | Kind | Where | Required |
| --- | --- | --- | --- |
| `HI_COWORKING_RESEND_API_KEY` | Secret Manager secret, bound with `defineSecret` in `providers/emailSecret.ts` | `firebase functions:secrets:set HI_COWORKING_RESEND_API_KEY --project hi-coworking-plat` | Yes |
| `HI_COWORKING_EMAIL_FROM` | Env var | `apps/functions/.env.hi-coworking-plat` | No. Default `Hi Coworking <hello@hi-coworking.com>`. A bare address gets the "Hi Coworking" display name. |
| `HI_COWORKING_EMAIL_REPLY_TO` | Env var | `apps/functions/.env.hi-coworking-plat` | No. Unset by default, so replies go to the sender. |

Never put the key in git, an `.env` file, or a workflow. The repository is public.

The key is deliberately not `RESEND_API_KEY`: that name already holds the
Power NOW key for accelanalysis.com, and a key restricted to hi-coworking.com
under the same name would break those confirmations.

### Create the key

1. Resend dashboard → **API Keys** → **Create API Key**.
2. Name it, for example, `hi-coworking-plat functions`.
3. Permission: **Sending access**. Domain: **hi-coworking.com**.
4. Copy the key once, run the `secrets:set` command above, and paste it at the prompt.
5. Redeploy the three functions above so they bind the new secret version.

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
