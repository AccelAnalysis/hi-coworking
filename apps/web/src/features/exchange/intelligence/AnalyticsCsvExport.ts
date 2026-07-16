import type { ReferralIntelligenceSnapshot } from "../data/exchangeRun3Gateway";

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function row(...values: Array<string | number | undefined>): string {
  return values.map(csvCell).join(",");
}

/** Builds an own-organization export without contact data, notes, evidence, or risk details. */
export function buildReferralIntelligenceCsv(
  snapshot: ReferralIntelligenceSnapshot,
): string {
  const rows = [
    row("section", "metric", "value", "unit_or_state", "sample_size", "scope_or_note"),
    row("metadata", "scope", snapshot.scopeLabel, "", "", snapshot.windowLabel),
    row("metadata", "calculation_version", snapshot.calculationVersion, "", "", `privacy threshold ${snapshot.privacyThreshold}`),
    ...snapshot.networkMetrics.map((metric) => row(
      "network",
      metric.label,
      metric.value,
      "",
      metric.sampleSize,
      metric.detail,
    )),
    ...snapshot.relationships.map((relationship) => row(
      "relationship",
      relationship.partnerLabel,
      relationship.confirmedConversions,
      relationship.state,
      relationship.sampleSize,
      relationship.explanation,
    )),
    ...[...snapshot.industryGaps, ...snapshot.territoryGaps].map((gap) => gap.suppressed
      ? row("gap", gap.label, "suppressed", gap.dimension, "below threshold", gap.explanation)
      : row("gap", gap.label, gap.unansweredDemand, gap.dimension, gap.demandCount, gap.explanation)),
    ...snapshot.reciprocalPatterns.map((pattern) => row(
      "reciprocity",
      pattern.partnerLabel,
      pattern.referralsEachDirection,
      pattern.classification,
      pattern.sampleSize,
      pattern.notice,
    )),
    row("impact", "referrals_initiated", snapshot.economicImpact.referralsInitiated, "count", "", "Business referrals only"),
    row("impact", "referrals_accepted", snapshot.economicImpact.referralsAccepted, "count", "", "Business referrals only"),
    row("impact", "confirmed_conversions", snapshot.economicImpact.confirmedConversions, "count", "", "Confirmed only"),
    row("impact", "businesses_connected", snapshot.economicImpact.businessesConnected, "count", "", "Authorized organization scope"),
    row("impact", "new_relationships_formed", snapshot.economicImpact.newRelationshipsFormed, "count", "", "Verified referral relationships"),
    row("impact", "non_cash_benefits", snapshot.economicImpact.nonCashBenefits, "count", "", "Not assigned a cash value"),
    ...snapshot.economicImpact.currencies.flatMap((currency) => [
      row("impact_currency", "reported_referred_transaction_value", currency.reportedTransactionValueCents, currency.currency, "", "Reported; not confirmed"),
      row("impact_currency", "confirmed_referred_transaction_value", currency.confirmedTransactionValueCents, currency.currency, "", "Confirmed referred value; not a regional multiplier"),
      row("impact_currency", "calculated_gross_referral_payout", currency.grossReferralPayoutCents, currency.currency, "", "Integer cents"),
      row("impact_currency", "calculated_platform_fee", currency.platformFeeCents, currency.currency, "", "Applied to gross referral payout"),
      row("impact_currency", "calculated_net_referrer_benefit", currency.netReferrerBenefitCents, currency.currency, "", "Settlement availability is separate"),
    ]),
    ...snapshot.notices.map((notice) => row("notice", "data_quality", "", "", "", notice)),
  ];
  return `${rows.join("\n")}\n`;
}

export function downloadReferralIntelligenceCsv(
  snapshot: ReferralIntelligenceSnapshot,
): void {
  const blob = new Blob([buildReferralIntelligenceCsv(snapshot)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hi-exchange-referral-intelligence.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
