# Power NOW confirmation emails

The Power NOW form can send its own confirmation after a submission is saved in Attio. It does not use Attio sequences. Pitch, watch, and contribute each get Step 1 only, in Jessica's wording.

The sender is `hello@accelanalysis.com`. The default provider is Resend. Microsoft Graph remains available when `hello@` is a shared mailbox.

Nothing in this document sets a secret or deploys the function.

## Flag

`POWER_NOW_CONFIRMATION_EMAIL_ENABLED` must be the string `true`. Any other value, including unset, sends nothing. The Attio person, company, list, note, task, and consent log stay as they are without this feature. The HTTP response does not include the submitted email address.

`POWER_NOW_CONFIRMATION_TEST_RECIPIENTS` is an optional allow-list (commas or spaces). When it is set, mail is sent only to those addresses. Everyone else is still saved in Attio and does not receive mail.

## What gets sent

One message per path, right after the Attio write in the same request:

| Path | Subject | Template |
| --- | --- | --- |
| pitch | We got your Power NOW pitch interest | `PN-CONFIRM-PITCH-v1` |
| watch | You're on the Power NOW audience list | `PN-CONFIRM-WATCH-v1` |
| contribute | Thanks for your Power NOW prize pack offer | `PN-CONFIRM-CONTRIB-v1` |

The optional later watch email is not sent.

The HTML uses the hosted lockup at `{POWER_NOW_EMAIL_ASSET_BASE_URL}/power-now/power-now-logo-lockup.jpg` (default base `https://hi-coworking.com`). The message includes a plain-text part. The footer is:

```
This is an automatic confirmation because you submitted the Power NOW form.
Accel Analysis · 15373 Carrollton Blvd, Carrollton, VA 23314 · hello@accelanalysis.com
Reply with 'unsubscribe' to stop Power NOW emails.
```

Resend sends a `List-Unsubscribe` header of `<mailto:hello@accelanalysis.com?subject=unsubscribe>` (or the configured Reply-To). Graph's API only accepts custom `x-` internet headers, so the Graph adapter sends the same mailto value as `x-list-unsubscribe`. Graph's `sendMail` accepts one body, so that adapter sends the HTML. Resend sends HTML and plain text.

A send failure does not fail the submission. The function logs the person record id and an error class, prefixes the follow-up task with `[CONFIRMATION EMAIL FAILED]`, and adds that error class on a Person note. It does not log the email address.

On success it writes a Person note with the subject, the send time in Eastern time, the template version, the sender, the provider message id, and the path. When the flag is on, the submitted address is first in the person's `email_addresses`, which is the primary address, and any other addresses already on the record stay after it.

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `POWER_NOW_CONFIRMATION_EMAIL_ENABLED` | unset (off) | `true` turns sending on |
| `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS` | unset | Allow-list. Unset means no allow-list |
| `POWER_NOW_EMAIL_PROVIDER` | `resend` | `resend` or `graph` |
| `POWER_NOW_SENDER` | `Accel Analysis <hello@accelanalysis.com>` | From header. A bare address is wrapped with the Accel Analysis display name |
| `POWER_NOW_REPLY_TO` | `hello@accelanalysis.com` | Reply-To and the unsubscribe mailto |
| `POWER_NOW_CONFIRMATION_DAILY_CAP` | `100` | Global sends per UTC day. Resend's free plan allows 100 emails a day |
| `POWER_NOW_CONFIRMATION_IP_DAILY_CAP` | `20` | Sends per IP address per rolling 24 hours |
| `POWER_NOW_EMAIL_ASSET_BASE_URL` | `https://hi-coworking.com` | Origin for the lockup image |
| `POWER_NOW_MIN_SUBMIT_MS` | `3000` | Minimum time from page open to submit. Missing or faster skips the email |
| `POWER_NOW_RECAPTCHA_MIN_SCORE` | `0.5` | Minimum reCAPTCHA Enterprise score |
| `RECAPTCHA_ENTERPRISE_SITE_KEY` | unset | Server site key. Missing site key or API key skips the email and still saves the submission |
| `RECAPTCHA_ENTERPRISE_PROJECT` | `hi-coworking-plat` | reCAPTCHA Enterprise project |
| `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` | unset | Public site key baked into the web build. The page loads the Enterprise script only when this is set |

The page sends `pnStartedAt` and `recaptchaToken` with the form. Those fields are not stored on the Attio note.

## Secrets

Bound on `expo_submitNasaLead`. Create each one in Secret Manager before deploying that function. The flag can stay off, but Firebase still requires the secrets to exist because the function declares them. Do not put the values in git, logs, or this doc.

| Secret | Used by |
| --- | --- |
| `RESEND_API_KEY` | Resend `Authorization: Bearer` |
| `M365_TENANT_ID` | Graph client-credentials token |
| `M365_CLIENT_ID` | Graph client-credentials token |
| `M365_CLIENT_SECRET` | Graph client-credentials token |
| `RECAPTCHA_ENTERPRISE_API_KEY` | reCAPTCHA Enterprise assessments |

`ATTIO_API_KEY` is unchanged and still required.

Create a secret without printing it in CI:

```bash
firebase functions:secrets:set RESEND_API_KEY --project hi-coworking-plat
```

Repeat for `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, and `RECAPTCHA_ENTERPRISE_API_KEY`.

The manual workflow **Hi Coworking Firebase expo lead function** checks that these names exist and have an enabled version. It does not print values. That workflow runs only from `main`, and only after this revision is merged. Do not run it from this branch.

## Resend setup (Jonathan)

Resend is the default (`POWER_NOW_EMAIL_PROVIDER` unset or `resend`).

1. Create a Resend account.
2. Add the domain `accelanalysis.com`.
3. In GoDaddy DNS for that domain, add the DKIM TXT record Resend shows, plus the MX and SPF records on the send subdomain Resend shows. Wait until Resend marks the domain verified.
4. Create a sending-only API key. Do not use a full-access key.
5. Store that key as the secret `RESEND_API_KEY`.
6. Leave the From and Reply-To defaults unless a mailbox change is deliberate.

The free plan allows 100 emails a day. `POWER_NOW_CONFIRMATION_DAILY_CAP` defaults to 100 so this function stays inside that plan. Resend's own counter may use a different day boundary than this function's UTC day. Raising the cap above 100 requires a Resend plan that allows it.

The function calls `POST https://api.resend.com/emails` with `Idempotency-Key` set to `pn-confirm:{sha256 of the email}:{path}:{UTC date}`. The raw email is not in the key.

## Microsoft Graph

Set `POWER_NOW_EMAIL_PROVIDER=graph` only if `hello@accelanalysis.com` is a shared mailbox. Graph cannot reliably send from an alias. An alias on Jonathan's mailbox will not work as the From address.

The function uses the client-credentials flow (`M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`) and `POST /users/{sender}/sendMail` with `saveToSentItems: true`. The sender in that path is the mailbox inside `POWER_NOW_SENDER`, defaulting to `hello@accelanalysis.com`. The app registration needs application permission to send as that mailbox, with admin consent.

Grant the key least privilege and store it only in Secret Manager.

## Abuse controls

Checked only when the flag is on. A block skips the email and still returns success for the saved submission. These blocks do not prefix the task. A provider or network failure does.

- Honeypot fields `expo_hp` and `pn_hp` already return a fake success before any Attio write, so they send no mail.
- Submit faster than `POWER_NOW_MIN_SUBMIT_MS`, or omit `pnStartedAt`, and the email is skipped.
- Role local-parts (such as `info`, `admin`, `sales`, `support`, `noreply`) and common disposable domains are rejected. The domain must have an MX record.
- reCAPTCHA Enterprise, score-based, project `hi-coworking-plat`, action `power_now_submit`. Missing site key or API key, a missing token, or a failed score skips the email. A queued offline retry may not send because the token expires. The submission is still saved.
- Firestore suppression collection `powerNowEmailSuppression`, checked before every send.
- Firestore rate limits, not in-memory:
  - at most 1 confirmation per email address per path per rolling 24 hours (`powerNowEmailAddressWindow`)
  - at most `POWER_NOW_CONFIRMATION_IP_DAILY_CAP` (default 20) per IP per rolling 24 hours (`powerNowEmailIpWindow`)
  - at most `POWER_NOW_CONFIRMATION_DAILY_CAP` (default 100) per UTC day (`powerNowEmailDaily`)

Documents store hashes and counters, not the email address or the IP address. Client reads and writes are denied in `firestore.rules`.

To honor an unsubscribe, hash the address and create a document at `powerNowEmailSuppression/{hash}`:

```bash
node -e "const crypto=require('node:crypto'); const email=process.argv[1]; console.log(crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex'))" "person@example.com"
```

Run that locally. Do not paste a real address into a log or a pull request. Then create the Firestore document with the Admin SDK or the console. The document can be empty. Its existence is the suppression.

## Deploy

Do not deploy this from the pull request. After merge, create the five secrets above, set the public reCAPTCHA site key on the web build if mail should send, and leave `POWER_NOW_CONFIRMATION_EMAIL_ENABLED` unset until a deliberate test with `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS`. The manual function workflow deploys only `expo_submitNasaLead`.
