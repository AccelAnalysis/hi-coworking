// Isolated deploy source for the front-desk iPad kiosk (codebase
// "front-desk-kiosk"): kiosk check-in/out, the staff front-desk tools, the
// member check-in code, and one scheduled attendance sweep.
//
// This source declares no secrets. Do not import main.ts, index.ts,
// eventMarketing.ts or smsProvider.ts here: eventMarketing declares TWILIO_*,
// LINKEDIN_* and X_* secrets, and the Firebase CLI asks for every secret in
// the loaded source.
import "./bootstrap";

export {
  kiosk_session,
  kiosk_lookupMember,
  kiosk_checkIn,
  kiosk_checkOut,
  kiosk_attendanceSweep,
  admin_kioskOverview,
  admin_kioskCloseVisit,
  admin_kioskResolveAlert,
  admin_kioskSetSettings,
  admin_kioskDeviceSet,
  members_kioskSummary,
} from "../../../apps/functions/src/frontDeskKiosk";
