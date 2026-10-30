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
| Forgotten check-out | The sweep closes the visit at that day's closing time from the operating calendar. The visit is marked *needs review* and no overage is assumed. |
| Late / no-show | **Late** means 15 minutes past the booking start with no visit. **No-show** is set at the booking end. These are flags only, kept in `kioskBookingFlags`. Booking documents are not touched. |
| Expired hours or a payment problem | Raises a staff-only alert under Admin → Front desk and the dashboard's "Action required". The member sees a normal check-in. No email or SMS is sent. |
| Staff close | A staff member sets the check-out time (Eastern) and must give a reason of 3–300 characters. The time must be within 18 hours of check-in and not in the future. The close is written to `memberOperationAudit`. |
| Offline | The kiosk shows "Please see staff." Nothing is queued or stored on the iPad. |
| Idle | After `idleLogoMinutes` on the start screen (default 15, range 1–120), the navy logo screen fades in for `logoSeconds` (default 6, range 3–15) and then fades out. A tap goes back to check-in. Member screens reset to the start after 45 seconds, or 20 seconds on result screens. With reduced motion turned on, the logo screen uses a crossfade only. |

## Deploy (in this order)

1. **Firestore rules.** Deploy with `firebase deploy --only firestore:rules`. The new `kiosk*` collections are server-only (`allow read, write: if false`).
2. **Functions.** Run the GitHub workflow **"Firebase live front desk kiosk"** (`.github/workflows/firebase-live-front-desk-kiosk.yml`) and type `deploy front desk kiosk`.
   - It deploys only the `front-desk-kiosk` codebase (`firebase.front-desk-kiosk.json`, source `firebase/front-desk-kiosk-functions`) with `--only functions:front-desk-kiosk`, then probes `kiosk_session`.
   - The bundle declares no secrets.
3. **Hosting.** This deploys automatically on merge. Until step 2 is done, the admin page shows a "not switched on yet" note, the dashboard hides the front-desk counts, and the My Hi card stays hidden.
4. **Turn it on.** After the functions are live, set `frontDesk.live` to `true` in `apps/web/src/lib/adminCapabilities.ts` in a follow-up PR.

**Indexes:** no composite indexes are needed. Every query is a single equality or range on one field. Do not run a file-based `firestore:indexes` deploy.

**Cloud Scheduler:** this adds one job, `kiosk_attendanceSweep`, which runs every 15 minutes from 8:00 to 18:45 ET, Monday to Friday. Cloud Scheduler gives 3 free jobs per billing account and then charges about $0.10 per job per month. This job may be billable, so get the owner's OK before step 2.

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
- The sweep runs on weekdays from 8:00 to 18:45 ET. Bookings that end later, or that fall on a weekend, are flagged on the next run. Forgotten check-outs from those days are closed on the next run too.
