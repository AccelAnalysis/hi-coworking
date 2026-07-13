"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificationFlagInputSchema = exports.verificationReviewInputSchema = exports.verificationSubmitInputSchema = exports.verificationDocumentTypeSchema = exports.referralDisputeCreateInputSchema = exports.businessReferralConsentInputSchema = exports.businessReferralProgressInputSchema = exports.businessReferralRespondInputSchema = exports.businessReferralSendInputSchema = exports.businessReferralCreateInputSchema = exports.businessReferralContactInputSchema = exports.businessReferralCompensationSchema = exports.businessReferralConsentSchema = exports.businessReferralStatusSchema = exports.businessReferralTypeSchema = exports.legacyReferralActionInputSchema = exports.legacyReferralCreateInputSchema = exports.legacyReferralTypeSchema = exports.teamManageMemberInputSchema = exports.teamRevokeInviteInputSchema = exports.teamRespondInviteInputSchema = exports.teamInviteInputSchema = exports.teamCreateInputSchema = exports.rfxEvaluateResponseInputSchema = exports.rfxPrepareResponseUploadsInputSchema = exports.rfxSubmitResponseInputSchema = exports.responseAttachmentInputSchema = exports.rfxBackfillGeoInputSchema = exports.rfxCancelInputSchema = exports.rfxModerateInputSchema = exports.rfxUpdateInputSchema = exports.rfxPublishInputSchema = exports.requestedDocumentInputSchema = exports.evaluationCriterionInputSchema = exports.nonPrimeTeamRoleSchema = exports.rfxTeamRoleSchema = exports.idempotencyKeySchema = void 0;
exports.parseCallableInput = parseCallableInput;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const trimmedId = zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const shortText = zod_1.z.string().trim().min(1).max(160);
const longText = zod_1.z.string().trim().min(1).max(10000);
const optionalShortText = zod_1.z.string().trim().max(500).optional();
const epochMillis = zod_1.z.number().int().nonnegative();
const orgId = trimmedId.optional();
exports.idempotencyKeySchema = zod_1.z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_.:@-]+$/);
exports.rfxTeamRoleSchema = zod_1.z.enum([
    "prime",
    "sub",
    "estimator",
    "compliance",
    "proposal_writer",
]);
exports.nonPrimeTeamRoleSchema = zod_1.z.enum([
    "sub",
    "estimator",
    "compliance",
    "proposal_writer",
]);
exports.evaluationCriterionInputSchema = zod_1.z
    .object({
    id: trimmedId,
    label: shortText,
    weight: zod_1.z.number().min(0).max(100),
    direction: zod_1.z.enum(["lower_is_better", "higher_is_better"]),
    description: optionalShortText,
})
    .strict();
exports.requestedDocumentInputSchema = zod_1.z
    .object({
    id: trimmedId,
    label: shortText,
    required: zod_1.z.boolean().default(false),
    description: optionalShortText,
})
    .strict();
exports.rfxPublishInputSchema = zod_1.z
    .object({
    idempotencyKey: exports.idempotencyKeySchema,
    orgId,
    title: shortText,
    description: longText,
    naicsCodes: zod_1.z.array(zod_1.z.string().trim().regex(/^\d{2,6}$/)).max(25).optional(),
    location: zod_1.z.string().trim().max(240).optional(),
    territoryFips: zod_1.z.string().regex(/^\d{5}$/),
    geoLat: zod_1.z.number().min(-90).max(90),
    geoLng: zod_1.z.number().min(-180).max(180),
    dueDate: epochMillis.optional(),
    budget: zod_1.z.string().trim().max(120).optional(),
    memberOnly: zod_1.z.boolean().default(false),
    template: zod_1.z.string().trim().max(80).optional(),
    evaluationCriteria: zod_1.z.array(exports.evaluationCriterionInputSchema).max(20).default([]),
    requestedDocuments: zod_1.z.array(exports.requestedDocumentInputSchema).max(20).default([]),
    adminOverrideReason: zod_1.z.string().trim().min(10).max(500).optional(),
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
exports.rfxUpdateInputSchema = zod_1.z
    .object({
    rfxId: trimmedId,
    expectedVersion: zod_1.z.number().int().nonnegative(),
    title: shortText.optional(),
    description: longText.optional(),
    naicsCodes: zod_1.z.array(zod_1.z.string().trim().regex(/^\d{2,6}$/)).max(25).optional(),
    location: zod_1.z.string().trim().max(240).optional(),
    dueDate: epochMillis.optional(),
    budget: zod_1.z.string().trim().max(120).optional(),
    memberOnly: zod_1.z.boolean().optional(),
    evaluationCriteria: zod_1.z.array(exports.evaluationCriterionInputSchema).max(20).optional(),
    requestedDocuments: zod_1.z.array(exports.requestedDocumentInputSchema).max(20).optional(),
})
    .strict()
    .refine((value) => Object.keys(value).some((key) => !["rfxId", "expectedVersion"].includes(key)), "At least one editable RFx field is required");
exports.rfxModerateInputSchema = zod_1.z
    .object({
    rfxId: trimmedId,
    decision: zod_1.z.enum(["approve", "reject"]),
    reviewNote: zod_1.z.string().trim().min(3).max(1000),
    expectedVersion: zod_1.z.number().int().nonnegative(),
})
    .strict();
exports.rfxCancelInputSchema = zod_1.z
    .object({
    rfxId: trimmedId,
    reason: zod_1.z.string().trim().min(3).max(1000),
    expectedVersion: zod_1.z.number().int().nonnegative(),
    adminOverrideReason: zod_1.z.string().trim().min(10).max(500).optional(),
})
    .strict();
exports.rfxBackfillGeoInputSchema = zod_1.z
    .object({
    maxDocs: zod_1.z.number().int().min(1).max(400).default(300),
    afterId: trimmedId.optional(),
    apply: zod_1.z.boolean().default(false),
    projectId: zod_1.z.string().trim().min(1).max(120).optional(),
    confirmProject: zod_1.z.string().trim().min(1).max(120).optional(),
})
    .strict();
exports.responseAttachmentInputSchema = zod_1.z
    .object({
    requestedDocId: trimmedId.optional(),
    label: shortText,
    storagePath: zod_1.z.string().trim().min(1).max(1024),
    fileName: zod_1.z.string().trim().min(1).max(255),
    contentType: zod_1.z.string().trim().min(1).max(120).optional(),
    size: zod_1.z.number().int().positive().max(25 * 1024 * 1024).optional(),
})
    .strict();
exports.rfxSubmitResponseInputSchema = zod_1.z
    .object({
    rfxId: trimmedId,
    orgId,
    idempotencyKey: exports.idempotencyKeySchema,
    bidAmount: zod_1.z.number().nonnegative().max(1000000000).optional(),
    experience: zod_1.z.number().nonnegative().max(100).optional(),
    timeline: zod_1.z.number().nonnegative().max(5200).optional(),
    skills: zod_1.z.string().trim().max(5000).optional(),
    pastPerformance: zod_1.z.string().trim().max(10000).optional(),
    credentials: zod_1.z.array(zod_1.z.string().trim().min(1).max(160)).max(50).optional(),
    references: zod_1.z.string().trim().max(10000).optional(),
    proposalText: zod_1.z.string().trim().max(25000).optional(),
    proposalStoragePath: zod_1.z.string().trim().max(1024).optional(),
    uploadedDocuments: zod_1.z.array(exports.responseAttachmentInputSchema).max(25).default([]),
})
    .strict();
exports.rfxPrepareResponseUploadsInputSchema = zod_1.z
    .object({
    rfxId: trimmedId,
    orgId,
    attachments: zod_1.z.array(zod_1.z.object({
        storagePath: zod_1.z.string().trim().min(1).max(1024),
        contentType: zod_1.z.string().trim().min(1).max(120),
        size: zod_1.z.number().int().positive().max(25 * 1024 * 1024),
    }).strict()).min(1).max(26),
})
    .strict();
exports.rfxEvaluateResponseInputSchema = zod_1.z
    .object({
    responseId: trimmedId,
    transition: zod_1.z.enum(["under_review", "accepted", "declined"]),
    criteriaScores: zod_1.z.record(trimmedId, zod_1.z.number().min(0).max(100)).optional(),
    evaluationNotes: zod_1.z.string().trim().max(5000).optional(),
    expectedRfxVersion: zod_1.z.number().int().nonnegative().optional(),
})
    .strict();
exports.teamCreateInputSchema = zod_1.z
    .object({
    rfxId: trimmedId,
    name: shortText,
    internalNotes: zod_1.z.string().trim().max(5000).optional(),
    orgId,
    idempotencyKey: exports.idempotencyKeySchema,
})
    .strict();
exports.teamInviteInputSchema = zod_1.z
    .object({
    teamId: trimmedId,
    rfxId: trimmedId,
    inviteeUid: trimmedId,
    role: exports.nonPrimeTeamRoleSchema,
    note: zod_1.z.string().trim().max(2000).optional(),
    expiresInDays: zod_1.z.number().int().min(1).max(30).default(14),
})
    .strict();
exports.teamRespondInviteInputSchema = zod_1.z
    .object({
    inviteId: trimmedId,
    response: zod_1.z.enum(["accepted", "declined"]),
})
    .strict();
exports.teamRevokeInviteInputSchema = zod_1.z
    .object({
    inviteId: trimmedId,
    reason: zod_1.z.string().trim().min(3).max(500),
})
    .strict();
exports.teamManageMemberInputSchema = zod_1.z
    .object({
    teamId: trimmedId,
    memberUid: trimmedId,
    action: zod_1.z.enum(["update", "remove"]),
    newRole: exports.nonPrimeTeamRoleSchema.optional(),
    scopeDescription: zod_1.z.string().trim().max(2000).optional(),
})
    .strict()
    .superRefine((value, ctx) => {
    if (value.action === "update" && !value.newRole && value.scopeDescription === undefined) {
        ctx.addIssue({ code: "custom", message: "A role or scope update is required" });
    }
});
exports.legacyReferralTypeSchema = zod_1.z.enum(["platform_invite", "business_intro"]);
exports.legacyReferralCreateInputSchema = zod_1.z
    .object({
    type: exports.legacyReferralTypeSchema.default("platform_invite"),
    idempotencyKey: exports.idempotencyKeySchema,
    referredEmail: zod_1.z.string().trim().email().max(320).optional(),
    referredName: zod_1.z.string().trim().max(160).optional(),
    providerUid: trimmedId.optional(),
    clientName: zod_1.z.string().trim().max(160).optional(),
    clientEmail: zod_1.z.string().trim().email().max(320).optional(),
    clientPhone: zod_1.z.string().trim().max(40).optional(),
    clientCompany: zod_1.z.string().trim().max(200).optional(),
    note: zod_1.z.string().trim().max(2000).optional(),
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
exports.legacyReferralActionInputSchema = zod_1.z
    .object({
    referralId: trimmedId,
    note: zod_1.z.string().trim().max(2000).optional(),
})
    .strict();
exports.businessReferralTypeSchema = zod_1.z.enum([
    "customer_introduction",
    "business_lead",
    "project_opportunity",
    "service_need",
    "partner_introduction",
    "other",
]);
exports.businessReferralStatusSchema = zod_1.z.enum([
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
exports.businessReferralConsentSchema = zod_1.z.enum([
    "not_required",
    "pending",
    "confirmed",
    "withdrawn",
    "unknown_legacy",
]);
exports.businessReferralCompensationSchema = zod_1.z
    .object({
    type: zod_1.z.enum(["none", "fixed", "percentage", "custom"]).default("none"),
    amountCents: zod_1.z.number().int().positive().max(100000000).optional(),
    percentageBasisPoints: zod_1.z.number().int().min(1).max(10000).optional(),
    terms: zod_1.z.string().trim().max(5000).optional(),
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
exports.businessReferralContactInputSchema = zod_1.z
    .object({
    type: zod_1.z.enum(["person", "business"]),
    name: zod_1.z.string().trim().max(160).optional(),
    companyName: zod_1.z.string().trim().max(200).optional(),
    email: zod_1.z.string().trim().email().max(320).optional(),
    phone: zod_1.z.string().trim().max(40).optional(),
})
    .strict();
exports.businessReferralCreateInputSchema = zod_1.z
    .object({
    idempotencyKey: exports.idempotencyKeySchema,
    referrerOrgId: orgId,
    recipientUid: trimmedId.optional(),
    recipientOrgId: orgId,
    referralType: exports.businessReferralTypeSchema,
    title: shortText,
    needSummary: longText,
    category: zod_1.z.string().trim().max(160).optional(),
    naicsCodes: zod_1.z.array(zod_1.z.string().trim().regex(/^\d{2,6}$/)).max(25).optional(),
    territoryFips: zod_1.z.string().regex(/^\d{5}$/).optional(),
    consentStatus: zod_1.z.enum(["not_required", "pending", "confirmed"]),
    referredParty: exports.businessReferralContactInputSchema.optional(),
    compensationPolicy: exports.businessReferralCompensationSchema.optional(),
    relatedRfxId: trimmedId.optional(),
    relatedTeamId: trimmedId.optional(),
})
    .strict()
    .superRefine((value, ctx) => {
    if (!value.recipientUid && !value.recipientOrgId) {
        ctx.addIssue({ code: "custom", message: "A recipient user or organization is required" });
    }
    const hasContact = Boolean(value.referredParty?.email || value.referredParty?.phone || value.referredParty?.name);
    if (hasContact && value.consentStatus === "not_required") {
        ctx.addIssue({
            code: "custom",
            path: ["consentStatus"],
            message: "Third-party contact information requires an explicit consent state",
        });
    }
});
exports.businessReferralSendInputSchema = zod_1.z
    .object({
    referralId: trimmedId,
    expectedVersion: zod_1.z.number().int().nonnegative(),
})
    .strict();
exports.businessReferralRespondInputSchema = zod_1.z
    .object({
    referralId: trimmedId,
    response: zod_1.z.enum(["accepted", "declined"]),
    expectedVersion: zod_1.z.number().int().nonnegative(),
    note: zod_1.z.string().trim().max(2000).optional(),
})
    .strict();
exports.businessReferralProgressInputSchema = zod_1.z
    .object({
    referralId: trimmedId,
    status: zod_1.z.enum(["in_progress", "converted", "closed", "withdrawn"]),
    expectedVersion: zod_1.z.number().int().nonnegative(),
    outcome: zod_1.z
        .object({
        type: zod_1.z.enum([
            "converted",
            "not_a_fit",
            "unable_to_contact",
            "declined_by_customer",
            "duplicate",
            "other",
        ]),
        summary: zod_1.z.string().trim().max(2000).optional(),
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
exports.businessReferralConsentInputSchema = zod_1.z
    .object({
    referralId: trimmedId,
    consentStatus: zod_1.z.enum(["confirmed", "withdrawn"]),
    expectedVersion: zod_1.z.number().int().nonnegative(),
})
    .strict();
exports.referralDisputeCreateInputSchema = zod_1.z
    .object({
    referralId: trimmedId,
    reason: zod_1.z.string().trim().min(10).max(5000),
    evidenceStoragePaths: zod_1.z.array(zod_1.z.string().trim().min(1).max(1024)).max(10).default([]),
})
    .strict();
exports.verificationDocumentTypeSchema = zod_1.z.enum([
    "business_license",
    "ein_letter",
    "utility_bill",
    "government_id",
    "other",
]);
exports.verificationSubmitInputSchema = zod_1.z
    .object({
    idempotencyKey: exports.idempotencyKeySchema,
    documents: zod_1.z
        .array(zod_1.z
        .object({
        type: exports.verificationDocumentTypeSchema,
        label: shortText,
        storagePath: zod_1.z.string().trim().min(1).max(1024),
    })
        .strict())
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
exports.verificationReviewInputSchema = zod_1.z
    .object({
    uid: trimmedId,
    documentId: trimmedId.optional(),
    documentStatus: zod_1.z.enum(["approved", "rejected"]).optional(),
    finalStatus: zod_1.z.enum(["pending", "verified", "rejected"]).optional(),
    reviewNote: zod_1.z.string().trim().max(2000).optional(),
    expectedProfileVersion: zod_1.z.number().int().nonnegative().optional(),
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
exports.verificationFlagInputSchema = zod_1.z
    .object({
    uid: trimmedId,
    reason: zod_1.z.string().trim().min(10).max(2000),
})
    .strict();
function parseCallableInput(schema, data) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", "Invalid request data", {
            issues: parsed.error.issues.slice(0, 8).map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        });
    }
    return parsed.data;
}
