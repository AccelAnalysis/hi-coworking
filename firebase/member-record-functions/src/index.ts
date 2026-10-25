// Isolated deploy source for the admin member record and consent list
// (codebase "member-record"): read-only, admin/master-only callables.
//
// This source declares no secrets. Do not import main.ts, index.ts or
// eventMarketing.ts here: eventMarketing declares TWILIO_*, LINKEDIN_* and X_*
// secrets, and the Firebase CLI asks for every secret in the loaded source.
import "./bootstrap";

export { admin_memberRecordGet, admin_consentList } from "../../../apps/functions/src/adminMemberRecord";
