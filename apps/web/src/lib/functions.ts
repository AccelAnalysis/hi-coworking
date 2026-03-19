import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { RfxDoc, ReferralDoc, TerritoryDoc } from "@hi/shared";

// Define input/output types for functions if not shared
type PublishRfxInput = Omit<RfxDoc, "id" | "createdAt" | "responseCount" | "updatedAt" | "geo"> & {
  geoLat?: number;
  geoLng?: number;
};

interface PublishRfxResult {
  id: string;
}

export const publishRfx = httpsCallable<PublishRfxInput, PublishRfxResult>(functions, "rfx_publish");
export const backfillRfxGeoFn = httpsCallable<
  { maxDocs?: number },
  { success: boolean; processed: number; updated: number; skipped: number }
>(functions, "rfx_backfillGeo");

// Define input/output for referral creation
type CreateReferralInput = Partial<ReferralDoc>;

interface CreateReferralResult {
  id: string;
}

export const createReferralFn = httpsCallable<CreateReferralInput, CreateReferralResult>(functions, "referral_create");

// Referral Actions
interface ReferralActionInput {
  referralId: string;
  note?: string;
  proofUrl?: string;
  method?: "manual" | "platform";
}

export const convertReferralFn = httpsCallable<ReferralActionInput, { success: boolean }>(functions, "referral_convert");
export const markReferralPaidFn = httpsCallable<ReferralActionInput, { success: boolean }>(functions, "referral_markPaid");

interface CreatePayoutInput {
  referralId: string;
  successUrl: string;
  cancelUrl: string;
}

interface CreatePayoutResult {
  sessionId: string;
  url: string;
  paymentId: string;
}

export const createPayoutCheckoutFn = httpsCallable<CreatePayoutInput, CreatePayoutResult>(functions, "referral_createPayoutCheckout");

export const acceptReferralFn = httpsCallable<{ referralId: string }, { success: boolean }>(functions, "referral_accept");
export const declineReferralFn = httpsCallable<{ referralId: string }, { success: boolean }>(functions, "referral_decline");

// Event Actions
interface RegisterFreeEventInput {
  eventId: string;
  displayName?: string;
  email?: string;
}

interface JoinEventWaitlistInput {
  eventId: string;
  displayName?: string;
  email?: string;
}

export const registerFreeEventFn = httpsCallable<RegisterFreeEventInput, { success: boolean }>(functions, "events_registerFree");
export const cancelEventRegistrationFn = httpsCallable<{ eventId: string }, { success: boolean }>(functions, "events_cancelRegistration");
export const joinEventWaitlistFn = httpsCallable<JoinEventWaitlistInput, { success: boolean }>(functions, "events_joinWaitlist");
export const upsertEventSeriesFn = httpsCallable<{ series: Record<string, unknown> }, { success: boolean; seriesId: string }>(functions, "events_upsertSeries");
export const setSeriesOccurrenceOverrideFn = httpsCallable<{
  seriesId: string;
  occurrenceDate: number;
  override?: Record<string, unknown>;
  remove?: boolean;
}, { success: boolean }>(functions, "events_setSeriesOccurrenceOverride");
export const enqueueCampaignJobsFn = httpsCallable<{ campaignId: string }, { success: boolean; enqueued: number }>(functions, "events_enqueueCampaignJobs");

interface CreateTicketCheckoutInput {
  eventId: string;
  ticketTypeId?: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
}

interface CreateTicketCheckoutResult {
  sessionId: string;
  url: string;
  paymentId: string;
}

export const createTicketCheckoutFn = httpsCallable<CreateTicketCheckoutInput, CreateTicketCheckoutResult>(functions, "events_createTicketCheckout");

interface CreateSponsorshipCheckoutInput {
  eventId: string;
  sponsorshipTierId: string;
  successUrl: string;
  cancelUrl: string;
}

interface CreateSponsorshipCheckoutResult {
  sessionId: string;
  url: string;
  paymentId: string;
}

export const createSponsorshipCheckoutFn = httpsCallable<CreateSponsorshipCheckoutInput, CreateSponsorshipCheckoutResult>(functions, "events_createSponsorshipCheckout");

// Bookstore Actions
interface CreateBookCheckoutInput {
  bookId: string;
  variantId?: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
}

interface CreateBookCheckoutResult {
  sessionId: string;
  url: string;
  paymentId: string;
}

export const createBookCheckoutFn = httpsCallable<CreateBookCheckoutInput, CreateBookCheckoutResult>(functions, "bookstore_createCheckoutSession");

export const getDownloadLinkFn = httpsCallable<{ bookId: string }, { url: string }>(functions, "bookstore_getDownloadLink");

// Territory
export const listReleasedTerritoriesFn = httpsCallable<
  Record<string, never>,
  { released: TerritoryDoc[]; scheduled: TerritoryDoc[] }
>(functions, "territory_list_released");

export type AdminTerritoryStatus = "scheduled" | "released" | "paused" | "archived";
export type AdminTerritoryType = "county" | "city" | "custom_polygon";

export const updateTerritoryFn = httpsCallable<
  {
    fips: string;
    status?: AdminTerritoryStatus;
    releaseDate?: number | null;
    notes?: string;
    name?: string;
    state?: string;
    type?: AdminTerritoryType;
    timezone?: string;
    autoReleaseEnabled?: boolean;
    autoPauseEnabled?: boolean;
    regionTag?: string;
    needsReview?: boolean;
    fipsStateCode?: string;
  },
  { success: boolean; fips: string }
>(functions, "territory_update");

export const createTerritoryFn = httpsCallable<
  {
    fips: string;
    name: string;
    state: string;
    status?: AdminTerritoryStatus;
    releaseDate?: number;
    notes?: string;
    type?: AdminTerritoryType;
    timezone?: string;
    autoReleaseEnabled?: boolean;
    autoPauseEnabled?: boolean;
    regionTag?: string;
    needsReview?: boolean;
    fipsStateCode?: string;
  },
  { success: boolean; fips: string }
>(functions, "territory_create");

export const releaseScheduledTerritoriesFn = httpsCallable<
  Record<string, never>,
  { success: boolean; releasedCount: number }
>(functions, "territory_release_scheduled");

// Profile enrichment + verification
export interface EnrichmentCandidate {
  matchId: string;
  legalName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
  duns?: string;
  confidenceScore: number;
  matchReason: string;
  source: "sam_gov" | "usaspending";
}

export const enrichmentSearchFn = httpsCallable<
  {
    businessName: string;
    city?: string;
    state?: string;
    uei?: string;
    cage?: string;
    duns?: string;
  },
  { candidates: EnrichmentCandidate[]; cached: boolean }
>(functions, "enrichment_search");

export const enrichmentLinkFn = httpsCallable<
  {
    matchId: string;
    selectedCandidate: Record<string, unknown>;
    attestationText: string;
    acknowledgedConsequences: boolean;
  },
  { success: boolean; matchId: string }
>(functions, "enrichment_link");

export const verificationSubmitFn = httpsCallable<
  {
    documents: Array<{
      id?: string;
      type: "business_license" | "ein_letter" | "utility_bill" | "government_id" | "other";
      label: string;
      storagePath: string;
      downloadUrl?: string;
    }>;
  },
  { success: boolean; verificationStatus: string; documentIds: string[] }
>(functions, "verification_submit");

export const verificationReviewFn = httpsCallable<
  {
    uid: string;
    documentId?: string;
    status?: "approved" | "rejected";
    reviewNote?: string;
    finalStatus?: "none" | "pending" | "verified" | "rejected";
  },
  { success: boolean; uid: string; verificationStatus: string }
>(functions, "verification_review");

export const verificationFlagFn = httpsCallable<
  { uid: string; reason: string },
  { success: boolean; flagId: string }
>(functions, "verification_flag");

// Teaming
export const teamCreateFn = httpsCallable<
  { rfxId: string; name: string; internalNotes?: string },
  { teamId: string }
>(functions, "team_create");

export const teamInviteFn = httpsCallable<
  { teamId: string; inviteeUid: string; role: "sub" | "estimator" | "compliance" | "proposal_writer"; note?: string },
  { inviteId: string }
>(functions, "team_invite");

export const teamRespondInviteFn = httpsCallable<
  { inviteId: string; accept: boolean },
  { success: boolean; teamId?: string }
>(functions, "team_respond_invite");

export const teamManageMemberFn = httpsCallable<
  {
    teamId: string;
    memberUid: string;
    action: "update" | "remove";
    newRole?: "sub" | "estimator" | "compliance" | "proposal_writer";
    scopeDescription?: string;
  },
  { success: boolean }
>(functions, "team_manage_member");

// RFx Suggestions
export const refreshRfxSuggestionsFn = httpsCallable<
  { uid?: string },
  { success: boolean; uid: string; count: number }
>(functions, "rfx_refreshSuggestions");

// --- Access Control ---

export interface AccessGrantSummary {
  grantId: string;
  bookingId: string;
  doorName: string;
  startsAt: number;
  endsAt: number;
  grantStatus: "pending" | "active" | "expired" | "revoked";
  codeStatus: "programming" | "active" | "failed" | "expired" | "revoked" | null;
  codeLast2: string | null;
  codeId: string | null;
}

export const accessGetMyGrantsFn = httpsCallable<
  Record<string, never>,
  { grants: AccessGrantSummary[] }
>(functions, "access_getMyGrants");

export const accessAdminRevokeFn = httpsCallable<
  { grantId: string; reason?: "cancellation" | "no_show" | "admin" | "expired" },
  { success: boolean; grantId: string }
>(functions, "access_adminRevoke");

export const accessAdminUnlockFn = httpsCallable<
  { doorId: string },
  { success: boolean; doorId: string }
>(functions, "access_adminUnlock");

export const accessAdminResendPinFn = httpsCallable<
  { grantId: string },
  { success: boolean; grantId: string }
>(functions, "access_adminResendPin");

export const accessAdminGetDoorStatusFn = httpsCallable<
  { doorId: string },
  { doorId: string; online: boolean; batteryLevel?: number; locked?: boolean }
>(functions, "access_adminGetDoorStatus");
