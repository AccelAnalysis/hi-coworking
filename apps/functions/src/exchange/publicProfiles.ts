import { z } from "zod";

// Kept local because the Functions package executes compiled CommonJS while
// @hi/shared currently exports its TypeScript source at runtime. Contract tests
// exercise both this mirror and the shared persisted schema.
const storageLeaf = String.raw`[^/\u0000-\u001f\u007f]+`;
const capabilityStatementStoragePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(new RegExp(`^capabilityStatements/${storageLeaf}/${storageLeaf}$`));
const profilePhotoStoragePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(new RegExp(`^profilePhotos/${storageLeaf}/${storageLeaf}$`));
const profileVideoStoragePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(new RegExp(`^profileVideos/${storageLeaf}/(?:raw|processed)/${storageLeaf}$`));
const profileVideoPosterStoragePathSchema = z.union([
  profilePhotoStoragePathSchema,
  z
    .string()
    .min(1)
    .max(1_024)
    .regex(new RegExp(`^profileVideos/${storageLeaf}/posters/${storageLeaf}$`)),
]);

const profileAssetStoragePathFields = [
  "capabilityStatementStoragePath",
  "photoStoragePath",
  "videoIntroStoragePath",
  "videoIntroPosterStoragePath",
] as const;
type ProfileAssetStoragePathField = (typeof profileAssetStoragePathFields)[number];

function profileAssetStoragePathBelongsToUid(
  field: ProfileAssetStoragePathField,
  storagePath: string,
  uid: string,
): boolean {
  if (storagePath.split("/")[1] !== uid) return false;
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

export const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must use the http or https protocol");

const profileHttpUrlSchema = z.string().trim().max(2_000).pipe(httpUrlSchema);

export const profileUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    businessName: z.string().trim().max(200).nullable().optional(),
    bio: z.string().trim().max(10_000).nullable().optional(),
    city: z.string().trim().max(160).nullable().optional(),
    state: z.string().trim().max(80).nullable().optional(),
    domain: z.string().trim().max(253).nullable().optional(),
    naicsCodes: z.array(z.string().trim().regex(/^\d{2,6}$/)).max(50).optional(),
    certifications: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
    uei: z.string().trim().max(40).nullable().optional(),
    duns: z.string().trim().max(20).nullable().optional(),
    cageCode: z.string().trim().max(20).nullable().optional(),
    capabilityStatementUrl: profileHttpUrlSchema.nullable().optional(),
    capabilityStatementStoragePath: capabilityStatementStoragePathSchema.nullable().optional(),
    photoUrl: profileHttpUrlSchema.nullable().optional(),
    photoStoragePath: profilePhotoStoragePathSchema.nullable().optional(),
    website: profileHttpUrlSchema.nullable().optional(),
    linkedin: profileHttpUrlSchema.nullable().optional(),
    videoIntroUrl: profileHttpUrlSchema.nullable().optional(),
    videoIntroStoragePath: profileVideoStoragePathSchema.nullable().optional(),
    videoIntroPosterUrl: profileHttpUrlSchema.nullable().optional(),
    videoIntroPosterStoragePath: profileVideoPosterStoragePathSchema.nullable().optional(),
    published: z.boolean(),
  })
  .strict();

const VERIFICATION_STATUSES = new Set(["none", "pending", "verified", "rejected"]);
const READINESS_TIERS = new Set(["seat_ready", "bid_ready", "procurement_ready"]);
const VIDEO_STATUSES = new Set(["processing", "ready", "failed"]);

const PUBLIC_STRING_FIELDS = [
  "businessName",
  "bio",
  "city",
  "state",
  "domain",
  "uei",
  "duns",
  "cageCode",
] as const;

const PUBLIC_HTTP_URL_FIELDS = [
  "website",
  "linkedin",
] as const;

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
] as const satisfies ReadonlyArray<{
  pathField: ProfileAssetStoragePathField;
  legacyUrlField: string;
}>;

const PUBLIC_STRING_ARRAY_FIELDS = [
  "naicsCodes",
  "certifications",
  "verifiedCertifications",
  "badges",
] as const;

const PUBLIC_NUMBER_FIELDS = [
  "profileCompletenessScore",
  "videoIntroDurationSec",
  "createdAt",
  "updatedAt",
] as const;

const PUBLIC_TRUST_STAT_FIELDS = [
  "referralsConverted",
  "payoutsPlatformManaged",
  "payoutsOnTimeRate",
  "medianResponseTimeHours",
  "disputesOpened",
  "disputesLost",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function sanitizeTrustStats(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized: Record<string, number> = {};
  for (const field of PUBLIC_TRUST_STAT_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      sanitized[field] = candidate;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/** Returns canonical path fields that are syntactically valid but owned by a different UID. */
export function getInvalidProfileAssetStoragePathFields(
  profileId: string,
  profile: Record<string, unknown>,
): ProfileAssetStoragePathField[] {
  return profileAssetStoragePathFields.filter((field) => {
    const storagePath = profile[field];
    return typeof storagePath === "string"
      && !profileAssetStoragePathBelongsToUid(field, storagePath, profileId);
  });
}

function isPublishableProfileAssetPath(
  pathField: ProfileAssetStoragePathField,
  storagePath: string,
): boolean {
  if (pathField === "videoIntroStoragePath") {
    return storagePath.split("/")[2] === "processed";
  }
  if (
    pathField === "videoIntroPosterStoragePath"
    && storagePath.startsWith("profileVideos/")
  ) {
    return storagePath.split("/")[2] === "posters";
  }
  return true;
}

/**
 * Produces the sole public representation of a private profile. Every key,
 * including nested trust statistics, is copied through an explicit allowlist.
 */
export function sanitizePublicProfile(
  profileId: string,
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const projection: Record<string, unknown> = {
    uid: profileId,
    published: true,
  };

  for (const field of PUBLIC_STRING_FIELDS) {
    if (typeof profile[field] === "string") projection[field] = profile[field];
  }
  for (const field of PUBLIC_HTTP_URL_FIELDS) {
    const parsed = httpUrlSchema.safeParse(profile[field]);
    if (parsed.success) projection[field] = parsed.data;
  }
  for (const { pathField, legacyUrlField } of PUBLIC_ASSET_FIELDS) {
    const storagePath = profile[pathField];
    if (
      typeof storagePath === "string"
      && profileAssetStoragePathBelongsToUid(pathField, storagePath, profileId)
      && isPublishableProfileAssetPath(pathField, storagePath)
    ) {
      projection[pathField] = storagePath;
      continue;
    }

    // Existing profiles may only have a Firebase download URL. Preserve that
    // read compatibility until the owner uploads a canonical path, but never
    // project both representations for newly migrated assets.
    const legacyUrl = httpUrlSchema.safeParse(profile[legacyUrlField]);
    if (legacyUrl.success) projection[legacyUrlField] = legacyUrl.data;
  }
  for (const field of PUBLIC_STRING_ARRAY_FIELDS) {
    const value = sanitizeStringArray(profile[field]);
    if (value !== undefined) projection[field] = value;
  }
  for (const field of PUBLIC_NUMBER_FIELDS) {
    const value = profile[field];
    if (typeof value === "number" && Number.isFinite(value)) projection[field] = value;
  }

  const trustStats = sanitizeTrustStats(profile.trustStats);
  if (trustStats) projection.trustStats = trustStats;
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
