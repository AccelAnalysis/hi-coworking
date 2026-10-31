import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accessReadyMail,
  accessReadyNotification,
  containsDoorCode,
  ownerMaySeeCode,
  SAYHI_PATH,
} from "../../apps/functions/src/accessCodes/policy";

const NOW = Date.UTC(2026, 10, 20, 15);
const HOUR = 60 * 60 * 1000;
const grant = { userId: "member-a", status: "active", endsAt: NOW + 2 * HOUR };
const code = { status: "active" };

describe("who can see a door code", () => {
  it("shows the full code to its owner while the booking is live", () => {
    expect(ownerMaySeeCode({ requesterUid: "member-a", grant, code, now: NOW })).toBe(true);
    expect(ownerMaySeeCode({ requesterUid: "member-a", grant: { ...grant, status: "pending" }, code: { status: "programming" }, now: NOW })).toBe(true);
  });

  it("never shows it to anyone else, including staff", () => {
    expect(ownerMaySeeCode({ requesterUid: "member-b", grant, code, now: NOW })).toBe(false);
    expect(ownerMaySeeCode({ requesterUid: "staff-a", grant, code, now: NOW })).toBe(false);
    expect(ownerMaySeeCode({ requesterUid: null, grant, code, now: NOW })).toBe(false);
  });

  it("hides cancelled, revoked, failed and past codes", () => {
    for (const status of ["revoked", "expired", "failed", "cancelled"]) {
      expect(ownerMaySeeCode({ requesterUid: "member-a", grant: { ...grant, status }, code, now: NOW })).toBe(false);
    }
    for (const status of ["removed", "failed", "pending_removal"]) {
      expect(ownerMaySeeCode({ requesterUid: "member-a", grant, code: { status }, now: NOW })).toBe(false);
    }
    expect(ownerMaySeeCode({ requesterUid: "member-a", grant, code, now: NOW + 2 * HOUR })).toBe(false);
    expect(ownerMaySeeCode({ requesterUid: "member-a", grant, code: null, now: NOW })).toBe(false);
  });
});

describe("no door code in emails or notifications", () => {
  const input = { bookingId: "booking-1", doorName: "Front door", startsAt: NOW, endsAt: NOW + 2 * HOUR };

  it("says the code is ready on SayHi and links there, with no code or digits", () => {
    const notice = accessReadyNotification(input);
    expect(notice.title).toBe("Your access code is ready");
    expect(notice.body).toMatch(/SayHi page/);
    expect(notice.linkTo).toBe(SAYHI_PATH);
    expect(SAYHI_PATH).toBe("/my-hi");
    const mail = accessReadyMail({ ...input, origin: "https://example.test/" });
    expect(mail.template).toBe("access_code_ready");
    expect(mail.data.sayHiUrl).toBe("https://example.test/my-hi");
    expect(Object.keys(mail.data)).not.toContain("pin");
    expect(Object.keys(mail.data)).not.toContain("codeLast2");
    expect(containsDoorCode({ notice, mail }, "482193")).toBe(false);
  });

  it("access.ts never writes a PIN into a notification or the mail queue", () => {
    const source = readFileSync(resolve("apps/functions/src/access.ts"), "utf8");
    expect(source).not.toMatch(/sendPinNotification/);
    expect(source).not.toMatch(/Code: \$\{/);
    expect(source).not.toMatch(/access_pin_issued/);
    expect(source).not.toMatch(/\bpin,\s*\n?\s*codeLast2/);
    expect(source).not.toMatch(/data:\s*\{[^}]*\bpin\b/);
    expect(source).not.toMatch(/ends in ••/);
    expect(source).not.toMatch(/\/dashboard\/access/);
    // The full code is read from Seam for its owner only, and checked against the stored hash.
    expect(source).toMatch(/ownerMaySeeCode\(/);
    expect(source).toMatch(/hashPin\(pin\) !== input\.code\.codeHash/);
    // Door unlock check-in only for signature-verified webhook events.
    expect(source).toMatch(/event_type === "lock\.unlocked" && verified/);
  });

  it("member emails carry no door code", () => {
    for (const file of ["apps/functions/src/payments/membershipWelcomeEmail.ts", "apps/functions/src/payments/memberNoticeEmails.ts"]) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toMatch(/\b(pin|accessCode|doorCode)\b/i);
    }
  });
});
