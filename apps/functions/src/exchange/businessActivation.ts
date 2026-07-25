import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { sanitizePublicOrganization } from "./organizationModel";
import { getAuthorizedActor, loadOrgAuthority, writeExchangeAudit } from "./security";

export const BUSINESS_ACTIVATION_CONTRACT_VERSION = 2 as const;

const ID = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const visibilitySchema = z.enum(["exact", "approximate", "locality", "private"]);
const territoryStatusSchema = z.enum(["released", "scheduled", "paused", "archived"]);
const territoryTypeSchema = z.enum(["county", "city", "custom_polygon"]);
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
type MarkerVisibility = z.infer<typeof visibilitySchema>;
type Geography = {
  fips: string;
  name: string;
  state: string;
  status: z.infer<typeof territoryStatusSchema>;
  type: z.infer<typeof territoryTypeSchema>;
  centroid?: { lat: number; lng: number };
  selectedAt: number;
};
type OnboardingState = {
  version?: number;
  welcomeAcknowledgedAt?: number;
  geography?: Geography;
  organizationSearchCompletedAt?: number;
  organizationId?: string;
  organizationPath?: "connected" | "claim" | "created";
  claimId?: string;
  claimStartedAt?: number;
  addressConfirmedAt?: number;
  locationId?: string;
  geocodingCompletedAt?: number;
  markerActivatedAt?: number;
  markerVisibility?: MarkerVisibility;
  profileCompletionOfferedAt?: number;
  enrichmentOfferedAt?: number;
  foundingMembershipOfferedAt?: number;
  checkoutHandoffInitiatedAt?: number;
  completedAt?: number;
  updatedAt?: number;
};

function db(): FirebaseFirestore.Firestore {
  return admin.firestore();
}

function validCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

function readState(user: Data): OnboardingState {
  const value = user.exchangeOnboarding;
  return value && typeof value === "object" && !Array.isArray(value) ? value as OnboardingState : {};
}

function safeCentroid(value: unknown): { lat: number; lng: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { lat?: unknown; lng?: unknown };
  return validCoordinate(candidate.lat, candidate.lng)
    ? { lat: candidate.lat as number, lng: candidate.lng as number }
    : undefined;
}

function normalizePlace(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(county|city|town|borough|parish|municipality)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addressMatchesGeography(geography: Geography, location: Data): boolean {
  const address = location.physicalAddress as Data | undefined;
  if (!address) return false;
  if (String(address.administrativeArea ?? "").trim().toUpperCase() !== geography.state.trim().toUpperCase()) {
    return false;
  }
  if (geography.type === "custom_polygon") return true;
  const expected = normalizePlace(geography.name);
  const actual = geography.type === "county"
    ? normalizePlace(address.county)
    : normalizePlace(address.locality);
  return Boolean(expected && actual && (actual === expected || actual.includes(expected) || expected.includes(actual)));
}

function approximateCoordinate(
  organizationId: string,
  locationId: string,
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } {
  const digest = createHash("sha256").update(`${organizationId}:${locationId}`).digest();
  const bearing = (digest.readUInt16BE(0) / 65_535) * Math.PI * 2;
  const distance = 0.0025 + (digest.readUInt16BE(2) / 65_535) * 0.0035;
  return {
    latitude: Number((latitude + Math.sin(bearing) * distance).toFixed(4)),
    longitude: Number((longitude + Math.cos(bearing) * distance).toFixed(4)),
  };
}

function localityCoordinate(latitude: number, longitude: number): { latitude: number; longitude: number } {
  return { latitude: Number(latitude.toFixed(1)), longitude: Number(longitude.toFixed(1)) };
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
  if (!location.physicalAddress) return "blocked_missing_address";
  if (!location.geocode) return "blocked_missing_geocode";
  if (!validCoordinate(location.geocode.latitude, location.geocode.longitude) || !location.geocode.confirmedAt) {
    return "blocked_unconfirmed_geocode";
  }
  const organizationPublished = input.organization?.publicationStatus === "approved"
    || input.organization?.publicationApproved === true;
  if (location.privateHome === true || location.coordinatePublicationApproved !== true || !organizationPublished) {
    return "private_actor_visible";
  }
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
  if (!validCoordinate(location.geocode.latitude, location.geocode.longitude) || !location.geocode.confirmedAt) {
    return "blocked_unconfirmed_geocode";
  }
  if (input.organization?.publicationStatus !== "approved" && input.organization?.publicationApproved !== true) {
    return "blocked_organization_not_published";
  }
  if (location.coordinatePublicationApproved !== true) return "blocked_coordinate_not_approved";
  return input.publicLocationExists ? "public_visible" : "list_only";
}

function markerProjection(input: {
  organizationId: string;
  locationId: string;
  location: Data;
  visibility: MarkerVisibility;
  now: number;
}): Data | null {
  if (input.visibility === "private") return null;
  const address = input.location.physicalAddress as Data;
  const geocode = input.location.geocode as Data;
  const exact = { latitude: Number(geocode.latitude), longitude: Number(geocode.longitude) };
  const coordinate = input.visibility === "exact"
    ? exact
    : input.visibility === "approximate"
      ? approximateCoordinate(input.organizationId, input.locationId, exact.latitude, exact.longitude)
      : localityCoordinate(exact.latitude, exact.longitude);
  return {
    id: input.locationId,
    organizationId: input.organizationId,
    name: input.visibility === "locality"
      ? `${String(address.locality || address.county || "Business")} service area`
      : String(input.location.name || "Primary location"),
    locationType: input.visibility === "locality" ? "service_location" : String(input.location.locationType || "headquarters"),
    isHeadquarters: input.location.isHeadquarters === true,
    isPrimary: input.location.isPrimary === true,
    city: String(address.locality || ""),
    county: String(address.county || ""),
    administrativeArea: String(address.administrativeArea || ""),
    countryCode: String(address.countryCode || "US"),
    ...(input.visibility === "exact" ? {
      addressLine1: String(address.line1 || ""),
      postalCode: String(address.postalCode || ""),
    } : {}),
    addressPublicationApproved: input.visibility === "exact",
    coordinatePublicationApproved: true,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    coordinatePrecision: input.visibility === "locality"
      ? "locality"
      : input.visibility === "approximate" ? "street" : String(geocode.precision || "address"),
    publicContactAvailable: input.location.publicContactAvailable === true,
    version: 1,
    updatedAt: input.now,
  };
}

function pickMembership(
  memberships: FirebaseFirestore.QueryDocumentSnapshot[],
  requestedOrganizationId: string | undefined,
  state: OnboardingState,
): FirebaseFirestore.QueryDocumentSnapshot | undefined {
  const preferred = requestedOrganizationId ?? state.organizationId;
  if (preferred) return memberships.find((document) => document.get("orgId") === preferred);
  return memberships.sort((left, right) => Number(right.get("joinedAt") ?? 0) - Number(left.get("joinedAt") ?? 0))[0];
}

function determineStep(input: {
  accountCreated: boolean;
  state: OnboardingState;
  organizationConnected: boolean;
  claimPending: boolean;
  addressConfirmed: boolean;
  geocodingCompleted: boolean;
  markerActivated: boolean;
}): string {
  if (!input.accountCreated) return "account";
  if (!input.state.welcomeAcknowledgedAt) return "welcome";
  if (!input.state.geography?.fips) return "geography";
  if (!input.state.organizationSearchCompletedAt) return "organization_search";
  if (!input.organizationConnected) return input.claimPending ? "organization_claim_pending" : "organization_connection";
  if (!input.addressConfirmed || !input.geocodingCompleted) return "business_location";
  if (!input.markerActivated) return "map_activation";
  return "completed";
}

function resumeRoute(step: string, organizationId?: string): string {
  return step === "completed" && organizationId
    ? `/exchange?actorOrg=${encodeURIComponent(organizationId)}&subjectOrg=${encodeURIComponent(organizationId)}`
    : "/exchange/onboarding";
}

function analyticsEvent(action: string): string | undefined {
  return ({
    welcome_acknowledged: "registration_completed",
    geography_selected: "geography_selected",
    organization_search_completed: "organization_search_performed",
    organization_selected: "organization_found",
    organization_claim_started: "organization_claim_started",
    organization_created: "organization_created",
    address_confirmed: "address_submitted",
    geocoding_completed: "geocoding_succeeded",
    geocoding_failed: "geocoding_failed",
    marker_activated: "marker_activated",
    profile_completion_offered: "profile_completion_started",
    enrichment_offered: "enrichment_started",
    founding_membership_offered: "founding_membership_viewed",
    checkout_handoff_initiated: "checkout_handoff_initiated",
    onboarding_completed: "onboarding_completed",
  } as Record<string, string>)[action];
}

export const exchange_getBusinessActivationState = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = z.object({ organizationId: ID.optional() }).strict().safeParse(request.data ?? {});
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid onboarding request");
  const store = db();
  const [userSnapshot, profileSnapshot, membershipSnapshot, claimSnapshot] = await Promise.all([
    store.collection("users").doc(actor.uid).get(),
    store.collection("profiles").doc(actor.uid).get(),
    store.collection("orgMembers").where("uid", "==", actor.uid).limit(50).get(),
    store.collection("organizationClaims").where("requestedBy", "==", actor.uid).limit(50).get(),
  ]);
  const user = userSnapshot.data() ?? {};
  const profile = profileSnapshot.data() ?? {};
  const state = readState(user);
  const memberships = membershipSnapshot.docs.filter((document) => document.get("status") === "active");
  const membership = pickMembership(memberships, input.data.organizationId, state);
  const organizationId = membership?.get("orgId") as string | undefined;
  const claim = claimSnapshot.docs
    .filter((document) => !state.organizationId || document.get("organizationId") === state.organizationId)
    .sort((left, right) => Number(right.get("updatedAt") ?? 0) - Number(left.get("updatedAt") ?? 0))[0];
  const claimStatus = claim?.get("status") as string | undefined;
  const claimPending = claimStatus === "pending" && !membership;

  const [organizationSnapshot, locationsSnapshot, membershipPlanSnapshot, founderReservationSnapshot] = organizationId
    ? await Promise.all([
      store.collection("orgs").doc(organizationId).get(),
      store.collection("organizationLocations").where("organizationId", "==", organizationId).get(),
      store.collection("exchangeMemberships").doc(organizationId).get(),
      store.collection("exchangeFounderReservations").doc(organizationId).get(),
    ])
    : [null, null, null, null];
  const organization = organizationSnapshot?.data();
  const locations = locationsSnapshot?.docs.filter((document) => document.get("status") === "active") ?? [];
  const preferredId = profile.preferredOrganizationId === organizationId
    ? profile.preferredEstablishmentId as string | undefined
    : state.locationId;
  const primaryId = organization?.primaryLocationId as string | undefined;
  const headquartersId = organization?.headquartersLocationId as string | undefined;
  const orientation = [preferredId, headquartersId, primaryId, ...locations.map((document) => document.id)]
    .map((id) => locations.find((document) => document.id === id))
    .find(Boolean);
  const location = orientation?.data();
  const publicLocation = orientation
    ? await store.collection("publicOrganizationLocations").doc(orientation.id).get()
    : null;

  const recovered: OnboardingState = { ...state, version: 2 };
  let recoveredChanged = state.version !== 2;
  const setRecovered = <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => {
    if (value !== undefined && recovered[key] === undefined) {
      recovered[key] = value;
      recoveredChanged = true;
    }
  };
  setRecovered("organizationId", organizationId);
  setRecovered("locationId", orientation?.id);
  setRecovered("organizationSearchCompletedAt", Number(user.organizationSearchCompletedAt || 0) || undefined);
  setRecovered("addressConfirmedAt", location?.physicalAddress ? Date.now() : undefined);
  setRecovered(
    "geocodingCompletedAt",
    location?.geocode?.confirmedAt && validCoordinate(location.geocode.latitude, location.geocode.longitude)
      ? Number(location.geocode.confirmedAt)
      : undefined,
  );
  if (organizationId && (user.mapActivationCompletedOrganizationIds as string[] | undefined)?.includes(organizationId)) {
    setRecovered("markerActivatedAt", Number(user.lastMapActivationCompletedAt || Date.now()));
    setRecovered("completedAt", Number(user.lastMapActivationCompletedAt || Date.now()));
  }
  if (recoveredChanged) {
    recovered.updatedAt = Date.now();
    await userSnapshot.ref.set({ exchangeOnboarding: recovered, updatedAt: recovered.updatedAt }, { merge: true });
  }

  const addressConfirmed = Boolean(recovered.addressConfirmedAt || location?.physicalAddress);
  const geocodingCompleted = Boolean(recovered.geocodingCompletedAt || location?.geocode?.confirmedAt);
  const markerActivated = Boolean(recovered.markerActivatedAt);
  const step = determineStep({
    accountCreated: Boolean(user.accountInitializedAt),
    state: recovered,
    organizationConnected: Boolean(membership),
    claimPending,
    addressConfirmed,
    geocodingCompleted,
    markerActivated,
  });
  const markerState = deriveBusinessActivationMarkerState({
    authorized: Boolean(membership),
    claimPending,
    organization,
    location,
    publicLocationExists: publicLocation?.exists === true && publicLocation.get("coordinatePublicationApproved") === true,
  });
  const publicMarkerState = derivePublicBusinessMarkerState({
    organization,
    location,
    publicLocationExists: publicLocation?.exists === true && publicLocation.get("coordinatePublicationApproved") === true,
  });
  const completedSteps = [
    ...(user.accountInitializedAt ? ["account_created", "account_initialized"] : []),
    ...(recovered.welcomeAcknowledgedAt ? ["welcome_acknowledged"] : []),
    ...(recovered.geography ? ["geography_selected"] : []),
    ...(recovered.organizationSearchCompletedAt ? ["organization_search_completed", "organization_search"] : []),
    ...(membership ? ["organization_connected"] : []),
    ...(recovered.organizationPath === "connected" ? ["existing_organization_selected"] : []),
    ...(recovered.organizationPath === "created" ? ["organization_created"] : []),
    ...(recovered.claimStartedAt ? ["claim_initiated"] : []),
    ...(addressConfirmed ? ["address_confirmed"] : []),
    ...(geocodingCompleted ? ["geocoding_completed"] : []),
    ...(markerActivated ? ["marker_activated", "map_activation"] : []),
    ...(recovered.profileCompletionOfferedAt ? ["profile_completion_offered"] : []),
    ...(recovered.enrichmentOfferedAt ? ["enrichment_offered"] : []),
    ...(recovered.foundingMembershipOfferedAt ? ["founding_membership_offered"] : []),
    ...(recovered.completedAt ? ["onboarding_completed"] : []),
  ];

  return {
    contractVersion: BUSINESS_ACTIVATION_CONTRACT_VERSION,
    registrationVersion: user.registrationVersion === 2 ? 2 : 1,
    guidedActivationRequired: user.registrationVersion === 2,
    currentStep: step,
    completedSteps,
    blockedSteps: claimPending ? ["organization_connected", "business_location", "marker_activated"] : [],
    allowedNextActions: claimPending ? ["view_claim_status", "explore_public_exchange"] : [step],
    organizationId: organizationId ?? claim?.get("organizationId") ?? recovered.organizationId ?? null,
    organizationName: organization?.legalName ?? organization?.name ?? claim?.get("organizationName") ?? null,
    claimState: claimPending ? "pending" : claimStatus ?? (membership ? "approved" : "none"),
    managementAuthorityActive: Boolean(membership && ["owner", "admin"].includes(String(membership.get("role")))),
    primaryEstablishmentId: primaryId ?? null,
    headquartersEstablishmentId: headquartersId ?? null,
    preferredOrientationEstablishmentId: orientation?.id ?? null,
    markerState,
    publicMarkerState,
    safeResumeRoute: resumeRoute(step, organizationId),
    selectedGeography: recovered.geography ?? null,
    mapReveal: location?.geocode && validCoordinate(location.geocode.latitude, location.geocode.longitude)
      ? {
        latitude: Number(location.geocode.latitude),
        longitude: Number(location.geocode.longitude),
        zoom: 17.2,
        pitch: 52,
        bearing: -12,
        organizationId: organizationId ?? null,
        locationId: orientation?.id ?? null,
      }
      : null,
    foundingMembershipHandoff: organizationId ? {
      authenticatedUserId: actor.uid,
      organizationId,
      selectedGeography: recovered.geography ?? null,
      eligible: Boolean(membership && ["owner", "admin"].includes(String(membership.get("role")))),
      onboardingCompleted: Boolean(recovered.completedAt),
      membershipStatus: String(membershipPlanSnapshot?.get("status") ?? "none"),
      membershipTier: String(membershipPlanSnapshot?.get("tier") ?? "free"),
      isFoundingMember: membershipPlanSnapshot?.get("isFoundingMember") === true,
      founderReservation: founderReservationSnapshot?.exists
        ? { status: String(founderReservationSnapshot.get("status") ?? "reserved") }
        : null,
    } : null,
  };
});

export const exchange_recordBusinessActivationProgress = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("welcome_acknowledged") }).strict(),
    z.object({ action: z.literal("geography_selected"), fips: z.string().regex(/^\d{5}$/) }).strict(),
    z.object({ action: z.literal("organization_search_completed") }).strict(),
    z.object({ action: z.literal("organization_selected"), organizationId: ID }).strict(),
    z.object({ action: z.literal("organization_created"), organizationId: ID }).strict(),
    z.object({ action: z.literal("organization_claim_started"), organizationId: ID, claimId: ID.optional() }).strict(),
    z.object({ action: z.literal("address_confirmed"), organizationId: ID, establishmentId: ID }).strict(),
    z.object({ action: z.literal("geocoding_completed"), organizationId: ID, establishmentId: ID }).strict(),
    z.object({ action: z.literal("geocoding_failed"), organizationId: ID }).strict(),
    z.object({ action: z.literal("marker_activated"), organizationId: ID, establishmentId: ID, visibility: visibilitySchema }).strict(),
    z.object({ action: z.literal("profile_completion_offered"), organizationId: ID }).strict(),
    z.object({ action: z.literal("enrichment_offered"), organizationId: ID }).strict(),
    z.object({ action: z.literal("founding_membership_offered"), organizationId: ID }).strict(),
    z.object({ action: z.literal("checkout_handoff_initiated"), organizationId: ID }).strict(),
    z.object({ action: z.literal("onboarding_completed"), organizationId: ID }).strict(),
    z.object({ action: z.literal("enrichment_reviewed"), organizationId: ID }).strict(),
    z.object({ action: z.literal("preferred_orientation"), organizationId: ID, establishmentId: ID }).strict(),
    z.object({ action: z.literal("map_activated"), organizationId: ID, establishmentId: ID }).strict(),
  ]).safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid onboarding progress request");

  const store = db();
  const now = Date.now();
  const userRef = store.collection("users").doc(actor.uid);
  return store.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const state = readState(userSnapshot.data() ?? {});
    const patch: OnboardingState = { version: 2, updatedAt: now };
    const organizationId = "organizationId" in input.data ? input.data.organizationId : state.organizationId;
    const locationId = "establishmentId" in input.data ? input.data.establishmentId : state.locationId;
    let eventName = analyticsEvent(input.data.action);

    if (input.data.action === "welcome_acknowledged") {
      patch.welcomeAcknowledgedAt = state.welcomeAcknowledgedAt ?? now;
    } else if (input.data.action === "geography_selected") {
      const territory = await transaction.get(store.collection("territories").doc(input.data.fips));
      if (!territory.exists) throw new HttpsError("not-found", "That community is not available on the Exchange");
      const status = territoryStatusSchema.safeParse(territory.get("status"));
      const type = territoryTypeSchema.safeParse(territory.get("type") ?? "county");
      if (!status.success || !type.success) {
        throw new HttpsError("failed-precondition", "That community is not configured for the Exchange");
      }
      patch.geography = {
        fips: input.data.fips,
        name: String(territory.get("name") || "Community"),
        state: String(territory.get("state") || ""),
        status: status.data,
        type: type.data,
        ...(safeCentroid(territory.get("centroid")) ? { centroid: safeCentroid(territory.get("centroid")) } : {}),
        selectedAt: now,
      };
    } else if (input.data.action === "organization_search_completed") {
      if (!state.geography?.fips) throw new HttpsError("failed-precondition", "Choose your business community first");
      patch.organizationSearchCompletedAt = now;
    } else if (input.data.action === "organization_claim_started") {
      const claimId = input.data.claimId ?? `${input.data.organizationId}_${actor.uid}`;
      const claim = await transaction.get(store.collection("organizationClaims").doc(claimId));
      if (!claim.exists || claim.get("requestedBy") !== actor.uid || claim.get("organizationId") !== input.data.organizationId) {
        throw new HttpsError("failed-precondition", "The organization claim could not be confirmed");
      }
      patch.organizationId = input.data.organizationId;
      patch.organizationPath = "claim";
      patch.claimId = claimId;
      patch.claimStartedAt = Number(claim.get("createdAt") || now);
      patch.organizationSearchCompletedAt = state.organizationSearchCompletedAt ?? now;
    } else if (input.data.action === "organization_selected" || input.data.action === "organization_created") {
      await loadOrgAuthority(transaction, store, input.data.organizationId, actor.uid, { managementRequired: false });
      patch.organizationId = input.data.organizationId;
      patch.organizationPath = input.data.action === "organization_created" ? "created" : "connected";
      patch.organizationSearchCompletedAt = state.organizationSearchCompletedAt ?? now;
    } else if (input.data.action === "enrichment_reviewed") {
      await loadOrgAuthority(transaction, store, input.data.organizationId, actor.uid, { managementRequired: true });
      transaction.set(store.collection("orgs").doc(input.data.organizationId), {
        activationEnrichmentReviewedAt: now,
        activationEnrichmentReviewedBy: actor.uid,
        updatedAt: now,
      }, { merge: true });
      patch.enrichmentOfferedAt = state.enrichmentOfferedAt ?? now;
      eventName = undefined;
    } else if ([
      "geocoding_failed",
      "profile_completion_offered",
      "enrichment_offered",
      "founding_membership_offered",
      "checkout_handoff_initiated",
      "onboarding_completed",
    ].includes(input.data.action)) {
      await loadOrgAuthority(transaction, store, input.data.organizationId, actor.uid, { managementRequired: false });
      if (input.data.action === "profile_completion_offered") {
        patch.profileCompletionOfferedAt = state.profileCompletionOfferedAt ?? now;
      }
      if (input.data.action === "enrichment_offered") patch.enrichmentOfferedAt = state.enrichmentOfferedAt ?? now;
      if (input.data.action === "founding_membership_offered") {
        patch.foundingMembershipOfferedAt = state.foundingMembershipOfferedAt ?? now;
      }
      if (input.data.action === "checkout_handoff_initiated") patch.checkoutHandoffInitiatedAt = now;
      if (input.data.action === "onboarding_completed") {
        if (!state.markerActivatedAt) {
          throw new HttpsError("failed-precondition", "Activate the business marker before completing onboarding");
        }
        patch.completedAt = state.completedAt ?? now;
      }
    } else {
      if (!organizationId || !locationId) throw new HttpsError("invalid-argument", "Business location is required");
      const { org } = await loadOrgAuthority(transaction, store, organizationId, actor.uid, {
        managementRequired: input.data.action !== "map_activated",
      });
      const locationRef = store.collection("organizationLocations").doc(locationId);
      const locationSnapshot = await transaction.get(locationRef);
      const location = locationSnapshot.data();
      if (!locationSnapshot.exists || location?.organizationId !== organizationId || location?.status !== "active") {
        throw new HttpsError("failed-precondition", "Choose an active business location");
      }
      if (!location.physicalAddress) throw new HttpsError("failed-precondition", "Confirm the business address first");
      if (!validCoordinate(location.geocode?.latitude, location.geocode?.longitude) || !location.geocode?.confirmedAt) {
        throw new HttpsError("failed-precondition", "Confirm a valid map location first");
      }
      if (!state.geography || state.geography.status !== "released") {
        throw new HttpsError("failed-precondition", "This community is not open for full Exchange participation yet");
      }
      if (location.serviceArea?.territoryFips !== state.geography.fips || !addressMatchesGeography(state.geography, location)) {
        throw new HttpsError("failed-precondition", "The confirmed address does not match the selected business community");
      }

      if (input.data.action === "address_confirmed") {
        patch.organizationId = organizationId;
        patch.locationId = locationId;
        patch.addressConfirmedAt = now;
      } else if (input.data.action === "geocoding_completed" || input.data.action === "preferred_orientation") {
        patch.organizationId = organizationId;
        patch.locationId = locationId;
        patch.addressConfirmedAt = state.addressConfirmedAt ?? now;
        patch.geocodingCompletedAt = now;
        transaction.set(store.collection("profiles").doc(actor.uid), {
          preferredOrganizationId: organizationId,
          preferredEstablishmentId: locationId,
          updatedAt: now,
        }, { merge: true });
        if (input.data.action === "preferred_orientation") eventName = undefined;
      } else {
        const visibility: MarkerVisibility = input.data.action === "marker_activated"
          ? input.data.visibility
          : location.privateHome === true
            ? "private"
            : location.addressPublicationApproved === true
              ? "exact"
              : location.coordinatePublicationApproved === true
                ? (location.locationType === "service_location" ? "locality" : "approximate")
                : "private";
        const publicProjection = markerProjection({ organizationId, locationId, location, visibility, now });
        const published = visibility !== "private";
        const updatedOrganization = {
          ...org,
          publicationStatus: published ? "approved" : org.publicationStatus,
          publicationApproved: published ? true : org.publicationApproved,
          addressPublicationApproved: visibility === "exact",
          coordinatePublicationApproved: published,
          updatedAt: now,
        };
        transaction.set(store.collection("orgs").doc(organizationId), updatedOrganization, { merge: true });
        if (published) {
          transaction.set(
            store.collection("publicOrganizations").doc(organizationId),
            sanitizePublicOrganization(organizationId, updatedOrganization),
            { merge: true },
          );
        }
        transaction.set(locationRef, {
          addressPublicationApproved: visibility === "exact",
          coordinatePublicationApproved: published,
          privateHome: visibility === "private",
          locationType: visibility === "locality" ? "service_location" : location.locationType,
          updatedAt: now,
        }, { merge: true });
        const publicLocationRef = store.collection("publicOrganizationLocations").doc(locationId);
        if (publicProjection) transaction.set(publicLocationRef, publicProjection); else transaction.delete(publicLocationRef);
        transaction.set(store.collection("profiles").doc(actor.uid), {
          preferredOrganizationId: organizationId,
          preferredEstablishmentId: locationId,
          updatedAt: now,
        }, { merge: true });
        patch.organizationId = organizationId;
        patch.locationId = locationId;
        patch.addressConfirmedAt = state.addressConfirmedAt ?? now;
        patch.geocodingCompletedAt = state.geocodingCompletedAt ?? now;
        patch.markerActivatedAt = state.markerActivatedAt ?? now;
        patch.markerVisibility = visibility;
        patch.completedAt = state.completedAt ?? now;
        transaction.set(userRef, {
          mapActivationCompletedOrganizationIds: FieldValue.arrayUnion(organizationId),
          lastMapActivationEstablishmentId: locationId,
          lastMapActivationCompletedAt: now,
        }, { merge: true });
        if (input.data.action === "map_activated") eventName = "marker_activated";
        writeExchangeAudit(transaction, store, {
          actorUid: actor.uid,
          actorRole: actor.role,
          actorOrganizationId: organizationId,
          subjectOrganizationId: organizationId,
          action: "organization.marker.activated",
          entityType: "organization_location",
          entityId: locationId,
          newStatus: visibility,
          metadata: { visibility, territoryFips: state.geography.fips },
          createdAt: now,
        });
      }
    }

    const nextState: OnboardingState = { ...state, ...patch, geography: patch.geography ?? state.geography };
    transaction.set(userRef, { exchangeOnboarding: nextState, updatedAt: now }, { merge: true });
    if (eventName) {
      const eventRef = store.collection("exchangeOnboardingEvents").doc();
      transaction.set(eventRef, {
        id: eventRef.id,
        event: eventName,
        uid: actor.uid,
        ...(organizationId ? { organizationId } : {}),
        ...(nextState.geography?.fips ? { territoryFips: nextState.geography.fips } : {}),
        createdAt: now,
      });
    }
    return {
      success: true,
      action: input.data.action,
      updatedAt: now,
      organizationId: organizationId ?? null,
      establishmentId: locationId ?? null,
    };
  });
});
