import { httpsCallable } from "firebase/functions";
import { app, auth, functions } from "./firebase";
import type {
  EvaluationCriterion,
  ReferralDoc,
  RequestedDocument,
  RfxDoc,
  RfxTeamDoc,
  TerritoryDoc,
} from "@hi/shared";

export interface ExchangeOrganizationCandidate {
  id: string;
  name: string;
  city?: string;
  state?: string;
  website?: string;
  claimStatus: "unclaimed" | "claim_pending" | "claimed";
  verificationStatus: string;
  sources: string[];
  confidenceScore: number;
  matchReason: string;
  canRequestClaim: boolean;
  external: boolean;
}

export interface ExchangeOrganizationClaim {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationCity: string;
  organizationState: string;
  organizationWebsite: string;
  organizationSources: string[];
  requestedBy: string;
  requesterEmail: string;
  status: "pending" | "approved" | "rejected";
  reason: string;
  reviewNote: string;
  reviewedBy: string;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
}

export const exchangeOrganizationSearchFn = httpsCallable<
  { name: string; city?: string; state?: string; website?: string },
  { candidates: ExchangeOrganizationCandidate[] }
>(functions, "exchange_organizationSearch");

export const exchangeOrganizationCreateFn = httpsCallable<
  { name: string; city?: string; state?: string; website?: string; forceCreate?: boolean; idempotencyKey?: string },
  { created: boolean; organizationId?: string; possibleMatches?: ExchangeOrganizationCandidate[]; idempotent?: boolean }
>(functions, "exchange_organizationCreate");

export const exchangeOrganizationRequestClaimFn = httpsCallable<
  { organizationId: string; reason: string },
  { success: boolean; claimId: string; organizationId: string }
>(functions, "exchange_organizationRequestClaim");

export const exchangeOrganizationListMyClaimsFn = httpsCallable<
  Record<string, never>,
  { claims: ExchangeOrganizationClaim[] }
>(functions, "exchange_organizationListMyClaims");

export const exchangeAdminListOrganizationClaimsFn = httpsCallable<
  { status?: "pending" | "approved" | "rejected" | "all" },
  { claims: ExchangeOrganizationClaim[] }
>(functions, "exchange_adminListOrganizationClaims");

export const exchangeAdminGetOrganizationClaimFn = httpsCallable<
  { claimId: string },
  { claim: ExchangeOrganizationClaim; organization: Record<string, unknown> }
>(functions, "exchange_adminGetOrganizationClaim");

export const exchangeAdminReviewOrganizationClaimFn = httpsCallable<
  { claimId: string; decision: "approve" | "reject"; reviewNote: string },
  { success: boolean; idempotent: boolean; status?: string; organizationId?: string }
>(functions, "exchange_adminReviewOrganizationClaim");

interface PublishRfxInput {
  idempotencyKey: string;
  orgId?: string;
  title: string;
  description: string;
  naicsCodes?: string[];
  location?: string;
  territoryFips: string;
  geoLat: number;
  geoLng: number;
  dueDate?: number;
  budget?: string;
  memberOnly?: boolean;
  template?: string;
  evaluationCriteria?: EvaluationCriterion[];
  requestedDocuments?: RequestedDocument[];
  adminOverrideReason?: string;
}

interface PublishRfxResult {
  id: string;
  status: string;
  adminApprovalStatus: string;
  version: number;
  creditCost: number;
}

export const publishRfx = httpsCallable<PublishRfxInput, PublishRfxResult>(functions, "rfx_publish");
export interface ManagedRfxOrganization {
  orgId: string;
  name?: string;
  role: "owner" | "admin";
}

export interface ManagedRfxResult {
  rfx: RfxDoc[];
  manageableRfxIds: string[];
  managerOrganizations: ManagedRfxOrganization[];
  activeCount: number;
  publisherActiveCounts: {
    individual: number;
    organizations: Record<string, number>;
  };
  totalCount: number;
  truncated: boolean;
  dashboardMetrics?: {
    activeBidCount: number;
    activeBidCountTruncated: boolean;
    receivedResponseCount: number;
    receivedResponseCountTruncated: boolean;
  };
}

export const listManagedRfxFn = httpsCallable<
  { maxResults?: number; includeDashboardMetrics?: boolean },
  ManagedRfxResult
>(functions, "rfx_listManaged");

export const updateRfxFn = httpsCallable<
  {
    rfxId: string;
    expectedVersion: number;
    title?: string;
    description?: string;
    naicsCodes?: string[];
    location?: string;
    dueDate?: number;
    budget?: string;
    memberOnly?: boolean;
    evaluationCriteria?: EvaluationCriterion[];
    requestedDocuments?: RequestedDocument[];
  },
  { id: string; status: string; version: number }
>(functions, "rfx_update");
export const moderateRfxFn = httpsCallable<
  {
    rfxId: string;
    decision: "approve" | "reject";
    reviewNote: string;
    expectedVersion: number;
  },
  { id: string; status: string; adminApprovalStatus: string; version: number }
>(functions, "rfx_moderate");
export const cancelRfxFn = httpsCallable<
  {
    rfxId: string;
    reason: string;
    expectedVersion: number;
    adminOverrideReason?: string;
  },
  { id: string; status: "cancelled"; version: number }
>(functions, "rfx_cancel");
export interface RfxResponseAttachmentInput {
  requestedDocId?: string;
  label: string;
  storagePath: string;
  fileName: string;
  contentType?: string;
  size?: number;
}
export const prepareRfxResponseUploadsFn = httpsCallable<
  {
    rfxId: string;
    orgId?: string;
    attachments: Array<{
      storagePath: string;
      contentType: string;
      size: number;
    }>;
  },
  { success: true; expiresAt: number; allowedPathCount: number }
>(functions, "rfx_prepareResponseUploads");
export const prepareRfxResponseDownloadFn = httpsCallable<
  { rfxId: string; respondentUid: string; storagePath: string },
  { success: true; expiresAt: number; storagePath: string }
>(functions, "rfx_prepareResponseDownload");

function privateStorageEndpointUrl(): string {
  const projectId = app.options.projectId;
  if (!projectId) throw new Error("Firebase project configuration is unavailable");
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true") {
    return `http://127.0.0.1:5004/${projectId}/us-central1/exchange_privateStorage`;
  }
  return `https://us-central1-${projectId}.cloudfunctions.net/exchange_privateStorage`;
}

async function privateStorageRequest(
  operation: "upload" | "download",
  storagePath: string,
  body?: Blob,
): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error("Authentication is required for private document access");
  const token = await user.getIdToken();
  const response = await fetch(privateStorageEndpointUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Exchange-Storage-Operation": operation,
      "X-Storage-Path": storagePath,
      ...(body?.type ? { "Content-Type": body.type } : {}),
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    let message = "Private document processing failed";
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === "string") message = payload.error;
    } catch {
      // Keep the safe fallback; private endpoint failures never expose raw bodies.
    }
    throw new Error(message);
  }
  return response;
}

export async function uploadPrivateExchangeObject(
  storagePath: string,
  file: File,
): Promise<{ storagePath: string; contentType: string; size: number }> {
  const response = await privateStorageRequest("upload", storagePath, file);
  return response.json() as Promise<{
    storagePath: string;
    contentType: string;
    size: number;
  }>;
}

export async function downloadPrivateExchangeObject(storagePath: string): Promise<Blob> {
  const response = await privateStorageRequest("download", storagePath);
  return response.blob();
}
export const submitRfxResponseFn = httpsCallable<
  {
    rfxId: string;
    orgId?: string;
    idempotencyKey: string;
    bidAmount?: number;
    experience?: number;
    timeline?: number;
    skills?: string;
    pastPerformance?: string;
    credentials?: string[];
    references?: string;
    proposalText?: string;
    proposalStoragePath?: string;
    uploadedDocuments?: RfxResponseAttachmentInput[];
  },
  { id: string; rfxId: string; status: string; version: number }
>(functions, "rfx_submitResponse");
export const evaluateRfxResponseFn = httpsCallable<
  {
    responseId: string;
    transition: "under_review" | "accepted" | "declined";
    criteriaScores?: Record<string, number>;
    evaluationNotes?: string;
    expectedRfxVersion?: number;
  },
  {
    id: string;
    rfxId: string;
    status: string;
    weightedScore?: number;
    version: number;
    rfxStatus: string;
    rfxVersion: number;
    declinedCompetitors?: number;
  }
>(functions, "rfx_evaluateResponse");
export const createReferralFn = httpsCallable<
  {
    type?: "platform_invite";
    idempotencyKey: string;
    referredEmail: string;
    referredName?: string;
    note?: string;
  },
  { id: string; idempotent?: boolean }
>(functions, "referral_create");
export const listReceivedPlatformInvitesFn = httpsCallable<
  Record<string, never>,
  { invitations: ReferralDoc[] }
>(functions, "platformInvite_listReceived");
export const listReceivedLegacyBusinessReferralsFn = httpsCallable<
  Record<string, never>,
  { referrals: ReferralDoc[] }
>(functions, "legacyBusinessReferral_listReceived");

// Referral Actions
interface ReferralActionInput {
  referralId: string;
  note?: string;
}

export const convertReferralFn = httpsCallable<ReferralActionInput, { success: boolean }>(functions, "referral_convert");
export const markReferralPaidFn = httpsCallable<
  ReferralActionInput & {
    idempotencyKey: string;
    settlementReference: string;
  },
  { success: boolean; referralId: string }
>(functions, "referral_markPaid");

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
export const contactReferralFn = httpsCallable<ReferralActionInput, { success: boolean }>(functions, "referral_contact");

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

export interface ProfileUpdateInput {
  businessName?: string;
  bio?: string;
  naicsCodes?: string[];
  certifications?: string[];
  uei?: string;
  duns?: string;
  cageCode?: string;
  capabilityStatementUrl?: string | null;
  capabilityStatementStoragePath?: string | null;
  photoUrl?: string | null;
  photoStoragePath?: string | null;
  website?: string;
  linkedin?: string;
  videoIntroUrl?: string | null;
  videoIntroStoragePath?: string | null;
  videoIntroPosterUrl?: string | null;
  videoIntroPosterStoragePath?: string | null;
  published: boolean;
}

export const profileUpdateFn = httpsCallable<
  ProfileUpdateInput,
  {
    success: boolean;
    profileCompletenessScore: number;
    readinessTier: string;
    published: boolean;
    profileSchemaVersion?: number;
  }
>(functions, "profile_update");

export const verificationSubmitFn = httpsCallable<
  {
    idempotencyKey: string;
    documents: Array<{
      type: "business_license" | "ein_letter" | "utility_bill" | "government_id" | "other";
      label: string;
      storagePath: string;
    }>;
  },
  {
    success: boolean;
    idempotentReplay: boolean;
    verificationStatus: string;
    documentIds: string[];
  }
>(functions, "verification_submit");

export const verificationReviewFn = httpsCallable<
  {
    uid: string;
    documentId?: string;
    documentStatus?: "approved" | "rejected";
    reviewNote?: string;
    finalStatus?: "pending" | "verified" | "rejected";
    expectedProfileVersion?: number;
  },
  { success: boolean; uid: string; verificationStatus: string; verificationVersion: number }
>(functions, "verification_review");

export const verificationFlagFn = httpsCallable<
  { uid: string; reason: string },
  { success: boolean; flagId: string }
>(functions, "verification_flag");

// Teaming
export const teamListMineFn = httpsCallable<
  Record<string, never>,
  { teams: RfxTeamDoc[]; truncated: boolean }
>(functions, "team_listMine");

export const teamCreateFn = httpsCallable<
  { rfxId: string; name: string; internalNotes?: string; orgId?: string; idempotencyKey: string },
  { teamId: string; replayed: boolean }
>(functions, "team_create");

export const teamInviteFn = httpsCallable<
  {
    teamId: string;
    rfxId: string;
    inviteeUid: string;
    role: "sub" | "estimator" | "compliance" | "proposal_writer";
    note?: string;
    expiresInDays?: number;
  },
  { inviteId: string; expiresAt: number }
>(functions, "team_invite");

export const teamRespondInviteFn = httpsCallable<
  { inviteId: string; response: "accepted" | "declined" },
  { ok: boolean; teamId: string; status: "accepted" | "declined"; replayed: boolean }
>(functions, "team_respond_invite");

export const teamRevokeInviteFn = httpsCallable<
  { inviteId: string; reason: string },
  { ok: boolean; inviteId: string; status: "revoked"; replayed: boolean }
>(functions, "team_revoke_invite");

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

export type BusinessReferralType =
  | "customer_introduction"
  | "business_lead"
  | "project_opportunity"
  | "service_need"
  | "partner_introduction"
  | "other";

export const createBusinessReferralFn = httpsCallable<
  {
    idempotencyKey: string;
    referrerOrgId?: string;
    recipientUid?: string;
    recipientOrgId?: string;
    referralType: BusinessReferralType;
    title: string;
    needSummary: string;
    category?: string;
    naicsCodes?: string[];
    territoryFips?: string;
    consentStatus: "not_required" | "pending" | "confirmed";
    referredParty?: {
      type: "person" | "business";
      name?: string;
      companyName?: string;
      email?: string;
      phone?: string;
    };
    compensationPolicy?: {
      type: "none" | "fixed" | "percentage" | "custom" | "benefit";
      amountCents?: number;
      percentageBasisPoints?: number;
      percentageBasis?: "first_collected_invoice" | "total_collected_contract";
      currency?: string;
      terms?: string;
      benefitDescription?: string;
    };
    serviceOfferId?: string;
    relatedRfxId?: string;
    relatedTeamId?: string;
  },
  { referralId: string; version: number; idempotent?: boolean }
>(functions, "businessReferral_create");

export const sendBusinessReferralFn = httpsCallable<
  { referralId: string; expectedVersion: number; idempotencyKey?: string },
  { success: boolean; version: number; idempotent?: boolean }
>(functions, "businessReferral_send");

export const respondBusinessReferralFn = httpsCallable<
  {
    referralId: string;
    response: "accepted" | "declined";
    expectedVersion: number;
    note?: string;
    idempotencyKey?: string;
    acceptTerms?: {
      acknowledged: true;
      serviceOfferId?: string;
      serviceOfferVersion?: number;
    };
  },
  { success: boolean; version: number; idempotent?: boolean }
>(functions, "businessReferral_respond");

export const progressBusinessReferralFn = httpsCallable<
  {
    referralId: string;
    status: "in_progress" | "converted" | "closed" | "withdrawn";
    expectedVersion: number;
    idempotencyKey?: string;
    outcome?: {
      type: "converted" | "not_a_fit" | "unable_to_contact" | "declined_by_customer" | "duplicate" | "other";
      summary?: string;
    };
  },
  { success: boolean; version: number; idempotent?: boolean }
>(functions, "businessReferral_progress");

export const updateBusinessReferralConsentFn = httpsCallable<
  { referralId: string; consentStatus: "confirmed" | "withdrawn"; expectedVersion: number },
  { success: boolean; version: number; status: string }
>(functions, "businessReferral_updateConsent");

export const prepareBusinessReferralEvidenceAccessFn = httpsCallable<
  {
    referralId: string;
    operation: "upload" | "read";
    storagePaths: string[];
  },
  {
    success: true;
    operation: "upload" | "read";
    expiresAt: number;
    allowedPathCount: number;
  }
>(functions, "businessReferral_prepareEvidenceAccess");

// Run 3 business-referral workspace queries and commerce foundation.
export interface BusinessReferralListMineInput {
  direction: "all" | "sent" | "received";
  scope: "all" | "individual" | "organization";
  orgId?: string;
  statuses: string[];
  industry?: string;
  territoryFips?: string;
  compensationPresent?: boolean;
  search?: string;
  limit: number;
  cursor?: { createdAt: number; id: string };
}

export const listBusinessReferralsFn = httpsCallable<
  BusinessReferralListMineInput,
  {
    referrals: unknown[];
    scope: { organizations: Array<{ id: string; role: string; name?: string }> };
    truncated: boolean;
    nextCursor?: { createdAt: number; id: string };
  }
>(functions, "businessReferral_listMine");

export const getBusinessReferralDetailFn = httpsCallable<
  { referralId: string },
  {
    referral: unknown;
    contact: unknown | null;
    contactRedacted: boolean;
    transactionReports: unknown[];
  }
>(functions, "businessReferral_getDetail");

export const listBusinessReferralTimelineFn = httpsCallable<
  { referralId: string; limit: number; before?: number },
  { events: unknown[]; truncated: boolean; nextBefore?: number }
>(functions, "businessReferral_listTimeline");

export interface BusinessReferralSuggestionInput {
  referralId?: string;
  referrerOrgId?: string;
  serviceCategory?: string;
  naicsCodes: string[];
  territoryFips?: string;
  limit: number;
}

export const suggestBusinessReferralRecipientsFn = httpsCallable<
  BusinessReferralSuggestionInput,
  { suggestions: unknown[]; truncated: boolean; algorithmVersion: number; notice: string }
>(functions, "businessReferral_suggestRecipients");

export const listDiscoverableReferralServiceOffersFn = httpsCallable<
  {
    limit: number;
    cursor?: string;
    serviceCategory?: string;
    naicsCode?: string;
    territoryFips?: string;
  },
  { offers: unknown[]; nextCursor?: string | null; truncated: boolean }
>(functions, "referralServiceOffer_listDiscoverable");

export interface BusinessReferralReportTransactionInput {
  referralId: string;
  idempotencyKey: string;
  expectedReferralVersion: number;
  serviceOfferId?: string;
  contractReference?: string;
  qualifyingTransactionCents: number;
  collectedTransactionCents: number;
  collectedAt: number;
  currency: string;
  evidenceStoragePaths: string[];
}

export const reportBusinessReferralTransactionFn = httpsCallable<
  BusinessReferralReportTransactionInput,
  { reportId: string; referralVersion: number; reportVersion: number; idempotent?: boolean }
>(functions, "businessReferral_reportTransaction");

export interface BusinessReferralReviewTransactionInput {
  reportId: string;
  action: "confirm" | "dispute" | "clarify";
  idempotencyKey: string;
  expectedVersion: number;
  note?: string;
}

export const reviewBusinessReferralTransactionFn = httpsCallable<
  BusinessReferralReviewTransactionInput,
  {
    reportId: string;
    status: string;
    reportVersion: number;
    referralVersion: number;
    settlementEnabled: false;
    calculation?: unknown;
    idempotent?: boolean;
  }
>(functions, "businessReferral_reviewTransaction");

export interface ReferralIntelligenceInput {
  scope: "individual" | "organization" | "platform";
  orgId?: string;
  windowDays: 30 | 90 | 365;
}

export const getReferralOverviewFn = httpsCallable<
  ReferralIntelligenceInput,
  Record<string, unknown>
>(functions, "referralIntelligence_getOverview");

export const listReferralRelationshipsFn = httpsCallable<
  ReferralIntelligenceInput & { limit: number },
  { relationships: unknown[]; truncated: boolean }
>(functions, "referralIntelligence_listRelationships");

export const getReferralGapAnalysisFn = httpsCallable<
  ReferralIntelligenceInput,
  { cells: unknown[]; truncated: boolean; privacyThreshold: unknown }
>(functions, "referralIntelligence_getGapAnalysis");

export const getReferralEconomicImpactFn = httpsCallable<
  ReferralIntelligenceInput,
  Record<string, unknown>
>(functions, "referralIntelligence_getEconomicImpact");

export const getReferralReciprocalPatternsFn = httpsCallable<
  ReferralIntelligenceInput & { limit: number },
  { patterns: unknown[]; truncated: boolean; notice: string }
>(functions, "referralIntelligence_getReciprocalPatterns");

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

// --- Exchange founding launch and organization wallet ---

export interface ExchangePublicCommercialConfiguration {
  policyVersion: string;
  featureFlags: Record<string, boolean>;
  launchMarket: {
    enabled: boolean;
    publicLabel: string;
    stateCode: string;
    countyOrLocalityName: string;
    countryCode: string;
  };
  foundingMembership: {
    enabled: boolean;
    checkoutReady: boolean;
    publicLabel: string;
    amountCents?: number;
    currency: "usd";
    billingInterval: "month";
    includedCreditsPerPeriod: number;
    foundingCapacity?: number;
    foundingEnrollmentClosesAt?: number;
    retainRecognitionAfterCancellation: boolean;
    pricingVersion: string;
    entitlementVersion: string;
  };
  creditDefinition: {
    nominalDollarValuePerCredit: 1;
    expirationCalendarMonths: 12;
    transferable: false;
    cashRedeemable: false;
    generallyRefundable: false;
    verifiedBusinessRequired: true;
    spendingOrder: "earliest_expiration_first";
  };
  creditPacks: Array<{
    key: string;
    enabled: boolean;
    checkoutReady: boolean;
    credits: number;
    amountCents: number;
    currency: "usd";
    version: string;
  }>;
  actionCosts: Record<string, { enabled: boolean; credits: number; verifiedBusinessRequired: boolean }>;
  referralFinancialPolicy: {
    enabled: boolean;
    platformFeeBps: number;
    minimumPlatformServiceFeeCents: number;
    minimumAccumulatedPayoutCents: number;
    payoutHoldDays: number;
    automatedPayoutsEnabled: false;
    policyVersion: string;
  };
}

export const getExchangePublicCommercialPolicyFn = httpsCallable<
  Record<string, never>,
  { configuration: ExchangePublicCommercialConfiguration }
>(functions, "exchange_getPublicCommercialPolicy");

export const getExchangeOrganizationWalletFn = httpsCallable<
  { organizationId: string; limit?: number },
  {
    entitlements: {
      organizationId: string;
      organizationName: string;
      verificationStatus: string;
      permissions: string[];
      tier: "free" | "founding";
      membershipStatus: "active" | "past_due" | "cancelled" | "incomplete" | "paused";
      isFoundingMember: boolean;
      foundingRecognitionRetained: boolean;
      paidEntitlementsActive: boolean;
      currentPeriodStart?: number;
      currentPeriodEnd?: number;
    };
    account: { organizationId: string; usableCredits: number; hasDeficit: boolean; manualReviewRequired?: boolean };
    expiringSoonCredits: number;
    grants: Array<Record<string, unknown>>;
    transactions: Array<Record<string, unknown>>;
    packs: ExchangePublicCommercialConfiguration["creditPacks"];
    creditTerms: ExchangePublicCommercialConfiguration["creditDefinition"];
    truncated: boolean;
  }
>(functions, "exchange_getOrganizationWallet");

export const createExchangeMembershipCheckoutFn = httpsCallable<
  { organizationId: string; key: "exchange_founding"; returnPath: string },
  { url: string; sessionId: string; paymentId: string }
>(functions, "stripe_createExchangeMembershipCheckout");

export const createExchangeCreditPackCheckoutFn = httpsCallable<
  { organizationId: string; key: string; returnPath: string },
  { url: string; sessionId: string; paymentId: string }
>(functions, "stripe_createExchangeCreditPackCheckout");

export const createExchangeBillingPortalSessionFn = httpsCallable<
  { organizationId: string; returnPath: string },
  { url: string }
>(functions, "stripe_createExchangeBillingPortalSession");

export const getExchangeAdminLaunchDashboardFn = httpsCallable<
  Record<string, never>,
  Record<string, unknown>
>(functions, "exchange_adminGetLaunchDashboard");
