import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { DOOR_CODE_LENGTH, timeBoundCodeRequest } from "../../apps/functions/src/providers/seamProvider";
import {
  DEFAULT_BUFFER_MINUTES,
  codeWindow,
  parseDoorAccessSettings,
  pickDoor,
} from "../../apps/functions/src/accessCodes/doorSettings";
import {
  DEFAULT_DOOR_ALERT_TO,
  STAFF_ALERT_TEMPLATE,
  buildStaffAlertEvent,
  buildStaffAlertMail,
  isLowBattery,
  safeReason,
  staffAlertId,
  staffAlertRecipients,
} from "../../apps/functions/src/accessCodes/staffAlerts";
import { internalEventTypeFor, seamCodeStatusFor, staffAlertKindForSeamEvent } from "../../apps/functions/src/accessCodes/noShow";
import { requestRefundRevokes, shouldRevokeForRefund, type RefundRevokeStore } from "../../apps/functions/src/accessCodes/refundRevoke";
import { retryDecision } from "../../apps/functions/src/accessCodes/policy";
import { claimDecision, processMailDoc, renderStaffAlertEmail, type MailDoc, type MailQueueStore } from "../../apps/functions/src/accessCodes/accessReadyEmail";
import type { EmailMessage, EmailProvider } from "../../apps/functions/src/providers/emailProvider";
// @ts-expect-error plain ESM script without types
import { DOOR_RESOURCE_IDS, DEVICE_ID, WEBHOOK_URL, DEAD_WEBHOOK_URL, doorRecord } from "../../scripts/door-access-go-live.mjs";

const NOW = Date.UTC(2026, 10, 25, 15, 0); // Nov 25, 2026 10:00 AM ET
const read = (p: string) => readFileSync(p, "utf8");

describe("Seam code request", () => {
  it("asks for a 6-digit time-bound code and drops the undocumented `type` field", () => {
    const body = timeBoundCodeRequest("dev-1", new Date(NOW), new Date(NOW + 3_600_000), "HiCo-abc123");
    expect(DOOR_CODE_LENGTH).toBe(6);
    expect(body).toEqual({
      device_id: "dev-1",
      name: "HiCo-abc123",
      starts_at: new Date(NOW).toISOString(),
      ends_at: new Date(NOW + 3_600_000).toISOString(),
      preferred_code_length: 6,
    });
    expect(body).not.toHaveProperty("type");
    expect(body).not.toHaveProperty("code"); // Seam picks the digits; no clash with codes on the lock
  });

  it("never deletes codes it didn't make: revoke only uses stored seamCodeIds", () => {
    const access = read("apps/functions/src/access.ts");
    expect(access).not.toMatch(/access_codes\/list/);
    expect(access).toContain('.where("grantId", "==", grantId)');
  });
});

describe("code window buffer", () => {
  it("defaults to 15 minutes before and after", () => {
    expect(DEFAULT_BUFFER_MINUTES).toBe(15);
    expect(parseDoorAccessSettings(undefined)).toEqual({ bufferMinutes: 15 });
    expect(codeWindow(NOW, NOW + 3_600_000, 15)).toEqual({ startsAt: NOW - 900_000, endsAt: NOW + 3_600_000 + 900_000 });
  });
  it("uses the staff setting and rejects bad values", () => {
    expect(parseDoorAccessSettings({ bufferMinutes: 10 })).toEqual({ bufferMinutes: 10 });
    expect(parseDoorAccessSettings({ bufferMinutes: 0 })).toEqual({ bufferMinutes: 0 });
    expect(parseDoorAccessSettings({ bufferMinutes: -5 })).toEqual({ bufferMinutes: 15 });
    expect(parseDoorAccessSettings({ bufferMinutes: 600 })).toEqual({ bufferMinutes: 15 });
    expect(parseDoorAccessSettings({ bufferMinutes: "nope" })).toEqual({ bufferMinutes: 15 });
  });
  it("picks a live door with a lock", () => {
    expect(pickDoor([{ id: "a", data: { status: "archived", seamDeviceId: "x" } }, { id: "b", data: { status: "online", seamDeviceId: "y" } }])?.id).toBe("b");
    expect(pickDoor([{ id: "a", data: { status: "online", seamDeviceId: "" } }])).toBeNull();
  });
});

describe("staff alerts", () => {
  const base = { doorId: "floor-entrance", doorName: "Floor Entrance", bookingId: "bookingABC123", grantId: "grantXYZ", now: NOW };

  it("go to Jonathan and the team inbox by default, or the DOOR_ALERT_TO list", () => {
    expect(staffAlertRecipients({})).toEqual([...DEFAULT_DOOR_ALERT_TO]);
    expect(DEFAULT_DOOR_ALERT_TO).toContain("jholman@accelanalysis.com");
    expect(staffAlertRecipients({ DOOR_ALERT_TO: "a@x.com, B@Y.com,bad" })).toEqual(["a@x.com", "b@y.com"]);
  });

  it("never carry a door code or digits of one", () => {
    expect(safeReason("Seam API 400 (invalid_input) code 482193")).toBe("Seam API 400 (invalid_input) code ••••");
    const mail = buildStaffAlertMail({ ...base, kind: "code_failed", reason: "pin 123456", startsAt: NOW, endsAt: NOW + 3_600_000 });
    expect(JSON.stringify(mail)).not.toMatch(/123456/);
    expect(mail.template).toBe(STAFF_ALERT_TEMPLATE);
    expect(mail).not.toHaveProperty("to");
    expect(mail.toStaff).toBe(true);
    const event = buildStaffAlertEvent({ ...base, kind: "code_failed", reason: "pin 123456" });
    expect(JSON.stringify(event)).not.toMatch(/123456/);
    expect(event).toMatchObject({ eventType: "staff_alert", alertKind: "code_failed", alertStatus: "open", bookingId: "bookingABC123" });
  });

  it("dedupe per grant for code alerts and per door per day for lock alerts", () => {
    expect(staffAlertId({ ...base, kind: "code_failed" })).toBe("alert_code_failed_grantXYZ");
    expect(staffAlertId({ kind: "lock_offline", doorId: "floor-entrance", now: NOW })).toBe("alert_lock_offline_floor-entrance_2026-11-25");
    expect(staffAlertId({ kind: "low_battery", doorId: "floor-entrance", now: NOW + 86_400_000 })).toBe("alert_low_battery_floor-entrance_2026-11-26");
  });

  it("flag low battery from Seam's event or a reading under 20%", () => {
    expect(isLowBattery(0.15)).toBe(true);
    expect(isLowBattery(0.5)).toBe(false);
    expect(isLowBattery(0.5, "low")).toBe(true);
    expect(isLowBattery(undefined)).toBe(false);
  });

  it("map Seam events to alerts; the lock's own codes are ignored", () => {
    expect(staffAlertKindForSeamEvent("access_code.failed_to_set_on_device")).toBe("code_failed");
    expect(staffAlertKindForSeamEvent("access_code.delay_in_setting_on_device")).toBe("code_delayed");
    expect(staffAlertKindForSeamEvent("access_code.failed_to_remove_from_device")).toBe("code_remove_failed");
    expect(staffAlertKindForSeamEvent("access_code.delay_in_removing_from_device")).toBe("code_remove_failed");
    expect(staffAlertKindForSeamEvent("access_code.modified_external_to_seam")).toBe("code_changed_outside");
    expect(staffAlertKindForSeamEvent("access_code.deleted_external_to_seam")).toBe("code_changed_outside");
    expect(staffAlertKindForSeamEvent("device.disconnected")).toBe("lock_offline");
    expect(staffAlertKindForSeamEvent("device.low_battery")).toBe("low_battery");
    expect(staffAlertKindForSeamEvent("access_code.unmanaged.created")).toBeUndefined();
    expect(staffAlertKindForSeamEvent("access_code.unmanaged.removed")).toBeUndefined();
    expect(seamCodeStatusFor("access_code.deleted_external_to_seam")).toBe("revoked");
    expect(internalEventTypeFor("device.low_battery")).toBe("low_battery");
    expect(internalEventTypeFor("access_code.delay_in_setting_on_device")).toBe("code_delayed");
  });

  it("webhook handler only raises code alerts for codes this system made", () => {
    const access = read("apps/functions/src/access.ts");
    expect(access).toContain("(!isCodeAlert || codeRef)");
  });
});

describe("staff alert email", () => {
  function store(docs: Record<string, MailDoc>) {
    const s: MailQueueStore & { docs: Record<string, MailDoc> } = {
      docs,
      async claim(id, now) {
        const doc = docs[id];
        if (!doc || claimDecision(doc, now) !== "claim") return null;
        docs[id] = { ...doc, status: "sending", claimedAt: now, attempts: Number(doc.attempts || 0) + 1 };
        return { doc };
      },
      async resolveEmail() { throw new Error("staff alerts never resolve a member address"); },
      async finish(id, update) { docs[id] = { ...docs[id], ...update }; },
    };
    return s;
  }
  const provider = () => {
    const sent: EmailMessage[] = [];
    const p: EmailProvider & { sent: EmailMessage[] } = { sent, async send(m) { sent.push(m); return { messageId: `m${sent.length}` }; } };
    return p;
  };

  it("sends one email per staff recipient from the fixed list, ignoring any `to` on the doc", async () => {
    const mail = buildStaffAlertMail({ kind: "lock_offline", doorId: "floor-entrance", doorName: "Floor Entrance", now: NOW });
    const docs: Record<string, MailDoc> = { a: { ...mail, to: "attacker@example.com", status: "pending", attempts: 0, createdAt: NOW - 1000 } };
    const p = provider();
    const outcome = await processMailDoc("a", store(docs), p, () => NOW);
    expect(outcome).toBe("sent");
    expect(p.sent.map((m) => m.to)).toEqual(staffAlertRecipients());
    expect(p.sent[0].subject).toBe("Door alert: The door lock is offline");
    expect(p.sent[0].idempotencyKey).toBe("mail/a/0");
  });

  it("renders without digits and links only to Admin", () => {
    const copy = renderStaffAlertEmail({ title: "A door code could not be set", rows: ["Booking: #abc123"], adminUrl: "https://evil.example.com" });
    expect(copy.html).toContain("https://hi-coworking.com/admin/access");
    expect(copy.html).not.toContain("evil.example.com");
  });
});

describe("refund removes the booking's code", () => {
  it("only for a fully refunded booking payment", () => {
    expect(shouldRevokeForRefund({ purpose: "booking", status: "refunded" })).toBe(true);
    expect(shouldRevokeForRefund({ purpose: "booking", status: "paid" })).toBe(false); // partial refund keeps the code
    expect(shouldRevokeForRefund({ purpose: "membership", status: "refunded" })).toBe(false);
    expect(shouldRevokeForRefund({ purpose: "event", status: "refunded" })).toBe(false);
  });

  it("marks every live grant of the payment's bookings", async () => {
    const requested: Array<[string, Record<string, unknown>]> = [];
    const fake: RefundRevokeStore = {
      async bookingIdsForPayment(id) { return id === "pay1" ? ["b1", "b2"] : []; },
      async liveGrantIdsForBooking(id) { return id === "b1" ? ["g1"] : id === "b2" ? ["g2", "g3"] : []; },
      async requestRevoke(id, update) { requested.push([id, update]); },
    };
    expect(await requestRefundRevokes(fake, "pay1", NOW)).toBe(3);
    expect(requested.map(([id]) => id)).toEqual(["g1", "g2", "g3"]);
    expect(requested[0][1]).toMatchObject({ revokeRequestedAt: NOW, revokeRequestReason: "refund" });
  });

  it("is wired into the Stripe refund handler without loading the Seam module", () => {
    const handler = read("apps/functions/src/payments/stripeRefundHandler.ts");
    expect(handler).toContain("requestRefundRevokes(firestoreRefundRevokeStore(db), paymentRef.id");
    expect(handler).not.toContain('from "../access"');
    expect(read("apps/functions/src/accessCodes/refundRevoke.ts")).not.toMatch(/from "\.\.\/access"|seamProvider/);
  });
});

describe("staff Retry code", () => {
  it("is allowed only for a live booking without a working code", () => {
    expect(retryDecision({ grant: { status: "pending", endsAt: NOW + 1 }, latestCodeStatus: "failed", now: NOW })).toBe("retry");
    expect(retryDecision({ grant: { status: "active", endsAt: NOW + 1 }, latestCodeStatus: "revoked", now: NOW })).toBe("retry");
    expect(retryDecision({ grant: { status: "pending", endsAt: NOW + 1 }, latestCodeStatus: undefined, now: NOW })).toBe("retry");
    expect(retryDecision({ grant: { status: "active", endsAt: NOW + 1 }, latestCodeStatus: "active", now: NOW })).toBe("working");
    expect(retryDecision({ grant: { status: "active", endsAt: NOW + 1 }, latestCodeStatus: "programming", now: NOW })).toBe("working");
    expect(retryDecision({ grant: { status: "revoked", endsAt: NOW + 1 }, latestCodeStatus: "failed", now: NOW })).toBe("ended");
    expect(retryDecision({ grant: { status: "active", endsAt: NOW - 1 }, latestCodeStatus: "failed", now: NOW })).toBe("ended");
  });

  it("is on Admin > Access as an icon button", () => {
    const page = read("apps/web/src/app/admin/access/page.tsx");
    expect(page).toContain("accessAdminRetryCodeFn");
    expect(page).toContain('aria-label="Retry code"');
    expect(page).toContain("<RotateCw");
    expect(page).toContain("setDoorAccessBufferMinutes");
  });
});

describe("admin resend never passes code digits", () => {
  it("drops codeLast2 from the resend path and the member's grant list", () => {
    const access = read("apps/functions/src/access.ts");
    const resend = access.slice(access.indexOf("export const access_adminResendPin"), access.indexOf("// --- Callable: Admin Get Door Status"));
    expect(resend).not.toContain("codeLast2");
    const notify = access.slice(access.indexOf("async function sendResendNotification"));
    expect(notify.slice(0, notify.indexOf("\n}\n"))).not.toContain("codeLast2");
    const myGrants = access.slice(access.indexOf("export const access_getMyGrants"), access.indexOf("async function ownerCode"));
    expect(myGrants).not.toContain("codeLast2");
  });
});

describe("customer pages say nothing behind the scenes", () => {
  it("has no Seam, webhook, provider or lock-brand wording", () => {
    for (const file of [
      "apps/web/src/lib/accessCodeView.ts",
      "apps/web/src/components/sayhi/AccessCodeBlock.tsx",
      "apps/web/src/components/sayhi/AccessCodeStack.tsx",
      "apps/functions/src/accessCodes/policy.ts",
    ]) {
      const visible = read(file).split("\n").filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line)).join("\n");
      expect(visible, file).not.toMatch(/seam|webhook|provider|yale|hash/i);
    }
  });
});

describe("go-live door record", () => {
  it("maps D1-D6, the private office and the conference room to the Floor Entrance lock", () => {
    expect(DEVICE_ID).toBe("6fcd15b8-8fc1-4dcc-bd9d-2747e63ebc11");
    expect(DOOR_RESOURCE_IDS).toEqual(["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6", "private-office", "mode-conference"]);
    expect(WEBHOOK_URL).toBe("https://us-central1-hi-coworking-plat.cloudfunctions.net/access_seamWebhook");
    expect(DEAD_WEBHOOK_URL).toBe("https://us-east1-hi-coworking-plat.cloudfunctions.net/seam_webhook");
    const fresh = doorRecord(null, "main", NOW);
    expect(fresh).toMatchObject({ id: "floor-entrance", name: "Floor Entrance", seamDeviceId: DEVICE_ID, locationId: "main", status: "unknown" });
    const merged = doorRecord({ id: "front", name: "Front", resourceIds: ["seat-7"], status: "archived", createdAt: 1 }, "main", NOW);
    expect(merged.id).toBe("front");
    expect(merged.resourceIds).toEqual(expect.arrayContaining(["seat-7", ...DOOR_RESOURCE_IDS]));
    expect(merged.status).toBe("unknown");
    expect(merged.createdAt).toBe(1);
  });
});
