import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const CALLABLES = [
  "kiosk_session",
  "kiosk_lookupMember",
  "kiosk_checkIn",
  "kiosk_checkOut",
  "admin_kioskOverview",
  "admin_kioskCloseVisit",
  "admin_kioskResolveAlert",
  "admin_kioskSetSettings",
  "admin_kioskDeviceSet",
  "members_kioskSummary",
];
const COLLECTIONS = [
  "kioskVisits",
  "kioskOpenVisits",
  "kioskAlerts",
  "kioskBookingFlags",
  "kioskRequests",
  "kioskLookups",
  "kioskRateLimits",
  "kioskDevices",
  "kioskSettings",
  "kioskMemberCodes",
  "kioskCodeIndex",
];

describe("front-desk kiosk functions source", () => {
  const src = read("apps/functions/src/frontDeskKiosk/functions.ts");

  it("declares every callable with the shared CORS allowlist options", () => {
    for (const name of CALLABLES) {
      expect(src).toContain(`export const ${name} = onCall(adminEventCallableOptions,`);
    }
  });

  it("has exactly one scheduled function (one Cloud Scheduler job)", () => {
    expect(src.match(/onSchedule\(/g)?.length).toBe(1);
    expect(src).toContain('schedule: "*/15 8-18 * * 1-5", timeZone: "America/New_York"');
  });

  it("refuses staff accounts and unenrolled devices as kiosks", () => {
    expect(src).toContain("auth.token?.kiosk !== true");
    expect(src).toContain("Staff accounts can't be used as a kiosk.");
    expect(src).toContain("This kiosk isn't enrolled. Please see staff.");
  });

  it("records overage but never charges", () => {
    expect(src).toContain('chargeStatus: "not_charged"');
    expect(src).not.toMatch(/stripe\.(charges|paymentIntents|invoices|invoiceItems)/i);
    expect(src).not.toMatch(/from "stripe"/);
  });

  it("sends no email or SMS from the kiosk paths", () => {
    expect(src).not.toMatch(/sendEmail|sendSms|resend|twilio|nurture/i);
  });

  it("writes memberOperationAudit when staff close a visit", () => {
    expect(src).toContain("memberOperationAudit");
  });

  it("exports the same functions from the codebase index, the isolated bundle and main.ts", () => {
    const names = [...CALLABLES, "kiosk_attendanceSweep"];
    const index = read("apps/functions/src/frontDeskKiosk/index.ts");
    const bundle = read("firebase/front-desk-kiosk-functions/src/index.ts");
    const main = read("apps/functions/src/main.ts");
    for (const name of names) {
      expect(index).toContain(name);
      expect(bundle).toContain(name);
      expect(main).toContain(name);
    }
  });

  it("keeps the isolated bundle secret-free", () => {
    const bundle = read("firebase/front-desk-kiosk-functions/src/index.ts");
    expect(bundle).not.toMatch(/from "\.\.\/\.\.\/\.\.\/apps\/functions\/src\/(main|index|eventMarketing|smsProvider)"/);
    expect(src).not.toMatch(/defineSecret/);
    const config = JSON.parse(read("firebase.front-desk-kiosk.json"));
    expect(config.functions[0].codebase).toBe("front-desk-kiosk");
  });

  it("deploys only the front-desk-kiosk codebase from its workflow", () => {
    const workflow = read(".github/workflows/firebase-live-front-desk-kiosk.yml");
    expect(workflow).toContain("--only functions:front-desk-kiosk");
    expect(workflow).not.toContain("--force");
    expect(workflow).not.toContain("firestore:indexes");
  });

  it("denies all client access to the kiosk collections in firestore.rules", () => {
    const rules = read("firestore.rules");
    for (const name of COLLECTIONS) {
      const block = rules.match(new RegExp(`match /${name}/\\{docId\\} \\{([^}]*)\\}`));
      expect(block, name).not.toBeNull();
      expect(block![1]).toMatch(/allow read, write: if false;/);
    }
  });
});
