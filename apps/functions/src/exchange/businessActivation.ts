import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { getAuthorizedActor, loadOrgAuthority } from "./security";

export const BUSINESS_ACTIVATION_CONTRACT_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const markerStates = [
  "private_actor_visible",
  "public_visible",
  "private_and_public_visible",
  "list_only",
  "blocked_missing_address",
  "blocked_missing_geocode",
  "blocked_unconfirmed_geocode",
  "blocked_organization_not_published",
  "blocked_coordinate_not_approved",
  "private_home_suppressed",
  "mailing_only",
  "virtual_location",
  "inactive_establishment",
  "unauthorized",
  "claim_pending",
] as const;
export type BusinessActivationMarkerState = (typeof markerStates)[number];

type Data = FirebaseFirestore.DocumentData;

function db(): FirebaseFirestore.Firestore {
  return admin.firestore();
}

function validCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

export function deriveBusinessActivationMarkerState(input: {
  authorized: boolean;
  claimPending?: boolean;
  organization?: Data;
  location?: Data;
  publicLocationExists?: boolean;
}): BusinessActivationMarkerState {
  if (input.claimPending && !input.authorized) return "claim_pending";
  if (!input.authorized) return "unauthorized";
  const location = input.location;
  if (!location) return "blocked_missing_address";
  if (location.status !== "active") return "inactive_establishment";
  if (location.locationType === "mailing_only") return "mailing_only";
  if (location.locationType === "virtual") return "virtual_location";
  if (location.privateHome === true) return "private_home_suppressed";
  if (!location.physicalAddress) return "blocked_missing_address";
  if (!location.geocode) return "blocked_missing_geocode";
  if (
    !validCoordinate(location.geocode.latitude, location.geocode.longitude)
    || !location.geocode.confirmedAt
  ) return "blocked_unconfirmed_geocode";

  const privateVisible = true;
  const organizationPublished = input.organization?.publicationStatus === "approved"
    || input.organization?.publicationApproved === true;
  if (!organizationPublished) return privateVisible
    ? "private_actor_visible"
    : "blocked_organization_not_published";
  if (location.coordinatePublicationApproved !== true) return privateVisible
    ? "private_actor_visible"
    : "blocked_coordinate_not_approved";
  return input.publicLocationExists ? "private_and_public_visible" : "public_visible";
}

export function derivePublicBusinessMarkerState(input: {
  organization?: Data;
  location?: Data;
  publicLocationExists?: boolean;
}): BusinessActivationMarkerState {
  const location = input.location;
  if (!location) return "blocked_missing_address";
  if (location.status !== "active") return "inactive_establishment";
  if (location.locationType === "mailing_only") return "mailing_only";
  if (location.locationType === "virtual") return "virtual_location";
  if (location.privateHome === true) return "private_home_suppressed";
  if (!location.physicalAddress) return "blocked_missing_address";
  if (!location.geocode) return "blocked_missing_geocode";
  if (
    !validCoordinate(location.geocode.latitude, location.geocode.longitude)
    || !location.geocode.confirmedAt
  ) return "blocked_unconfirmed_geocode";
  if (
    input.organization?.publicationStatus !== "approved"
    && input.organization?.publicationApproved !== true
  ) return "blocked_organization_not_published";
  if (location.coordinatePublicationApproved !== true) {
    return "blocked_coordinate_not_approved";
  }
  return input.publicLocationExists ? "public_visible" : "list_only";
}

function asCompleted(entries: Array<[string, boolean]>): string[] {
  return entries.filter(([, complete]) => complete).map(([step]) => step);
}

function currentStep(completed: Set<string>, claimPending: boolean): string {
  if (!completed.has("account_initialized")) return "account";
  if (!completed.has("business_representative_attestation")) return "representative_attestation";
  if (!completed.has("person_essentials")) return "person_essentials";
  if (!completed.has("organization_search")) return "organization_search";
  if (!completed.has("organization_connected")) return claimPending ? "organization_claim_pending" : "organization_connection";
  if (!completed.has("enrichment_reviewed")) return "organization_enrichment";
  if (!completed.has("organization_profile")) return "organization_profile";
  if (!completed.has("establishment_confirmed")) return "establishment";
  if (!completed.has("preferred_orientation_establishment")) return "orientation_establishment";
  if (!completed.has("organization_contact_point")) return "organization_contact";
  if (!completed.has("referral_route") || !completed.has("opportunity_route")) return "communication_routes";
  if (!completed.has("map_activation")) return "map_activation";
  return "completed";
}

function resumeRoute(step: string, organizationId?: string): string {
  if (step === "organization_claim_pending" || step === "organization_search" || step === "organization_connection") {
    return "/exchange/onboarding";
  }
  if (!organizationId) return "/exchange/onboarding";
  const id = encodeURIComponent(organizationId);
  if (step === "organization_enrichment") return `/org/settings?id=${id}&tab=enrichment&onboarding=1`;
  if (step === "organization_profile") return `/org/settings?id=${id}&tab=profile&onboarding=1`;
  if (step === "establishment" || step === "orientation_establishment") {
    return `/org/settings?id=${id}&tab=establishments&onboarding=1`;
  }
  if (step === "organization_contact" || step === "communication_routes") {
    return `/org/settings?id=${id}&tab=contact&onboarding=1`;
  }
  return `/exchange?actorOrg=${id}&subjectOrg=${id}`;
}

export const exchange_getBusinessActivationState = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const parsed = z.object({ organizationId: ID.optional() }).strict().safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid activation request");
  const store = db();
  const [userSnapshot, profileSnapshot, membershipSnapshot, claimSnapshot] = await Promise.all([
    store.collection("users").doc(actor.uid).get(),
    store.collection("profiles").doc(actor.uid).get(),
    store.collection("orgMembers").where("uid", "==", actor.uid).limit(50).get(),
    store.collection("organizationClaims").where("requestedBy", "==", actor.uid).limit(50).get(),
  ]);
  const user = userSnapshot.data() ?? {};
  const profile = profileSnapshot.data() ?? {};
  const activeMemberships = membershipSnapshot.docs.filter((document) => document.get("status") === "active");
  const requestedOrganizationId = parsed.data.organizationId;
  const membership = (
    requestedOrganizationId
      ? activeMemberships.find((document) => document.get("orgId") === requestedOrganizationId)
      : activeMemberships.sort((left, right) => Number(right.get("joinedAt") ?? 0) - Number(left.get("joinedAt") ?? 0))[0]
  );
  const organizationId = membership?.get("orgId") as string | undefined;
  const relevantClaim = claimSnapshot.docs
    .filter((document) => !requestedOrganizationId || document.get("organizationId") === requestedOrganizationId)
    .sort((left, right) => Number(right.get("updatedAt") ?? 0) - Number(left.get("updatedAt") ?? 0))[0];
  const claimState = relevantClaim?.get("status") as string | undefined;
  const claimPending = claimState === "pending" && !membership;
  const managementAuthorityActive = membership
    ? membership.get("role") === "owner" || membership.get("role") === "admin"
    : false;

  const [organizationSnapshot, locationSnapshot, contactSnapshot, routeSnapshot] = organizationId
    ? await Promise.all([
      store.collection("orgs").doc(organizationId).get(),
      store.collection("organizationLocations").where("organizationId", "==", organizationId).get(),
      store.collection("organizationContactPoints").where("organizationId", "==", organizationId).get(),
      store.collection("organizationCommunicationRoutes").where("organizationId", "==", organizationId).get(),
    ])
    : [null, null, null, null];
  const organization = organizationSnapshot?.data() ?? undefined;
  const locations = locationSnapshot?.docs.filter((document) => document.get("status") === "active") ?? [];
  const activationLocations = locations.filter((document) => (
    document.get("privateHome") !== true
    && !["mailing_only", "virtual"].includes(String(document.get("locationType")))
    && Boolean(document.get("physicalAddress"))
    && validCoordinate(document.get("geocode.latitude"), document.get("geocode.longitude"))
    && Boolean(document.get("geocode.confirmedAt"))
  ));
  const preferredId = profile.preferredOrganizationId === organizationId
    ? profile.preferredEstablishmentId as string | undefined
    : undefined;
  const primaryId = organization?.primaryLocationId as string | undefined;
  const headquartersId = organization?.headquartersLocationId as string | undefined;
  const orientationLocation = [
    preferredId,
    headquartersId,
    primaryId,
    ...activationLocations.map((document) => document.id),
  ].map((id) => activationLocations.find((document) => document.id === id)).find(Boolean);
  const orientationData = orientationLocation?.data();
  const publicLocation = orientationLocation
    ? await store.collection("publicOrganizationLocations").doc(orientationLocation.id).get()
    : null;
  const contacts = contactSnapshot?.docs.filter((document) => document.get("status") === "active") ?? [];
  const routes = routeSnapshot?.docs.filter((document) => document.get("status") === "active") ?? [];
  const markerState = deriveBusinessActivationMarkerState({
    authorized: Boolean(membership),
    claimPending,
    organization,
    location: orientationData,
    publicLocationExists: publicLocation?.exists === true
      && publicLocation.get("coordinatePublicationApproved") === true,
  });
  const publicMarkerState = derivePublicBusinessMarkerState({
    organization,
    location: orientationData,
    publicLocationExists: publicLocation?.exists === true
      && publicLocation.get("coordinatePublicationApproved") === true,
  });
  const completedSteps = asCompleted([
    ["account_initialized", Boolean(user.accountInitializedAt)],
    ["business_representative_attestation", Boolean(user.businessRepresentativeAttestedAt)],
    ["person_essentials", Boolean(profile.personEssentialsCompletedAt)
      || Boolean(profile.displayName && profile.professionalTitle && profile.preferredPrivateEmail && profile.preferredPrivatePhone)],
    ["organization_search", Boolean(user.organizationSearchCompletedAt)],
    ["organization_connected", Boolean(membership)],
    ["organization_claim_approved", claimState === "approved" || Boolean(membership)],
    ["management_authority_active", managementAuthorityActive],
    ["enrichment_reviewed", Boolean(organization?.activationEnrichmentReviewedAt)],
    ["organization_profile", Boolean(organization?.organizationProfileCompletedAt)],
    ["primary_or_headquarters_establishment", Boolean(primaryId || headquartersId)],
    ["establishment_address", Boolean(orientationData?.physicalAddress)],
    ["establishment_geocoded", Boolean(orientationData?.geocode)],
    ["establishment_confirmed", Boolean(orientationData?.geocode?.confirmedAt)],
    ["preferred_orientation_establishment", Boolean(
      preferredId && orientationLocation?.id === preferredId
    )],
    ["organization_contact_point", contacts.length > 0],
    ["referral_route", routes.some((document) => document.get("purpose") === "referrals")],
    ["opportunity_route", routes.some((document) => document.get("purpose") === "opportunities")],
    ["directory_publication_decision", Boolean(organization)
      && Object.prototype.hasOwnProperty.call(organization, "publicationStatus")],
    ["address_publication_decision", Boolean(orientationData)
      && Object.prototype.hasOwnProperty.call(orientationData, "addressPublicationApproved")],
    ["coordinate_publication_decision", Boolean(orientationData)
      && Object.prototype.hasOwnProperty.call(orientationData, "coordinatePublicationApproved")],
    ["private_actor_marker", ["private_actor_visible", "private_and_public_visible"].includes(markerState)],
    ["public_marker", ["public_visible", "private_and_public_visible"].includes(markerState)],
    ["map_activation", Boolean(
      organizationId
      && (user.mapActivationCompletedOrganizationIds as string[] | undefined)?.includes(organizationId),
    )],
  ]);
  const completed = new Set(completedSteps);
  const step = currentStep(completed, claimPending);
  const allowedNextActions = claimPending
    ? ["view_claim_status", "view_restricted_public_preview"]
    : step === "completed"
      ? ["open_exchange", "return_to_organization_home", "manage_organization"]
      : [step];
  return {
    contractVersion: BUSINESS_ACTIVATION_CONTRACT_VERSION,
    registrationVersion: user.registrationVersion === 2 ? 2 : 1,
    guidedActivationRequired: user.registrationVersion === 2,
    currentStep: step,
    completedSteps,
    blockedSteps: claimPending ? ["organization_connected", "private_actor_marker", "organization_management"] : [],
    allowedNextActions,
    organizationId: organizationId ?? relevantClaim?.get("organizationId") ?? null,
    claimState: claimPending ? "pending" : claimState ?? (membership ? "approved" : "none"),
    managementAuthorityActive,
    primaryEstablishmentId: primaryId ?? null,
    headquartersEstablishmentId: headquartersId ?? null,
    preferredOrientationEstablishmentId: preferredId ?? null,
    markerState,
    publicMarkerState,
    safeResumeRoute: resumeRoute(step, organizationId),
  };
});

export const exchange_recordBusinessActivationProgress = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("enrichment_reviewed"), organizationId: ID }).strict(),
    z.object({
      action: z.literal("preferred_orientation"),
      organizationId: ID,
      establishmentId: ID,
    }).strict(),
    z.object({
      action: z.literal("map_activated"),
      organizationId: ID,
      establishmentId: ID,
    }).strict(),
  ]).safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid activation progress request");
  const now = Date.now();
  const store = db();
  return store.runTransaction(async (transaction) => {
    await loadOrgAuthority(transaction, store, input.data.organizationId, actor.uid, {
      managementRequired: input.data.action !== "map_activated",
    });
    if (input.data.action === "enrichment_reviewed") {
      transaction.set(store.collection("orgs").doc(input.data.organizationId), {
        activationEnrichmentReviewedAt: now,
        activationEnrichmentReviewedBy: actor.uid,
        updatedAt: now,
      }, { merge: true });
    } else if (input.data.action === "preferred_orientation") {
      const location = await transaction.get(
        store.collection("organizationLocations").doc(input.data.establishmentId),
      );
      if (
        !location.exists
        || location.get("organizationId") !== input.data.organizationId
        || location.get("status") !== "active"
        || location.get("privateHome") === true
        || ["mailing_only", "virtual"].includes(String(location.get("locationType")))
        || !location.get("physicalAddress")
        || !validCoordinate(location.get("geocode.latitude"), location.get("geocode.longitude"))
        || !location.get("geocode.confirmedAt")
      ) {
        throw new HttpsError("failed-precondition", "Choose an active, confirmed establishment");
      }
      transaction.set(store.collection("profiles").doc(actor.uid), {
        preferredOrganizationId: input.data.organizationId,
        preferredEstablishmentId: input.data.establishmentId,
        updatedAt: now,
      }, { merge: true });
    } else {
      const location = await transaction.get(
        store.collection("organizationLocations").doc(input.data.establishmentId),
      );
      if (
        !location.exists
        || location.get("organizationId") !== input.data.organizationId
        || location.get("status") !== "active"
        || location.get("privateHome") === true
        || ["mailing_only", "virtual"].includes(String(location.get("locationType")))
        || !location.get("physicalAddress")
        || !validCoordinate(location.get("geocode.latitude"), location.get("geocode.longitude"))
        || !location.get("geocode.confirmedAt")
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Map activation requires an authorized confirmed physical establishment",
        );
      }
      transaction.set(store.collection("users").doc(actor.uid), {
        mapActivationCompletedOrganizationIds:
          FieldValue.arrayUnion(input.data.organizationId),
        lastMapActivationEstablishmentId: input.data.establishmentId,
        lastMapActivationCompletedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    return { success: true, action: input.data.action, updatedAt: now };
  });
});
