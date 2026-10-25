import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../../apps/web/src", p), "utf8");

describe("admin member record pages (audit P1-5/P1-11)", () => {
  const record = read("app/admin/members/record/page.tsx");
  const consent = read("app/admin/members/consent/page.tsx");

  it("are admin-only and read through the admin callables, not Firestore", () => {
    for (const page of [record, consent]) {
      expect(page).toContain('<RequireAuth requiredRole="admin">');
      expect(page).not.toMatch(/from "firebase\/firestore"|@\/lib\/firestore/);
      expect(page).toContain('role="alert"');
    }
    expect(record).toContain('"admin_memberRecordGet"');
    expect(consent).toContain('"admin_consentList"');
  });

  it("keeps the consent list free of phone numbers", () => {
    expect(consent).not.toMatch(/phone/i);
  });

  it("is linked from the members page", () => {
    const members = read("app/admin/members/page.tsx");
    expect(members).toContain("/admin/members/record?uid=");
    expect(members).toContain('"/admin/members/consent"');
  });
});
