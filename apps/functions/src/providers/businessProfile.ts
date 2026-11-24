/**
 * Business profile for every Hi Coworking account (renter screening, Nov 2026).
 *
 * Pure module with no Firebase imports, so the web forms (/register,
 * /preferences, guest checkout) and the server callables share one schema.
 *
 * Screening is about business use only and is applied the same way to every
 * renter. Nothing here asks about personal traits, and no ID image or ID
 * number is ever collected.
 *
 * Storage: accountDetails/{uid} (owner and staff can read; only the server
 * writes). The business name reuses the existing `company` field so values
 * saved before this change keep working. "None / independent" is stored as
 * `isIndependent: true` with an empty `company`.
 */

export const INDEPENDENT_LABEL = "None / independent";

export const BUSINESS_ROLES = ["owner", "employee", "contractor", "other"] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const BUSINESS_ROLE_LABELS: Record<BusinessRole, string> = {
  owner: "Owner",
  employee: "Employee",
  contractor: "Contractor",
  other: "Other",
};

export const BUSINESS_TYPES = [
  "professional_services",
  "technology",
  "creative_media",
  "real_estate",
  "finance_insurance",
  "health_wellness",
  "education_training",
  "trades_construction",
  "retail_ecommerce",
  "nonprofit_community",
  "government_military",
  "student",
  "other",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  professional_services: "Professional services",
  technology: "Technology & software",
  creative_media: "Creative & media",
  real_estate: "Real estate",
  finance_insurance: "Finance & insurance",
  health_wellness: "Health & wellness",
  education_training: "Education & training",
  trades_construction: "Trades & construction",
  retail_ecommerce: "Retail & e-commerce",
  nonprofit_community: "Nonprofit & community",
  government_military: "Government & military",
  student: "Student",
  other: "Other",
};

export const BUSINESS_LIMITS = {
  company: 120,
  businessDescription: 160,
  website: 200,
  vaSccNumber: 12,
} as const;

/** Fields the business profile form sends. All strings are trimmed server-side. */
export type BusinessProfileInput = {
  company?: unknown;
  isIndependent?: unknown;
  role?: unknown;
  businessType?: unknown;
  businessDescription?: unknown;
  website?: unknown;
  vaSccNumber?: unknown;
};

export type BusinessProfile = {
  /** Business name (existing field). Empty when isIndependent is true. */
  company: string;
  isIndependent: boolean;
  role: BusinessRole;
  businessType: BusinessType;
  businessDescription: string;
  /** Optional. Normalized to an https:// URL, or "" when not given. */
  website: string;
  /** Optional Virginia SCC entity ID (business registration, not a personal ID). */
  vaSccNumber: string;
};

export type BusinessProfileResult =
  | { ok: true; value: BusinessProfile }
  | { ok: false; field: keyof BusinessProfile; message: string };

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** True when the input carries the new business fields (vs. a legacy {company, phone} save). */
export function hasBusinessProfileInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const data = input as Record<string, unknown>;
  return ["isIndependent", "role", "businessType", "businessDescription", "website", "vaSccNumber"].some(
    (key) => data[key] !== undefined,
  );
}

export function normalizeWebsite(raw: unknown): string | null {
  const value = clean(raw);
  if (!value) return "";
  if (value.length > BUSINESS_LIMITS.website) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") || url.username || url.password) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Virginia SCC entity IDs are short letters and digits (e.g. S1234567). */
export function normalizeVaSccNumber(raw: unknown): string | null {
  const value = clean(raw).toUpperCase().replace(/\s+/g, "");
  if (!value) return "";
  return /^[A-Z0-9-]{4,12}$/.test(value) ? value : null;
}

export function validateBusinessProfile(input: BusinessProfileInput | null | undefined): BusinessProfileResult {
  const data = input || {};
  const isIndependent = data.isIndependent === true;
  const company = isIndependent ? "" : clean(data.company);
  if (!isIndependent && !company) {
    return { ok: false, field: "company", message: `Enter your business name, or choose "${INDEPENDENT_LABEL}".` };
  }
  if (company.length > BUSINESS_LIMITS.company) {
    return { ok: false, field: "company", message: "Use a shorter business name." };
  }
  const role = clean(data.role) as BusinessRole;
  if (!BUSINESS_ROLES.includes(role)) {
    return { ok: false, field: "role", message: "Choose your role." };
  }
  const businessType = clean(data.businessType) as BusinessType;
  if (!BUSINESS_TYPES.includes(businessType)) {
    return { ok: false, field: "businessType", message: "Choose a business type." };
  }
  const businessDescription = clean(data.businessDescription);
  if (!businessDescription) {
    return { ok: false, field: "businessDescription", message: "Add a short description of your work." };
  }
  if (businessDescription.length > BUSINESS_LIMITS.businessDescription) {
    return { ok: false, field: "businessDescription", message: `Keep the description under ${BUSINESS_LIMITS.businessDescription} characters.` };
  }
  const website = normalizeWebsite(data.website);
  if (website === null) {
    return { ok: false, field: "website", message: "Enter a website like example.com, or leave it blank." };
  }
  const vaSccNumber = normalizeVaSccNumber(data.vaSccNumber);
  if (vaSccNumber === null) {
    return { ok: false, field: "vaSccNumber", message: "Enter the SCC ID as letters and numbers (for example S1234567), or leave it blank." };
  }
  return { ok: true, value: { company, isIndependent, role, businessType, businessDescription, website, vaSccNumber } };
}

/** True when a stored accountDetails doc has every required business field. */
export function isBusinessProfileComplete(stored: unknown): boolean {
  if (!stored || typeof stored !== "object") return false;
  return validateBusinessProfile(stored as BusinessProfileInput).ok;
}

/** The business name to show staff: the company, or "None / independent". */
export function businessNameLabel(stored: { company?: unknown; isIndependent?: unknown } | null | undefined): string | null {
  if (!stored) return null;
  if (stored.isIndependent === true) return INDEPENDENT_LABEL;
  const company = clean(stored.company);
  return company || null;
}
