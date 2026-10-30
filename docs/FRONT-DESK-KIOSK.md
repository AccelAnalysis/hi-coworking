# Front-desk iPad kiosk

The front-desk kiosk is an iPad at the front desk that members use to check in when they arrive and check out when they leave. It does nothing else.

- **Kiosk page:** `/kiosk/front-desk`. It is a PWA with a manifest at `/kiosk/front-desk.webmanifest` and is meant to run under iPad Guided Access.
- **Staff page:** `/admin/front-desk`, which needs a staff role. It shows open visits, visits that need review, quiet hours alerts, late and no-show flags, and today's visits. Admins also see the kiosk screen settings and the device list.
- **Members:** the My Hi bookings page shows a "Front-desk check-in" card. It has the member's 6-character code, this month's visits, and any extra time recorded.

## How it behaves

| Topic | Rule |
| --- | --- |
| Lookup | The member enters their email or their member code. The kiosk shows one masked match (first name and last initial) and asks "Is this you?". Lookups are rate-limited per kiosk. Unknown input gets the same "We couldn't find that" reply. |
| One open visit | Each member can have only one open visit. Check-in and check-out run in a transaction and use a per-tap request ID, so a double tap or a retry returns the first result. |
| Clock | The server clock is used everywhere. The iPad's clock is never trusted. |
| Allowance | If the member has a confirmed seat booking that day, the allowance is the booked window. Otherwise it is the included monthly hours they have left. |
| Overage | Time past the allowance gets a 5-minute grace period, then rounds **up** to the next 15 minutes. The kiosk records the minutes and the plan rate (or the guest rate). **Nothing is ever charged.** |
| Forgotten check-out | Each check-in queues one task for that day's closing time (from the operating calendar). If the visit is still open then, it is closed at closing time, marked *needs review*, and no overage is assumed. If the task never ran, the member's next check-in closes the old visit the same way. |
| Late / no-show | **Late** means 15 minutes past the booking start with no visit. **No-show** is set at the booking end. Each is a one-time task queued when the booking is confirmed or moved. These are flags only, kept in `kioskBookingFlags`. Booking documents are not touched. A late member who then checks in is shown as *arrived late*. |
| Expired hours or a payment problem | Raises a staff-only alert under Admin → Front desk and the dashboard's "Action required". The member sees a normal check-in. No email or SMS is sent. |
| Staff close | A staff member sets the check-out time (Eastern) and must give a reason of 3–300 characters. The time must be within 18 hours of check-in and not in the future. The close is written to `memberOperationAudit`. |
| Offline | The kiosk shows "Please see staff." Nothing is queued or stored on the iPad. |
| Idle | After `idleLogoMinutes` on the start screen (default 15, range 1–120), the navy logo screen fades in for `logoSeconds` (default 6, range 3–15) and then fades out. A tap goes back to check-in. Member screens reset to the start after 45 seconds, or 20 seconds on result screens. With reduced motion turned on, the logo screen uses a crossfade only. |

## Late, no-show and forgotten check-out tasks

Nothing polls. Work is queued only when something happens:

| Event | Task queued | When it runs | What it does |
| --- | --- | --- | --- |
| A confirmed seat booking is created, confirmed or moved (start, end or member changed) | `late` | Start + 15 min (or now, if that has passed and the booking is still running) | Flags *late* unless a visit overlaps the booking. |
| Same | `no_show` | Booking end | Flags *no-show* unless a visit overlaps; turns *late* into *arrived late* if the member came in. |
| A member checks in | `auto_close` | That day's closing time | Closes the visit for review if it is still open. If the day's hours were extended after check-in, it re-queues itself for the new closing time. |

How it is built:

- **Trigger:** `kiosk_onBookingWritten` is a Firestore trigger on `bookings/{bookingId}`. The seven booking write paths are unchanged. It re-plans only when the start, end, member or confirmed-seat status changed. It retries on failure and gives up on events older than 6 hours.
- **Task function:** `kioskFrontDeskTask` (`onTaskDispatched`) runs all three kinds. Its name is also its Cloud Tasks queue ID, which allows only letters, digits and hyphens, so it has no underscore. Retries: up to 5 attempts, 30 s to 10 min backoff. At most 5 run at once.
- **Deterministic IDs:** `kiosk-late-<bookingId>-<start>`, `kiosk-noshow-<bookingId>-<start>` and `kiosk-close-<visitId>-<dueAt>`. A replayed trigger gets "task already exists" and is counted as a duplicate. A moved booking gets new IDs.
- **Cancel or move:** old tasks are not deleted (that would need the task-deleter role). Each handler re-reads the booking and does nothing if it was cancelled, deleted, moved or reassigned.
- **Idempotent handlers:** the flag document is keyed by booking and written in a transaction; a second delivery does nothing. Auto-close checks that the visit is still the member's open visit before closing it.
- **Early delivery:** a task that arrives up to 5 minutes before it is due (clock skew) throws, so Cloud Tasks retries it.
- **Bookings more than 29 days ahead:** Cloud Tasks only accepts tasks up to 30 days out. These bookings get a relay task at day 29 that re-queues the real check. Relay IDs end in `-relay-<day>`.
- **Check-in is never blocked:** queuing the close task is best effort with a 10-second limit. A missed close task is covered by the next check-in.

**Local emulator:** the Cloud Tasks emulator starts with the Functions emulator. It runs tasks right away and ignores the schedule time, so in the emulator early tasks throw and are retried, and relays are de-duplicated. The emulator integration test covers a booking write → trigger → task → flag run end to end; the timing cases call the handlers directly with a fixed clock.

## Deploy (in this order)

1. **Firestore rules.** Deploy with `firebase deploy --only firestore:rules`. The new `kiosk*` collections are server-only (`allow read, write: if false`).
2. **Google Cloud setup (owner, before the functions deploy).** See "Google Cloud setup" below.
3. **Functions.** Run the GitHub workflow **"Firebase live front desk kiosk"** (`.github/workflows/firebase-live-front-desk-kiosk.yml`) and type `deploy front desk kiosk`.
   - It deploys only the `front-desk-kiosk` codebase (`firebase.front-desk-kiosk.json`, source `firebase/front-desk-kiosk-functions`) with `--only functions:front-desk-kiosk`, then probes `kiosk_session`.
   - The bundle declares no secrets.
   - It creates or updates the Cloud Tasks queue `kioskFrontDeskTask` in us-central1. It sets no invoker, so it makes no IAM changes.
4. **Hosting.** This deploys automatically on merge. Until step 3 is done, the admin page shows a "not switched on yet" note, the dashboard hides the front-desk counts, and the My Hi card stays hidden.
5. **Turn it on.** After the functions are live, set `frontDesk.live` to `true` in `apps/web/src/lib/adminCapabilities.ts` in a follow-up PR.

### Google Cloud setup (project `hi-coworking-plat`)

Do these once, as the project owner, before step 3. `PROJECT_NUMBER` is the project's number; the functions run as the default compute service account `PROJECT_NUMBER-compute@developer.gserviceaccount.com`.

1. **Enable the Cloud Tasks API** (`cloudtasks.googleapis.com`). The deploy checks for it and only enables it itself if the deploying account may enable APIs.
2. **The queue:** nothing to do. The deploy creates `projects/hi-coworking-plat/locations/us-central1/queues/kioskFrontDeskTask`. The deploying account needs Cloud Tasks queue create, get and update permission (for example `roles/cloudtasks.queueAdmin`).
3. **Let the runtime account queue tasks:** grant it `roles/cloudtasks.enqueuer` (on the project or on that queue).
4. **Let it sign tasks as itself:** grant it `roles/iam.serviceAccountUser` on itself. Tasks carry an OIDC token for that account.
5. **Let Cloud Tasks call the function:** grant it `roles/run.invoker` on the Cloud Run service `kioskfrontdesktask` (the lower-cased service behind `kioskFrontDeskTask`, us-central1; check the name in the Cloud Run console). This service exists only after the first deploy, so grant it right after step 3. Until then deliveries fail; each task is dropped after 5 attempts (about 15 minutes). The next check-in still closes forgotten visits.
6. **Firestore trigger (`kiosk_onBookingWritten`):** this uses the same Eventarc setup as the existing Firestore-triggered v2 functions (for example `leads_onNewLead`), so nothing new should be needed.

Example commands for the owner (not run by this PR):

```sh
gcloud services enable cloudtasks.googleapis.com --project hi-coworking-plat
SA="PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding hi-coworking-plat --member="serviceAccount:$SA" --role=roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding "$SA" --project hi-coworking-plat --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser
# After the functions deploy:
gcloud run services add-iam-policy-binding kioskfrontdesktask --region us-central1 --project hi-coworking-plat --member="serviceAccount:$SA" --role=roles/run.invoker
```

**Cost:** Cloud Tasks gives 1,000,000 billable operations per month free per billing account, then $0.40 per million. An operation is an API call or a delivery attempt. At about 50 bookings a day: 2 tasks per booking and 1 per check-in, each with one enqueue and one delivery, is about 300 operations a day, or about 9,000–10,000 a month with retries. That is about 1% of the free tier. No Cloud Scheduler jobs are added.

**Indexes:** no composite indexes are needed. Every query is a single equality or range on one field. Do not run a file-based `firestore:indexes` deploy.

**No Cloud Scheduler jobs and no polling.** Late, no-show and forgotten check-out checks run as one-time Cloud Tasks (see below).

**Cleanup (optional follow-up):** `kioskLookups`, `kioskRequests` and `kioskRateLimits` only grow slowly. A Firestore TTL policy would need a Timestamp field, but `expiresAt` is currently stored as epoch milliseconds. Adding a Timestamp field and a TTL policy is a follow-up item. It has not been configured.

## Set up an iPad (staff/admin)

1. **Create a dedicated kiosk login.** An admin creates it in Firebase Auth, for example a shared front-desk address that the team controls.
   - It must be a normal **member** account and never staff or admin. The kiosk refuses staff and admin accounts.
   - Keep the password in the team password manager, not in chat.
2. **Enroll the device.** In **Admin → Front desk → Kiosk devices**, paste that account's user ID, give it a label (for example "Front desk iPad"), and choose **Enroll**.
   - This adds the `kiosk: true` claim and records the device.
   - **Revoke** removes the claim and signs the iPad out.
3. **Sign in on the iPad.** In Safari, open `/kiosk/front-desk` and sign in with the kiosk login on the "Set up the front desk" screen.
4. **Add to Home Screen.** Use Share → Add to Home Screen, then open it from the Home Screen icon so it runs full screen.
5. **Turn on Guided Access.** Go to Settings → Accessibility → Guided Access, turn it on, and set a passcode. Open the kiosk and triple-click the side/top button to start it.
   - Turn off the hardware buttons and keyboards you don't need.
   - Set Guided Access → Display Auto-Lock to **Never**.
6. **Display settings.** Go to Settings → Display & Brightness → Auto-Lock → **Never**. Keep the iPad on power. The page also requests a screen wake lock.
7. **Adjust timing (optional).** Admins can change "Show logo after" and "Logo shows for" in **Admin → Front desk → Kiosk screen**.

Members can find their code on My Hi → Bookings ("Front-desk check-in"). They can also type their email.

## Brand notes (kiosk screens only)

- **Colours:** navy `#101D4B` and white, with `#EEF0F6`, `#C5CADB`, `#4A5585` and `#3A4675` as supporting colours.
- **Type:** Fraunces SemiBold for headlines (`font-display`) and DM Sans for body text. Geist is not used.
- **Logo:** the navy mark goes on light surfaces and the inverse mark on navy. Never put the mark on a white plate.
- **Idle screen:** navy background, inverse mark, "Welcome. Make yourself at home." and "Touch to check in or check out". It uses a CSS fade and no video.
- **Copy rules:** no address, no prices or dates, and no claims about being open or bookable. Say "complimentary", not "free".

Contrast of the text pairs used (WCAG 2.2 AA needs 4.5:1):

| Text / background | Ratio |
| --- | --- |
| White / navy | 16.16 |
| Navy / `#EEF0F6` | 14.18 |
| `#3A4675` / white | 9.08 |
| `#3A4675` / `#EEF0F6` | 7.97 |
| `#4A5585` / white | 7.17 |
| `#4A5585` / `#EEF0F6` | 6.29 |
| `#C5CADB` / navy | 9.89 |

`#C5CADB` on white is only 1.63:1, so it is never used for text or borders on light surfaces. Borders use `#4A5585`.

## Known limits

- Walk-in minutes taken from the monthly allowance are tracked on kiosk visits only. They do not update `membershipUsage`.
- The kiosk account is a member account, so it can read what any signed-in member can read. It cannot read any kiosk collection.
- Tasks for a cancelled or moved booking are not deleted; they run once and do nothing.
- Bookings that existed before the trigger was deployed get no tasks until they are next changed.
- If queuing a booking's tasks keeps failing for 6 hours, that booking is not flagged. The error is logged.
