# NASA Expo 2026 lead capture

Booth form for Accel Analysis at the NASA Business Vendor Expo on October 20, 2026. Visitors enter a lead on an iPad. The page writes an Attio person, links a company, adds the person to the expo list, and stores consent in a person note plus a description tag. It does not record audio or any kiosk voice path.

Public page: `/expo/nasa-2026`

Ingest: `POST /api/expo/nasa-lead` (Firebase Hosting rewrite to the `expo_submitNasaLead` Cloud Function)

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

`[WS:EXPO-NASA-2026-10-20 | org:… | need:… | consent:… | by:NASA Expo booth | at:<ISO Eastern> | sub:<submission id>]`

The person note is the full record: need, organization type, capture time, and consent. `captured_by` is always `NASA Expo booth`. `source` is always `EXPO-NASA-2026-10-20`. `captured_at` is an ISO timestamp in `America/New_York`, taken when the visitor is saved on the iPad (including offline) as long as that time is within the last 14 days.

Unchecked consent is stored as `no consent` for that channel. A checked box stores `opt-in true`, the version id, the Eastern timestamp, and the exact wording below.

## Consent wording — cite these versions

Source of truth: `EXPO_CONSENT_CATALOG` in `apps/functions/src/expo/nasaLeadModel.ts`. The booth form renders that catalog, and the ingest copies it onto the Attio note. All four boxes start unchecked.

### `expo-consent-v1-sms`

SMS consent

I agree to receive text messages from Accel Analysis at the mobile number I provided about my NASA Business Vendor Expo conversation and related follow-up. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help. Consent is not a condition of any purchase.

### `expo-consent-v1-marketing`

Marketing consent

I agree that Accel Analysis may send me marketing about Accel Analysis and Hi Coworking, including events, offers, and product news, using the contact channels I separately opt into.

### `expo-consent-v1-contact`

Consent to contact

I agree that Accel Analysis may contact me about the need I described at the NASA Business Vendor Expo, using the email address or phone number I provided.

### `expo-consent-v1-email`

Email consent

I agree to receive email from Accel Analysis at the email address I provided about my NASA Business Vendor Expo conversation and the information I requested.

## Deploy

From the repo root, after `ATTIO_API_KEY` is set:

```bash
npm run build:functions
firebase deploy --project hi-coworking-plat --only functions:expo_submitNasaLead

npm run build
firebase deploy --project hi-coworking-plat --only hosting
```

Deploy the function before hosting so `/api/expo/nasa-lead` has somewhere to go. This does not redeploy booking or events functions. The page is outside the coming-soon gate and does not change those flows.

Open `https://hi-coworking.com/expo/nasa-2026` on the booth iPad. Guided Access can stay on that URL. If Wi-Fi drops, the iPad shows **Saved — will sync** and keeps the lead in IndexedDB until it can post.

## Test without touching Attio

```bash
npx vitest run tests/functions/expo-nasa-lead.test.ts
```

That run creates three fake leads against a mock Attio: an emailed visitor, the same email again (one person, one company), and a phone-only visitor. It also checks unchecked consent, a list that rejects custom attributes, and the offline queue decision.

## Test the iPad page locally

```bash
npm run dev
```

Open `http://localhost:3000/expo/nasa-2026`. Leave every consent box unchecked, submit an empty form, and confirm it asks for a name. Fill a lead and submit. A local `next dev` server does not include the Hosting rewrite, so that post fails and the screen should say **Saved — will sync**. The lead stays in IndexedDB. Use **Sync now** after the function is reachable, or turn the iPad offline and submit another visitor to see the same message without a network. Validation errors, such as a missing name, stay on screen instead of being queued.

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

The three leads are Jordan Hale (`expo-fake-jordan@example.com`, Example Dynamics), Priya Shah (phone only, Northstar Sub Co), and Alex Kim (`expo-fake-alex@example.com`, Other Workshop). Jordan opts into SMS and contact. Priya opts into contact only. Alex leaves every consent box unchecked and asks about Hi Coworking early access.

Direct function URL, if Hosting is not deployed yet:

```bash
node scripts/expo-nasa-fake-leads.mjs --send --url https://us-central1-hi-coworking-plat.cloudfunctions.net/expo_submitNasaLead
```
