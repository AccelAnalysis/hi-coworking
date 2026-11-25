# Accel Analysis lead intake

Shared lead form for Accel Analysis. The page is Accel-branded. It does not show an event name. Visitors enter a lead on a phone, iPad, or laptop. The page saves the lead in Firestore collection `intakeLeads`. It does not record audio or any kiosk voice path.

Public page: `/intake`

NASA Expo alias: `/expo/nasa-2026` redirects to `/intake?event=nasa-expo-2026-10-20`. Existing QR codes keep working. The event slug is not rendered.

Ingest: `POST /api/expo/nasa-lead` (Firebase Hosting rewrite to the `expo_submitNasaLead` Cloud Function)

That one function is also the Power NOW Pitch, Watch, and Contribute ingest. Those pages post `form: "power-now"` to the same URL. There is no second function to deploy.

## Firestore

Accepted leads are written to `intakeLeads` in project `hi-coworking-plat`. The document id is `clientSubmissionId`, so an iPad retry does not create a second row. The document keeps the fields, consent (opt-in, wording version, wording, Eastern timestamp, source), event, interests, and `submittedAt`.

Clients cannot read or write `intakeLeads`. `firestore.rules` denies both. The function uses the Admin SDK, which does not consult those rules, so Jonathan does not deploy rules before the booth. A collection with no allow rule is already closed to the public.

Power NOW confirmation mail sends only when `POWER_NOW_CONFIRMATION_EMAIL_ENABLED` is `true`, and only to `POWER_NOW_CONFIRMATION_TEST_RECIPIENTS` when that allow-list is set.

## Export

From a machine signed in to `hi-coworking-plat`:

```bash
gcloud auth application-default login
node scripts/export-intake-leads.mjs --out intake-leads.csv
```

The CSV has one row per lead, including consent version and timestamp columns, and it contains personal data. Do not commit it. The command prints the count, not the rows.

## What Jonathan runs

Hosting updates itself after this merges to `main`. That does not update Cloud Functions. Rules do not need a deploy. One workflow updates the function that serves the booth and Power NOW.

1. Merge this pull request into `main`.
2. In GitHub, open Actions → **Hi Coworking Firebase expo lead function**.
3. Click **Run workflow**. Choose branch **main**.
4. In the confirmation box, type exactly `deploy expo_submitNasaLead`.
5. Run it and wait until the job is green. The OPTIONS check does not write a lead.
6. On the booth iPad, open `https://hi-coworking.com/expo/nasa-2026`. If a blue **Send now** button is showing, tap it. That flushes leads already queued on the iPad. A reload also tries, after a short wait; **Send now** does not wait.

Do not run a second function workflow. Do not deploy Firestore rules for this.

### After the workflow is green

Booth: open `https://hi-coworking.com/intake?event=nasa-expo-2026-10-20`, submit a fake name with an `example.com` email or a 555 phone number, and confirm the screen says **Thanks, we've got it**. Then run the export and find that `clientSubmissionId` with `kind` `expo`.

Power NOW Pitch: open `https://forms.accelanalysis.com/power-now/pitch`, submit a fake pitch, and confirm the thanks screen. Export should show `kind` `power-now` and `path` `pitch`.

Power NOW Contribute: open `https://forms.accelanalysis.com/power-now/contribute` and do the same. Export should show `path` `contribute`.

Watch uses the same function: `https://forms.accelanalysis.com/power-now/watch`.

Event context is read from `event`, `event_id`, and `list` on the form post (filled from the page query string). A post that omits those keys is still treated as a NASA Expo lead, so older queued leads keep that event. A post that sends the keys empty is a general Accel Analysis lead. Unknown list slugs are stored on the note.

NASA Expo event identifiers (used to recognize that event on incoming requests):

- api slug: `nasa_expo_2026_10_20_leads`
- list id: `e799de65-f5ad-4def-b9b6-abb0c680d84a`
- parent object: `people`

## Environment

Lead ingest writes only to Firestore. `expo_submitNasaLead` does not bind a secret. Optional Power NOW confirmation secrets (`RESEND_API_KEY`, `RECAPTCHA_ENTERPRISE_API_KEY`) are documented in `docs/POWER-NOW-CONFIRMATION-EMAIL.md`.

## What gets written

Each accepted lead is one `intakeLeads` document. A retry with the same `clientSubmissionId` does not create a second document.

Each accepted lead also stores one description line:

`[WS:EXPO-NASA-2026-10-20 | event:nasa-expo-2026-10-20 | org:… | need:… | consent:… | by:NASA Expo booth | at:<ISO Eastern> | sub:<submission id>]`

When the URL names the NASA Expo (`event=nasa-expo-2026-10-20`, the same id, or the list slug below), `captured_by` is `NASA Expo booth` and `source` is `EXPO-NASA-2026-10-20`. The form then asks for organization type and two optional interests, Power NOW and Hi Coworking early access. Other events store the event slug as the source and `captured_by` `Accel Analysis intake`. `captured_at` is an ISO timestamp in `America/New_York`, taken when the person is saved (including offline) as long as that time is within the last 14 days.

Each consent box stores yes or no, the wording version, the Eastern timestamp, and the source. The exact wording is copied into the note only when the box is checked. An unchecked box is stored as no.

## Privacy notice

The form shows this text under Privacy, then the checkbox labels from the catalog:

We'll use your information only to follow up on what you asked about. Check a box only if you'd like that kind of update. You can unsubscribe anytime.

## Consent wording — cite these versions

Source of truth: `EXPO_CONSENT_CATALOG` in `apps/functions/src/expo/nasaLeadModel.ts`. The form renders that catalog. There are three boxes: email, text (SMS), and phone.

### `intake-consent-v1-email`

Email

I agree to receive email from Accel Analysis at the email address I provided about my inquiry and the information I requested. I can unsubscribe at any time.

### `intake-consent-v2-sms`

Text (SMS)

I agree to receive text messages from Hi Coworking (Accel Analysis LLC) at the mobile number I provided about my inquiry and related follow-up. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out and HELP for help. Consent is not a condition of any purchase.

### `intake-consent-v1-phone`

Phone

I agree that Accel Analysis may call me at the phone number I provided about my inquiry and related follow-up. I can ask them to stop calling at any time.

## Deploy

`expo_submitNasaLead` does not bind a secret. Deploy it from the isolated entry in `firebase/expo-lead-functions` (`firebase.expo-lead.json`). That entry imports this function and nothing else, so a monolith secret such as Twilio is not registered during the deploy.

`firebase deploy --only functions:expo_submitNasaLead` against `firebase.json` still loads `apps/functions` (`main.ts`). `main.ts` imports `index.ts`, which imports `eventMarketing.ts`. That file calls `defineSecret("TWILIO_ACCOUNT_SID")` (and the other campaign secrets) at load time. Firebase CLI 15.23.0 puts every registered `defineSecret()` on the codebase build and resolves those params before it applies `--only`. A missing Twilio secret then fails the deploy in non-interactive mode, even though this function never reads it. Twilio stays on `events_processCampaignJobs`. This deploy does not remove that function or any other.

From the repo root:

```bash
npm run deploy:expo-lead
```

That command is:

```bash
firebase deploy --config firebase.expo-lead.json --project hi-coworking-plat --only functions:expo_submitNasaLead
```

Keep `--only functions:expo_submitNasaLead`. The isolated config uses the default codebase so it updates the function that is already deployed. Without that filter, Firebase would treat every other default-codebase function as removed.

Hosting is separate. Deploy the function before hosting so `/api/expo/nasa-lead` has somewhere to go:

```bash
npm run build
firebase deploy --project hi-coworking-plat --only hosting
```

The function deploy does not redeploy booking or events functions. The page is outside the coming-soon gate and does not change those flows.

### Power NOW public links

The approved public URLs are `https://accelanalysis.com/power-now`, `/pitch`, `/watch`, and `/contribute`. Each path returns HTTP 301 to the same path on `https://forms.accelanalysis.com` (for example `https://forms.accelanalysis.com/power-now`). The public Power NOW host is `forms.accelanalysis.com`, reached through those `accelanalysis.com` redirects. It is not `hi-coworking.com`.

### Manual GitHub Actions deploy

Workflow display name: **Hi Coworking Firebase expo lead function** (`.github/workflows/firebase-live-expo-lead-function.yml`).

It is `workflow_dispatch` only. GitHub shows that button after this file is on `main`. Running it from another branch is refused. Nothing in this repo starts it on push.

In Actions, open **Hi Coworking Firebase expo lead function**, choose **Run workflow** on `main`, and type this confirmation exactly:

```text
deploy expo_submitNasaLead
```

The job uses the same service account as the other live function deploys (`FIREBASE_SERVICE_ACCOUNT_HI_COWORKING_PLAT`, or `FIREBASE_SERVICE_ACCOUNT`), Node 20, `npm ci`, and `npm run build:expo-lead-deploy`. It refuses to continue unless `.firebaserc` defaults to `hi-coworking-plat`.

Before deploy it may warn if optional Power NOW secrets are missing, but a missing optional secret does not fail the job. The workflow never prints a secret value and never reads a secret payload. It does not require `TWILIO_ACCOUNT_SID` or any other secret.

The only deploy command is:

```bash
npx firebase deploy --config firebase.expo-lead.json --project hi-coworking-plat --only functions:expo_submitNasaLead --non-interactive
```

That deploys `expo_submitNasaLead` and nothing else: no other functions, no Hosting, no Firestore rules. Afterward it sends an OPTIONS preflight to the function URL. That request does not write a lead.

Open `https://hi-coworking.com/intake?event=nasa-expo-2026-10-20` on the booth iPad, or keep Guided Access on `https://hi-coworking.com/expo/nasa-2026`. That address redirects and adds the event. If the redirect does not leave the page, the form on that same page is shown. In Safari, use Share and then Add to Home Screen. The icon is named Accel Analysis and opens the form without the Safari address bar. In a browser that supports it, **Full screen** hides the browser chrome for that visit and disappears once the page is already full screen. After a successful submit the iPad shows **Thanks, you're all set.** **Start a new entry** clears it, and it also clears after 30 seconds with no taps, back on the same form. If Wi-Fi drops, the response stays in IndexedDB until it can post. The page does not mention the device or the sync. A saved response that comes back needing a correction is shown only on that screen. A later visitor does not see the earlier name or error. Responses that are still waiting keep trying to send.

## Test lead capture

```bash
npx vitest run tests/functions/expo-nasa-lead.test.ts
```

That run stores fake leads in the in-memory intake store, checks consent and event routing, and checks the offline queue decision.

## Test the iPad page locally

```bash
npm run dev
```

Open `http://localhost:3000/intake?event=nasa-expo-2026-10-20`. Leave every consent box unchecked, submit an empty form, and confirm it asks for a name. Fill out the form and submit. A local `next dev` server does not include the Hosting rewrite, so that post fails and the screen should say **Thanks, you're all set.** The response stays in IndexedDB. Use **Send now** after the function is reachable, or turn the device offline and submit again to see the same confirmation without a network. Validation errors, such as a missing name, stay on screen instead of being queued. `/expo/nasa-2026` should land on the same form with the event filled in silently.

## Test three fake leads

Use obviously fake people (`example.com`, 555 numbers). After a live send, confirm the rows in the Firestore export and delete the test documents if you do not need them.

Preview the payloads:

```bash
node scripts/expo-nasa-fake-leads.mjs
```

Send them through the deployed ingest (the script does not take a secret):

```bash
node scripts/expo-nasa-fake-leads.mjs --send --url https://hi-coworking.com/api/expo/nasa-lead
```

The three leads are Jordan Hale (`expo-fake-jordan@example.com`, Example Dynamics), Priya Shah (phone only, Northstar Sub Co), and Alex Kim (`expo-fake-alex@example.com`, Other Workshop). Jordan opts into text and phone. Priya opts into phone only. Alex leaves every consent box unchecked and asks about Hi Coworking early access. Each payload includes `event=nasa-expo-2026-10-20` so it is stored as a NASA Expo lead.

Direct function URL, if Hosting is not deployed yet:

```bash
node scripts/expo-nasa-fake-leads.mjs --send --url https://us-central1-hi-coworking-plat.cloudfunctions.net/expo_submitNasaLead
```

Power NOW confirmation mail, when that flag is later turned on, is a separate path on the same function. Setup, secrets, and the Resend and Graph options are in [POWER-NOW-CONFIRMATION-EMAIL.md](POWER-NOW-CONFIRMATION-EMAIL.md). The flag stays off until it is set to `true`.
