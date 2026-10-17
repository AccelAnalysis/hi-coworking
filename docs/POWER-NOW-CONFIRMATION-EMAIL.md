# Power NOW confirmation emails

The Power NOW form can send its own confirmation after a submission is saved in Attio. It does not use Attio sequences. Pitch, watch, and contribute each get Step 1 only, in Jessica's wording.

The sender is `hello@accelanalysis.com`. The default provider is Resend. The Graph adapter remains in the code for a later switch, and its secrets are not bound on the function.

Nothing in this document sets a secret or deploys the function.

## Flag

`POWER_NOW_CONFIRMATION_EMAIL_ENABLED` must be the string `true`. Any other value, including empty or unset, sends nothing. The Attio person, company, list, note, task, and consent log stay as they are without this feature. The HTTP response does not include the submitted email address.

`POWER_NOW_CONFIRMATION_TEST_RECIPIENTS` is the allow-list (commas or spaces). When it is set, mail is sent only to those addresses. Everyone else is still saved in Attio and does not receive mail. The deployed value is `jholman@accelanalysis.com` only. An empty value means no allow-list, so do not clear it while the flag is true: that would email every address that passes the other checks.

## Temporary flag-on test

`firebase/expo-lead-functions/.env.hi-coworking-plat` is the env the isolated `expo_submitNasaLead` deploy reads. It currently sets:

```
POWER_NOW_CONFIRMATION_EMAIL_ENABLED=true
POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=jholman@accelanalysis.com
```

That is the inbox test, not the steady setting. With those two values, confirmation mail goes only to `jholman@accelanalysis.com` (the same mailbox as `JHolman@AccelAnalysis.com`). Any other submitter is still saved in Attio and gets no email. The emulator files under `apps/functions/` stay blank, so local emulators do not send.

Revert this flag, or follow this change with a flag-off pull request, after the inbox test. Do not leave `POWER_NOW_CONFIRMATION_EMAIL_ENABLED=true` in place.

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

Exact names. Function params are declared in `apps/functions/src/expo/powerNowConfirmation.ts`. The two values that this repo sets are the same in both dotenv files:

- `apps/functions/.env.hi-coworking-plat` for project `hi-coworking-plat`
- `apps/functions/.env.demo-hi-coworking` for the functions emulator (`demo-hi-coworking`)

```
POWER_NOW_CONFIRMATION_EMAIL_ENABLED=
POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=jholman@accelanalysis.com
```

`POWER_NOW_CONFIRMATION_EMAIL_ENABLED` is blank. That is off. The blank line is present so the emulator and a non-interactive deploy do not ask for a value. `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS` is Jonathan's address and no one else.

| Name | Where | Value in this repo | Purpose |
| --- | --- | --- | --- |
| `POWER_NOW_CONFIRMATION_EMAIL_ENABLED` | `apps/functions/.env.hi-coworking-plat` | empty (off) | `true` turns sending on |
| `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS` | `apps/functions/.env.hi-coworking-plat` | `jholman@accelanalysis.com` | Allow-list. The flag-on test sends only here |
| `POWER_NOW_EMAIL_PROVIDER` | function env, optional | unset, code default `resend` | `resend` or `graph` |
| `POWER_NOW_SENDER` | function env, optional | unset, code default `Accel Analysis <hello@accelanalysis.com>` | From header. A bare address is wrapped with the Accel Analysis display name |
| `POWER_NOW_REPLY_TO` | function env, optional | unset, code default `hello@accelanalysis.com` | Reply-To and the unsubscribe mailto |
| `POWER_NOW_CONFIRMATION_DAILY_CAP` | function env, optional | unset, code default `100` | Global sends per UTC day. Resend's free plan allows 100 emails a day |
| `POWER_NOW_CONFIRMATION_IP_DAILY_CAP` | function env, optional | unset, code default `20` | Sends per IP address per rolling 24 hours |
| `POWER_NOW_EMAIL_ASSET_BASE_URL` | function env, optional | unset, code default `https://hi-coworking.com` | Origin for the lockup image |
| `POWER_NOW_MIN_SUBMIT_MS` | function env, optional | unset, code default `3000` | Minimum time from page open to submit. Missing or faster skips the email |
| `POWER_NOW_RECAPTCHA_MIN_SCORE` | function env, optional | unset, code default `0.5` | Minimum reCAPTCHA Enterprise score |
| `RECAPTCHA_ENTERPRISE_SITE_KEY` | `firebase/expo-lead-functions/.env.hi-coworking-plat` and the function param default | `6LcAvvMtAAAAAOAmm8Z-yA83L0B_EmU7kIaq6rDX` | Public site key. Not a secret. The console key must allow `forms.accelanalysis.com` and `hi-coworking.com` |
| `RECAPTCHA_ENTERPRISE_PROJECT` | function env, optional | unset, code default `hi-coworking-plat` | reCAPTCHA Enterprise project |
| `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` | `apps/web/.env.production` and `apps/web/next.config.ts` | same public site key | Baked into the forms web build. The page loads the Enterprise script only when this is set |
| `RESEND_API_KEY` | Secret Manager, optional at deploy | not in git. Owner supplies it | Resend `Authorization: Bearer`. Missing key skips the email and logs a warning |
| `RECAPTCHA_ENTERPRISE_API_KEY` | Secret Manager, optional at deploy | not in git. Owner supplies it | reCAPTCHA Enterprise assessments. Missing key skips the email and does not treat reCAPTCHA as passed |

The page sends `pnStartedAt` and `recaptchaToken` with the form. Those fields are not stored on the Attio note.

## Secrets

`RESEND_API_KEY` and `RECAPTCHA_ENTERPRISE_API_KEY` are not `defineSecret` bindings. The isolated deploy (`firebase.expo-lead.json`, entry `firebase/expo-lead-functions`) still requires only `ATTIO_API_KEY`. A missing Resend or reCAPTCHA secret does not block deploy. At runtime the function reads each one from the environment, then from Secret Manager as `217107644706-compute@developer.gserviceaccount.com`. That service account needs Secret Accessor on the secret. If the secret is missing or unreadable, the function logs a warning with the Secret Manager status and skips the confirmation email. It does not treat reCAPTCHA as passed. Origin checks, the honeypot, and rate limits still run. Do not put secret values in git, logs, or this doc.

| Secret | Required for this deploy | Used by |
| --- | --- | --- |
| `RESEND_API_KEY` | no | Resend `Authorization: Bearer` |
| `RECAPTCHA_ENTERPRISE_API_KEY` | no | reCAPTCHA Enterprise assessments |
| `M365_TENANT_ID` | no | Graph client-credentials token, only after a later switch |
| `M365_CLIENT_ID` | no | Graph client-credentials token, only after a later switch |
| `M365_CLIENT_SECRET` | no | Graph client-credentials token, only after a later switch |

`ATTIO_API_KEY` is unchanged and still required.

Create a secret without printing it in CI:

```bash
firebase functions:secrets:set RESEND_API_KEY --project hi-coworking-plat
firebase functions:secrets:set RECAPTCHA_ENTERPRISE_API_KEY --project hi-coworking-plat
```

Grant Secret Accessor on each secret to `217107644706-compute@developer.gserviceaccount.com`.

Do not create the M365 secrets for the Resend deploy. They are optional and only for a later Graph switch.

The manual workflow **Hi Coworking Firebase expo lead function** deploys with `--config firebase.expo-lead.json` and `--only functions:expo_submitNasaLead`. It warns if `RESEND_API_KEY` or `RECAPTCHA_ENTERPRISE_API_KEY` is missing and continues. It does not check the M365 secrets and it does not print values. That workflow runs only from `main`, and only after this revision is merged. Do not run it from this branch.

## Jonathan checklist

Do these in order. This pull request does not set secrets, does not turn the flag on, and does not deploy.

Resend is the default (`POWER_NOW_EMAIL_PROVIDER` unset or `resend`).

### 1. Resend DNS

1. Create a Resend account.
2. Add the domain `accelanalysis.com`.
3. In GoDaddy DNS for `accelanalysis.com`, add the records Resend shows:
   - the DKIM TXT record
   - the MX record on the send subdomain
   - the SPF TXT record on the send subdomain
4. Wait until Resend marks `accelanalysis.com` verified.
5. Leave the From and Reply-To defaults unless a mailbox change is deliberate. From is `Accel Analysis <hello@accelanalysis.com>`. Reply-To is `hello@accelanalysis.com`.

The free plan allows 100 emails a day. `POWER_NOW_CONFIRMATION_DAILY_CAP` defaults to 100 so this function stays inside that plan. Resend's own counter may use a different day boundary than this function's UTC day. Raising the cap above 100 requires a Resend plan that allows it.

The function calls `POST https://api.resend.com/emails` with `Idempotency-Key` set to `pn-confirm:{sha256 of the email}:{path}:{UTC date}`. The raw email is not in the key.

### 2. Keys

Create these yourself. Do not put the values in git, a pull request, or a log.

1. In Resend, create a sending-only API key. Do not use a full-access key.
2. Store it as Secret Manager secret `RESEND_API_KEY` on project `hi-coworking-plat`.
3. Store the reCAPTCHA Enterprise API key as Secret Manager secret `RECAPTCHA_ENTERPRISE_API_KEY` on the same project. The site keys are not secrets. See the next section.

```bash
firebase functions:secrets:set RESEND_API_KEY --project hi-coworking-plat
firebase functions:secrets:set RECAPTCHA_ENTERPRISE_API_KEY --project hi-coworking-plat
```

`ATTIO_API_KEY` is already required and is unchanged. Do not create `M365_TENANT_ID`, `M365_CLIENT_ID`, or `M365_CLIENT_SECRET` for this Resend deploy.

### 3. reCAPTCHA Enterprise

The score-based site key is already in this repo: `6LcAvvMtAAAAAOAmm8Z-yA83L0B_EmU7kIaq6rDX`. It is public. It is set as `RECAPTCHA_ENTERPRISE_SITE_KEY` for `expo_submitNasaLead` and as `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` for the forms web build.

Before merging, confirm in the reCAPTCHA Enterprise console for project `hi-coworking-plat` that this key's domain list includes both `forms.accelanalysis.com` and `hi-coworking.com`. Add `www.hi-coworking.com` as well if that host will submit. The function accepts an assessment only when the hostname is one of those three. A token from any other host skips the email.

1. The assessment action is `power_now_submit`. The minimum score stays `POWER_NOW_RECAPTCHA_MIN_SCORE=0.5` unless a real submission scores lower.
2. Confirm `RECAPTCHA_ENTERPRISE_API_KEY` exists in Secret Manager and that `217107644706-compute@developer.gserviceaccount.com` has Secret Accessor on it. The site key is not a secret.
3. Leave `RECAPTCHA_ENTERPRISE_PROJECT` unset so it stays `hi-coworking-plat`, unless the key lives in another project.

A missing API key, a missing token, a hostname outside the list above, or a score under `0.5` skips the email and still saves the submission. reCAPTCHA is not treated as passed. The page loads the Enterprise script because `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` is set for the forms build.

### 4. Flag-on test to jholman@ only

`apps/functions/.env.hi-coworking-plat` already wires the allow-list and leaves the flag off:

```
POWER_NOW_CONFIRMATION_EMAIL_ENABLED=
POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=jholman@accelanalysis.com
```

After DNS is verified, both secrets exist, both site-key env vars are set, and you have deployed `expo_submitNasaLead` plus a web build that includes the public site key:

1. Keep `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS` set to exactly `jholman@accelanalysis.com`. Do not add another address. This is the same mailbox as `JHolman@AccelAnalysis.com`.
2. Set `POWER_NOW_CONFIRMATION_EMAIL_ENABLED` to the string `true` and redeploy `expo_submitNasaLead`.
3. Open the Power NOW form, wait at least 3 seconds, and submit one path as `jholman@accelanalysis.com`.
4. Confirm that inbox receives the Step 1 message for that path. Submit again as any other address and confirm Attio still saves it and no confirmation mail is sent.
5. Set `POWER_NOW_CONFIRMATION_EMAIL_ENABLED` back to empty and redeploy. Leave `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=jholman@accelanalysis.com` in place until a later decision to write to other people. Clearing the allow-list sends to every address that passes the other checks.

## Microsoft Graph

The Graph adapter stays in the code. It is not on the deploy path. `expo_submitNasaLead` does not bind `M365_TENANT_ID`, `M365_CLIENT_ID`, or `M365_CLIENT_SECRET`.

Set `POWER_NOW_EMAIL_PROVIDER=graph` only if `hello@accelanalysis.com` is a shared mailbox. Graph cannot reliably send from an alias. An alias on Jonathan's mailbox will not work as the From address.

Before Graph can send, add those three secrets back to the function binding by listing them next to `POWER_NOW_OPTIONAL_SECRETS`, create them in Secret Manager, and deploy `expo_submitNasaLead` again. The adapter then uses the client-credentials flow and `POST /users/{sender}/sendMail` with `saveToSentItems: true`. The sender in that path is the mailbox inside `POWER_NOW_SENDER`, defaulting to `hello@accelanalysis.com`. The app registration needs application permission to send as that mailbox, with admin consent.

If `POWER_NOW_EMAIL_PROVIDER=graph` and any of those three values is missing, the function skips the send the same way it does when `RESEND_API_KEY` is missing. It logs the person record id and `ProviderUnconfigured`, prefixes the follow-up task with `[CONFIRMATION EMAIL FAILED]`, and still saves the submission.

Grant any Graph key least privilege and store it only in Secret Manager.

## Abuse controls

Checked only when the flag is on. A block skips the email and still returns success for the saved submission. These blocks do not prefix the task. A provider or network failure does, including a missing Resend key or a Graph selection whose M365 values are not configured.

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

Do not deploy this from a pull request branch. The isolated expo-lead env currently sets `POWER_NOW_CONFIRMATION_EMAIL_ENABLED=true` for the jholman inbox test, with `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS=jholman@accelanalysis.com`. That test step must be reverted, or followed by a flag-off change, after the inbox check. Before merging, confirm the reCAPTCHA key lists `forms.accelanalysis.com` and `hi-coworking.com`. `RESEND_API_KEY` can be created after merge; until it exists the function deploys and skips confirmation email. The manual function workflow deploys only `expo_submitNasaLead` with `--config firebase.expo-lead.json`.
