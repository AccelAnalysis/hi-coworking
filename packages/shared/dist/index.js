"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventStatusSchema = exports.referralDocSchema = exports.referralTypeSchema = exports.referralStatusSchema = exports.referralDisputeDocSchema = exports.referralPolicyDocSchema = exports.referralPolicyTemplateSchema = exports.RFX_TEMPLATES = exports.rfxResponseDocSchema = exports.uploadedDocumentSchema = exports.rfxResponseStatusSchema = exports.rfxDocSchema = exports.requestedDocumentSchema = exports.evaluationCriterionSchema = exports.scoringDirectionSchema = exports.rfxAdminApprovalSchema = exports.rfxStatusSchema = exports.verificationAuditEntrySchema = exports.verificationAuditActionSchema = exports.verificationDocumentSchema = exports.verificationDocumentStatusSchema = exports.verificationDocTypeSchema = exports.territoryDocSchema = exports.territoryStatusSchema = exports.profileReadinessTierSchema = exports.profileDocSchema = exports.orgMemberDocSchema = exports.orgDocSchema = exports.userDocSchema = exports.membershipTrackSchema = exports.membershipStatusSchema = exports.userRoleSchema = exports.bookingSchema = exports.bookingStatusSchema = exports.resourceSchema = exports.resourceTypeSchema = exports.floorplanSchema = exports.layoutVariantSchema = exports.shellDocSchema = exports.floorDocSchema = exports.locationDocSchema = exports.floorBackgroundSchema = exports.LAYOUT_ELEMENT_TYPES = exports.SHELL_ELEMENT_TYPES = exports.layoutElementTypeValues = exports.shellElementTypeValues = exports.floorplanElementSchema = exports.floorplanElementTypeSchema = exports.elementShapeSchema = exports.doorTypeSchema = void 0;
exports.bookPurchaseDocSchema = exports.bookDocSchema = exports.bookSalesChannelSchema = exports.bookAvailabilityModeSchema = exports.SPACE_INVENTORY = exports.CONFERENCE_ROOM_CONFIG = exports.NON_MEMBER_PRICING = exports.GUEST_PRICING = exports.RESOURCE_CATALOG = exports.MEMBERSHIP_TIERS = exports.membershipTierIdSchema = exports.platformFeeDocSchema = exports.CREDIT_COSTS = exports.CREDIT_PACKS = exports.creditTransactionDocSchema = exports.creditTransactionTypeSchema = exports.teamDocumentSchema = exports.rfxTeamDocSchema = exports.rfxTeamMemberSchema = exports.rfxTeamRoleSchema = exports.rfxTeamInviteDocSchema = exports.rfxTeamInviteStatusSchema = exports.paymentAuditEntrySchema = exports.paymentAuditActionSchema = exports.productDocSchema = exports.productVariantSchema = exports.notificationDocSchema = exports.notificationTypeSchema = exports.leadDocSchema = exports.webhookEventDocSchema = exports.paymentDocSchema = exports.paymentPurposeSchema = exports.paymentStatusSchema = exports.paymentProviderSchema = exports.socialPostDocSchema = exports.eventShareKitDocSchema = exports.campaignJobDocSchema = exports.eventCampaignDocSchema = exports.eventWaitlistEntryDocSchema = exports.eventRegistrationDocSchema = exports.eventDocSchema = exports.eventSeriesDocSchema = exports.eventCampaignSummarySchema = exports.eventAudienceRulesSchema = exports.eventSpeakerCardSchema = exports.eventPromoVideoSchema = exports.eventMediaImageSchema = exports.eventSponsorshipTierSchema = exports.eventTicketTypeSchema = exports.eventFormatSchema = void 0;
exports.bookAffiliateClickDocSchema = void 0;
exports.isShellType = isShellType;
exports.isLayoutType = isLayoutType;
exports.computeReadinessTier = computeReadinessTier;
exports.canTransact = canTransact;
exports.computeCriterionScore = computeCriterionScore;
exports.computeRfxScores = computeRfxScores;
exports.getResourceById = getResourceById;
exports.getResourcesByType = getResourcesByType;
const zod_1 = require("zod");
exports.doorTypeSchema = zod_1.z.enum([
    "OPENING",
    "STANDARD",
    "KEY_ENTRY",
    "SCAN_TO_ENTER",
    "PIN_CODE",
    "PUSH_BAR",
    "EMERGENCY_EXIT",
]);
exports.elementShapeSchema = zod_1.z.enum(["RECT", "LINE", "POLY", "ICON", "TEXT"]);
exports.floorplanElementTypeSchema = zod_1.z.enum([
    // Shell / Architecture
    "WALL",
    "ROOM",
    "DOOR",
    "WINDOW",
    "STAIRS",
    "ELEVATOR",
    "BATHROOM",
    "COLUMN",
    "RECEPTION",
    "ENTRANCE",
    "EXIT",
    "FIRE_EXIT",
    "UTILITY",
    // Layout / Ops / Bookable
    "DESK",
    "SEAT",
    "MODE_ZONE",
    "AMENITY",
    "FURNITURE",
    "SIGNAGE",
    "POWER",
    "ACCESS_READER",
    "CAMERA",
    "FIRE_EXTINGUISHER",
    "TRASH",
    "PLANT",
]);
exports.floorplanElementSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: exports.floorplanElementTypeSchema,
    shape: exports.elementShapeSchema.optional(),
    label: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    resourceId: zod_1.z.string().optional(),
    x: zod_1.z.number(),
    y: zod_1.z.number(),
    width: zod_1.z.number().default(120),
    height: zod_1.z.number().default(100),
    rotation: zod_1.z.number().default(0),
    points: zod_1.z.array(zod_1.z.number()).optional(),
    closed: zod_1.z.boolean().optional(),
    fill: zod_1.z.string().optional(),
    stroke: zod_1.z.string().optional(),
    strokeWidth: zod_1.z.number().optional(),
    opacity: zod_1.z.number().min(0).max(1).optional(),
    locked: zod_1.z.boolean().optional(),
    visible: zod_1.z.boolean().optional(),
    zIndex: zod_1.z.number().optional(),
    groupId: zod_1.z.string().optional(),
    meta: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
});
exports.shellElementTypeValues = [
    "WALL",
    "ROOM",
    "DOOR",
    "WINDOW",
    "STAIRS",
    "ELEVATOR",
    "BATHROOM",
    "COLUMN",
    "RECEPTION",
    "ENTRANCE",
    "EXIT",
    "FIRE_EXIT",
    "UTILITY",
];
exports.layoutElementTypeValues = [
    "DESK",
    "SEAT",
    "MODE_ZONE",
    "AMENITY",
    "FURNITURE",
    "SIGNAGE",
    "POWER",
    "ACCESS_READER",
    "CAMERA",
    "FIRE_EXTINGUISHER",
    "TRASH",
    "PLANT",
];
exports.SHELL_ELEMENT_TYPES = exports.shellElementTypeValues;
exports.LAYOUT_ELEMENT_TYPES = exports.layoutElementTypeValues;
function isShellType(type) {
    return exports.shellElementTypeValues.includes(type);
}
function isLayoutType(type) {
    return exports.layoutElementTypeValues.includes(type);
}
exports.floorBackgroundSchema = zod_1.z.object({
    storagePath: zod_1.z.string().optional(),
    downloadUrl: zod_1.z.string().optional(),
    opacity: zod_1.z.number().min(0).max(1).default(1),
    scale: zod_1.z.number().default(1),
    offsetX: zod_1.z.number().default(0),
    offsetY: zod_1.z.number().default(0),
    locked: zod_1.z.boolean().default(true),
});
exports.locationDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    slug: zod_1.z.string(),
    address: zod_1.z.string().optional(),
    timezone: zod_1.z.string().optional(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.floorDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    locationId: zod_1.z.string(),
    name: zod_1.z.string(),
    levelIndex: zod_1.z.number(),
    canvasWidth: zod_1.z.number(),
    canvasHeight: zod_1.z.number(),
    background: exports.floorBackgroundSchema.optional(),
});
exports.shellDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    floorId: zod_1.z.string(),
    updatedAt: zod_1.z.number(),
    updatedBy: zod_1.z.string().optional(),
    elements: zod_1.z.array(exports.floorplanElementSchema),
});
exports.layoutVariantSchema = zod_1.z.object({
    id: zod_1.z.string(),
    floorId: zod_1.z.string(),
    name: zod_1.z.string(),
    status: zod_1.z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
    updatedAt: zod_1.z.number(),
    updatedBy: zod_1.z.string().optional(),
    effectiveRules: zod_1.z
        .object({
        daysOfWeek: zod_1.z.array(zod_1.z.number().int().min(0).max(6)).optional(),
        startTime: zod_1.z.string().optional(),
        endTime: zod_1.z.string().optional(),
        precedence: zod_1.z.enum(["OVERRIDE", "SCHEDULED", "DEFAULT"]).default("SCHEDULED"),
        priority: zod_1.z.number().int().default(0),
        oneOffOverrideWindows: zod_1.z
            .array(zod_1.z.object({
            id: zod_1.z.string().optional(),
            start: zod_1.z.number(),
            end: zod_1.z.number(),
            priority: zod_1.z.number().int().optional(),
        }))
            .default([]),
    })
        .optional(),
    elements: zod_1.z.array(exports.floorplanElementSchema),
});
/** @deprecated Use floorDocSchema + shellDocSchema + layoutVariantSchema instead. */
exports.floorplanSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    levelIndex: zod_1.z.number(),
    canvasWidth: zod_1.z.number(),
    canvasHeight: zod_1.z.number(),
    backgroundImageDataUrl: zod_1.z.string().optional(),
    elements: zod_1.z.array(exports.floorplanElementSchema)
});
exports.resourceTypeSchema = zod_1.z.enum(["MODE", "SEAT"]);
exports.resourceSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    type: exports.resourceTypeSchema,
    exclusiveGroupId: zod_1.z.string(),
    capacity: zod_1.z.number().int().nonnegative(),
    /** Guest (non-member) hourly rate in dollars */
    guestRateHourly: zod_1.z.number().nonnegative(),
});
exports.bookingStatusSchema = zod_1.z.enum(["CONFIRMED", "PENDING", "CANCELLED", "COMPLETED"]);
exports.bookingSchema = zod_1.z.object({
    id: zod_1.z.string(),
    locationId: zod_1.z.string().optional(),
    resourceId: zod_1.z.string(),
    resourceName: zod_1.z.string(),
    userId: zod_1.z.string(),
    userName: zod_1.z.string(),
    start: zod_1.z.number(), // Timestamp
    end: zod_1.z.number(), // Timestamp
    status: exports.bookingStatusSchema,
    totalPrice: zod_1.z.number(),
    paymentMethod: zod_1.z.enum(["STRIPE", "CREDITS"]),
    createdAt: zod_1.z.number()
});
// --- User Roles & Entitlements (PR-02) ---
exports.userRoleSchema = zod_1.z.enum([
    "master",
    "admin",
    "staff",
    "member",
    "externalVendor",
    "econPartner",
]);
exports.membershipStatusSchema = zod_1.z.enum([
    "none",
    "trial",
    "active",
    "pastDue",
    "cancelled",
    "expired",
]);
exports.membershipTrackSchema = zod_1.z.enum([
    "remote_worker",
    "capital_ready_founder",
    "consultant",
    "service_provider",
]);
exports.userDocSchema = zod_1.z.object({
    uid: zod_1.z.string(),
    email: zod_1.z.string().email(),
    displayName: zod_1.z.string().optional(),
    // Role (mirrored from custom claims for convenience; claims are authoritative)
    role: exports.userRoleSchema,
    // Entitlements (Firestore-only — never stored in claims)
    membershipStatus: exports.membershipStatusSchema,
    plan: zod_1.z.string().optional(), // e.g. "dayPass", "dedicated", "team"
    expiresAt: zod_1.z.number().optional(), // Timestamp
    features: zod_1.z.record(zod_1.z.string(), zod_1.z.boolean()).optional(), // Feature flags
    // Membership track (PR-08: personalization)
    membershipTrack: exports.membershipTrackSchema.optional(),
    // Credits & Monetization
    credits: zod_1.z.number().default(0),
    lifetimeCreditsPurchased: zod_1.z.number().default(0),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
// --- Organizations (PR-03) ---
exports.orgDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    slug: zod_1.z.string(),
    ownerUid: zod_1.z.string(),
    logoUrl: zod_1.z.string().optional(),
    website: zod_1.z.string().url().optional(),
    address: zod_1.z.string().optional(),
    seatsPurchased: zod_1.z.number().int().nonnegative().default(0),
    seatsUsed: zod_1.z.number().int().nonnegative().default(0),
    billingEmail: zod_1.z.string().email().optional(),
    status: zod_1.z.enum(["active", "suspended", "cancelled"]).default("active"),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.orgMemberDocSchema = zod_1.z.object({
    id: zod_1.z.string(), // composite: `${orgId}_${uid}`
    orgId: zod_1.z.string(),
    uid: zod_1.z.string(),
    role: zod_1.z.enum(["owner", "admin", "member"]),
    joinedAt: zod_1.z.number(),
});
// --- Profiles (PR-03) ---
exports.profileDocSchema = zod_1.z.object({
    uid: zod_1.z.string(),
    businessName: zod_1.z.string().optional(),
    bio: zod_1.z.string().optional(),
    naicsCodes: zod_1.z.array(zod_1.z.string()).optional(),
    certifications: zod_1.z.array(zod_1.z.string()).optional(), // e.g. ["8(a)", "WOSB", "HUBZone"]
    uei: zod_1.z.string().optional(), // Unique Entity Identifier
    duns: zod_1.z.string().optional(),
    cageCode: zod_1.z.string().optional(),
    capabilityStatementUrl: zod_1.z.string().optional(),
    photoUrl: zod_1.z.string().optional(),
    website: zod_1.z.string().url().optional(),
    linkedin: zod_1.z.string().url().optional(),
    profileCompletenessScore: zod_1.z.number().min(0).max(100).optional(),
    // Trust & Badges
    badges: zod_1.z.array(zod_1.z.string()).default([]), // e.g. "procurement_ready", "reliable_payee", "verified_business"
    trustStats: zod_1.z.object({
        referralsConverted: zod_1.z.number().default(0),
        payoutsPlatformManaged: zod_1.z.number().default(0),
        payoutsOnTimeRate: zod_1.z.number().optional(), // 0-100
        medianResponseTimeHours: zod_1.z.number().optional(),
        disputesOpened: zod_1.z.number().default(0),
        disputesLost: zod_1.z.number().default(0),
    }).optional(),
    // Verification & Enrichment
    verificationStatus: zod_1.z.enum(["none", "pending", "verified", "rejected"]).default("none"),
    verificationSubmittedAt: zod_1.z.number().optional(),
    verificationReviewedAt: zod_1.z.number().optional(),
    verificationReviewedBy: zod_1.z.string().optional(),
    verificationRejectionReason: zod_1.z.string().optional(),
    enrichmentSource: zod_1.z.enum(["sam_gov", "usaspending", "manual"]).optional(),
    enrichmentMatchId: zod_1.z.string().optional(),
    enrichmentData: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
    enrichmentLinkedAt: zod_1.z.number().optional(),
    attestationText: zod_1.z.string().optional(),
    attestationTimestamp: zod_1.z.number().optional(),
    attestationAcknowledgedConsequences: zod_1.z.boolean().optional(),
    // Profile readiness + video
    readinessTier: zod_1.z.enum(["seat_ready", "bid_ready", "procurement_ready"]).optional(),
    videoIntroUrl: zod_1.z.string().optional(),
    videoIntroPosterUrl: zod_1.z.string().optional(),
    videoIntroDurationSec: zod_1.z.number().optional(),
    videoIntroStatus: zod_1.z.enum(["processing", "ready", "failed"]).optional(),
    published: zod_1.z.boolean().default(false),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.profileReadinessTierSchema = zod_1.z.enum(["seat_ready", "bid_ready", "procurement_ready"]);
/**
 * Readiness progression:
 * - seat_ready: baseline profile stage
 * - bid_ready: verification complete + capability statement present
 * - procurement_ready: bid_ready + enrichment linked + completeness >= 70 + trust stats present
 */
function computeReadinessTier(profile) {
    if (!profile)
        return "seat_ready";
    const isVerified = profile.verificationStatus === "verified";
    const hasCapabilityStatement = Boolean(profile.capabilityStatementUrl);
    const isBidReady = isVerified && hasCapabilityStatement;
    if (!isBidReady)
        return "seat_ready";
    const hasEnrichment = Boolean(profile.enrichmentMatchId);
    const completeness = profile.profileCompletenessScore ?? 0;
    const hasTrustStats = Boolean(profile.trustStats);
    return hasEnrichment && completeness >= 70 && hasTrustStats
        ? "procurement_ready"
        : "bid_ready";
}
// --- Territories & Verification ---
exports.territoryStatusSchema = zod_1.z.enum(["scheduled", "released", "paused", "archived"]);
exports.territoryDocSchema = zod_1.z.object({
    fips: zod_1.z.string(),
    name: zod_1.z.string(),
    state: zod_1.z.string(),
    status: exports.territoryStatusSchema,
    releaseDate: zod_1.z.number().optional(),
    pausedAt: zod_1.z.number().optional(),
    notes: zod_1.z.string().optional(),
    boundaryGeoJSON: zod_1.z.any().optional(),
    centroid: zod_1.z
        .object({
        lat: zod_1.z.number(),
        lng: zod_1.z.number(),
    })
        .optional(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.verificationDocTypeSchema = zod_1.z.enum([
    "business_license",
    "ein_letter",
    "utility_bill",
    "government_id",
    "other",
]);
exports.verificationDocumentStatusSchema = zod_1.z.enum(["pending", "approved", "rejected"]);
exports.verificationDocumentSchema = zod_1.z.object({
    id: zod_1.z.string(),
    uid: zod_1.z.string(),
    type: exports.verificationDocTypeSchema,
    label: zod_1.z.string(),
    storagePath: zod_1.z.string(),
    downloadUrl: zod_1.z.string().optional(),
    status: exports.verificationDocumentStatusSchema.default("pending"),
    reviewNote: zod_1.z.string().optional(),
    uploadedAt: zod_1.z.number(),
    reviewedAt: zod_1.z.number().optional(),
    reviewedBy: zod_1.z.string().optional(),
});
exports.verificationAuditActionSchema = zod_1.z.enum([
    "enrichment_linked",
    "attestation_signed",
    "doc_uploaded",
    "doc_approved",
    "doc_rejected",
    "status_changed",
    "flag_suspicious",
]);
exports.verificationAuditEntrySchema = zod_1.z.object({
    id: zod_1.z.string(),
    uid: zod_1.z.string(),
    action: exports.verificationAuditActionSchema,
    performedBy: zod_1.z.string(),
    details: zod_1.z.string().optional(),
    previousValue: zod_1.z.string().optional(),
    newValue: zod_1.z.string().optional(),
    createdAt: zod_1.z.number(),
});
/**
 * Centralized transact gate:
 * - territory must be released
 * - company/profile must be verified
 * - role must be permitted
 * Admin/master can bypass by default.
 */
function canTransact(input) {
    const reasons = [];
    const allowAdminBypass = input.allowAdminBypass ?? true;
    const role = input.userRole;
    if (allowAdminBypass && (role === "admin" || role === "master")) {
        return { allowed: true, reasons: [] };
    }
    if (input.territoryStatus !== "released") {
        reasons.push("territory_not_released");
    }
    if (input.verificationStatus !== "verified") {
        reasons.push("company_not_verified");
    }
    const permittedRoles = input.permittedRoles ?? ["member", "externalVendor", "econPartner"];
    if (!role || !permittedRoles.includes(role)) {
        reasons.push("role_not_permitted");
    }
    return { allowed: reasons.length === 0, reasons };
}
// --- RFx (PR-06) ---
exports.rfxStatusSchema = zod_1.z.enum(["draft", "under_review", "open", "closed", "awarded", "cancelled"]);
exports.rfxAdminApprovalSchema = zod_1.z.enum(["pending", "approved", "rejected"]);
/** Direction for scoring: lower-is-better (price/timeline) vs higher-is-better (experience) */
exports.scoringDirectionSchema = zod_1.z.enum(["lower_is_better", "higher_is_better"]);
exports.evaluationCriterionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    label: zod_1.z.string(), // e.g. "Price", "Experience", "Skills"
    weight: zod_1.z.number().min(0).max(100), // Percentage weight
    direction: exports.scoringDirectionSchema, // How to score this criterion
    description: zod_1.z.string().optional(), // Guidance for vendors
});
/** Document that the issuer requests vendors to upload */
exports.requestedDocumentSchema = zod_1.z.object({
    id: zod_1.z.string(),
    label: zod_1.z.string(), // e.g. "Proof of Insurance", "Past Performance Report"
    required: zod_1.z.boolean().default(false),
    description: zod_1.z.string().optional(), // Instructions for the vendor
});
exports.rfxDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(),
    description: zod_1.z.string(),
    naicsCodes: zod_1.z.array(zod_1.z.string()).optional(),
    location: zod_1.z.string().optional(),
    geo: zod_1.z
        .object({
        lat: zod_1.z.number(),
        lng: zod_1.z.number(),
        geohash: zod_1.z.string(),
    })
        .optional(),
    territoryFips: zod_1.z.string().optional(),
    dueDate: zod_1.z.number().optional(), // Timestamp
    budget: zod_1.z.string().optional(), // Display string (e.g. "$10k–$50k")
    memberOnly: zod_1.z.boolean().default(false),
    status: exports.rfxStatusSchema,
    createdBy: zod_1.z.string(), // uid
    createdByName: zod_1.z.string().optional(), // Denormalized display name
    template: zod_1.z.string().optional(), // Template ID used
    evaluationCriteria: zod_1.z.array(exports.evaluationCriterionSchema).default([]),
    requestedDocuments: zod_1.z.array(exports.requestedDocumentSchema).default([]),
    adminApprovalStatus: exports.rfxAdminApprovalSchema.default("pending"),
    adminReviewNote: zod_1.z.string().optional(),
    responseCount: zod_1.z.number().default(0),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.rfxResponseStatusSchema = zod_1.z.enum(["pending", "accepted", "declined"]);
/** A single uploaded document matching a requestedDocument */
exports.uploadedDocumentSchema = zod_1.z.object({
    requestedDocId: zod_1.z.string(), // Links to requestedDocument.id
    label: zod_1.z.string(),
    url: zod_1.z.string(), // Firebase Storage download URL
    fileName: zod_1.z.string(),
});
exports.rfxResponseDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    rfxId: zod_1.z.string(),
    rfxOwnerUid: zod_1.z.string(),
    respondentUid: zod_1.z.string(),
    respondentName: zod_1.z.string().optional(),
    respondentBusinessName: zod_1.z.string().optional(), // From ProfileDoc
    // Structured bid fields
    bidAmount: zod_1.z.number().nonnegative().optional(),
    experience: zod_1.z.number().nonnegative().optional(), // Years of relevant experience
    timeline: zod_1.z.number().nonnegative().optional(), // Delivery timeline in weeks
    skills: zod_1.z.string().optional(), // Relevant skills description
    pastPerformance: zod_1.z.string().optional(), // Past performance summary
    credentials: zod_1.z.array(zod_1.z.string()).optional(), // Certifications/credentials
    references: zod_1.z.string().optional(), // References description
    proposalText: zod_1.z.string().optional(), // Free-form approach description
    proposalUrl: zod_1.z.string().optional(), // Main proposal file (Storage URL)
    uploadedDocuments: zod_1.z.array(exports.uploadedDocumentSchema).default([]),
    // Scoring (computed by evaluation)
    criteriaScores: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional(),
    totalScore: zod_1.z.number().optional(),
    status: exports.rfxResponseStatusSchema.default("pending"),
    submittedAt: zod_1.z.number(),
});
exports.RFX_TEMPLATES = [
    {
        id: "standard-goods",
        name: "Standard Goods & Services",
        description: "General procurement of goods or professional services",
        category: "General",
        defaultTitle: "Request for Proposal — Goods & Services",
        defaultDescription: "We are seeking qualified vendors to provide goods and/or professional services. Please review the requirements below and submit your proposal.",
        defaultCriteria: [
            { id: "price", label: "Price", weight: 30, direction: "lower_is_better", description: "Proposed cost for the scope of work" },
            { id: "experience", label: "Experience / Past Performance", weight: 25, direction: "higher_is_better", description: "Years and depth of relevant experience" },
            { id: "skills", label: "Skills & Technical Approach", weight: 20, direction: "higher_is_better", description: "Relevant skills and proposed methodology" },
            { id: "credentials", label: "Credentials / Certifications", weight: 15, direction: "higher_is_better", description: "Relevant certifications and qualifications" },
            { id: "references", label: "References", weight: 10, direction: "higher_is_better", description: "Quality and relevance of references" },
        ],
        defaultDocuments: [
            { id: "capability-stmt", label: "Capability Statement", required: true, description: "Company capability statement (PDF)" },
        ],
        suggestedNaics: [],
    },
    {
        id: "software-it",
        name: "Software & IT Services",
        description: "Software development, IT consulting, or technology solutions",
        category: "Technology",
        defaultTitle: "Request for Proposal — Software & IT Services",
        defaultDescription: "We are seeking qualified technology vendors or consultants. Please describe your technical approach, relevant experience, and team qualifications.",
        defaultCriteria: [
            { id: "skills", label: "Technical Skills & Approach", weight: 30, direction: "higher_is_better", description: "Technical expertise and proposed solution architecture" },
            { id: "experience", label: "Experience / Past Performance", weight: 25, direction: "higher_is_better", description: "Track record with similar projects" },
            { id: "price", label: "Price", weight: 20, direction: "lower_is_better", description: "Proposed cost and pricing structure" },
            { id: "timeline", label: "Timeline", weight: 15, direction: "lower_is_better", description: "Estimated delivery timeline in weeks" },
            { id: "references", label: "References", weight: 10, direction: "higher_is_better", description: "Client references for similar work" },
        ],
        defaultDocuments: [
            { id: "capability-stmt", label: "Capability Statement", required: true, description: "Company capability statement (PDF)" },
            { id: "portfolio", label: "Portfolio / Case Studies", required: false, description: "Examples of similar completed projects" },
        ],
        suggestedNaics: ["541511", "541512", "541519"],
    },
    {
        id: "construction",
        name: "Construction & Facilities",
        description: "Construction, renovation, or facilities management",
        category: "Construction",
        defaultTitle: "Request for Proposal — Construction Services",
        defaultDescription: "We are seeking licensed contractors for construction or renovation work. Bidders must provide proof of insurance and relevant licenses.",
        defaultCriteria: [
            { id: "price", label: "Price", weight: 30, direction: "lower_is_better", description: "Total bid amount" },
            { id: "experience", label: "Experience / Past Performance", weight: 25, direction: "higher_is_better", description: "Years of experience and similar project history" },
            { id: "timeline", label: "Timeline", weight: 20, direction: "lower_is_better", description: "Project completion timeline in weeks" },
            { id: "credentials", label: "Licenses & Certifications", weight: 15, direction: "higher_is_better", description: "Relevant contractor licenses and safety certifications" },
            { id: "references", label: "References", weight: 10, direction: "higher_is_better", description: "Client references from similar projects" },
        ],
        defaultDocuments: [
            { id: "insurance", label: "Proof of Insurance", required: true, description: "Certificate of insurance (COI)" },
            { id: "license", label: "Contractor License", required: true, description: "Valid contractor license" },
            { id: "capability-stmt", label: "Capability Statement", required: false, description: "Company capability statement" },
        ],
        suggestedNaics: ["236220", "236210", "238990"],
    },
    {
        id: "consulting",
        name: "Consulting & Professional Services",
        description: "Strategy, management, financial, or specialized consulting",
        category: "Consulting",
        defaultTitle: "Request for Proposal — Consulting Services",
        defaultDescription: "We are seeking experienced consultants to provide advisory or professional services. Emphasis is on expertise, methodology, and proven results.",
        defaultCriteria: [
            { id: "experience", label: "Experience / Past Performance", weight: 30, direction: "higher_is_better", description: "Depth and relevance of consulting experience" },
            { id: "skills", label: "Methodology & Approach", weight: 25, direction: "higher_is_better", description: "Proposed methodology and analytical approach" },
            { id: "credentials", label: "Credentials / Certifications", weight: 20, direction: "higher_is_better", description: "Professional certifications and qualifications" },
            { id: "price", label: "Price", weight: 15, direction: "lower_is_better", description: "Proposed fee structure" },
            { id: "references", label: "References", weight: 10, direction: "higher_is_better", description: "Client references and testimonials" },
        ],
        defaultDocuments: [
            { id: "capability-stmt", label: "Capability Statement", required: true, description: "Company capability statement (PDF)" },
            { id: "methodology", label: "Methodology Document", required: false, description: "Detailed description of your approach" },
        ],
        suggestedNaics: ["541611", "541612", "541618"],
    },
];
// --- RFx Scoring Utility ---
/**
 * Compute the score for a single criterion given a set of response values.
 * For "lower_is_better": score = (max - value) / (max - min) * 100
 * For "higher_is_better": score = (value - min) / (max - min) * 100
 * If all values are equal, score = 100 for everyone.
 */
function computeCriterionScore(value, allValues, direction) {
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    if (max === min)
        return 100;
    if (direction === "lower_is_better") {
        return ((max - value) / (max - min)) * 100;
    }
    return ((value - min) / (max - min)) * 100;
}
/**
 * Compute weighted total score for a response given criteria and all responses' numeric values.
 * Returns { criteriaScores, totalScore }.
 */
function computeRfxScores(responseValues, allResponsesValues, criteria) {
    const criteriaScores = {};
    let totalScore = 0;
    const weightSum = criteria.reduce((s, c) => s + c.weight, 0) || 1;
    for (const criterion of criteria) {
        const val = responseValues[criterion.id];
        if (val == null)
            continue;
        const allVals = allResponsesValues
            .map((r) => r[criterion.id])
            .filter((v) => v != null);
        if (allVals.length === 0)
            continue;
        const score = computeCriterionScore(val, allVals, criterion.direction);
        criteriaScores[criterion.id] = Math.round(score * 10) / 10;
        totalScore += (score * criterion.weight) / weightSum;
    }
    return { criteriaScores, totalScore: Math.round(totalScore * 10) / 10 };
}
// --- Referral Policies & Disputes (Moved up for dependency) ---
exports.referralPolicyTemplateSchema = zod_1.z.enum(["flat_fee", "percentage_first_invoice", "recurring", "tiered"]);
exports.referralPolicyDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    uid: zod_1.z.string(), // Provider uid
    acceptingReferrals: zod_1.z.boolean().default(false),
    template: exports.referralPolicyTemplateSchema,
    terms: zod_1.z.string(), // Detailed text description or JSON string of tiers
    attributionWindowDays: zod_1.z.number().default(90),
    payoutTrigger: zod_1.z.string(), // e.g. "Net 10 after payment"
    customTerms: zod_1.z.string().optional(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.referralDisputeDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    referralId: zod_1.z.string(),
    openerUid: zod_1.z.string(),
    reason: zod_1.z.string(),
    evidenceUrls: zod_1.z.array(zod_1.z.string()).default([]),
    status: zod_1.z.enum(["open", "under_review", "resolved_upheld", "resolved_dismissed"]),
    adminNotes: zod_1.z.string().optional(),
    resolutionAt: zod_1.z.number().optional(),
    createdAt: zod_1.z.number(),
});
// --- Referrals (PR-03) ---
exports.referralStatusSchema = zod_1.z.enum([
    "pending",
    "contacted", // legacy/invite
    "accepted", // business_intro: provider accepted
    "declined", // business_intro: provider declined
    "converted",
    "expired",
    "disputed",
    "paid" // business_intro: payout complete
]);
exports.referralTypeSchema = zod_1.z.enum(["platform_invite", "business_intro"]);
exports.referralDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: exports.referralTypeSchema.default("platform_invite"),
    referrerUid: zod_1.z.string(),
    // Platform Invite (Refer User)
    referredEmail: zod_1.z.string().email().optional(), // Required for platform_invite
    referredName: zod_1.z.string().optional(),
    // Business Intro (Refer Client to Provider)
    providerUid: zod_1.z.string().optional(), // The member receiving the referral
    clientName: zod_1.z.string().optional(),
    clientEmail: zod_1.z.string().email().optional(),
    clientPhone: zod_1.z.string().optional(),
    clientCompany: zod_1.z.string().optional(),
    // Policy snapshot at time of referral (to lock in terms)
    policySnapshot: zod_1.z.object({
        template: exports.referralPolicyTemplateSchema,
        terms: zod_1.z.string(),
        amountCents: zod_1.z.number().optional(), // Fixed fee or calculated placeholder
        percentage: zod_1.z.number().optional(), // For percentage based
        currency: zod_1.z.string().default("USD"),
        attributionWindowDays: zod_1.z.number().default(90),
        payoutTrigger: zod_1.z.string().optional(),
    }).optional(),
    status: exports.referralStatusSchema,
    note: zod_1.z.string().optional(), // Note from referrer to provider/invitee
    // Lifecycle
    viewedByProvider: zod_1.z.boolean().default(false),
    acceptedAt: zod_1.z.number().optional(),
    convertedAt: zod_1.z.number().optional(),
    paidAt: zod_1.z.number().optional(),
    // Payout Details
    payoutMethod: zod_1.z.enum(["manual", "platform"]).optional(),
    payoutProofUrl: zod_1.z.string().optional(), // For manual payouts
    payoutPaymentId: zod_1.z.string().optional(), // For platform payouts (linked PaymentDoc)
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
// --- Events (PR-03) ---
exports.eventStatusSchema = zod_1.z.enum(["draft", "published", "cancelled", "completed"]);
exports.eventFormatSchema = zod_1.z.enum(["in-person", "virtual", "hybrid"]);
exports.eventTicketTypeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    priceCents: zod_1.z.number().nonnegative(),
    quantity: zod_1.z.number().optional(), // Total available
    soldCount: zod_1.z.number().default(0),
    description: zod_1.z.string().optional(),
    targetAudience: zod_1.z.enum(["public", "member", "vip"]).default("public"),
});
exports.eventSponsorshipTierSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(), // e.g. "Bronze", "Silver", "Gold"
    priceCents: zod_1.z.number().nonnegative(),
    slots: zod_1.z.number(), // max sponsors
    soldCount: zod_1.z.number().default(0),
    benefits: zod_1.z.array(zod_1.z.string()),
});
exports.eventMediaImageSchema = zod_1.z.object({
    storagePath: zod_1.z.string(),
    downloadUrl: zod_1.z.string().optional(),
    alt: zod_1.z.string(),
    width: zod_1.z.number().int().positive().optional(),
    height: zod_1.z.number().int().positive().optional(),
});
exports.eventPromoVideoSchema = zod_1.z.object({
    type: zod_1.z.enum(["upload", "youtube", "vimeo"]),
    url: zod_1.z.string().optional(),
    storagePath: zod_1.z.string().optional(),
    thumbnail: exports.eventMediaImageSchema.optional(),
});
exports.eventSpeakerCardSchema = zod_1.z.object({
    name: zod_1.z.string(),
    title: zod_1.z.string().optional(),
    headshotImage: exports.eventMediaImageSchema.optional(),
    socials: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional(),
});
exports.eventAudienceRulesSchema = zod_1.z.object({
    membershipTiers: zod_1.z.array(zod_1.z.string()).default([]),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    interests: zod_1.z.array(zod_1.z.string()).default([]),
    proximityRadiusMiles: zod_1.z.number().nonnegative().optional(),
});
exports.eventCampaignSummarySchema = zod_1.z.object({
    status: zod_1.z.enum(["draft", "scheduled", "active", "paused", "completed"]).default("draft"),
    schedule: zod_1.z.object({
        announceAt: zod_1.z.number().optional(),
        reminderAt7d: zod_1.z.number().optional(),
        reminderAt1d: zod_1.z.number().optional(),
        reminderAt1h: zod_1.z.number().optional(),
        followUpAt: zod_1.z.number().optional(),
    }).optional(),
    channels: zod_1.z.array(zod_1.z.enum(["email", "sms", "push", "in_app", "social"])).default([]),
    copyVariants: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
    utmBase: zod_1.z.object({
        source: zod_1.z.string().optional(),
        medium: zod_1.z.string().optional(),
        campaign: zod_1.z.string().optional(),
        content: zod_1.z.string().optional(),
    }).optional(),
});
exports.eventSeriesDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(),
    description: zod_1.z.string(),
    format: exports.eventFormatSchema,
    status: exports.eventStatusSchema,
    timezone: zod_1.z.string().default("America/New_York"),
    rrule: zod_1.z.string().optional(),
    startTimeOfDay: zod_1.z.string().optional(), // HH:mm (24h)
    durationMins: zod_1.z.number().int().positive().optional(),
    seriesStartDate: zod_1.z.number().optional(),
    seriesEndDate: zod_1.z.number().optional(),
    exceptions: zod_1.z.array(zod_1.z.number()).default([]),
    overrides: zod_1.z.record(zod_1.z.string(), zod_1.z.record(zod_1.z.string(), zod_1.z.any())).default({}),
    location: zod_1.z.string().optional(),
    virtualUrl: zod_1.z.string().url().optional(),
    seatCap: zod_1.z.number().int().nonnegative().optional(),
    price: zod_1.z.number().nonnegative().default(0),
    currency: zod_1.z.string().default("USD"),
    linkedRfxId: zod_1.z.string().optional(),
    recordingUrl: zod_1.z.string().url().optional(),
    ticketTypes: zod_1.z.array(exports.eventTicketTypeSchema).default([]),
    sponsorships: zod_1.z.array(exports.eventSponsorshipTierSchema).default([]),
    allowVendorTables: zod_1.z.boolean().default(false),
    vendorTablePriceCents: zod_1.z.number().optional(),
    upsellProducts: zod_1.z.array(zod_1.z.string()).default([]),
    heroImage: exports.eventMediaImageSchema.optional(),
    gallery: zod_1.z.array(exports.eventMediaImageSchema).default([]),
    promoVideo: exports.eventPromoVideoSchema.optional(),
    speakerCards: zod_1.z.array(exports.eventSpeakerCardSchema).default([]),
    sponsorLogos: zod_1.z.array(exports.eventMediaImageSchema).default([]),
    topics: zod_1.z.array(zod_1.z.string()).default([]),
    audienceRules: exports.eventAudienceRulesSchema.optional(),
    campaign: exports.eventCampaignSummarySchema.optional(),
    createdBy: zod_1.z.string(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.eventDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    seriesId: zod_1.z.string().optional(),
    occurrenceDate: zod_1.z.number().optional(),
    isOverride: zod_1.z.boolean().default(false),
    occurrenceStartTime: zod_1.z.number().optional(),
    occurrenceEndTime: zod_1.z.number().optional(),
    title: zod_1.z.string(),
    description: zod_1.z.string(),
    format: exports.eventFormatSchema,
    location: zod_1.z.string().optional(),
    virtualUrl: zod_1.z.string().url().optional(),
    startTime: zod_1.z.number(), // Timestamp
    endTime: zod_1.z.number(), // Timestamp
    seatCap: zod_1.z.number().int().nonnegative().optional(),
    registrationCount: zod_1.z.number().default(0),
    price: zod_1.z.number().nonnegative().default(0), // 0 = free
    currency: zod_1.z.string().default("USD"),
    imageUrl: zod_1.z.string().optional(),
    heroImage: exports.eventMediaImageSchema.optional(),
    gallery: zod_1.z.array(exports.eventMediaImageSchema).default([]),
    promoVideo: exports.eventPromoVideoSchema.optional(),
    speakerCards: zod_1.z.array(exports.eventSpeakerCardSchema).default([]),
    sponsorLogos: zod_1.z.array(exports.eventMediaImageSchema).default([]),
    linkedRfxId: zod_1.z.string().optional(), // Link to RFx
    recordingUrl: zod_1.z.string().url().optional(), // Post-event recording archive (PR-15)
    topics: zod_1.z.array(zod_1.z.string()).default([]),
    audienceRules: exports.eventAudienceRulesSchema.optional(),
    campaign: exports.eventCampaignSummarySchema.optional(),
    status: exports.eventStatusSchema,
    // Monetization
    ticketTypes: zod_1.z.array(exports.eventTicketTypeSchema).default([]),
    sponsorships: zod_1.z.array(exports.eventSponsorshipTierSchema).default([]),
    allowVendorTables: zod_1.z.boolean().default(false),
    vendorTablePriceCents: zod_1.z.number().optional(),
    upsellProducts: zod_1.z.array(zod_1.z.string()).default([]), // IDs of ProductDocs (coffee, kits)
    createdBy: zod_1.z.string(), // uid (admin)
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.eventRegistrationDocSchema = zod_1.z.object({
    uid: zod_1.z.string(),
    eventId: zod_1.z.string(),
    displayName: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    registeredAt: zod_1.z.number(),
    paymentId: zod_1.z.string().optional(), // Linked payment if paid event
    ticketTypeId: zod_1.z.string().optional(),
    quantity: zod_1.z.number().int().positive().default(1),
    amountPaidCents: zod_1.z.number().int().nonnegative().optional(),
    status: zod_1.z.enum(["active", "cancelled", "refunded"]).default("active"),
    registrationSource: zod_1.z.object({
        utmSource: zod_1.z.string().optional(),
        utmMedium: zod_1.z.string().optional(),
        utmCampaign: zod_1.z.string().optional(),
        utmContent: zod_1.z.string().optional(),
    }).optional(),
    checkedInAt: zod_1.z.number().optional(),
    checkInToken: zod_1.z.string().optional(),
    waitlistPromotedAt: zod_1.z.number().optional(),
});
exports.eventWaitlistEntryDocSchema = zod_1.z.object({
    uid: zod_1.z.string(),
    eventId: zod_1.z.string(),
    displayName: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    joinedAt: zod_1.z.number(),
    status: zod_1.z.enum(["waiting", "notified", "claimed", "expired", "removed"]).default("waiting"),
    notifiedAt: zod_1.z.number().optional(),
    claimExpiresAt: zod_1.z.number().optional(),
    notificationToken: zod_1.z.string().optional(),
});
exports.eventCampaignDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    eventId: zod_1.z.string().optional(),
    seriesId: zod_1.z.string().optional(),
    status: zod_1.z.enum(["draft", "scheduled", "active", "paused", "completed"]).default("draft"),
    channels: zod_1.z.array(zod_1.z.enum(["email", "sms", "push", "in_app", "social"])).default([]),
    audienceRules: exports.eventAudienceRulesSchema.optional(),
    schedule: zod_1.z.object({
        announceAt: zod_1.z.number().optional(),
        reminderOffsetsHours: zod_1.z.array(zod_1.z.number()).default([]),
        followUpAt: zod_1.z.number().optional(),
    }).optional(),
    copyVariants: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
    utmBase: zod_1.z.object({
        source: zod_1.z.string().optional(),
        medium: zod_1.z.string().optional(),
        campaign: zod_1.z.string().optional(),
        content: zod_1.z.string().optional(),
    }).optional(),
    stats: zod_1.z.object({
        impressions: zod_1.z.number().int().nonnegative().default(0),
        clicks: zod_1.z.number().int().nonnegative().default(0),
        registrations: zod_1.z.number().int().nonnegative().default(0),
        conversionRate: zod_1.z.number().nonnegative().default(0),
    }).default({ impressions: 0, clicks: 0, registrations: 0, conversionRate: 0 }),
    createdBy: zod_1.z.string(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.campaignJobDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    campaignId: zod_1.z.string(),
    type: zod_1.z.enum(["announce", "reminder", "starting_soon", "follow_up"]),
    scheduledFor: zod_1.z.number(),
    status: zod_1.z.enum(["pending", "processing", "sent", "failed"]).default("pending"),
    recipientCount: zod_1.z.number().int().nonnegative().default(0),
    createdAt: zod_1.z.number(),
    processedAt: zod_1.z.number().optional(),
    error: zod_1.z.string().optional(),
});
exports.eventShareKitDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    eventId: zod_1.z.string().optional(),
    seriesId: zod_1.z.string().optional(),
    assets: zod_1.z.array(zod_1.z.object({
        variant: zod_1.z.enum(["square", "vertical", "horizontal"]),
        storagePath: zod_1.z.string(),
        downloadUrl: zod_1.z.string().optional(),
    })).default([]),
    captions: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
    trackedLink: zod_1.z.string().optional(),
    status: zod_1.z.enum(["generating", "ready", "approved", "archived"]).default("generating"),
    generatedAt: zod_1.z.number().optional(),
    approvedAt: zod_1.z.number().optional(),
    approvedBy: zod_1.z.string().optional(),
    createdAt: zod_1.z.number(),
});
exports.socialPostDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    eventId: zod_1.z.string().optional(),
    seriesId: zod_1.z.string().optional(),
    channel: zod_1.z.enum(["linkedin", "facebook", "instagram", "x"]),
    scheduledFor: zod_1.z.number(),
    status: zod_1.z.enum(["draft", "approved", "scheduled", "posted", "failed"]).default("draft"),
    assetRef: zod_1.z.string().optional(),
    caption: zod_1.z.string(),
    link: zod_1.z.string().optional(),
    retries: zod_1.z.number().int().nonnegative().default(0),
    postedAt: zod_1.z.number().optional(),
    postUrl: zod_1.z.string().optional(),
    error: zod_1.z.string().optional(),
    createdBy: zod_1.z.string(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
// --- Payments (PR-03) ---
exports.paymentProviderSchema = zod_1.z.enum([
    "stripe",
    "quickbooks_link",
    "quickbooks_invoice",
    "quickbooks_payments",
]);
exports.paymentStatusSchema = zod_1.z.enum(["pending", "paid", "failed", "refunded"]);
exports.paymentPurposeSchema = zod_1.z.enum(["membership", "event", "rfx", "booking", "referral", "bookstore", "other"]);
exports.paymentDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    uid: zod_1.z.string(),
    orgId: zod_1.z.string().optional(),
    provider: exports.paymentProviderSchema,
    amount: zod_1.z.number().nonnegative(),
    currency: zod_1.z.string().default("USD"),
    purpose: exports.paymentPurposeSchema,
    purposeRefId: zod_1.z.string().optional(), // e.g. eventId, bookingId
    status: exports.paymentStatusSchema,
    providerRefs: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional(), // sessionId, invoiceId, etc.
    accountingRefs: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional(), // QBO IDs
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
// --- Webhook Idempotency (PR-03) ---
exports.webhookEventDocSchema = zod_1.z.object({
    eventId: zod_1.z.string(), // Provider event ID (Stripe event ID, etc.)
    provider: zod_1.z.string(),
    processedAt: zod_1.z.number(),
    result: zod_1.z.string().optional(), // "success" | "skipped" | error message
});
// --- Leads (PR-03) ---
exports.leadDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    email: zod_1.z.string().email(),
    interests: zod_1.z.array(zod_1.z.string()).optional(),
    message: zod_1.z.string().optional(),
    intent: zod_1.z.string().optional(), // e.g. "coworking", "event-space", "membership"
    source: zod_1.z.string().optional(), // e.g. "coming-soon-page", "contact-form"
    version: zod_1.z.string().optional(), // Form version identifier
    interestScore: zod_1.z.number().optional(), // Computed engagement score
    createdAt: zod_1.z.number(),
});
// --- Notifications (PR-03) ---
exports.notificationTypeSchema = zod_1.z.enum([
    "rfx_new",
    "rfx_response",
    "referral",
    "event_registration",
    "payment",
    "system",
]);
exports.notificationDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    uid: zod_1.z.string(), // Recipient
    type: exports.notificationTypeSchema,
    title: zod_1.z.string(),
    body: zod_1.z.string(),
    linkTo: zod_1.z.string().optional(), // In-app route
    read: zod_1.z.boolean().default(false),
    createdAt: zod_1.z.number(),
});
// --- Products / Payment Links (PR-11) ---
exports.productVariantSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(), // e.g. "Paperback", "PDF Download", "Merch Bundle"
    priceCents: zod_1.z.number().nonnegative(),
    type: zod_1.z.enum(["physical", "digital", "service"]),
    digitalAssetUrl: zod_1.z.string().optional(),
    inventory: zod_1.z.number().optional(),
});
exports.productDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    amount: zod_1.z.number().nonnegative(), // cents
    currency: zod_1.z.string().default("USD"),
    purpose: exports.paymentPurposeSchema,
    stripePriceId: zod_1.z.string().optional(),
    quickbooksPaymentLinkUrl: zod_1.z.string().url().optional(),
    // Monetization
    variants: zod_1.z.array(exports.productVariantSchema).default([]),
    inventory: zod_1.z.number().optional(),
    active: zod_1.z.boolean().default(true),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
// --- Payment Audit Log (PR-11) ---
exports.paymentAuditActionSchema = zod_1.z.enum([
    "mark_paid",
    "mark_failed",
    "refund",
    "note",
]);
exports.paymentAuditEntrySchema = zod_1.z.object({
    id: zod_1.z.string(),
    paymentId: zod_1.z.string(),
    action: exports.paymentAuditActionSchema,
    performedBy: zod_1.z.string(), // admin uid
    note: zod_1.z.string().optional(),
    previousStatus: exports.paymentStatusSchema.optional(),
    newStatus: exports.paymentStatusSchema.optional(),
    createdAt: zod_1.z.number(),
});
// --- RFx Team Invites (PR-16) ---
exports.rfxTeamInviteStatusSchema = zod_1.z.enum(["pending", "accepted", "declined"]);
exports.rfxTeamInviteDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    rfxId: zod_1.z.string(),
    inviterUid: zod_1.z.string(),
    inviteeUid: zod_1.z.string(),
    inviteeName: zod_1.z.string().optional(),
    role: zod_1.z.string().optional(), // e.g. "sub", "lead", "partner"
    status: exports.rfxTeamInviteStatusSchema,
    note: zod_1.z.string().optional(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.rfxTeamRoleSchema = zod_1.z.enum(["prime", "sub", "estimator", "compliance", "proposal_writer"]);
exports.rfxTeamMemberSchema = zod_1.z.object({
    uid: zod_1.z.string(),
    displayName: zod_1.z.string().optional(),
    businessName: zod_1.z.string().optional(),
    role: exports.rfxTeamRoleSchema,
    joinedAt: zod_1.z.number(),
    scopeDescription: zod_1.z.string().optional(),
});
exports.rfxTeamDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    rfxId: zod_1.z.string(),
    name: zod_1.z.string(),
    primeUid: zod_1.z.string(),
    members: zod_1.z.array(exports.rfxTeamMemberSchema),
    memberUids: zod_1.z.array(zod_1.z.string()).default([]),
    status: zod_1.z.enum(["forming", "active", "submitted", "dissolved"]),
    internalNotes: zod_1.z.string().optional(),
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.teamDocumentSchema = zod_1.z.object({
    id: zod_1.z.string(),
    teamId: zod_1.z.string(),
    uploadedBy: zod_1.z.string(),
    fileName: zod_1.z.string(),
    storagePath: zod_1.z.string(),
    downloadUrl: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    uploadedAt: zod_1.z.number(),
});
// --- Credits & Monetization ---
exports.creditTransactionTypeSchema = zod_1.z.enum([
    "purchase",
    "monthly_allocation",
    "usage",
    "refund",
    "admin_adjustment",
    "expired"
]);
exports.creditTransactionDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    userId: zod_1.z.string(),
    amount: zod_1.z.number(), // Positive for add, negative for deduct
    type: exports.creditTransactionTypeSchema,
    referenceId: zod_1.z.string().optional(), // e.g. rfxId, referralId, paymentId
    description: zod_1.z.string(),
    createdAt: zod_1.z.number(),
});
exports.CREDIT_PACKS = [
    { id: "pack_10", credits: 10, priceCents: 2500 },
    { id: "pack_25", credits: 25, priceCents: 5500 },
    { id: "pack_60", credits: 60, priceCents: 12000 },
];
exports.CREDIT_COSTS = {
    // RFx
    RFX_PUBLISH: 3,
    RFX_PUSH_INVITES_10: 1, // Per 10 invites
    RFX_PRIORITY_INTRO: 2,
    RFX_BID_BOOK_EXPORT: 4,
    RFX_PREMIUM_CONTACT: 2,
    RFX_BOOST_BID: 3,
    RFX_PORTFOLIO_SPOTLIGHT: 5,
    // Referrals
    REFERRAL_SEND_EXTRA: 2,
    REFERRAL_ACCEPT_EXTRA: 1,
    REFERRAL_UNLOCK_POLICY: 1,
    REFERRAL_PRIORITY_INTRO: 2,
    REFERRAL_VERIFICATION_PACKET: 2,
    REFERRAL_OPEN_DISPUTE: 4,
    REFERRAL_BOOST_PROFILE: 5,
    REFERRAL_FEATURED_SLOT: 10,
    // Events & Other
    VERIFIED_BUSINESS_MONTHLY: 5,
};
// --- Platform Fees ---
exports.platformFeeDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    transactionId: zod_1.z.string(), // Link to the main transaction
    relatedEntityId: zod_1.z.string(), // rfxId, referralId
    payerUid: zod_1.z.string(),
    payeeUid: zod_1.z.string().optional(),
    amountCents: zod_1.z.number().nonnegative(),
    type: zod_1.z.enum(["application_fee", "service_fee", "success_fee", "escrow_fee"]),
    status: zod_1.z.enum(["pending", "captured", "refunded"]),
    createdAt: zod_1.z.number(),
});
// --- Pricing & Membership Tiers ---
exports.membershipTierIdSchema = zod_1.z.enum(["virtual", "coworking", "coworking_plus"]);
exports.MEMBERSHIP_TIERS = [
    {
        id: "virtual",
        name: "Virtual Member",
        amountCents: 4900,
        interval: "month",
        currency: "usd",
        stripePriceId: "price_virtual_monthly",
        includedHoursPerMonth: 2,
        extraHourlyRateCents: 1200,
        bookingWindowDays: 14,
        includedCreditsPerMonth: 3,
        limits: {
            rfxActivePosts: 0,
            rfxInvitePushes: 0,
            referralsSentPerMonth: 1,
            referralsReceivedPerMonth: 2,
            referralPolicyUnlocksPerMonth: 3,
            referralActiveOpen: 3
        },
        features: [
            "Member Directory access",
            "AccelProcure / RFx feed access",
            "Business profile + Procurement-Ready badge",
            "Virtual community events",
            "2 desk hours/month included",
            "Extra hours: $12/hr",
            "3 Credits/mo included"
        ],
    },
    {
        id: "coworking",
        name: "Coworking Member",
        amountCents: 12900,
        interval: "month",
        currency: "usd",
        stripePriceId: "price_coworking_monthly",
        includedHoursPerMonth: 15,
        extraHourlyRateCents: 1050,
        bookingWindowDays: 90,
        includedCreditsPerMonth: 10,
        limits: {
            rfxActivePosts: 2,
            rfxInvitePushes: 25,
            referralsSentPerMonth: 5,
            referralsReceivedPerMonth: 5,
            referralPolicyUnlocksPerMonth: 15,
            referralActiveOpen: 15
        },
        features: [
            "Everything in Virtual Member",
            "15 desk hours/month included",
            "Extra hours: $10.50/hr",
            "Book up to 90 days ahead",
            "10 Credits/mo included",
            "Full RFx participation"
        ],
    },
    {
        id: "coworking_plus",
        name: "Coworking Plus",
        amountCents: 19900,
        interval: "month",
        currency: "usd",
        stripePriceId: "price_coworking_plus_monthly",
        includedHoursPerMonth: 30,
        extraHourlyRateCents: 900,
        bookingWindowDays: 90,
        includedCreditsPerMonth: 25,
        limits: {
            rfxActivePosts: 5,
            rfxInvitePushes: 100,
            referralsSentPerMonth: 15,
            referralsReceivedPerMonth: 15,
            referralPolicyUnlocksPerMonth: 50,
            referralActiveOpen: 50
        },
        features: [
            "Everything in Coworking Member",
            "30 desk hours/month included",
            "Extra hours: $9/hr",
            "Highest booking priority",
            "25 Credits/mo included",
            "Priority RFx & Referrals"
        ],
    },
];
// --- Resource Catalog (Canonical) ---
// All bookable resources in the space. The backend mirrors this config.
// Keep in sync with: apps/functions/src/index.ts → RESOURCE_CONFIG
exports.RESOURCE_CATALOG = {
    "seat-1": { id: "seat-1", name: "Seat 1", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
    "seat-2": { id: "seat-2", name: "Seat 2", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
    "seat-3": { id: "seat-3", name: "Seat 3", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
    "seat-4": { id: "seat-4", name: "Seat 4", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
    "seat-5": { id: "seat-5", name: "Seat 5", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
    "seat-6": { id: "seat-6", name: "Seat 6", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
    "mode-conference": { id: "mode-conference", name: "Conference Room", type: "MODE", exclusiveGroupId: "main_space", capacity: 10, guestRateHourly: 75 },
};
function getResourceById(id) {
    return exports.RESOURCE_CATALOG[id];
}
function getResourcesByType(type) {
    return Object.values(exports.RESOURCE_CATALOG).filter((r) => r.type === type);
}
// --- Guest (Public / Walk-In) Rates ---
exports.GUEST_PRICING = {
    /** Per hour per seat, in cents */
    hourlyRateCents: 1750,
    /** Daily cap per seat, in cents */
    dailyCapCents: 11500,
    /** Booking window: max days ahead */
    bookingWindowDays: 14,
};
/** @deprecated Use GUEST_PRICING instead */
exports.NON_MEMBER_PRICING = exports.GUEST_PRICING;
// --- Conference Room ---
exports.CONFERENCE_ROOM_CONFIG = {
    maxCapacity: 10,
    /** Per hour in cents */
    hourlyRateCents: 7500,
};
// --- Space Inventory ---
exports.SPACE_INVENTORY = {
    totalSeats: 6,
};
// --- Bookstore (Virtual Bookstore) ---
exports.bookAvailabilityModeSchema = zod_1.z.enum(["browse_only", "digital", "physical"]);
exports.bookSalesChannelSchema = zod_1.z.enum(["owned", "affiliate"]);
exports.bookDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(),
    author: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    coverImageUrl: zod_1.z.string().optional(),
    // Commerce / fulfillment
    availabilityMode: exports.bookAvailabilityModeSchema,
    salesChannel: exports.bookSalesChannelSchema,
    // Pricing (owned only, in cents)
    priceCents: zod_1.z.number().nonnegative().optional(),
    stripePriceId: zod_1.z.string().optional(),
    // Variants (Monetization)
    variants: zod_1.z.array(exports.productVariantSchema).default([]),
    bundleIds: zod_1.z.array(zod_1.z.string()).default([]), // Linked bundles
    // Affiliate (affiliate only)
    affiliateUrl: zod_1.z.string().optional(),
    affiliateNetwork: zod_1.z.string().optional(), // e.g. "amazon", "bookshop"
    // Digital fulfillment (owned + digital only)
    digitalAssetUrl: zod_1.z.string().optional(), // Firebase Storage path or URL
    // Access policies (all default to false)
    requireLoginToView: zod_1.z.boolean().default(false),
    requireLoginToPurchase: zod_1.z.boolean().default(false),
    requireLoginToAccessContent: zod_1.z.boolean().default(false),
    // Categorization
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    featuredRank: zod_1.z.number().optional(), // lower = more featured
    // Status
    published: zod_1.z.boolean().default(false),
    createdBy: zod_1.z.string(), // admin uid
    createdAt: zod_1.z.number(),
    updatedAt: zod_1.z.number().optional(),
});
exports.bookPurchaseDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    bookId: zod_1.z.string(),
    userId: zod_1.z.string().optional(), // optional for guest purchases
    email: zod_1.z.string().email().optional(),
    stripeSessionId: zod_1.z.string().optional(),
    accessGrantedAt: zod_1.z.number().optional(),
    createdAt: zod_1.z.number(),
});
exports.bookAffiliateClickDocSchema = zod_1.z.object({
    id: zod_1.z.string(),
    bookId: zod_1.z.string(),
    userId: zod_1.z.string().optional(),
    destination: zod_1.z.string(), // affiliate URL domain
    createdAt: zod_1.z.number(),
});
