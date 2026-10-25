// Isolated deploy source for recurring event series (codebase "event-series"):
// the admin upsert and per-date override callables and the daily horizon
// extension scheduler.
//
// This source declares no secrets. Do not import main.ts, index.ts or
// eventMarketing.ts here: eventMarketing declares TWILIO_*, LINKEDIN_* and X_*
// secrets, and the Firebase CLI asks for every secret in the loaded source.
import "./bootstrap";

export {
  events_upsertSeries,
  events_setSeriesOccurrenceOverride,
  events_extendHorizon,
} from "../../../apps/functions/src/eventSeries";
