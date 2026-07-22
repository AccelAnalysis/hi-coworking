import {
  createBusinessReferralFn,
  getBusinessReferralDetailFn,
  getReferralEconomicImpactFn,
  getReferralGapAnalysisFn,
  getReferralOverviewFn,
  getReferralReciprocalPatternsFn,
  listReferralRelationshipsFn,
  listBusinessReferralTimelineFn,
  listBusinessReferralsFn,
  listDiscoverableReferralServiceOffersFn,
  progressBusinessReferralFn,
  reportBusinessReferralTransactionFn,
  reviewBusinessReferralTransactionFn,
  respondBusinessReferralFn,
  sendBusinessReferralFn,
  suggestBusinessReferralRecipientsFn,
} from "@/lib/functions";
import { auth } from "@/lib/firebase";
import type {
  ExchangeCompensationFilter,
  ExchangeConnectionMode,
  ExchangeReferralStatus,
  ExchangeRelationshipFilter,
} from "../state/exchangeWorkspaceTypes";

export type ReferralCompensationType =
  | "none"
  | "fixed"
  | "percentage"
  | "custom"
  | "benefit";

export type ReferralCommerceStatus =
  | "none"
  | "awaiting_transaction"
  | "transaction_reported"
  | "awaiting_confirmation"
  | "transaction_confirmed"
  | "payout_calculated"
  | "payout_due"
  | "settlement_unavailable"
  | "disputed"
  | "cancelled"
  | "reversed"
  | "refunded";

export interface ReferralCompensationSummary {
  type: ReferralCompensationType;
  label: string;
  configured: boolean;
  currency: string;
  grossReferralPayoutCents?: number;
  platformFeeBasisPoints?: number;
  platformFeeCents?: number;
  netReferrerPayoutCents?: number;
  settlementEnabled: boolean;
}

export interface ReferralTermsSnapshotSummary {
  serviceOfferId?: string;
  serviceOfferVersion?: number;
  compensationType: ReferralCompensationType;
  compensationLabel: string;
  currency: string;
  attributionWindowDays: number;
  platformFeeBasisPoints: number;
  platformFeeConfigVersion: number;
  acceptedByLabel: string;
  acceptedAt: number;
  calculationVersion: number;
}

export interface ReferralTimelineEvent {
  id: string;
  type: string;
  label: string;
  description?: string;
  actorLabel: string;
  createdAt: number;
}

export interface ReferralLinkedEntity {
  type: "rfx" | "team" | "opportunity" | "resource_program";
  id: string;
  label: string;
  available: boolean;
}

export interface ReferralWorkspaceRecord {
  id: string;
  direction: "sent" | "received";
  status: ExchangeReferralStatus;
  activeDispute: boolean;
  referralType:
    | "customer_introduction"
    | "business_lead"
    | "project_opportunity"
    | "service_need"
    | "partner_introduction"
    | "other";
  title: string;
  needSummary: string;
  category: string;
  naicsCodes: string[];
  territoryFips?: string;
  territoryLabel?: string;
  referrerLabel: string;
  recipientLabel: string;
  actingOrganizationLabel?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  consentStatus: "not_required" | "pending" | "confirmed" | "withdrawn";
  contactDisclosure: "not_applicable" | "withheld" | "available" | "withdrawn";
  contactSummary?: string;
  compensation: ReferralCompensationSummary;
  commerceStatus: ReferralCommerceStatus;
  termsSnapshot?: ReferralTermsSnapshotSummary;
  serviceOfferId?: string;
  serviceOfferVersion?: number;
  latestTransactionReportId?: string;
  latestTransactionReportVersion?: number;
  linkedEntities: ReferralLinkedEntity[];
  timeline: ReferralTimelineEvent[];
  notes: Array<{ id: string; authorLabel: string; body: string; createdAt: number }>;
  evidenceCount: number;
}

export interface ReferralServiceOfferSummary {
  id: string;
  version: number;
  providerLabel: string;
  serviceName: string;
  serviceCategory: string;
  naicsCodes: string[];
  territoryFips: string[];
  acceptingReferrals: boolean;
  compensationType: ReferralCompensationType;
  currency: string;
  compensationLabel: string;
  effectiveAt: number;
}

export interface RecipientSuggestion {
  id: string;
  providerUid?: string;
  providerOrgId?: string;
  providerLabel: string;
  score: number;
  matchedCapabilities: string[];
  territoryExplanation: string;
  relationshipState: "new" | "active" | "established" | "trusted";
  acceptingReferrals: boolean;
  compensationConfigured: boolean;
  serviceOffer?: ReferralServiceOfferSummary;
  reasons: string[];
}

export interface ReferralWorkspaceSnapshot {
  records: ReferralWorkspaceRecord[];
  suggestions: RecipientSuggestion[];
  serviceOffers: ReferralServiceOfferSummary[];
  counts: Record<ExchangeConnectionMode, number>;
  generatedAt: number;
  truncated: boolean;
}

export interface ReferralNetworkMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  sampleSize: number;
}

export interface ReferralRelationshipInsight {
  id: string;
  partnerLabel: string;
  state: "new" | "active" | "established" | "trusted" | "review_required";
  acceptedReferrals: number;
  confirmedConversions: number;
  medianResponseHours?: number;
  disputes: number;
  relationshipDays?: number;
  sampleSize: number;
  factors: string[];
  explanation: string;
}

export interface ReferralGapInsight {
  id: string;
  dimension: "industry" | "territory";
  label: string;
  demandCount: number;
  activeRecipientCount: number;
  unansweredDemand: number;
  conversionRate?: number;
  suppressed: boolean;
  explanation: string;
}

export interface ReferralReciprocalPattern {
  id: string;
  partnerLabel: string;
  classification:
    | "normal_reciprocity"
    | "high_reciprocity"
    | "concentrated_pair"
    | "review_recommended";
  referralsEachDirection: string;
  sampleSize: number;
  notice: string;
  factors: string[];
}

export interface ReferralEconomicImpactCurrency {
  currency: string;
  reportedTransactionValueCents: number;
  confirmedTransactionValueCents: number;
  grossReferralPayoutCents: number;
  platformFeeCents: number;
  netReferrerBenefitCents: number;
}

export interface ReferralIntelligenceSnapshot {
  generatedAt: number;
  windowLabel: string;
  calculationVersion: number;
  privacyThreshold: number;
  scopeLabel: string;
  networkMetrics: ReferralNetworkMetric[];
  relationships: ReferralRelationshipInsight[];
  industryGaps: ReferralGapInsight[];
  territoryGaps: ReferralGapInsight[];
  reciprocalPatterns: ReferralReciprocalPattern[];
  economicImpact: {
    referralsInitiated: number;
    referralsAccepted: number;
    confirmedConversions: number;
    businessesConnected: number;
    newRelationshipsFormed?: number;
    industriesConnected: number;
    territoriesConnected: number;
    nonCashBenefits: number;
    rfxOpportunitiesLinked: number;
    teamsLinked: number;
    currencies: ReferralEconomicImpactCurrency[];
  };
  notices: string[];
}

export interface ConnectionQuery {
  actorOrganizationId?: string;
  mode: ExchangeConnectionMode;
  searchQuery: string;
  statuses: ExchangeReferralStatus[];
  industries: string[];
  territories: string[];
  compensation: ExchangeCompensationFilter;
  relationship: ExchangeRelationshipFilter;
}

export interface CreateReferralDraftInput {
  idempotencyKey: string;
  actorOrganizationId?: string;
  referrerOrgId?: string;
  recipientUid?: string;
  recipientOrgId?: string;
  recipientLabel: string;
  referralType: ReferralWorkspaceRecord["referralType"];
  title: string;
  needSummary: string;
  category: string;
  naicsCodes: string[];
  territoryFips?: string;
  consentStatus: "not_required" | "pending" | "confirmed";
  referredParty?: {
    type: "person" | "business";
    name?: string;
    companyName?: string;
    email?: string;
    phone?: string;
  };
  serviceOfferId?: string;
  compensationType: ReferralCompensationType;
  currency: string;
  fixedCompensationCents?: number;
  compensationRateBasisPoints?: number;
  customTerms?: string;
  benefitDescription?: string;
  relatedRfxId?: string;
  relatedTeamId?: string;
}

export interface ExchangeRun3Gateway {
  readonly mode: "live" | "demo";
  listConnections(query: ConnectionQuery): Promise<ReferralWorkspaceSnapshot>;
  suggestRecipients(input: {
    actorOrganizationId?: string;
    referrerOrgId?: string;
    serviceCategory?: string;
    naicsCodes: string[];
    territoryFips?: string;
  }): Promise<RecipientSuggestion[]>;
  getReferralDetail(
    referralId: string,
    actorOrganizationId?: string,
  ): Promise<ReferralWorkspaceRecord>;
  createReferralDraft(input: CreateReferralDraftInput): Promise<ReferralWorkspaceRecord>;
  sendReferral(
    referralId: string,
    expectedVersion: number,
    actorOrganizationId?: string,
  ): Promise<ReferralWorkspaceRecord>;
  respondReferral(
    referralId: string,
    response: "accepted" | "declined",
    expectedVersion: number,
    acceptTerms?: {
      acknowledged: true;
      serviceOfferId?: string;
      serviceOfferVersion?: number;
    },
    actorOrganizationId?: string,
  ): Promise<ReferralWorkspaceRecord>;
  progressReferral(
    referralId: string,
    status: "in_progress" | "converted" | "closed" | "withdrawn",
    expectedVersion: number,
    actorOrganizationId?: string,
  ): Promise<ReferralWorkspaceRecord>;
  reportTransaction(
    referralId: string,
    expectedVersion: number,
    collectedTransactionCents: number,
    currency: string,
    serviceOfferId?: string,
    actorOrganizationId?: string,
  ): Promise<ReferralWorkspaceRecord>;
  confirmTransaction(
    referralId: string,
    reportId: string,
    expectedReportVersion: number,
    actorOrganizationId?: string,
  ): Promise<ReferralWorkspaceRecord>;
  getIntelligence(actorOrganizationId?: string): Promise<ReferralIntelligenceSnapshot>;
}

type UnknownRecord = Record<string, unknown>;

function objectValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((candidate) => stringValue(candidate) ? [String(candidate)] : [])
    : [];
}

function compensationType(value: unknown): ReferralCompensationType {
  return ["fixed", "percentage", "custom", "benefit"].includes(String(value))
    ? value as ReferralCompensationType
    : "none";
}

function compensationLabel(
  type: ReferralCompensationType,
  source: UnknownRecord,
): string {
  const currency = stringValue(source.currency) ?? "USD";
  if (type === "fixed") {
    const cents = numberValue(source.fixedCompensationCents);
    return cents === undefined
      ? "Fixed referral compensation"
      : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  }
  if (type === "percentage") {
    const basisPoints = numberValue(source.compensationRateBasisPoints);
    return basisPoints === undefined
      ? "Percentage of first collected invoice"
      : `${basisPoints / 100}% of the first collected invoice`;
  }
  if (type === "benefit") return stringValue(source.benefitDescription) ?? "Non-cash benefit";
  if (type === "custom") return "Custom referral terms";
  return "No compensation";
}

function adaptOffer(value: unknown): ReferralServiceOfferSummary | null {
  const offer = objectValue(value);
  const id = stringValue(offer.id) ?? stringValue(offer.offerId);
  if (!id) return null;
  const type = compensationType(offer.compensationType);
  return {
    id,
    version: numberValue(offer.version) ?? 1,
    providerLabel: stringValue(offer.providerDisplayName)
      ?? (stringValue(offer.providerOrgId) ? "Published organization" : "Published provider"),
    serviceName: stringValue(offer.serviceName) ?? "Referral service",
    serviceCategory: stringValue(offer.serviceCategory) ?? "Published capability",
    naicsCodes: stringValues(offer.naicsCodes),
    territoryFips: stringValues(offer.territoryFips),
    acceptingReferrals: offer.acceptingReferrals === true,
    compensationType: type,
    currency: stringValue(offer.currency) ?? "USD",
    compensationLabel: compensationLabel(type, offer),
    effectiveAt: numberValue(offer.effectiveAt) ?? 0,
  };
}

function humanizeSignal(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function adaptSuggestion(
  value: unknown,
  offers: ReferralServiceOfferSummary[],
): RecipientSuggestion | null {
  const suggestion = objectValue(value);
  const offerId = stringValue(suggestion.serviceOfferId);
  const providerUid = stringValue(suggestion.providerUid);
  const providerOrgId = stringValue(suggestion.providerOrgId);
  if (!offerId || (!providerUid && !providerOrgId)) return null;
  const offer = offers.find((candidate) => candidate.id === offerId);
  const matchedNaics = stringValues(suggestion.matchedNaicsCodes);
  const serviceCategory = stringValue(suggestion.serviceCategory);
  return {
    id: `suggestion-${offerId}`,
    providerUid,
    providerOrgId,
    providerLabel: stringValue(suggestion.providerName) ?? offer?.providerLabel ?? "Published provider",
    score: Math.max(0, Math.min(100, numberValue(suggestion.score) ?? 0)),
    matchedCapabilities: [
      ...(serviceCategory ? [serviceCategory] : []),
      ...matchedNaics.map((code) => `NAICS ${code}`),
    ],
    territoryExplanation: suggestion.territoryMatch === true
      ? "Published service territory matches the requested FIPS."
      : "No exact requested-territory match was asserted.",
    relationshipState: "new",
    acceptingReferrals: suggestion.acceptingReferrals === true,
    compensationConfigured: suggestion.compensationConfigured === true,
    serviceOffer: offer,
    reasons: stringValues(suggestion.reasons).map(humanizeSignal),
  };
}

interface ReferralMappingContext {
  actorUid?: string;
  organizations: Map<string, string>;
  contact?: unknown;
  contactRedacted?: boolean;
  transactionReports?: unknown[];
  timeline?: unknown[];
}

function validStatus(value: unknown): ExchangeReferralStatus {
  const candidate = String(value);
  return [
    "draft", "sent", "accepted", "declined", "in_progress", "converted",
    "closed", "withdrawn", "expired",
  ].includes(candidate) ? candidate as ExchangeReferralStatus : "draft";
}

function validCommerceStatus(value: unknown): ReferralCommerceStatus {
  const candidate = String(value);
  return [
    "awaiting_transaction", "transaction_reported", "awaiting_confirmation",
    "transaction_confirmed", "payout_calculated", "payout_due",
    "settlement_unavailable", "disputed", "cancelled", "reversed", "refunded",
  ].includes(candidate) ? candidate as ReferralCommerceStatus : "none";
}

function adaptReferral(
  value: unknown,
  context: ReferralMappingContext,
): ReferralWorkspaceRecord {
  const referral = objectValue(value);
  const referrerOrgId = stringValue(referral.referrerOrgId);
  const recipientOrgId = stringValue(referral.recipientOrgId);
  const sent = stringValue(referral.referrerUid) === context.actorUid
    || Boolean(referrerOrgId && context.organizations.has(referrerOrgId));
  const acceptedTerms = objectValue(referral.acceptedTermsSnapshot);
  const reports = context.transactionReports ?? [];
  const latestReport = objectValue(reports[0]);
  const calculation = objectValue(latestReport.calculation);
  const type = compensationType(
    acceptedTerms.compensationType ?? referral.compensationType,
  );
  const consentCandidate = String(referral.consentStatus);
  const consentStatus = ["not_required", "pending", "confirmed", "withdrawn"].includes(consentCandidate)
    ? consentCandidate as ReferralWorkspaceRecord["consentStatus"]
    : "pending";
  const contact = objectValue(context.contact);
  const contactParts = [contact.name, contact.companyName, contact.email, contact.phone]
    .flatMap((candidate) => stringValue(candidate) ? [String(candidate)] : []);
  const contactDisclosure = consentStatus === "withdrawn"
    ? "withdrawn"
    : contactParts.length
      ? "available"
      : context.contactRedacted
        ? "withheld"
        : "not_applicable";
  const referralTypeCandidate = String(referral.referralType);
  const referralType = [
    "customer_introduction", "business_lead", "project_opportunity",
    "service_need", "partner_introduction", "other",
  ].includes(referralTypeCandidate)
    ? referralTypeCandidate as ReferralWorkspaceRecord["referralType"]
    : "other";
  const linkedEntities: ReferralLinkedEntity[] = [];
  const relatedRfxId = stringValue(referral.relatedRfxId);
  const relatedTeamId = stringValue(referral.relatedTeamId);
  const relatedOpportunityId = stringValue(referral.relatedOpportunityId);
  if (relatedRfxId) linkedEntities.push({ type: "rfx", id: relatedRfxId, label: "Linked RFx opportunity", available: true });
  if (relatedTeamId) linkedEntities.push({ type: "team", id: relatedTeamId, label: "Linked RFx team", available: true });
  if (relatedOpportunityId) linkedEntities.push({ type: "opportunity", id: relatedOpportunityId, label: "Linked opportunity", available: false });
  const termsType = compensationType(acceptedTerms.compensationType);
  const acceptedAt = numberValue(acceptedTerms.acceptedAt);
  const termsSnapshot = acceptedAt === undefined ? undefined : {
    serviceOfferId: stringValue(acceptedTerms.serviceOfferId),
    serviceOfferVersion: numberValue(acceptedTerms.serviceOfferVersion),
    compensationType: termsType,
    compensationLabel: compensationLabel(termsType, acceptedTerms),
    currency: stringValue(acceptedTerms.currency) ?? "USD",
    attributionWindowDays: numberValue(acceptedTerms.attributionWindowDays) ?? 0,
    platformFeeBasisPoints: numberValue(acceptedTerms.platformFeeBasisPoints) ?? 100,
    platformFeeConfigVersion: numberValue(acceptedTerms.platformFeeConfigVersion) ?? 1,
    acceptedByLabel: "Authorized recipient",
    acceptedAt,
    calculationVersion: numberValue(acceptedTerms.calculationVersion) ?? 1,
  } satisfies ReferralTermsSnapshotSummary;
  const note = stringValue(referral.recipientResponseNote);
  const timeline = (context.timeline ?? []).map((candidate, index) => {
    const event = objectValue(candidate);
    const typeValue = stringValue(event.eventType) ?? "updated";
    return {
      id: stringValue(event.id) ?? `event-${index + 1}`,
      type: typeValue,
      label: humanizeSignal(typeValue),
      actorLabel: stringValue(event.actorRole) ? `${humanizeSignal(String(event.actorRole))} actor` : "Authorized actor",
      createdAt: numberValue(event.occurredAt) ?? 0,
    };
  });
  const referrerLabel = referrerOrgId
    ? context.organizations.get(referrerOrgId) ?? "Referring organization"
    : stringValue(referral.referrerUid) === context.actorUid ? "You" : "Referring member";
  const recipientLabel = recipientOrgId
    ? context.organizations.get(recipientOrgId) ?? "Recipient organization"
    : stringValue(referral.recipientUid) === context.actorUid ? "You" : "Recipient member";
  return {
    id: stringValue(referral.id) ?? "unavailable-referral",
    direction: sent ? "sent" : "received",
    status: validStatus(referral.status),
    activeDispute: referral.activeDispute === true,
    referralType,
    title: stringValue(referral.title) ?? "Business referral",
    needSummary: stringValue(referral.needSummary) ?? "",
    category: stringValue(referral.category) ?? "Uncategorized",
    naicsCodes: stringValues(referral.naicsCodes),
    territoryFips: stringValue(referral.territoryFips),
    territoryLabel: stringValue(referral.territoryFips),
    referrerLabel,
    recipientLabel,
    actingOrganizationLabel: sent && referrerOrgId
      ? context.organizations.get(referrerOrgId)
      : !sent && recipientOrgId
        ? context.organizations.get(recipientOrgId)
        : undefined,
    createdAt: numberValue(referral.createdAt) ?? 0,
    updatedAt: numberValue(referral.updatedAt) ?? 0,
    version: numberValue(referral.version) ?? 0,
    consentStatus,
    contactDisclosure,
    contactSummary: contactParts.length ? contactParts.join(" · ") : undefined,
    compensation: {
      type,
      label: compensationLabel(type, Object.keys(acceptedTerms).length ? acceptedTerms : referral),
      configured: type !== "none",
      currency: stringValue(acceptedTerms.currency) ?? stringValue(latestReport.currency) ?? "USD",
      grossReferralPayoutCents: numberValue(calculation.grossReferralPayoutCents),
      platformFeeBasisPoints: numberValue(calculation.platformFeeBasisPointsSnapshot)
        ?? numberValue(acceptedTerms.platformFeeBasisPoints),
      platformFeeCents: numberValue(calculation.platformFeeCents),
      netReferrerPayoutCents: numberValue(calculation.netReferrerPayoutCents),
      settlementEnabled: false,
    },
    commerceStatus: validCommerceStatus(referral.commerceStatus),
    termsSnapshot,
    serviceOfferId: stringValue(referral.serviceOfferId),
    serviceOfferVersion: numberValue(referral.serviceOfferVersion),
    latestTransactionReportId: stringValue(latestReport.id) ?? stringValue(referral.latestTransactionReportId),
    latestTransactionReportVersion: numberValue(latestReport.version),
    linkedEntities,
    timeline,
    notes: note ? [{ id: "recipient-response", authorLabel: "Authorized recipient", body: note, createdAt: numberValue(referral.respondedAt) ?? 0 }] : [],
    evidenceCount: reports.reduce<number>((total, report) => total + (numberValue(objectValue(report).evidenceCount) ?? 0), 0),
  };
}

function modeMatches(record: ReferralWorkspaceRecord, mode: ExchangeConnectionMode): boolean {
  if (mode === "sent") return record.direction === "sent" && record.status !== "draft";
  if (mode === "received") return record.direction === "received";
  if (mode === "draft") return record.status === "draft";
  if (mode === "active") return ["sent", "accepted", "in_progress"].includes(record.status) && !record.activeDispute;
  if (mode === "converted") return record.status === "converted" && !record.activeDispute;
  if (mode === "closed") return ["closed", "declined", "withdrawn", "expired"].includes(record.status);
  return record.activeDispute;
}

function connectionCounts(records: ReferralWorkspaceRecord[]): Record<ExchangeConnectionMode, number> {
  return {
    sent: records.filter((record) => modeMatches(record, "sent")).length,
    received: records.filter((record) => modeMatches(record, "received")).length,
    draft: records.filter((record) => modeMatches(record, "draft")).length,
    active: records.filter((record) => modeMatches(record, "active")).length,
    converted: records.filter((record) => modeMatches(record, "converted")).length,
    closed: records.filter((record) => modeMatches(record, "closed")).length,
    disputed: records.filter((record) => modeMatches(record, "disputed")).length,
  };
}

function networkMetrics(value: unknown): ReferralNetworkMetric[] {
  const metrics = objectValue(value);
  const sent = numberValue(metrics.referralsSent) ?? 0;
  const received = numberValue(metrics.referralsReceived) ?? 0;
  const total = sent + received;
  const output: ReferralNetworkMetric[] = [];
  const add = (id: string, label: string, raw: unknown, display: (number: number) => string, detail: string, sample = total) => {
    const number = numberValue(raw);
    if (number === undefined) return;
    output.push({ id, label, value: display(number), detail, sampleSize: sample });
  };
  add("partners", "Unique partners", metrics.uniquePartners, String, "Distinct authorized referral partners");
  add("sent", "Referrals sent", metrics.referralsSent, String, "Business referrals initiated in this scope", sent);
  add("received", "Referrals received", metrics.referralsReceived, String, "Business referrals received in this scope", received);
  add("acceptance", "Acceptance rate", metrics.acceptanceRate, (number) => `${Math.round(number * 100)}%`, "Accepted received referrals", received);
  add("conversion", "Confirmed conversion rate", metrics.conversionRate, (number) => `${Math.round(number * 100)}%`, "Conversions supported by confirmed transaction state", numberValue(metrics.acceptedReferrals) ?? total);
  add("response", "Median response", metrics.medianResponseTimeHours, (number) => `${Math.round(number)}h`, "Median time from send to recipient response");
  add("repeat", "Repeat partner rate", metrics.repeatPartnerRate, (number) => `${Math.round(number * 100)}%`, "Partners represented by more than one referral");
  add("concentration", "Largest partner share", metrics.largestPartnerShare, (number) => `${Math.round(number * 100)}%`, "Network concentration in the largest partner");
  return output;
}

function adaptIntelligence(parts: {
  overview: unknown;
  relationships: unknown[];
  gaps: unknown[];
  reciprocal: unknown[];
  reciprocalNotice?: string;
  impact: unknown;
}): ReferralIntelligenceSnapshot {
  const overview = objectValue(parts.overview);
  const metrics = objectValue(overview.metrics);
  const impactEnvelope = objectValue(parts.impact);
  const impact = objectValue(impactEnvelope.impact);
  const relationshipRecords = parts.relationships.map((value, index) => {
    const relationship = objectValue(value);
    const factors = objectValue(relationship.factors);
    const stateCandidate = String(relationship.state);
    const state = ["new", "active", "established", "trusted", "review_required"].includes(stateCandidate)
      ? stateCandidate as ReferralRelationshipInsight["state"]
      : "new";
    const reasons = stringValues(relationship.reasons).map(humanizeSignal);
    return {
      id: `relationship-${index + 1}`,
      partnerLabel: `Authorized partner ${index + 1}`,
      state,
      acceptedReferrals: numberValue(factors.acceptedReferrals) ?? 0,
      confirmedConversions: numberValue(factors.confirmedConversions) ?? 0,
      medianResponseHours: numberValue(factors.medianResponseTimeHours),
      disputes: numberValue(factors.disputesOpened) ?? 0,
      sampleSize: numberValue(relationship.sampleSize) ?? 0,
      factors: reasons,
      explanation: stringValue(relationship.notice)
        ?? "Relationship classifications are contextual and use verified business-referral history.",
    } satisfies ReferralRelationshipInsight;
  });
  const gapRecords = parts.gaps.flatMap((value, index) => {
    const gap = objectValue(value);
    const dimension = gap.dimension === "territory" ? "territory" : gap.dimension === "industry" ? "industry" : null;
    if (!dimension) return [];
    const suppressed = gap.privacyStatus === "suppressed";
    const key = stringValue(gap.key) ?? `Aggregate ${index + 1}`;
    return [{
      id: `gap-${dimension}-${index + 1}`,
      dimension,
      label: humanizeSignal(key.replaceAll(":", " ")),
      demandCount: suppressed ? 0 : numberValue(gap.demandCount) ?? 0,
      activeRecipientCount: suppressed ? 0 : numberValue(gap.activeRecipientCount) ?? 0,
      unansweredDemand: suppressed ? 0 : numberValue(gap.unansweredDemandCount) ?? 0,
      suppressed,
      explanation: suppressed
        ? "Values are hidden because the aggregate is below the configured privacy threshold."
        : "Demand and recipient capacity are calculated from authorized referrals and published service offers.",
    } satisfies ReferralGapInsight];
  });
  const reciprocal = parts.reciprocal.map((value, index) => {
    const pattern = objectValue(value);
    const classificationCandidate = String(pattern.classification);
    const classification = ["normal_reciprocity", "high_reciprocity", "concentrated_pair", "review_recommended"].includes(classificationCandidate)
      ? classificationCandidate as ReferralReciprocalPattern["classification"]
      : "normal_reciprocity";
    const sampleSize = numberValue(pattern.sampleSize) ?? 0;
    return {
      id: `reciprocal-${index + 1}`,
      partnerLabel: `Authorized partner ${index + 1}`,
      classification,
      referralsEachDirection: `${sampleSize} referrals in the pair sample`,
      sampleSize,
      notice: stringValue(pattern.userNotice) ?? "Reciprocal patterns provide context only.",
      factors: stringValues(pattern.factors).map(humanizeSignal),
    } satisfies ReferralReciprocalPattern;
  });
  const currencies = Object.entries(objectValue(impact.currencies)).map(([currency, value]) => {
    const totals = objectValue(value);
    return {
      currency,
      reportedTransactionValueCents: numberValue(totals.reportedTransactionCents) ?? 0,
      confirmedTransactionValueCents: numberValue(totals.confirmedTransactionCents) ?? 0,
      grossReferralPayoutCents: numberValue(totals.grossReferralPayoutCents) ?? 0,
      platformFeeCents: numberValue(totals.calculatedPlatformFeeCents) ?? 0,
      netReferrerBenefitCents: numberValue(totals.netReferrerBenefitCents) ?? 0,
    };
  });
  const dataQualityNotice = stringValue(overview.dataQualityNotice);
  return {
    generatedAt: Date.now(),
    windowLabel: "Trailing 12 months",
    calculationVersion: numberValue(metrics.calculationVersion)
      ?? numberValue(impact.calculationVersion)
      ?? 1,
    privacyThreshold: numberValue(overview.minimumRecords) ?? 5,
    scopeLabel: "Current member — authorized individual business-referral activity",
    networkMetrics: networkMetrics(overview.metrics),
    relationships: relationshipRecords,
    industryGaps: gapRecords.filter((gap) => gap.dimension === "industry"),
    territoryGaps: gapRecords.filter((gap) => gap.dimension === "territory"),
    reciprocalPatterns: reciprocal,
    economicImpact: {
      referralsInitiated: numberValue(impact.referralsInitiated) ?? 0,
      referralsAccepted: numberValue(impact.referralsAccepted) ?? 0,
      confirmedConversions: numberValue(impact.confirmedConversions) ?? 0,
      businessesConnected: numberValue(impact.businessesConnected) ?? 0,
      industriesConnected: numberValue(impact.industriesConnected) ?? 0,
      territoriesConnected: numberValue(impact.territoriesConnected) ?? 0,
      nonCashBenefits: numberValue(impact.nonCashBenefitReferrals) ?? 0,
      rfxOpportunitiesLinked: numberValue(impact.rfxOpportunitiesLinked) ?? 0,
      teamsLinked: numberValue(impact.teamsLinked) ?? 0,
      currencies,
    },
    notices: [
      ...(dataQualityNotice ? [dataQualityNotice] : []),
      ...(parts.reciprocalNotice ? [parts.reciprocalNotice] : []),
      "Reported and confirmed values are shown separately; no cross-currency conversion is applied.",
      "Platform membership invitations and protected contact data are excluded.",
    ],
  };
}

export function createLiveExchangeRun3Gateway(): ExchangeRun3Gateway {
  interface ActorCache {
    organizations: Map<string, string>;
    offers: ReferralServiceOfferSummary[];
  }
  const actorCaches = new Map<string, ActorCache>();
  const latestListRequestByActor = new Map<string, number>();
  let listRequestSequence = 0;
  const actorCacheKey = (actorOrganizationId?: string) => (
    actorOrganizationId ? `organization:${actorOrganizationId}` : "individual"
  );
  const cacheForActor = (actorOrganizationId?: string): ActorCache => (
    actorCaches.get(actorCacheKey(actorOrganizationId)) ?? {
      organizations: new Map<string, string>(),
      offers: [],
    }
  );

  const gateway: ExchangeRun3Gateway = {
    mode: "live",
    async listConnections(query) {
      const cacheKey = actorCacheKey(query.actorOrganizationId);
      const requestSequence = ++listRequestSequence;
      latestListRequestByActor.set(cacheKey, requestSequence);
      const [listResult, offersResult] = await Promise.all([
        listBusinessReferralsFn({
          direction: "all",
          scope: query.actorOrganizationId ? "organization" : "individual",
          actorOrganizationId: query.actorOrganizationId,
          statuses: query.statuses,
          industry: query.industries[0],
          territoryFips: /^\d{5}$/.test(query.territories[0] ?? "")
            ? query.territories[0]
            : undefined,
          compensationPresent: query.compensation === "all"
            ? undefined
            : query.compensation === "configured",
          search: query.searchQuery || undefined,
          limit: 100,
        }),
        listDiscoverableReferralServiceOffersFn({ limit: 40 }),
      ]);
      const organizations = new Map(listResult.data.scope.organizations
        .filter((organization) => organization.id === query.actorOrganizationId)
        .map((organization) => [
          organization.id,
          organization.name ?? "Authorized organization",
        ]));
      const offers = offersResult.data.offers.flatMap((value) => {
        const offer = adaptOffer(value);
        return offer ? [offer] : [];
      });
      if (latestListRequestByActor.get(cacheKey) === requestSequence) {
        actorCaches.set(cacheKey, { organizations, offers });
      }
      const allRecords = listResult.data.referrals.map((referral) => adaptReferral(referral, {
        actorUid: auth.currentUser?.uid,
        organizations,
      }));
      return {
        records: allRecords.filter((record) => modeMatches(record, query.mode)),
        suggestions: [],
        serviceOffers: offers,
        counts: connectionCounts(allRecords),
        generatedAt: Date.now(),
        truncated: listResult.data.truncated || offersResult.data.truncated,
      };
    },
    async suggestRecipients(input) {
      const cachedOffers = cacheForActor(input.actorOrganizationId).offers;
      const result = await suggestBusinessReferralRecipientsFn({
        actorOrganizationId: input.actorOrganizationId,
        referrerOrgId: input.referrerOrgId,
        serviceCategory: input.serviceCategory,
        naicsCodes: input.naicsCodes,
        territoryFips: input.territoryFips,
        limit: 12,
      });
      return result.data.suggestions.flatMap((value) => {
        const suggestion = adaptSuggestion(value, cachedOffers);
        return suggestion ? [suggestion] : [];
      });
    },
    async getReferralDetail(referralId, actorOrganizationId) {
      const { organizations } = cacheForActor(actorOrganizationId);
      const [detail, timeline] = await Promise.all([
        getBusinessReferralDetailFn({ referralId, actorOrganizationId }),
        listBusinessReferralTimelineFn({ referralId, actorOrganizationId, limit: 100 }),
      ]);
      return adaptReferral(detail.data.referral, {
        actorUid: auth.currentUser?.uid,
        organizations,
        contact: detail.data.contact,
        contactRedacted: detail.data.contactRedacted,
        transactionReports: detail.data.transactionReports,
        timeline: timeline.data.events,
      });
    },
    async createReferralDraft(input) {
      const result = await createBusinessReferralFn({
        idempotencyKey: input.idempotencyKey,
        actorOrganizationId: input.actorOrganizationId,
        referrerOrgId: input.referrerOrgId,
        recipientUid: input.recipientUid,
        recipientOrgId: input.recipientOrgId,
        referralType: input.referralType,
        title: input.title,
        needSummary: input.needSummary,
        category: input.category || undefined,
        naicsCodes: input.naicsCodes,
        territoryFips: input.territoryFips,
        consentStatus: input.consentStatus,
        referredParty: input.referredParty,
        compensationPolicy: input.serviceOfferId
          ? undefined
          : input.compensationType === "none"
            ? { type: "none" }
            : input.compensationType === "fixed"
              ? {
                  type: "fixed",
                  amountCents: input.fixedCompensationCents,
                  currency: input.currency,
                }
              : input.compensationType === "percentage"
                ? {
                    type: "percentage",
                    percentageBasisPoints: input.compensationRateBasisPoints,
                    percentageBasis: "first_collected_invoice" as const,
                    currency: input.currency,
                  }
                : input.compensationType === "benefit"
                  ? {
                      type: "benefit",
                      benefitDescription: input.benefitDescription,
                      currency: input.currency,
                    }
                  : {
                      type: "custom",
                      terms: input.customTerms,
                      currency: input.currency,
                    },
        serviceOfferId: input.serviceOfferId,
        relatedRfxId: input.relatedRfxId,
        relatedTeamId: input.relatedTeamId,
      });
      return this.getReferralDetail(result.data.referralId, input.actorOrganizationId);
    },
    async sendReferral(referralId, expectedVersion, actorOrganizationId) {
      await sendBusinessReferralFn({
        referralId,
        actorOrganizationId,
        expectedVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      return this.getReferralDetail(referralId, actorOrganizationId);
    },
    async respondReferral(referralId, response, expectedVersion, acceptTerms, actorOrganizationId) {
      await respondBusinessReferralFn({
        referralId,
        actorOrganizationId,
        response,
        expectedVersion,
        idempotencyKey: crypto.randomUUID(),
        ...(response === "accepted" ? { acceptTerms } : {}),
      });
      return this.getReferralDetail(referralId, actorOrganizationId);
    },
    async progressReferral(referralId, status, expectedVersion, actorOrganizationId) {
      await progressBusinessReferralFn({
        referralId,
        actorOrganizationId,
        status,
        expectedVersion,
        idempotencyKey: crypto.randomUUID(),
        ...(status === "converted"
          ? { outcome: { type: "converted" as const } }
          : status === "closed"
            ? { outcome: { type: "other" as const } }
            : {}),
      });
      return this.getReferralDetail(referralId, actorOrganizationId);
    },
    async reportTransaction(
      referralId,
      expectedVersion,
      collectedTransactionCents,
      currency,
      serviceOfferId,
      actorOrganizationId,
    ) {
      await reportBusinessReferralTransactionFn({
        referralId,
        actorOrganizationId,
        expectedReferralVersion: expectedVersion,
        serviceOfferId,
        qualifyingTransactionCents: collectedTransactionCents,
        collectedTransactionCents,
        collectedAt: Date.now(),
        currency,
        idempotencyKey: crypto.randomUUID(),
        evidenceStoragePaths: [],
      });
      return this.getReferralDetail(referralId, actorOrganizationId);
    },
    async confirmTransaction(referralId, reportId, expectedReportVersion, actorOrganizationId) {
      await reviewBusinessReferralTransactionFn({
        reportId,
        actorOrganizationId,
        expectedVersion: expectedReportVersion,
        action: "confirm",
        idempotencyKey: crypto.randomUUID(),
      });
      return this.getReferralDetail(referralId, actorOrganizationId);
    },
    async getIntelligence(actorOrganizationId) {
      const scope = actorOrganizationId
        ? { scope: "organization" as const, orgId: actorOrganizationId, windowDays: 365 as const }
        : { scope: "individual" as const, windowDays: 365 as const };
      const [overview, relationships, gaps, reciprocal, impact] = await Promise.all([
        getReferralOverviewFn(scope),
        listReferralRelationshipsFn({ ...scope, limit: 25 }),
        getReferralGapAnalysisFn(scope),
        getReferralReciprocalPatternsFn({ ...scope, limit: 25 }),
        getReferralEconomicImpactFn(scope),
      ]);
      return adaptIntelligence({
        overview: overview.data,
        relationships: relationships.data.relationships,
        gaps: gaps.data.cells,
        reciprocal: reciprocal.data.patterns,
        reciprocalNotice: reciprocal.data.notice,
        impact: impact.data,
      });
    },
  };
  return gateway;
}
