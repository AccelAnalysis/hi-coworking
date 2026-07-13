import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

const trimmedId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const shortText = z.string().trim().min(1).max(160);
const longText = z.string().trim().min(1).max(10_000);
const optionalShortText = z.string().trim().max(500).optional();
const epochMillis = z.number().int().nonnegative();
const orgId = trimmedId.optional();

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:@-]+$/);

export const rfxTeamRoleSchema = z.enum([
  "prime",
  "sub",
  "estimator",
  "compliance",
  "proposal_writer",
]);

export const nonPrimeTeamRoleSchema = z.enum([
  "sub",
  "estimator",
  "compliance",
  "proposal_writer",
]);

export const evaluationCriterionInputSchema = z
  .object({
    id: trimmedId,
    label: shortText,
    weight: z.number().min(0).max(100),
    direction: z.enum(["lower_is_better", "higher_is_better"]),
    description: optionalShortText,
  })
  .strict();

export const requestedDocumentInputSchema = z
  .object({
    id: trimmedId,
    label: shortText,
    required: z.boolean().default(false),
    description: optionalShortText,
  })
  .strict();

export const rfxPublishInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    orgId,
    title: shortText,
    description: longText,
    naicsCodes: z.array(z.string().trim().regex(/^\d{2,6}$/)).max(25).optional(),
    location: z.string().trim().max(240).optional(),
    territoryFips: z.string().regex(/^\d{5}$/),
    geoLat: z.number().min(-90).max(90),
    geoLng: z.number().min(-180).max(180),
    dueDate: epochMillis.optional(),
    budget: z.string().trim().max(120).optional(),
    memberOnly: z.boolean().default(false),
    template: z.string().trim().max(80).optional(),
    evaluationCriteria: z.array(evaluationCriterionInputSchema).max(20).default([]),
    requestedDocuments: z.array(requestedDocumentInputSchema).max(20).default([]),
    adminOverrideReason: z.string().trim().min(10).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const weight = value.evaluationCriteria.reduce((total, criterion) => total + criterion.weight, 0);
    if (value.evaluationCriteria.length > 0 && Math.abs(weight - 100) > 0.001) {
      ctx.addIssue({
        code: "custom",
        path: ["evaluationCriteria"],
        message: "Evaluation criteria weights must total 100",
      });
    }
    if (value.dueDate !== undefined && value.dueDate <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date must be in the future",
      });
    }
  });

export const rfxUpdateInputSchema = z
  .object({
    rfxId: trimmedId,
    expectedVersion: z.number().int().nonnegative(),
    title: shortText.optional(),
    description: longText.optional(),
    naicsCodes: z.array(z.string().trim().regex(/^\d{2,6}$/)).max(25).optional(),
    location: z.string().trim().max(240).optional(),
    dueDate: epochMillis.optional(),
    budget: z.string().trim().max(120).optional(),
    memberOnly: z.boolean().optional(),
    evaluationCriteria: z.array(evaluationCriterionInputSchema).max(20).optional(),
    requestedDocuments: z.array(requestedDocumentInputSchema).max(20).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => !["rfxId", "expectedVersion"].includes(key)),
    "At least one editable RFx field is required",
  );

export const rfxModerateInputSchema = z
  .object({
    rfxId: trimmedId,
    decision: z.enum(["approve", "reject"]),
    reviewNote: z.string().trim().min(3).max(1_000),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export const rfxCancelInputSchema = z
  .object({
    rfxId: trimmedId,
    reason: z.string().trim().min(3).max(1_000),
    expectedVersion: z.number().int().nonnegative(),
    adminOverrideReason: z.string().trim().min(10).max(500).optional(),
  })
  .strict();

export const rfxBackfillGeoInputSchema = z
  .object({
    maxDocs: z.number().int().min(1).max(400).default(300),
    afterId: trimmedId.optional(),
    apply: z.boolean().default(false),
    projectId: z.string().trim().min(1).max(120).optional(),
    confirmProject: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const responseAttachmentInputSchema = z
  .object({
    requestedDocId: trimmedId.optional(),
    label: shortText,
    storagePath: z.string().trim().min(1).max(1_024),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(120).optional(),
    size: z.number().int().positive().max(25 * 1024 * 1024).optional(),
  })
  .strict();

export const rfxSubmitResponseInputSchema = z
  .object({
    rfxId: trimmedId,
    orgId,
    idempotencyKey: idempotencyKeySchema,
    bidAmount: z.number().nonnegative().max(1_000_000_000).optional(),
    experience: z.number().nonnegative().max(100).optional(),
    timeline: z.number().nonnegative().max(5_200).optional(),
    skills: z.string().trim().max(5_000).optional(),
    pastPerformance: z.string().trim().max(10_000).optional(),
    credentials: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
    references: z.string().trim().max(10_000).optional(),
    proposalText: z.string().trim().max(25_000).optional(),
    proposalStoragePath: z.string().trim().max(1_024).optional(),
    uploadedDocuments: z.array(responseAttachmentInputSchema).max(25).default([]),
  })
  .strict();

export const rfxPrepareResponseUploadsInputSchema = z
  .object({
    rfxId: trimmedId,
    orgId,
    attachments: z.array(z.object({
      storagePath: z.string().trim().min(1).max(1_024),
      contentType: z.string().trim().min(1).max(120),
      size: z.number().int().positive().max(25 * 1024 * 1024),
    }).strict()).min(1).max(26),
  })
  .strict();

export const rfxEvaluateResponseInputSchema = z
  .object({
    responseId: trimmedId,
    transition: z.enum(["under_review", "accepted", "declined"]),
    criteriaScores: z.record(trimmedId, z.number().min(0).max(100)).optional(),
    evaluationNotes: z.string().trim().max(5_000).optional(),
    expectedRfxVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export const teamCreateInputSchema = z
  .object({
    rfxId: trimmedId,
    name: shortText,
    internalNotes: z.string().trim().max(5_000).optional(),
    orgId,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const teamInviteInputSchema = z
  .object({
    teamId: trimmedId,
    rfxId: trimmedId,
    inviteeUid: trimmedId,
    role: nonPrimeTeamRoleSchema,
    note: z.string().trim().max(2_000).optional(),
    expiresInDays: z.number().int().min(1).max(30).default(14),
  })
  .strict();

export const teamRespondInviteInputSchema = z
  .object({
    inviteId: trimmedId,
    response: z.enum(["accepted", "declined"]),
  })
  .strict();

export const teamRevokeInviteInputSchema = z
  .object({
    inviteId: trimmedId,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const teamManageMemberInputSchema = z
  .object({
    teamId: trimmedId,
    memberUid: trimmedId,
    action: z.enum(["update", "remove"]),
    newRole: nonPrimeTeamRoleSchema.optional(),
    scopeDescription: z.string().trim().max(2_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "update" && !value.newRole && value.scopeDescription === undefined) {
      ctx.addIssue({ code: "custom", message: "A role or scope update is required" });
    }
  });

export const legacyReferralTypeSchema = z.enum(["platform_invite", "business_intro"]);

export const legacyReferralCreateInputSchema = z
  .object({
    type: legacyReferralTypeSchema.default("platform_invite"),
    idempotencyKey: idempotencyKeySchema,
    referredEmail: z.string().trim().email().max(320).optional(),
    referredName: z.string().trim().max(160).optional(),
    providerUid: trimmedId.optional(),
    clientName: z.string().trim().max(160).optional(),
    clientEmail: z.string().trim().email().max(320).optional(),
    clientPhone: z.string().trim().max(40).optional(),
    clientCompany: z.string().trim().max(200).optional(),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "platform_invite" && !value.referredEmail) {
      ctx.addIssue({ code: "custom", path: ["referredEmail"], message: "Invite email is required" });
    }
    if (value.type === "business_intro") {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: "New business introductions must use the business referral API",
      });
    }
  });

export const legacyReferralActionInputSchema = z
  .object({
    referralId: trimmedId,
    note: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const businessReferralTypeSchema = z.enum([
  "customer_introduction",
  "business_lead",
  "project_opportunity",
  "service_need",
  "partner_introduction",
  "other",
]);

export const businessReferralStatusSchema = z.enum([
  "draft",
  "sent",
  "accepted",
  "declined",
  "in_progress",
  "converted",
  "closed",
  "withdrawn",
  "expired",
]);

export const businessReferralConsentSchema = z.enum([
  "not_required",
  "pending",
  "confirmed",
  "withdrawn",
  "unknown_legacy",
]);

export const businessReferralCompensationSchema = z
  .object({
    type: z.enum(["none", "fixed", "percentage", "custom"]).default("none"),
    amountCents: z.number().int().positive().max(100_000_000).optional(),
    percentageBasisPoints: z.number().int().min(1).max(10_000).optional(),
    terms: z.string().trim().max(5_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "none" && (value.amountCents || value.percentageBasisPoints || value.terms)) {
      ctx.addIssue({ code: "custom", message: "No-compensation referrals cannot include payment terms" });
    }
    if (value.type === "fixed" && value.amountCents === undefined) {
      ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Fixed compensation requires an amount" });
    }
    if (value.type === "percentage" && value.percentageBasisPoints === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["percentageBasisPoints"],
        message: "Percentage compensation requires basis points",
      });
    }
  });

export const businessReferralContactInputSchema = z
  .object({
    type: z.enum(["person", "business"]),
    name: z.string().trim().max(160).optional(),
    companyName: z.string().trim().max(200).optional(),
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();

export const businessReferralCreateInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    referrerOrgId: orgId,
    recipientUid: trimmedId.optional(),
    recipientOrgId: orgId,
    referralType: businessReferralTypeSchema,
    title: shortText,
    needSummary: longText,
    category: z.string().trim().max(160).optional(),
    naicsCodes: z.array(z.string().trim().regex(/^\d{2,6}$/)).max(25).optional(),
    territoryFips: z.string().regex(/^\d{5}$/).optional(),
    consentStatus: z.enum(["not_required", "pending", "confirmed"]),
    referredParty: businessReferralContactInputSchema.optional(),
    compensationPolicy: businessReferralCompensationSchema.optional(),
    relatedRfxId: trimmedId.optional(),
    relatedTeamId: trimmedId.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.recipientUid && !value.recipientOrgId) {
      ctx.addIssue({ code: "custom", message: "A recipient user or organization is required" });
    }
    const hasContact = Boolean(
      value.referredParty?.email || value.referredParty?.phone || value.referredParty?.name,
    );
    if (hasContact && value.consentStatus === "not_required") {
      ctx.addIssue({
        code: "custom",
        path: ["consentStatus"],
        message: "Third-party contact information requires an explicit consent state",
      });
    }
  });

export const businessReferralSendInputSchema = z
  .object({
    referralId: trimmedId,
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export const businessReferralRespondInputSchema = z
  .object({
    referralId: trimmedId,
    response: z.enum(["accepted", "declined"]),
    expectedVersion: z.number().int().nonnegative(),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const businessReferralProgressInputSchema = z
  .object({
    referralId: trimmedId,
    status: z.enum(["in_progress", "converted", "closed", "withdrawn"]),
    expectedVersion: z.number().int().nonnegative(),
    outcome: z
      .object({
        type: z.enum([
          "converted",
          "not_a_fit",
          "unable_to_contact",
          "declined_by_customer",
          "duplicate",
          "other",
        ]),
        summary: z.string().trim().max(2_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.status === "converted" || value.status === "closed") && !value.outcome) {
      ctx.addIssue({ code: "custom", path: ["outcome"], message: "A final outcome is required" });
    }
    if (value.status === "converted" && value.outcome?.type !== "converted") {
      ctx.addIssue({
        code: "custom",
        path: ["outcome", "type"],
        message: "A converted referral requires the converted outcome",
      });
    }
    if (value.status === "closed" && value.outcome?.type === "converted") {
      ctx.addIssue({
        code: "custom",
        path: ["outcome", "type"],
        message: "Use converted status for a converted outcome",
      });
    }
    if ((value.status === "in_progress" || value.status === "withdrawn") && value.outcome) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Only a terminal converted or closed referral may record an outcome",
      });
    }
  });

export const businessReferralConsentInputSchema = z
  .object({
    referralId: trimmedId,
    consentStatus: z.enum(["confirmed", "withdrawn"]),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export const referralDisputeCreateInputSchema = z
  .object({
    referralId: trimmedId,
    reason: z.string().trim().min(10).max(5_000),
    evidenceStoragePaths: z.array(z.string().trim().min(1).max(1_024)).max(10).default([]),
  })
  .strict();

export const verificationDocumentTypeSchema = z.enum([
  "business_license",
  "ein_letter",
  "utility_bill",
  "government_id",
  "other",
]);

export const verificationSubmitInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    documents: z
      .array(
        z
          .object({
            type: verificationDocumentTypeSchema,
            label: shortText,
            storagePath: z.string().trim().min(1).max(1_024),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    const types = value.documents.map((document) => document.type);
    if (new Set(types).size !== types.length) {
      ctx.addIssue({
        code: "custom",
        path: ["documents"],
        message: "Only one document per verification type may be submitted at a time",
      });
    }
  });

export const verificationReviewInputSchema = z
  .object({
    uid: trimmedId,
    documentId: trimmedId.optional(),
    documentStatus: z.enum(["approved", "rejected"]).optional(),
    finalStatus: z.enum(["pending", "verified", "rejected"]).optional(),
    reviewNote: z.string().trim().max(2_000).optional(),
    expectedProfileVersion: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.documentId && !value.finalStatus) {
      ctx.addIssue({ code: "custom", message: "A document decision or final status is required" });
    }
    if (Boolean(value.documentId) !== Boolean(value.documentStatus)) {
      ctx.addIssue({
        code: "custom",
        message: "documentId and documentStatus must be supplied together",
      });
    }
    if ((value.documentStatus === "rejected" || value.finalStatus === "rejected") && !value.reviewNote) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewNote"],
        message: "A review note is required for rejection",
      });
    }
  });

export const verificationFlagInputSchema = z
  .object({
    uid: trimmedId,
    reason: z.string().trim().min(10).max(2_000),
  })
  .strict();

export function parseCallableInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Invalid request data", {
      issues: parsed.error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export type RfxPublishInput = z.infer<typeof rfxPublishInputSchema>;
export type RfxSubmitResponseInput = z.infer<typeof rfxSubmitResponseInputSchema>;
export type BusinessReferralStatus = z.infer<typeof businessReferralStatusSchema>;
export type BusinessReferralConsent = z.infer<typeof businessReferralConsentSchema>;
