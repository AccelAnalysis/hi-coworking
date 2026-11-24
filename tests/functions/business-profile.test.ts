import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: () => ({}),
  firestore: () => ({}),
}));

import {
  BUSINESS_ROLES,
  BUSINESS_TYPES,
  INDEPENDENT_LABEL,
  businessNameLabel,
  hasBusinessProfileInput,
  isBusinessProfileComplete,
  normalizeVaSccNumber,
  normalizeWebsite,
  validateBusinessProfile,
} from "../../apps/functions/src/providers/businessProfile";
import { normalizeAccountDetails } from "../../apps/functions/src/sayhi/functions";
import { businessView } from "../../apps/functions/src/adminMemberRecord";

const read = (path: string) => readFileSync(path, "utf8");

const VALID = {
  company: "  Sample   Studio LLC ",
  isIndependent: false,
  role: "owner",
  businessType: "creative_media",
  businessDescription: "  Brand design for small shops ",
  website: "example.com",
  vaSccNumber: "s1234567",
};

describe("business profile schema (renter screening)", () => {
  it("normalizes a full profile and reuses the existing company field", () => {
    const result = validateBusinessProfile(VALID);
    expect(result).toEqual({
      ok: true,
      value: {
        company: "Sample Studio LLC",
        isIndependent: false,
        role: "owner",
        businessType: "creative_media",
        businessDescription: "Brand design for small shops",
        website: "https://example.com",
        vaSccNumber: "S1234567",
      },
    });
  });

  it("accepts None / independent with an empty business name", () => {
    const result = validateBusinessProfile({ ...VALID, company: "ignored", isIndependent: true });
    expect(result.ok && result.value.company).toBe("");
    expect(result.ok && result.value.isIndependent).toBe(true);
    expect(businessNameLabel({ isIndependent: true, company: "" })).toBe(INDEPENDENT_LABEL);
    expect(INDEPENDENT_LABEL).toBe("None / independent");
  });

  it("requires business name, role, type and description", () => {
    expect(validateBusinessProfile({ ...VALID, company: " " })).toMatchObject({ ok: false, field: "company" });
    expect(validateBusinessProfile({ ...VALID, role: "boss" })).toMatchObject({ ok: false, field: "role" });
    expect(validateBusinessProfile({ ...VALID, role: undefined })).toMatchObject({ ok: false, field: "role" });
    expect(validateBusinessProfile({ ...VALID, businessType: "" })).toMatchObject({ ok: false, field: "businessType" });
    expect(validateBusinessProfile({ ...VALID, businessDescription: "" })).toMatchObject({ ok: false, field: "businessDescription" });
    expect(validateBusinessProfile({ ...VALID, businessDescription: "x".repeat(161) })).toMatchObject({ ok: false, field: "businessDescription" });
    expect(validateBusinessProfile({ ...VALID, company: "x".repeat(121) })).toMatchObject({ ok: false, field: "company" });
  });

  it("only offers the four roles Jonathan approved", () => {
    expect([...BUSINESS_ROLES]).toEqual(["owner", "employee", "contractor", "other"]);
    expect(BUSINESS_TYPES).toContain("other");
  });

  it("keeps website and SCC ID optional but well-formed", () => {
    expect(normalizeWebsite("")).toBe("");
    expect(normalizeWebsite("https://shop.example.org/about")).toBe("https://shop.example.org/about");
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsite("not a site")).toBeNull();
    expect(normalizeWebsite("https://user:pw@example.com")).toBeNull();
    expect(normalizeVaSccNumber("")).toBe("");
    expect(normalizeVaSccNumber("12-34567")).toBe("12-34567");
    expect(normalizeVaSccNumber("<script>")).toBeNull();
    expect(validateBusinessProfile({ ...VALID, website: "", vaSccNumber: "" }).ok).toBe(true);
    expect(validateBusinessProfile({ ...VALID, website: "ftp://x" })).toMatchObject({ ok: false, field: "website" });
  });

  it("asks about business use only (no personal traits, no ID numbers)", () => {
    const source = read("apps/functions/src/providers/businessProfile.ts");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(age|birth|dob|gender|race|religion|nationality|ssn|license|passport|driver|idNumber|idImage)\b/i);
  });

  it("detects legacy saves vs. business-profile saves", () => {
    expect(hasBusinessProfileInput({ company: "A", phone: "5550100199" })).toBe(false);
    expect(hasBusinessProfileInput({ role: "owner" })).toBe(true);
    expect(isBusinessProfileComplete({ company: "Legacy Co", phone: "+15550100199" })).toBe(false);
    expect(isBusinessProfileComplete({ ...VALID })).toBe(true);
  });
});

describe("members_saveAccountDetails normalization", () => {
  it("keeps the legacy {company, phone} save working for existing clients", () => {
    expect(normalizeAccountDetails({ company: " Old  Co ", phone: "5550100199" })).toEqual({ company: "Old Co", phone: "+15550100199" });
  });

  it("validates the full business profile when the new fields are sent", () => {
    expect(normalizeAccountDetails({ ...VALID, phone: "(555) 010-0199" })).toEqual({
      company: "Sample Studio LLC",
      isIndependent: false,
      role: "owner",
      businessType: "creative_media",
      businessDescription: "Brand design for small shops",
      website: "https://example.com",
      vaSccNumber: "S1234567",
      phone: "+15550100199",
    });
    expect(() => normalizeAccountDetails({ ...VALID, role: "", phone: "5550100199" })).toThrow(/role/i);
    expect(() => normalizeAccountDetails({ ...VALID, phone: "123" })).toThrow(/10-digit/);
  });

  it("strips unknown keys so nothing else lands in accountDetails", () => {
    const saved = normalizeAccountDetails({ ...VALID, phone: "5550100199", idNumber: "X", idImageUrl: "https://x", role: "owner" });
    expect(Object.keys(saved).sort()).toEqual(
      ["businessDescription", "businessType", "company", "isIndependent", "phone", "role", "vaSccNumber", "website"],
    );
  });

  it("writes accountDetails server-side with merge and stamps businessProfileUpdatedAt", () => {
    const source = read("apps/functions/src/sayhi/functions.ts");
    expect(source).toContain("collection(ACCOUNT_DETAILS_COLLECTION).doc(request.auth.uid).set(");
    expect(source).toContain("{ merge: true }");
    expect(source).toContain("businessProfileUpdatedAt: now");
  });
});

describe("admin member record business view", () => {
  it("shows labels and leaves billing address and unknown fields out", () => {
    const view = businessView({
      ...VALID,
      company: "Sample Studio LLC",
      website: "https://example.com",
      phone: "+15550100199",
      billingAddress: { line1: "1 Main St" },
      businessProfileUpdatedAt: 99,
    });
    expect(view).toEqual({
      businessName: "Sample Studio LLC",
      isIndependent: false,
      role: "Owner",
      businessType: "Creative & media",
      businessDescription: "  Brand design for small shops".trim(),
      website: "https://example.com",
      vaSccNumber: "s1234567",
      phone: "+15550100199",
      complete: true,
      updatedAt: 99,
    });
    expect(JSON.stringify(view)).not.toContain("Main St");
    expect(businessView(null)).toBeNull();
    expect(businessView({ company: "Legacy Co" })).toMatchObject({ businessName: "Legacy Co", complete: false, role: null });
  });

  it("reads accountDetails in the admin-only callable", () => {
    const source = read("apps/functions/src/adminMemberRecord.ts");
    const body = source.slice(source.indexOf("export const admin_memberRecordGet"));
    expect(body.indexOf("requireAdminCaller(request)")).toBeLessThan(body.indexOf('collection("accountDetails")'));
    expect(body).toContain("business: businessView(");
  });
});

describe("accountDetails access stays server-written", () => {
  it("keeps client writes off and reads limited to the owner and staff/admin", () => {
    const rules = read("firestore.rules");
    expect(rules).toMatch(/match \/accountDetails\/\{uid\} \{\s*allow read: if isOwner\(uid\) \|\| isStaff\(\);\s*allow write: if false;/);
  });
});
