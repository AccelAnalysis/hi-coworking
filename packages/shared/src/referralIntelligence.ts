export const REFERRAL_ANALYTICS_VERSION = 1;
export const REFERRAL_PRIVACY_MIN_RECORDS = 5;
export const REFERRAL_PRIVACY_MIN_ORGANIZATIONS = 5;

export type ReferralRelationshipState =
  | "new"
  | "active"
  | "established"
  | "trusted"
  | "review_required";

export interface ReferralRelationshipFactors {
  acceptedReferrals: number;
  confirmedConversions: number;
  medianResponseTimeHours: number | null;
  disputesOpened: number;
  disputesLost: number;
  reversals: number;
  verified: boolean;
}

export interface ReferralRelationshipInsight {
  state: ReferralRelationshipState;
  sampleSize: number;
  factors: ReferralRelationshipFactors;
  reasons: string[];
  calculationVersion: number;
}

export type ReferralReciprocityClassification =
  | "normal_reciprocity"
  | "high_reciprocity"
  | "concentrated_pair"
  | "review_recommended";

export interface ReferralReciprocityInput {
  forwardCount: number;
  reverseCount: number;
  firstPartyTotal: number;
  secondPartyTotal: number;
  disputedOrReversedCount?: number;
  rapidCrossReferralCount?: number;
  repeatedAmountCount?: number;
}

export interface ReferralReciprocityResult {
  classification: ReferralReciprocityClassification;
  sampleSize: number;
  pairShare: number;
  balanceRatio: number;
  factors: string[];
  calculationVersion: number;
}

export interface ReferralAnalyticsRecord {
  id: string;
  domain?: "business_referral" | "platform_invite";
  type?: string;
  referrerSubjectKey: string;
  recipientSubjectKey: string;
  referrerOrgId?: string;
  recipientOrgId?: string;
  status: string;
  createdAt: number;
  sentAt?: number;
  respondedAt?: number;
  acceptedAt?: number;
  inProgressAt?: number;
  closedAt?: number;
  category?: string;
  naicsCodes?: string[];
  territoryFips?: string;
  compensationType?: string;
  linkedRfxId?: string;
  linkedTeamId?: string;
}

export interface ReferralTransactionAnalyticsRecord {
  id: string;
  referralId: string;
  status: string;
  currency: string;
  collectedTransactionCents: number;
  refundCents?: number;
  calculation?: {
    grossReferralPayoutCents?: number;
    platformFeeCents?: number;
    netReferrerPayoutCents?: number;
  };
}

export interface ReferralNetworkMetrics {
  referralsSent: number;
  referralsReceived: number;
  acceptedReferrals: number;
  confirmedConversions: number;
  uniquePartners: number;
  acceptanceRate: number | null;
  conversionRate: number | null;
  medianResponseTimeHours: number | null;
  medianConversionTimeDays: number | null;
  repeatPartnerRate: number | null;
  largestPartnerShare: number | null;
  calculationVersion: number;
}

export interface ReferralCurrencyImpact {
  reportedTransactionCents: number;
  confirmedTransactionCents: number;
  refundedTransactionCents: number;
  grossReferralPayoutCents: number;
  calculatedPlatformFeeCents: number;
  netReferrerBenefitCents: number;
}

export interface ReferralEconomicImpact {
  referralsInitiated: number;
  referralsAccepted: number;
  confirmedConversions: number;
  businessesConnected: number;
  industriesConnected: number;
  territoriesConnected: number;
  rfxOpportunitiesLinked: number;
  teamsLinked: number;
  nonCashBenefitReferrals: number;
  currencies: Record<string, ReferralCurrencyImpact>;
  calculationVersion: number;
}

export interface ReferralGapDemandRecord {
  id: string;
  organizationIds: string[];
  category?: string;
  naicsCodes?: string[];
  territoryFips?: string;
  status: string;
}

export interface ReferralGapSupplyRecord {
  id: string;
  providerOrgId?: string;
  providerUid?: string;
  category?: string;
  naicsCodes?: string[];
  territoryFips?: string[];
  active: boolean;
}

export interface ReferralGapCell {
  dimension: "industry" | "territory";
  key: string;
  demandCount: number | null;
  activeRecipientCount: number | null;
  unansweredDemandCount: number | null;
  sampleSize: number | null;
  distinctOrganizationCount: number | null;
  privacyStatus: "own_exact" | "publishable" | "suppressed";
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function roundedRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function calculateReferralRate(numerator: number, denominator: number): number | null {
  return roundedRatio(finiteNonnegative(numerator), finiteNonnegative(denominator));
}

export function calculateReferralMedian(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function isBusinessReferralAnalyticsRecord(record: {
  domain?: string;
  type?: string;
}): boolean {
  return record.domain !== "platform_invite"
    && record.type !== "platform_invite"
    && record.type !== "membership_invite";
}

export function shouldSuppressReferralAggregate(
  recordCount: number,
  distinctOrganizationCount: number,
  minimumRecords = REFERRAL_PRIVACY_MIN_RECORDS,
  minimumOrganizations = REFERRAL_PRIVACY_MIN_ORGANIZATIONS,
): boolean {
  return recordCount < minimumRecords || distinctOrganizationCount < minimumOrganizations;
}

function uniqueRecordsById<T extends { id: string }>(records: T[]): T[] {
  const unique = new Map<string, T>();
  for (const record of records) unique.set(record.id, record);
  return [...unique.values()];
}

export function isConfirmedReferralConversionStatus(status: string): boolean {
  return new Set([
    "confirmed",
    "transaction_confirmed",
    "payout_calculated",
    "payout_due",
    "settlement_unavailable",
  ]).has(status);
}

export function countConfirmedReferralConversions(
  referralRecords: ReferralAnalyticsRecord[],
  transactionRecords: ReferralTransactionAnalyticsRecord[],
): number {
  const confirmedReferralIds = new Set(uniqueRecordsById(transactionRecords)
    .filter((transaction) => isConfirmedReferralConversionStatus(transaction.status))
    .map((transaction) => transaction.referralId));
  return uniqueRecordsById(referralRecords.filter(isBusinessReferralAnalyticsRecord))
    .filter((referral) => referral.status === "converted" && confirmedReferralIds.has(referral.id))
    .length;
}

export function deriveReferralRelationshipInsight(
  input: ReferralRelationshipFactors,
): ReferralRelationshipInsight {
  const factors: ReferralRelationshipFactors = {
    acceptedReferrals: Math.floor(finiteNonnegative(input.acceptedReferrals)),
    confirmedConversions: Math.floor(finiteNonnegative(input.confirmedConversions)),
    medianResponseTimeHours: input.medianResponseTimeHours === null
      ? null
      : finiteNonnegative(input.medianResponseTimeHours),
    disputesOpened: Math.floor(finiteNonnegative(input.disputesOpened)),
    disputesLost: Math.floor(finiteNonnegative(input.disputesLost)),
    reversals: Math.floor(finiteNonnegative(input.reversals)),
    verified: input.verified === true,
  };
  const sampleSize = factors.acceptedReferrals;
  const reasons: string[] = [];
  let state: ReferralRelationshipState = "new";

  const reviewRequired = sampleSize >= 3
    && (factors.disputesLost >= 2 || factors.reversals / Math.max(1, sampleSize) > 0.25);
  if (reviewRequired) {
    state = "review_required";
    reasons.push("verified_adverse_outcomes_require_review");
  } else if (
    factors.verified
    && sampleSize >= 5
    && factors.confirmedConversions >= 3
    && factors.disputesLost === 0
    && factors.reversals === 0
  ) {
    state = "trusted";
    reasons.push("verified_minimum_sample", "confirmed_conversion_history", "no_lost_disputes_or_reversals");
  } else if (sampleSize >= 3 && factors.confirmedConversions >= 1) {
    state = "established";
    reasons.push("repeat_accepted_referrals", "confirmed_conversion_history");
  } else if (sampleSize >= 1) {
    state = "active";
    reasons.push("accepted_referral_history");
  } else {
    reasons.push("insufficient_verified_history");
  }

  return {
    state,
    sampleSize,
    factors,
    reasons,
    calculationVersion: REFERRAL_ANALYTICS_VERSION,
  };
}

export function analyzeReferralReciprocity(
  input: ReferralReciprocityInput,
): ReferralReciprocityResult {
  const forward = Math.floor(finiteNonnegative(input.forwardCount));
  const reverse = Math.floor(finiteNonnegative(input.reverseCount));
  const pairCount = forward + reverse;
  const firstTotal = Math.floor(finiteNonnegative(input.firstPartyTotal));
  const secondTotal = Math.floor(finiteNonnegative(input.secondPartyTotal));
  const denominator = Math.max(1, firstTotal + secondTotal);
  const pairShare = Math.round((pairCount / denominator) * 10_000) / 10_000;
  const balanceRatio = pairCount === 0
    ? 0
    : Math.round((Math.min(forward, reverse) / Math.max(1, Math.max(forward, reverse))) * 10_000) / 10_000;
  const disputedOrReversed = Math.floor(finiteNonnegative(input.disputedOrReversedCount ?? 0));
  const rapid = Math.floor(finiteNonnegative(input.rapidCrossReferralCount ?? 0));
  const repeated = Math.floor(finiteNonnegative(input.repeatedAmountCount ?? 0));
  const factors: string[] = [];
  let classification: ReferralReciprocityClassification = "normal_reciprocity";

  if (forward > 0 && reverse > 0) factors.push("referrals_flow_both_directions");
  if (pairCount >= 5 && balanceRatio >= 0.6) factors.push("balanced_repeat_reciprocity");
  if (pairCount >= 5 && pairShare >= 0.6) factors.push("partner_concentration");
  if (rapid > 0) factors.push("rapid_cross_referrals");
  if (repeated > 1) factors.push("repeated_transaction_values");
  if (disputedOrReversed > 0) factors.push("verified_disputes_or_reversals");

  const corroboratingSignals = Number(rapid > 0) + Number(repeated > 1) + Number(disputedOrReversed > 0);
  if (pairCount >= 5 && pairShare >= 0.8 && corroboratingSignals >= 2) {
    classification = "review_recommended";
  } else if (pairCount >= 5 && pairShare >= 0.6) {
    classification = "concentrated_pair";
  } else if (pairCount >= 5 && balanceRatio >= 0.6) {
    classification = "high_reciprocity";
  }

  return {
    classification,
    sampleSize: pairCount,
    pairShare,
    balanceRatio,
    factors,
    calculationVersion: REFERRAL_ANALYTICS_VERSION,
  };
}

export function calculateReferralNetworkMetrics(
  records: ReferralAnalyticsRecord[],
  subjectKey: string,
  transactionRecords: ReferralTransactionAnalyticsRecord[] = [],
): ReferralNetworkMetrics {
  const referrals = uniqueRecordsById(records.filter(isBusinessReferralAnalyticsRecord));
  const sent = referrals.filter((record) => record.referrerSubjectKey === subjectKey);
  const received = referrals.filter((record) => record.recipientSubjectKey === subjectKey);
  const relevant = referrals.filter((record) => (
    record.referrerSubjectKey === subjectKey || record.recipientSubjectKey === subjectKey
  ));
  const acceptedStatuses = new Set(["accepted", "in_progress", "converted"]);
  const accepted = received.filter((record) => acceptedStatuses.has(record.status));
  const confirmedConversions = countConfirmedReferralConversions(received, transactionRecords);
  const partnerCounts = new Map<string, number>();
  for (const record of relevant) {
    const partner = record.referrerSubjectKey === subjectKey
      ? record.recipientSubjectKey
      : record.referrerSubjectKey;
    if (!partner || partner === subjectKey) continue;
    partnerCounts.set(partner, (partnerCounts.get(partner) ?? 0) + 1);
  }
  const responseHours = relevant.flatMap((record) => (
    typeof record.sentAt === "number" && typeof record.respondedAt === "number"
      && record.respondedAt >= record.sentAt
      ? [(record.respondedAt - record.sentAt) / 3_600_000]
      : []
  ));
  const conversionDays = relevant.flatMap((record) => (
    record.status === "converted" && typeof record.acceptedAt === "number"
      && typeof record.closedAt === "number" && record.closedAt >= record.acceptedAt
      ? [(record.closedAt - record.acceptedAt) / 86_400_000]
      : []
  ));
  const repeatPartners = [...partnerCounts.values()].filter((count) => count >= 2).length;
  const largestPartnerCount = Math.max(0, ...partnerCounts.values());

  return {
    referralsSent: sent.length,
    referralsReceived: received.length,
    acceptedReferrals: accepted.length,
    confirmedConversions,
    uniquePartners: partnerCounts.size,
    acceptanceRate: calculateReferralRate(accepted.length, received.length),
    conversionRate: calculateReferralRate(confirmedConversions, accepted.length),
    medianResponseTimeHours: calculateReferralMedian(responseHours),
    medianConversionTimeDays: calculateReferralMedian(conversionDays),
    repeatPartnerRate: calculateReferralRate(repeatPartners, partnerCounts.size),
    largestPartnerShare: calculateReferralRate(largestPartnerCount, relevant.length),
    calculationVersion: REFERRAL_ANALYTICS_VERSION,
  };
}

function emptyCurrencyImpact(): ReferralCurrencyImpact {
  return {
    reportedTransactionCents: 0,
    confirmedTransactionCents: 0,
    refundedTransactionCents: 0,
    grossReferralPayoutCents: 0,
    calculatedPlatformFeeCents: 0,
    netReferrerBenefitCents: 0,
  };
}

function safeCents(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function summarizeReferralEconomicImpact(
  referralRecords: ReferralAnalyticsRecord[],
  transactionRecords: ReferralTransactionAnalyticsRecord[],
): ReferralEconomicImpact {
  const referrals = uniqueRecordsById(referralRecords.filter(isBusinessReferralAnalyticsRecord));
  const acceptedStatuses = new Set(["accepted", "in_progress", "converted"]);
  const referralIds = new Set(referrals.map((record) => record.id));
  const currencies: Record<string, ReferralCurrencyImpact> = {};

  const transactions = uniqueRecordsById(transactionRecords);
  for (const transaction of transactions) {
    if (!referralIds.has(transaction.referralId)) continue;
    const currency = /^[A-Z]{3}$/.test(transaction.currency)
      ? transaction.currency
      : transaction.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    const bucket = currencies[currency] ?? emptyCurrencyImpact();
    const collected = safeCents(transaction.collectedTransactionCents);
    const refund = Math.min(collected, safeCents(transaction.refundCents));
    if (!new Set(["cancelled", "reversed"]).has(transaction.status)) {
      bucket.reportedTransactionCents += collected;
    }
    if (new Set([
      "confirmed",
      "transaction_confirmed",
      "payout_calculated",
      "payout_due",
      "settlement_unavailable",
      "refunded",
    ]).has(transaction.status)) {
      bucket.confirmedTransactionCents += collected - refund;
      bucket.refundedTransactionCents += refund;
      const multiplier = collected > 0 ? (collected - refund) / collected : 0;
      bucket.grossReferralPayoutCents += Math.round(
        safeCents(transaction.calculation?.grossReferralPayoutCents) * multiplier,
      );
      bucket.calculatedPlatformFeeCents += Math.round(
        safeCents(transaction.calculation?.platformFeeCents) * multiplier,
      );
      bucket.netReferrerBenefitCents += Math.round(
        safeCents(transaction.calculation?.netReferrerPayoutCents) * multiplier,
      );
    }
    currencies[currency] = bucket;
  }

  const partners = new Set<string>();
  const industries = new Set<string>();
  const territories = new Set<string>();
  const linkedRfx = new Set<string>();
  const linkedTeams = new Set<string>();
  for (const referral of referrals) {
    partners.add(referral.referrerSubjectKey);
    partners.add(referral.recipientSubjectKey);
    if (referral.category) industries.add(referral.category);
    referral.naicsCodes?.forEach((code) => industries.add(code));
    if (referral.territoryFips) territories.add(referral.territoryFips);
    if (referral.linkedRfxId) linkedRfx.add(referral.linkedRfxId);
    if (referral.linkedTeamId) linkedTeams.add(referral.linkedTeamId);
  }

  return {
    referralsInitiated: referrals.length,
    referralsAccepted: referrals.filter((record) => acceptedStatuses.has(record.status)).length,
    confirmedConversions: countConfirmedReferralConversions(referrals, transactions),
    businessesConnected: partners.size,
    industriesConnected: industries.size,
    territoriesConnected: territories.size,
    rfxOpportunitiesLinked: linkedRfx.size,
    teamsLinked: linkedTeams.size,
    nonCashBenefitReferrals: referrals.filter((record) => record.compensationType === "benefit").length,
    currencies,
    calculationVersion: REFERRAL_ANALYTICS_VERSION,
  };
}

function addGapDimension(
  dimensions: Map<string, { demandIds: Set<string>; orgIds: Set<string>; unanswered: number }>,
  key: string,
  record: ReferralGapDemandRecord,
): void {
  if (!key) return;
  const value = dimensions.get(key) ?? { demandIds: new Set(), orgIds: new Set(), unanswered: 0 };
  value.demandIds.add(record.id);
  record.organizationIds.forEach((orgId) => value.orgIds.add(orgId));
  if (["sent", "declined", "expired", "closed"].includes(record.status)) value.unanswered += 1;
  dimensions.set(key, value);
}

export function buildReferralGapAnalysis(
  demand: ReferralGapDemandRecord[],
  supply: ReferralGapSupplyRecord[],
  options: { ownScope: boolean },
): ReferralGapCell[] {
  const industries = new Map<string, { demandIds: Set<string>; orgIds: Set<string>; unanswered: number }>();
  const territories = new Map<string, { demandIds: Set<string>; orgIds: Set<string>; unanswered: number }>();
  for (const record of uniqueRecordsById(demand)) {
    if (record.category) addGapDimension(industries, record.category, record);
    record.naicsCodes?.forEach((code) => addGapDimension(industries, code, record));
    if (record.territoryFips) addGapDimension(territories, record.territoryFips, record);
  }

  const supplyByIndustry = new Map<string, Set<string>>();
  const supplyByTerritory = new Map<string, Set<string>>();
  for (const offer of uniqueRecordsById(supply).filter((record) => record.active)) {
    const subject = offer.providerOrgId ? `org:${offer.providerOrgId}` : `uid:${offer.providerUid ?? ""}`;
    if (offer.category) {
      const set = supplyByIndustry.get(offer.category) ?? new Set<string>();
      set.add(subject);
      supplyByIndustry.set(offer.category, set);
    }
    offer.naicsCodes?.forEach((code) => {
      const set = supplyByIndustry.get(code) ?? new Set<string>();
      set.add(subject);
      supplyByIndustry.set(code, set);
    });
    offer.territoryFips?.forEach((fips) => {
      const set = supplyByTerritory.get(fips) ?? new Set<string>();
      set.add(subject);
      supplyByTerritory.set(fips, set);
    });
  }

  const project = (
    dimension: "industry" | "territory",
    source: Map<string, { demandIds: Set<string>; orgIds: Set<string>; unanswered: number }>,
    recipients: Map<string, Set<string>>,
  ): ReferralGapCell[] => [...source.entries()].map(([key, value]) => {
    const sampleSize = value.demandIds.size;
    const distinctOrganizationCount = value.orgIds.size;
    const suppressed = !options.ownScope
      && shouldSuppressReferralAggregate(sampleSize, distinctOrganizationCount);
    return {
      dimension,
      key,
      demandCount: suppressed ? null : sampleSize,
      activeRecipientCount: suppressed ? null : (recipients.get(key)?.size ?? 0),
      unansweredDemandCount: suppressed ? null : value.unanswered,
      sampleSize: suppressed ? null : sampleSize,
      distinctOrganizationCount: suppressed ? null : distinctOrganizationCount,
      privacyStatus: options.ownScope ? "own_exact" : suppressed ? "suppressed" : "publishable",
    };
  });

  return [
    ...project("industry", industries, supplyByIndustry),
    ...project("territory", territories, supplyByTerritory),
  ].sort((left, right) => (
    left.dimension.localeCompare(right.dimension)
    || (right.demandCount ?? -1) - (left.demandCount ?? -1)
    || left.key.localeCompare(right.key)
  ));
}
