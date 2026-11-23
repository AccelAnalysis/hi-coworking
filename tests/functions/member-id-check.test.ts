import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: () => ({}),
  firestore: () => ({}),
}));

import {
  buildIdCheck,
  idCheckView,
  parseIdCheckInput,
  requireIdCheckStaff,
} from "../../apps/functions/src/memberIdCheck";

const source = readFileSync("apps/functions/src/memberIdCheck.ts", "utf8");
const caller = (role?: string) => ({ auth: { uid: "staff-1", token: role ? { role } : {} } }) as never;

describe("first-visit ID check: who can record it", () => {
  it("rejects signed-out callers and members", () => {
    expect(() => requireIdCheckStaff({ auth: undefined } as never)).toThrow(/Sign in/);
    for (const role of [undefined, "member", "externalVendor", "kiosk"]) {
      expect(() => requireIdCheckStaff(caller(role))).toThrow(/staff and admins/);
    }
  });

  it("allows staff, admin and master", () => {
    for (const role of ["staff", "admin", "master"]) expect(requireIdCheckStaff(caller(role))).toBe("staff-1");
  });

  it("checks the role before parsing input or touching Firestore", () => {
    const body = source.slice(source.indexOf("export const staff_setIdCheck"));
    const roleAt = body.indexOf("requireIdCheckStaff(request)");
    expect(roleAt).toBeGreaterThan(-1);
    expect(roleAt).toBeLessThan(body.indexOf("parseIdCheckInput("));
    expect(roleAt).toBeLessThan(body.indexOf("admin.firestore()"));
  });
});

describe("first-visit ID check: strict schema (never an image or ID number)", () => {
  it("accepts exactly uid, checked and staff initials", () => {
    expect(parseIdCheckInput({ uid: "member-a", checked: true, staffInitials: " jh " })).toEqual({ uid: "member-a", checked: true, staffInitials: "JH" });
    expect(parseIdCheckInput({ uid: "member-a", checked: false, staffInitials: "ABC" }).checked).toBe(false);
  });

  it.each([
    ["idImage", "data:image/png;base64,AAAA"],
    ["imageUrl", "https://example.com/id.jpg"],
    ["photoUrl", "https://example.com/id.jpg"],
    ["idNumber", "T1234567"],
    ["licenseNumber", "T1234567"],
    ["idType", "drivers_license"],
    ["dateOfBirth", "1990-01-01"],
    ["note", "looked fine"],
    ["checkedAt", 1],
    ["staffUid", "someone-else"],
  ])("rejects an extra %s field", (key, value) => {
    expect(() => parseIdCheckInput({ uid: "member-a", checked: true, staffInitials: "JH", [key]: value })).toThrow(/Only checked yes\/no and staff initials/);
  });

  it("requires a boolean and 2-4 letter initials", () => {
    expect(() => parseIdCheckInput({ uid: "member-a", checked: "yes", staffInitials: "JH" })).toThrow(/checked/);
    expect(() => parseIdCheckInput({ uid: "member-a", checked: true, staffInitials: "J" })).toThrow(/initials/);
    expect(() => parseIdCheckInput({ uid: "member-a", checked: true, staffInitials: "J1" })).toThrow(/initials/);
    expect(() => parseIdCheckInput({ uid: "member-a", checked: true, staffInitials: "https://x.co" })).toThrow(/initials/);
    expect(() => parseIdCheckInput({ uid: "a/b", checked: true, staffInitials: "JH" })).toThrow(/member id/);
    expect(() => parseIdCheckInput(null)).toThrow();
    expect(() => parseIdCheckInput([])).toThrow();
  });

  it("stores only checked, checkedAt, staffInitials and staffUid (server time and caller uid)", () => {
    const record = buildIdCheck({ checked: true, staffInitials: "JH" }, "staff-1", 1234);
    expect(record).toEqual({ checked: true, checkedAt: 1234, staffInitials: "JH", staffUid: "staff-1" });
    expect(source).toContain("tx.update(userRef, { idCheck, updatedAt: now })");
  });

  it("writes an audit row with status only", () => {
    expect(source).toMatch(/details: \{ toStatus: input\.checked \? "checked" : "not_checked" \}/);
  });

  it("does not gate bookings or touch door/Seam code", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from "\.\/access"|seam|createAccessGrant|bookingHolds|booking_/i);
  });

  it("returns a minimal view and drops stray fields", () => {
    expect(idCheckView({ checked: true, checkedAt: 5, staffInitials: "JH", staffUid: "s", idNumber: "X" })).toEqual({ checked: true, checkedAt: 5, staffInitials: "JH" });
    expect(idCheckView(undefined)).toBeNull();
  });
});

describe("first-visit ID check: deploy and visibility", () => {
  it("ships in the front-desk-kiosk bundle and the emulator entry", () => {
    expect(readFileSync("firebase/front-desk-kiosk-functions/src/index.ts", "utf8")).toContain('export { staff_setIdCheck } from "../../../apps/functions/src/memberIdCheck";');
    expect(readFileSync("apps/functions/src/main.ts", "utf8")).toContain('export { staff_setIdCheck } from "./memberIdCheck";');
  });

  it("shows on the Admin member record (admin-only) via admin_memberRecordGet", () => {
    expect(readFileSync("apps/functions/src/adminMemberRecord.ts", "utf8")).toContain("idCheck: idCheckView(user.idCheck)");
    const page = readFileSync("apps/web/src/app/admin/members/record/page.tsx", "utf8");
    expect(page).toContain('<RequireAuth requiredRole="admin">');
    expect(page).toContain("First-visit ID check");
    expect(page).toContain("<IdCheckSheet");
    const desk = readFileSync("apps/web/src/app/admin/front-desk/page.tsx", "utf8");
    expect(desk).toContain('<RequireAuth requiredRole="staff">');
    expect(desk).toContain("onIdCheck={() => setIdChecking(visit)}");
  });

  it("never appears on customer-facing pages", () => {
    const root = "apps/web/src";
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?)$/.test(name)) files.push(full);
      }
    };
    walk(root);
    const allowed = [
      "apps/web/src/app/admin/",
      "apps/web/src/components/admin/IdCheckSheet.tsx",
      "apps/web/src/lib/idCheck.ts",
    ];
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /idCheck|IdCheck|staff_setIdCheck/.test(text) && !allowed.some((prefix) => file.startsWith(prefix));
    });
    expect(offenders).toEqual([]);
  });

  it("has no ID number, image or note input in the staff sheet", () => {
    const sheet = readFileSync("apps/web/src/components/admin/IdCheckSheet.tsx", "utf8");
    expect(sheet).not.toMatch(/type="file"|textarea|capture=|getUserMedia/);
    expect(sheet.match(/<input/g)?.length).toBe(1);
  });

  it("keeps idCheck out of member-writable fields in firestore.rules", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    expect(rules).not.toContain("idCheck");
    expect(rules).toContain('.hasOnly(["displayName", "membershipTrack", "updatedAt"])');
  });
});
