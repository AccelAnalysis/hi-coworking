import { z } from "zod";

export const doorTypeSchema = z.enum([
  "OPENING",
  "STANDARD",
  "KEY_ENTRY",
  "SCAN_TO_ENTER",
  "PIN_CODE",
  "PUSH_BAR",
  "EMERGENCY_EXIT",
]);

export type DoorType = z.infer<typeof doorTypeSchema>;

export const elementShapeSchema = z.enum(["RECT", "LINE", "POLY", "ICON", "TEXT"]);
export type ElementShape = z.infer<typeof elementShapeSchema>;

export const floorplanElementTypeSchema = z.enum([
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

export type FloorplanElementType = z.infer<typeof floorplanElementTypeSchema>;

export const floorplanElementSchema = z.object({
  id: z.string(),
  type: floorplanElementTypeSchema,
  shape: elementShapeSchema.optional(),
  label: z.string().optional(),
  notes: z.string().optional(),
  resourceId: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().default(120),
  height: z.number().default(100),
  rotation: z.number().default(0),
  points: z.array(z.number()).optional(),
  closed: z.boolean().optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  locked: z.boolean().optional(),
  visible: z.boolean().optional(),
  zIndex: z.number().optional(),
  groupId: z.string().optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export type FloorplanElement = z.infer<typeof floorplanElementSchema>;

export const shellElementTypeValues = [
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
] as const;

export const layoutElementTypeValues = [
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
] as const;

export type ShellElementType = (typeof shellElementTypeValues)[number];
export type LayoutElementType = (typeof layoutElementTypeValues)[number];

export const SHELL_ELEMENT_TYPES: ReadonlyArray<ShellElementType> = shellElementTypeValues;
export const LAYOUT_ELEMENT_TYPES: ReadonlyArray<LayoutElementType> = layoutElementTypeValues;

export function isShellType(type: FloorplanElementType): type is ShellElementType {
  return (shellElementTypeValues as readonly string[]).includes(type);
}

export function isLayoutType(type: FloorplanElementType): type is LayoutElementType {
  return (layoutElementTypeValues as readonly string[]).includes(type);
}

export const floorBackgroundSchema = z.object({
  storagePath: z.string().optional(),
  downloadUrl: z.string().optional(),
  opacity: z.number().min(0).max(1).default(1),
  scale: z.number().default(1),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  locked: z.boolean().default(true),
});

export const locationDocSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  address: z.string().optional(),
  timezone: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type LocationDoc = z.infer<typeof locationDocSchema>;

export const floorDocSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  levelIndex: z.number(),
  canvasWidth: z.number(),
  canvasHeight: z.number(),
  background: floorBackgroundSchema.optional(),
});

export type FloorDoc = z.infer<typeof floorDocSchema>;

export const shellDocSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
  elements: z.array(floorplanElementSchema),
});

export type ShellDoc = z.infer<typeof shellDocSchema>;

export const layoutVariantSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  name: z.string(),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
  effectiveRules: z
    .object({
      daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      precedence: z.enum(["OVERRIDE", "SCHEDULED", "DEFAULT"]).default("SCHEDULED"),
      priority: z.number().int().default(0),
      oneOffOverrideWindows: z
        .array(
          z.object({
            id: z.string().optional(),
            start: z.number(),
            end: z.number(),
            priority: z.number().int().optional(),
          })
        )
        .default([]),
    })
    .optional(),
  elements: z.array(floorplanElementSchema),
});

export type LayoutVariant = z.infer<typeof layoutVariantSchema>;

/** @deprecated Use floorDocSchema + shellDocSchema + layoutVariantSchema instead. */
export const floorplanSchema = z.object({
  id: z.string(),
  name: z.string(),
  levelIndex: z.number(),
  canvasWidth: z.number(),
  canvasHeight: z.number(),
  backgroundImageDataUrl: z.string().optional(),
  elements: z.array(floorplanElementSchema)
});

export type Floorplan = z.infer<typeof floorplanSchema>;

export const resourceTypeSchema = z.enum(["MODE", "SEAT"]);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const resourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: resourceTypeSchema,
  exclusiveGroupId: z.string(),
  capacity: z.number().int().nonnegative(),
  /** Guest (non-member) hourly rate in dollars */
  guestRateHourly: z.number().nonnegative(),
});

export type Resource = z.infer<typeof resourceSchema>;

export const bookingStatusSchema = z.enum(["CONFIRMED", "PENDING", "CANCELLED", "COMPLETED"]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const bookingSchema = z.object({
  id: z.string(),
  locationId: z.string().optional(),
  resourceId: z.string(),
  resourceName: z.string(),
  userId: z.string(),
  userName: z.string(),
  start: z.number(), // Timestamp
  end: z.number(),   // Timestamp
  status: bookingStatusSchema,
  totalPrice: z.number(),
  paymentMethod: z.enum(["STRIPE", "CREDITS"]),
  createdAt: z.number()
});

export type Booking = z.infer<typeof bookingSchema>;

// --- User Roles & Entitlements (PR-02) ---

export const userRoleSchema = z.enum([
  "master",
  "admin",
  "staff",
  "member",
  "externalVendor",
  "econPartner",
]);

export type UserRole = z.infer<typeof userRoleSchema>;

export const membershipStatusSchema = z.enum([
  "none",
  "trial",
  "active",
  "pastDue",
  "cancelled",
  "expired",
]);

export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const membershipTrackSchema = z.enum([
  "remote_worker",
  "capital_ready_founder",
  "consultant",
  "service_provider",
]);

export type MembershipTrack = z.infer<typeof membershipTrackSchema>;

export const userDocSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  displayName: z.string().optional(),

  // Role (mirrored from custom claims for convenience; claims are authoritative)
  role: userRoleSchema,

  // Entitlements (Firestore-only — never stored in claims)
  membershipStatus: membershipStatusSchema,
  plan: z.string().optional(),           // e.g. "dayPass", "dedicated", "team"
  expiresAt: z.number().optional(),      // Timestamp
  features: z.record(z.string(), z.boolean()).optional(), // Feature flags

  // Membership track (PR-08: personalization)
  membershipTrack: membershipTrackSchema.optional(),

  // Credits & Monetization
  credits: z.number().default(0),
  lifetimeCreditsPurchased: z.number().default(0),

  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type UserDoc = z.infer<typeof userDocSchema>;

// --- Organizations (PR-03) ---

export const orgDocSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  ownerUid: z.string(),
  logoUrl: z.string().optional(),
  website: z.string().url().optional(),
  address: z.string().optional(),
  seatsPurchased: z.number().int().nonnegative().default(0),
  seatsUsed: z.number().int().nonnegative().default(0),
  billingEmail: z.string().email().optional(),
  status: z.enum(["active", "suspended", "cancelled"]).default("active"),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type OrgDoc = z.infer<typeof orgDocSchema>;

export const orgMemberDocSchema = z.object({
  id: z.string(),                      // composite: `${orgId}_${uid}`
  orgId: z.string(),
  uid: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  joinedAt: z.number(),
});

export type OrgMemberDoc = z.infer<typeof orgMemberDocSchema>;

// --- Profiles (PR-03) ---

export const profileDocSchema = z.object({
  uid: z.string(),
  businessName: z.string().optional(),
  bio: z.string().optional(),
  naicsCodes: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),   // e.g. ["8(a)", "WOSB", "HUBZone"]
  uei: z.string().optional(),                       // Unique Entity Identifier
  duns: z.string().optional(),
  cageCode: z.string().optional(),
  capabilityStatementUrl: z.string().optional(),
  photoUrl: z.string().optional(),
  website: z.string().url().optional(),
  linkedin: z.string().url().optional(),
  profileCompletenessScore: z.number().min(0).max(100).optional(),
  
  // Trust & Badges
  badges: z.array(z.string()).default([]), // e.g. "procurement_ready", "reliable_payee", "verified_business"
  trustStats: z.object({
    referralsConverted: z.number().default(0),
    payoutsPlatformManaged: z.number().default(0),
    payoutsOnTimeRate: z.number().optional(), // 0-100
    medianResponseTimeHours: z.number().optional(),
    disputesOpened: z.number().default(0),
    disputesLost: z.number().default(0),
  }).optional(),

  // Verification & Enrichment
  verificationStatus: z.enum(["none", "pending", "verified", "rejected"]).default("none"),
  verificationSubmittedAt: z.number().optional(),
  verificationReviewedAt: z.number().optional(),
  verificationReviewedBy: z.string().optional(),
  verificationRejectionReason: z.string().optional(),
  enrichmentSource: z.enum(["sam_gov", "usaspending", "manual"]).optional(),
  enrichmentMatchId: z.string().optional(),
  enrichmentData: z.record(z.string(), z.any()).optional(),
  enrichmentLinkedAt: z.number().optional(),
  attestationText: z.string().optional(),
  attestationTimestamp: z.number().optional(),
  attestationAcknowledgedConsequences: z.boolean().optional(),

  // Profile readiness + video
  readinessTier: z.enum(["seat_ready", "bid_ready", "procurement_ready"]).optional(),
  videoIntroUrl: z.string().optional(),
  videoIntroPosterUrl: z.string().optional(),
  videoIntroDurationSec: z.number().optional(),
  videoIntroStatus: z.enum(["processing", "ready", "failed"]).optional(),

  published: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type ProfileDoc = z.infer<typeof profileDocSchema>;

export const profileReadinessTierSchema = z.enum(["seat_ready", "bid_ready", "procurement_ready"]);
export type ProfileReadinessTier = z.infer<typeof profileReadinessTierSchema>;

/**
 * Readiness progression:
 * - seat_ready: baseline profile stage
 * - bid_ready: verification complete + capability statement present
 * - procurement_ready: bid_ready + enrichment linked + completeness >= 70 + trust stats present
 */
export function computeReadinessTier(
  profile: Partial<ProfileDoc> | null
): ProfileReadinessTier {
  if (!profile) return "seat_ready";

  const isVerified = profile.verificationStatus === "verified";
  const hasCapabilityStatement = Boolean(profile.capabilityStatementUrl);
  const isBidReady = isVerified && hasCapabilityStatement;
  if (!isBidReady) return "seat_ready";

  const hasEnrichment = Boolean(profile.enrichmentMatchId);
  const completeness = profile.profileCompletenessScore ?? 0;
  const hasTrustStats = Boolean(profile.trustStats);
  return hasEnrichment && completeness >= 70 && hasTrustStats
    ? "procurement_ready"
    : "bid_ready";
}

// --- Territories & Verification ---

export const territoryStatusSchema = z.enum(["scheduled", "released", "paused", "archived"]);
export type TerritoryStatus = z.infer<typeof territoryStatusSchema>;

export const territoryDocSchema = z.object({
  fips: z.string(),
  name: z.string(),
  state: z.string(),
  status: territoryStatusSchema,
  releaseDate: z.number().optional(),
  pausedAt: z.number().optional(),
  notes: z.string().optional(),
  boundaryGeoJSON: z.any().optional(),
  centroid: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type TerritoryDoc = z.infer<typeof territoryDocSchema>;

export const verificationDocTypeSchema = z.enum([
  "business_license",
  "ein_letter",
  "utility_bill",
  "government_id",
  "other",
]);
export type VerificationDocType = z.infer<typeof verificationDocTypeSchema>;

export const verificationDocumentStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type VerificationDocumentStatus = z.infer<typeof verificationDocumentStatusSchema>;

export const verificationDocumentSchema = z.object({
  id: z.string(),
  uid: z.string(),
  type: verificationDocTypeSchema,
  label: z.string(),
  storagePath: z.string(),
  downloadUrl: z.string().optional(),
  status: verificationDocumentStatusSchema.default("pending"),
  reviewNote: z.string().optional(),
  uploadedAt: z.number(),
  reviewedAt: z.number().optional(),
  reviewedBy: z.string().optional(),
});
export type VerificationDocument = z.infer<typeof verificationDocumentSchema>;

export const verificationAuditActionSchema = z.enum([
  "enrichment_linked",
  "attestation_signed",
  "doc_uploaded",
  "doc_approved",
  "doc_rejected",
  "status_changed",
  "flag_suspicious",
]);
export type VerificationAuditAction = z.infer<typeof verificationAuditActionSchema>;

export const verificationAuditEntrySchema = z.object({
  id: z.string(),
  uid: z.string(),
  action: verificationAuditActionSchema,
  performedBy: z.string(),
  details: z.string().optional(),
  previousValue: z.string().optional(),
  newValue: z.string().optional(),
  createdAt: z.number(),
});
export type VerificationAuditEntry = z.infer<typeof verificationAuditEntrySchema>;

export interface TransactCheckInput {
  userRole?: UserRole;
  verificationStatus?: ProfileDoc["verificationStatus"];
  territoryStatus?: TerritoryStatus;
  allowAdminBypass?: boolean;
  permittedRoles?: UserRole[];
}

export interface TransactCheckResult {
  allowed: boolean;
  reasons: string[];
}

/**
 * Centralized transact gate:
 * - territory must be released
 * - company/profile must be verified
 * - role must be permitted
 * Admin/master can bypass by default.
 */
export function canTransact(input: TransactCheckInput): TransactCheckResult {
  const reasons: string[] = [];
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

export const rfxStatusSchema = z.enum(["draft", "under_review", "open", "closed", "awarded", "cancelled"]);
export type RfxStatus = z.infer<typeof rfxStatusSchema>;

export const rfxAdminApprovalSchema = z.enum(["pending", "approved", "rejected"]);
export type RfxAdminApproval = z.infer<typeof rfxAdminApprovalSchema>;

/** Direction for scoring: lower-is-better (price/timeline) vs higher-is-better (experience) */
export const scoringDirectionSchema = z.enum(["lower_is_better", "higher_is_better"]);
export type ScoringDirection = z.infer<typeof scoringDirectionSchema>;

export const evaluationCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),                             // e.g. "Price", "Experience", "Skills"
  weight: z.number().min(0).max(100),            // Percentage weight
  direction: scoringDirectionSchema,             // How to score this criterion
  description: z.string().optional(),            // Guidance for vendors
});

export type EvaluationCriterion = z.infer<typeof evaluationCriterionSchema>;

/** Document that the issuer requests vendors to upload */
export const requestedDocumentSchema = z.object({
  id: z.string(),
  label: z.string(),                             // e.g. "Proof of Insurance", "Past Performance Report"
  required: z.boolean().default(false),
  description: z.string().optional(),            // Instructions for the vendor
});

export type RequestedDocument = z.infer<typeof requestedDocumentSchema>;

export const rfxDocSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  naicsCodes: z.array(z.string()).optional(),
  location: z.string().optional(),
  geo: z
    .object({
      lat: z.number(),
      lng: z.number(),
      geohash: z.string(),
    })
    .optional(),
  territoryFips: z.string().optional(),
  dueDate: z.number().optional(),               // Timestamp
  budget: z.string().optional(),                 // Display string (e.g. "$10k–$50k")
  memberOnly: z.boolean().default(false),
  status: rfxStatusSchema,
  createdBy: z.string(),                         // uid
  createdByName: z.string().optional(),          // Denormalized display name
  template: z.string().optional(),               // Template ID used
  evaluationCriteria: z.array(evaluationCriterionSchema).default([]),
  requestedDocuments: z.array(requestedDocumentSchema).default([]),
  adminApprovalStatus: rfxAdminApprovalSchema.default("pending"),
  adminReviewNote: z.string().optional(),
  responseCount: z.number().default(0),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type RfxDoc = z.infer<typeof rfxDocSchema>;

export const rfxResponseStatusSchema = z.enum(["pending", "accepted", "declined"]);
export type RfxResponseStatus = z.infer<typeof rfxResponseStatusSchema>;

/** A single uploaded document matching a requestedDocument */
export const uploadedDocumentSchema = z.object({
  requestedDocId: z.string(),                    // Links to requestedDocument.id
  label: z.string(),
  url: z.string(),                               // Firebase Storage download URL
  fileName: z.string(),
});

export type UploadedDocument = z.infer<typeof uploadedDocumentSchema>;

export const rfxResponseDocSchema = z.object({
  id: z.string(),
  rfxId: z.string(),
  rfxOwnerUid: z.string(),
  respondentUid: z.string(),
  respondentName: z.string().optional(),
  respondentBusinessName: z.string().optional(), // From ProfileDoc
  // Structured bid fields
  bidAmount: z.number().nonnegative().optional(),
  experience: z.number().nonnegative().optional(),    // Years of relevant experience
  timeline: z.number().nonnegative().optional(),      // Delivery timeline in weeks
  skills: z.string().optional(),                      // Relevant skills description
  pastPerformance: z.string().optional(),             // Past performance summary
  credentials: z.array(z.string()).optional(),        // Certifications/credentials
  references: z.string().optional(),                  // References description
  proposalText: z.string().optional(),                // Free-form approach description
  proposalUrl: z.string().optional(),                 // Main proposal file (Storage URL)
  uploadedDocuments: z.array(uploadedDocumentSchema).default([]),
  // Scoring (computed by evaluation)
  criteriaScores: z.record(z.string(), z.number()).optional(),
  totalScore: z.number().optional(),
  status: rfxResponseStatusSchema.default("pending"),
  submittedAt: z.number(),
});

export type RfxResponseDoc = z.infer<typeof rfxResponseDocSchema>;

// --- RFx Templates ---

export interface RfxTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultCriteria: EvaluationCriterion[];
  defaultDocuments: RequestedDocument[];
  suggestedNaics: string[];
}

export const RFX_TEMPLATES: RfxTemplate[] = [
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
export function computeCriterionScore(
  value: number,
  allValues: number[],
  direction: ScoringDirection
): number {
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (max === min) return 100;
  if (direction === "lower_is_better") {
    return ((max - value) / (max - min)) * 100;
  }
  return ((value - min) / (max - min)) * 100;
}

/**
 * Compute weighted total score for a response given criteria and all responses' numeric values.
 * Returns { criteriaScores, totalScore }.
 */
export function computeRfxScores(
  responseValues: Record<string, number>,
  allResponsesValues: Record<string, number>[],
  criteria: EvaluationCriterion[]
): { criteriaScores: Record<string, number>; totalScore: number } {
  const criteriaScores: Record<string, number> = {};
  let totalScore = 0;
  const weightSum = criteria.reduce((s, c) => s + c.weight, 0) || 1;

  for (const criterion of criteria) {
    const val = responseValues[criterion.id];
    if (val == null) continue;
    const allVals = allResponsesValues
      .map((r) => r[criterion.id])
      .filter((v): v is number => v != null);
    if (allVals.length === 0) continue;
    const score = computeCriterionScore(val, allVals, criterion.direction);
    criteriaScores[criterion.id] = Math.round(score * 10) / 10;
    totalScore += (score * criterion.weight) / weightSum;
  }

  return { criteriaScores, totalScore: Math.round(totalScore * 10) / 10 };
}

// --- Referral Policies & Disputes (Moved up for dependency) ---

export const referralPolicyTemplateSchema = z.enum(["flat_fee", "percentage_first_invoice", "recurring", "tiered"]);
export type ReferralPolicyTemplate = z.infer<typeof referralPolicyTemplateSchema>;

export const referralPolicyDocSchema = z.object({
  id: z.string(),
  uid: z.string(), // Provider uid
  acceptingReferrals: z.boolean().default(false),
  template: referralPolicyTemplateSchema,
  terms: z.string(), // Detailed text description or JSON string of tiers
  attributionWindowDays: z.number().default(90),
  payoutTrigger: z.string(), // e.g. "Net 10 after payment"
  customTerms: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type ReferralPolicyDoc = z.infer<typeof referralPolicyDocSchema>;

export const referralDisputeDocSchema = z.object({
  id: z.string(),
  referralId: z.string(),
  openerUid: z.string(),
  reason: z.string(),
  evidenceUrls: z.array(z.string()).default([]),
  status: z.enum(["open", "under_review", "resolved_upheld", "resolved_dismissed"]),
  adminNotes: z.string().optional(),
  resolutionAt: z.number().optional(),
  createdAt: z.number(),
});
export type ReferralDisputeDoc = z.infer<typeof referralDisputeDocSchema>;

// --- Referrals (PR-03) ---

export const referralStatusSchema = z.enum([
  "pending", 
  "contacted", // legacy/invite
  "accepted",  // business_intro: provider accepted
  "declined",  // business_intro: provider declined
  "converted", 
  "expired",
  "disputed",
  "paid"       // business_intro: payout complete
]);
export type ReferralStatus = z.infer<typeof referralStatusSchema>;

export const referralTypeSchema = z.enum(["platform_invite", "business_intro"]);
export type ReferralType = z.infer<typeof referralTypeSchema>;

export const referralDocSchema = z.object({
  id: z.string(),
  type: referralTypeSchema.default("platform_invite"),
  
  referrerUid: z.string(),
  
  // Platform Invite (Refer User)
  referredEmail: z.string().email().optional(), // Required for platform_invite
  referredName: z.string().optional(),
  
  // Business Intro (Refer Client to Provider)
  providerUid: z.string().optional(), // The member receiving the referral
  clientName: z.string().optional(),
  clientEmail: z.string().email().optional(),
  clientPhone: z.string().optional(),
  clientCompany: z.string().optional(),
  
  // Policy snapshot at time of referral (to lock in terms)
  policySnapshot: z.object({
    template: referralPolicyTemplateSchema,
    terms: z.string(),
    amountCents: z.number().optional(), // Fixed fee or calculated placeholder
    percentage: z.number().optional(), // For percentage based
    currency: z.string().default("USD"),
    attributionWindowDays: z.number().default(90),
    payoutTrigger: z.string().optional(),
  }).optional(),

  status: referralStatusSchema,
  note: z.string().optional(), // Note from referrer to provider/invitee
  
  // Lifecycle
  viewedByProvider: z.boolean().default(false),
  acceptedAt: z.number().optional(),
  convertedAt: z.number().optional(),
  paidAt: z.number().optional(),
  
  // Payout Details
  payoutMethod: z.enum(["manual", "platform"]).optional(),
  payoutProofUrl: z.string().optional(), // For manual payouts
  payoutPaymentId: z.string().optional(), // For platform payouts (linked PaymentDoc)
  
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type ReferralDoc = z.infer<typeof referralDocSchema>;

// --- Events (PR-03) ---

export const eventStatusSchema = z.enum(["draft", "published", "cancelled", "completed"]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const eventFormatSchema = z.enum(["in-person", "virtual", "hybrid"]);
export type EventFormat = z.infer<typeof eventFormatSchema>;

export const eventTicketTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number().nonnegative(),
  quantity: z.number().optional(), // Total available
  soldCount: z.number().default(0),
  description: z.string().optional(),
  targetAudience: z.enum(["public", "member", "vip"]).default("public"),
});
export type EventTicketType = z.infer<typeof eventTicketTypeSchema>;

export const eventSponsorshipTierSchema = z.object({
  id: z.string(),
  name: z.string(), // e.g. "Bronze", "Silver", "Gold"
  priceCents: z.number().nonnegative(),
  slots: z.number(), // max sponsors
  soldCount: z.number().default(0),
  benefits: z.array(z.string()),
});
export type EventSponsorshipTier = z.infer<typeof eventSponsorshipTierSchema>;

export const eventMediaImageSchema = z.object({
  storagePath: z.string(),
  downloadUrl: z.string().optional(),
  alt: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type EventMediaImage = z.infer<typeof eventMediaImageSchema>;

export const eventPromoVideoSchema = z.object({
  type: z.enum(["upload", "youtube", "vimeo"]),
  url: z.string().optional(),
  storagePath: z.string().optional(),
  thumbnail: eventMediaImageSchema.optional(),
});
export type EventPromoVideo = z.infer<typeof eventPromoVideoSchema>;

export const eventSpeakerCardSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  headshotImage: eventMediaImageSchema.optional(),
  socials: z.record(z.string(), z.string()).optional(),
});
export type EventSpeakerCard = z.infer<typeof eventSpeakerCardSchema>;

export const eventAudienceRulesSchema = z.object({
  membershipTiers: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
  proximityRadiusMiles: z.number().nonnegative().optional(),
});
export type EventAudienceRules = z.infer<typeof eventAudienceRulesSchema>;

export const eventCampaignSummarySchema = z.object({
  status: z.enum(["draft", "scheduled", "active", "paused", "completed"]).default("draft"),
  schedule: z.object({
    announceAt: z.number().optional(),
    reminderAt7d: z.number().optional(),
    reminderAt1d: z.number().optional(),
    reminderAt1h: z.number().optional(),
    followUpAt: z.number().optional(),
  }).optional(),
  channels: z.array(z.enum(["email", "sms", "push", "in_app", "social"])).default([]),
  copyVariants: z.record(z.string(), z.string()).default({}),
  utmBase: z.object({
    source: z.string().optional(),
    medium: z.string().optional(),
    campaign: z.string().optional(),
    content: z.string().optional(),
  }).optional(),
});
export type EventCampaignSummary = z.infer<typeof eventCampaignSummarySchema>;

export const eventSeriesDocSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  format: eventFormatSchema,
  status: eventStatusSchema,
  timezone: z.string().default("America/New_York"),
  rrule: z.string().optional(),
  startTimeOfDay: z.string().optional(), // HH:mm (24h)
  durationMins: z.number().int().positive().optional(),
  seriesStartDate: z.number().optional(),
  seriesEndDate: z.number().optional(),
  exceptions: z.array(z.number()).default([]),
  overrides: z.record(z.string(), z.record(z.string(), z.any())).default({}),
  location: z.string().optional(),
  virtualUrl: z.string().url().optional(),
  seatCap: z.number().int().nonnegative().optional(),
  price: z.number().nonnegative().default(0),
  currency: z.string().default("USD"),
  linkedRfxId: z.string().optional(),
  recordingUrl: z.string().url().optional(),
  ticketTypes: z.array(eventTicketTypeSchema).default([]),
  sponsorships: z.array(eventSponsorshipTierSchema).default([]),
  allowVendorTables: z.boolean().default(false),
  vendorTablePriceCents: z.number().optional(),
  upsellProducts: z.array(z.string()).default([]),
  heroImage: eventMediaImageSchema.optional(),
  gallery: z.array(eventMediaImageSchema).default([]),
  promoVideo: eventPromoVideoSchema.optional(),
  speakerCards: z.array(eventSpeakerCardSchema).default([]),
  sponsorLogos: z.array(eventMediaImageSchema).default([]),
  topics: z.array(z.string()).default([]),
  audienceRules: eventAudienceRulesSchema.optional(),
  campaign: eventCampaignSummarySchema.optional(),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type EventSeriesDoc = z.infer<typeof eventSeriesDocSchema>;

export const eventDocSchema = z.object({
  id: z.string(),
  seriesId: z.string().optional(),
  occurrenceDate: z.number().optional(),
  isOverride: z.boolean().default(false),
  occurrenceStartTime: z.number().optional(),
  occurrenceEndTime: z.number().optional(),
  title: z.string(),
  description: z.string(),
  format: eventFormatSchema,
  location: z.string().optional(),
  virtualUrl: z.string().url().optional(),
  startTime: z.number(),                         // Timestamp
  endTime: z.number(),                           // Timestamp
  seatCap: z.number().int().nonnegative().optional(),
  registrationCount: z.number().default(0),
  price: z.number().nonnegative().default(0),    // 0 = free
  currency: z.string().default("USD"),
  imageUrl: z.string().optional(),
  heroImage: eventMediaImageSchema.optional(),
  gallery: z.array(eventMediaImageSchema).default([]),
  promoVideo: eventPromoVideoSchema.optional(),
  speakerCards: z.array(eventSpeakerCardSchema).default([]),
  sponsorLogos: z.array(eventMediaImageSchema).default([]),
  linkedRfxId: z.string().optional(),            // Link to RFx
  recordingUrl: z.string().url().optional(),     // Post-event recording archive (PR-15)
  topics: z.array(z.string()).default([]),
  audienceRules: eventAudienceRulesSchema.optional(),
  campaign: eventCampaignSummarySchema.optional(),
  status: eventStatusSchema,
  
  // Monetization
  ticketTypes: z.array(eventTicketTypeSchema).default([]),
  sponsorships: z.array(eventSponsorshipTierSchema).default([]),
  allowVendorTables: z.boolean().default(false),
  vendorTablePriceCents: z.number().optional(),
  upsellProducts: z.array(z.string()).default([]), // IDs of ProductDocs (coffee, kits)

  createdBy: z.string(),                         // uid (admin)
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type EventDoc = z.infer<typeof eventDocSchema>;

export const eventRegistrationDocSchema = z.object({
  uid: z.string(),
  eventId: z.string(),
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  registeredAt: z.number(),
  paymentId: z.string().optional(),              // Linked payment if paid event
  ticketTypeId: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  amountPaidCents: z.number().int().nonnegative().optional(),
  status: z.enum(["active", "cancelled", "refunded"]).default("active"),
  registrationSource: z.object({
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional(),
    utmContent: z.string().optional(),
  }).optional(),
  checkedInAt: z.number().optional(),
  checkInToken: z.string().optional(),
  waitlistPromotedAt: z.number().optional(),
});

export type EventRegistrationDoc = z.infer<typeof eventRegistrationDocSchema>;

export const eventWaitlistEntryDocSchema = z.object({
  uid: z.string(),
  eventId: z.string(),
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  joinedAt: z.number(),
  status: z.enum(["waiting", "notified", "claimed", "expired", "removed"]).default("waiting"),
  notifiedAt: z.number().optional(),
  claimExpiresAt: z.number().optional(),
  notificationToken: z.string().optional(),
});

export type EventWaitlistEntryDoc = z.infer<typeof eventWaitlistEntryDocSchema>;

export const eventCampaignDocSchema = z.object({
  id: z.string(),
  eventId: z.string().optional(),
  seriesId: z.string().optional(),
  status: z.enum(["draft", "scheduled", "active", "paused", "completed"]).default("draft"),
  channels: z.array(z.enum(["email", "sms", "push", "in_app", "social"])).default([]),
  audienceRules: eventAudienceRulesSchema.optional(),
  schedule: z.object({
    announceAt: z.number().optional(),
    reminderOffsetsHours: z.array(z.number()).default([]),
    followUpAt: z.number().optional(),
  }).optional(),
  copyVariants: z.record(z.string(), z.string()).default({}),
  utmBase: z.object({
    source: z.string().optional(),
    medium: z.string().optional(),
    campaign: z.string().optional(),
    content: z.string().optional(),
  }).optional(),
  stats: z.object({
    impressions: z.number().int().nonnegative().default(0),
    clicks: z.number().int().nonnegative().default(0),
    registrations: z.number().int().nonnegative().default(0),
    conversionRate: z.number().nonnegative().default(0),
  }).default({ impressions: 0, clicks: 0, registrations: 0, conversionRate: 0 }),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type EventCampaignDoc = z.infer<typeof eventCampaignDocSchema>;

export const campaignJobDocSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  type: z.enum(["announce", "reminder", "starting_soon", "follow_up"]),
  scheduledFor: z.number(),
  status: z.enum(["pending", "processing", "sent", "failed"]).default("pending"),
  recipientCount: z.number().int().nonnegative().default(0),
  createdAt: z.number(),
  processedAt: z.number().optional(),
  error: z.string().optional(),
});
export type CampaignJobDoc = z.infer<typeof campaignJobDocSchema>;

export const eventShareKitDocSchema = z.object({
  id: z.string(),
  eventId: z.string().optional(),
  seriesId: z.string().optional(),
  assets: z.array(z.object({
    variant: z.enum(["square", "vertical", "horizontal"]),
    storagePath: z.string(),
    downloadUrl: z.string().optional(),
  })).default([]),
  captions: z.record(z.string(), z.string()).default({}),
  trackedLink: z.string().optional(),
  status: z.enum(["generating", "ready", "approved", "archived"]).default("generating"),
  generatedAt: z.number().optional(),
  approvedAt: z.number().optional(),
  approvedBy: z.string().optional(),
  createdAt: z.number(),
});
export type EventShareKitDoc = z.infer<typeof eventShareKitDocSchema>;

export const socialPostDocSchema = z.object({
  id: z.string(),
  eventId: z.string().optional(),
  seriesId: z.string().optional(),
  channel: z.enum(["linkedin", "facebook", "instagram", "x"]),
  scheduledFor: z.number(),
  status: z.enum(["draft", "approved", "scheduled", "posted", "failed"]).default("draft"),
  assetRef: z.string().optional(),
  caption: z.string(),
  link: z.string().optional(),
  retries: z.number().int().nonnegative().default(0),
  postedAt: z.number().optional(),
  postUrl: z.string().optional(),
  error: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type SocialPostDoc = z.infer<typeof socialPostDocSchema>;

// --- Payments (PR-03) ---

export const paymentProviderSchema = z.enum([
  "stripe",
  "quickbooks_link",
  "quickbooks_invoice",
  "quickbooks_payments",
]);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const paymentStatusSchema = z.enum(["pending", "paid", "failed", "refunded"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentPurposeSchema = z.enum(["membership", "event", "rfx", "booking", "referral", "bookstore", "other"]);
export type PaymentPurpose = z.infer<typeof paymentPurposeSchema>;

export const paymentDocSchema = z.object({
  id: z.string(),
  uid: z.string(),
  orgId: z.string().optional(),
  provider: paymentProviderSchema,
  amount: z.number().nonnegative(),
  currency: z.string().default("USD"),
  purpose: paymentPurposeSchema,
  purposeRefId: z.string().optional(),           // e.g. eventId, bookingId
  status: paymentStatusSchema,
  providerRefs: z.record(z.string(), z.string()).optional(), // sessionId, invoiceId, etc.
  accountingRefs: z.record(z.string(), z.string()).optional(), // QBO IDs
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type PaymentDoc = z.infer<typeof paymentDocSchema>;

// --- Webhook Idempotency (PR-03) ---

export const webhookEventDocSchema = z.object({
  eventId: z.string(),                           // Provider event ID (Stripe event ID, etc.)
  provider: z.string(),
  processedAt: z.number(),
  result: z.string().optional(),                 // "success" | "skipped" | error message
});

export type WebhookEventDoc = z.infer<typeof webhookEventDocSchema>;

// --- Leads (PR-03) ---

export const leadDocSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  interests: z.array(z.string()).optional(),
  message: z.string().optional(),
  intent: z.string().optional(),                 // e.g. "coworking", "event-space", "membership"
  source: z.string().optional(),                 // e.g. "coming-soon-page", "contact-form"
  version: z.string().optional(),                // Form version identifier
  interestScore: z.number().optional(),          // Computed engagement score
  createdAt: z.number(),
});

export type LeadDoc = z.infer<typeof leadDocSchema>;

// --- Notifications (PR-03) ---

export const notificationTypeSchema = z.enum([
  "rfx_new",
  "rfx_response",
  "referral",
  "event_registration",
  "payment",
  "system",
  "access_pin_issued",
  "access_pin_revoked",
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationDocSchema = z.object({
  id: z.string(),
  uid: z.string(),                               // Recipient
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  linkTo: z.string().optional(),                 // In-app route
  read: z.boolean().default(false),
  createdAt: z.number(),
});

export type NotificationDoc = z.infer<typeof notificationDocSchema>;

// --- Products / Payment Links (PR-11) ---

export const productVariantSchema = z.object({
  id: z.string(),
  name: z.string(), // e.g. "Paperback", "PDF Download", "Merch Bundle"
  priceCents: z.number().nonnegative(),
  type: z.enum(["physical", "digital", "service"]),
  digitalAssetUrl: z.string().optional(),
  inventory: z.number().optional(),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productDocSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  amount: z.number().nonnegative(),              // cents
  currency: z.string().default("USD"),
  purpose: paymentPurposeSchema,
  stripePriceId: z.string().optional(),
  quickbooksPaymentLinkUrl: z.string().url().optional(),
  
  // Monetization
  variants: z.array(productVariantSchema).default([]),
  inventory: z.number().optional(),

  active: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type ProductDoc = z.infer<typeof productDocSchema>;

// --- Payment Audit Log (PR-11) ---

export const paymentAuditActionSchema = z.enum([
  "mark_paid",
  "mark_failed",
  "refund",
  "note",
]);
export type PaymentAuditAction = z.infer<typeof paymentAuditActionSchema>;

export const paymentAuditEntrySchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  action: paymentAuditActionSchema,
  performedBy: z.string(),                       // admin uid
  note: z.string().optional(),
  previousStatus: paymentStatusSchema.optional(),
  newStatus: paymentStatusSchema.optional(),
  createdAt: z.number(),
});

export type PaymentAuditEntry = z.infer<typeof paymentAuditEntrySchema>;

// --- RFx Team Invites (PR-16) ---

export const rfxTeamInviteStatusSchema = z.enum(["pending", "accepted", "declined"]);
export type RfxTeamInviteStatus = z.infer<typeof rfxTeamInviteStatusSchema>;

export const rfxTeamInviteDocSchema = z.object({
  id: z.string(),
  rfxId: z.string(),
  inviterUid: z.string(),
  inviteeUid: z.string(),
  inviteeName: z.string().optional(),
  role: z.string().optional(),                   // e.g. "sub", "lead", "partner"
  status: rfxTeamInviteStatusSchema,
  note: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type RfxTeamInviteDoc = z.infer<typeof rfxTeamInviteDocSchema>;

export const rfxTeamRoleSchema = z.enum(["prime", "sub", "estimator", "compliance", "proposal_writer"]);
export type RfxTeamRole = z.infer<typeof rfxTeamRoleSchema>;

export const rfxTeamMemberSchema = z.object({
  uid: z.string(),
  displayName: z.string().optional(),
  businessName: z.string().optional(),
  role: rfxTeamRoleSchema,
  joinedAt: z.number(),
  scopeDescription: z.string().optional(),
});
export type RfxTeamMember = z.infer<typeof rfxTeamMemberSchema>;

export const rfxTeamDocSchema = z.object({
  id: z.string(),
  rfxId: z.string(),
  name: z.string(),
  primeUid: z.string(),
  members: z.array(rfxTeamMemberSchema),
  memberUids: z.array(z.string()).default([]),
  status: z.enum(["forming", "active", "submitted", "dissolved"]),
  internalNotes: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type RfxTeamDoc = z.infer<typeof rfxTeamDocSchema>;

export const teamDocumentSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  uploadedBy: z.string(),
  fileName: z.string(),
  storagePath: z.string(),
  downloadUrl: z.string().optional(),
  description: z.string().optional(),
  uploadedAt: z.number(),
});
export type TeamDocument = z.infer<typeof teamDocumentSchema>;

// --- Credits & Monetization ---

export const creditTransactionTypeSchema = z.enum([
  "purchase",
  "monthly_allocation",
  "usage",
  "refund",
  "admin_adjustment",
  "expired"
]);
export type CreditTransactionType = z.infer<typeof creditTransactionTypeSchema>;

export const creditTransactionDocSchema = z.object({
  id: z.string(),
  userId: z.string(),
  amount: z.number(), // Positive for add, negative for deduct
  type: creditTransactionTypeSchema,
  referenceId: z.string().optional(), // e.g. rfxId, referralId, paymentId
  description: z.string(),
  createdAt: z.number(),
});
export type CreditTransactionDoc = z.infer<typeof creditTransactionDocSchema>;

export const CREDIT_PACKS = [
  { id: "pack_10", credits: 10, priceCents: 2500 },
  { id: "pack_25", credits: 25, priceCents: 5500 },
  { id: "pack_60", credits: 60, priceCents: 12000 },
] as const;

export const CREDIT_COSTS = {
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
} as const;

// --- Platform Fees ---

export const platformFeeDocSchema = z.object({
  id: z.string(),
  transactionId: z.string(), // Link to the main transaction
  relatedEntityId: z.string(), // rfxId, referralId
  payerUid: z.string(),
  payeeUid: z.string().optional(),
  amountCents: z.number().nonnegative(),
  type: z.enum(["application_fee", "service_fee", "success_fee", "escrow_fee"]),
  status: z.enum(["pending", "captured", "refunded"]),
  createdAt: z.number(),
});
export type PlatformFeeDoc = z.infer<typeof platformFeeDocSchema>;

// --- Pricing & Membership Tiers ---

export const membershipTierIdSchema = z.enum(["virtual", "coworking", "coworking_plus"]);
export type MembershipTierId = z.infer<typeof membershipTierIdSchema>;

export interface MembershipTierDef {
  id: MembershipTierId;
  name: string;
  /** Monthly price in cents */
  amountCents: number;
  interval: "month";
  currency: string;
  features: string[];
  /** Stripe price ID placeholder — replace with real IDs after Stripe setup */
  stripePriceId: string;
  /** Included desk hours per month */
  includedHoursPerMonth: number;
  /** Extra desk-hour rate in cents (beyond included hours) */
  extraHourlyRateCents: number;
  /** Booking window: max days ahead */
  bookingWindowDays: number;
  
  /** Included credits per month */
  includedCreditsPerMonth: number;
  
  /** Feature limits */
  limits: {
    rfxActivePosts: number;
    rfxInvitePushes: number;
    referralsSentPerMonth: number;
    referralsReceivedPerMonth: number;
    referralPolicyUnlocksPerMonth: number;
    referralActiveOpen: number;
  };
}

export const MEMBERSHIP_TIERS: MembershipTierDef[] = [
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

export const RESOURCE_CATALOG: Record<string, Resource> = {
  "seat-1": { id: "seat-1", name: "Seat 1", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
  "seat-2": { id: "seat-2", name: "Seat 2", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
  "seat-3": { id: "seat-3", name: "Seat 3", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
  "seat-4": { id: "seat-4", name: "Seat 4", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
  "seat-5": { id: "seat-5", name: "Seat 5", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
  "seat-6": { id: "seat-6", name: "Seat 6", type: "SEAT", exclusiveGroupId: "main_space", capacity: 1, guestRateHourly: 17.5 },
  "mode-conference": { id: "mode-conference", name: "Conference Room", type: "MODE", exclusiveGroupId: "main_space", capacity: 10, guestRateHourly: 75 },
};

export function getResourceById(id: string): Resource | undefined {
  return RESOURCE_CATALOG[id];
}

export function getResourcesByType(type: ResourceType): Resource[] {
  return Object.values(RESOURCE_CATALOG).filter((r) => r.type === type);
}

// --- Guest (Public / Walk-In) Rates ---

export const GUEST_PRICING = {
  /** Per hour per seat, in cents */
  hourlyRateCents: 1750,
  /** Daily cap per seat, in cents */
  dailyCapCents: 11500,
  /** Booking window: max days ahead */
  bookingWindowDays: 14,
} as const;

/** @deprecated Use GUEST_PRICING instead */
export const NON_MEMBER_PRICING = GUEST_PRICING;

// --- Conference Room ---

export const CONFERENCE_ROOM_CONFIG = {
  maxCapacity: 10,
  /** Per hour in cents */
  hourlyRateCents: 7500,
} as const;

// --- Space Inventory ---

export const SPACE_INVENTORY = {
  totalSeats: 6,
} as const;

// --- Bookstore (Virtual Bookstore) ---

export const bookAvailabilityModeSchema = z.enum(["browse_only", "digital", "physical"]);
export type BookAvailabilityMode = z.infer<typeof bookAvailabilityModeSchema>;

export const bookSalesChannelSchema = z.enum(["owned", "affiliate"]);
export type BookSalesChannel = z.infer<typeof bookSalesChannelSchema>;

export const bookDocSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  description: z.string().optional(),
  coverImageUrl: z.string().optional(),

  // Commerce / fulfillment
  availabilityMode: bookAvailabilityModeSchema,
  salesChannel: bookSalesChannelSchema,

  // Pricing (owned only, in cents)
  priceCents: z.number().nonnegative().optional(),
  stripePriceId: z.string().optional(),

  // Variants (Monetization)
  variants: z.array(productVariantSchema).default([]),
  bundleIds: z.array(z.string()).default([]), // Linked bundles

  // Affiliate (affiliate only)
  affiliateUrl: z.string().optional(),
  affiliateNetwork: z.string().optional(),       // e.g. "amazon", "bookshop"

  // Digital fulfillment (owned + digital only)
  digitalAssetUrl: z.string().optional(),        // Firebase Storage path or URL

  // Access policies (all default to false)
  requireLoginToView: z.boolean().default(false),
  requireLoginToPurchase: z.boolean().default(false),
  requireLoginToAccessContent: z.boolean().default(false),

  // Series
  seriesTitle: z.string().optional(),            // e.g. "Procurement Mastery Series"
  seriesOrder: z.number().optional(),            // position in series (1, 2, 3…)

  // Categorization
  tags: z.array(z.string()).default([]),
  featuredRank: z.number().optional(),           // lower = more featured

  // Status
  published: z.boolean().default(false),

  createdBy: z.string(),                         // admin uid
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type BookDoc = z.infer<typeof bookDocSchema>;

export const bookPurchaseDocSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  userId: z.string().optional(),                 // optional for guest purchases
  email: z.string().email().optional(),
  stripeSessionId: z.string().optional(),
  accessGrantedAt: z.number().optional(),
  createdAt: z.number(),
});

export type BookPurchaseDoc = z.infer<typeof bookPurchaseDocSchema>;

export const bookAffiliateClickDocSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  userId: z.string().optional(),
  destination: z.string(),                       // affiliate URL domain
  createdAt: z.number(),
});

export type BookAffiliateClickDoc = z.infer<typeof bookAffiliateClickDocSchema>;

// --- Smart Access Integration (Seam / Yale) ---

export const doorStatusSchema = z.enum(["online", "offline", "unknown"]);
export type DoorStatus = z.infer<typeof doorStatusSchema>;

export const doorDocSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),                                   // e.g. "Front Door"
  seamDeviceId: z.string(),                           // Seam device ID
  /** Which resource IDs this door gates (front door = all seats; conference = its own door later) */
  resourceIds: z.array(z.string()).default([]),
  status: doorStatusSchema.default("unknown"),
  batteryLevel: z.number().min(0).max(1).optional(),  // 0–1 float
  lastSeenAt: z.number().optional(),
  notes: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type DoorDoc = z.infer<typeof doorDocSchema>;

export const accessGrantStatusSchema = z.enum(["pending", "active", "expired", "revoked"]);
export type AccessGrantStatus = z.infer<typeof accessGrantStatusSchema>;

export const accessRevokeReasonSchema = z.enum(["cancellation", "no_show", "admin", "expired"]);
export type AccessRevokeReason = z.infer<typeof accessRevokeReasonSchema>;

export const accessGrantDocSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  doorId: z.string(),
  userId: z.string(),
  startsAt: z.number(),                               // booking.start − gracePeriodMinutes
  endsAt: z.number(),                                 // booking.end + gracePeriodMinutes
  gracePeriodMinutes: z.number().int().nonnegative().default(5),
  status: accessGrantStatusSchema.default("pending"),
  revokedAt: z.number().optional(),
  revokedBy: z.string().optional(),                   // uid of revoker (admin or system)
  revokeReason: accessRevokeReasonSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type AccessGrantDoc = z.infer<typeof accessGrantDocSchema>;

export const accessCodeStatusSchema = z.enum(["programming", "active", "failed", "expired", "revoked"]);
export type AccessCodeStatus = z.infer<typeof accessCodeStatusSchema>;

export const accessCodeDocSchema = z.object({
  id: z.string(),
  grantId: z.string(),
  doorId: z.string(),
  provider: z.literal("seam"),
  seamCodeId: z.string().optional(),                  // Seam access_code.id (set after Seam responds)
  /** SHA-256 hash of the full PIN — never store plain text */
  codeHash: z.string().optional(),
  /** Last 2 digits of PIN for support/verification only */
  codeLast2: z.string().optional(),
  status: accessCodeStatusSchema.default("programming"),
  deliveredAt: z.number().optional(),                 // Timestamp of notification send
  failureReason: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type AccessCodeDoc = z.infer<typeof accessCodeDocSchema>;

export const accessEventTypeSchema = z.enum([
  "code_issued",
  "code_programming",
  "code_active",
  "code_failed",
  "code_used",
  "code_expired",
  "code_revoked",
  "door_unlocked",
  "door_unlock_requested",
  "grant_created",
  "grant_revoked",
  "admin_override",
  "no_show_revoke",
  "device_online",
  "device_offline",
]);
export type AccessEventType = z.infer<typeof accessEventTypeSchema>;

export const accessEventDocSchema = z.object({
  id: z.string(),
  bookingId: z.string().optional(),
  grantId: z.string().optional(),
  doorId: z.string(),
  userId: z.string().optional(),
  eventType: accessEventTypeSchema,
  provider: z.literal("seam"),
  providerPayload: z.record(z.string(), z.any()).optional(),  // Raw Seam event payload
  performedBy: z.string().optional(),                         // uid for admin actions
  notes: z.string().optional(),
  createdAt: z.number(),
});
export type AccessEventDoc = z.infer<typeof accessEventDocSchema>;
