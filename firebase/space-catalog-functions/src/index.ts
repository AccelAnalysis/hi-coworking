// Isolated deploy source for Published setups (codebase "space-catalog"): the
// customer catalog read and the admin setup/add-on callables.
//
// This source declares no secrets. Do not import main.ts, index.ts or
// eventMarketing.ts here: eventMarketing declares TWILIO_*, LINKEDIN_* and X_*
// secrets, and the Firebase CLI asks for every secret in the loaded source.
import "./bootstrap";

export {
  space_getPublishedCatalog,
  space_adminGetCatalog,
  space_adminUpsertSetup,
  space_adminUpsertAddOn,
  space_adminSetSetupPublished,
} from "../../../apps/functions/src/spaceCatalog";
