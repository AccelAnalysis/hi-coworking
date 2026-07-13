"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileUpdateInputSchema = exports.httpUrlSchema = void 0;
exports.getInvalidProfileAssetStoragePathFields = getInvalidProfileAssetStoragePathFields;
exports.sanitizePublicProfile = sanitizePublicProfile;
const zod_1 = require("zod");
// Kept local because the Functions package executes compiled CommonJS while
// @hi/shared currently exports its TypeScript source at runtime. Contract tests
// exercise both this mirror and the shared persisted schema.
const storageLeaf = String.raw `[^/\u0000-\u001f\u007f]+`;
const capabilityStatementStoragePathSchema = zod_1.z
    .string()
    .min(1)
    .max(1024)
    .regex(new RegExp(`^capabilityStatements/${storageLeaf}/${storageLeaf}$`));
const profilePhotoStoragePathSchema = zod_1.z
    .string()
    .min(1)
    .max(1024)
    .regex(new RegExp(`^profilePhotos/${storageLeaf}/${storageLeaf}$`));
const profileVideoStoragePathSchema = zod_1.z
    .string()
    .min(1)
    .max(1024)
    .regex(new RegExp(`^profileVideos/${storageLeaf}/(?:raw|processed)/${storageLeaf}$`));
const profileVideoPosterStoragePathSchema = zod_1.z.union([
    profilePhotoStoragePathSchema,
    zod_1.z
        .string()
        .min(1)
        .max(1024)
        .regex(new RegExp(`^profileVideos/${storageLeaf}/posters/${storageLeaf}$`)),
]);
const profileAssetStoragePathFields = [
    "capabilityStatementStoragePath",
    "photoStoragePath",
    "videoIntroStoragePath",
    "videoIntroPosterStoragePath",
];
function profileAssetStoragePathBelongsToUid(field, storagePath, uid) {
    if (storagePath.split("/")[1] !== uid)
        return false;
    switch (field) {
        case "capabilityStatementStoragePath":
            return capabilityStatementStoragePathSchema.safeParse(storagePath).success;
        case "photoStoragePath":
            return profilePhotoStoragePathSchema.safeParse(storagePath).success;
        case "videoIntroStoragePath":
            return profileVideoStoragePathSchema.safeParse(storagePath).success;
        case "videoIntroPosterStoragePath":
            return profileVideoPosterStoragePathSchema.safeParse(storagePath).success;
    }
}
exports.httpUrlSchema = zod_1.z
    .string()
    .url()
    .refine((value) => {
    try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
    }
    catch {
        return false;
    }
}, "URL must use the http or https protocol");
const profileHttpUrlSchema = zod_1.z.string().trim().max(2000).pipe(exports.httpUrlSchema);
exports.profileUpdateInputSchema = zod_1.z
    .object({
    businessName: zod_1.z.string().trim().max(200).optional(),
    bio: zod_1.z.string().trim().max(10000).optional(),
    naicsCodes: zod_1.z.array(zod_1.z.string().trim().regex(/^\d{2,6}$/)).max(50).optional(),
    certifications: zod_1.z.array(zod_1.z.string().trim().min(1).max(160)).max(50).optional(),
    uei: zod_1.z.string().trim().max(40).optional(),
    duns: zod_1.z.string().trim().max(20).optional(),
    cageCode: zod_1.z.string().trim().max(20).optional(),
    capabilityStatementUrl: profileHttpUrlSchema.nullable().optional(),
    capabilityStatementStoragePath: capabilityStatementStoragePathSchema.nullable().optional(),
    photoUrl: profileHttpUrlSchema.nullable().optional(),
    photoStoragePath: profilePhotoStoragePathSchema.nullable().optional(),
    website: profileHttpUrlSchema.optional(),
    linkedin: profileHttpUrlSchema.optional(),
    videoIntroUrl: profileHttpUrlSchema.nullable().optional(),
    videoIntroStoragePath: profileVideoStoragePathSchema.nullable().optional(),
    videoIntroPosterUrl: profileHttpUrlSchema.nullable().optional(),
    videoIntroPosterStoragePath: profileVideoPosterStoragePathSchema.nullable().optional(),
    published: zod_1.z.boolean(),
})
    .strict();
const VERIFICATION_STATUSES = new Set(["none", "pending", "verified", "rejected"]);
const READINESS_TIERS = new Set(["seat_ready", "bid_ready", "procurement_ready"]);
const VIDEO_STATUSES = new Set(["processing", "ready", "failed"]);
const PUBLIC_STRING_FIELDS = [
    "businessName",
    "bio",
    "uei",
    "duns",
    "cageCode",
];
const PUBLIC_HTTP_URL_FIELDS = [
    "website",
    "linkedin",
];
const PUBLIC_ASSET_FIELDS = [
    {
        pathField: "capabilityStatementStoragePath",
        legacyUrlField: "capabilityStatementUrl",
    },
    {
        pathField: "photoStoragePath",
        legacyUrlField: "photoUrl",
    },
    {
        pathField: "videoIntroStoragePath",
        legacyUrlField: "videoIntroUrl",
    },
    {
        pathField: "videoIntroPosterStoragePath",
        legacyUrlField: "videoIntroPosterUrl",
    },
];
const PUBLIC_STRING_ARRAY_FIELDS = [
    "naicsCodes",
    "certifications",
    "verifiedCertifications",
    "badges",
];
const PUBLIC_NUMBER_FIELDS = [
    "profileCompletenessScore",
    "videoIntroDurationSec",
    "createdAt",
    "updatedAt",
];
const PUBLIC_TRUST_STAT_FIELDS = [
    "referralsConverted",
    "payoutsPlatformManaged",
    "payoutsOnTimeRate",
    "medianResponseTimeHours",
    "disputesOpened",
    "disputesLost",
];
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function sanitizeStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.filter((item) => typeof item === "string");
}
function sanitizeTrustStats(value) {
    if (!isRecord(value))
        return undefined;
    const sanitized = {};
    for (const field of PUBLIC_TRUST_STAT_FIELDS) {
        const candidate = value[field];
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            sanitized[field] = candidate;
        }
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
/** Returns canonical path fields that are syntactically valid but owned by a different UID. */
function getInvalidProfileAssetStoragePathFields(profileId, profile) {
    return profileAssetStoragePathFields.filter((field) => {
        const storagePath = profile[field];
        return typeof storagePath === "string"
            && !profileAssetStoragePathBelongsToUid(field, storagePath, profileId);
    });
}
function isPublishableProfileAssetPath(pathField, storagePath) {
    if (pathField === "videoIntroStoragePath") {
        return storagePath.split("/")[2] === "processed";
    }
    if (pathField === "videoIntroPosterStoragePath"
        && storagePath.startsWith("profileVideos/")) {
        return storagePath.split("/")[2] === "posters";
    }
    return true;
}
/**
 * Produces the sole public representation of a private profile. Every key,
 * including nested trust statistics, is copied through an explicit allowlist.
 */
function sanitizePublicProfile(profileId, profile) {
    const projection = {
        uid: profileId,
        published: true,
    };
    for (const field of PUBLIC_STRING_FIELDS) {
        if (typeof profile[field] === "string")
            projection[field] = profile[field];
    }
    for (const field of PUBLIC_HTTP_URL_FIELDS) {
        const parsed = exports.httpUrlSchema.safeParse(profile[field]);
        if (parsed.success)
            projection[field] = parsed.data;
    }
    for (const { pathField, legacyUrlField } of PUBLIC_ASSET_FIELDS) {
        const storagePath = profile[pathField];
        if (typeof storagePath === "string"
            && profileAssetStoragePathBelongsToUid(pathField, storagePath, profileId)
            && isPublishableProfileAssetPath(pathField, storagePath)) {
            projection[pathField] = storagePath;
            continue;
        }
        // Existing profiles may only have a Firebase download URL. Preserve that
        // read compatibility until the owner uploads a canonical path, but never
        // project both representations for newly migrated assets.
        const legacyUrl = exports.httpUrlSchema.safeParse(profile[legacyUrlField]);
        if (legacyUrl.success)
            projection[legacyUrlField] = legacyUrl.data;
    }
    for (const field of PUBLIC_STRING_ARRAY_FIELDS) {
        const value = sanitizeStringArray(profile[field]);
        if (value !== undefined)
            projection[field] = value;
    }
    for (const field of PUBLIC_NUMBER_FIELDS) {
        const value = profile[field];
        if (typeof value === "number" && Number.isFinite(value))
            projection[field] = value;
    }
    const trustStats = sanitizeTrustStats(profile.trustStats);
    if (trustStats)
        projection.trustStats = trustStats;
    if (typeof profile.verificationStatus === "string" && VERIFICATION_STATUSES.has(profile.verificationStatus)) {
        projection.verificationStatus = profile.verificationStatus;
    }
    if (typeof profile.readinessTier === "string" && READINESS_TIERS.has(profile.readinessTier)) {
        projection.readinessTier = profile.readinessTier;
    }
    if (typeof profile.videoIntroStatus === "string" && VIDEO_STATUSES.has(profile.videoIntroStatus)) {
        projection.videoIntroStatus = profile.videoIntroStatus;
    }
    return projection;
}
