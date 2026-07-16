import type {
  ReferralAnalyticsRecord,
  ReferralCurrencyImpact,
  ReferralEconomicImpact,
  ReferralGapCell,
  ReferralGapDemandRecord,
  ReferralGapSupplyRecord,
  ReferralNetworkMetrics,
  ReferralReciprocityInput,
  ReferralReciprocityResult,
  ReferralRelationshipFactors,
  ReferralRelationshipInsight,
  ReferralRelationshipState,
  ReferralTransactionAnalyticsRecord,
} from "@hi/shared";

const VERSION = 1;
const MIN_RECORDS = 5;
const MIN_ORGANIZATIONS = 5;

export type LocalReferralCompensationType =
  | "none"
  | "fixed"
  | "percentage"
  | "custom"
  | "benefit";

export interface LocalReferralFinancialCalculationInput {
  qualifyingTransactionCents: number;
  collectedTransactionCents: number;
  compensationType: LocalReferralCompensationType;
  fixedCompensationCents?: number;
  compensationRateBasisPoints?: number;
  platformFeeBasisPoints: number;
  currency: string;
  termsCurrency?: string;
}

export interface LocalReferralFinancialCalculationResult {
  qualifyingTransactionCents: number;
  collectedTransactionCents: number;
  compensationBasisCents: number;
  grossReferralPayoutCents: number;
  platformFeeBasisPointsSnapshot: number;
  platformFeeCents: number;
  netReferrerPayoutCents: number;
  currency: string;
  calculationVersion: 1;
  calculationStatus:
    | "calculated"
    | "no_compensation"
    | "manual_terms_required"
    | "non_cash_benefit";
}

function requireSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
}

/** Mirrors the shared contract without creating a deployed runtime dependency. */
export function calculateBasisPointsHalfUp(amountCents: number, basisPoints: number): number {
  requireSafeNonnegativeInteger(amountCents, "amountCents");
  requireSafeNonnegativeInteger(basisPoints, "basisPoints");
  if (basisPoints > 10_000) throw new RangeError("basisPoints cannot exceed 10,000");
  const result = (
    BigInt(amountCents) * BigInt(basisPoints) + BigInt(5_000)
  ) / BigInt(10_000);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Calculated cents exceed the maximum safe integer");
  }
  return Number(result);
}

/**
 * Local Functions runtime mirror of the shared pure calculator. Keep parity
 * covered by tests because the workspace package exports TypeScript source and
 * is intentionally not required by deployed JavaScript.
 */
export function calculateReferralFinancials(
  rawInput: LocalReferralFinancialCalculationInput,
): LocalReferralFinancialCalculationResult {
  const currency = rawInput.currency.trim().toUpperCase();
  const termsCurrency = rawInput.termsCurrency?.trim().toUpperCase();
  requireSafeNonnegativeInteger(rawInput.qualifyingTransactionCents, "qualifyingTransactionCents");
  requireSafeNonnegativeInteger(rawInput.collectedTransactionCents, "collectedTransactionCents");
  requireSafeNonnegativeInteger(rawInput.platformFeeBasisPoints, "platformFeeBasisPoints");
  if (rawInput.platformFeeBasisPoints > 10_000) {
    throw new RangeError("platformFeeBasisPoints cannot exceed 10,000");
  }
  if (!/^[A-Z]{3}$/.test(currency) || (termsCurrency !== undefined && !/^[A-Z]{3}$/.test(termsCurrency))) {
    throw new RangeError("Currency must be a three-letter uppercase code");
  }
  if (termsCurrency !== undefined && termsCurrency !== currency) {
    throw new RangeError("Transaction currency does not match the accepted referral terms");
  }
  if (!new Set<LocalReferralCompensationType>([
    "none", "fixed", "percentage", "custom", "benefit",
  ]).has(rawInput.compensationType)) {
    throw new RangeError("Invalid referral compensation type");
  }
  if (rawInput.compensationType === "fixed") {
    if (rawInput.fixedCompensationCents === undefined) {
      throw new RangeError("Fixed compensation requires an integer-cent amount");
    }
    requireSafeNonnegativeInteger(rawInput.fixedCompensationCents, "fixedCompensationCents");
    if (rawInput.fixedCompensationCents === 0) {
      throw new RangeError("Fixed compensation must be positive");
    }
  } else if (rawInput.fixedCompensationCents !== undefined) {
    throw new RangeError("Only fixed compensation can include a fixed amount");
  }
  if (rawInput.compensationType === "percentage") {
    if (rawInput.compensationRateBasisPoints === undefined) {
      throw new RangeError("Percentage compensation requires a basis-point rate");
    }
    requireSafeNonnegativeInteger(rawInput.compensationRateBasisPoints, "compensationRateBasisPoints");
    if (rawInput.compensationRateBasisPoints < 1 || rawInput.compensationRateBasisPoints > 10_000) {
      throw new RangeError("compensationRateBasisPoints must be between 1 and 10,000");
    }
  } else if (rawInput.compensationRateBasisPoints !== undefined) {
    throw new RangeError("Only percentage compensation can include a basis-point rate");
  }

  const compensationBasisCents = Math.min(
    rawInput.qualifyingTransactionCents,
    rawInput.collectedTransactionCents,
  );
  let grossReferralPayoutCents = 0;
  let calculationStatus: LocalReferralFinancialCalculationResult["calculationStatus"] = "calculated";
  if (rawInput.compensationType === "none") calculationStatus = "no_compensation";
  else if (rawInput.compensationType === "fixed") {
    grossReferralPayoutCents = compensationBasisCents > 0
      ? rawInput.fixedCompensationCents as number
      : 0;
  } else if (rawInput.compensationType === "percentage") {
    grossReferralPayoutCents = calculateBasisPointsHalfUp(
      compensationBasisCents,
      rawInput.compensationRateBasisPoints as number,
    );
  } else if (rawInput.compensationType === "custom") calculationStatus = "manual_terms_required";
  else calculationStatus = "non_cash_benefit";

  const platformFeeCents = calculateBasisPointsHalfUp(
    grossReferralPayoutCents,
    rawInput.platformFeeBasisPoints,
  );
  return {
    qualifyingTransactionCents: rawInput.qualifyingTransactionCents,
    collectedTransactionCents: rawInput.collectedTransactionCents,
    compensationBasisCents,
    grossReferralPayoutCents,
    platformFeeBasisPointsSnapshot: rawInput.platformFeeBasisPoints,
    platformFeeCents,
    netReferrerPayoutCents: grossReferralPayoutCents - platformFeeCents,
    currency,
    calculationVersion: 1,
    calculationStatus,
  };
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function calculateReferralRate(numerator: number, denominator: number): number | null {
  const safeNumerator = finiteNonnegative(numerator);
  const safeDenominator = finiteNonnegative(denominator);
  return safeDenominator > 0
    ? Math.round((safeNumerator / safeDenominator) * 10_000) / 10_000
    : null;
}

export function calculateReferralMedian(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
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
  minimumRecords = MIN_RECORDS,
  minimumOrganizations = MIN_ORGANIZATIONS,
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
    factors.verified && sampleSize >= 5 && factors.confirmedConversions >= 3
    && factors.disputesLost === 0 && factors.reversals === 0
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
  return { state, sampleSize, factors, reasons, calculationVersion: VERSION };
}

export function analyzeReferralReciprocity(input: ReferralReciprocityInput): ReferralReciprocityResult {
  const forward = Math.floor(finiteNonnegative(input.forwardCount));
  const reverse = Math.floor(finiteNonnegative(input.reverseCount));
  const pairCount = forward + reverse;
  const denominator = Math.max(1,
    Math.floor(finiteNonnegative(input.firstPartyTotal))
      + Math.floor(finiteNonnegative(input.secondPartyTotal)));
  const pairShare = Math.round((pairCount / denominator) * 10_000) / 10_000;
  const balanceRatio = pairCount
    ? Math.round((Math.min(forward, reverse) / Math.max(1, Math.max(forward, reverse))) * 10_000) / 10_000
    : 0;
  const disputed = Math.floor(finiteNonnegative(input.disputedOrReversedCount ?? 0));
  const rapid = Math.floor(finiteNonnegative(input.rapidCrossReferralCount ?? 0));
  const repeated = Math.floor(finiteNonnegative(input.repeatedAmountCount ?? 0));
  const factors: string[] = [];
  if (forward && reverse) factors.push("referrals_flow_both_directions");
  if (pairCount >= 5 && balanceRatio >= 0.6) factors.push("balanced_repeat_reciprocity");
  if (pairCount >= 5 && pairShare >= 0.6) factors.push("partner_concentration");
  if (rapid) factors.push("rapid_cross_referrals");
  if (repeated > 1) factors.push("repeated_transaction_values");
  if (disputed) factors.push("verified_disputes_or_reversals");
  const signals = Number(rapid > 0) + Number(repeated > 1) + Number(disputed > 0);
  const classification = pairCount >= 5 && pairShare >= 0.8 && signals >= 2
    ? "review_recommended"
    : pairCount >= 5 && pairShare >= 0.6
      ? "concentrated_pair"
      : pairCount >= 5 && balanceRatio >= 0.6
        ? "high_reciprocity"
        : "normal_reciprocity";
  return { classification, sampleSize: pairCount, pairShare, balanceRatio, factors, calculationVersion: VERSION };
}

export function calculateReferralNetworkMetrics(
  records: ReferralAnalyticsRecord[],
  subjectKey: string,
  transactionRecords: ReferralTransactionAnalyticsRecord[] = [],
): ReferralNetworkMetrics {
  const referrals = uniqueRecordsById(records.filter(isBusinessReferralAnalyticsRecord));
  const sent = referrals.filter((record) => record.referrerSubjectKey === subjectKey);
  const received = referrals.filter((record) => record.recipientSubjectKey === subjectKey);
  const relevant = referrals.filter((record) => record.referrerSubjectKey === subjectKey
    || record.recipientSubjectKey === subjectKey);
  const accepted = received.filter((record) => ["accepted", "in_progress", "converted"].includes(record.status));
  const confirmedConversions = countConfirmedReferralConversions(received, transactionRecords);
  const partners = new Map<string, number>();
  for (const record of relevant) {
    const partner = record.referrerSubjectKey === subjectKey
      ? record.recipientSubjectKey : record.referrerSubjectKey;
    if (partner && partner !== subjectKey) partners.set(partner, (partners.get(partner) ?? 0) + 1);
  }
  const responseHours = relevant.flatMap((record) => record.sentAt !== undefined
    && record.respondedAt !== undefined && record.respondedAt >= record.sentAt
    ? [(record.respondedAt - record.sentAt) / 3_600_000] : []);
  const conversionDays = relevant.flatMap((record) => record.status === "converted"
    && record.acceptedAt !== undefined && record.closedAt !== undefined
    && record.closedAt >= record.acceptedAt
    ? [(record.closedAt - record.acceptedAt) / 86_400_000] : []);
  const largest = Math.max(0, ...partners.values());
  return {
    referralsSent: sent.length,
    referralsReceived: received.length,
    acceptedReferrals: accepted.length,
    confirmedConversions,
    uniquePartners: partners.size,
    acceptanceRate: calculateReferralRate(accepted.length, received.length),
    conversionRate: calculateReferralRate(confirmedConversions, accepted.length),
    medianResponseTimeHours: calculateReferralMedian(responseHours),
    medianConversionTimeDays: calculateReferralMedian(conversionDays),
    repeatPartnerRate: calculateReferralRate([...partners.values()].filter((count) => count >= 2).length, partners.size),
    largestPartnerShare: calculateReferralRate(largest, relevant.length),
    calculationVersion: VERSION,
  };
}

function emptyCurrency(): ReferralCurrencyImpact {
  return {
    reportedTransactionCents: 0,
    confirmedTransactionCents: 0,
    refundedTransactionCents: 0,
    grossReferralPayoutCents: 0,
    calculatedPlatformFeeCents: 0,
    netReferrerBenefitCents: 0,
  };
}

function cents(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function summarizeReferralEconomicImpact(
  referralRecords: ReferralAnalyticsRecord[],
  transactionRecords: ReferralTransactionAnalyticsRecord[],
): ReferralEconomicImpact {
  const referrals = uniqueRecordsById(referralRecords.filter(isBusinessReferralAnalyticsRecord));
  const referralIds = new Set(referrals.map(({ id }) => id));
  const currencies: Record<string, ReferralCurrencyImpact> = {};
  const confirmedStatuses = new Set([
    "confirmed", "transaction_confirmed", "payout_calculated", "payout_due",
    "settlement_unavailable", "refunded",
  ]);
  const transactions = uniqueRecordsById(transactionRecords);
  for (const transaction of transactions) {
    if (!referralIds.has(transaction.referralId)) continue;
    const currency = transaction.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    const bucket = currencies[currency] ?? emptyCurrency();
    const collected = cents(transaction.collectedTransactionCents);
    const refund = Math.min(collected, cents(transaction.refundCents));
    if (!new Set(["cancelled", "reversed"]).has(transaction.status)) {
      bucket.reportedTransactionCents += collected;
    }
    if (confirmedStatuses.has(transaction.status)) {
      const multiplier = collected ? (collected - refund) / collected : 0;
      bucket.confirmedTransactionCents += collected - refund;
      bucket.refundedTransactionCents += refund;
      bucket.grossReferralPayoutCents += Math.round(cents(transaction.calculation?.grossReferralPayoutCents) * multiplier);
      bucket.calculatedPlatformFeeCents += Math.round(cents(transaction.calculation?.platformFeeCents) * multiplier);
      bucket.netReferrerBenefitCents += Math.round(cents(transaction.calculation?.netReferrerPayoutCents) * multiplier);
    }
    currencies[currency] = bucket;
  }
  const partners = new Set<string>();
  const industries = new Set<string>();
  const territories = new Set<string>();
  const rfx = new Set<string>();
  const teams = new Set<string>();
  for (const referral of referrals) {
    partners.add(referral.referrerSubjectKey);
    partners.add(referral.recipientSubjectKey);
    if (referral.category) industries.add(referral.category);
    referral.naicsCodes?.forEach((code) => industries.add(code));
    if (referral.territoryFips) territories.add(referral.territoryFips);
    if (referral.linkedRfxId) rfx.add(referral.linkedRfxId);
    if (referral.linkedTeamId) teams.add(referral.linkedTeamId);
  }
  return {
    referralsInitiated: referrals.length,
    referralsAccepted: referrals.filter(({ status }) => ["accepted", "in_progress", "converted"].includes(status)).length,
    confirmedConversions: countConfirmedReferralConversions(referrals, transactions),
    businessesConnected: partners.size,
    industriesConnected: industries.size,
    territoriesConnected: territories.size,
    rfxOpportunitiesLinked: rfx.size,
    teamsLinked: teams.size,
    nonCashBenefitReferrals: referrals.filter(({ compensationType }) => compensationType === "benefit").length,
    currencies,
    calculationVersion: VERSION,
  };
}

function addDemand(
  target: Map<string, { ids: Set<string>; orgs: Set<string>; unanswered: number }>,
  key: string,
  record: ReferralGapDemandRecord,
): void {
  if (!key) return;
  const cell = target.get(key) ?? { ids: new Set(), orgs: new Set(), unanswered: 0 };
  cell.ids.add(record.id);
  record.organizationIds.forEach((id) => cell.orgs.add(id));
  if (["sent", "declined", "expired", "closed"].includes(record.status)) cell.unanswered += 1;
  target.set(key, cell);
}

export function buildReferralGapAnalysis(
  demand: ReferralGapDemandRecord[],
  supply: ReferralGapSupplyRecord[],
  options: { ownScope: boolean },
): ReferralGapCell[] {
  const industries = new Map<string, { ids: Set<string>; orgs: Set<string>; unanswered: number }>();
  const territories = new Map<string, { ids: Set<string>; orgs: Set<string>; unanswered: number }>();
  for (const record of uniqueRecordsById(demand)) {
    if (record.category) addDemand(industries, record.category, record);
    record.naicsCodes?.forEach((code) => addDemand(industries, code, record));
    if (record.territoryFips) addDemand(territories, record.territoryFips, record);
  }
  const supplyIndustries = new Map<string, Set<string>>();
  const supplyTerritories = new Map<string, Set<string>>();
  for (const offer of uniqueRecordsById(supply).filter(({ active }) => active)) {
    const subject = offer.providerOrgId ? `org:${offer.providerOrgId}` : `uid:${offer.providerUid ?? ""}`;
    const add = (target: Map<string, Set<string>>, key: string): void => {
      const values = target.get(key) ?? new Set<string>();
      values.add(subject);
      target.set(key, values);
    };
    if (offer.category) add(supplyIndustries, offer.category);
    offer.naicsCodes?.forEach((code) => add(supplyIndustries, code));
    offer.territoryFips?.forEach((fips) => add(supplyTerritories, fips));
  }
  const project = (
    dimension: "industry" | "territory",
    source: Map<string, { ids: Set<string>; orgs: Set<string>; unanswered: number }>,
    recipients: Map<string, Set<string>>,
  ): ReferralGapCell[] => [...source.entries()].map(([key, cell]) => {
    const suppressed = !options.ownScope
      && shouldSuppressReferralAggregate(cell.ids.size, cell.orgs.size);
    return {
      dimension,
      key,
      demandCount: suppressed ? null : cell.ids.size,
      activeRecipientCount: suppressed ? null : (recipients.get(key)?.size ?? 0),
      unansweredDemandCount: suppressed ? null : cell.unanswered,
      sampleSize: suppressed ? null : cell.ids.size,
      distinctOrganizationCount: suppressed ? null : cell.orgs.size,
      privacyStatus: options.ownScope ? "own_exact" : suppressed ? "suppressed" : "publishable",
    };
  });
  return [
    ...project("industry", industries, supplyIndustries),
    ...project("territory", territories, supplyTerritories),
  ].sort((left, right) => left.dimension.localeCompare(right.dimension)
    || (right.demandCount ?? -1) - (left.demandCount ?? -1)
    || left.key.localeCompare(right.key));
}
