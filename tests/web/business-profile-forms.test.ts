import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("business profile on Create your account", () => {
  const register = read("apps/web/src/app/register/page.tsx");

  it("renders the shared business fields and validates them before creating the account", () => {
    expect(register).toContain("<BusinessProfileFields");
    expect(register).toContain("validateBusinessProfile(business)");
    expect(register.indexOf("validateBusinessProfile(business)")).toBeLessThan(register.indexOf("createUserWithEmailAndPassword("));
    expect(register).toContain("await saveAccountDetails({ ...business, phone });");
  });

  it("drops the old optional company input (no duplicate business-name field)", () => {
    expect(register).not.toContain("Company name (optional)");
    expect(register).not.toContain("setCompany");
  });

  it("uses the wider two-column layout on desktop", () => {
    expect(register).toContain('"max-w-3xl"');
    expect(register).toContain("sm:grid-cols-2");
  });
});

describe("shared business fields component", () => {
  const fields = read("apps/web/src/components/account/BusinessProfileFields.tsx");

  it("offers None / independent, required role and type, and optional website and SCC ID", () => {
    expect(fields).toContain("INDEPENDENT_LABEL");
    expect(fields).toContain('role="radiogroup"');
    expect(fields).toContain('aria-required="true"');
    expect(fields).toMatch(/id=\{id\("type"\)\}\s+required/);
    expect(fields).toMatch(/id=\{id\("description"\)\}\s+type="text"\s+required/);
    expect(fields).toContain("(optional)");
  });

  it("keeps touch targets at 44px and labels every input", () => {
    expect(fields.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    for (const name of ["company", "independent", "type", "description", "website", "scc"]) {
      expect(fields).toContain(`htmlFor={id("${name}")}`);
    }
  });

  it("never asks for ID images or ID numbers", () => {
    expect(fields).not.toMatch(/type="file"|driver|passport|license number|idNumber/i);
  });
});

describe("existing members are prompted, never blocked", () => {
  it("adds an editable business section to /preferences", () => {
    const prefs = read("apps/web/src/app/preferences/page.tsx");
    expect(prefs).toContain('id="business"');
    expect(prefs).toContain("<BusinessProfileSection />");
    expect(prefs).toContain('getDoc(doc(db, "accountDetails", user.uid))');
    expect(prefs).toContain("saveAccountDetails({ ...draft, phone })");
    expect(prefs).toContain("Finish your business profile");
  });

  it("links SayHi to the profile when it is incomplete", () => {
    const sayhi = read("apps/web/src/app/account/bookings/page.tsx");
    expect(sayhi).toContain('href="/preferences#business"');
    expect(sayhi).toContain("isBusinessProfileComplete(snap.data())");
  });

  it("does not gate login on the business profile", () => {
    const login = read("apps/web/src/app/login/page.tsx");
    expect(login).not.toMatch(/businessProfile|isBusinessProfileComplete/);
  });
});

describe("Admin member record shows the business profile", () => {
  const page = read("apps/web/src/app/admin/members/record/page.tsx");
  it("renders every business field", () => {
    for (const label of ["Business name", "Role", "Business type", "What they do", "Website", "Virginia SCC ID"]) {
      expect(page).toContain(`label="${label}"`);
    }
    expect(page).toContain('rel="noopener noreferrer nofollow"');
  });
});
