import { z } from "zod";

const safeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:@-]+$/);
const safeCentsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const safeEpochMillisSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currencyCodeSchema = z.string().trim().length(3).regex(/^[A-Z]{3}$/);
const basisPointsSchema = z.number().int().min(0).max(10_000);
const positiveBasisPointsSchema = z.number().int().min(1).max(10_000);
const boundedTermSchema = z.string().trim().min(1).max(5_000);
const boundedTermListSchema = z
  .array(z.string().trim().min(1).max(160))
  .max(50)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "Values must be unique" });
    }
  });

export const referralCompensationTypeSchema = z.enum([
  "none",
  "fixed",
  "percentage",
  "custom",
  "benefit",
]);
export type ReferralCompensationType = z.infer<typeof referralCompensationTypeSchema>;

export const referralPercentageBasisSchema = z.enum([
  "first_collected_invoice",
  "total_collected_contract",
]);
export type ReferralPercentageBasis = z.infer<typeof referralPercentageBasisSchema>;

function validateCompensationTerms(
  value: {
    compensationType: ReferralCompensationType;
    fixedCompensationCents?: number;
    compensationRateBasisPoints?: number;
    percentageBasis?: ReferralPercentageBasis;
    benefitDescription?: string;
    customTerms?: string;
  },
  context: z.RefinementCtx,
): void {
  const hasFixed = value.fixedCompensationCents !== undefined;
  const hasRate = value.compensationRateBasisPoints !== undefined;
  const hasBasis = value.percentageBasis !== undefined;
  const hasBenefit = value.benefitDescription !== undefined;
  const hasCustom = value.customTerms !== undefined;

  if (value.compensationType === "none") {
    if (hasFixed || hasRate || hasBasis || hasBenefit || hasCustom) {
      context.addIssue({
        code: "custom",
        path: ["compensationType"],
        message: "No-compensation terms cannot include monetary, benefit, or custom terms",
      });
    }
    return;
  }

  if (value.compensationType === "fixed") {
    if (!hasFixed) {
      context.addIssue({
        code: "custom",
        path: ["fixedCompensationCents"],
        message: "Fixed compensation requires an integer-cent amount",
      });
    }
    if (hasRate || hasBasis || hasBenefit) {
      context.addIssue({
        code: "custom",
        path: ["compensationType"],
        message: "Fixed compensation cannot include percentage or benefit fields",
      });
    }
    return;
  }

  if (value.compensationType === "percentage") {
    if (!hasRate) {
      context.addIssue({
        code: "custom",
        path: ["compensationRateBasisPoints"],
        message: "Percentage compensation requires a basis-point rate",
      });
    }
    if (!hasBasis) {
      context.addIssue({
        code: "custom",
        path: ["percentageBasis"],
        message: "Percentage compensation requires an explicit calculation basis",
      });
    }
    if (hasFixed || hasBenefit) {
      context.addIssue({
        code: "custom",
        path: ["compensationType"],
        message: "Percentage compensation cannot include fixed or benefit fields",
      });
    }
    return;
  }

  if (value.compensationType === "custom") {
    if (!hasCustom) {
      context.addIssue({
        code: "custom",
        path: ["customTerms"],
        message: "Custom compensation requires explanatory terms",
      });
    }
    if (hasFixed || hasRate || hasBasis || hasBenefit) {
      context.addIssue({
        code: "custom",
        path: ["compensationType"],
        message: "Custom compensation is not an automatic monetary formula",
      });
    }
    return;
  }

  if (!hasBenefit) {
    context.addIssue({
      code: "custom",
      path: ["benefitDescription"],
      message: "Benefit compensation requires a non-cash benefit description",
    });
  }
  if (hasFixed || hasRate || hasBasis) {
    context.addIssue({
      code: "custom",
      path: ["compensationType"],
      message: "A non-cash benefit cannot include an automatic monetary formula",
    });
  }
}

export const referralServiceOfferStatusSchema = z.enum(["draft", "published", "inactive"]);
export type ReferralServiceOfferStatus = z.infer<typeof referralServiceOfferStatusSchema>;

export const referralServiceOfferDocSchema = z
  .object({
    id: safeIdSchema,
    offerId: safeIdSchema,
    schemaVersion: z.literal(1),
    providerUid: safeIdSchema.optional(),
    providerOrgId: safeIdSchema.optional(),
    serviceName: z.string().trim().min(1).max(160),
    serviceCategory: z.string().trim().min(1).max(160),
    naicsCodes: z.array(z.string().regex(/^\d{2,6}$/)).max(50),
    territoryFips: z.array(z.string().regex(/^\d{5}$/)).max(200),
    status: referralServiceOfferStatusSchema,
    acceptingReferrals: z.boolean(),
    compensationType: referralCompensationTypeSchema,
    fixedCompensationCents: safeCentsSchema.positive().optional(),
    compensationRateBasisPoints: positiveBasisPointsSchema.optional(),
    percentageBasis: referralPercentageBasisSchema.optional(),
    currency: currencyCodeSchema,
    benefitDescription: boundedTermSchema.optional(),
    customTerms: boundedTermSchema.optional(),
    attributionWindowDays: z.number().int().min(1).max(3_650),
    payoutTrigger: z.string().trim().min(1).max(500).optional(),
    paymentDeadlineDays: z.number().int().min(1).max(3_650).optional(),
    refundTreatment: z.string().trim().min(1).max(1_000).optional(),
    includedCharges: boundedTermListSchema.optional(),
    excludedCharges: boundedTermListSchema.optional(),
    version: z.number().int().min(1).max(100),
    stateVersion: z.number().int().nonnegative(),
    effectiveAt: safeEpochMillisSchema,
    publishedAt: safeEpochMillisSchema.optional(),
    publishedBy: safeIdSchema.optional(),
    deactivatedAt: safeEpochMillisSchema.optional(),
    deactivatedBy: safeIdSchema.optional(),
    sourceVersionId: safeIdSchema.optional(),
    createdBy: safeIdSchema,
    createdAt: safeEpochMillisSchema,
    updatedAt: safeEpochMillisSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.providerUid) === Boolean(value.providerOrgId)) {
      context.addIssue({
        code: "custom",
        message: "An offer must belong to exactly one user or organization provider",
      });
    }
    validateCompensationTerms(value, context);
    const included = new Set(value.includedCharges ?? []);
    if ((value.excludedCharges ?? []).some((charge) => included.has(charge))) {
      context.addIssue({
        code: "custom",
        path: ["excludedCharges"],
        message: "A charge cannot be both included and excluded",
      });
    }
    if (value.status === "draft" && (value.publishedAt || value.deactivatedAt)) {
      context.addIssue({ code: "custom", message: "A draft cannot have publication lifecycle timestamps" });
    }
    if (value.status === "published" && (!value.publishedAt || !value.publishedBy)) {
      context.addIssue({ code: "custom", message: "A published offer requires publication authority" });
    }
    if (
      value.status === "inactive"
      && (!value.publishedAt || !value.publishedBy || !value.deactivatedAt || !value.deactivatedBy)
    ) {
      context.addIssue({ code: "custom", message: "An inactive offer requires publication and deactivation authority" });
    }
  });
export type ReferralServiceOfferDoc = z.infer<typeof referralServiceOfferDocSchema>;

export const referralTermsSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceOfferId: safeIdSchema.optional(),
    serviceOfferVersionId: safeIdSchema.optional(),
    serviceOfferVersion: z.number().int().min(1).max(100).optional(),
    compensationType: referralCompensationTypeSchema,
    fixedCompensationCents: safeCentsSchema.positive().optional(),
    compensationRateBasisPoints: positiveBasisPointsSchema.optional(),
    percentageBasis: referralPercentageBasisSchema.optional(),
    currency: currencyCodeSchema,
    benefitDescription: boundedTermSchema.optional(),
    customTerms: boundedTermSchema.optional(),
    attributionWindowDays: z.number().int().min(1).max(3_650),
    payoutTrigger: z.string().trim().min(1).max(500).optional(),
    paymentDeadlineDays: z.number().int().min(1).max(3_650).optional(),
    refundTreatment: z.string().trim().min(1).max(1_000).optional(),
    includedCharges: boundedTermListSchema.optional(),
    excludedCharges: boundedTermListSchema.optional(),
    platformFeeBasisPoints: basisPointsSchema,
    platformFeeConfigVersion: z.number().int().min(1),
    acceptedByUid: safeIdSchema,
    acceptedByOrgId: safeIdSchema.optional(),
    acceptedAt: safeEpochMillisSchema,
    calculationVersion: z.number().int().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    validateCompensationTerms(value, context);
    const included = new Set(value.includedCharges ?? []);
    if ((value.excludedCharges ?? []).some((charge) => included.has(charge))) {
      context.addIssue({
        code: "custom",
        path: ["excludedCharges"],
        message: "A charge cannot be both included and excluded",
      });
    }
    const offerFields = [value.serviceOfferId, value.serviceOfferVersionId, value.serviceOfferVersion];
    if (offerFields.some((field) => field !== undefined) && offerFields.some((field) => field === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["serviceOfferId"],
        message: "An offer-backed snapshot requires the exact offer and version identity",
      });
    }
  });
export type ReferralTermsSnapshot = z.infer<typeof referralTermsSnapshotSchema>;

export const referralCommerceConfigurationSchema = z
  .object({
    id: z.literal("referralCommerce"),
    schemaVersion: z.literal(1),
    platformFeeBasisPoints: basisPointsSchema,
    version: z.number().int().min(1),
    effectiveAt: safeEpochMillisSchema,
    updatedBy: z.string().trim().min(1).max(128),
    updatedAt: safeEpochMillisSchema,
    payoutHoldDays: z.number().int().min(0).max(365).optional(),
    manualEvidenceThresholdCents: safeCentsSchema.optional(),
    commerceEnabled: z.boolean(),
    settlementEnabled: z.literal(false),
  })
  .strict();
export type ReferralCommerceConfiguration = z.infer<typeof referralCommerceConfigurationSchema>;

export const REFERRAL_CALCULATION_VERSION = 1 as const;

export const DEFAULT_REFERRAL_COMMERCE_CONFIG = Object.freeze({
  id: "referralCommerce" as const,
  schemaVersion: 1 as const,
  platformFeeBasisPoints: 100,
  version: 1,
  effectiveAt: 0,
  updatedBy: "system:default",
  updatedAt: 0,
  commerceEnabled: true,
  settlementEnabled: false as const,
}) satisfies ReferralCommerceConfiguration;

function validateCalculationCompensation(
  value: {
    compensationType: ReferralCompensationType;
    fixedCompensationCents?: number;
    compensationRateBasisPoints?: number;
  },
  context: z.RefinementCtx,
): void {
  if (value.compensationType === "fixed" && value.fixedCompensationCents === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fixedCompensationCents"],
      message: "Fixed compensation requires an integer-cent amount",
    });
  }
  if (
    value.compensationType === "percentage"
    && value.compensationRateBasisPoints === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["compensationRateBasisPoints"],
      message: "Percentage compensation requires a basis-point rate",
    });
  }
  if (
    value.compensationType !== "fixed"
    && value.fixedCompensationCents !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["fixedCompensationCents"],
      message: "Only fixed compensation can include a fixed amount",
    });
  }
  if (
    value.compensationType !== "percentage"
    && value.compensationRateBasisPoints !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["compensationRateBasisPoints"],
      message: "Only percentage compensation can include a basis-point rate",
    });
  }
}

export const referralFinancialCalculationInputSchema = z
  .object({
    qualifyingTransactionCents: safeCentsSchema,
    collectedTransactionCents: safeCentsSchema,
    compensationType: referralCompensationTypeSchema,
    fixedCompensationCents: safeCentsSchema.positive().optional(),
    compensationRateBasisPoints: positiveBasisPointsSchema.optional(),
    platformFeeBasisPoints: basisPointsSchema,
    currency: currencyCodeSchema,
    termsCurrency: currencyCodeSchema.optional(),
  })
  .strict()
  .superRefine(validateCalculationCompensation);
export type ReferralFinancialCalculationInput = z.infer<
  typeof referralFinancialCalculationInputSchema
>;

export const referralFinancialCalculationStatusSchema = z.enum([
  "calculated",
  "no_compensation",
  "manual_terms_required",
  "non_cash_benefit",
]);
export type ReferralFinancialCalculationStatus = z.infer<
  typeof referralFinancialCalculationStatusSchema
>;

export const referralFinancialCalculationResultSchema = z
  .object({
    qualifyingTransactionCents: safeCentsSchema,
    collectedTransactionCents: safeCentsSchema,
    compensationBasisCents: safeCentsSchema,
    grossReferralPayoutCents: safeCentsSchema,
    platformFeeBasisPointsSnapshot: basisPointsSchema,
    platformFeeCents: safeCentsSchema,
    netReferrerPayoutCents: safeCentsSchema,
    currency: currencyCodeSchema,
    calculationVersion: z.literal(REFERRAL_CALCULATION_VERSION),
    calculationStatus: referralFinancialCalculationStatusSchema,
  })
  .strict();
export type ReferralFinancialCalculationResult = z.infer<
  typeof referralFinancialCalculationResultSchema
>;

function requireSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
}

/**
 * Technical MVP rounding rule: multiply with BigInt and round half-up to the
 * nearest cent. Finance/legal approval is still required before settlement.
 */
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

function normalizeCurrency(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

export function calculateReferralFinancials(
  rawInput: ReferralFinancialCalculationInput,
): ReferralFinancialCalculationResult {
  const parsed = referralFinancialCalculationInputSchema.safeParse({
    ...rawInput,
    currency: normalizeCurrency(rawInput.currency),
    termsCurrency: normalizeCurrency(rawInput.termsCurrency),
  });
  if (!parsed.success) {
    throw new RangeError(`Invalid referral calculation input: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  const input = parsed.data;
  if (input.termsCurrency !== undefined && input.termsCurrency !== input.currency) {
    throw new RangeError("Transaction currency does not match the accepted referral terms");
  }

  const compensationBasisCents = Math.min(
    input.qualifyingTransactionCents,
    input.collectedTransactionCents,
  );
  let grossReferralPayoutCents = 0;
  let calculationStatus: ReferralFinancialCalculationStatus = "calculated";

  switch (input.compensationType) {
    case "none":
      calculationStatus = "no_compensation";
      break;
    case "fixed":
      grossReferralPayoutCents = compensationBasisCents > 0
        ? input.fixedCompensationCents as number
        : 0;
      break;
    case "percentage":
      grossReferralPayoutCents = calculateBasisPointsHalfUp(
        compensationBasisCents,
        input.compensationRateBasisPoints as number,
      );
      break;
    case "custom":
      calculationStatus = "manual_terms_required";
      break;
    case "benefit":
      calculationStatus = "non_cash_benefit";
      break;
  }

  requireSafeNonnegativeInteger(grossReferralPayoutCents, "grossReferralPayoutCents");
  const platformFeeCents = calculateBasisPointsHalfUp(
    grossReferralPayoutCents,
    input.platformFeeBasisPoints,
  );
  const netReferrerPayoutCents = grossReferralPayoutCents - platformFeeCents;

  return referralFinancialCalculationResultSchema.parse({
    qualifyingTransactionCents: input.qualifyingTransactionCents,
    collectedTransactionCents: input.collectedTransactionCents,
    compensationBasisCents,
    grossReferralPayoutCents,
    platformFeeBasisPointsSnapshot: input.platformFeeBasisPoints,
    platformFeeCents,
    netReferrerPayoutCents,
    currency: input.currency,
    calculationVersion: REFERRAL_CALCULATION_VERSION,
    calculationStatus,
  });
}

export const referralTransactionReportStatusSchema = z.enum([
  "transaction_reported",
  "awaiting_confirmation",
  "transaction_confirmed",
  "payout_calculated",
  "payout_due",
  "settlement_unavailable",
  "disputed",
  "cancelled",
  "reversed",
  "refunded",
]);
export type ReferralTransactionReportStatus = z.infer<
  typeof referralTransactionReportStatusSchema
>;

export const referralTransactionReportDocSchema = z
  .object({
    id: safeIdSchema,
    schemaVersion: z.literal(1),
    referralId: safeIdSchema,
    serviceOfferId: safeIdSchema.optional(),
    serviceOfferVersion: z.number().int().min(1).max(100).optional(),
    reportedByUid: safeIdSchema,
    reportedByOrgId: safeIdSchema.optional(),
    contractReference: z.string().trim().min(1).max(160).optional(),
    invoiceReference: z.string().trim().min(1).max(160).optional(),
    qualifyingTransactionCents: safeCentsSchema,
    collectedTransactionCents: safeCentsSchema,
    collectionDate: safeEpochMillisSchema,
    currency: currencyCodeSchema,
    evidenceStoragePaths: z.array(z.string().trim().min(1).max(1_024)).max(10),
    refundStatus: z.enum(["none", "partial", "full", "cancelled"]),
    refundAmountCents: safeCentsSchema.optional(),
    status: referralTransactionReportStatusSchema,
    referrerDecision: z.enum([
      "pending",
      "confirmed",
      "disputed",
      "clarification_requested",
    ]),
    // Private workflow context. Participant projections, timelines, and analytics must omit it.
    reviewNote: z.string().trim().min(3).max(2_000).optional(),
    confirmedByUid: safeIdSchema.optional(),
    confirmedAt: safeEpochMillisSchema.optional(),
    financials: referralFinancialCalculationResultSchema.optional(),
    version: z.number().int().nonnegative(),
    createdAt: safeEpochMillisSchema,
    updatedAt: safeEpochMillisSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.refundAmountCents !== undefined
      && value.refundAmountCents > value.collectedTransactionCents
    ) {
      context.addIssue({
        code: "custom",
        path: ["refundAmountCents"],
        message: "A refund cannot exceed the collected amount",
      });
    }
    if (
      value.referrerDecision === "confirmed"
      && (!value.confirmedByUid || !value.confirmedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["confirmedByUid"],
        message: "A confirmed report requires confirmation authority and time",
      });
    }
  });
export type ReferralTransactionReportDoc = z.infer<
  typeof referralTransactionReportDocSchema
>;
