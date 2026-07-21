import * as admin from "firebase-admin";

if (admin.apps.length === 0) admin.initializeApp();

export { account_initialize } from "./accounts";
export { profile_update } from "./profiles";
export { enrichment_search, enrichment_link } from "./enrichment";
