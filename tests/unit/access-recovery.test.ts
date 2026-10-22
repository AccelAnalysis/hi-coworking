import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ docs: new Map<string, any>(), create: vi.fn(), remove: vi.fn(), serial: 0 }));
vi.mock("firebase-functions/params", () => ({ defineSecret: () => ({ value: () => "test-only-secret" }) }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (...args: any[]) => args.at(-1), onRequest: (...args: any[]) => args.at(-1), HttpsError: Error }));
vi.mock("../../apps/functions/src/providers/seamProvider", () => ({ createTimeBoundCode: mock.create, deleteCode: mock.remove, remoteUnlock: vi.fn(), getDeviceStatus: vi.fn(), validateSeamSignature: () => false }));
vi.mock("../../apps/functions/node_modules/firebase-admin/lib/index.js", () => {
  const ref = (path: string): any => ({
    id: path.split("/").at(-1), path,
    get: async () => ({ exists: mock.docs.has(path), data: () => mock.docs.get(path), ref: ref(path) }),
    set: async (value: any, options?: any) => { mock.docs.set(path, options?.merge ? { ...mock.docs.get(path), ...value } : value); },
    update: async (value: any) => { mock.docs.set(path, { ...mock.docs.get(path), ...value }); },
  });
  const collection = (name: string): any => {
    const filters: any[] = [];
    const query: any = {
      doc: (id?: string) => ref(`${name}/${id || ++mock.serial}`),
      where: (key: string, op: string, value: any) => { filters.push([key, op, value]); return query; },
      limit: () => query, orderBy: () => query,
      get: async () => {
        const docs = [...mock.docs].filter(([path, value]) => path.startsWith(name + "/") && filters.every(([k, op, v]) => op === "==" ? value[k] === v : op === "array-contains" ? value[k]?.includes(v) : op === "!=" ? value[k] !== v : op === "in" ? v.includes(value[k]) : op === "<" ? value[k] < v : value[k] > v)).map(([path, value]) => ({ id: path.split("/").at(-1), data: () => value, ref: ref(path) }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return query;
  };
  // Serialize fake transactions to model atomic claims; actual Firestore contention still needs emulator validation.
  let tail = Promise.resolve();
  return { apps: [{}], firestore: () => ({ collection, batch: () => ({ set: (r: any, value: any) => r.set(value), commit: async () => undefined }), runTransaction: (fn: any) => {
    const result = tail.then(() => fn({ get: (r: any) => r.get(), set: (r: any, v: any) => r.set(v), create: (r: any, v: any) => r.set(v), update: (r: any, v: any) => r.update(v) }));
    tail = result.then(() => undefined, () => undefined);
    return result;
  } }) };
});
import { processNoShows } from "../../apps/functions/src/scheduled/accessCleanup";
import { processEnrollment, enrollContact } from "../../apps/functions/src/nurture";
import { createAccessGrant, revokeAccessGrant, handleSeamEvent, access_onBookingCreated } from "../../apps/functions/src/access";

beforeEach(() => { mock.docs.clear(); mock.create.mockReset(); mock.remove.mockReset(); mock.serial = 0; mock.docs.set("bookings/booking1", { status: "CONFIRMED", resourceId: "desk1", userId: "user1", start: 1000000, end: 2000000 }); });
const grant = () => mock.docs.get("accessGrants/booking_booking1");
const create = () => createAccessGrant("booking1", "desk1", "user1", 1000000, 2000000);
function seedDoor() {
  mock.docs.set("doors/door1", { name: "Front door", resourceIds: ["desk1"], status: "online", seamDeviceId: "test-device" });
  mock.docs.set("users/user1", { displayName: "Test", email: "test@example.invalid" });
}
describe("credential recovery (no live providers)", () => {
  it("records no-door failure for member/staff visibility", async () => {
    await create();
    expect(grant()).toMatchObject({ programmingStatus: "blocked", staffAttentionRequired: true, status: "pending" });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("can safely retry a missing-door block after configuration is repaired", async () => {
    await create(); seedDoor();
    mock.create.mockResolvedValue({ plainPin: "123456", seamCodeId: "test-code", codeHash: "hash", codeLast2: "56" });
    await create();
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(grant()).toMatchObject({ programmingStatus: "programming", staffAttentionRequired: false });
  });
  it("retries an expired pre-provider lease, but never an attempted provider call", async () => {
    seedDoor();
    mock.docs.set("accessGrants/booking_booking1", { status: "pending", providerAttempted: false, leaseExpiresAt: 0, programmingStatus: "pending" });
    mock.create.mockResolvedValue({ plainPin: "123456", seamCodeId: "test-code", codeHash: "hash", codeLast2: "56" });
    await create();
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(grant().providerAttempted).toBe(true);
    await create();
    expect(mock.create).toHaveBeenCalledTimes(1);
  });
  it("does not provision a cancelled booking", async () => {
    seedDoor(); mock.docs.set("bookings/booking1", { status: "CANCELLED", start: 1000000, end: 2000000 });
    await create();
    expect(mock.create).not.toHaveBeenCalled();
    expect(grant()).toBeUndefined();
  });
  it("provider failure stays pending and cannot blindly issue duplicate credentials on retry", async () => {
    seedDoor(); mock.create.mockRejectedValue(new Error("provider timeout"));
    await create(); await create();
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(grant()).toMatchObject({ programmingStatus: "failed", staffAttentionRequired: true, status: "pending", deliveryStatus: "not_queued" });
  });
  it("provider acceptance remains programming and email is only queued", async () => {
    seedDoor(); mock.create.mockResolvedValue({ plainPin: "123456", seamCodeId: "test-code", codeHash: "hash", codeLast2: "56" });
    await create(); await create();
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(grant()).toMatchObject({ programmingStatus: "programming", activationStatus: "pending", status: "pending", deliveryStatus: "queued" });
    const code = [...mock.docs].find(([key]) => key.startsWith("accessCodes/"))![1];
    expect(code.deliveredAt).toBeUndefined();
    expect(code.deliveryStatus).toBe("queued");
    expect(mock.docs.get("mail/access_booking_booking1")).toMatchObject({ to: ["test@example.invalid"], message: { subject: expect.any(String), text: expect.any(String) } });
  });
});


describe("late provider activation", () => {
  it("does not resurrect a revoked grant", async () => {
    mock.docs.set("accessCodes/code1", { status: "revoked", seamCodeId: "seam1", grantId: "grant1", doorId: "door1" });
    mock.docs.set("accessGrants/grant1", { status: "revoked", bookingId: "booking1" });
    await handleSeamEvent({ event_type: "access_code.set", access_code_id: "seam1" });
    expect(mock.docs.get("accessGrants/grant1").status).toBe("revoked");
    expect(mock.docs.get("accessCodes/code1").status).toBe("revoked");
  });
  it("does not activate a cancelled booking even before revoke finishes", async () => {
    mock.docs.set("accessCodes/code1", { status: "programming", seamCodeId: "seam1", grantId: "grant1", doorId: "door1" });
    mock.docs.set("accessGrants/grant1", { status: "pending", bookingId: "booking1", endsAt: Date.now() + 3600000 });
    mock.docs.set("bookings/booking1", { status: "CANCELLED" });
    await handleSeamEvent({ event_type: "access_code.set", access_code_id: "seam1" });
    expect(mock.docs.get("accessGrants/grant1").status).toBe("pending");
    expect(mock.docs.get("accessCodes/code1").status).toBe("programming");
  });
});


describe("nurture delivery recovery (production processor, fake atomic store)", () => {
  function setupEnrollment() {
    const path = "nurtureEnrollments/enroll1";
    mock.docs.set(path, { id: "enroll1", campaignId: "campaign1", stage: "RETENTION", contactType: "user", contactId: "user1", email: "test@example.invalid", emailHash: "hash", status: "ACTIVE", nextDueAt: 0, nextStepIndex: 0, unsubscribeToken: "test-token" });
    mock.docs.set("nurtureCampaigns/campaign1", { id: "campaign1", status: "ACTIVE", stage: "RETENTION", steps: [{ id: "step1", delayHours: 0, subject: "Test", body: "Test" }] });
    const ref: any = {
      get: async () => ({ exists: true, data: () => mock.docs.get(path) }),
      set: async (value: any, options: any) => mock.docs.set(path, options?.merge ? { ...mock.docs.get(path), ...value } : value),
    };
    return ref;
  }
  it("parallel schedules and repeated processing send a step at most once", async () => {
    const ref = setupEnrollment();
    const provider: any = { send: vi.fn().mockResolvedValue({ messageId: "test-message" }) };
    await Promise.all([processEnrollment(ref, provider), processEnrollment(ref, provider)]);
    await processEnrollment(ref, provider);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(mock.docs.get("nurtureDeliveries/enroll1__step1").status).toBe("SENT");
  });
  it("a provider timeout after possible acceptance requires staff, never blind resend", async () => {
    const ref = setupEnrollment();
    const provider: any = { send: vi.fn().mockRejectedValue(new Error("timeout after possible acceptance")) };
    await processEnrollment(ref, provider);
    await processEnrollment(ref, provider);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(mock.docs.get("nurtureEnrollments/enroll1")).toMatchObject({ status: "FAILED", staffAttentionRequired: true });
  });
  it("a worker crash after send claim is escalated instead of resent", async () => {
    const ref = setupEnrollment();
    mock.docs.set("nurtureDeliveries/enroll1__step1", { status: "PROCESSING", startedAt: Date.now() - 16 * 60000 });
    const provider: any = { send: vi.fn() };
    await processEnrollment(ref, provider);
    expect(provider.send).not.toHaveBeenCalled();
    expect(mock.docs.get("nurtureEnrollments/enroll1")).toMatchObject({ status: "FAILED", staffAttentionRequired: true });
  });
});


describe("no-show telemetry safety", () => {
  it("keeps paid active access when no per-grant attendance signal exists", async () => {
    mock.docs.set("accessGrants/paid", { id: "paid", status: "active", startsAt: Date.now() - 40 * 60000, endsAt: Date.now() + 60 * 60000 });
    await processNoShows();
    expect(mock.docs.get("accessGrants/paid")).toMatchObject({ status: "active", attendanceStatus: "attendance_unknown", attendanceReviewRequired: true });
  });
  it("an enabled switch alone cannot revoke access based on absent telemetry", async () => {
    vi.stubEnv("ACCESS_NO_SHOW_REVOKE_ENABLED", "true");
    try {
      mock.docs.set("accessGrants/paid", { id: "paid", status: "active", startsAt: Date.now() - 40 * 60000, endsAt: Date.now() + 60 * 60000 });
      await processNoShows();
      expect(mock.docs.get("accessGrants/paid").status).toBe("active");
    } finally { vi.unstubAllEnvs(); }
  });
});


describe("desk-change access outbox recovery", () => {
  it("uses the first physical segment after a crash before direct finalization issuance", async () => {
    seedDoor();
    mock.docs.set("bookings/booking1", { status: "CONFIRMED", bookingKind: "desk_change", resourceId: "seat-flex", userId: "user1", start: Date.now() + 600000, end: Date.now() + 3600000, segments: [{ resourceId: "desk1" }, { resourceId: "desk2" }] });
    mock.create.mockResolvedValue({ plainPin: "123456", seamCodeId: "test-code", codeHash: "hash", codeLast2: "56" });
    await access_onBookingCreated.run({ params: { bookingId: "booking1" }, data: { ref: { get: async () => ({ data: () => mock.docs.get("bookings/booking1") }) } } } as any);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(grant()).toMatchObject({ resourceId: "desk1", programmingStatus: "programming", providerAttempted: true });
  });
  it("rejects an outdated physical-resource argument after the booking changes", async () => {
    seedDoor();
    mock.docs.set("bookings/booking1", { status: "CONFIRMED", bookingKind: "desk_change", resourceId: "seat-flex", userId: "user1", start: 1000000, end: 2000000, segments: [{ resourceId: "desk2" }] });
    await create();
    expect(mock.create).not.toHaveBeenCalled();
    expect(grant()).toBeUndefined();
  });
});


describe("legacy nurture enrollment continuity", () => {
  const contact = { contactType: "user" as const, contactId: "user1", uid: "user1", email: "test@example.invalid" };
  it("does not restart first-booking nurture for an existing legacy per-booking enrollment", async () => {
    mock.docs.set("nurtureEnrollments/legacy-booking-id", { campaignId: "customer-first-booking", contactType: "user", contactId: "user1", sourceSignal: "BOOKING_CONFIRMED", sourceRefId: "booking-old", status: "COMPLETED" });
    const results = await Promise.all([enrollContact("BOOKING_CONFIRMED", contact, "booking-new"), enrollContact("BOOKING_CONFIRMED", contact, "booking-newer")]);
    expect(results).toEqual([[], []]);
    expect([...mock.docs.keys()].filter((key) => key.startsWith("nurtureEnrollments/"))).toHaveLength(1);
  });
  it("does not restart a win-back episode already contacted under a legacy daily ID", async () => {
    const now = Date.now();
    mock.docs.set("nurtureEnrollments/legacy-daily-id", { campaignId: "retention-inactive", contactType: "user", contactId: "user1", sourceSignal: "MEMBER_INACTIVE", sourceRefId: "inactive:2026-01-01", enrolledAt: now - 60 * 86400000, status: "COMPLETED" });
    expect(await enrollContact("MEMBER_INACTIVE", contact, `inactive:${now - 120 * 86400000}`)).toEqual([]);
  });
  it("honors legacy cooldown after new activity, then permits a genuinely new inactivity episode", async () => {
    const now = Date.now();
    const legacy = { campaignId: "retention-inactive", contactType: "user", contactId: "user1", sourceSignal: "MEMBER_INACTIVE", sourceRefId: "inactive:2026-01-01", enrolledAt: now - 60 * 86400000, status: "COMPLETED" };
    mock.docs.set("nurtureEnrollments/legacy-daily-id", legacy);
    expect(await enrollContact("MEMBER_INACTIVE", contact, `inactive:${now - 50 * 86400000}`)).toEqual([]);
    mock.docs.set("nurtureEnrollments/legacy-daily-id", { ...legacy, enrolledAt: now - 120 * 86400000 });
    expect(await enrollContact("MEMBER_INACTIVE", contact, `inactive:${now - 50 * 86400000}`)).toHaveLength(1);
  });
});


describe("revocation of durable pre-provider and ambiguous grants", () => {
  it("locally revokes a never-issued no-door grant and remains idempotent", async () => {
    await create();
    expect(grant().doorId).toBeUndefined();
    await revokeAccessGrant("booking_booking1", "cancellation");
    await revokeAccessGrant("booking_booking1", "cancellation");
    expect(grant()).toMatchObject({ status: "revoked", revocationStatus: "completed" });
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it("does not report success when a missing-door grant has an issued provider code", async () => {
    mock.docs.set("accessGrants/issued", { status: "pending", providerAttempted: true, bookingId: "booking1" });
    mock.docs.set("accessCodes/issued-code", { grantId: "issued", status: "programming", seamCodeId: "provider-code" });
    await expect(revokeAccessGrant("issued", "cancellation")).rejects.toThrow();
    expect(mock.docs.get("accessGrants/issued")).toMatchObject({ status: "pending", revocationStatus: "blocked", staffAttentionRequired: true });
    expect(mock.docs.get("accessCodes/issued-code").status).toBe("programming");
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it("escalates an ambiguous provider attempt without a recorded code", async () => {
    mock.docs.set("accessGrants/ambiguous", { status: "pending", providerAttempted: true, bookingId: "booking1" });
    await expect(revokeAccessGrant("ambiguous", "cancellation")).rejects.toThrow();
    expect(mock.docs.get("accessGrants/ambiguous").revocationStatus).toBe("blocked");
  });
  it("preserves code state on provider removal failure, then allows a safe deletion retry", async () => {
    seedDoor();
    mock.docs.set("accessGrants/issued", { status: "active", providerAttempted: true, doorId: "door1", bookingId: "booking1" });
    mock.docs.set("accessCodes/issued-code", { grantId: "issued", status: "active", seamCodeId: "provider-code" });
    mock.remove.mockRejectedValueOnce(new Error("timeout"));
    await expect(revokeAccessGrant("issued", "cancellation")).rejects.toThrow();
    expect(mock.docs.get("accessCodes/issued-code").status).toBe("active");
    mock.remove.mockResolvedValueOnce(undefined);
    await expect(revokeAccessGrant("issued", "cancellation")).rejects.toThrow();
    expect(mock.docs.get("accessCodes/issued-code")).toMatchObject({ status: "active", revocationStatus: "awaiting_confirmation" });
    expect(mock.docs.get("accessGrants/issued")).toMatchObject({ status: "active", staffAttentionRequired: true });
    await handleSeamEvent({ event_type: "access_code.removed_from_device", access_code_id: "provider-code" });
    await revokeAccessGrant("issued", "cancellation");
    expect(mock.docs.get("accessCodes/issued-code").status).toBe("revoked");
    expect(mock.docs.get("accessGrants/issued")).toMatchObject({ status: "revoked", revocationStatus: "completed" });
  });
});


describe("authoritative provider removal reconciliation", () => {
  it("allows removal confirmations through the revocation fence and waits for every code", async () => {
    mock.docs.set("accessGrants/multi", { status: "active", bookingId: "booking1", revocationRequestedAt: Date.now(), revocationStatus: "blocked" });
    for (const id of ["one", "two"]) mock.docs.set(`accessCodes/${id}`, { grantId: "multi", status: "active", seamCodeId: id });
    await handleSeamEvent({ event_type: "access_code.deleted", access_code_id: "one" });
    expect(mock.docs.get("accessGrants/multi").status).toBe("active");
    await handleSeamEvent({ event_type: "access_code.removed_from_device", access_code_id: "two" });
    expect(mock.docs.get("accessGrants/multi")).toMatchObject({ status: "revoked", revocationStatus: "completed" });
  });
  it("a failed-to-delete event retains possible physical access and escalates", async () => {
    mock.docs.set("accessGrants/failed", { status: "active", bookingId: "booking1", revocationRequestedAt: Date.now() });
    mock.docs.set("accessCodes/failed", { grantId: "failed", status: "active", seamCodeId: "failed" });
    await handleSeamEvent({ event_type: "access_code.failed_to_delete", access_code_id: "failed" });
    expect(mock.docs.get("accessCodes/failed")).toMatchObject({ status: "active", revocationStatus: "failed" });
    expect(mock.docs.get("accessGrants/failed")).toMatchObject({ status: "active", revocationStatus: "blocked", staffAttentionRequired: true });
  });
});


describe("documented Seam lifecycle event names", () => {
  function seedPending() {
    const start = Date.now() + 600000; const end = start + 3600000;
    mock.docs.set("bookings/booking1", { status: "CONFIRMED", resourceId: "desk1", userId: "user1", start, end });
    mock.docs.set("accessGrants/lifecycle", { status: "pending", bookingId: "booking1", resourceId: "desk1", startsAt: start - 300000, endsAt: end + 300000 });
    mock.docs.set("accessCodes/lifecycle", { grantId: "lifecycle", status: "programming", seamCodeId: "lifecycle" });
  }
  it.each(["access_code.issued", "access_code.set_on_device", "access_code.scheduled_on_device"])("accepts programmed evidence %s", async (event_type) => {
    seedPending();
    await handleSeamEvent({ event_type, access_code_id: "lifecycle" });
    expect(mock.docs.get("accessGrants/lifecycle").status).toBe("active");
  });
  it.each(["access_code.created", "access_code.mutations_requested"])("does not infer readiness from %s", async (event_type) => {
    seedPending();
    await handleSeamEvent({ event_type, access_code_id: "lifecycle" });
    expect(mock.docs.get("accessGrants/lifecycle").status).toBe("pending");
  });
  it.each(["access_code.failed_to_issue", "access_code.failed_to_update", "access_code.failed_to_set_on_device"])("surfaces provisioning failure %s", async (event_type) => {
    seedPending();
    await handleSeamEvent({ event_type, access_code_id: "lifecycle" });
    expect(mock.docs.get("accessGrants/lifecycle")).toMatchObject({ status: "pending", staffAttentionRequired: true });
    expect(mock.docs.get("accessCodes/lifecycle").status).toBe("failed");
  });
});
