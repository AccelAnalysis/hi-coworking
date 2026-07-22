import * as admin from "firebase-admin";

if (admin.apps.length === 0) admin.initializeApp();

export { account_initialize } from "./accounts";
export { profile_update } from "./profiles";
export { enrichment_search, enrichment_link } from "./enrichment";
export {
  exchange_organizationSearch,
  exchange_organizationCreate,
  exchange_organizationRequestClaim,
  exchange_organizationListMyClaims,
  exchange_adminListOrganizationClaims,
  exchange_adminGetOrganizationClaim,
  exchange_adminReviewOrganizationClaim,
} from "./exchange/organizations";
export {
  exchange_listActorOrganizations,
  exchange_resolveOrganizationPerspective,
  exchange_organizationDirectory,
  exchange_saveOrganization,
  exchange_requestOrganizationContact,
  exchange_requestOrganizationIntroduction,
  exchange_getOrganizationResourceStatus,
} from "./exchange/organizationWorkspace";
