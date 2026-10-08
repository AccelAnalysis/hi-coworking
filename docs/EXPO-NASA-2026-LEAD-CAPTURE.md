# Accel Analysis lead intake

Shared lead form for Accel Analysis. The page is Accel-branded. It does not show an event name. Visitors enter a lead on a phone, iPad, or laptop. The page writes an Attio person, links a company, adds the person to a known list when the URL names one, and stores consent in a person note plus a description tag. It does not record audio or any kiosk voice path.

Public page: `/intake`

NASA Expo alias: `/expo/nasa-2026` redirects to `/intake?event=nasa-expo-2026-10-20`. Existing QR codes keep working. The event slug is not rendered.

Ingest: `POST /api/expo/nasa-lead` (Firebase Hosting rewrite to the `expo_submitNasaLead` Cloud Function)

Event context is read from `event`, `event_id`, and `list` on the form post (filled from the page query string). A post that omits those keys still uses the NASA Expo list, so older queued leads keep their destination. A post that sends the keys empty is a general Accel Analysis lead and is not added to that list. Unknown list slugs are stored on the note and are not sent to Attio.

Attio list: **NASA Expo 2026-10-20 Leads**

- api slug: `nasa_expo_2026_10_20_leads`
- list id: `e799de65-f5ad-4def-b9b6-abb0c680d84a`
- parent object: `people`

## Environment

The Attio token stays on the server. The browser never receives it.

| Name | Where | Purpose |
| --- | --- | --- |
| `ATTIO_API_KEY` | Cloud Function secret / env | Attio API bearer token |

Set it before the first deploy:

```bash
firebase functions:secrets:set ATTIO_API_KEY --project hi-coworking-plat
```

The token needs Attio scopes that can read and write people and companies, read and write list entries, and read and write notes (`record_permission:read-write`, `object_configuration:read`, `list_entry:read-write`, `list_entry:read`, `note:read-write`).

For the emulator, either export `ATTIO_API_KEY` in the shell that starts the emulators or put the same line in `apps/functions/.secret.local` (that file is local only; do not commit it).

## What gets written

Search people by email first. If the email already exists, the person is updated in place. Phone-only leads are searched by phone and updated when there is one match. A new company is created only when the normalized name (trimmed, internal spaces collapsed, case-insensitive among the companies Attio returns) is not already there, then linked on the person.

The list entry sends no custom attributes. If the list only has system attributes, or Attio rejects an entry value, the person and note still save.

Each accepted lead appends one description line:

`[WS:EXPO-NASA-2026-10-20 | event:nasa-expo-2026-10-20 | org:… | need:… | consent:… | by:NASA Expo booth | at:<ISO Eastern> | sub:<submission id>]`

When the URL names the NASA Expo (`event=nasa-expo-2026-10-20`, the same id, or the list slug below), `captured_by` is `NASA Expo booth` and `source` is `EXPO-NASA-2026-10-20`. The form then asks for organization type and the two “only if they ask” interests. Other events store the event slug as the source and `captured_by` `Accel Analysis intake`. `captured_at` is an ISO timestamp in `America/New_York`, taken when the person is saved (including offline) as long as that time is within the last 14 days.

Each consent box stores yes or no, the wording version, the Eastern timestamp, and the source. The exact wording is copied into the note only when the box is checked. All three boxes start unchecked.

## Privacy notice

Draft, pending Jonathan’s approval. The form shows this text:

Accel Analysis keeps what you type here so we can follow up on what you asked. The three boxes start unchecked. If you check one, we store yes, the exact wording version, the time in Eastern Time, and the source of this form. If you leave it unchecked, we store no. We do not sell this information. Questions: JHolman@AccelAnalysis.com or (757) 236-0651.

## Consent wording — cite these versions

Source of truth: `EXPO_CONSENT_CATALOG` in `apps/functions/src/expo/nasaLeadModel.ts`. The form renders that catalog. There are three boxes: email, text (SMS), and phone.

### `intake-consent-v1-email`

Email

I agree to receive email from Accel Analysis at the email address I provided about my inquiry and the information I requested. I can unsubscribe at any time.

### `intake-consent-v1-sms`

Text (SMS)

I agree to receive text messages from Accel Analysis at the mobile number I provided about my inquiry and related follow-up. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out and HELP for help. Consent is not a condition of any purchase.

### `intake-consent-v1-phone`

Phone

I agree that Accel Analysis may call me at the phone number I provided about my inquiry and related follow-up. I can ask them to stop calling at any time.

## Deploy

From the repo root, after `ATTIO_API_KEY` is set:

```bash
npm run build:functions
firebase deploy --project hi-coworking-plat --only functions:expo_submitNasaLead

npm run build
firebase deploy --project hi-coworking-plat --only hosting
```

Deploy the function before hosting so `/api/expo/nasa-lead` has somewhere to go. This does not redeploy booking or events functions. The page is outside the coming-soon gate and does not change those flows.

### Manual GitHub Actions deploy

Workflow display name: **Hi Coworking Firebase expo lead function** (`.github/workflows/firebase-live-expo-lead-function.yml`).

It is `workflow_dispatch` only. GitHub shows that button after this file is on `main`. Running it from another branch is refused. Nothing in this repo starts it on push.

In Actions, open **Hi Coworking Firebase expo lead function**, choose **Run workflow** on `main`, and type this confirmation exactly:

```text
deploy expo_submitNasaLead
```

The job uses the same service account as the other live function deploys (`FIREBASE_SERVICE_ACCOUNT_HI_COWORKING_PLAT`, or `FIREBASE_SERVICE_ACCOUNT`), Node 20, `npm ci`, and `npm run build:shared && npm run build:functions`. It refuses to continue unless `.firebaserc` defaults to `hi-coworking-plat`.

Before deploy it checks that Secret Manager in `hi-coworking-plat` has an enabled `ATTIO_API_KEY` version. A missing secret fails the job. The workflow never prints the secret value and never reads the secret payload.

The only deploy command is:

```bash
npx firebase deploy --project hi-coworking-plat --only functions:expo_submitNasaLead --non-interactive
```

That deploys `expo_submitNasaLead` and nothing else: no other functions, no Hosting, no Firestore rules. Afterward it sends an OPTIONS preflight to the function URL. That request writes nothing to Attio.

Open `https://hi-coworking.com/intake?event=nasa-expo-2026-10-20` on the booth iPad, or keep Guided Access on `https://hi-coworking.com/expo/nasa-2026` (it redirects and adds the event). If Wi-Fi drops, the iPad shows **Saved — will sync** and keeps the lead in IndexedDB until it can post.

## Test without touching Attio

```bash
npx vitest run tests/functions/expo-nasa-lead.test.ts
```

That run creates three fake leads against a mock Attio: an emailed visitor, the same email again (one person, one company), and a phone-only visitor. It also checks unchecked consent, a list that rejects custom attributes, and the offline queue decision.

## Test the iPad page locally

```bash
npm run dev
```

Open `http://localhost:3000/intake?event=nasa-expo-2026-10-20`. Leave every consent box unchecked, submit an empty form, and confirm it asks for a name. Fill a lead and submit. A local `next dev` server does not include the Hosting rewrite, so that post fails and the screen should say **Saved — will sync**. The lead stays in IndexedDB. Use **Sync now** after the function is reachable, or turn the device offline and submit another visitor to see the same message without a network. Validation errors, such as a missing name, stay on screen instead of being queued. `/expo/nasa-2026` should land on the same form with the event filled in silently.

## Test three fake leads against Attio

Use obviously fake people (`example.com`, 555 numbers) and delete them from Attio afterward.

Preview the payloads:

```bash
node scripts/expo-nasa-fake-leads.mjs
```

Send them through the deployed ingest (the script does not take the API key; the function reads `ATTIO_API_KEY`):

```bash
node scripts/expo-nasa-fake-leads.mjs --send --url https://hi-coworking.com/api/expo/nasa-lead
```

The three leads are Jordan Hale (`expo-fake-jordan@example.com`, Example Dynamics), Priya Shah (phone only, Northstar Sub Co), and Alex Kim (`expo-fake-alex@example.com`, Other Workshop). Jordan opts into text and phone. Priya opts into phone only. Alex leaves every consent box unchecked and asks about Hi Coworking early access. Each payload includes `event=nasa-expo-2026-10-20` so it joins the expo list.

Direct function URL, if Hosting is not deployed yet:

```bash
node scripts/expo-nasa-fake-leads.mjs --send --url https://us-central1-hi-coworking-plat.cloudfunctions.net/expo_submitNasaLead
```
